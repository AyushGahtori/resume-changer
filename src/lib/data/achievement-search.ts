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
