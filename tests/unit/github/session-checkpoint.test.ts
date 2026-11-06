import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createSessionCheckpointer,
  shouldSealFileCheckpoint,
} from "@/lib/github/server/session-checkpoint";
import {
  openImportSession,
  sealImportSession,
} from "@/lib/github/server/session-envelope";
import { createSessionMemory } from "@/lib/github/server/session-memory";

function sourceFile(index: number) {
  return Array.from({ length: 200 }, (_, line) => {
    return `export const value_${index}_${line} = ${index * 10_000 + line};`;
  }).join("\n");
}

describe("import session checkpoints", () => {
  it("seals a file checkpoint only after retained bytes double", () => {
    expect(shouldSealFileCheckpoint(0, 0)).toBe(false);
    expect(shouldSealFileCheckpoint(0, 100)).toBe(true);
    expect(shouldSealFileCheckpoint(100, 199)).toBe(false);
    expect(shouldSealFileCheckpoint(100, 200)).toBe(true);
  });

  it("bounds checkpoint bytes and restores completed downloads without another provider read", async () => {
    const uid = "user-checkpoint";
    const memory = createSessionMemory({
      uid,
      id: randomUUID(),
      signal: new AbortController().signal,
    });
    const checkpoints: string[] = [];
    const checkpointer = createSessionCheckpointer(memory, (state) => {
      checkpoints.push(state);
    });
    memory.files["data/github-imports/consent.json"] = JSON.stringify({
      reference: "session-consent",
      selectionHash: "a".repeat(64),
    });
    const downloaded: string[] = [];
    for (let index = 0; index < 18; index += 1) {
      const path = `data/github-imports/file-${index}.ts`;
      memory.files[path] = sourceFile(index);
      downloaded.push(path);
      await checkpointer.checkpointFile();
    }
    const finalEnvelope = sealImportSession(memory);
    memory.files["data/github-imports/unsealed.ts"] = sourceFile(99);
    const transferred = checkpoints.reduce(
      (total, state) => total + state.length,
      0,
    );
    expect(checkpoints.length).toBeGreaterThan(0);
    expect(checkpoints.length).toBeLessThan(downloaded.length);
    expect(transferred).toBeLessThan(finalEnvelope.length * 3);

    const restored = openImportSession(checkpoints.at(-1)!, uid);
    expect(restored.files["data/github-imports/consent.json"]).toContain(
      "session-consent",
    );
    const provider = vi.fn(async (path: string) => `fetched:${path}`);
    async function recover(path: string) {
      const saved = restored.files[path];
      if (saved !== undefined) return saved;
      return provider(path);
    }
    for (const path of Object.keys(restored.files)) {
      expect(await recover(path)).toBe(restored.files[path]);
    }
    expect(provider).not.toHaveBeenCalled();
    expect(restored.files["data/github-imports/unsealed.ts"]).toBeUndefined();
    await recover("data/github-imports/unsealed.ts");
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("still publishes an explicit checkpoint before the byte threshold", async () => {
    const memory = createSessionMemory({
      uid: "user-checkpoint",
      id: randomUUID(),
      signal: new AbortController().signal,
    });
    const checkpoints: string[] = [];
    const checkpointer = createSessionCheckpointer(memory, (state) => {
      checkpoints.push(state);
    });
    memory.files["data/github-imports/consent.json"] = JSON.stringify({
      reference: "session-consent",
    });
    memory.files["data/github-imports/file-0.ts"] = sourceFile(0);
    await checkpointer.checkpointFile();
    memory.files["data/github-imports/note.json"] = JSON.stringify({
      note: "analysis",
    });
    await checkpointer.checkpointFile();
    expect(checkpoints).toHaveLength(1);
    await checkpointer.checkpoint();
    expect(checkpoints).toHaveLength(2);
    const restored = openImportSession(checkpoints[1]!, memory.uid);
    expect(restored.files["data/github-imports/note.json"]).toContain(
      "analysis",
    );
    expect(restored.files["data/github-imports/consent.json"]).toContain(
      "session-consent",
    );
  });
});
