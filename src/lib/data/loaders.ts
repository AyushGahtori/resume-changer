import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  GenerationHistorySchema,
  ResumeLibrarySchema,
  ResumePreferencesSchema,
  StableIdSchema,
} from "../schemas/resume-data";

const nonEmptyText = z.string().trim().min(1, "Must not be empty.");

export const TemplateMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: StableIdSchema,
    name: nonEmptyText,
    templateFile: nonEmptyText,
    preferences: ResumePreferencesSchema,
  })
  .strict();

export type ResumeDataSource = "personal" | "demo";
export type TemplateMetadata = z.infer<typeof TemplateMetadataSchema>;

export type DataLoadErrorCode =
  "missing-file" | "unreadable-file" | "invalid-json" | "invalid-schema";

type ValidationIssue = {
  path: string;
  message: string;
};

export class DataLoadError extends Error {
  constructor(
    readonly code: DataLoadErrorCode,
    readonly dataPath: string,
    readonly issues: ValidationIssue[] = [],
  ) {
    super(formatDataLoadError({ code, dataPath, issues }));
    this.name = "DataLoadError";
  }
}

type RootOptions = {
  rootDir?: string;
};

export type ResumeLibraryLoadOptions = RootOptions & {
  source?: ResumeDataSource;
};

function getResumeLibraryPath(source: ResumeDataSource) {
  switch (source) {
    case "personal":
      return "data/resume-library.json";
    case "demo":
      return "examples/sample-resume-library.json";
    default:
      throw new TypeError("Unsupported resume data source.");
  }
}

function schemaIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length ? issue.path.map(String).join(".") : "library",
    message: issue.message,
  }));
}

export function formatDataLoadError(error: {
  code: DataLoadErrorCode;
  dataPath: string;
  issues?: ValidationIssue[];
}) {
  switch (error.code) {
    case "missing-file":
      return `${error.dataPath} was not found. Add the personal data file or explicitly choose demo mode.`;
    case "unreadable-file":
      return `${error.dataPath} could not be read. Check that the file exists and is accessible.`;
    case "invalid-json":
      return `${error.dataPath} is not valid JSON. Correct its syntax and try again.`;
    case "invalid-schema": {
      const details = (error.issues ?? [])
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("\n");
      return details
        ? `${error.dataPath} does not match the required data schema:\n${details}`
        : `${error.dataPath} does not match the required data schema.`;
    }
  }
}

async function readJsonFile(relativePath: string, rootDir = process.cwd()) {
  const absolutePath = resolve(rootDir, relativePath);
  let contents: string;

  try {
    contents = await readFile(absolutePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new DataLoadError(
      code === "ENOENT" ? "missing-file" : "unreadable-file",
      relativePath,
    );
  }

  try {
    return JSON.parse(contents) as unknown;
  } catch {
    throw new DataLoadError("invalid-json", relativePath);
  }
}

async function loadValidatedFile<T>(
  relativePath: string,
  schema: z.ZodType<T>,
  rootDir = process.cwd(),
): Promise<T> {
  const input = await readJsonFile(relativePath, rootDir);
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new DataLoadError(
      "invalid-schema",
      relativePath,
      schemaIssues(result.error),
    );
  }

  return result.data;
}

export async function loadResumeLibrary({
  source = "personal",
  rootDir,
}: ResumeLibraryLoadOptions = {}) {
  const dataRoot =
    rootDir ??
    (source === "personal"
      ? (process.env.RESUME_LIBRARY_ROOT ?? process.cwd())
      : process.cwd());
  return loadValidatedFile(
    getResumeLibraryPath(source),
    ResumeLibrarySchema,
    dataRoot,
  );
}

export async function loadProfileData(options?: ResumeLibraryLoadOptions) {
  const library = await loadResumeLibrary(options);
  return library.profile;
}

export async function loadAchievementData(options?: ResumeLibraryLoadOptions) {
  const library = await loadResumeLibrary(options);
  return {
    jobs: library.jobs,
    projects: library.projects,
    skills: library.skills,
    credentials: library.credentials,
  };
}

export function loadTemplateMetadata({
  rootDir = process.cwd(),
}: RootOptions = {}) {
  return loadValidatedFile(
    "templates/metadata.json",
    TemplateMetadataSchema,
    rootDir,
  );
}

export function loadGenerationHistory({
  rootDir = process.cwd(),
}: RootOptions = {}) {
  return loadValidatedFile(
    "data/generation-history.json",
    GenerationHistorySchema,
    rootDir,
  );
}
