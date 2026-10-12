import { copyFile, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  AchievementPointSchema,
  AchievementSourceSchema,
  MetricSchema,
  ResumeLibrarySchema,
  StableIdSchema,
  type AchievementPoint,
  type ResumeLibrary,
} from "../schemas/resume-data";
import { DataLoadError } from "./loaders";

const UpdateChangesSchema = z
  .object({
    text: z.string().trim().min(1).optional(),
    tags: z.array(z.string().trim().min(1)).optional(),
    skillIds: z.array(StableIdSchema).optional(),
    metrics: z.array(MetricSchema).optional(),
    source: AchievementSourceSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((changes) => Object.keys(changes).length > 0, {
    message: "Provide at least one field to update.",
  });

export const CreateAchievementInputSchema = z
  .object({
    parentType: z.enum(["job", "project"]),
    parentId: StableIdSchema,
    point: AchievementPointSchema,
  })
  .strict();

export const UpdateAchievementInputSchema = z
  .object({ changes: UpdateChangesSchema })
  .strict();

export type CreateAchievementInput = z.infer<
  typeof CreateAchievementInputSchema
>;
export type UpdateAchievementInput = z.infer<
  typeof UpdateAchievementInputSchema
>;

export class LibraryWriteError extends Error {
  constructor(
    readonly code: "not-found" | "locked" | "invalid-library" | "io-error",
    message: string,
  ) {
    super(message);
    this.name = "LibraryWriteError";
  }
}

type WriteOptions = { rootDir?: string };

function getPoint(library: ResumeLibrary, pointId: string) {
  return [
    ...library.jobs.flatMap((job) => job.points),
    ...library.projects.flatMap((project) => project.points),
  ].find((point) => point.id === pointId);
}

async function readPersonalLibrary(rootDir: string) {
  try {
    const contents = await readFile(
      join(rootDir, "data", "resume-library.json"),
      "utf8",
    );
    const parsed: unknown = JSON.parse(contents);
    const result = ResumeLibrarySchema.safeParse(parsed);
    if (!result.success) {
      throw new LibraryWriteError(
        "invalid-library",
        "The saved library no longer matches its schema. Correct the data before editing.",
      );
    }
    return result.data;
  } catch (error) {
    if (error instanceof LibraryWriteError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || error instanceof SyntaxError) {
      throw new DataLoadError(
        code === "ENOENT" ? "missing-file" : "invalid-json",
        "data/resume-library.json",
      );
    }
    throw new LibraryWriteError("io-error", "The library could not be read.");
  }
}

async function saveLibrary(library: ResumeLibrary, rootDir: string) {
  const target = join(rootDir, "data", "resume-library.json");
  const directory = dirname(target);
  const backup = `${target}.bak`;
  const nonce = randomUUID();
  const temporary = join(directory, `.resume-library-${nonce}.tmp`);
  const backupTemporary = join(directory, `.resume-library-${nonce}.bak.tmp`);
  await mkdir(directory, { recursive: true });

  try {
    const file = await open(temporary, "wx");
    try {
      await file.writeFile(`${JSON.stringify(library, null, 2)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }

    await copyFile(target, backupTemporary);
    await rm(backup, { force: true });
    await rename(backupTemporary, backup);
    await rename(temporary, target);
  } catch {
    throw new LibraryWriteError(
      "io-error",
      "The library could not be saved. The existing data was left unchanged; try again.",
    );
  } finally {
    await rm(temporary, { force: true });
    await rm(backupTemporary, { force: true });
  }
}

async function commitPointChange(
  change: (library: ResumeLibrary) => ResumeLibrary,
  {
    rootDir = process.env.RESUME_LIBRARY_ROOT ?? process.cwd(),
  }: WriteOptions = {},
) {
  const lockPath = join(rootDir, "data", "resume-library.json.lock");
  await mkdir(dirname(lockPath), { recursive: true });
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new LibraryWriteError(
        "locked",
        "Another library save is in progress. Wait a moment and try again.",
      );
    }
    throw new LibraryWriteError("io-error", "The library could not be saved.");
  }

  try {
    const library = await readPersonalLibrary(rootDir);
    const next = change(library);
    const result = ResumeLibrarySchema.safeParse(next);
    if (!result.success) {
      throw new LibraryWriteError(
        "invalid-library",
        "This change conflicts with the library data. Check IDs, skills, and metrics.",
      );
    }
    await saveLibrary(result.data, rootDir);
    return result.data;
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

export async function createAchievementPoint(
  input: CreateAchievementInput,
  options?: WriteOptions,
) {
  const parsed = CreateAchievementInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new LibraryWriteError(
      "invalid-library",
      "The achievement data is invalid.",
    );
  }

  let created: AchievementPoint | undefined;
  const library = await commitPointChange((current) => {
    const collection =
      parsed.data.parentType === "job" ? current.jobs : current.projects;
    const parent = collection.find((item) => item.id === parsed.data.parentId);
    if (!parent) {
      throw new LibraryWriteError(
        "not-found",
        "The selected job or project was not found.",
      );
    }
    created = parsed.data.point;
    return {
      ...current,
      [parsed.data.parentType === "job" ? "jobs" : "projects"]: collection.map(
        (item) =>
          item.id === parsed.data.parentId
            ? { ...item, points: [...item.points, parsed.data.point] }
            : item,
      ),
    };
  }, options);
  return { library, point: created! };
}

export async function updateAchievementPoint(
  pointId: string,
  input: UpdateAchievementInput,
  options?: WriteOptions,
) {
  const parsedId = StableIdSchema.safeParse(pointId);
  const parsedInput = UpdateAchievementInputSchema.safeParse(input);
  if (!parsedId.success || !parsedInput.success) {
    throw new LibraryWriteError(
      "invalid-library",
      "The achievement update is invalid.",
    );
  }

  let updated: AchievementPoint | undefined;
  const library = await commitPointChange((current) => {
    if (!getPoint(current, parsedId.data)) {
      throw new LibraryWriteError(
        "not-found",
        "The achievement point was not found.",
      );
    }
    const update = <T extends { points: AchievementPoint[] }>(items: T[]) =>
      items.map((item) => ({
        ...item,
        points: item.points.map((point) => {
          if (point.id !== parsedId.data) return point;
          updated = { ...point, ...parsedInput.data.changes };
          return updated;
        }),
      }));
    return {
      ...current,
      jobs: update(current.jobs),
      projects: update(current.projects),
    };
  }, options);
  return { library, point: updated! };
}
