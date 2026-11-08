import { createHash, randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GITHUB_IMPORT_POLICY } from "@/lib/github/contracts";
import type {
  ExecutionContext,
  ImportCacheIdentity,
} from "@/lib/github/contracts";
import { githubImportFixtureScope } from "../../fixtures/github/gate0";
import { createUnavailableBudgetLedger } from "@/lib/github/server/unavailable";
import { createImportStore } from "@/lib/github/server/store";
import {
  createSessionMemory,
  withImportSession,
} from "@/lib/github/server/session-memory";

function blobSha(content: string) {
  return createHash("sha1")
    .update(`blob ${Buffer.byteLength(content)}\0`)
    .update(content)
    .digest("hex");
}

function safeContent(path: string, fileId: string, content: string) {
  const sha = blobSha(content);
  const identity: ImportCacheIdentity = {
    kind: "safe-content",
    repositoryId: githubImportFixtureScope.repositoryId,
    blobSha: sha,
    parserVersion: "github-source-text-v1",
    safetyPolicyVersion: "github-file-safety-v1",
  };
  return {
    identity,
    value: {
      kind: "safe-content" as const,
      files: [{ fileId, path, blobSha: sha, content }],
    },
  };
}

describe("selected file cache writes", () => {
  it("does not rewrite an unchanged cache entry and still updates a same-hash alias", async () => {
    const root = await mkdtemp(join(tmpdir(), "github-cache-"));
    let time = Date.parse("2026-10-26T12:00:00.000Z");
    const deps = {
      now: () => new Date(time),
      id: () => "record-1",
      isJobActive: async () => false,
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
    const memory = createSessionMemory({
      uid: "account-one",
      id: randomUUID(),
      signal: context.signal,
    });
    let writes = 0;
    const write = memory.storage.write.bind(memory.storage);
    memory.storage.write = async (personalRoot, target, text) => {
      writes += 1;
      await write(personalRoot, target, text);
    };
    const store = createImportStore(deps);
    const original = safeContent(
      "src/cache.ts",
      "file-one",
      "export const enabled = true;",
    );
    const consent = {
      reference: "session-consent",
      selectionHash: "a".repeat(64),
    };

    await withImportSession(memory, async () => {
      memory.files["data/github-imports/consent.json"] =
        JSON.stringify(consent);
      expect((await store.cachePut(original, context)).ok).toBe(true);
      const afterFirst = writes;
      expect(
        (await store.cacheGet({ identity: original.identity }, context)).ok,
      ).toBe(true);
      expect((await store.cachePut(original, context)).ok).toBe(true);
      expect(writes).toBe(afterFirst);

      const alias = safeContent(
        "src/alias.ts",
        "file-alias",
        "export const enabled = true;",
      );
      expect((await store.cachePut(alias, context)).ok).toBe(true);
      expect(writes).toBe(afterFirst + 1);
      const stored = await store.cacheGet(
        { identity: alias.identity },
        context,
      );
      expect(stored.ok).toBe(true);
      if (!stored.ok || stored.value?.value.kind !== "safe-content") return;
      expect(stored.value.value.files[0]?.path).toBe("src/alias.ts");

      const revoked = {
        ...context,
        access: { ...context.access, grantedRepositoryIds: [] },
      };
      const denied = await store.cachePut(original, revoked);
      expect(denied.ok).toBe(false);
      if (!denied.ok) expect(denied.error.code).toBe("forbidden");
      expect(writes).toBe(afterFirst + 1);

      const secret = 'export const key = "AKIAIOSFODNN7EXAMPLE";';
      const unsafe = safeContent("src/secret.ts", "file-secret", secret);
      const screened = await store.cachePut(unsafe, context);
      expect(screened.ok).toBe(false);
      if (!screened.ok) expect(screened.error.code).toBe("invalid-evidence");
      expect(writes).toBe(afterFirst + 1);

      time += GITHUB_IMPORT_POLICY.stageRetentionMs + 1_000;
      expect((await store.cachePut(alias, context)).ok).toBe(true);
      expect(writes).toBe(afterFirst + 2);
      expect(memory.files["data/github-imports/consent.json"]).toContain(
        "session-consent",
      );
    });
  });
});
