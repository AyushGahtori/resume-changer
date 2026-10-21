import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { getPersonalDataRoot } from "../data/root";
import {
  GenerationHistoryEntrySchema,
  GenerationHistoryEntryFieldsSchema,
  GenerationHistorySchema,
  StableIdSchema,
  type GenerationHistory,
  type GenerationHistoryEntry,
} from "../schemas/resume-data";

const DATA_PATH = "data/generation-history.json";
const MAX_PDF_BYTES = 4 * 1024 * 1024;

const SaveGenerationSchema = GenerationHistoryEntryFieldsSchema.omit({
  texPath: true,
  pdfPath: true,
})
  .extend({
    latex: z.string().min(1).max(150_000),
    pdfBase64: z.string().max(6_000_000).optional(),
  })
  .strict()
  .superRefine((generation, context) => {
    if (generation.status === "compiled" && !generation.pdfBase64) {
      context.addIssue({
        code: "custom",
        path: ["pdfBase64"],
        message: "A compiled generation must include its verified PDF.",
      });
    }
  });

export type SaveGenerationInput = z.input<typeof SaveGenerationSchema>;

export class GenerationHistoryError extends Error {
  constructor(
    readonly code:
      | "invalid-history"
      | "invalid-generation"
      | "locked"
      | "not-found"
      | "io-error",
    message: string,
  ) {
    super(message);
    this.name = "GenerationHistoryError";
  }
}

function getRoot(rootDir?: string) {
  return getPersonalDataRoot(rootDir);
}

function artifactPath(id: string, hash: string, extension: "tex" | "pdf") {
  return `data/generations/${id}-${hash.slice(0, 12)}.${extension}`;
}

function fileForReference(rootDir: string, relativePath: string) {
  const base = resolve(rootDir, "data", "generations");
  const target = resolve(rootDir, relativePath);
  if (!target.startsWith(`${base}/`) && !target.startsWith(`${base}\\`)) {
    throw new GenerationHistoryError(
      "invalid-history",
      "A saved generation contains an unsafe artifact reference.",
    );
  }
  return target;
}

async function readHistory(rootDir: string): Promise<GenerationHistory> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(join(rootDir, DATA_PATH), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { schemaVersion: 1, entries: [] };
    if (error instanceof SyntaxError) {
      throw new GenerationHistoryError(
        "invalid-history",
        "Saved generation history contains invalid JSON. It was left unchanged; repair or remove the file before saving more history.",
      );
    }
    if (error instanceof GenerationHistoryError) throw error;
    throw new GenerationHistoryError(
      "io-error",
      "Saved generation history could not be read.",
    );
  }

  const parsed = GenerationHistorySchema.safeParse(value);
  if (!parsed.success) {
    throw new GenerationHistoryError(
      "invalid-history",
      "Saved generation history does not match its data schema. It was left unchanged.",
    );
  }
  return parsed.data;
}

async function writeAtomic(target: string, contents: string | Uint8Array) {
  const directory = dirname(target);
  const temporary = join(directory, `.generation-${randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true });
  const expected = Buffer.from(contents);
  try {
    if ((await readFile(target)).equals(expected)) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    const file = await open(temporary, "wx");
    try {
      await file.writeFile(contents);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function withHistoryLock<T>(
  rootDir: string,
  operation: () => Promise<T>,
) {
  const lockPath = join(rootDir, `${DATA_PATH}.lock`);
  await mkdir(dirname(lockPath), { recursive: true });
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new GenerationHistoryError(
        "locked",
        "Another generation history update is in progress. Try again shortly.",
      );
    }
    throw new GenerationHistoryError(
      "io-error",
      "Generation history could not be updated.",
    );
  }
  try {
    return await operation();
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

async function writeHistory(rootDir: string, history: GenerationHistory) {
  const checked = GenerationHistorySchema.safeParse(history);
  if (!checked.success) {
    throw new GenerationHistoryError(
      "invalid-generation",
      "The generation history update did not match the required schema.",
    );
  }
  try {
    await writeAtomic(
      join(rootDir, DATA_PATH),
      `${JSON.stringify(checked.data, null, 2)}\n`,
    );
  } catch (error) {
    if (error instanceof GenerationHistoryError) throw error;
    throw new GenerationHistoryError(
      "io-error",
      "Generation history could not be saved. Existing history was preserved.",
    );
  }
}

async function removeOldArtifacts(
  rootDir: string,
  entry: GenerationHistoryEntry | undefined,
  keep: Set<string>,
) {
  for (const reference of [entry?.texPath, entry?.pdfPath]) {
    if (reference && !keep.has(reference)) {
      await rm(fileForReference(rootDir, reference), { force: true }).catch(
        () => undefined,
      );
    }
  }
}

export async function listGenerationHistory(
  options: { rootDir?: string } = {},
) {
  const history = await readHistory(getRoot(options.rootDir));
  return [...history.entries].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export async function getGenerationHistoryItem(
  id: string,
  options: { rootDir?: string } = {},
) {
  const parsedId = StableIdSchema.safeParse(id);
  if (!parsedId.success)
    throw new GenerationHistoryError("not-found", "Generation not found.");
  const rootDir = getRoot(options.rootDir);
  const history = await readHistory(rootDir);
  const entry = history.entries.find((item) => item.id === parsedId.data);
  if (!entry)
    throw new GenerationHistoryError("not-found", "Generation not found.");
  if (!entry.texPath)
    throw new GenerationHistoryError(
      "not-found",
      "LaTeX output is not available.",
    );
  try {
    const latex = await readFile(
      fileForReference(rootDir, entry.texPath),
      "utf8",
    );
    return { entry, latex };
  } catch {
    throw new GenerationHistoryError(
      "io-error",
      "The saved LaTeX file is unavailable. The history entry was preserved.",
    );
  }
}

export async function readGenerationHistoryPdf(
  id: string,
  options: { rootDir?: string } = {},
) {
  const parsedId = StableIdSchema.safeParse(id);
  if (!parsedId.success)
    throw new GenerationHistoryError("not-found", "Generation not found.");
  const rootDir = getRoot(options.rootDir);
  const history = await readHistory(rootDir);
  const entry = history.entries.find((item) => item.id === parsedId.data);
  if (!entry?.pdfPath)
    throw new GenerationHistoryError(
      "not-found",
      "PDF output is not available.",
    );
  try {
    return await readFile(fileForReference(rootDir, entry.pdfPath));
  } catch {
    throw new GenerationHistoryError(
      "io-error",
      "The saved PDF file is unavailable. The history entry was preserved.",
    );
  }
}

export async function saveGenerationHistoryItem(
  input: unknown,
  options: { rootDir?: string } = {},
) {
  const parsed = SaveGenerationSchema.safeParse(input);
  if (!parsed.success) {
    throw new GenerationHistoryError(
      "invalid-generation",
      "The generated resume could not be saved to history because its data is invalid.",
    );
  }
  let pdf: Buffer | undefined;
  if (parsed.data.pdfBase64) {
    pdf = Buffer.from(parsed.data.pdfBase64, "base64");
    if (
      pdf.length > MAX_PDF_BYTES ||
      pdf.subarray(0, 5).toString("ascii") !== "%PDF-" ||
      pdf.toString("base64") !== parsed.data.pdfBase64
    ) {
      throw new GenerationHistoryError(
        "invalid-generation",
        "The generated PDF could not be saved because it is not a valid PDF file.",
      );
    }
  }
  const rootDir = getRoot(options.rootDir);
  return withHistoryLock(rootDir, async () => {
    const history = await readHistory(rootDir);
    const prior = history.entries.find((item) => item.id === parsed.data.id);
    const latexHash = createHash("sha256")
      .update(parsed.data.latex)
      .digest("hex");
    const texPath = artifactPath(parsed.data.id, latexHash, "tex");
    const keep = new Set([texPath]);
    await writeAtomic(fileForReference(rootDir, texPath), parsed.data.latex);

    let pdfPath: string | undefined;
    if (pdf) {
      const pdfHash = createHash("sha256").update(pdf).digest("hex");
      pdfPath = artifactPath(parsed.data.id, pdfHash, "pdf");
      keep.add(pdfPath);
      await writeAtomic(fileForReference(rootDir, pdfPath), pdf);
    }

    const { latex: _latex, pdfBase64: _pdfBase64, ...metadata } = parsed.data;
    const entry = GenerationHistoryEntrySchema.parse({
      ...metadata,
      texPath,
      ...(pdfPath ? { pdfPath } : {}),
    });
    const next: GenerationHistory = {
      schemaVersion: 1,
      entries: [
        entry,
        ...history.entries.filter((item) => item.id !== entry.id),
      ],
    };
    await writeHistory(rootDir, next);
    await removeOldArtifacts(rootDir, prior, keep);
    return entry;
  });
}

export async function deleteGenerationHistoryItem(
  id: string,
  options: { rootDir?: string } = {},
) {
  const parsedId = StableIdSchema.safeParse(id);
  if (!parsedId.success)
    throw new GenerationHistoryError("not-found", "Generation not found.");
  const rootDir = getRoot(options.rootDir);
  return withHistoryLock(rootDir, async () => {
    const history = await readHistory(rootDir);
    const entry = history.entries.find((item) => item.id === parsedId.data);
    if (!entry)
      throw new GenerationHistoryError("not-found", "Generation not found.");
    await writeHistory(rootDir, {
      schemaVersion: 1,
      entries: history.entries.filter((item) => item.id !== parsedId.data),
    });
    await removeOldArtifacts(rootDir, entry, new Set());
    return { deletedId: parsedId.data };
  });
}
