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
            {sections.map(([key, title]) => (
              <section
                className={`analysis-section${key === "inferredContext" ? " analysis-inferred" : ""}`}
                key={key}
                aria-labelledby={`analysis-${key}`}
              >
                <CategoryHeading id={`analysis-${key}`}>
                  {title}
                </CategoryHeading>
                {analysis[key].length > 0 ? (
                  <ul>
                    {analysis[key].map((item, index) => (
                      <li key={`${index}-${item}`}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="analysis-empty-category">None identified</p>
                )}
              </section>
            ))}
            <section
              className="analysis-section"
              aria-labelledby="analysis-terminology"
            >
              <CategoryHeading id="analysis-terminology">
                Synonyms and equivalent terms
              </CategoryHeading>
              {analysis.terminology.length > 0 ? (
                <ul>
                  {analysis.terminology.map(({ term, alternatives }, index) => (
                    <li key={`${index}-${term}`}>
                      <strong>{term}</strong>
                      {alternatives.length > 0 &&
                        `: ${alternatives.join(", ")}`}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="analysis-empty-category">None identified</p>
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
}
