import type { ResumeLibrary } from "../schemas/resume-data";

export type LibrarySummaryCounts = {
  jobs: number;
  projects: number;
  points: number;
  skills: number;
  credentials: number;
};

/**
 * The summary reports the loaded library rather than the filtered view, so the
 * numbers only change when the underlying records change.
 */
export function getLibrarySummaryCounts(
  library: ResumeLibrary,
): LibrarySummaryCounts {
  const points =
    library.jobs.reduce((count, job) => count + job.points.length, 0) +
    library.projects.reduce(
      (count, project) => count + project.points.length,
      0,
    );

  return {
    jobs: library.jobs.length,
    projects: library.projects.length,
    points,
    skills: library.skills.length,
    credentials: library.credentials.length,
  };
}
