"use client";

import { useEffect, useRef, useState } from "react";
import { Asterisk, ArrowUpRight, LoaderCircle, Sparkles } from "lucide-react";
import type { AnalysisState } from "@/components/home/job-analysis-panel";
import { ATSAnalysisPreview } from "@/components/home/ats-analysis-preview";
import { FieldError } from "@/components/home/field-error";
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

  function focusField(field: "jobDescription" | "jobUrl") {
    const input = document.getElementById(
      field === "jobDescription" ? "job-description" : "job-url",
    );
    window.requestAnimationFrame(() => {
      if (input?.isConnected) input.focus();
    });
  }

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
      focusField("jobDescription");
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
      focusField(nextErrors.jobDescription ? "jobDescription" : "jobUrl");
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
        <div className="page-heading-copy">
          <p className="eyebrow">
            NEW APPLICATION <span>01 / 04</span>
          </p>
          <h1 id="page-title">Start with the role.</h1>
          <p className="page-intro">
            Add the job description and let AI analyze it for a stronger,
            ATS-optimized resume.
          </p>
        </div>
      </div>

      {restoreMessage && (
        <p className="storage-notice" role="status">
          <span aria-hidden="true">ⓘ</span>
          {restoreMessage}
        </p>
      )}

      <div className="jd-work-grid">
        <form
          aria-labelledby="role-details-title"
          className="jd-form"
          onSubmit={handleSubmit}
          noValidate
        >
          <div className="form-topline">
            <div>
              <h2 id="role-details-title">Role details</h2>
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
                onChange={(event) =>
                  updateField("roleTitle", event.target.value)
                }
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
                <FieldError id="job-url-error" message={errors.jobUrl} />
              )}
            </div>
          </div>

          <div className="form-divider" />

          <div className="description-heading">
            <label htmlFor="job-description">Job description</label>
            <span className="required-label">REQUIRED</span>
          </div>
          <p className="jd-helper" id="jd-helper">
            Paste the job description from the company&apos;s career page.
          </p>
          <textarea
            aria-describedby={
              errors.jobDescription
                ? "jd-helper jd-error jd-count"
                : "jd-helper jd-count"
            }
            aria-invalid={Boolean(errors.jobDescription)}
            required
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
            <FieldError id="jd-error" message={errors.jobDescription} />
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
                className="home-action-button home-action-button--ghost"
                onClick={handleClear}
                type="button"
              >
                Clear draft
              </button>
              <button
                aria-busy={analysisState === "loading"}
                className="home-action-button home-action-button--secondary analyze-button"
                disabled={!isReady || analysisState === "loading"}
                onClick={handleAnalyze}
                type="button"
              >
                {analysisState === "loading" ? (
                  <>
                    <LoaderCircle
                      aria-hidden="true"
                      className="home-action-spinner"
                      size={18}
                    />
                    <span>Analyzing...</span>
                  </>
                ) : (
                  <>
                    <Sparkles aria-hidden="true" size={18} />
                    <span>
                      {analysisState === "error"
                        ? "Retry analysis"
                        : "Analyze job description"}
                    </span>
                  </>
                )}
              </button>
              <button
                className="home-action-button home-action-button--primary"
                disabled={!isReady}
                type="submit"
              >
                <span>Save draft</span>
                <ArrowUpRight aria-hidden="true" size={18} />
              </button>
            </div>
          </div>
          <div
            className={`draft-state is-${saveState}`}
            role="status"
            aria-live="polite"
          >
            <span
              className={`draft-dot draft-${saveState}`}
              aria-hidden="true"
            />
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

        <ATSAnalysisPreview
          state={analysisState}
          analysis={analysis}
          error={analysisError}
          cacheSaved={analysisCacheSaved}
          onAnalyze={handleAnalyze}
        />
      </div>

      <div className="workspace-note">
        <span className="note-mark" aria-hidden="true">
          <Asterisk aria-hidden="true" size={16} />
        </span>
        <span>Drafts are stored locally in this browser.</span>
      </div>
    </section>
  );
}
