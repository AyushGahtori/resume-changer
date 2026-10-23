import { Award, Briefcase, ChartColumn, Folder, Star } from "lucide-react";
import type { ResumeDataSource } from "@/lib/data/loaders";
import {
  formatMetricCount,
  getLibraryMetricCounts,
} from "@/lib/data/library-summary";
import type { ResumeLibrary } from "@/lib/schemas/resume-data";

type Props = {
  library: ResumeLibrary;
  source: ResumeDataSource;
};

type Metric = {
  /** Matches the `--color-category-*` token family. */
  category: "job" | "project" | "points" | "skills" | "credentials";
  label: string;
  icon: typeof Briefcase;
  count: number;
};

/**
 * A count that needs more than four characters keeps its own size so the
 * tile does not grow around it.
 */
const compactValueLength = 4;

function isCompactValue(value: string) {
  return value.length > compactValueLength;
}

/**
 * The one summary surface for a loaded library.
 *
 * The identity and the five metrics share a single bordered surface. The
 * identity is plain text and each metric is a compact tinted tile, so the
 * panel never nests a second card around the identity or around a metric.
 */
export default function ProfileSummary({ library, source }: Props) {
  const sourceLabel =
    source === "demo" ? "Fictional demo data" : "My resume data";

  /*
   * The counts come from the loaded library, so the summary keeps reporting
   * the library the user owns while the search facets narrow what the
   * workbench shows.
   */
  const counts = getLibraryMetricCounts(library);

  const metrics: Metric[] = [
    {
      category: "job",
      label: "Jobs",
      icon: Briefcase,
      count: counts.jobs,
    },
    {
      category: "project",
      label: "Projects",
      icon: Folder,
      count: counts.projects,
    },
    {
      category: "points",
      label: "Points",
      icon: Star,
      count: counts.points,
    },
    {
      category: "skills",
      label: "Skills",
      icon: ChartColumn,
      count: counts.skills,
    },
    {
      category: "credentials",
      label: "Credentials",
      icon: Award,
      count: counts.credentials,
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
        {metrics.map(({ category, label, icon: Icon, count }) => {
          const value = formatMetricCount(count);

          return (
            <div
              className="library-metric"
              data-category={category}
              key={category}
            >
              <dt>
                <Icon aria-hidden="true" size={18} strokeWidth={2.25} />
                <span>{label}</span>
              </dt>
              <dd className={isCompactValue(value) ? "is-compact" : undefined}>
                {value}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
