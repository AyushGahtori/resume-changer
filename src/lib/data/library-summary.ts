import type { ResumeLibrary } from "../schemas/resume-data";

/**
 * The counts the profile summary reports.
 *
 * They describe the loaded library, not the rows the current search facets
 * happen to show, so the summary stays honest while a facet narrows the
 * visible results.
 */
export type LibraryMetricCounts = {
  jobs: number;
  projects: number;
  points: number;
  skills: number;
  credentials: number;
};

function countPoints<T extends { points: unknown[] }>(items: T[]): number {
  return items.reduce((count, item) => count + item.points.length, 0);
}

/**
 * Derives the five summary counts from the loaded library.
 *
 * Points are the achievement points across jobs and projects together; the
 * other four counts are the length of the matching collection.
 */
export function getLibraryMetricCounts(
  library: ResumeLibrary,
): LibraryMetricCounts {
  return {
    jobs: library.jobs.length,
    projects: library.projects.length,
    points: countPoints(library.jobs) + countPoints(library.projects),
    skills: library.skills.length,
    credentials: library.credentials.length,
  };
}

/*
 * A fixed locale keeps the rendered value identical wherever the summary is
 * loaded, so the same library always reads the same way.
 */
const metricCountFormat = new Intl.NumberFormat("en-US");

/**
 * Formats a count for display.
 *
 * The grouping separator keeps a long count readable without rounding it,
 * so the number on the tile is always the real count.
 */
export function formatMetricCount(value: number): string {
  return metricCountFormat.format(value);
}
