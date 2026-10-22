import { Award, Briefcase, ChartColumn, Folder, Star } from "lucide-react";
import type { ResumeDataSource } from "@/lib/data/loaders";
import type { ResumeLibrary } from "@/lib/schemas/resume-data";

type Props = {
  library: ResumeLibrary;
  source: ResumeDataSource;
  /**
   * The number of achievement points in the whole library, not the number the
   * current search facets happen to show. The summary reports the library the
   * user owns; the search workbench reports what it is showing.
   */
  totalPointCount: number;
};

type Metric = {
  /** Matches the `--color-category-*` token family. */
  category: "job" | "project" | "points" | "skills" | "credentials";
  label: string;
  icon: typeof Briefcase;
  count: number;
};

/**
 * The one summary surface for a loaded library.
 *
 * The identity and the five metrics share a single bordered surface. The
 * identity is plain text and each metric is a compact tinted tile, so the
 * panel never nests a second card around the identity or around a metric.
 */
export default function ProfileSummary({
  library,
  source,
  totalPointCount,
}: Props) {
  const sourceLabel =
    source === "demo" ? "Fictional demo data" : "My resume data";

  const metrics: Metric[] = [
    {
      category: "job",
      label: "Jobs",
      icon: Briefcase,
      count: library.jobs.length,
    },
    {
      category: "project",
      label: "Projects",
      icon: Folder,
      count: library.projects.length,
    },
    {
      category: "points",
      label: "Points",
      icon: Star,
      count: totalPointCount,
    },
    {
      category: "skills",
      label: "Skills",
      icon: ChartColumn,
      count: library.skills.length,
    },
    {
      category: "credentials",
      label: "Credentials",
      icon: Award,
      count: library.credentials.length,
    },
  ];

  return (
    <section className="library-overview" aria-label="Library summary">
      <div className="library-identity library-owner">
        <p className="library-source-label source-indicator">{sourceLabel}</p>
        <h2>{library.profile.fullName}</h2>
        {library.profile.headline ? (
          <p className="library-headline">{library.profile.headline}</p>
        ) : null}
      </div>
      <dl className="library-metrics library-counts">
        {metrics.map(({ category, label, icon: Icon, count }) => (
          <div
            className="library-metric"
            data-category={category}
            key={category}
          >
            <dt>
              <Icon aria-hidden="true" size={14} strokeWidth={2.25} />
              <span>{label}</span>
            </dt>
            <dd>{count}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
