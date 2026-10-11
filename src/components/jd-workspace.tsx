"use client";

import { useEffect, useState } from "react";
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

  useEffect(() => {
    const result = readDraft(window.localStorage);
    setDraft(result.draft);
    setRestoreMessage(
      result.state === "invalid"
        ? "The saved draft could not be restored. A new draft can be saved."
        : result.state === "unavailable"
          ? "Local storage is unavailable in this browser."
          : "",
    );
    setIsReady(true);
    setSaveState(result.state === "restored" ? "saved" : "idle");
  }, []);

  useEffect(() => {
    if (!isReady) return;

    setSaveState("saving");
    const timeoutId = window.setTimeout(() => {
      const hasDraftContent = Object.values(draft).some(
        (value) => typeof value === "string" && value.trim().length > 0,
      );
      const saved = hasDraftContent
        ? writeDraft(window.localStorage, draft)
        : clearDraft(window.localStorage);
      setSaveState(saved ? (hasDraftContent ? "saved" : "idle") : "error");
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [draft, isReady]);

  function updateField(field: keyof DraftFields, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateDraft(draft);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) return;

    setSaveState(writeDraft(window.localStorage, draft) ? "saved" : "error");
  }

  function handleClear() {
    const cleared = clearDraft(window.localStorage);
    setDraft(EMPTY_DRAFT);
    setErrors({});
    setRestoreMessage("");
    setSaveState(cleared ? "idle" : "error");
  }

  const saveMessage =
    saveState === "loading"
      ? "Loading draft"
      : saveState === "saving"
        ? "Saving locally"
        : saveState === "saved"
          ? "Saved locally"
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
        <div className="draft-state" role="status" aria-live="polite">
          <span className={`draft-dot draft-${saveState}`} aria-hidden="true" />
          {saveMessage}
        </div>
      </div>

      {restoreMessage && (
        <p className="storage-notice" role="status">
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
              className="primary-button"
              disabled={!isReady}
              type="submit"
            >
              Save draft <span aria-hidden="true">↗</span>
            </button>
          </div>
        </div>
      </form>

      <div className="workspace-note">
        <span className="note-mark" aria-hidden="true">
          ✳
        </span>
        <span>Drafts are stored locally in this browser.</span>
      </div>
    </section>
  );
}
