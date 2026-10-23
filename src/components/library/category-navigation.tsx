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
  { id: LIBRARY_SECTION_IDS.jobs, label: "Jobs" },
  { id: LIBRARY_SECTION_IDS.projects, label: "Projects" },
  { id: LIBRARY_SECTION_IDS.skills, label: "Skills" },
  { id: LIBRARY_SECTION_IDS.credentials, label: "Credentials" },
] as const;

/**
 * In-page navigation for the long library page. The controls jump to a
 * section; they never filter the library.
 */
export default function CategoryNavigation() {
  return (
    <nav aria-label="Library sections" className="library-category-nav">
      <a className="library-category-link" href={`#${LIBRARY_CONTENT_ID}`}>
        All
      </a>
      {LIBRARY_SECTIONS.map((section) => (
        <a
          className="library-category-link"
          href={`#${section.id}`}
          key={section.id}
        >
          {section.label}
        </a>
      ))}
    </nav>
  );
}
