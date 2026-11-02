import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readLocalState } from "../../../../src/lib/github/server/local-state";

const shortReads = vi.hoisted(() => ({ path: "", truncate: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (String(args[0]) !== shortReads.path) return handle;
      return {
        stat: () => handle.stat(),
        close: () => handle.close(),
        read: async (
          buffer: Buffer,
          offset: number,
          length: number,
          position: number,
        ) =>
          shortReads.truncate && position >= 7
            ? { bytesRead: 0, buffer }
            : handle.read(buffer, offset, Math.min(length, 7), position),
      };
    },
  };
});
let root: string | undefined;
afterEach(async () => {
  shortReads.path = "";
  shortReads.truncate = false;
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
  vi.unstubAllEnvs();
});
describe("bounded staged-state reads", () => {
  it("assembles legal short filesystem reads before parsing persisted JSON", async () => {
    vi.stubEnv("VERCEL", "");
    root = await mkdtemp(join(tmpdir(), "github-short-read-"));
    const path = join(root, "state.json");
    const text = JSON.stringify({
      drafts: ["Keep all original evidence and wording"],
      version: 17,
    });
    await writeFile(path, text);
    shortReads.path = path;
    expect(await readLocalState(root, path, 4096)).toBe(text);
  });
  it("rejects a truncated file rather than returning a partial document", async () => {
    vi.stubEnv("VERCEL", "");
    root = await mkdtemp(join(tmpdir(), "github-short-read-"));
    const path = join(root, "state.json");
    await writeFile(path, JSON.stringify({ version: 17 }));
    shortReads.path = path;
    shortReads.truncate = true;
    await expect(readLocalState(root, path, 4096)).rejects.toThrow(
      /changed during read/,
    );
  });
});
