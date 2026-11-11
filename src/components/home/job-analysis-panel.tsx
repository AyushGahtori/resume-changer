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
  onSaveAnalysis?: () => void;
  onCancelAnalysis?: () => void;
  retryLocked?: boolean;
  outOfDate?: boolean;
  savingAnalysis?: boolean;
  saveError?: string;
};

export function JobAnalysisPanel({
  state,
  analysis,
  error,
  cacheSaved,
  onAnalyze,
  onSaveAnalysis,
  retryLocked = false,
  outOfDate = false,
  savingAnalysis = false,
  saveError = "",
  embedded = false,
}: AnalysisPanelProps & { embedded?: boolean }) {
  const Heading = embedded ? "h3" : "h2";
  const DetailsHeading = embedded ? "h4" : "h3";
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
            : outOfDate
              ? "This analysis is out of date."
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
          aria-disabled={state === "loading" || retryLocked ? true : undefined}
          aria-describedby={
            state === "error" ? "analysis-error-message" : undefined
          }
          onClick={() => {
            if (state !== "loading" && !retryLocked) onAnalyze();
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
            <div className="analysis-cache-notice" role="status">
              {saveError ? <p>{saveError}</p> : null}
              <p>This analysis was not added to your saved jobs.</p>
              {onSaveAnalysis && (
                <button
                  className="clear-button"
                  disabled={savingAnalysis}
                  onClick={onSaveAnalysis}
                  type="button"
                >
                  Save this analysis
                </button>
              )}
            </div>
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
          <div className="analysis-details-heading">
            <DetailsHeading>Extracted details</DetailsHeading>
            <p>Select a section to review.</p>
          </div>
          <div className="analysis-grid">
            {sections.map(([key, title]) => {
              const items = analysis[key];
              const isKeywordList =
                key === "toolsAndPlatforms" ||
                key === "domainConcepts" ||
                key === "atsTerms";
              const itemCount = items.length;

              return (
                <details
                  className={`analysis-section${key === "inferredContext" ? " analysis-inferred" : ""}`}
                  key={key}
                  open={key === "requiredQualifications"}
                >
                  <summary className="analysis-section-summary">
                    <span
                      className="analysis-section-title"
                      id={`analysis-${key}`}
                      role="heading"
                      aria-level={embedded ? 4 : 3}
                    >
                      {title}
                    </span>
                    <span className="analysis-section-count">
                      {itemCount === 0
                        ? "None identified"
                        : `${itemCount} ${itemCount === 1 ? "item" : "items"}`}
                    </span>
                  </summary>
                  <div
                    className="analysis-section-content"
                    id={`analysis-${key}-content`}
                  >
                    {itemCount > 0 ? (
                      <ul
                        className={
                          isKeywordList ? "analysis-chip-list" : undefined
                        }
                      >
                        {items.map((item, index) => (
                          <li key={`${index}-${item}`}>
                            {isKeywordList ? (
                              <span className="analysis-keyword-chip">
                                {item}
                              </span>
                            ) : (
                              item
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="analysis-empty-category">None identified</p>
                    )}
                  </div>
                </details>
              );
            })}
            <details className="analysis-section">
              <summary className="analysis-section-summary">
                <span
                  className="analysis-section-title"
                  id="analysis-terminology"
                  role="heading"
                  aria-level={embedded ? 4 : 3}
                >
                  Synonyms and equivalent terms
                </span>
                <span className="analysis-section-count">
                  {analysis.terminology.length === 0
                    ? "None identified"
                    : `${analysis.terminology.length} ${analysis.terminology.length === 1 ? "term" : "terms"}`}
                </span>
              </summary>
              <div
                className="analysis-section-content"
                id="analysis-terminology-content"
              >
                {analysis.terminology.length > 0 ? (
                  <ul className="analysis-terminology-list">
                    {analysis.terminology.map(
                      ({ term, alternatives }, index) => (
                        <li key={`${index}-${term}`}>
                          <strong>{term}</strong>
                          {alternatives.length > 0 && (
                            <span>: {alternatives.join(", ")}</span>
                          )}
                        </li>
                      ),
                    )}
                  </ul>
                ) : (
                  <p className="analysis-empty-category">None identified</p>
                )}
              </div>
            </details>
          </div>
        </>
      )}
    </section>
  );
}
