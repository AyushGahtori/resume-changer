import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  createSessionMemory,
  currentImportSession,
  withImportSession,
  SESSION_BYTES,
} from "../../../src/lib/github/server/session-memory";
import {
  sealImportSession,
  openImportSession,
} from "../../../src/lib/github/server/session-envelope";
import { writeState, readState } from "../../../src/lib/github/server/state";
const root = resolve("fictional-root"),
  path = join(root, "data/github-imports/cache.json");
const memory = (uid = "alice") =>
  createSessionMemory({
    uid,
    id: randomUUID(),
    signal: new AbortController().signal,
  });
afterEach(() => vi.unstubAllEnvs());
it("isolates concurrent request memory and never writes the filesystem", async () => {
  const a = memory(),
    b = memory("bob");
  await Promise.all(
    [a, b].map((m) =>
      withImportSession(m, async () => {
        await writeState(root, path, m.uid);
        await Promise.resolve();
        expect(currentImportSession()).toBe(m);
        expect(await readState(root, path, 100)).toBe(m.uid);
      }),
    ),
  );
  expect(currentImportSession()).toBeUndefined();
});
it("serializes mutations without losing writes and rejects escaping/oversize state", async () => {
  const m = memory();
  await m.storage.write(root, path, "0");
  await Promise.all(
    Array.from({ length: 10 }, () =>
      m.storage.withLock(root, path, async () => {
        const old = Number(await m.storage.read(root, path, 100));
        await Promise.resolve();
        await m.storage.write(root, path, String(old + 1));
      }),
    ),
  );
  expect(await m.storage.read(root, path, 100)).toBe("10");
  await expect(
    m.storage.write(root, join(root, "../escape"), "bad"),
  ).rejects.toThrow();
  await expect(
    m.storage.write(root, path, "x".repeat(SESSION_BYTES + 1)),
  ).rejects.toThrow();
});
it("authenticates, encrypts and expires tab state with account and purpose binding", () => {
  vi.stubEnv("GITHUB_VAULT_KEY", Buffer.alloc(32, 7).toString("base64"));
  const m = memory();
  m.files["data/github-imports/cache.json"] = "private source text";
  const now = Date.now(),
    token = sealImportSession(m, now);
  expect(token).not.toContain("private source");
  expect(openImportSession(token, "alice", now).files).toEqual(m.files);
  // Separate function instances can have slightly different clocks.
  expect(
    openImportSession(sealImportSession(m, now + 1_000), "alice", now).id,
  ).toBe(m.id);
  expect(() => openImportSession(token, "bob", now)).toThrow();
  expect(() => openImportSession(token, "alice", now + 20 * 60000)).toThrow();
  const damaged =
    token.slice(0, 40) + (token[40] === "a" ? "b" : "a") + token.slice(41);
  expect(() => openImportSession(damaged, "alice", now)).toThrow();
  vi.stubEnv("GITHUB_VAULT_KEY", Buffer.alloc(32, 8).toString("base64"));
  expect(() => openImportSession(token, "alice", now)).toThrow();
});
it("fails closed when the hosted integrity key is missing or malformed", () => {
  vi.stubEnv("RESUME_APP_MODE", "firebase");
  vi.stubEnv("GITHUB_VAULT_KEY", "");
  expect(() => sealImportSession(memory())).toThrow();
  vi.stubEnv("GITHUB_VAULT_KEY", "bad");
  expect(() => sealImportSession(memory())).toThrow();
});
