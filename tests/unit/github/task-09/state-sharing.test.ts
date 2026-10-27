import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ path: "", attempts: 0 }));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      if (String(args[0]) === state.path && state.attempts++ < 2)
        throw Object.assign(new Error("sharing"), { code: "EPERM" });
      return actual.lstat(...args);
    },
  };
});
import { readLocalState } from "../../../../src/lib/github/server/local-state";
it("revalidates and retries a transient Windows metadata read failure", async () => {
  vi.stubEnv("VERCEL", "");
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  const root = await mkdtemp(join(tmpdir(), "github-read-sharing-"));
  try {
    state.path = join(root, "state.json");
    await writeFile(state.path, '{"ok":true}');
    expect(await readLocalState(root, state.path, 4096)).toBe('{"ok":true}');
    expect(state.attempts).toBe(3);
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    state.path = "";
    await rm(root, { recursive: true, force: true });
  }
});
