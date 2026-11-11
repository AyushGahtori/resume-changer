"use client";
import { apiFetch as fetch } from "@/lib/cloud/api-fetch";
import { useWorkspaceAccount, useWorkspaceStorage } from "./account-session";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalysisState } from "@/components/home/job-analysis-panel";
import { ATSAnalysisPreview } from "@/components/home/ats-analysis-preview";
import {
  Asterisk,
  ArrowUpRight,
  CircleAlert,
  LoaderCircle,
  Sparkles,
} from "lucide-react";
import type { JobAnalysisResult } from "@/lib/ai/contracts";
import RoleDetailField from "@/components/home/role-detail-field";
import {
  clearJobAnalysisCache,
  writeJobAnalysisCache,
} from "@/lib/jd-analysis-cache";
import { SavedJobList } from "@/components/saved-jobs/saved-job-list";
import {
  deleteSavedJobRequest,
  loadSavedJobs,
  readSavedJob,
  rememberImportedAnalysis,
  saveAnalyzedJob,
  SELECTED_SAVED_JOB_KEY,
} from "@/lib/jobs/saved-job-client";
import { normalizeJobText, savedJobSummary } from "@/lib/jobs/saved-job";
import type { SavedJobRecord, SavedJobSummary } from "@/lib/jobs/saved-job";
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
import analyzeAction from "@/components/home/analyze-action.module.css";
import { ChoiceDialog } from "@/components/home/choice-dialog";
import PasteFromUrl from "@/components/home/paste-from-url";
import { ROLE_FIELDS } from "@/lib/ui/role-fields";

type SaveState = "loading" | "saving" | "saved" | "error" | "idle";

type PendingChoice =
  | { kind: "replace"; job: SavedJobRecord }
  | { kind: "delete"; job: SavedJobSummary };

type AnalyzedFields = {
  company: string;
  roleTitle: string;
  jobUrl: string;
  jobDescription: string;
};

function retryAfterSeconds(response: Response) {
  const header = response.headers.get("Retry-After")?.trim() ?? "";
  if (!/^\d+$/.test(header)) return null;
  const seconds = Number(header);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

function analysisFailureMessage(response: Response, error: string | undefined) {
  const base = error?.trim() || "Job description analysis failed. Try again.";
  const wait = response.status === 429 ? retryAfterSeconds(response) : null;
  if (wait === null) return base;
  return `${base} Try again in ${wait} seconds.`;
}

function draftHasText(fields: DraftFields) {
  return [
    fields.company,
    fields.roleTitle,
    fields.jobUrl,
    fields.jobDescription,
  ].some((value) => value.trim().length > 0);
}

function draftMatchesSavedJob(
  fields: DraftFields,
  job: {
    company: string;
    roleTitle: string;
    jobDescription: string;
    jobUrl: string;
  },
) {
  return (
    normalizeJobText(fields.company) === normalizeJobText(job.company) &&
    normalizeJobText(fields.roleTitle) === normalizeJobText(job.roleTitle) &&
    normalizeJobText(fields.jobDescription) ===
      normalizeJobText(job.jobDescription) &&
    fields.jobUrl.trim() === job.jobUrl.trim()
  );
}

export default function JDWorkspace({
  pasteFromUrlAvailable = false,
}: {
  pasteFromUrlAvailable?: boolean;
}) {
  const account = useWorkspaceAccount();
  const getWorkspaceStorage = useWorkspaceStorage();
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
  const [savedJobs, setSavedJobs] = useState<SavedJobSummary[]>([]);
  const [selectedJob, setSelectedJob] = useState<SavedJobRecord | null>(null);
  const [jobsNotice, setJobsNotice] = useState("");
  const [jobsLoadError, setJobsLoadError] = useState("");
  const [analyzedDraft, setAnalyzedDraft] = useState<AnalyzedFields | null>(
    null,
  );
  const [savingAnalysis, setSavingAnalysis] = useState(false);
  const [analysisSaveError, setAnalysisSaveError] = useState("");
  const [pendingChoice, setPendingChoice] = useState<PendingChoice | null>(
    null,
  );
  const [analyzeRetryAt, setAnalyzeRetryAt] = useState(0);
  const analysisRequest = useRef<AbortController | null>(null);
  const analysisAttempt = useRef(0);
  const analysisBeforeRequest = useRef<{
    analysis: JobAnalysisResult | null;
    state: AnalysisState;
    error: string;
    cacheSaved: boolean;
  } | null>(null);
  const autosaveTimeout = useRef<number | null>(null);
  const draftChanged = useRef(false);
  const draftRef = useRef(draft);
  const selectedJobRef = useRef(selectedJob);
  const jobsLoadRequest = useRef(0);
  const savingAnalysisRequest = useRef(false);
  draftRef.current = draft;
  selectedJobRef.current = selectedJob;

  function focusField(field: "jobDescription" | "jobUrl" | "company") {
    const input = document.getElementById(
      field === "jobDescription"
        ? "job-description"
        : field === "company"
          ? "company"
          : "job-url",
    );
    window.requestAnimationFrame(() => {
      if (input?.isConnected) input.focus();
    });
  }

  // Storage access itself can throw, before the storage helpers can catch it.
  const localStorageOrUnavailable = useCallback((): Storage => {
    try {
      return getWorkspaceStorage();
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
  }, [getWorkspaceStorage]);

  const [metricsAnnouncement, setMetricsAnnouncement] = useState("");
  const characterCount = draft.jobDescription.length;
  const tokenCount = estimateTokenCount(draft.jobDescription);
  const isOverLimit = characterCount > MAX_JD_CHARACTERS;
  const descriptionError = isOverLimit
    ? `Keep the description under ${MAX_JD_CHARACTERS.toLocaleString()} characters.`
    : errors.jobDescription;

  useEffect(() => {
    if (analyzeRetryAt <= Date.now()) return;
    const timeoutId = window.setTimeout(
      () => setAnalyzeRetryAt(0),
      analyzeRetryAt - Date.now(),
    );
    return () => window.clearTimeout(timeoutId);
  }, [analyzeRetryAt]);

  useEffect(() => {
    if (!isReady) return;
    // Wait for a pause in typing instead of announcing every keystroke.
    const timeoutId = window.setTimeout(() => {
      setMetricsAnnouncement(
        `${characterCount.toLocaleString()} of ${MAX_JD_CHARACTERS.toLocaleString()} characters, approximately ${tokenCount.toLocaleString()} tokens${isOverLimit ? ". Character limit exceeded." : "."}`,
      );
    }, 1000);
    return () => window.clearTimeout(timeoutId);
  }, [characterCount, tokenCount, isOverLimit, isReady]);

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
  }, [localStorageOrUnavailable]);

  const reloadSavedJobs = useCallback(async () => {
    const requestId = ++jobsLoadRequest.current;
    try {
      const jobs = await loadSavedJobs(localStorageOrUnavailable());
      if (requestId !== jobsLoadRequest.current) return;
      setSavedJobs(jobs);
      setJobsLoadError("");
    } catch (error) {
      if (requestId !== jobsLoadRequest.current) return;
      setJobsLoadError(
        error instanceof Error
          ? error.message
          : "Saved job analyses could not be loaded.",
      );
    }
  }, [localStorageOrUnavailable]);

  useEffect(() => {
    void reloadSavedJobs();
  }, [reloadSavedJobs]);

  useEffect(() => {
    if (!isReady) return;
    let cancelled = false;
    let storedId: string | null;
    try {
      storedId = localStorageOrUnavailable().getItem(SELECTED_SAVED_JOB_KEY);
    } catch {
      return;
    }
    if (!storedId) return;
    void readSavedJob(storedId)
      .then((job) => {
        if (cancelled || draftChanged.current || analysisRequest.current)
          return;
        let currentId: string | null = null;
        try {
          currentId = localStorageOrUnavailable().getItem(
            SELECTED_SAVED_JOB_KEY,
          );
        } catch {
          return;
        }
        if (currentId !== job.id) return;
        if (!draftMatchesSavedJob(draftRef.current, job)) return;
        setSelectedJob(job);
        setAnalyzedDraft({
          company: job.company,
          roleTitle: job.roleTitle,
          jobUrl: job.jobUrl,
          jobDescription: job.jobDescription,
        });
        setAnalysis(job.analysis);
        setAnalysisError("");
        setAnalysisState("success");
        setAnalysisCacheSaved(true);
        setAnalysisSaveError("");
        setRestoreMessage("");
      })
      .catch(() => {
        /* The list can still show the job without opening it. */
      });
    return () => {
      cancelled = true;
    };
  }, [isReady, localStorageOrUnavailable]);

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
  }, [draft, isReady, localStorageOrUnavailable]);

  function updateField(field: keyof DraftFields, value: string) {
    draftChanged.current = true;
    setRestoreMessage("");
    if (analysisRequest.current) {
      analysisAttempt.current += 1;
      analysisRequest.current.abort();
      analysisRequest.current = null;
    }
    setAnalysisState((current) => {
      if (current !== "loading") return current;
      setAnalysis(null);
      setAnalysisError("");
      setAnalysisCacheSaved(false);
      setAnalyzedDraft(null);
      return "idle";
    });
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setSaveFeedback("");
  }

  function applySavedJob(job: SavedJobRecord) {
    draftChanged.current = true;
    setSelectedJob(job);
    try {
      localStorageOrUnavailable().setItem(SELECTED_SAVED_JOB_KEY, job.id);
    } catch {
      /* Choosing a saved job still updates the form. */
    }
    setDraft({
      schemaVersion: 1,
      company: job.company,
      roleTitle: job.roleTitle,
      jobUrl: job.jobUrl,
      jobDescription: job.jobDescription,
    });
    setAnalyzedDraft({
      company: job.company,
      roleTitle: job.roleTitle,
      jobUrl: job.jobUrl,
      jobDescription: job.jobDescription,
    });
    setAnalysis(job.analysis);
    setAnalysisError("");
    setAnalysisSaveError("");
    setAnalysisState("success");
    setAnalysisCacheSaved(true);
    setErrors({});
    setJobsNotice("");
    setRestoreMessage("");
  }

  async function handleSelectSavedJob(id: string) {
    try {
      const job = await readSavedJob(id);
      const current = draftRef.current;
      const selected = selectedJobRef.current;
      const matchesSavedDraft =
        draftMatchesSavedJob(current, job) ||
        (selected !== null && draftMatchesSavedJob(current, selected));
      if (draftHasText(current) && !matchesSavedDraft) {
        setPendingChoice({ kind: "replace", job });
        return;
      }
      applySavedJob(job);
    } catch (error) {
      setJobsNotice(
        error instanceof Error
          ? error.message
          : "The saved job could not be loaded.",
      );
    }
  }

  function handleDeleteSavedJob(job: SavedJobSummary) {
    setPendingChoice({ kind: "delete", job });
  }

  async function removeSavedJob(job: SavedJobSummary) {
    try {
      await deleteSavedJobRequest(job.id);
      setSavedJobs((current) => current.filter((item) => item.id !== job.id));
      const storage = localStorageOrUnavailable();
      let storedSelection = false;
      try {
        storedSelection = storage.getItem(SELECTED_SAVED_JOB_KEY) === job.id;
      } catch {
        storedSelection = selectedJobRef.current?.id === job.id;
      }
      if (storedSelection || selectedJobRef.current?.id === job.id) {
        try {
          storage.removeItem(SELECTED_SAVED_JOB_KEY);
        } catch {
          /* The card is already gone. The form text stays. */
        }
      }
      if (selectedJobRef.current?.id === job.id) {
        if (autosaveTimeout.current !== null) {
          window.clearTimeout(autosaveTimeout.current);
          autosaveTimeout.current = null;
        }
        const current = draftRef.current;
        const hasText = Object.values(current).some(
          (value) => typeof value === "string" && value.trim().length > 0,
        );
        const kept = hasText
          ? writeDraft(storage, current)
          : clearDraft(storage);
        setSaveState(kept ? (hasText ? "saved" : "idle") : "error");
        clearJobAnalysisCache(storage);
        setAnalysisCacheSaved(false);
        setSelectedJob(null);
        setAnalyzedDraft(null);
        setAnalysis(null);
        setAnalysisError("");
        setAnalysisSaveError("");
        setAnalysisState("idle");
      }
      setJobsNotice("");
    } catch (error) {
      setJobsNotice(
        error instanceof Error
          ? error.message
          : "The saved job could not be deleted.",
      );
    }
  }

  function handleCancelAnalysis() {
    if (!analysisRequest.current) return;
    analysisAttempt.current += 1;
    analysisRequest.current.abort();
    analysisRequest.current = null;
    const previous = analysisBeforeRequest.current;
    if (!previous) {
      setAnalysisState((current) => (current === "loading" ? "idle" : current));
      return;
    }
    setAnalysis(previous.analysis);
    setAnalysisError(previous.error);
    setAnalysisCacheSaved(previous.cacheSaved);
    setAnalysisState(previous.state === "loading" ? "idle" : previous.state);
  }

  async function handleSaveAnalysis() {
    if (!analysis || !analyzedDraft || savingAnalysisRequest.current) return;
    savingAnalysisRequest.current = true;
    setSavingAnalysis(true);
    try {
      const job = await saveAnalyzedJob({
        ...analyzedDraft,
        analysis,
      });
      const storage = localStorageOrUnavailable();
      const cached = writeJobAnalysisCache(storage, analyzedDraft, analysis);
      if (cached) rememberImportedAnalysis(storage, analyzedDraft);
      setSelectedJob(job);
      setSavedJobs((current) => [
        savedJobSummary(job),
        ...current.filter((item) => item.id !== job.id),
      ]);
      try {
        storage.setItem(SELECTED_SAVED_JOB_KEY, job.id);
      } catch {
        /* The account copy is already stored. */
      }
      setAnalysisCacheSaved(true);
      setAnalysisSaveError("");
      setJobsNotice("");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "This analysis was not added to your saved jobs.";
      setAnalysisSaveError(message);
      setJobsNotice(message);
    } finally {
      savingAnalysisRequest.current = false;
      setSavingAnalysis(false);
    }
  }

  function confirmPendingChoice() {
    const choice = pendingChoice;
    setPendingChoice(null);
    if (!choice) return;
    if (choice.kind === "replace") {
      applySavedJob(choice.job);
      return;
    }
    void removeSavedJob(choice.job);
  }

  async function handleAnalyze() {
    const company = draft.company.trim();
    const description = draft.jobDescription.trim();
    const nextErrors: DraftErrors = {};
    if (!company) {
      nextErrors.company = "Enter a company name before analyzing.";
    }
    if (!description) {
      nextErrors.jobDescription = "Enter a job description before analyzing.";
    } else if (draft.jobDescription.length > MAX_JD_CHARACTERS) {
      nextErrors.jobDescription = `Keep the description under ${MAX_JD_CHARACTERS.toLocaleString()} characters.`;
    }
    const urlError = validateDraft(draft).jobUrl;
    if (urlError) nextErrors.jobUrl = urlError;
    if (nextErrors.company || nextErrors.jobDescription || nextErrors.jobUrl) {
      setErrors((current) => ({
        ...current,
        company: nextErrors.company,
        jobDescription: nextErrors.jobDescription,
        jobUrl: nextErrors.jobUrl,
      }));
      focusField(
        nextErrors.company
          ? "company"
          : nextErrors.jobDescription
            ? "jobDescription"
            : "jobUrl",
      );
      return;
    }
    if (Date.now() < analyzeRetryAt) return;

    const wait = (response: Response) => {
      const seconds =
        response.status === 429 ? retryAfterSeconds(response) : null;
      if (seconds !== null && seconds > 0) {
        setAnalyzeRetryAt(Date.now() + seconds * 1000);
      }
      return seconds;
    };

    analysisBeforeRequest.current = {
      analysis,
      state: analysisState,
      error: analysisError,
      cacheSaved: analysisCacheSaved,
    };
    analysisRequest.current?.abort();
    const controller = new AbortController();
    analysisRequest.current = controller;
    const attempt = ++analysisAttempt.current;
    setErrors((current) => ({
      ...current,
      company: undefined,
      jobDescription: undefined,
      jobUrl: undefined,
    }));
    setAnalysis(null);
    setAnalysisError("");
    setAnalysisSaveError("");
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
      let result: { analysis?: JobAnalysisResult; error?: string };
      try {
        result = (await response.json()) as {
          analysis?: JobAnalysisResult;
          error?: string;
        };
      } catch (parseError) {
        if (attempt !== analysisAttempt.current || controller.signal.aborted) {
          return;
        }
        if (wait(response) !== null) {
          throw new Error(analysisFailureMessage(response, undefined));
        }
        throw parseError;
      }

      if (attempt !== analysisAttempt.current || controller.signal.aborted) {
        return;
      }
      if (!response.ok || !result.analysis) {
        wait(response);
        throw new Error(analysisFailureMessage(response, result.error));
      }
      const analyzedFields: AnalyzedFields = {
        company,
        roleTitle: draft.roleTitle.trim(),
        jobUrl: draft.jobUrl.trim(),
        jobDescription: description,
      };
      const storage = localStorageOrUnavailable();
      writeJobAnalysisCache(storage, analyzedFields, result.analysis);
      let accountSaved = false;
      try {
        const job = await saveAnalyzedJob({
          ...analyzedFields,
          analysis: result.analysis,
        });
        const stillCurrent =
          attempt === analysisAttempt.current && !controller.signal.aborted;
        setSavedJobs((current) => [
          savedJobSummary(job),
          ...current.filter((item) => item.id !== job.id),
        ]);
        if (!stillCurrent) return;
        setSelectedJob(job);
        try {
          storage.setItem(SELECTED_SAVED_JOB_KEY, job.id);
        } catch {
          /* The account copy is already stored. */
        }
        accountSaved = true;
        rememberImportedAnalysis(storage, analyzedFields);
        setAnalysisSaveError("");
        setJobsNotice("");
      } catch (error) {
        if (attempt !== analysisAttempt.current || controller.signal.aborted) {
          return;
        }
        const message =
          error instanceof Error
            ? error.message
            : "This analysis was not added to your saved jobs.";
        setAnalysisSaveError(message);
        setJobsNotice(message);
      }
      if (attempt !== analysisAttempt.current || controller.signal.aborted) {
        return;
      }
      setAnalyzedDraft(analyzedFields);
      setAnalysisCacheSaved(accountSaved);
      setAnalysis(result.analysis);
      setAnalysisState("success");
    } catch (error) {
      if (attempt !== analysisAttempt.current || controller.signal.aborted) {
        return;
      }
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
    const analysisSavedForThisDraft = Boolean(
      saved &&
      selectedJob &&
      analysisCacheSaved &&
      analyzedDraft &&
      draftMatchesSavedJob(draft, analyzedDraft),
    );
    setSaveState(saved ? "saved" : "error");
    setSaveFeedbackError(!saved);
    setSaveFeedback(
      saved
        ? analysisSavedForThisDraft
          ? "Draft saved in this browser. You can open Resume builder now."
          : "Draft saved in this browser."
        : "Could not save the draft. Check this browser's storage settings.",
    );
  }

  function handleClear() {
    if (autosaveTimeout.current !== null)
      window.clearTimeout(autosaveTimeout.current);
    draftChanged.current = false;
    analysisAttempt.current += 1;
    analysisRequest.current?.abort();
    analysisRequest.current = null;
    const storage = localStorageOrUnavailable();
    clearJobAnalysisCache(storage);
    try {
      storage.removeItem(SELECTED_SAVED_JOB_KEY);
    } catch {
      /* The form is still cleared. */
    }
    setAnalysisCacheSaved(false);
    setSelectedJob(null);
    setAnalyzedDraft(null);
    setAnalysis(null);
    setAnalysisError("");
    setAnalysisSaveError("");
    setAnalysisState("idle");
    setPendingChoice(null);
    const cleared = clearDraft(storage);
    setDraft(EMPTY_DRAFT);
    setErrors({});
    setRestoreMessage("");
    setSaveFeedback("");
    setSaveState(cleared ? "idle" : "error");
  }

  function handleExtractedJobDescription(text: string) {
    updateField("jobDescription", text);
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

  const isAnalyzing = analysisState === "loading";
  const analyzeRetryLocked = analyzeRetryAt > Date.now();
  const analysisOnScreen = analysisState === "success" && analysis !== null;
  const analysisOutOfDate = Boolean(
    analysisOnScreen &&
    analyzedDraft &&
    !draftMatchesSavedJob(draft, analyzedDraft),
  );

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
      {jobsNotice && (
        <p className="storage-notice">
          <span aria-hidden="true">ⓘ</span>
          {jobsNotice}
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
            {ROLE_FIELDS.map((descriptor) => (
              <RoleDetailField
                descriptor={descriptor}
                error={errors[descriptor.field]}
                key={descriptor.field}
                onChange={(value) => updateField(descriptor.field, value)}
                value={draft[descriptor.field]}
              />
            ))}
          </div>

          <div className="form-divider" />

          <div className="description-heading">
            <label htmlFor="job-description">Job description</label>
            <span className="required-label">REQUIRED</span>
          </div>
          <p className="description-helper" id="jd-helper">
            Paste the job description from the company&apos;s career page.
          </p>
          <textarea
            aria-describedby={
              descriptionError
                ? "jd-helper jd-error jd-count"
                : "jd-helper jd-count"
            }
            aria-invalid={Boolean(descriptionError)}
            disabled={!isReady}
            required
            id="job-description"
            name="jobDescription"
            onChange={(event) =>
              updateField("jobDescription", event.target.value)
            }
            placeholder="Paste the job description"
            rows={7}
            spellCheck="false"
            value={draft.jobDescription}
          />
          {descriptionError && (
            <p className="field-error jd-error" id="jd-error" role="alert">
              <CircleAlert aria-hidden="true" size={14} />
              <span>{descriptionError}</span>
            </p>
          )}

          <div className="form-footer">
            <div className="input-metrics" id="jd-count">
              <span className={isOverLimit ? "metric-over-limit" : undefined}>
                {characterCount.toLocaleString()} /{" "}
                {MAX_JD_CHARACTERS.toLocaleString()} characters
              </span>
              <span className="token-metric">
                <span aria-hidden="true" className="metric-separator">
                  {"\u00b7"}
                </span>
                <span>~{tokenCount.toLocaleString()} tokens</span>
              </span>
              <span
                className="metrics-announcement"
                aria-live="polite"
                aria-atomic="true"
              >
                {metricsAnnouncement}
              </span>
            </div>
            <PasteFromUrl
              available={pasteFromUrlAvailable}
              jobUrl={draft.jobUrl}
              onExtracted={handleExtractedJobDescription}
            />
            <div className="form-actions">
              <button
                className="home-action-button home-action-button--ghost"
                disabled={!isReady}
                onClick={handleClear}
                type="button"
              >
                Clear draft
              </button>
              <button
                aria-busy={isAnalyzing}
                className={`home-action-button home-action-button--primary ${analyzeAction.analyze}`}
                disabled={!isReady || isAnalyzing || analyzeRetryLocked}
                onClick={handleAnalyze}
                type="button"
              >
                {isAnalyzing ? (
                  <>
                    <span className="home-action-icon">
                      <LoaderCircle
                        aria-hidden="true"
                        className="home-action-spinner"
                        size={16}
                      />
                    </span>
                    <span>Analyzing...</span>
                  </>
                ) : (
                  <>
                    <span className="home-action-icon">
                      <Sparkles aria-hidden="true" size={16} />
                    </span>
                    <span>
                      {analysisState === "error"
                        ? "Retry analysis"
                        : "Analyze job description"}
                    </span>
                  </>
                )}
              </button>
              {isAnalyzing && (
                <button
                  className="home-action-button home-action-button--ghost"
                  onClick={handleCancelAnalysis}
                  type="button"
                >
                  Cancel
                </button>
              )}
              <button
                className="home-action-button home-action-button--secondary"
                disabled={!isReady}
                type="submit"
              >
                <span>Save draft</span>
                <span className="home-action-icon">
                  <ArrowUpRight aria-hidden="true" size={18} />
                </span>
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
              {saveFeedback}{" "}
              {!saveFeedbackError && saveFeedback.includes("Resume builder") ? (
                <Link href="/generate">Continue to your resume</Link>
              ) : null}
            </p>
          )}
          {analysisOutOfDate && (
            <p className="saved-job-unsaved">
              {selectedJob
                ? "This analysis is out of date. Analyze again to update it, or choose the saved job to restore it."
                : "This analysis is out of date. Analyze again to update it."}
            </p>
          )}
          <SavedJobList
            jobs={savedJobs}
            loadError={jobsLoadError}
            onDelete={handleDeleteSavedJob}
            onRetry={() => void reloadSavedJobs()}
            onSelect={handleSelectSavedJob}
            selectedId={selectedJob?.id ?? null}
          />
        </form>

        <ATSAnalysisPreview
          state={analysisState}
          analysis={analysis}
          error={analysisError}
          cacheSaved={analysisCacheSaved}
          onAnalyze={handleAnalyze}
          onCancelAnalysis={handleCancelAnalysis}
          onSaveAnalysis={handleSaveAnalysis}
          outOfDate={analysisOutOfDate}
          retryLocked={analyzeRetryLocked}
          saveError={analysisSaveError}
          savingAnalysis={savingAnalysis}
        />
      </div>

      <div className="workspace-note">
        <span className="note-mark" aria-hidden="true">
          <Asterisk aria-hidden="true" size={16} />
        </span>
        <span>
          {`Unfinished drafts stay in this browser. Analyzed jobs stay ${
            account ? "on this account" : "on this device"
          }.`}
        </span>
      </div>
      {pendingChoice?.kind === "replace" && (
        <ChoiceDialog
          cancelLabel="Keep what I typed"
          confirmLabel="Replace draft"
          message={`Replace the text in this form with the saved analysis for ${pendingChoice.job.company}? The company, role, link, and description you typed will be discarded.`}
          onCancel={() => setPendingChoice(null)}
          onConfirm={confirmPendingChoice}
          title="Replace this draft?"
        />
      )}
      {pendingChoice?.kind === "delete" && (
        <ChoiceDialog
          cancelLabel="Keep it"
          confirmLabel="Delete saved analysis"
          message={`Delete the saved analysis for ${pendingChoice.job.company}? Resumes already created stay in history. The text in this form stays.`}
          onCancel={() => setPendingChoice(null)}
          onConfirm={confirmPendingChoice}
          title="Delete this saved analysis?"
        />
      )}
    </section>
  );
}
