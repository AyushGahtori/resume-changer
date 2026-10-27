import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGithubBackendRuntime } from "../../../src/lib/github/server/backend-runtime";
import {
  composeGithubServices,
  configureGithubServices,
  resetGithubServicesForTests,
} from "../../../src/lib/github/server/composition";
import { createGithubApprovalPort } from "../../../src/lib/data/writers";
import { createImportClient } from "../../../src/lib/github/client";
import {
  createUnavailableGithubPorts,
  createUnavailableBudgetLedger,
} from "../../../src/lib/github/server/unavailable";
import { resolveGithubApiRoute } from "../../../src/lib/api/github-routes";
import { measurementAnswerHash } from "../../../src/lib/github/server/measurement-service";
import { ResumeLibraryV2Schema } from "../../../src/lib/schemas/resume-data";
import {
  ok,
  type ExecutionContext,
  type RepositoryScope,
  type Result,
  type EvidenceItem,
  type MeasurementAnswer,
} from "../../../src/lib/github/contracts";
import { readFileSync } from "node:fs";

const roots: string[] = [];
afterEach(async () => {
  resetGithubServicesForTests();
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((r) => rm(r, { recursive: true, force: true })),
  );
});
function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}
const sha = (text: string) =>
  createHash("sha1")
    .update(`blob ${Buffer.byteLength(text)}\0`)
    .update(text)
    .digest("hex");
const commit = "a".repeat(40),
  tree = "b".repeat(40);
const files = {
  "README.md":
    "# Fictional publishing API\nValidates publishing input before sending a request.\n",
  "src/publish.ts":
    "export function validatePublish(input: string) {\n if (!input.trim()) throw new Error('Missing content');\n return input.trim();\n}\n",
  "tests/publish.test.ts":
    "it('rejects blank input', () => {\n expect(() => validatePublish('')).toThrow();\n});\n",
};
async function fixture() {
  vi.stubEnv("RESUME_APP_MODE", "local");
  const root = await mkdtemp(join(tmpdir(), "github-gate-b-"));
  roots.push(root);
  await mkdir(join(root, "data"));
  const text = readFileSync(
    join(process.cwd(), "examples/sample-resume-library.json"),
    "utf8",
  );
  await writeFile(join(root, "data/resume-library.json"), text);
  const projectId = JSON.parse(text).projects[0].id as string;
  let time = Date.parse("2026-10-27T12:00:00.000Z"),
    actor = "session-one",
    authorized = true,
    available = true;
  const now = () => new Date(time);
  const scope: RepositoryScope = {
    repositoryId: "42",
    owner: "example",
    name: "publishing",
    canonicalUrl: "https://github.com/example/publishing",
    visibility: "public",
    ref: "main",
    commitSha: commit,
    selectedPullRequestNumbers: [],
    selectedPaths: ["src/publish.ts", "tests/publish.test.ts"],
    contributionStatement:
      "I implemented publishing validation and added regression tests.",
    identitySource: "user-provided",
  };
  function context(signal = new AbortController().signal): ExecutionContext {
    return {
      personalRoot: root,
      access: {
        sessionId: actor,
        authorizationNamespace: actor,
        accountId: null,
        grantedRepositoryIds: authorized ? ["42"] : [],
      },
      signal,
      now,
      runId: "request-run",
      deadline: new Date(time + 120_000).toISOString(),
      budget: createUnavailableBudgetLedger(),
    };
  }
  const calls: string[] = [];
  let evidence: EvidenceItem[] = [];
  const provider = {
    extractRepositoryAchievements: vi.fn(async () => ({
      text: JSON.stringify({
        projectSummary: "Publishing validation and its regression assertion.",
        claims: [
          {
            text: "The publishing function rejects blank content.",
            evidenceIds: [
              evidence.find((e) => e.category === "implementation")!.id,
            ],
            usesContributionStatement: true,
            limitations: [],
          },
        ],
        drafts: [
          {
            text: "Implemented publishing input validation and added a regression assertion for blank content.",
            claimIndexes: [0],
            limitations: [],
          },
        ],
        questionSuggestions: [],
        limitations: [],
      }),
      model: "synthetic-model",
      finishReason: "STOP",
      usage: {
        promptTokens: 500,
        cachedTokens: 20,
        outputTokens: 150,
        reasoningTokens: 0,
        totalTokens: 650,
      },
    })),
  };
  const dependencies: Parameters<typeof createGithubBackendRuntime>[0] = {
    personalRoot: root,
    now,
    access: createUnavailableGithubPorts().access,
    transport: () => ({
      fetch: async (url) => {
        calls.push(url.pathname);
        if (url.pathname === "/repos/example/publishing")
          return Response.json({
            id: 42,
            name: "publishing",
            full_name: "example/publishing",
            owner: { login: "example" },
            default_branch: "main",
            private: false,
            visibility: "public",
          });
        if (url.pathname.includes("/commits/"))
          return Response.json({
            sha: commit,
            commit: { tree: { sha: tree } },
          });
        if (url.pathname.includes("/git/trees/"))
          return Response.json({
            sha: tree,
            truncated: false,
            tree: Object.entries(files).map(([path, text]) => ({
              path,
              sha: sha(text),
              mode: "100644",
              type: "blob",
              size: Buffer.byteLength(text),
            })),
          });
        const text = Object.values(files).find((t) =>
          url.pathname.endsWith(sha(t)),
        );
        return new Response(text ?? "", { status: text ? 200 : 404 });
      },
      resolveAddresses: async () => ["140.82.112.6"],
      credentials: { getAccessToken: async () => null },
    }),
    authorize: async () => authorized,
    provider,
    requestContext: async ({ signal }) => ok(context(signal)),
    jobContext: async () => ok(context()),
    workerAvailable: () => available,
    approvalFactory: createGithubApprovalPort,
    ownsProject: async (id) => id === projectId,
  };
  const backend = createGithubBackendRuntime(dependencies);
  const services = composeGithubServices({
    ...backend,
    personalRoot: root,
    now,
  });
  configureGithubServices(() => services);
  const client = createImportClient({
    async fetch(path, init) {
      const req = new Request("http://localhost" + String(path), {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers)),
          Origin: "http://localhost",
        },
      });
      const match = resolveGithubApiRoute(
        new URL(req.url).pathname.slice(5).split("/"),
      );
      const handler =
        match?.methods[req.method as "GET" | "POST" | "PUT" | "DELETE"];
      return handler ? handler(req) : new Response(null, { status: 404 });
    },
  });
  return {
    root,
    projectId,
    scope,
    client,
    ports: backend.ports,
    restart: () => createGithubBackendRuntime(dependencies),
    services,
    provider,
    calls,
    context,
    prepareEvidence: (e: EvidenceItem[]) => {
      evidence = e;
    },
    setActor: (v: string) => {
      actor = v;
    },
    setAuthorized: (v: boolean) => {
      authorized = v;
    },
    setAvailable: (v: boolean) => {
      available = v;
    },
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe("Gate B composed backend", () => {
  it("runs browser payloads through durable preparation, consent, extraction, local previews and atomic qualitative approval", async () => {
    const f = await fixture();
    const created = unwrap(
      await f.client.create({
        source: "personal",
        destinationProjectId: f.projectId,
        scope: f.scope,
      }),
    );
    const prepare = unwrap(await f.client.prepare(created.id, created.version));
    expect(prepare.state).toBe("queued");
    unwrap(await f.restart().ports.runner.runOnce());
    const ready = unwrap(await f.client.get(created.id));
    expect(ready.prepared?.evidence.length).toBeGreaterThan(0);
    f.prepareEvidence(ready.prepared!.evidence);
    expect(ready.import.lifecycle).not.toBe("needs-input");
    expect(f.provider.extractRepositoryAchievements).not.toHaveBeenCalled();
    const job = unwrap(
      await f.client.analyze(
        created.id,
        ready.import.version,
        ready.prepared!.selectionHash,
        "consent-once",
      ),
    );
    const duplicate = unwrap(
      await f.client.analyze(
        created.id,
        ready.import.version,
        ready.prepared!.selectionHash,
        "consent-once",
      ),
    );
    expect(duplicate.id).toBe(job.id);
    const extraction = vi.spyOn(f.ports.extractor, "extract");
    const completion = unwrap(await f.ports.runner.runOnce());
    if (completion?.state !== "completed")
      throw new Error(
        JSON.stringify({
          completion,
          extraction: await extraction.mock.results[0]?.value,
        }),
      );
    const review = unwrap(await f.client.get(created.id));
    expect(review.import.lifecycle).toBe("ready-to-review");
    expect(review.result!.drafts).toHaveLength(1);
    const draft = review.result!.drafts[0]!;
    const upstreamBefore = f.calls.length;
    const preview = unwrap(
      await f.client.previewMeasurementDraft({
        importId: created.id,
        draftId: draft.id,
      }),
    );
    expect(preview.text).toBe(draft.text);
    const inbox = unwrap(await f.client.listNotifications());
    expect(inbox.notifications).toHaveLength(1);
    unwrap(await f.client.markNotificationRead(inbox.notifications[0]!.id));
    const edit = unwrap(
      await f.client.updateDraft(
        created.id,
        draft.id,
        review.import.version,
        draft.text,
        { selectedForSave: true, contributionConfirmed: true },
      ),
    );
    expect(edit.approvalEligible).toBe(true);
    const approval = vi.spyOn(f.ports.approval, "approveGithubImport");
    const edited = unwrap(await f.client.get(created.id));
    const response = await f.client.approve(
      created.id,
      edited.import.version,
      [draft.id],
      "approve-once",
    );
    if (!response.ok)
      throw new Error(JSON.stringify(await approval.mock.results[0]?.value));
    const saved = unwrap(response);
    expect(saved.savedIds).toHaveLength(1);
    const retry = unwrap(
      await f.client.approve(
        created.id,
        edited.import.version,
        [draft.id],
        "approve-once",
      ),
    );
    expect(retry).toEqual(saved);
    const library = ResumeLibraryV2Schema.parse(
      JSON.parse(
        await readFile(join(f.root, "data/resume-library.json"), "utf8"),
      ),
    );
    expect(
      library.projects[0]!.points.some(
        (p) => p.id === saved.savedIds[0] && p.githubEvidence,
      ),
    ).toBe(true);
    expect(f.calls).toHaveLength(upstreamBefore);
    expect(f.provider.extractRepositoryAchievements).toHaveBeenCalledTimes(1);
  }, 15000);
  it("calculates a user-attested measurement, previews it locally and saves only the confirmed clause", async () => {
    const f = await fixture();
    const created = unwrap(
      await f.client.create({
        source: "personal",
        destinationProjectId: f.projectId,
        scope: f.scope,
      }),
    );
    unwrap(await f.client.prepare(created.id, created.version));
    unwrap(await f.ports.runner.runOnce());
    const ready = unwrap(await f.client.get(created.id));
    f.prepareEvidence(ready.prepared!.evidence);
    unwrap(
      await f.client.analyze(
        created.id,
        ready.import.version,
        ready.prepared!.selectionHash,
        "consent-metric",
      ),
    );
    unwrap(await f.ports.runner.runOnce());
    const review = unwrap(await f.client.get(created.id));
    const draft = review.result!.drafts[0]!;
    const question = review.questions[0]!;
    const before = f.calls.length;
    const payload: Omit<MeasurementAnswer, "answerHash"> = {
      questionId: question.id,
      version: question.version,
      mode: "result",
      definitionId: "metric-web-api-latency-p95",
      originalValues: [250],
      originalUnits: ["ms"],
      statistic: "p95",
      context: {
        capabilityId: "web-api",
        taskType: "web-api",
        endpoint: "POST /publish",
        workload: "100 concurrent publishing requests",
        environment: "local benchmark",
        sourceDescription: "Synthetic fictional load-test observation",
      },
      sourceEvidenceIds: [],
      attestation: "user-attested",
    };
    const answered = unwrap(
      await f.client.answerMeasurement({
        importId: created.id,
        questionId: question.id,
        expectedVersion: review.import.version,
        answer: { ...payload, answerHash: measurementAnswerHash(payload) },
      }),
    );
    expect(answered.result?.normalizedValues).toEqual([250]);
    const preview = unwrap(
      await f.ports.measurementService.preview(
        {
          importId: created.id,
          draftId: draft.id,
          measurementResultId: answered.result!.id,
        },
        f.context(),
      ),
    );
    expect(preview.text).toContain("250");
    expect(
      await f.ports.measurementService.preview(
        {
          importId: created.id,
          draftId: draft.id,
          measurementResultId: "wrong-result",
        },
        f.context(),
      ),
    ).toMatchObject({ ok: false, error: { code: "version-conflict" } });
    const edited = unwrap(
      await f.client.updateDraft(
        created.id,
        draft.id,
        answered.version,
        preview.text,
        {
          selectedForSave: true,
          contributionConfirmed: true,
          confirmedMetricResultIds: [answered.result!.id],
        },
      ),
    );
    expect(edited.approvalEligible).toBe(true);
    const current = unwrap(await f.client.get(created.id));
    const saveSpy = vi.spyOn(f.ports.approval, "approveGithubImport");
    const response = await f.client.approve(
      created.id,
      current.import.version,
      [draft.id],
      "approve-metric",
    );
    if (!response.ok)
      throw new Error(JSON.stringify(await saveSpy.mock.results[0]?.value));
    const saved = unwrap(response);
    const library = ResumeLibraryV2Schema.parse(
      JSON.parse(
        await readFile(join(f.root, "data/resume-library.json"), "utf8"),
      ),
    );
    const point = library.projects[0]!.points.find(
      (p) => p.id === saved.savedIds[0],
    )!;
    expect(point.text).toContain("250");
    expect(point.githubEvidence?.confirmedMetrics).toHaveLength(1);
    expect(f.calls).toHaveLength(before);
    expect(f.provider.extractRepositoryAchievements).toHaveBeenCalledTimes(1);
    expect(
      await f.client.updateDraft(
        created.id,
        draft.id,
        current.import.version,
        preview.text,
        { selectedForSave: true, contributionConfirmed: true },
      ),
    ).toMatchObject({ ok: false, error: { code: "version-conflict" } });
  });
  it("fences a late provider result after cancellation and never emits a ready notification", async () => {
    const f = await fixture();
    const created = unwrap(
      await f.client.create({
        source: "personal",
        destinationProjectId: f.projectId,
        scope: f.scope,
      }),
    );
    unwrap(await f.client.prepare(created.id, created.version));
    unwrap(await f.restart().ports.runner.runOnce());
    const ready = unwrap(await f.client.get(created.id));
    f.prepareEvidence(ready.prepared!.evidence);
    let started!: () => void, release!: () => void;
    const startedPromise = new Promise<void>((r) => {
      started = r;
    });
    const releasePromise = new Promise<void>((r) => {
      release = r;
    });
    const original =
      f.provider.extractRepositoryAchievements.getMockImplementation()!;
    f.provider.extractRepositoryAchievements.mockImplementationOnce(
      async () => {
        started();
        await releasePromise;
        return original();
      },
    );
    const job = unwrap(
      await f.client.analyze(
        created.id,
        ready.import.version,
        ready.prepared!.selectionHash,
        "consent-cancel",
      ),
    );
    const running = f.restart().ports.runner.runOnce();
    await startedPromise;
    const cancelled = unwrap(await f.client.cancel(created.id, job.runId));
    release();
    await running;
    expect(cancelled.lifecycle).toBe("cancelled");
    const review = unwrap(await f.client.get(created.id));
    expect(review.result).toBeNull();
    expect(review.import.lifecycle).toBe("cancelled");
    const inbox = unwrap(await f.client.listNotifications());
    expect(inbox.notifications.some((n) => n.type === "ready")).toBe(false);
    expect(f.provider.extractRepositoryAchievements).toHaveBeenCalledTimes(1);
  });
  it("rejects a missing worker, foreign namespace and revoked repository before new work", async () => {
    const f = await fixture();
    f.setAvailable(false);
    const created = unwrap(
      await f.client.create({
        source: "personal",
        destinationProjectId: f.projectId,
        scope: f.scope,
      }),
    );
    expect(await f.client.prepare(created.id, created.version)).toMatchObject({
      ok: false,
      error: { code: "unavailable" },
    });
    expect(f.calls).toEqual([]);
    f.setActor("other-session");
    expect(await f.client.get(created.id)).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
    f.setActor("session-one");
    f.setAuthorized(false);
    expect(await f.client.get(created.id)).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(f.provider.extractRepositoryAchievements).not.toHaveBeenCalled();
  });
});
