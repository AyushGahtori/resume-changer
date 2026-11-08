import { afterEach, describe, expect, it, vi } from "vitest";

const artifactGate = vi.hoisted(() => ({
  path: null as string | null,
  wait: null as Promise<void> | null,
  held: false,
  entered: null as (() => void) | null,
}));

vi.mock("node:fs/promises", async () => {
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  return {
    ...actual,
    readFile: async (path: string, options?: unknown) => {
      if (
        artifactGate.path &&
        String(path) === artifactGate.path &&
        !artifactGate.held
      ) {
        artifactGate.held = true;
        artifactGate.entered?.();
        if (artifactGate.wait) await artifactGate.wait;
      }
      return actual.readFile(path as never, options as never);
    },
  };
});

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteGenerationHistoryItem,
  GenerationHistoryError,
  getGenerationHistoryItem,
  listGenerationHistory,
  readGenerationHistoryPdf,
  saveGenerationHistoryItem,
} from "../../../src/lib/generation/history-store";

const roots: string[] = [];

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "resume-history-test-"));
  roots.push(root);
  return root;
}

function input(overrides: Record<string, unknown> = {}, pdfBase64?: string) {
  return {
    id: "generation-example-role",
    createdAt: "2026-10-19T12:00:00.000Z",
    company: "Example Systems",
    role: "Platform Engineer",
    selectedAchievementIds: ["achievement-api-reliability"],
    generatedBullets: [
      {
        id: "generated-bullet-1",
        text: "Improved service reliability through queue backpressure.",
        section: "experience",
        sourceAchievementIds: ["achievement-api-reliability"],
      },
    ],
    provider: "gemini",
    status: pdfBase64 ? "compiled" : "drafted",
    repairAttemptCount: 1,
    latex: "\\documentclass{article}\\begin{document}Resume\\end{document}",
    ...(pdfBase64 ? { pdfBase64 } : {}),
    ...overrides,
  };
}

const pdfBase64 = Buffer.from("%PDF-1.4\nresume fixture\n%%EOF").toString(
  "base64",
);

function resetArtifactGate() {
  artifactGate.path = null;
  artifactGate.wait = null;
  artifactGate.held = false;
  artifactGate.entered = null;
}

afterEach(async () => {
  resetArtifactGate();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function holdArtifact(path: string) {
  let release!: () => void;
  let entered!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  artifactGate.path = path;
  artifactGate.wait = wait;
  artifactGate.held = false;
  artifactGate.entered = entered;
  return {
    ready,
    release: () => {
      release();
    },
  };
}

describe("local generation history store", () => {
  it("saves metadata and LaTeX to JSON-backed local history", async () => {
    const rootDir = await temporaryRoot();
    const saved = await saveGenerationHistoryItem(input(), { rootDir });
    const entries = await listGenerationHistory({ rootDir });

    expect(saved).toMatchObject({
      id: "generation-example-role",
      company: "Example Systems",
      role: "Platform Engineer",
      provider: "gemini",
      status: "drafted",
      selectedAchievementIds: ["achievement-api-reliability"],
      repairAttemptCount: 1,
    });
    expect(saved.texPath).toMatch(
      /^data\/generations\/generation-example-role-/,
    );
    expect(entries).toEqual([saved]);
    await expect(
      readFile(join(rootDir, saved.texPath!), "utf8"),
    ).resolves.toContain("\\documentclass");
    await expect(
      readFile(join(rootDir, "data", "generation-history.json"), "utf8"),
    ).resolves.toContain('"schemaVersion": 1');
  });

  it("opens a prior generation and serves its saved PDF", async () => {
    const rootDir = await temporaryRoot();
    const saved = await saveGenerationHistoryItem(input({}, pdfBase64), {
      rootDir,
    });

    await expect(
      getGenerationHistoryItem(saved.id, { rootDir }),
    ).resolves.toMatchObject({
      entry: { id: saved.id, status: "compiled" },
      latex: expect.stringContaining("Resume"),
    });
    await expect(
      readGenerationHistoryPdf(saved.id, { rootDir }),
    ).resolves.toEqual(Buffer.from("%PDF-1.4\nresume fixture\n%%EOF"));
  });

  it("treats missing history as an empty list", async () => {
    await expect(
      listGenerationHistory({ rootDir: await temporaryRoot() }),
    ).resolves.toEqual([]);
  });

  it("does not replace corrupted history when a save is attempted", async () => {
    const rootDir = await temporaryRoot();
    const historyPath = join(rootDir, "data", "generation-history.json");
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(join(rootDir, "data"), { recursive: true }),
    );
    await writeFile(historyPath, "{not-json", "utf8");

    await expect(listGenerationHistory({ rootDir })).rejects.toMatchObject({
      code: "invalid-history",
    });
    await expect(
      saveGenerationHistoryItem(input(), { rootDir }),
    ).rejects.toBeInstanceOf(GenerationHistoryError);
    await expect(readFile(historyPath, "utf8")).resolves.toBe("{not-json");
  });

  it("deletes an entry and its LaTeX/PDF artifacts", async () => {
    const rootDir = await temporaryRoot();
    const saved = await saveGenerationHistoryItem(input({}, pdfBase64), {
      rootDir,
    });
    const texPath = join(rootDir, saved.texPath!);
    const pdfPath = join(rootDir, saved.pdfPath!);

    await expect(
      deleteGenerationHistoryItem(saved.id, { rootDir }),
    ).resolves.toEqual({ deletedId: saved.id });
    await expect(listGenerationHistory({ rootDir })).resolves.toEqual([]);
    await expect(readFile(texPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(pdfPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      getGenerationHistoryItem(saved.id, { rootDir }),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("returns the replacement LaTeX when a save removes the file mid-read", async () => {
    const rootDir = await temporaryRoot();
    const saved = await saveGenerationHistoryItem(input(), { rootDir });
    const hold = await holdArtifact(join(rootDir, saved.texPath!));
    const pending = getGenerationHistoryItem(saved.id, { rootDir });
    try {
      await hold.ready;
      const updatedLatex =
        "\\documentclass{article}\\begin{document}Updated resume\\end{document}";
      const updated = await saveGenerationHistoryItem(
        input({ latex: updatedLatex }),
        { rootDir },
      );
      hold.release();
      await expect(pending).resolves.toMatchObject({
        entry: { id: saved.id, texPath: updated.texPath },
        latex: updatedLatex,
      });
    } finally {
      hold.release();
    }
  });

  it("returns the replacement PDF when a save removes the file mid-read", async () => {
    const rootDir = await temporaryRoot();
    const saved = await saveGenerationHistoryItem(input({}, pdfBase64), {
      rootDir,
    });
    const nextPdf = Buffer.from("%PDF-1.4\nupdated fixture\n%%EOF");
    const hold = await holdArtifact(join(rootDir, saved.pdfPath!));
    const pending = readGenerationHistoryPdf(saved.id, { rootDir });
    try {
      await hold.ready;
      await saveGenerationHistoryItem(input({}, nextPdf.toString("base64")), {
        rootDir,
      });
      hold.release();
      await expect(pending).resolves.toEqual(nextPdf);
    } finally {
      hold.release();
    }
  });

  it("rejects compiled entries without a valid PDF", async () => {
    const rootDir = await temporaryRoot();
    await expect(
      saveGenerationHistoryItem(input({ status: "compiled" }), { rootDir }),
    ).rejects.toMatchObject({ code: "invalid-generation" });
    await expect(listGenerationHistory({ rootDir })).resolves.toEqual([]);
  });
});
