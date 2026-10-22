import {
  JobAnalysisPanel,
  type AnalysisPanelProps,
} from "./job-analysis-panel";

export function ATSAnalysisPreview(props: AnalysisPanelProps) {
  // JobAnalysisResult only describes JD extraction. A score must never be
  // inferred here; a future match feature needs its own validated contract.
  return (
    <aside className="ats-preview" aria-labelledby="ats-preview-title">
      <div className="ats-preview-heading">
        <span className="ats-preview-icon" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10l-7-7Z" />
            <path d="M13 3v7h7M8 14h4m-4 3h3m5-5 1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5Z" />
          </svg>
        </span>
        <h2 id="ats-preview-title">ATS analysis preview</h2>
        <span className="ats-beta">Beta</span>
      </div>
      <p className="ats-preview-description">
        We&apos;ll analyze your job description to find key skills, keywords,
        and requirements that ATS systems look for.
      </p>
      <p className="ats-score-notice" role="note">
        <strong>Not scored.</strong> This preview extracts job requirements. A
        resume match has not been evaluated.
      </p>
      {props.state === "idle" ? (
        <p className="ats-preview-empty">
          Enter a job description, then select Analyze job description.
        </p>
      ) : (
        <JobAnalysisPanel {...props} embedded />
      )}
    </aside>
  );
}
