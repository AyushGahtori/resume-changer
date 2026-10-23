import { getLibrarySummaryCounts } from "@/lib/data/library-summary";
import type { ResumeLibrary } from "@/lib/schemas/resume-data";

type Props = {
  library: ResumeLibrary;
  sourceLabel: string;
};

/**
 * The summary is the first content surface of the library page: a short
 * identity block followed by the counts of the loaded records.
 */
export default function ProfileSummary({ library, sourceLabel }: Props) {
  const counts = getLibrarySummaryCounts(library);

  return (
    <section className="library-overview" aria-label="Library summary">
      <div className="library-owner">
        <span className="source-indicator">{sourceLabel}</span>
        <h2>{library.profile.fullName}</h2>
        {library.profile.headline && <p>{library.profile.headline}</p>}
      </div>
      <dl className="library-counts">
        <div>
          <dt>Jobs</dt>
          <dd>{counts.jobs}</dd>
        </div>
        <div>
          <dt>Projects</dt>
          <dd>{counts.projects}</dd>
        </div>
        <div>
          <dt>Points</dt>
          <dd>{counts.points}</dd>
        </div>
        <div>
          <dt>Skills</dt>
          <dd>{counts.skills}</dd>
        </div>
        <div>
          <dt>Credentials</dt>
          <dd>{counts.credentials}</dd>
        </div>
      </dl>
    </section>
  );
}
