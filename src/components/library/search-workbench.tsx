"use client";

import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import CategoryNavigation from "@/components/library/category-navigation";
import LibrarySelect from "@/components/library/library-select";
import {
  formatLibraryResultCount,
  LIBRARY_SORT_OPTIONS,
  type FilteredLibrary,
  type LibraryFilters,
  type LibrarySort,
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
  sort: LibrarySort;
  onSortChange: (sort: LibrarySort) => void;
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
  sort,
  onSortChange,
  onReset,
}: Props) {
  const workbenchRef = useRef<HTMLElement | null>(null);
  const [isStuck, setIsStuck] = useState(false);
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
  const categoryCounts = {
    jobs: result.jobs.length,
    projects: result.projects.length,
    skills: result.skills.length,
    credentials: result.credentials.length,
    all:
      result.jobs.length +
      result.projects.length +
      result.skills.length +
      result.credentials.length,
  };

  useEffect(() => {
    const workbenchRefValue = workbenchRef.current;
    if (!workbenchRefValue) return;
    const workbench: HTMLElement = workbenchRefValue;

    const root = document.documentElement;
    const topbar = document.querySelector<HTMLElement>(".topbar");
    const desktop = window.matchMedia(STICKY_BREAKPOINT);

    function measure() {
      const workbenchHeight = `${workbench.offsetHeight}px`;
      if (
        root.style.getPropertyValue("--library-workbench-height") !==
        workbenchHeight
      ) {
        root.style.setProperty("--library-workbench-height", workbenchHeight);
      }
      const topbarIsPinned =
        desktop.matches &&
        topbar !== null &&
        getComputedStyle(topbar).position === "sticky";
      const topbarHeight =
        topbarIsPinned && topbar ? `${topbar.offsetHeight}px` : "0px";
      if (
        root.style.getPropertyValue("--library-topbar-height") !== topbarHeight
      ) {
        root.style.setProperty("--library-topbar-height", topbarHeight);
      }
      const stickyOffset = topbarIsPinned ? topbar.offsetHeight : 0;
      const nextIsStuck =
        topbarIsPinned &&
        window.scrollY > 0 &&
        workbench.getBoundingClientRect().top <= stickyOffset + 1;
      setIsStuck((current) =>
        current === nextIsStuck ? current : nextIsStuck,
      );
    }

    const observer = new ResizeObserver(measure);
    observer.observe(workbench);
    if (topbar) observer.observe(topbar);
    desktop.addEventListener("change", measure);
    window.addEventListener("scroll", measure, { passive: true });
    measure();

    return () => {
      observer.disconnect();
      desktop.removeEventListener("change", measure);
      window.removeEventListener("scroll", measure);
      root.style.removeProperty("--library-workbench-height");
      root.style.removeProperty("--library-topbar-height");
    };
  }, []);

  return (
    <section
      aria-label="Search and filter library"
      className="library-controls library-workbench"
      data-stuck={isStuck ? "true" : undefined}
      ref={workbenchRef}
    >
      <div className="library-search">
        <label className="library-search-field">
          <span className="visually-hidden">Search library</span>
          <Search
            aria-hidden="true"
            className="library-search-icon"
            size={16}
          />
          <input
            onChange={(event) => onFilterChange("query", event.target.value)}
            placeholder="Search achievements... (points, skills, tags, jobs, projects, credentials)"
            type="search"
            value={filters.query}
          />
        </label>
        {filters.query.length > 0 && (
          <button
            aria-label="Clear search"
            className="library-search-clear"
            onClick={() => onFilterChange("query", "")}
            type="button"
          >
            <X aria-hidden="true" size={14} />
          </button>
        )}
      </div>

      <div className="library-filter-row">
        <div className="library-filter-grid">
          <div>
            <LibrarySelect
              aria-label="Job or project"
              onChange={(value) => onFilterChange("experienceId", value)}
              options={[
                { label: "All experience", value: "" },
                ...library.jobs.map((job) => ({
                  label: `${job.title} · ${job.company}`,
                  value: `job:${job.id}`,
                })),
                ...library.projects.map((project) => ({
                  label: project.name,
                  value: `project:${project.id}`,
                })),
              ]}
              value={filters.experienceId}
              active={Boolean(filters.experienceId)}
            />
          </div>

          <div>
            <LibrarySelect
              aria-label="Point source"
              onChange={(value) => onFilterChange("sourceType", value)}
              options={[
                { label: "All sources", value: "" },
                ...sourceTypes.map((type) => ({ label: type, value: type })),
              ]}
              value={filters.sourceType}
              active={Boolean(filters.sourceType)}
            />
          </div>

          <div>
            <LibrarySelect
              aria-label="Point status"
              onChange={(value) =>
                onFilterChange("status", value as LibraryFilters["status"])
              }
              options={[
                { label: "All statuses", value: "all" },
                { label: "Enabled", value: "enabled" },
                { label: "Disabled", value: "disabled" },
              ]}
              value={filters.status}
              active={filters.status !== "all"}
            />
          </div>

          <div>
            <LibrarySelect
              aria-label="Linked skill"
              onChange={(value) => onFilterChange("skillId", value)}
              options={[
                { label: "All skills", value: "" },
                ...options.skills.map((skill) => ({
                  label: skill.name,
                  value: skill.id,
                })),
              ]}
              value={filters.skillId}
              active={Boolean(filters.skillId)}
            />
          </div>

          <div>
            <LibrarySelect
              aria-label="Tag"
              onChange={(value) => onFilterChange("tag", value)}
              options={[
                { label: "All tags", value: "" },
                ...options.tags.map((tag) => ({ label: tag, value: tag })),
              ]}
              value={filters.tag}
              active={Boolean(filters.tag)}
            />
          </div>
        </div>
        <div className="library-sort">
          <span>Sort</span>
          <LibrarySelect
            aria-label="Sort"
            onChange={(value) => onSortChange(value as LibrarySort)}
            options={LIBRARY_SORT_OPTIONS.map((option) => ({
              label: option.label,
              value: option.value,
            }))}
            value={sort}
          />
        </div>
      </div>

      <div className="library-workbench-footer">
        <CategoryNavigation counts={categoryCounts} />
        <div className="library-filter-summary" aria-live="polite">
          <span className="library-result-count">
            {formatLibraryResultCount(
              result.visiblePointCount,
              result.totalPointCount,
            )}
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
