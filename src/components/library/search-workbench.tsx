"use client";

import { useMemo } from "react";
import CategoryNavigation from "@/components/library/category-navigation";
import type {
  FilteredLibrary,
  LibraryFilters,
} from "@/lib/data/achievement-search";
import type { ResumeLibrary, Skill } from "@/lib/schemas/resume-data";

type Props = {
  library: ResumeLibrary;
  filters: LibraryFilters;
  result: FilteredLibrary;
  options: { skills: Skill[]; tags: string[] };
  hasFilters: boolean;
  onFilterChange: <Key extends keyof LibraryFilters>(
    key: Key,
    value: LibraryFilters[Key],
  ) => void;
  onReset: () => void;
};

/**
 * The workbench is the sticky control band of the library page: the global
 * search, the existing facets, the section navigation, and the result count.
 */
export default function SearchWorkbench({
  library,
  filters,
  result,
  options,
  hasFilters,
  onFilterChange,
  onReset,
}: Props) {
  const sourceTypes = useMemo(
    () =>
      Array.from(
        new Set(
          [...library.jobs, ...library.projects].flatMap((item) =>
            item.points.map((point) => point.source.type),
          ),
        ),
      ).sort(),
    [library.jobs, library.projects],
  );

  return (
    <section
      className="library-workbench"
      aria-label="Search and filter library"
    >
      <label className="library-search">
        <span className="visually-hidden">Search library</span>
        <input
          onChange={(event) => onFilterChange("query", event.target.value)}
          placeholder="Points, skills, tags, jobs, projects, credentials"
          type="search"
          value={filters.query}
        />
      </label>

      <div className="library-filter-grid">
        <label>
          <span className="visually-hidden">Job or project</span>
          <select
            onChange={(event) =>
              onFilterChange("experienceId", event.target.value)
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
          <span className="visually-hidden">Point source</span>
          <select
            onChange={(event) =>
              onFilterChange("sourceType", event.target.value)
            }
            value={filters.sourceType}
          >
            <option value="">All sources</option>
            {sourceTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="visually-hidden">Point status</span>
          <select
            onChange={(event) =>
              onFilterChange(
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
          <span className="visually-hidden">Linked skill</span>
          <select
            onChange={(event) => onFilterChange("skillId", event.target.value)}
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
          <span className="visually-hidden">Tag</span>
          <select
            onChange={(event) => onFilterChange("tag", event.target.value)}
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

      <div className="library-workbench-footer">
        <CategoryNavigation />
        <div className="library-filter-summary" aria-live="polite">
          <span>
            {result.visiblePointCount} of {result.totalPointCount} achievement
            points
          </span>
          {hasFilters && (
            <button className="text-action" onClick={onReset} type="button">
              Reset filters
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
