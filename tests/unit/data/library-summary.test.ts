import { describe, expect, it } from "vitest";
import demoLibrary from "../../../examples/sample-resume-library.json";
import {
  formatMetricCount,
  getLibraryMetricCounts,
  getLibrarySummaryCounts,
} from "../../../src/lib/data/library-summary";
import type { ResumeLibrary } from "../../../src/lib/schemas/resume-data";

const library = demoLibrary as ResumeLibrary;

describe("library summary counts", () => {
  it("derives every count from the loaded library", () => {
    const counts = getLibraryMetricCounts(library);

    expect(counts).toEqual({
      jobs: library.jobs.length,
      projects: library.projects.length,
      points:
        library.jobs.reduce((count, job) => count + job.points.length, 0) +
        library.projects.reduce(
          (count, project) => count + project.points.length,
          0,
        ),
      skills: library.skills.length,
      credentials: library.credentials.length,
    });
  });

  it("keeps the previous summary count helper compatible", () => {
    expect(getLibrarySummaryCounts(library)).toEqual(
      getLibraryMetricCounts(library),
    );
  });

  it("counts the achievement points of jobs and projects together", () => {
    const counts = getLibraryMetricCounts({
      ...library,
      jobs: [{ ...library.jobs[0], points: library.jobs[0].points.slice(0, 2) }],
      projects: [
        { ...library.projects[0], points: library.projects[0].points.slice(0, 1) },
      ],
    });

    expect(counts.points).toBe(3);
  });

  it("reports zero for an empty library", () => {
    const counts = getLibraryMetricCounts({
      ...library,
      jobs: [],
      projects: [],
      skills: [],
      credentials: [],
    });

    expect(counts).toEqual({
      jobs: 0,
      projects: 0,
      points: 0,
      skills: 0,
      credentials: 0,
    });
  });

  it("keeps a large count exact", () => {
    const counts = getLibraryMetricCounts({
      ...library,
      skills: Array.from({ length: 1200 }, (_, index) => ({
        ...library.skills[0],
        id: `skill-bulk-${index}`,
      })),
    });

    expect(counts.skills).toBe(1200);
    expect(formatMetricCount(counts.skills)).toBe("1,200");
  });
});

describe("metric count formatting", () => {
  it.each([
    [0, "0"],
    [7, "7"],
    [250, "250"],
    [1200, "1,200"],
    [1000000, "1,000,000"],
  ])("formats %i as %s", (value, expected) => {
    expect(formatMetricCount(value)).toBe(expected);
  });

  it("does not round the value it formats", () => {
    expect(formatMetricCount(1999)).toBe("1,999");
    expect(formatMetricCount(1001)).toBe("1,001");
  });
});
