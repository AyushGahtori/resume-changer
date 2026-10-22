import { describe, expect, it } from "vitest";
import demoLibrary from "../../../examples/sample-resume-library.json";
import {
  EMPTY_LIBRARY_FILTERS,
  filterAchievementLibrary,
  getLibraryFilterOptions,
  type LibraryFilters,
} from "../../../src/lib/data/achievement-search";
import type { ResumeLibrary } from "../../../src/lib/schemas/resume-data";

const library = demoLibrary as ResumeLibrary;

function filters(overrides: Partial<LibraryFilters> = {}): LibraryFilters {
  return { ...EMPTY_LIBRARY_FILTERS, ...overrides };
}

/**
 * A small fictional library with one enabled and one disabled point.
 *
 * The shipped sample has no disabled point, so the disabled branch of the
 * status filter is never reached with the sample data alone.
 */
const libraryWithADisabledPoint = {
  ...library,
  jobs: [
    {
      ...library.jobs[0],
      points: [
        {
          ...library.jobs[0].points[0],
          id: "achievement-fixture-enabled",
          enabled: true,
        },
        {
          ...library.jobs[0].points[0],
          id: "achievement-fixture-disabled",
          enabled: false,
        },
      ],
    },
    ...library.jobs.slice(1),
  ],
} as ResumeLibrary;

describe("achievement library search", () => {
  it("groups job and project points in their original stable order", () => {
    const result = filterAchievementLibrary(library, EMPTY_LIBRARY_FILTERS);

    expect(result.jobs.map((job) => job.id)).toEqual(
      library.jobs.map((job) => job.id),
    );
    expect(result.projects.map((project) => project.id)).toEqual(
      library.projects.map((project) => project.id),
    );
    expect(result.jobs[0].points.map((point) => point.id)).toEqual(
      library.jobs[0].points.map((point) => point.id),
    );
    expect(result.visiblePointCount).toBe(result.totalPointCount);
  });

  it.each([
    ["point text", "bounded retries", "achievement-queueboard-worker-model"],
    ["tags", "geospatial", "achievement-fieldnotes-geospatial-search"],
    ["linked skill", "github actions", "achievement-ci-cd-pipeline"],
    ["job title", "platform engineer", "achievement-service-capacity-design"],
    ["project name", "queueboard", "achievement-queueboard-worker-model"],
  ])("searches by %s", (_label, query, pointId) => {
    const result = filterAchievementLibrary(library, filters({ query }));
    const ids = [...result.jobs, ...result.projects].flatMap((item) =>
      item.points.map((point) => point.id),
    );

    expect(ids).toContain(pointId);
  });

  it("searches credentials independently from experience points", () => {
    const result = filterAchievementLibrary(
      library,
      filters({ query: "Cloud Deployment Foundations" }),
    );

    expect(result.credentials).toHaveLength(1);
    expect(result.visiblePointCount).toBe(0);
  });

  it("combines experience, source, status, skill, and tag filters", () => {
    const result = filterAchievementLibrary(
      library,
      filters({
        experienceId: "job:job-example-cloud-labs",
        sourceType: "project-document",
        status: "enabled",
        skillId: "skill-github-actions",
        tag: "automation",
      }),
    );

    expect(
      result.jobs.flatMap((job) => job.points.map((point) => point.id)),
    ).toEqual(["achievement-ci-cd-pipeline"]);
    expect(result.projects).toHaveLength(0);
  });

  it("returns empty grouped results for unmatched queries and disabled points", () => {
    const noMatch = filterAchievementLibrary(
      library,
      filters({ query: "not-in-this-library" }),
    );
    const disabled = filterAchievementLibrary(
      library,
      filters({ status: "disabled" }),
    );

    expect(noMatch.jobs).toEqual([]);
    expect(noMatch.projects).toEqual([]);
    expect(noMatch.visiblePointCount).toBe(0);
    expect(disabled.visiblePointCount).toBe(0);
  });

  it("returns stable, deduplicated tag options and reset defaults", () => {
    const options = getLibraryFilterOptions(library);

    expect(options.tags).toEqual(
      [...new Set(options.tags)].sort((a, b) => a.localeCompare(b)),
    );
    expect(EMPTY_LIBRARY_FILTERS).toEqual({
      query: "",
      sourceType: "",
      status: "all",
      skillId: "",
      tag: "",
      experienceId: "",
    });
  });

  it("narrows to a project when the experience filter names one", () => {
    const result = filterAchievementLibrary(
      library,
      filters({ experienceId: "project:project-queueboard" }),
    );

    expect(result.jobs).toEqual([]);
    expect(result.projects.map((project) => project.id)).toEqual([
      "project-queueboard",
    ]);
    expect(result.visiblePointCount).toBe(3);
  });

  it("matches a point through the alias of a linked skill", () => {
    const linkedPoint = library.jobs
      .flatMap((job) => job.points)
      .find((point) => point.skillIds.includes("skill-accessibility"));
    expect(linkedPoint).toBeDefined();

    const result = filterAchievementLibrary(
      library,
      filters({ query: "a11y" }),
    );
    const ids = [...result.jobs, ...result.projects].flatMap((item) =>
      item.points.map((point) => point.id),
    );

    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain(linkedPoint!.id);
  });

  it("keeps the skill and credential lists independent of the point filters", () => {
    const result = filterAchievementLibrary(
      library,
      filters({ tag: "geospatial" }),
    );

    expect(result.visiblePointCount).toBe(1);
    expect(result.skills).toHaveLength(library.skills.length);
    expect(result.credentials).toHaveLength(library.credentials.length);
  });

  it("shows a disabled point only under the disabled status", () => {
    const disabled = filterAchievementLibrary(
      libraryWithADisabledPoint,
      filters({ status: "disabled" }),
    );
    const enabled = filterAchievementLibrary(
      libraryWithADisabledPoint,
      filters({ status: "enabled" }),
    );
    const disabledIds = disabled.jobs.flatMap((job) =>
      job.points.map((point) => point.id),
    );
    const enabledIds = enabled.jobs.flatMap((job) =>
      job.points.map((point) => point.id),
    );

    expect(disabled.visiblePointCount).toBe(1);
    expect(disabledIds).toEqual(["achievement-fixture-disabled"]);
    expect(enabledIds).toContain("achievement-fixture-enabled");
    expect(enabledIds).not.toContain("achievement-fixture-disabled");
  });
});
