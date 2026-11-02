import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { githubImportFixtureScope } from "../../../fixtures/github/gate0";
import { createUnavailableBudgetLedger } from "../../../../src/lib/github/server/unavailable";
import {
  createDeferredMeasurementTaskStore,
  createImportStore,
} from "../../../../src/lib/github/server/store";
import type {
  ExecutionContext,
  ImportCacheIdentity,
  Result,
} from "../../../../src/lib/github/contracts";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((r) => rm(r, { recursive: true, force: true })),
  );
});
function unwrap<T>(r: Result<T>) {
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
}
async function runtime() {
  const root = await mkdtemp(join(tmpdir(), "github-stage-"));
  roots.push(root);
  let time = Date.parse("2026-10-26T12:00:00Z");
  let id = 0;
  const deps = {
    now: () => new Date(time),
    id: () => `record-${++id}`,
    isJobActive: vi.fn(async () => false),
  };
  const context: ExecutionContext = {
    personalRoot: root,
    access: {
      sessionId: "session-one",
      authorizationNamespace: "account-one",
      accountId: "account-one",
      grantedRepositoryIds: [githubImportFixtureScope.repositoryId],
    },
    signal: new AbortController().signal,
    now: deps.now,
    runId: "run-one",
    deadline: new Date(time + 60_000).toISOString(),
    budget: createUnavailableBudgetLedger(),
  };
  const create = {
    source: "personal" as const,
    destinationProjectId: "project-one",
    scope: githubImportFixtureScope,
  };
  const namespace = createHash("sha256").update("account-one").digest("hex");
  return {
    root,
    deps,
    context,
    create,
    store: createImportStore(deps),
    advance: (ms: number) => {
      time += ms;
    },
    file: join(root, "data", "github-imports", `${namespace}.json`),
  };
}
const identity: ImportCacheIdentity = {
  kind: "safe-content",
  repositoryId: githubImportFixtureScope.repositoryId,
  blobSha: createHash("sha1")
    .update("blob 28\0export const enabled = true;")
    .digest("hex"),
  parserVersion: "v1",
  safetyPolicyVersion: "v1",
};
const cacheValue = {
  kind: "safe-content" as const,
  files: [
    {
      fileId: "file-one",
      path: "src/cache.ts",
      blobSha: createHash("sha1")
        .update("blob 28\0export const enabled = true;")
        .digest("hex"),
      content: "export const enabled = true;",
    },
  ],
};

describe("staged GitHub imports", () => {
  it("recovers a dead writer lock while preserving the authoritative record", async () => {
    const r = await runtime();
    const record = unwrap(await r.store.create(r.create, r.context));
    await writeFile(
      `${r.file}.lock`,
      JSON.stringify({ pid: 2147483647, token: "dead-writer" }),
    );
    const kill = vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid === 2147483647)
        throw Object.assign(new Error("process ended"), { code: "ESRCH" });
      return true;
    });
    try {
      expect(
        unwrap(
          await r.store.updateExpectedVersion(
            {
              id: record.id,
              expectedVersion: 1,
              patch: { destinationProjectId: "project-two" },
            },
            r.context,
          ),
        ).version,
      ).toBe(2);
    } finally {
      kill.mockRestore();
    }
  });
  it("persists exact edits after restarting without reading the approved library", async () => {
    const r = await runtime();
    const record = unwrap(await r.store.create(r.create, r.context));
    const updated = unwrap(
      await r.store.updateExpectedVersion(
        {
          id: record.id,
          expectedVersion: 1,
          patch: {
            draftEdits: [
              {
                draftId: "draft-one",
                version: 1,
                text: "Kept my exact wording.",
                baseResultHash: "a".repeat(64),
                selectedForSave: true,
                contributionConfirmed: false,
                confirmedMetricResultIds: [],
                updatedAt: r.deps.now().toISOString(),
              },
            ],
          },
        },
        r.context,
      ),
    );
    expect(
      unwrap(await createImportStore(r.deps).get({ id: record.id }, r.context)),
    ).toEqual(updated);
    expect(await readdir(join(r.root, "data"))).toEqual(["github-imports"]);
  });
  it("allows exactly one concurrent expected-version update", async () => {
    const r = await runtime();
    const record = unwrap(await r.store.create(r.create, r.context));
    const results = await Promise.all(
      ["project-two", "project-three"].map((destinationProjectId) =>
        r.store.updateExpectedVersion(
          {
            id: record.id,
            expectedVersion: 1,
            patch: { destinationProjectId },
          },
          r.context,
        ),
      ),
    );
    expect(results.filter((v) => v.ok)).toHaveLength(1);
    expect(
      results.filter((v) => !v.ok && v.error.code === "version-conflict"),
    ).toHaveLength(1);
  });
  it("preserves the old file if atomic replacement fails", async () => {
    const r = await runtime();
    const record = unwrap(await r.store.create(r.create, r.context));
    const original = await readFile(r.file, "utf8");
    const failing = createImportStore({
      ...r.deps,
      renameFile: async () => {
        throw new Error("synthetic disk failure");
      },
    });
    expect(
      (
        await failing.updateExpectedVersion(
          {
            id: record.id,
            expectedVersion: 1,
            patch: { destinationProjectId: "changed" },
          },
          r.context,
        )
      ).ok,
    ).toBe(false);
    expect(await readFile(r.file, "utf8")).toBe(original);
    expect(
      (await readdir(join(r.root, "data", "github-imports"))).some((p) =>
        p.endsWith(".tmp"),
      ),
    ).toBe(false);
  });
  it("fails honestly on corrupt saved JSON", async () => {
    const r = await runtime();
    const record = unwrap(await r.store.create(r.create, r.context));
    await writeFile(r.file, "{torn");
    expect(await r.store.get({ id: record.id }, r.context)).toMatchObject({
      ok: false,
      error: { code: "io-error" },
    });
    expect(await readFile(r.file, "utf8")).toBe("{torn");
  });
  it("isolates account namespaces and rechecks repository grants", async () => {
    const r = await runtime();
    const record = unwrap(await r.store.create(r.create, r.context));
    expect(
      await r.store.get(
        { id: record.id },
        {
          ...r.context,
          access: {
            ...r.context.access,
            authorizationNamespace: "other-account",
          },
        },
      ),
    ).toMatchObject({ ok: false, error: { code: "not-found" } });
    expect(
      await r.store.get(
        { id: record.id },
        {
          ...r.context,
          access: { ...r.context.access, grantedRepositoryIds: [] },
        },
      ),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });
  it("invalidates consent and old results when the selection changes", async () => {
    const r = await runtime();
    const record = unwrap(await r.store.create(r.create, r.context));
    const changed = unwrap(
      await r.store.updateExpectedVersion(
        {
          id: record.id,
          expectedVersion: 1,
          patch: { selectionHash: "a".repeat(64) },
        },
        r.context,
      ),
    );
    const consented = unwrap(
      await r.store.updateExpectedVersion(
        {
          id: record.id,
          expectedVersion: changed.version,
          patch: {
            consent: {
              reference: "consent-one",
              selectionHash: changed.selectionHash!,
              selectionVersion: changed.selectionVersion,
              consentedAt: r.deps.now().toISOString(),
            },
          },
        },
        r.context,
      ),
    );
    const next = unwrap(
      await r.store.updateExpectedVersion(
        {
          id: record.id,
          expectedVersion: consented.version,
          patch: {
            scope: {
              ...record.scope,
              contributionStatement: "Different implementation scope.",
            },
          },
        },
        r.context,
      ),
    );
    expect(next).toMatchObject({
      consent: null,
      selectionHash: null,
      resultRef: null,
      lifecycle: "created",
    });
    expect(next.selectionVersion).toBe(changed.selectionVersion + 1);
  });
  it("keys cache by policy and namespace and invalidates on disconnect", async () => {
    const r = await runtime();
    unwrap(await r.store.cachePut({ identity, value: cacheValue }, r.context));
    expect(
      unwrap(await r.store.cacheGet({ identity }, r.context)),
    ).not.toBeNull();
    expect(
      unwrap(
        await r.store.cacheGet(
          { identity: { ...identity, safetyPolicyVersion: "v2" } },
          r.context,
        ),
      ),
    ).toBeNull();
    unwrap(
      await r.store.invalidateAuthorizationNamespace(
        { authorizationNamespace: "account-one" },
        r.context,
      ),
    );
    expect(unwrap(await r.store.cacheGet({ identity }, r.context))).toBeNull();
  });
  it("expires stale staging but preserves active job inputs", async () => {
    const r = await runtime();
    const record = unwrap(await r.store.create(r.create, r.context));
    unwrap(
      await r.store.updateExpectedVersion(
        {
          id: record.id,
          expectedVersion: 1,
          patch: { activeRunId: "active-run" },
        },
        r.context,
      ),
    );
    r.advance(86_400_001);
    r.deps.isJobActive.mockResolvedValue(true);
    expect(unwrap(await r.store.expire({}, r.context))).toMatchObject({
      expiredImports: 0,
      preservedActiveImports: 1,
    });
    r.deps.isJobActive.mockResolvedValue(false);
    expect(unwrap(await r.store.expire({}, r.context)).expiredImports).toBe(1);
    expect(
      unwrap(await r.store.get({ id: record.id }, r.context)).lifecycle,
    ).toBe("expired");
  });
  it("bounds cache size and blocks secret-bearing or revision-mismatched content", async () => {
    const r = await runtime();
    const small = createImportStore({ ...r.deps, cacheCapacityBytes: 1 });
    expect(
      await small.cachePut({ identity, value: cacheValue }, r.context),
    ).toMatchObject({ ok: false, error: { code: "limit-exceeded" } });
    expect(
      await r.store.cachePut(
        {
          identity,
          value: {
            ...cacheValue,
            files: [
              {
                ...cacheValue.files[0]!,
                content:
                  "const token = 'ghp_abcdefghijklmnopqrstuvwxyz1234567890ABCD';",
              },
            ],
          },
        },
        r.context,
      ),
    ).toMatchObject({ ok: false, error: { code: "invalid-evidence" } });
  });
  it("rejects generated traversal IDs, linked storage paths and hosted local writes", async () => {
    const r = await runtime();
    expect(
      (
        await createImportStore({ ...r.deps, id: () => "../escape" }).create(
          r.create,
          r.context,
        )
      ).ok,
    ).toBe(false);
    const other = await mkdtemp(join(tmpdir(), "github-outside-"));
    roots.push(other);
    const linkedRoot = await mkdtemp(join(tmpdir(), "github-linked-"));
    roots.push(linkedRoot);
    r.context.personalRoot = linkedRoot;
    await symlink(other, join(linkedRoot, "data"), "junction");
    expect((await r.store.create(r.create, r.context)).ok).toBe(false);
    expect(await readdir(other)).toEqual([]);
    vi.stubEnv("VERCEL", "1");
    expect((await r.store.create(r.create, r.context)).ok).toBe(false);
  });
  it("keeps deferred measurement context separately with an explicit retention policy", async () => {
    const r = await runtime();
    const deferred = createDeferredMeasurementTaskStore(r.deps);
    const task = unwrap(
      await deferred.create(
        {
          projectId: "project-one",
          draftId: "draft-one",
          claimContext: "Measure a verified upload flow later.",
          questionId: "question-one",
          questionVersion: 1,
          definitionIds: ["latency"],
        },
        r.context,
      ),
    );
    r.advance(86_400_001);
    unwrap(await r.store.expire({}, r.context));
    expect(unwrap(await deferred.get({ id: task.id }, r.context))).toEqual(
      task,
    );
    r.advance(30 * 86_400_000);
    expect(unwrap(await deferred.expire({}, r.context)).expired).toBe(1);
  });
});
