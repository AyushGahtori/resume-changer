"use client";

import { Search, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type {
  FilteredLibrary,
  LibraryFilters,
} from "@/lib/data/achievement-search";
import type { ResumeLibrary, Skill } from "@/lib/schemas/resume-data";

/**
 * The viewport width at which the workbench and the shared topbar become
 * sticky. It matches the breakpoint used in the shared stylesheet.
 */
const STICKY_BREAKPOINT = "(min-width: 1024px)";

type FilterOptions = {
  skills: Skill[];
  tags: string[];
};

type Props = {
  filters: LibraryFilters;
  library: ResumeLibrary;
  options: FilterOptions;
  result: FilteredLibrary;
  onChange: (patch: Partial<LibraryFilters>) => void;
  onReset: () => void;
};

/**
 * The search and filter workbench.
 *
 * The workbench is one surface that holds the search control, the advanced
 * filter facets, and the result summary in a fixed order. It is sticky on
 * wide viewports so the controls stay reachable while a long library is
 * browsed, and it stays in the normal flow on narrow viewports so it never
 * crowds the content.
 */
export default function SearchWorkbench({
  filters,
  library,
  options,
  result,
  onChange,
  onReset,
}: Props) {
  const hasFilters = Object.entries(filters).some(([key, value]) =>
    key === "status" ? value !== "all" : value !== "",
  );
  const sourceTypes = Array.from(
    new Set(
      [...library.jobs, ...library.projects].flatMap((item) =>
        item.points.map((point) => point.source.type),
      ),
    ),
  ).sort();
  const workbenchRef = useRef<HTMLElement | null>(null);

  // The sticky offset is measured rather than guessed. The shared topbar is
  // only pinned on wide viewports, and the workbench grows when the filter
  // row wraps, so the two measured heights feed the scroll offsets. That
  // keeps a focused control, a dropdown, or an anchor target from landing
  // underneath the sticky surface.
  useEffect(() => {
    const workbench = workbenchRef.current;
    if (!workbench) return;

    const topbar = document.querySelector<HTMLElement>(".topbar");
    const desktop = window.matchMedia(STICKY_BREAKPOINT);

    function measure() {
      document.documentElement.style.setProperty(
        "--library-workbench-height",
        `${workbench!.offsetHeight}px`,
      );
      const pinned = topbar
        ? getComputedStyle(topbar).position === "sticky"
        : false;
      document.documentElement.style.setProperty(
        "--library-topbar-height",
        pinned ? `${topbar!.offsetHeight}px` : "0px",
      );
    }

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(workbench);
    if (topbar) observer.observe(topbar);
    desktop.addEventListener("change", measure);

    return () => {
      observer.disconnect();
      desktop.removeEventListener("change", measure);
      document.documentElement.style.removeProperty(
        "--library-workbench-height",
      );
      document.documentElement.style.removeProperty("--library-topbar-height");
    };
  }, []);

  return (
    <section
      aria-label="Search and filter library"
      className="library-controls library-workbench"
      ref={workbenchRef}
    >
      <div className="library-search">
        <label className="library-search-field">
          <span>Search library</span>
          <Search
            aria-hidden="true"
            className="library-search-icon"
            size={16}
          />
          <input
            onChange={(event) => onChange({ query: event.target.value })}
            placeholder="Search achievements... (points, skills, tags, jobs, projects, credentials)"
            type="search"
            value={filters.query}
          />
        </label>
        {filters.query.length > 0 && (
          <button
            aria-label="Clear search"
            className="library-search-clear"
            onClick={() => onChange({ query: "" })}
            type="button"
          >
            <X aria-hidden="true" size={14} />
          </button>
        )}
      </div>

      <div className="library-filter-grid">
        <label>
          <span>Job or project</span>
          <select
            onChange={(event) => onChange({ experienceId: event.target.value })}
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
            onChange={(event) => onChange({ sourceType: event.target.value })}
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
          <span>Point status</span>
          <select
            onChange={(event) =>
              onChange({
                status: event.target.value as LibraryFilters["status"],
              })
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
            onChange={(event) => onChange({ skillId: event.target.value })}
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
            onChange={(event) => onChange({ tag: event.target.value })}
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
        {hasFilters && (
          <button className="text-action" onClick={onReset} type="button">
            Reset filters
          </button>
        )}
        <span className="library-result-count">
          {result.visiblePointCount} of {result.totalPointCount} achievement
          points
        </span>
      </div>
    </section>
  );
}
