import { createHash } from "node:crypto";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createInspectionRun,
  createSelectorBudget,
  createTransportBudget,
  preparedSelectionForStore,
} from "../../../src/lib/github/server/phase-one";
import { createImportStore } from "../../../src/lib/github/server/store";
import { createJobStore } from "../../../src/lib/github/server/jobs/store";
import { createUnavailableBudgetLedger } from "../../../src/lib/github/server/unavailable";
import type {
  ExecutionContext,
  RepositoryScope as SharedScope,
  Result,
} from "../../../src/lib/github/contracts";
import {
  deriveMeasurementResult,
  renderMetricClause,
} from "../../../src/lib/github/measurements";
import { MetricSchema } from "../../../src/lib/schemas/resume-data";

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
import { createBudgetLedger } from "../../../src/lib/github/server/budget";
import {
  createGithubClient,
  type GithubFetch,
} from "../../../src/lib/github/server/client";

const now = () => Date.parse("2026-10-26T12:00:00Z");
const commit = "a".repeat(40),
  tree = "c".repeat(40);
const files: Record<string, string> = {
  "README.md": "# Fictional cache\nA bounded cache for a dashboard.\n",
  "src/cache.ts":
    "export function lookup(key: string) {\n  if (!key) throw new Error('Missing key');\n  return key;\n}\n",
  "tests/cache.test.ts":
    "it('rejects missing keys', () => { expect(() => lookup('')).toThrow(); });\n",
};
const blob = (text: string) =>
  createHash("sha1")
    .update(`blob ${Buffer.byteLength(text)}\0`)
    .update(text)
    .digest("hex");
function setup(
  options: {
    authorized?: boolean;
    corruptBlob?: boolean;
    redirectPrs?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const fetch: GithubFetch = async (url) => {
    calls.push(url.pathname);
    if (url.pathname === "/repos/example/cache")
      return Response.json({
        id: 42,
        name: "cache",
        full_name: "example/cache",
        owner: { login: "example" },
        default_branch: "main",
        private: false,
        visibility: "public",
      });
    if (url.pathname.includes("/commits/"))
      return Response.json({ sha: commit, commit: { tree: { sha: tree } } });
    if (url.pathname.includes("/git/trees/"))
      return Response.json({
        sha: tree,
        truncated: false,
        tree: Object.entries(files).map(([path, text]) => ({
          path,
          sha: blob(text),
          mode: "100644",
          type: "blob",
          size: Buffer.byteLength(text),
        })),
      });
    if (url.pathname.includes("/pulls/")) {
      if (options.redirectPrs)
        return new Response(null, {
          status: 307,
          headers: { location: url.toString() },
        });
      if (url.pathname.endsWith("/files"))
        return Response.json([
          {
            filename: "src/cache.ts",
            status: "modified",
            additions: 4,
            deletions: 1,
          },
        ]);
      return Response.json({
        id: 17,
        number: 17,
        title: "Add guarded dashboard cache",
        state: "closed",
        merged: true,
        merged_at: "2026-10-25T10:00:00Z",
        user: { id: 2, login: "example" },
        base: {
          ref: "main",
          sha: commit,
          repo: {
            id: 42,
            name: "cache",
            full_name: "example/cache",
            owner: { login: "example" },
          },
        },
        head: {
          ref: "cache",
          sha: commit,
          repo: {
            id: 42,
            name: "cache",
            full_name: "example/cache",
            owner: { login: "example" },
          },
        },
      });
    }
    if (url.pathname.includes("/git/blobs/")) {
      const sha = url.pathname.split("/").at(-1);
      const text = Object.values(files).find((t) => blob(t) === sha);
      return new Response(
        options.corruptBlob ? "wrong revision" : (text ?? ""),
        { status: text ? 200 : 404 },
      );
    }
    return new Response(null, { status: 404 });
  };
  const run = createInspectionRun({
    runId: "integration-run",
    now,
    authorizeRepository: vi.fn(async () => options.authorized !== false),
    transport: {
      fetch,
      resolveAddresses: async () => ["140.82.112.6"],
      credentials: { getAccessToken: async () => null },
    },
  });
  const scope = {
    repositoryId: "42",
    owner: "example",
    name: "cache",
    canonicalUrl: "https://github.com/example/cache",
    fullSha: commit,
    selectedPaths: ["src/cache.ts", "tests/cache.test.ts"],
    selectedPrNumbers: [17],
    contributionStatement:
      "I added guarded cache lookups and regression tests.",
    role: "backend engineer",
  };
  return { run, scope, calls };
}

describe("phase one real foundation composition", () => {
  it("persists real inspection output and reconciles a durable preparation job without approving library points", async () => {
    const root = await mkdtemp(join(tmpdir(), "github-gate-a-"));
    try {
      const r = setup();
      const inspected = await r.run.prepare({ scope: r.scope });
      if (!inspected.ok) throw new Error(inspected.error.code);
      const scope: SharedScope = {
        ...r.scope,
        canonicalUrl: r.scope.canonicalUrl,
        commitSha: commit,
        visibility: "public",
        ref: "main",
        selectedPullRequestNumbers: [17],
        identitySource: "user-provided",
      };
      delete (scope as unknown as Record<string, unknown>).fullSha;
      delete (scope as unknown as Record<string, unknown>).selectedPrNumbers;
      delete (scope as unknown as Record<string, unknown>).role;
      const context: ExecutionContext = {
        personalRoot: root,
        access: {
          sessionId: "one",
          authorizationNamespace: "one",
          accountId: "one",
          grantedRepositoryIds: ["42"],
        },
        signal: new AbortController().signal,
        now: () => new Date(now()),
        runId: "run-one",
        deadline: new Date(now() + 60_000).toISOString(),
        budget: createUnavailableBudgetLedger(),
      };
      let id = 0;
      const jobs = createJobStore({
        rootDir: root,
        clock: { now: context.now },
        createId: () => `job-${++id}`,
      });
      const deps = {
        now: context.now,
        id: () => `import-${++id}`,
        isJobActive: jobs.isImportRunActive,
      };
      const store = createImportStore(deps);
      const record = unwrap(
        await store.create(
          { source: "personal", destinationProjectId: "project-one", scope },
          context,
        ),
      );
      const prepared = preparedSelectionForStore({
        importId: record.id,
        version: 1,
        scope,
        prepared: inspected.value.prepared,
        ledger: r.run.ledger,
      });
      const cacheIdentity = {
        kind: "selected-bundle" as const,
        repositoryId: "42",
        commitSha: commit,
        sourceHashes: [...new Set(prepared.evidence.map((e) => e.blobSha))],
        selectedFileIds: prepared.selectedFileIds,
        selectionHash: prepared.selectionHash,
        scope,
        contributionContextHash: "a".repeat(64),
        selectorVersion: "v1",
        safetyPolicyVersion: "v1",
      };
      const cached = unwrap(
        await store.cachePut(
          {
            identity: cacheIdentity,
            value: { kind: "selected-bundle", prepared },
          },
          context,
        ),
      );
      const selected = unwrap(
        await store.updateExpectedVersion(
          {
            id: record.id,
            expectedVersion: 1,
            patch: { selectionHash: prepared.selectionHash },
          },
          context,
        ),
      );
      const queued = unwrap(
        await jobs.enqueue({
          idempotencyKey: "prepare-once",
          importId: record.id,
          projectId: "project-one",
          importVersion: selected.version,
          selectionVersion: selected.selectionVersion,
          selectionHash: prepared.selectionHash,
          inputHash: prepared.selectionHash,
          kind: "prepare",
          initialAllowance: { httpAttempts: 32 },
          deadlineAt: context.deadline,
        }),
      );
      unwrap(
        await store.updateExpectedVersion(
          {
            id: record.id,
            expectedVersion: selected.version,
            patch: {
              preparedSelectionRef: cached.key,
              activeRunId: queued.runId,
            },
          },
          context,
        ),
      );
      expect(
        await jobs.isImportRunActive({
          importId: record.id,
          runId: queued.runId,
        }),
      ).toBe(true);
      const claimed = unwrap(await jobs.claim({ workerId: "worker-one" }));
      if (!claimed) throw new Error("Job missing");
      unwrap(
        await jobs.completeWithEvent({
          jobId: claimed.id,
          workerId: "worker-one",
          fence: claimed.executionFence,
          resultRef: cached.key,
          eventType: "needs-input",
        }),
      );
      expect(
        await jobs.isImportRunActive({
          importId: record.id,
          runId: queued.runId,
        }),
      ).toBe(false);
      const notifications = unwrap(await jobs.listNotifications());
      expect(notifications).toHaveLength(1);
      expect(notifications[0]!.destination).toBe(
        `/library/github/${record.id}`,
      );
      const reopened = createImportStore(deps);
      expect(
        unwrap(await reopened.cacheGet({ identity: cacheIdentity }, context))
          ?.value,
      ).toEqual({ kind: "selected-bundle", prepared });
      expect(await readdir(join(root, "data"))).toEqual(
        expect.arrayContaining(["github-jobs", "github-imports"]),
      );
      expect(await readdir(root)).toEqual(["data"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("renders a measured result into a valid library metric while excluding targets", () => {
    const context = {
      taskType: "web-publishing",
      startEvent: "click",
      endEvent: "confirmation",
      workload: "1 MB upload",
      environment: "controlled lab",
    };
    const result = deriveMeasurementResult({
      definitionId: "web.publish-latency.p95",
      mode: "comparison",
      status: "measured",
      baseline: {
        value: 400,
        unit: "ms",
        statistic: "p95",
        averagingMode: "none",
        context,
      },
      comparison: {
        value: 200,
        unit: "ms",
        statistic: "p95",
        averagingMode: "none",
        context,
      },
      evidence: { sourceDescription: "Fictional measured report 24" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rendered = renderMetricClause(result.value);
    expect(rendered.kind).toBe("metric-candidate");
    if (rendered.kind === "metric-candidate")
      expect(
        MetricSchema.safeParse({ id: "metric-one", ...rendered.metricDraft })
          .success,
      ).toBe(true);
    const target = deriveMeasurementResult({
      definitionId: "web.publish-latency.p95",
      mode: "target",
      status: "target",
      observation: {
        value: 200,
        unit: "ms",
        statistic: "p95",
        averagingMode: "none",
        context,
      },
    });
    expect(target.ok).toBe(true);
    if (target.ok)
      expect(renderMetricClause(target.value).kind).toBe("review-note");
  });
  it("inspects a pinned revision through transport, inventory, PRs, selector and one shared ledger", async () => {
    const r = setup();
    const result = await r.run.prepare({ scope: r.scope });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.value.prepared.evidence.some((e) => e.path === "src/cache.ts"),
    ).toBe(true);
    expect(
      result.value.prepared.evidence.some(
        (e) => e.path === "tests/cache.test.ts",
      ),
    ).toBe(true);
    expect(
      result.value.prepared.evidence.every((e) => e.fullSha === commit),
    ).toBe(true);
    expect(r.run.ledger.remaining().httpAttempts.used).toBe(r.calls.length);
    expect(r.run.ledger.remaining().prHttpAttempts.used).toBe(2);
    expect(r.run.ledger.remaining().fetchedBodies.used).toBeGreaterThan(0);
    expect(r.run.ledger.remaining().generationAttempts.used).toBe(0);
    expect(result.value.prContext.attribution).toBe("unconfirmed");
  });
  it("performs zero upstream reads when access is removed", async () => {
    const r = setup({ authorized: false });
    expect(await r.run.prepare({ scope: r.scope })).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(r.calls).toEqual([]);
  });
  it("rejects bodies whose Git blob differs from the inventory", async () => {
    const r = setup({ corruptBlob: true });
    const result = await r.run.prepare({ scope: r.scope });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.prepared.evidence).toEqual([]);
      expect(result.value.prepared.completeness).not.toBe("complete");
    }
  });
  it("charges every PR redirect before sending and stops at the shared sub-budget", async () => {
    const r = setup({ redirectPrs: true });
    await r.run.prepare({
      scope: { ...r.scope, selectedPrNumbers: [17, 18, 19] },
    });
    expect(
      r.calls.filter((p) => p.includes("/pulls/")).length,
    ).toBeLessThanOrEqual(8);
    expect(r.run.ledger.remaining().prHttpAttempts.used).toBe(
      r.calls.filter((p) => p.includes("/pulls/")).length,
    );
  });
  it("connects selector admission to actual ledger limits without spending generation attempts", async () => {
    const ledger = createBudgetLedger({ now });
    const selector = createSelectorBudget(ledger);
    const result = await selector.checkSelection({
      runId: "one",
      requestKind: "initial",
      files: Array.from({ length: 13 }, (_, i) => ({
        fileId: `file-${i}`,
        path: `${i}.ts`,
        blobSha: commit,
        ranges: [{ lineStart: 1, lineEnd: 1 }],
        bytes: 1,
        characters: 1,
        transmitted: false,
      })),
      uniqueLineCount: 13,
      transmittedLineCount: 13,
      totalCharacters: 13,
      prContextCharacters: 0,
      contextCharacters: 0,
      estimatedSourceTokens: 13,
      estimatedPrContextTokens: 0,
      estimatedInputTokens: 13,
      totalFetchedBytes: 13,
    });
    expect(result.ok).toBe(false);
    expect(ledger.remaining().generationAttempts.used).toBe(0);
  });
  it("stops raw file streaming at the per-file limit and retains charged usage", async () => {
    const ledger = createBudgetLedger({ now });
    const bridge = createTransportBudget(ledger);
    const fetch = vi.fn(async () => new Response("a".repeat(70_000)));
    const client = createGithubClient({
      fetch,
      resolveAddresses: async () => ["140.82.112.6"],
      credentials: { getAccessToken: async () => null },
      ledger: bridge.transport,
      onAttemptSettled: bridge.settled,
      now,
    });
    const result = await client.getText({
      path: "/repos/example/cache/git/blobs/" + commit,
      responseByteLimit: 65_536,
      context: {
        runId: "bounded-file",
        deadline: now() + 60_000,
        signal: new AbortController().signal,
        fetchedBody: { fileId: "one", decodedBytes: 65_536 },
      },
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "limit-exceeded" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(ledger.remaining().httpAttempts.used).toBe(1);
  });
});
