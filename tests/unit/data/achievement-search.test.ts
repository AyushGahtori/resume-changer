[error] No parser could be inferred for file "C:\Users\Ayush\.codex\worktrees\achievement-pr-audit\re_changer\test-results\remote-format-pr80-2.txt".
import { describe, expect, it } from "vitest";
import demoLibrary from "../../../examples/sample-resume-library.json";
import {
  DEFAULT_LIBRARY_SORT,
  EMPTY_LIBRARY_FILTERS,
  LIBRARY_SORT_OPTIONS,
  filterAchievementLibrary,
  formatLibraryResultCount,
  getLibraryFilterOptions,
  sortFilteredLibrary,
  type LibraryFilters,
} from "../../../src/lib/data/achievement-search";
import type {
  Job,
  Project,
  ResumeLibrary,
} from "../../../src/lib/schemas/resume-data";

const library = demoLibrary as ResumeLibrary;

function filters(overrides: Partial<LibraryFilters> = {}): LibraryFilters {
  return { ...EMPTY_LIBRARY_FILTERS, ...overrides };
}

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
});

/**
 * A small library with the edge cases the sort has to survive: an ongoing
 * role, two experiences that end in the same month, and an experience
 * without any date at all.
 */
function buildSortLibrary(): ResumeLibrary {
  const point = (id: string, text: string) => ({
    id,
    text,
    tags: [],
    skillIds: [],
    metrics: [],
    source: { type: "user-notes" as const },
    enabled: true,
  });

  const job = (
    id: string,
    title: string,
    startDate: string,
    endDate: string | null,
  ): Job => ({
    id,
    company: "Test Company",
    title,
    employmentType: "full-time",
    startDate,
    endDate,
    points: [point(`${id}-point`, `${title} outcome`)],
  });

  const project = (
    id: string,
    name: string,
    startDate?: string,
    endDate?: string | null,
  ): Project => ({
    id,
    name,
    ...(startDate ? { startDate } : {}),
    ...(endDate === undefined ? {} : { endDate }),
    points: [point(`${id}-point`, `${name} outcome`)],
  });

  return {
    schemaVersion: 1,
    profile: {
      id: "profile-test",
      fullName: "Test Person",
      links: [],
      education: [],
    },
    jobs: [
      job("job-tie-first", "Tie First", "2020-01", "2022-05"),
      job("job-ongoing", "Ongoing Role", "2023-02", null),
      job("job-tie-second", "Tie Second", "2019-04", "2022-05"),
    ],
    projects: [
      project("project-undated", "Undated Project"),
      project("project-old", "Old Project", "2018-01", "2019-01"),
      project("project-recent", "Recent Project", "2024-01", "2024-06"),
    ],
    skills: [],
    credentials: [],
    preferences: {
      sectionOrder: ["experience", "projects", "skills", "credentials"],
      maxPages: 1,
    },
  };
}

describe("achievement library sort", () => {
  it("offers a default most recent order and named options", () => {
    expect(DEFAULT_LIBRARY_SORT).toBe("most-recent");
    expect(LIBRARY_SORT_OPTIONS.map((option) => option.value)).toEqual([
      "most-recent",
      "oldest",
      "alphabetical",
    ]);
  });

  it("puts the ongoing role first and the undated experience last", () => {
    const filtered = filterAchievementLibrary(
      buildSortLibrary(),
      EMPTY_LIBRARY_FILTERS,
    );

    const mostRecent = sortFilteredLibrary(filtered, "most-recent");
    expect(mostRecent.jobs.map((job) => job.id)).toEqual([
      "job-ongoing",
      "job-tie-first",
      "job-tie-second",
    ]);
    expect(mostRecent.projects.map((project) => project.id)).toEqual([
      "project-recent",
      "project-old",
      "project-undated",
    ]);

    const oldest = sortFilteredLibrary(filtered, "oldest");
    expect(oldest.jobs.map((job) => job.id)).toEqual([
      "job-tie-first",
      "job-tie-second",
      "job-ongoing",
    ]);
    expect(oldest.projects.map((project) => project.id)).toEqual([
      "project-old",
      "project-recent",
      "project-undated",
    ]);
  });

  it("keeps the original order for experiences that end in the same month", () => {
    const filtered = filterAchievementLibrary(
      buildSortLibrary(),
      EMPTY_LIBRARY_FILTERS,
    );

    // Both tied roles end in 2022-05, so they keep the order of the library.
    expect(
      sortFilteredLibrary(filtered, "most-recent").jobs.map((job) => job.id),
    ).toEqual(["job-ongoing", "job-tie-first", "job-tie-second"]);
    expect(
      sortFilteredLibrary(filtered, "oldest").jobs.map((job) => job.id),
    ).toEqual(["job-tie-first", "job-tie-second", "job-ongoing"]);
  });

  it("sorts experiences and their points alphabetically", () => {
    const filtered = filterAchievementLibrary(
      buildSortLibrary(),
      EMPTY_LIBRARY_FILTERS,
    );

    const sorted = sortFilteredLibrary(filtered, "alphabetical");
    expect(sorted.jobs.map((job) => job.title)).toEqual([
      "Ongoing Role",
      "Tie First",
      "Tie Second",
    ]);
    expect(sorted.projects.map((project) => project.name)).toEqual([
      "Old Project",
      "Recent Project",
      "Undated Project",
    ]);
  });

  it("sorts the points inside a group by their text", () => {
    const source = buildSortLibrary();
    source.jobs[0].points = [
      {
        id: "job-tie-first-point",
        text: "Zebra delivery",
        tags: [],
        skillIds: [],
        metrics: [],
        source: { type: "user-notes" },
        enabled: true,
      },
      {
        id: "job-tie-first-point-two",
        text: "Alpha delivery",
        tags: [],
        skillIds: [],
        metrics: [],
        source: { type: "user-notes" },
        enabled: true,
      },
    ];

    const sorted = sortFilteredLibrary(
      filterAchievementLibrary(source, EMPTY_LIBRARY_FILTERS),
      "alphabetical",
    );
    const group = sorted.jobs.find((job) => job.id === "job-tie-first");

    expect(group?.points.map((point) => point.text)).toEqual([
      "Alpha delivery",
      "Zebra delivery",
    ]);
  });

  it("never mutates the source library", () => {
    const source = buildSortLibrary();
    const before = JSON.stringify(source);
    const filtered = filterAchievementLibrary(source, EMPTY_LIBRARY_FILTERS);

    for (const sort of LIBRARY_SORT_OPTIONS.map((option) => option.value)) {
      sortFilteredLibrary(filtered, sort);
    }

    expect(JSON.stringify(source)).toBe(before);
    expect(source.jobs.map((job) => job.id)).toEqual([
      "job-tie-first",
      "job-ongoing",
      "job-tie-second",
    ]);
    expect(source.projects.map((project) => project.id)).toEqual([
      "project-undated",
      "project-old",
      "project-recent",
    ]);
  });

  it("keeps the same points when a filter is combined with a sort", () => {
    const filtered = filterAchievementLibrary(
      library,
      filters({ tag: "automation" }),
    );
    const filteredIds = [
      ...filtered.jobs,
      ...filtered.projects,
    ].flatMap((item) => item.points.map((point) => point.id));

    for (const sort of LIBRARY_SORT_OPTIONS.map((option) => option.value)) {
      const sorted = sortFilteredLibrary(filtered, sort);
      const sortedIds = [...sorted.jobs, ...sorted.projects].flatMap((item) =>
        item.points.map((point) => point.id),
      );

      expect(sorted.visiblePointCount).toBe(filtered.visiblePointCount);
      expect(sorted.totalPointCount).toBe(filtered.totalPointCount);
      expect([...sortedIds].sort()).toEqual([...filteredIds].sort());
    }
  });
});

describe("achievement library result count", () => {
  it("uses the singular for a single result", () => {
    expect(formatLibraryResultCount(1, 1)).toBe("1 result");
  });

  it("uses the plural for several results", () => {
    expect(formatLibraryResultCount(13, 13)).toBe("13 results");
  });

  it("names the total when the filters hide some points", () => {
    expect(formatLibraryResultCount(3, 13)).toBe("3 results of 13");
    expect(formatLibraryResultCount(0, 13)).toBe("0 results of 13");
  });

  it("keeps the singular when a single point is left of a larger library", () => {
    expect(formatLibraryResultCount(1, 13)).toBe("1 result of 13");
  });
});

