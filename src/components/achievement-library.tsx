"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  EMPTY_LIBRARY_FILTERS,
  filterAchievementLibrary,
  getLibraryFilterOptions,
  type LibraryFilters,
} from "@/lib/data/achievement-search";
import type {
  AchievementPoint,
  Job,
  Project,
  ResumeLibrary,
} from "@/lib/schemas/resume-data";
import type { ResumeDataSource } from "@/lib/data/loaders";

type Props = { library: ResumeLibrary; source: ResumeDataSource };

function dateRange(start?: string, end?: string | null) {
  if (!start) return "";
  const format = (value: string) => {
    const [year, month] = value.split("-");
    return `${month}/${year}`;
  };
  return `${format(start)} – ${end ? format(end) : "Present"}`;
}

function PointRow({
  point,
  library,
  onTag,
  onSkill,
}: {
  point: AchievementPoint;
  library: ResumeLibrary;
  onTag: (tag: string) => void;
  onSkill: (skillId: string) => void;
}) {
  const skillsById = new Map(library.skills.map((skill) => [skill.id, skill]));
  return (
    <article className="library-point">
      <div className="library-point-heading">
        <code>{point.id}</code>
        <span
          className={`point-status ${point.enabled ? "is-enabled" : "is-disabled"}`}
        >
          {point.enabled ? "Enabled" : "Disabled"}
        </span>
      </div>
      <p className="library-point-text">{point.text}</p>
      <p className="point-provenance">
        Source: <strong>{point.source.type}</strong>
        {point.source.label ? ` · ${point.source.label}` : ""}
        {point.source.reference ? ` · ${point.source.reference}` : ""}
      </p>
      {(point.tags.length > 0 || point.skillIds.length > 0) && (
        <div className="point-facets">
          {point.tags.map((tag) => (
            <button
              className="facet-chip"
              key={tag}
              onClick={() => onTag(tag)}
              type="button"
            >
              #{tag}
            </button>
          ))}
          {point.skillIds.map((id) => {
            const skill = skillsById.get(id);
            return skill ? (
              <button
                className="facet-chip is-skill"
                key={id}
                onClick={() => onSkill(id)}
                type="button"
              >
                {skill.name}
              </button>
            ) : null;
          })}
        </div>
      )}
    </article>
  );
}

function ExperienceGroup({
  item,
  kind,
  library,
  onTag,
  onSkill,
}: {
  item: (Job | Project) & { points: AchievementPoint[] };
  kind: "job" | "project";
  library: ResumeLibrary;
  onTag: (tag: string) => void;
  onSkill: (skillId: string) => void;
}) {
  const isJob = kind === "job";
  const job = isJob ? (item as Job) : null;
  const project = isJob ? null : (item as Project);
  const title = job?.title ?? project?.name ?? "";
  const organization = job?.company ?? project?.role;

  return (
    <section
      className="experience-group"
      aria-label={`${isJob ? "Job" : "Project"}: ${title}`}
    >
      <div className="experience-heading">
        <div>
          <p className="experience-kind">{isJob ? "JOB" : "PROJECT"}</p>
          <h3>{title}</h3>
          {organization && (
            <p className="experience-subtitle">{organization}</p>
          )}
        </div>
        <span className="experience-dates">
          {job
            ? dateRange(job.startDate, job.endDate)
            : dateRange(project?.startDate, project?.endDate)}
        </span>
      </div>
      {item.points.map((point) => (
        <PointRow
          key={point.id}
          library={library}
          onSkill={onSkill}
          onTag={onTag}
          point={point}
        />
      ))}
    </section>
  );
}

export default function AchievementLibrary({ library, source }: Props) {
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_LIBRARY_FILTERS);
  const result = useMemo(
    () => filterAchievementLibrary(library, filters),
    [filters, library],
  );
  const options = useMemo(() => getLibraryFilterOptions(library), [library]);
  const hasFilters = Object.entries(filters).some(([key, value]) =>
    key === "status" ? value !== "all" : value !== "",
  );
  const sourceLabel =
    source === "demo" ? "Fictional demo data" : "My resume data";

  function updateFilter<Key extends keyof LibraryFilters>(
    key: Key,
    value: LibraryFilters[Key],
  ) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="library-page">
      <div className="library-heading page-heading-row">
        <div>
          <p className="eyebrow">YOUR EXPERIENCE</p>
          <h1>Achievement library</h1>
          <p className="page-intro">
            Browse the resume information saved in this workspace.
          </p>
        </div>
        <div className="library-source-switch" aria-label="Library data source">
          <Link
            aria-current={source === "personal" ? "page" : undefined}
            href="/library"
          >
            My data
          </Link>
          <Link
            aria-current={source === "demo" ? "page" : undefined}
            href="/library?source=demo"
          >
            Demo data
          </Link>
        </div>
      </div>

      <section className="library-overview" aria-label="Library summary">
        <div className="library-owner">
          <span className="source-indicator">{sourceLabel}</span>
          <h2>{library.profile.fullName}</h2>
          {library.profile.headline && <p>{library.profile.headline}</p>}
        </div>
        <dl className="library-counts">
          <div>
            <dt>Jobs</dt>
            <dd>{library.jobs.length}</dd>
          </div>
          <div>
            <dt>Projects</dt>
            <dd>{library.projects.length}</dd>
          </div>
          <div>
            <dt>Points</dt>
            <dd>{result.totalPointCount}</dd>
          </div>
          <div>
            <dt>Skills</dt>
            <dd>{library.skills.length}</dd>
          </div>
          <div>
            <dt>Credentials</dt>
            <dd>{library.credentials.length}</dd>
          </div>
        </dl>
      </section>

      <section
        className="library-controls"
        aria-label="Search and filter library"
      >
        <label className="library-search">
          <span>Search library</span>
          <input
            onChange={(event) => updateFilter("query", event.target.value)}
            placeholder="Points, skills, tags, jobs, projects, credentials"
            type="search"
            value={filters.query}
          />
        </label>
        <div className="library-filter-grid">
          <label>
            <span>Job or project</span>
            <select
              onChange={(event) =>
                updateFilter("experienceId", event.target.value)
              }
              value={filters.experienceId}
            >
              <option value="">All experience</option>
              {library.jobs.map((job) => (
                <option key={job.id} value={`job:${job.id}`}>
                  {job.title} · {job.company}
                </option>
              ))}
              {library.projects.map((project) => (
                <option key={project.id} value={`project:${project.id}`}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Point source</span>
            <select
              onChange={(event) =>
                updateFilter("sourceType", event.target.value)
              }
              value={filters.sourceType}
            >
              <option value="">All sources</option>
              {[
                ...new Set(
                  [...library.jobs, ...library.projects].flatMap((item) =>
                    item.points.map((point) => point.source.type),
                  ),
                ),
              ]
                .sort()
                .map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>Point status</span>
            <select
              onChange={(event) =>
                updateFilter(
                  "status",
                  event.target.value as LibraryFilters["status"],
                )
              }
              value={filters.status}
            >
              <option value="all">All statuses</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
          <label>
            <span>Linked skill</span>
            <select
              onChange={(event) => updateFilter("skillId", event.target.value)}
              value={filters.skillId}
            >
              <option value="">All skills</option>
              {options.skills.map((skill) => (
                <option key={skill.id} value={skill.id}>
                  {skill.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Tag</span>
            <select
              onChange={(event) => updateFilter("tag", event.target.value)}
              value={filters.tag}
            >
              <option value="">All tags</option>
              {options.tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="library-filter-summary" aria-live="polite">
          <span>
            {result.visiblePointCount} of {result.totalPointCount} achievement
            points
          </span>
          {hasFilters && (
            <button
              className="text-action"
              onClick={() => setFilters(EMPTY_LIBRARY_FILTERS)}
              type="button"
            >
              Reset filters
            </button>
          )}
        </div>
      </section>

      {result.visiblePointCount === 0 ? (
        <p className="library-empty" role="status">
          No achievement points match these filters.
        </p>
      ) : (
        <div className="library-experiences">
          {result.jobs.map((job) => (
            <ExperienceGroup
              item={job}
              key={job.id}
              kind="job"
              library={library}
              onSkill={(id) => updateFilter("skillId", id)}
              onTag={(tag) => updateFilter("tag", tag)}
            />
          ))}
          {result.projects.map((project) => (
            <ExperienceGroup
              item={project}
              key={project.id}
              kind="project"
              library={library}
              onSkill={(id) => updateFilter("skillId", id)}
              onTag={(tag) => updateFilter("tag", tag)}
            />
          ))}
        </div>
      )}

      <section
        className="library-secondary"
        aria-label="Skills and credentials"
      >
        <details
          className="library-detail"
          open={Boolean(filters.query || filters.skillId)}
        >
          <summary>
            Skills <span>{result.skills.length}</span>
          </summary>
          {result.skills.length ? (
            <ul className="skill-list">
              {result.skills.map((skill) => (
                <li key={skill.id}>
                  <div>
                    <strong>{skill.name}</strong>
                    {skill.category && <span>{skill.category}</span>}
                  </div>
                  <span
                    className={
                      skill.isListedOnCurrentResume
                        ? "skill-listed"
                        : "skill-unlisted"
                    }
                  >
                    {skill.isListedOnCurrentResume
                      ? "On current resume"
                      : "Library only"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="secondary-empty">No skills match this search.</p>
          )}
        </details>
        <details className="library-detail" open={Boolean(filters.query)}>
          <summary>
            Credentials <span>{result.credentials.length}</span>
          </summary>
          {result.credentials.length ? (
            <ul className="credential-list">
              {result.credentials.map((credential) => (
                <li key={credential.id}>
                  <strong>{credential.name}</strong>
                  <span>
                    {credential.kind} · {credential.issuer}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="secondary-empty">No credentials match this search.</p>
          )}
        </details>
      </section>
    </div>
  );
}
