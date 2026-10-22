import type { JobAnalysisResult } from "@/lib/ai/contracts";

export type AnalysisState = "idle" | "loading" | "success" | "error";

const sections = [
  ["requiredQualifications", "Explicit requirements"],
  ["preferredQualifications", "Preferred qualifications"],
  ["responsibilities", "Responsibilities"],
  ["toolsAndPlatforms", "Tools and platforms"],
  ["domainConcepts", "Domain concepts"],
  ["atsTerms", "Relevant ATS terms"],
  ["inferredContext", "Inferred context, not requirements"],
] as const;

export type AnalysisPanelProps = {
  state: AnalysisState;
  analysis: JobAnalysisResult | null;
  error: string;
  cacheSaved: boolean;
  onAnalyze: () => void;
};

export function JobAnalysisPanel({
  state,
  analysis,
  error,
  cacheSaved,
  onAnalyze,
  embedded = false,
}: AnalysisPanelProps & { embedded?: boolean }) {
  const Heading = embedded ? "h3" : "h2";
  const CategoryHeading = embedded ? "h4" : "h3";
  const populatedSections = analysis
    ? sections.filter(([key]) => analysis[key].length > 0)
    : [];
  const hasTerminology = Boolean(analysis?.terminology.length);
  const emptySectionCount = analysis
    ? sections.length - populatedSections.length + Number(!hasTerminology)
    : 0;
  if (state === "idle") return null;
  return (
    <section
      className="jd-analysis analysis-panel"
      aria-labelledby="analysis-title"
    >
      <div className="jd-analysis-heading">
        <div>
          <Heading id="analysis-title">Job description analysis</Heading>
          <p>Review what the AI extracted before continuing.</p>
        </div>
      </div>
      <p className="analysis-status" role="status" aria-live="polite">
        {state === "loading"
          ? "Analyzing job description..."
          : state === "error"
            ? "Analysis could not be completed."
            : emptySectionCount === sections.length + 1
              ? "Analysis complete. No supported job details were identified."
              : "Job description analysis ready."}
      </p>
      {state === "loading" && (
        <div className="analysis-loading" aria-hidden="true">
          <span className="analysis-spinner" />
          <div className="analysis-skeleton">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
      )}
      <div
        className={
          state === "error" ? "analysis-error-notice" : "analysis-panel-actions"
        }
      >
        {state === "error" && (
          <span className="analysis-notice-icon" aria-hidden="true">
            !
          </span>
        )}
        {state === "error" && (
          <div id="analysis-error-message">
            <p>{error}</p>
            <p>Your draft is unchanged. You can retry the analysis.</p>
          </div>
        )}
        <button
          key="analysis-action"
          className="clear-button analysis-retry"
          aria-disabled={state === "loading"}
          aria-describedby={
            state === "error" ? "analysis-error-message" : undefined
          }
          onClick={() => {
            if (state !== "loading") onAnalyze();
          }}
          type="button"
        >
          {state === "loading"
            ? "Analyzing..."
            : state === "error"
              ? "Retry"
              : "Reanalyze"}
        </button>
      </div>
      {state === "success" && analysis && (
        <>
          {!cacheSaved && (
            <p className="analysis-cache-notice" role="status">
              This analysis could not be saved in this browser. Resume builder
              recommendations may require analyzing the job again.
            </p>
          )}
          <dl className="analysis-role">
            <div>
              <dt>Target title</dt>
              <dd>{analysis.targetTitle}</dd>
            </div>
            <div>
              <dt>Seniority</dt>
              <dd>{analysis.seniority}</dd>
            </div>
          </dl>
          <div className="analysis-grid">
            {populatedSections.map(([key, title]) => (
              <section
                className={`analysis-section${key === "inferredContext" ? " analysis-inferred" : ""}`}
                key={key}
                aria-labelledby={`analysis-${key}`}
              >
                <CategoryHeading id={`analysis-${key}`}>
                  {title}
                </CategoryHeading>
                <ul>
                  {analysis![key].map((item, index) => (
                    <li key={`${index}-${item}`}>{item}</li>
                  ))}
                </ul>
              </section>
            ))}
            {hasTerminology && (
              <section
                className="analysis-section"
                aria-labelledby="analysis-terminology"
              >
                <CategoryHeading id="analysis-terminology">
                  Synonyms and equivalent terms
                </CategoryHeading>
                <ul>
                  {analysis!.terminology.map(
                    ({ term, alternatives }, index) => (
                      <li key={`${index}-${term}`}>
                        <strong>{term}</strong>
                        {alternatives.length > 0 &&
                          `: ${alternatives.join(", ")}`}
                      </li>
                    ),
                  )}
                </ul>
              </section>
            )}
            {emptySectionCount > 0 && (
              <p className="analysis-empty-summary" role="note">
                {populatedSections.length === 0 && !hasTerminology
                  ? "No supported requirements or related signals were identified. Include the full job description for a more useful analysis."
                  : "No additional supported details were identified in the remaining categories."}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
