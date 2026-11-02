import { afterEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  usage: vi.fn().mockResolvedValue(undefined),
  queue: Promise.resolve() as Promise<unknown>,
}));
vi.mock("../../../src/lib/cloud/usage", () => ({
  consumeAccountUsage: fixture.usage,
}));
vi.mock("../../../src/lib/github/server/hosted/admin", () => ({
  hostedAdmin: () => ({
    namespace: "synthetic",
    db: {
      collection: () => ({
        doc: (key: string) => ({
          key,
          update: async (patch: Record<string, unknown>) => {
            const doc = fixture.docs.get(key)!;
            for (const [path, v] of Object.entries(patch)) {
              const [, id] = path.split(".");
              (doc.receipts as Record<string, { state: unknown }>)[id].state =
                v;
            }
          },
        }),
      }),
      runTransaction: (work: (tx: unknown) => Promise<unknown>) => {
        const result = fixture.queue
          .catch(() => {})
          .then(() =>
            work({
              get: async (ref: { key: string }) => ({
                data: () => fixture.docs.get(ref.key),
              }),
              set: (ref: { key: string }, data: Record<string, unknown>) =>
                fixture.docs.set(ref.key, data),
            }),
          );
        fixture.queue = result;
        return result;
      },
    },
  }),
}));
import { claimSessionOperation } from "../../../src/lib/github/server/session-operations";
afterEach(() => {
  fixture.docs.clear();
  fixture.usage.mockReset().mockResolvedValue(undefined);
  vi.unstubAllEnvs();
});
it("atomically rejects concurrent duplicate AI admissions and stores only bounded identifiers/outcomes", async () => {
  vi.stubEnv("RESUME_APP_MODE", "firebase");
  const results = await Promise.allSettled([
    claimSessionOperation("alice", "tab", "consent", "ai"),
    claimSessionOperation("alice", "tab", "consent", "ai"),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(fixture.usage).toHaveBeenCalledTimes(1);
  const accepted = results.find(
    (r) => r.status === "fulfilled",
  )! as PromiseFulfilledResult<() => Promise<void>>;
  await accepted.value();
  const encoded = JSON.stringify([...fixture.docs]);
  expect(encoded).not.toContain("alice");
  expect(encoded).not.toContain("consent");
  expect(encoded).toContain("finished");
  await expect(
    claimSessionOperation("alice", "tab", "consent", "ai"),
  ).rejects.toThrow(/already submitted/);
  await claimSessionOperation("bob", "tab", "consent", "ai");
  expect(fixture.docs.size).toBe(2);
});
it("keeps an uncertain admission fenced when quota recording or the caller fails", async () => {
  vi.stubEnv("RESUME_APP_MODE", "firebase");
  fixture.usage.mockRejectedValueOnce(new Error("quota unavailable"));
  await expect(
    claimSessionOperation("alice", "tab", "consent", "ai"),
  ).rejects.toThrow();
  await expect(
    claimSessionOperation("alice", "tab", "consent", "ai"),
  ).rejects.toThrow(/already submitted/);
  expect(fixture.usage).toHaveBeenCalledTimes(1);
});
it("bounds receipts to sixty per account and prunes expired entries before admission", async () => {
  vi.stubEnv("RESUME_APP_MODE", "firebase");
  for (let i = 0; i < 60; i++)
    await claimSessionOperation("alice", "tab", String(i), "files");
  await expect(
    claimSessionOperation("alice", "tab", "overflow", "files"),
  ).rejects.toThrow(/daily operation limit/);
  const record = [...fixture.docs.values()][0];
  for (const receipt of Object.values(
    record.receipts as Record<string, { expiresAt: number }>,
  ))
    receipt.expiresAt = 0;
  await claimSessionOperation("alice", "tab", "fresh", "files");
  expect(Object.keys(record.receipts as object).length).toBeLessThanOrEqual(60);
  expect(
    Object.keys([...fixture.docs.values()][0].receipts as object),
  ).toHaveLength(1);
});
