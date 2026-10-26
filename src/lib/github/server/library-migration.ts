import {
  ResumeLibraryV1Schema,
  ResumeLibraryInputSchema,
  ResumeLibraryV2Schema,
  type NormalizedResumeLibrary,
  type ResumeLibraryV1,
} from "../../schemas/resume-data";

/**
 * Pure in-memory migration. The source object and its historical values are
 * left untouched; callers decide separately if a future write should persist
 * this normalized version.
 */
export function migrateResumeLibraryV1ToV2(
  input: ResumeLibraryV1,
): NormalizedResumeLibrary {
  const library = ResumeLibraryV1Schema.parse(input);
  const migrated = {
    ...library,
    schemaVersion: 2 as const,
    jobs: library.jobs.map((job) => ({
      ...job,
      points: job.points.map((point) => ({
        ...point,
        githubEvidence: null,
      })),
    })),
    projects: library.projects.map((project) => ({
      ...project,
      repositoryAttachments: [],
      points: project.points.map((point) => ({
        ...point,
        githubEvidence: null,
      })),
    })),
    githubImportApprovals: [],
  };

  return ResumeLibraryV2Schema.parse(migrated);
}

/**
 * Normalize either supported file version to v2 for readers and workers.
 * Parsing a v2 object returns a validated copy and performs no persistence.
 */
export function normalizeResumeLibrary(
  input: unknown,
): NormalizedResumeLibrary {
  const parsed = ResumeLibraryInputSchema.parse(input);
  if (parsed.schemaVersion === 1) {
    return migrateResumeLibraryV1ToV2(parsed);
  }
  return ResumeLibraryV2Schema.parse(parsed);
}
