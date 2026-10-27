import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ImportRecordSchema,
  type ExecutionContext,
  type ImportRecord,
} from "../../../../src/lib/github/contracts";
import { createUnavailableGithubPorts } from "../../../../src/lib/github/server/unavailable";
import {
  composeGithubServices,
  configureGithubServices,
  createGithubServicesFactory,
  getGithubServices,
  isGithubImportRuntimeConfigured,
  resetGithubServicesForTests,
} from "../../../../src/lib/github/server/composition";
import { JobRecordSchema } from "../../../../src/lib/github/server/jobs/store";

vi.mock("../../../../src/lib/cloud/protect-route", () => ({
  protectAccountRoute: (handler: unknown) => handler,
}));
vi.mock("../../../../src/lib/cloud/server-account", () => ({
  requireCloudAccount: vi.fn(),
}));
vi.mock("../../../../src/lib/cloud/security", () => ({
  assertSameOrigin: vi.fn(),
  getAppMode: () => "local",
}));

const timestamp = "2026-10-26T00:00:00.000Z";
const hash = "a".repeat(64);

function error(code: "forbidden" | "unavailable" = "forbidden") {
  return {
    code,
    message:
      code === "forbidden"
        ? "This job is not available in the current session."
        : "GitHub import services are not configured yet.",
    retryable: code === "unavailable",
  } as const;
}

function budget(): ExecutionContext["budget"] {
  return {
    async reserve() {
      return { ok: true, value: { reservationId: "reservation-1" } };
    },
    async commitUsage() {
      return {
        ok: false,
        error: {
          code: "unavailable",
          message: "Unused test budget.",
          retryable: false,
        },
      };
    },
    checkSelection() {
      return { ok: true, value: { allowed: true, reason: null } };
    },
    remaining() {
      return {
        ok: false,
        error: {
          code: "unavailable",
          message: "Unused test budget.",
          retryable: false,
        },
      };
    },
    snapshot() {
      return {
        ok: false,
        error: {
          code: "unavailable",
          message: "Unused test budget.",
          retryable: false,
        },
      };
    },
  };
}

function context(root: string, sessionId: string): ExecutionContext {
  return {
    personalRoot: root,
    access: {
      sessionId,
      authorizationNamespace: sessionId,
      accountId: null,
      grantedRepositoryIds: ["123"],
    },
    signal: new AbortController().signal,
    now: () => new Date(timestamp),
    runId: "request-run",
    deadline: "2026-10-26T00:00:30.000Z",
    budget: budget(),
  };
}

function importRecord(): ImportRecord {
  return ImportRecordSchema.parse({
    id: "import-1",
    version: 1,
    source: "personal",
    destinationProjectId: "project-1",
    authorizationNamespaceHash: hash,
    scope: {
      repositoryId: "123",
      owner: "example",
      name: "repo",
      canonicalUrl: "https://github.com/example/repo",
      visibility: "public",
      ref: "main",
      commitSha: "b".repeat(40),
      selectedPullRequestNumbers: [],
      selectedPaths: [],
      contributionStatement: "Contributed to the project.",
      identitySource: "unknown",
    },
    selectionVersion: 1,
    selectionHash: null,
    lifecycle: "ready-to-review",
    activeRunId: null,
    consent: null,
    preparedSelectionRef: null,
    resultRef: null,
    draftRefs: [],
    draftEdits: [],
    savedIds: [],
    retentionDeadline: "2026-10-27T00:00:00.000Z",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

async function writeJobFixture(root: string): Promise<void> {
  const directory = join(root, "data", "github-jobs");
  await mkdir(directory, { recursive: true });
  const job = JobRecordSchema.parse({
    id: "job-1",
    runId: "run-1",
    importId: "import-1",
    projectId: "project-1",
    importVersion: 1,
    selectionVersion: 1,
    kind: "analyze",
    state: "completed",
    version: 2,
    inputHash: hash,
    selectionHash: "b".repeat(64),
    consentHash: "c".repeat(64),
    idempotencyKeyHash: "d".repeat(64),
    enqueuePayloadHash: "e".repeat(64),
    createdAt: timestamp,
    updatedAt: timestamp,
    deadlineAt: "2026-10-26T00:01:00.000Z",
    initialAllowance: { requests: 1 },
    usageLedger: { reported: {}, reserved: {}, uncertain: false },
    checkpoint: {
      version: 1,
      stage: "ready-to-review",
      providerState: "completed",
      providerResultRef: "result-1",
      updatedAt: timestamp,
    },
    executionFence: 0,
    lease: null,
    cancelRequestedAt: null,
    retryRequired: false,
    resultRef: "result-1",
    resultExpiresAt: "2026-10-27T00:00:00.000Z",
    failureCode: null,
    failureRetryable: null,
    outboxEvents: [
      {
        id: "notification-1",
        type: "ready-to-review",
        jobId: "job-1",
        runId: "run-1",
        importId: "import-1",
        projectId: "project-1",
        createdAt: timestamp,
        resultRef: "result-1",
        resultExpiresAt: "2026-10-27T00:00:00.000Z",
        failureCode: null,
        readAt: null,
        dismissedAt: null,
      },
    ],
  });
  await writeFile(
    join(directory, "jobs.json"),
    `${JSON.stringify({ schemaVersion: 1, jobs: [job] })}\n`,
    "utf8",
  );
}

function fakePorts(root: string) {
  const base = createUnavailableGithubPorts();
  const github = {
    getJson: vi.fn(base.github.getJson),
    getText: vi.fn(base.github.getText),
  };
  const runner = {
    ...base.runner,
    runOnce: vi.fn(base.runner.runOnce),
  };
  const approval = {
    ...base.approval,
    approveGithubImport: vi.fn(base.approval.approveGithubImport),
  };
  const record = importRecord();
  const ports = {
    ...base,
    github,
    runner,
    approval,
    imports: {
      ...base.imports,
      async get(_input: { id: string }, requestContext: ExecutionContext) {
        if (requestContext.access.sessionId !== "session-a")
          return {
            ok: false as const,
            error: {
              code: "not-found" as const,
              message: "Staged import not found.",
              retryable: false,
            },
          };
        return { ok: true as const, value: record };
      },
    },
  };
  const bindings = {
    async createContext({ request }: { request: Request }) {
      const sessionId = request.headers.get("x-test-session");
      if (!sessionId) return { ok: false as const, error: error() };
      return { ok: true as const, value: context(root, sessionId) };
    },
  };
  return { ports, bindings, github, runner, approval };
}

afterEach(() => resetGithubServicesForTests());

describe("GitHub server composition", () => {
  it("reports the missing worker as unavailable instead of succeeding", async () => {
    expect(isGithubImportRuntimeConfigured()).toBe(false);
    const services = await getGithubServices();
    const result = await services.worker.run({
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ ok: false, error: { code: "unavailable" } });
  });

  it("resolves the personal root once and reuses one services instance", async () => {
    let calls = 0;
    let resolvedRoot = "";
    const factory = createGithubServicesFactory(({ personalRoot }) => {
      calls += 1;
      resolvedRoot = personalRoot;
      const { ports, bindings } = fakePorts(personalRoot);
      return { ports, bindings };
    });
    configureGithubServices(factory);
    configureGithubServices(factory);
    expect(isGithubImportRuntimeConfigured()).toBe(true);

    const first = await getGithubServices();
    const second = await getGithubServices();

    expect(first).toBe(second);
    expect(calls).toBe(1);
    expect(resolvedRoot.length).toBeGreaterThan(0);
  });

  it("rejects request contexts bound to a different personal data root", async () => {
    const root = await mkdtemp(join(tmpdir(), "github-task-20-root-"));
    try {
      const { ports } = fakePorts(root);
      const services = composeGithubServices({
        ports,
        personalRoot: root,
        bindings: {
          async createContext() {
            return {
              ok: true,
              value: context(`${root}-other`, "session-a"),
            };
          },
        },
      });
      const request = new Request("http://localhost/api/github/jobs/job-1");

      await expect(
        services.createContext({ request, signal: request.signal }),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "io-error" },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("authorizes job status and events through the import owner without upstream calls", async () => {
    const root = await mkdtemp(join(tmpdir(), "github-task-20-"));
    try {
      await writeJobFixture(root);
      const { ports, bindings, github } = fakePorts(root);
      const services = composeGithubServices({
        ports,
        bindings,
        personalRoot: root,
        now: () => new Date(timestamp),
      });
      const requestA = new Request("http://localhost/api/github/jobs/job-1", {
        headers: { "x-test-session": "session-a" },
      });
      const requestB = new Request("http://localhost/api/github/jobs/job-1", {
        headers: { "x-test-session": "session-b" },
      });
      const contextA = await services.createContext({
        request: requestA,
        signal: requestA.signal,
      });
      const contextB = await services.createContext({
        request: requestB,
        signal: requestB.signal,
      });

      expect(contextA.ok).toBe(true);
      expect(contextB.ok).toBe(true);
      if (!contextA.ok || !contextB.ok) return;

      await expect(
        services.status.getJob({ jobId: "job-1", context: contextA.value }),
      ).resolves.toMatchObject({ ok: true, value: { state: "completed" } });
      await expect(
        services.status.getJob({ jobId: "job-1", context: contextB.value }),
      ).resolves.toMatchObject({ ok: false, error: { code: "forbidden" } });

      const page = await services.events.read({
        context: contextA.value,
        cursor: null,
        limit: 10,
      });
      expect(page).toMatchObject({
        ok: true,
        value: {
          events: [
            {
              id: expect.stringMatching(/^job-/),
              type: "job",
              job: { importId: "import-1" },
            },
            {
              id: expect.stringMatching(/^notification-/),
              type: "notification",
            },
          ],
          hasMore: false,
        },
      });
      expect(github.getJson).not.toHaveBeenCalled();
      expect(github.getText).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps notification read state independent from analysis and approval", async () => {
    const root = await mkdtemp(join(tmpdir(), "github-task-20-read-"));
    try {
      await writeJobFixture(root);
      const { ports, bindings, runner, approval } = fakePorts(root);
      const services = composeGithubServices({
        ports,
        bindings,
        personalRoot: root,
        now: () => new Date(timestamp),
      });
      const request = new Request(
        "http://localhost/api/library/notifications",
        {
          headers: { "x-test-session": "session-a" },
        },
      );
      const requestContext = await services.createContext({
        request,
        signal: request.signal,
      });
      expect(requestContext.ok).toBe(true);
      if (!requestContext.ok) return;

      const result = await services.notifications.markRead(
        { notificationId: "notification-1" },
        requestContext.value,
      );
      expect(result).toMatchObject({
        ok: true,
        value: { id: "notification-1", readAt: timestamp },
      });
      await expect(
        services.notifications.list(
          { cursor: null, limit: 10 },
          requestContext.value,
        ),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          notifications: [{ id: "notification-1", readAt: timestamp }],
          hasMore: false,
        },
      });
      expect(runner.runOnce).not.toHaveBeenCalled();
      expect(approval.approveGithubImport).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("exposes an expired result and an expired inbox item distinctly", async () => {
    const root = await mkdtemp(join(tmpdir(), "github-task-20-expired-"));
    try {
      await writeJobFixture(root);
      const { ports, bindings } = fakePorts(root);
      const services = composeGithubServices({
        ports,
        bindings,
        personalRoot: root,
        now: () => new Date("2026-10-28T00:00:00.000Z"),
      });
      const request = new Request("http://localhost/api/github/jobs/job-1", {
        headers: { "x-test-session": "session-a" },
      });
      const requestContext = await services.createContext({
        request,
        signal: request.signal,
      });
      expect(requestContext.ok).toBe(true);
      if (!requestContext.ok) return;

      const status = await services.status.getJob({
        jobId: "job-1",
        context: requestContext.value,
      });
      expect(status).toMatchObject({
        ok: true,
        value: { state: "completed", expired: true, resultRef: null },
      });
      const page = await services.events.read({
        context: requestContext.value,
        cursor: null,
        limit: 10,
      });
      expect(page).toMatchObject({
        ok: true,
        value: {
          events: [
            { job: { expired: true, resultRef: null } },
            { notification: { type: "expired", destination: null } },
          ],
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("can load the standalone Node worker and guarded Next boundary independently", async () => {
    const workerPath = resolve("src/workers/github-import-worker.ts");
    const nodeImport = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(pathToFileURL(workerPath).href)}); process.exit(0)`,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const nextBoundary =
      await import("../../../../src/lib/github/server/next-boundary");

    expect(nodeImport.status).toBe(0);
    expect(nodeImport.stderr).toBe("");
    expect(nextBoundary.protectGithubRoute).toBeTypeOf("function");
  });
});
