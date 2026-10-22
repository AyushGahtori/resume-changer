import {
  JobAnalysisPanel,
  type AnalysisPanelProps,
} from "./job-analysis-panel";
import { AnalysisSignalRows } from "./analysis-signal-rows";
import { buildAnalysisSignals } from "@/lib/ui/analysis-preview-model";

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
      {props.state === "success" && props.analysis && (
        <AnalysisSignalRows signals={buildAnalysisSignals(props.analysis)} />
      )}
      {props.state === "idle" ? (
        <p className="ats-preview-empty">
          Enter a job description, then select Analyze job description.
        </p>
      ) : (
        <JobAnalysisPanel {...props} embedded />
      )}
      <section className="ats-tip" aria-labelledby="ats-tip-title">
        <svg
          className="ats-tip-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1.2 1-1 2-1 4H9c0-2 .2-3-1-4Z" />
        </svg>
        <div>
          <h3 id="ats-tip-title">Pro tip</h3>
          <p>Review the extracted requirements before tailoring your resume.</p>
        </div>
      </section>
    </aside>
  );
}
