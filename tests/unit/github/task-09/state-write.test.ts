import {
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { writeLocalState } from "../../../../src/lib/github/server/local-state";

let root: string | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});
it("retries transient Windows sharing failures without removing original state", async () => {
  vi.stubEnv("VERCEL", "");
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  root = await mkdtemp(join(tmpdir(), "github-atomic-write-"));
  const target = join(root, "state.json");
  await writeFile(target, "original");
  let calls = 0;
  await writeLocalState(root, target, "replacement", async (from, to) => {
    calls++;
    if (calls < 3) {
      expect(await readFile(target, "utf8")).toBe("original");
      throw Object.assign(new Error("sharing violation"), { code: "EPERM" });
    }
    await rename(from, to);
  });
  expect(calls).toBe(3);
  expect(await readFile(target, "utf8")).toBe("replacement");
  expect(await readdir(root)).toEqual(["state.json"]);
});
it("bounds replacement retries and preserves existing state on permanent failure", async () => {
  vi.stubEnv("VERCEL", "");
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  root = await mkdtemp(join(tmpdir(), "github-atomic-write-"));
  const target = join(root, "state.json");
  await writeFile(target, "original");
  let calls = 0;
  await expect(
    writeLocalState(root, target, "replacement", async () => {
      calls++;
      throw Object.assign(new Error("sharing violation"), { code: "EPERM" });
    }),
  ).rejects.toThrow("sharing violation");
  expect(calls).toBe(8);
  expect(await readFile(target, "utf8")).toBe("original");
  expect(await readdir(root)).toEqual(["state.json"]);
});
