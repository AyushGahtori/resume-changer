"use client";

import { useEffect, useState } from "react";

/**
 * The library page renders one section per category. The identifiers live
 * here so the navigation and the sections cannot drift apart.
 */
export const LIBRARY_SECTION_IDS = {
  jobs: "library-jobs",
  projects: "library-projects",
  skills: "library-skills",
  credentials: "library-credentials",
} as const;

export const LIBRARY_CONTENT_ID = "library-content";

const LIBRARY_SECTIONS = [
  { id: "all", target: LIBRARY_CONTENT_ID, label: "All" },
  { id: "jobs", target: LIBRARY_SECTION_IDS.jobs, label: "Jobs" },
  { id: "projects", target: LIBRARY_SECTION_IDS.projects, label: "Projects" },
  { id: "skills", target: LIBRARY_SECTION_IDS.skills, label: "Skills" },
  {
    id: "credentials",
    target: LIBRARY_SECTION_IDS.credentials,
    label: "Credentials",
  },
] as const;

type LibraryCategory = (typeof LIBRARY_SECTIONS)[number]["id"];
export type LibraryCategoryCounts = Record<LibraryCategory, number>;

/**
 * In-page navigation for the long library page. The controls jump to a
 * section; they never filter the library.
 */
export default function CategoryNavigation({
  counts,
}: {
  counts: LibraryCategoryCounts;
}) {
  const [activeSection, setActiveSection] = useState<LibraryCategory>("all");

  useEffect(() => {
    let frame = 0;

    function updateActiveSection() {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        let stickyBottom = 0;
        const stickyElements = document.querySelectorAll<HTMLElement>(
          ".library-workspace-frame .topbar, .library-workbench",
        );

        for (const element of stickyElements) {
          if (getComputedStyle(element).position !== "sticky") continue;
          const bounds = element.getBoundingClientRect();
          if (bounds.top <= stickyBottom + 1) stickyBottom = bounds.bottom;
        }

        const activeLine =
          stickyBottom + Math.min(window.innerHeight * 0.45, 360);
        const requested = LIBRARY_SECTIONS.slice(1).find(
          (section) => section.target === window.location.hash.slice(1),
        );
        const requestedTarget = requested
          ? document.getElementById(requested.target)
          : null;
        if (requested && requestedTarget) {
          const bounds = requestedTarget.getBoundingClientRect();
          if (bounds.top < window.innerHeight && bounds.bottom > stickyBottom) {
            setActiveSection(requested.id);
            return;
          }
        }

        const active = LIBRARY_SECTIONS.slice(1)
          .filter((section) => {
            const target = document.getElementById(section.target);
            return target && target.getBoundingClientRect().top <= activeLine;
          })
          .at(-1);

        setActiveSection(active?.id ?? "all");
      });
    }

    updateActiveSection();
    window.addEventListener("scroll", updateActiveSection, { passive: true });
    window.addEventListener("resize", updateActiveSection);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("resize", updateActiveSection);
    };
  }, []);

  return (
    <nav aria-label="Library sections" className="library-category-nav">
      {LIBRARY_SECTIONS.map((section) => (
        <a
          aria-current={activeSection === section.id ? "location" : undefined}
          aria-label={`${section.label}, ${counts[section.id]} items`}
          className="library-category-link"
          data-section={section.id}
          href={`#${section.target}`}
          key={section.id}
          onClick={() => setActiveSection(section.id)}
        >
          {section.label}
          <span aria-hidden="true" className="library-category-count">
            {counts[section.id]}
          </span>
        </a>
      ))}
    </nav>
  );
}
