"use client";

import { useEffect, useRef, useState } from "react";
import type { JobAnalysisResult } from "@/lib/ai/contracts";
import {
  clearJobAnalysisCache,
  writeJobAnalysisCache,
} from "@/lib/jd-analysis-cache";
import {
  clearDraft,
  EMPTY_DRAFT,
  estimateTokenCount,
  MAX_JD_CHARACTERS,
  readDraft,
  validateDraft,
  writeDraft,
} from "@/lib/jd-draft";
import type {
  DraftErrors,
  DraftFields,
  JobDescriptionDraft,
} from "@/lib/jd-draft";

type SaveState = "loading" | "saving" | "saved" | "error" | "idle";
type AnalysisState = "idle" | "loading" | "success" | "error";

const ANALYSIS_SECTIONS: Array<{
  key: keyof Pick<
    JobAnalysisResult,
    | "requiredQualifications"
    | "preferredQualifications"
    | "responsibilities"
    | "toolsAndPlatforms"
    | "domainConcepts"
    | "atsTerms"
    | "inferredContext"
  >;
  title: string;
}> = [
  { key: "requiredQualifications", title: "Explicit requirements" },
  { key: "preferredQualifications", title: "Preferred qualifications" },
  { key: "responsibilities", title: "Responsibilities" },
  { key: "toolsAndPlatforms", title: "Tools and platforms" },
  { key: "domainConcepts", title: "Domain concepts" },
  { key: "atsTerms", title: "Relevant ATS terms" },
  { key: "inferredContext", title: "Inferred context, not requirements" },
];

export default function JDWorkspace() {
  const [draft, setDraft] = useState<JobDescriptionDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [isReady, setIsReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [restoreMessage, setRestoreMessage] = useState("");
  const [saveFeedback, setSaveFeedback] = useState("");
  const [saveFeedbackError, setSaveFeedbackError] = useState(false);
  const [analysisState, setAnalysisState] = useState<AnalysisState>("idle");
  const [analysis, setAnalysis] = useState<JobAnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [analysisCacheSaved, setAnalysisCacheSaved] = useState(false);
  const analysisRequest = useRef<AbortController | null>(null);
  const autosaveTimeout = useRef<number | null>(null);
  const draftChanged = useRef(false);

  // Storage access itself can throw, before the storage helpers can catch it.
  function localStorageOrUnavailable(): Storage {
    try {
      return window.localStorage;
    } catch {
      return {
        getItem() {
          throw new Error("Local storage unavailable");
        },
        setItem() {
          throw new Error("Local storage unavailable");
        },
        removeItem() {
          throw new Error("Local storage unavailable");
        },
      } as unknown as Storage;
    }
  }

  useEffect(() => {
    const result = readDraft(localStorageOrUnavailable());
    setDraft(result.draft);
    setRestoreMessage(
      result.state === "invalid"
        ? "The saved draft could not be restored. A new draft can be saved."
        : result.state === "unavailable"
          ? "Local storage is unavailable in this browser."
          : result.state === "restored"
            ? "Your saved draft was restored from this device."
            : "",
    );
    setIsReady(true);
    setSaveState(
      result.state === "unavailable"
        ? "error"
        : result.state === "restored"
          ? "saved"
          : "idle",
    );
  }, []);

  useEffect(() => {
    if (!isReady || !draftChanged.current) return;

    setSaveState("saving");
    autosaveTimeout.current = window.setTimeout(() => {
      const hasDraftContent = Object.values(draft).some(
        (value) => typeof value === "string" && value.trim().length > 0,
      );
      const saved = hasDraftContent
        ? writeDraft(localStorageOrUnavailable(), draft)
        : clearDraft(localStorageOrUnavailable());
      setSaveState(saved ? (hasDraftContent ? "saved" : "idle") : "error");
      autosaveTimeout.current = null;
    }, 350);

    return () => {
      if (autosaveTimeout.current !== null)
        window.clearTimeout(autosaveTimeout.current);
    };
  }, [draft, isReady]);

  function updateField(field: keyof DraftFields, value: string) {
    draftChanged.current = true;
    setRestoreMessage("");
    clearJobAnalysisCache(localStorageOrUnavailable());
    setAnalysisCacheSaved(false);
    analysisRequest.current?.abort();
    analysisRequest.current = null;
    setAnalysis(null);
    setAnalysisError("");
    setAnalysisState("idle");
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setSaveFeedback("");
  }

  async function handleAnalyze() {
    const description = draft.jobDescription.trim();
    if (!description || description.length > MAX_JD_CHARACTERS) {
      setErrors((current) => ({
        ...current,
        jobDescription: !description
          ? "Enter a job description before analyzing."
          : `Keep the description under ${MAX_JD_CHARACTERS.toLocaleString()} characters.`,
      }));
      setAnalysisError("Check the job description and try again.");
      setAnalysisState("error");
      return;
    }

    analysisRequest.current?.abort();
    const controller = new AbortController();
    analysisRequest.current = controller;
    setErrors((current) => ({ ...current, jobDescription: undefined }));
    setAnalysis(null);
    setAnalysisError("");
    setAnalysisState("loading");

    try {
      const requestBody = {
        company: draft.company,
        roleTitle: draft.roleTitle,
        jobDescription: description,
      };
      const response = await fetch("/api/ai/analyze-job-description", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      const result = (await response.json()) as {
        analysis?: JobAnalysisResult;
        error?: string;
      };

      if (!response.ok || !result.analysis) {
        throw new Error(
          result.error || "Job description analysis failed. Try again.",
        );
      }
      setAnalysisCacheSaved(
        writeJobAnalysisCache(
          localStorageOrUnavailable(),
          draft,
          result.analysis,
        ),
      );
      setAnalysis(result.analysis);
      setAnalysisState("success");
    } catch (error) {
      if (controller.signal.aborted) return;
      setAnalysisError(
        error instanceof Error
          ? error.message
          : "Job description analysis failed. Try again.",
      );
      setAnalysisState("error");
    } finally {
      if (analysisRequest.current === controller) {
        analysisRequest.current = null;
      }
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateDraft(draft);
    setErrors(nextErrors);
    setSaveFeedback("");

    if (Object.keys(nextErrors).length > 0) {
      setSaveFeedbackError(true);
      setSaveFeedback("Fix the highlighted fields before saving.");
      return;
    }

    if (autosaveTimeout.current !== null)
      window.clearTimeout(autosaveTimeout.current);
    const saved = writeDraft(localStorageOrUnavailable(), draft);
    setSaveState(saved ? "saved" : "error");
    setSaveFeedbackError(!saved);
    setSaveFeedback(
      saved
        ? "Draft saved in this browser. You can open Resume builder now."
        : "Could not save the draft. Check this browser's storage settings.",
    );
  }

  function handleClear() {
    if (autosaveTimeout.current !== null)
      window.clearTimeout(autosaveTimeout.current);
    draftChanged.current = false;
    clearJobAnalysisCache(localStorageOrUnavailable());
    setAnalysisCacheSaved(false);
    analysisRequest.current?.abort();
    analysisRequest.current = null;
    setAnalysis(null);
    setAnalysisError("");
    setAnalysisState("idle");
    const cleared = clearDraft(localStorageOrUnavailable());
    setDraft(EMPTY_DRAFT);
    setErrors({});
    setRestoreMessage("");
    setSaveFeedback("");
    setSaveState(cleared ? "idle" : "error");
  }

  const saveMessage =
    saveState === "loading"
      ? "Loading draft"
      : saveState === "saving"
        ? "Saving..."
        : saveState === "saved"
          ? "Saved on this device"
          : saveState === "error"
            ? "Could not save locally"
            : "No saved draft";

  return (
    <section className="jd-page" aria-labelledby="page-title">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">
            NEW APPLICATION <span>01 / 04</span>
          </p>
          <h1 id="page-title">Start with the role.</h1>
          <p className="page-intro">Job description</p>
        </div>
      </div>

      {restoreMessage && (
        <p className="storage-notice" role="status">
          <span aria-hidden="true">ⓘ</span>
          {restoreMessage}
        </p>
      )}

      <form className="jd-form" onSubmit={handleSubmit} noValidate>
        <div className="form-topline">
          <div>
            <h2>Role details</h2>
            <p>Target position</p>
          </div>
          <span className="optional-label">LINK OPTIONAL</span>
        </div>

        <div className="metadata-fields">
          <div className="field-group">
            <label htmlFor="company">Company</label>
            <input
              autoComplete="organization"
              id="company"
              name="company"
              onChange={(event) => updateField("company", event.target.value)}
              placeholder="Company name"
              value={draft.company}
            />
          </div>
          <div className="field-group">
            <label htmlFor="role-title">Role title</label>
            <input
              autoComplete="organization-title"
              id="role-title"
              name="roleTitle"
              onChange={(event) => updateField("roleTitle", event.target.value)}
              placeholder="e.g. Backend Engineer"
              value={draft.roleTitle}
            />
          </div>
          <div className="field-group field-url">
            <label htmlFor="job-url">Job link</label>
            <input
              aria-describedby={errors.jobUrl ? "job-url-error" : undefined}
              aria-invalid={Boolean(errors.jobUrl)}
              autoComplete="url"
              id="job-url"
              inputMode="url"
              name="jobUrl"
              onChange={(event) => updateField("jobUrl", event.target.value)}
              placeholder="https://"
              value={draft.jobUrl}
            />
            {errors.jobUrl && (
              <span className="field-error" id="job-url-error">
                {errors.jobUrl}
              </span>
            )}
          </div>
        </div>

        <div className="form-divider" />

        <div className="description-heading">
          <label htmlFor="job-description">Job description</label>
          <span className="required-label">REQUIRED</span>
        </div>
        <textarea
          aria-describedby={
            errors.jobDescription ? "jd-error jd-count" : "jd-count"
          }
          aria-invalid={Boolean(errors.jobDescription)}
          id="job-description"
          name="jobDescription"
          onChange={(event) =>
            updateField("jobDescription", event.target.value)
          }
          placeholder="Paste the job description"
          spellCheck="false"
          value={draft.jobDescription}
        />
        {errors.jobDescription && (
          <p className="field-error" id="jd-error" role="alert">
            {errors.jobDescription}
          </p>
        )}

        <div className="form-footer">
          <div className="input-metrics" id="jd-count">
            <span
              className={
                draft.jobDescription.length > MAX_JD_CHARACTERS
                  ? "metric-over-limit"
                  : ""
              }
            >
              {draft.jobDescription.length.toLocaleString()} /{" "}
              {MAX_JD_CHARACTERS.toLocaleString()} characters
            </span>
            <span aria-hidden="true" className="metric-separator">
              ·
            </span>
            <span>
              ~{estimateTokenCount(draft.jobDescription).toLocaleString()}{" "}
              tokens
            </span>
          </div>
          <div className="form-actions">
            <button
              className="clear-button"
              onClick={handleClear}
              type="button"
            >
              Clear draft
            </button>
            <button
              className="clear-button analyze-button"
              disabled={!isReady || analysisState === "loading"}
              onClick={handleAnalyze}
              type="button"
            >
              {analysisState === "loading"
                ? "Analyzing..."
                : analysisState === "error"
                  ? "Retry analysis"
                  : "Analyze job description"}
            </button>
            <button
              className="primary-button"
              disabled={!isReady}
              type="submit"
            >
              Save draft <span aria-hidden="true">↗</span>
            </button>
          </div>
        </div>
        <div
          className={`draft-state is-${saveState}`}
          role="status"
          aria-live="polite"
        >
          <span className={`draft-dot draft-${saveState}`} aria-hidden="true" />
          {saveMessage}
        </div>
        {saveFeedback && (
          <p
            className={`form-save-feedback${saveFeedbackError ? " is-error" : ""}`}
            role="status"
          >
            {saveFeedback}
          </p>
        )}
      </form>

      {analysisState === "loading" && (
        <section className="jd-analysis" aria-live="polite" role="status">
          <p>Analyzing the job description...</p>
        </section>
      )}
      {analysisState === "error" && (
        <section
          className="jd-analysis jd-analysis-error"
          aria-live="polite"
          role="status"
        >
          <p>{analysisError}</p>
          <span>Your draft is unchanged. You can retry the analysis.</span>
        </section>
      )}
      {analysisState === "success" && analysis && (
        <section className="jd-analysis" aria-labelledby="analysis-title">
          <div className="jd-analysis-heading">
            <div>
              <h2 id="analysis-title">Job description analysis</h2>
              <p>Review what the AI extracted before continuing.</p>
            </div>
            <button
              className="clear-button"
              onClick={handleAnalyze}
              type="button"
            >
              Reanalyze
            </button>
          </div>
          {!analysisCacheSaved && (
            <p className="analysis-cache-notice" role="status">
              This analysis could not be saved in this browser. Resume builder
              recommendations may require analyzing the job again.
            </p>
          )}
          <div className="analysis-role">
            <div>
              <span>Target title</span>
              <strong>{analysis.targetTitle}</strong>
            </div>
            <div>
              <span>Seniority</span>
              <strong>{analysis.seniority}</strong>
            </div>
          </div>
          <div className="analysis-grid">
            {ANALYSIS_SECTIONS.map(({ key, title }) => (
              <section className="analysis-section" key={key}>
                <h3>{title}</h3>
                {analysis[key].length > 0 ? (
                  <ul>
                    {analysis[key].map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p>None identified</p>
                )}
              </section>
            ))}
            <section className="analysis-section">
              <h3>Synonyms and equivalent terms</h3>
              {analysis.terminology.length > 0 ? (
                <ul>
                  {analysis.terminology.map(({ term, alternatives }) => (
                    <li key={term}>
                      <strong>{term}</strong>
                      {alternatives.length > 0 &&
                        `: ${alternatives.join(", ")}`}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>None identified</p>
              )}
            </section>
          </div>
        </section>
      )}

      <div className="workspace-note">
        <span className="note-mark" aria-hidden="true">
          ✳
        </span>
        <span>Drafts are stored locally in this browser.</span>
      </div>
    </section>
  );
}
