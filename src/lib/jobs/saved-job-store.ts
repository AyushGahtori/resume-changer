import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { getAppMode } from "../cloud/security";
import { getPersonalDataRoot } from "../data/root";
import { StableIdSchema } from "../schemas/resume-data";
import { SavedJobError } from "./saved-job-error";
import { nextSavedJob, savedJobByteLength } from "./saved-job-record";
import {
  MAX_SAVED_JOB_BYTES,
  SAVED_JOBS_DATA_PATH,
  SavedJobRecordSchema,
  savedJobSummary,
  type SavedJobRecord,
  type SavedJobSummary,
} from "./saved-job";

const FileSchema = z
  .object({
    schemaVersion: z.literal(1),
    entries: z.array(z.unknown()),
  })
  .strict();

type SavedJobFile = {
  records: SavedJobRecord[];
  preserved: unknown[];
};

export { SavedJobError };

function rootFor(rootDir?: string) {
  return getPersonalDataRoot(rootDir);
}

function emptyFile(): SavedJobFile {
  return { records: [], preserved: [] };
}

async function readFileState(rootDir: string): Promise<SavedJobFile> {
  let value: unknown;
  try {
    value = JSON.parse(
      await readFile(join(rootDir, SAVED_JOBS_DATA_PATH), "utf8"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyFile();
    if (error instanceof SyntaxError) {
      throw new SavedJobError(
        "unavailable",
        "Saved job analyses contain invalid JSON. They were left unchanged.",
      );
    }
    throw new SavedJobError(
      "unavailable",
      "Saved job analyses could not be read.",
    );
  }

  const parsed = FileSchema.safeParse(value);
  if (!parsed.success) {
    throw new SavedJobError(
      "unavailable",
      "Saved job analyses do not match the expected file. They were left unchanged.",
    );
  }

  const records: SavedJobRecord[] = [];
  const preserved: unknown[] = [];
  for (const entry of parsed.data.entries) {
    const record = SavedJobRecordSchema.safeParse(entry);
    if (
      !record.success ||
      savedJobByteLength(record.data) > MAX_SAVED_JOB_BYTES
    ) {
      preserved.push(entry);
      continue;
    }
    records.push(record.data);
  }
  return { records, preserved };
}

async function writeAtomic(target: string, contents: string) {
  const temporary = join(dirname(target), `.saved-job-${randomUUID()}.tmp`);
  await mkdir(dirname(target), { recursive: true });
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

async function withLock<T>(rootDir: string, operation: () => Promise<T>) {
  const lockPath = join(rootDir, `${SAVED_JOBS_DATA_PATH}.lock`);
  await mkdir(dirname(lockPath), { recursive: true });
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new SavedJobError(
        "locked",
        "Another saved job update is in progress. Try again shortly.",
      );
    }
    throw new SavedJobError(
      "unavailable",
      "Saved job analyses could not be updated.",
    );
  }
  try {
    return await operation();
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

async function writeFileState(rootDir: string, state: SavedJobFile) {
  const entries = [...state.records, ...state.preserved];
  await writeAtomic(
    join(rootDir, SAVED_JOBS_DATA_PATH),
    `${JSON.stringify({ schemaVersion: 1, entries }, null, 2)}\n`,
  );
}

function byNewest(left: SavedJobRecord, right: SavedJobRecord) {
  return right.updatedAt.localeCompare(left.updatedAt);
}

function requireId(id: string) {
  const parsed = StableIdSchema.max(200).safeParse(id);
  if (!parsed.success) {
    throw new SavedJobError("not-found", "Saved job not found.");
  }
  return parsed.data;
}

async function listLocal(rootDir: string): Promise<SavedJobSummary[]> {
  const state = await readFileState(rootDir);
  return state.records.sort(byNewest).map(savedJobSummary);
}

async function getLocal(rootDir: string, id: string): Promise<SavedJobRecord> {
  const state = await readFileState(rootDir);
  const record = state.records.find((item) => item.id === requireId(id));
  if (!record) throw new SavedJobError("not-found", "Saved job not found.");
  return record;
}

async function saveLocal(
  rootDir: string,
  input: unknown,
): Promise<SavedJobRecord> {
  return withLock(rootDir, async () => {
    const state = await readFileState(rootDir);
    const next = nextSavedJob(input, state.records);
    const records = state.records.some((record) => record.id === next.id)
      ? state.records.map((record) => (record.id === next.id ? next : record))
      : [...state.records, next];
    await writeFileState(rootDir, { records, preserved: state.preserved });
    return next;
  });
}

async function deleteLocal(rootDir: string, id: string) {
  return withLock(rootDir, async () => {
    const parsedId = requireId(id);
    const state = await readFileState(rootDir);
    if (!state.records.some((record) => record.id === parsedId)) {
      throw new SavedJobError("not-found", "Saved job not found.");
    }
    await writeFileState(rootDir, {
      records: state.records.filter((record) => record.id !== parsedId),
      preserved: state.preserved,
    });
    return { deleted: true as const };
  });
}

function rejectFilesystemRoot(rootDir: string | undefined) {
  if (rootDir !== undefined) {
    throw new Error("Hosted saved jobs cannot use a filesystem root.");
  }
}

export async function listSavedJobs(options: { rootDir?: string } = {}) {
  if (getAppMode() === "firebase") {
    rejectFilesystemRoot(options.rootDir);
    const { listCloudSavedJobs } = await import("../cloud/saved-job-store");
    return listCloudSavedJobs();
  }
  return listLocal(rootFor(options.rootDir));
}

export async function getSavedJob(
  id: string,
  options: { rootDir?: string } = {},
) {
  if (getAppMode() === "firebase") {
    rejectFilesystemRoot(options.rootDir);
    const { getCloudSavedJob } = await import("../cloud/saved-job-store");
    return getCloudSavedJob(id);
  }
  return getLocal(rootFor(options.rootDir), id);
}

export async function saveSavedJob(
  input: unknown,
  options: { rootDir?: string } = {},
) {
  if (getAppMode() === "firebase") {
    rejectFilesystemRoot(options.rootDir);
    const { saveCloudSavedJob } = await import("../cloud/saved-job-store");
    return saveCloudSavedJob(input);
  }
  return saveLocal(rootFor(options.rootDir), input);
}

export async function deleteSavedJob(
  id: string,
  options: { rootDir?: string } = {},
) {
  if (getAppMode() === "firebase") {
    rejectFilesystemRoot(options.rootDir);
    const { deleteCloudSavedJob } = await import("../cloud/saved-job-store");
    return deleteCloudSavedJob(id);
  }
  return deleteLocal(rootFor(options.rootDir), id);
}
