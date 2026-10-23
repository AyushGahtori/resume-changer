import { describe, expect, it } from "vitest";
import demoLibrary from "../../../examples/sample-resume-library.json";
import { getLibrarySummaryCounts } from "../../../src/lib/data/library-summary";
import type { ResumeLibrary } from "../../../src/lib/schemas/resume-data";

const library = demoLibrary as ResumeLibrary;

const emptyLibrary: ResumeLibrary = {
  schemaVersion: 1,
  profile: {
    id: "profile-empty",
    fullName: "Empty Library",
    links: [],
    education: [],
  },
  jobs: [],
  projects: [],
  skills: [],
  credentials: [],
  preferences: {
    sectionOrder: ["experience"],
    maxPages: 1,
  },
};

describe("library summary counts", () => {
  it("counts every record of the loaded library", () => {
    expect(getLibrarySummaryCounts(library)).toEqual({
      jobs: 2,
      projects: 2,
      points: 13,
      skills: 14,
      credentials: 2,
    });
  });

  it("adds the points of jobs and projects into one total", () => {
    const counts = getLibrarySummaryCounts(library);
    const jobPoints = library.jobs.reduce(
      (count, job) => count + job.points.length,
      0,
    );
    const projectPoints = library.projects.reduce(
      (count, project) => count + project.points.length,
      0,
    );

    expect(counts.points).toBe(jobPoints + projectPoints);
  });

  it("reports zero counts for an empty library", () => {
    expect(getLibrarySummaryCounts(emptyLibrary)).toEqual({
      jobs: 0,
      projects: 0,
      points: 0,
      skills: 0,
      credentials: 0,
    });
  });
});
