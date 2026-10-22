"use client";

import { useEffect, useMemo, useRef } from "react";
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

const STICKY_BREAKPOINT = "(min-width: 1024px)";

/**
 * The workbench keeps global search, facets, section navigation, and the
 * result count together. Its measured height drives focus and anchor offsets
 * when it is pinned on wide screens.
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
  const workbenchRef = useRef<HTMLElement | null>(null);
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

  useEffect(() => {
    const workbenchRefValue = workbenchRef.current;
    if (!workbenchRefValue) return;
    const workbench: HTMLElement = workbenchRefValue;

    const root = document.documentElement;
    const topbar = document.querySelector<HTMLElement>(".topbar");
    const desktop = window.matchMedia(STICKY_BREAKPOINT);

    function measure() {
      root.style.setProperty(
        "--library-workbench-height",
        `${workbench.offsetHeight}px`,
      );
      const topbarIsPinned =
        desktop.matches &&
        topbar !== null &&
        getComputedStyle(topbar).position === "sticky";
      root.style.setProperty(
        "--library-topbar-height",
        topbarIsPinned ? `${topbar.offsetHeight}px` : "0px",
      );
    }

    const observer = new ResizeObserver(measure);
    observer.observe(workbench);
    if (topbar) observer.observe(topbar);
    desktop.addEventListener("change", measure);
    measure();

    return () => {
      observer.disconnect();
      desktop.removeEventListener("change", measure);
      root.style.removeProperty("--library-workbench-height");
      root.style.removeProperty("--library-topbar-height");
    };
  }, []);

  return (
    <section
      aria-label="Search and filter library"
      className="library-controls library-workbench"
      ref={workbenchRef}
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
          <span className="library-result-count">
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
