import type {
  AchievementPoint,
  Credential,
  Job,
  Project,
  ResumeLibrary,
  Skill,
} from "../schemas/resume-data";

export type LibraryFilters = {
  query: string;
  sourceType: string;
  status: "all" | "enabled" | "disabled";
  skillId: string;
  tag: string;
  experienceId: string;
};

export type FilteredExperience<T extends Job | Project> = T & {
  points: AchievementPoint[];
};

export type FilteredLibrary = {
  jobs: FilteredExperience<Job>[];
  projects: FilteredExperience<Project>[];
  skills: Skill[];
  credentials: Credential[];
  totalPointCount: number;
  visiblePointCount: number;
};

export const EMPTY_LIBRARY_FILTERS: LibraryFilters = {
  query: "",
  sourceType: "",
  status: "all",
  skillId: "",
  tag: "",
  experienceId: "",
};

/**
 * The orderings the library can show its achievement points in. Every mode
 * is derived from the loaded library, so the saved data and the saved order
 * of the points are never touched.
 */
export type LibrarySort = "most-recent" | "oldest" | "alphabetical";

export const LIBRARY_SORT_OPTIONS: ReadonlyArray<{
  value: LibrarySort;
  label: string;
}> = [
  { value: "most-recent", label: "Most recent" },
  { value: "oldest", label: "Oldest" },
  { value: "alphabetical", label: "Alphabetical (A–Z)" },
];

export const DEFAULT_LIBRARY_SORT: LibrarySort = "most-recent";

function normalize(value: string) {
  return value.trim().toLocaleLowerCase();
}

function includesQuery(values: Array<string | undefined>, query: string) {
  return values.some((value) => value && normalize(value).includes(query));
}

function pointMatches(
  point: AchievementPoint,
  experienceName: string,
  experienceId: string,
  skillsById: Map<string, Skill>,
  filters: LibraryFilters,
) {
  if (filters.experienceId && filters.experienceId !== experienceId)
    return false;
  if (filters.status === "enabled" && !point.enabled) return false;
  if (filters.status === "disabled" && point.enabled) return false;
  if (filters.sourceType && point.source.type !== filters.sourceType)
    return false;
  if (filters.skillId && !point.skillIds.includes(filters.skillId))
    return false;
  if (filters.tag && !point.tags.includes(filters.tag)) return false;

  const query = normalize(filters.query);
  if (!query) return true;

  const linkedSkillText = point.skillIds.flatMap((id) => {
    const skill = skillsById.get(id);
    return skill ? [skill.name, ...skill.aliases] : [];
  });

  return includesQuery(
    [
      experienceName,
      point.id,
      point.text,
      ...point.tags,
      ...linkedSkillText,
      point.source.type,
      point.source.label,
      point.source.reference,
    ],
    query,
  );
}

function filterExperiences<T extends Job | Project>(
  items: T[],
  kind: "job" | "project",
  skillsById: Map<string, Skill>,
  filters: LibraryFilters,
): FilteredExperience<T>[] {
  return items.flatMap((item) => {
    const experienceId = `${kind}:${item.id}`;
    const experienceName =
      kind === "job"
        ? `${(item as Job).title} ${(item as Job).company}`
        : (item as Project).name;
    const points = item.points.filter((point) =>
      pointMatches(point, experienceName, experienceId, skillsById, filters),
    );

    return points.length > 0 ? [{ ...item, points }] : [];
  });
}

export function filterAchievementLibrary(
  library: ResumeLibrary,
  filters: LibraryFilters,
): FilteredLibrary {
  const skillsById = new Map(library.skills.map((skill) => [skill.id, skill]));
  const jobs = filterExperiences(library.jobs, "job", skillsById, filters);
  const projects = filterExperiences(
    library.projects,
    "project",
    skillsById,
    filters,
  );
  const query = normalize(filters.query);
  const skills = library.skills.filter((skill) => {
    if (filters.skillId && filters.skillId !== skill.id) return false;
    return (
      !query ||
      includesQuery([skill.name, skill.category, ...skill.aliases], query)
    );
  });
  const credentials = library.credentials.filter(
    (credential) =>
      !query ||
      includesQuery(
        [
          credential.name,
          credential.issuer,
          credential.kind,
          credential.credentialId,
        ],
        query,
      ),
  );
  const totalPointCount =
    library.jobs.reduce((count, job) => count + job.points.length, 0) +
    library.projects.reduce(
      (count, project) => count + project.points.length,
      0,
    );
  const visiblePointCount =
    jobs.reduce((count, job) => count + job.points.length, 0) +
    projects.reduce((count, project) => count + project.points.length, 0);

  return {
    jobs,
    projects,
    skills,
    credentials,
    totalPointCount,
    visiblePointCount,
  };
}

export function getLibraryFilterOptions(library: ResumeLibrary) {
  return {
    skills: library.skills,
    tags: Array.from(
      new Set([
        ...library.jobs.flatMap((job) =>
          job.points.flatMap((point) => point.tags),
        ),
        ...library.projects.flatMap((project) =>
          project.points.flatMap((point) => point.tags),
        ),
      ]),
    ).sort((left, right) => left.localeCompare(right)),
  };
}

/**
 * The copy for the matching-point count. The count always names the points
 * that are on screen, and it only mentions the total when the filters hide
 * some of them, so it never implies that a record is gone.
 */
export function formatLibraryResultCount(visible: number, total: number) {
  const results = `${visible} ${visible === 1 ? "result" : "results"}`;
  return visible === total ? results : `${results} of ${total}`;
}

function monthIndex(value: string) {
  const [year, month] = value.split("-");
  return Number(year) * 12 + Number(month);
}

type Recency = {
  /** `0` for an ongoing role, `1` for a finished one. */
  group: 0 | 1;
  /** The month the experience is sorted by. */
  month: number;
};

/**
 * How recent an experience is. An ongoing role is the most recent one and is
 * ordered by the month it started, a finished role is as recent as its end
 * date, and an experience without any date has no recency at all.
 */
function experienceRecency(item: Job | Project): Recency | null {
  // A missing end date means the experience is still running, which is how
  // the library shows it as "Present".
  if (!item.endDate) {
    if (item.startDate) {
      return { group: 0, month: monthIndex(item.startDate) };
    }
    return null;
  }
  return { group: 1, month: monthIndex(item.endDate) };
}

function experienceTitle(item: Job | Project) {
  return "title" in item ? item.title : item.name;
}

/**
 * Compares two experiences by recency. `direction` is `-1` for the most
 * recent order and `1` for the oldest one. An experience without a date has
 * no recency, so it stays last in both orders, and equal recencies keep the
 * order the library already had.
 */
function compareRecency(
  left: Job | Project,
  right: Job | Project,
  direction: 1 | -1,
) {
  const leftRecency = experienceRecency(left);
  const rightRecency = experienceRecency(right);
  if (!leftRecency || !rightRecency) {
    if (leftRecency === rightRecency) return 0;
    // Undated experiences stay last in both orders.
    return leftRecency ? -1 : 1;
  }
  if (leftRecency.group !== rightRecency.group) {
    // The most recent order puts an ongoing role first and the oldest order
    // puts it last.
    return leftRecency.group < rightRecency.group ? direction : -direction;
  }
  if (leftRecency.month === rightRecency.month) return 0;
  return leftRecency.month < rightRecency.month ? -direction : direction;
}

function sortPoints(points: AchievementPoint[], sort: LibrarySort) {
  if (sort !== "alphabetical") return points;
  return [...points].sort((left, right) => left.text.localeCompare(right.text));
}

/**
 * Orders the filtered library for display. The result is a new view model:
 * the loaded library, its points, their provenance, and their identifiers
 * are left untouched, and only the order of the returned groups and points
 * changes.
 */
export function sortFilteredLibrary(
  filtered: FilteredLibrary,
  sort: LibrarySort,
): FilteredLibrary {
  const direction: 1 | -1 = sort === "oldest" ? 1 : -1;

  const sortExperiences = <T extends Job | Project>(
    items: FilteredExperience<T>[],
  ): FilteredExperience<T>[] =>
    [...items]
      .sort((left, right) =>
        sort === "alphabetical"
          ? experienceTitle(left).localeCompare(experienceTitle(right))
          : compareRecency(left, right, direction),
      )
      .map((item) => ({ ...item, points: sortPoints(item.points, sort) }));

  return {
    ...filtered,
    jobs: sortExperiences(filtered.jobs),
    projects: sortExperiences(filtered.projects),
  };
}
