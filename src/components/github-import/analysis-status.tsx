"use client";

import { Check, CircleAlert, Clock3, LoaderCircle } from "lucide-react";
import { useId } from "react";
import styles from "./analysis-status.module.css";

export type ImportLifecycle =
  | "created"
  | "preparing"
  | "ready-to-analyze"
  | "queued"
  | "analyzing"
  | "ready-to-review"
  | "approved"
  | "needs-input"
  | "partial"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "expired";

export interface AnalysisStatusError {
  code: string;
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number;
}

export interface AnalysisStatusProps {
  analysisStarted?: boolean;
  busy?: boolean;
  state: ImportLifecycle;
  stage: string;
  createdAt: string;
  updatedAt: string;
  cancellationAvailable: boolean;
  retryAvailable: boolean;
  resumeAvailable: boolean;
  error: AnalysisStatusError | null;
  /** Transport state is separate from the durable job state. */
  connectionState?: "connected" | "reconnecting" | "disconnected";
  onCancel(): void;
  onRetry(): void;
  onResumeSetup(): void;
}

type StepState = "complete" | "current" | "upcoming";

interface StatusCopy {
  title: string;
  description: string;
  tone: "pending" | "success" | "warning" | "error" | "neutral";
}

function statusCopy(
  state: ImportLifecycle,
  error: AnalysisStatusError | null,
): StatusCopy {
  const safeError = error?.message.trim();

  switch (state) {
    case "created":
      return {
        title: "Analysis hasn’t started",
        description:
          "Return to setup and explicitly start analysis when the selected evidence is ready.",
        tone: "neutral",
      };
    case "preparing":
      if (state === "preparing" && error?.code === "unavailable") {
        return {
          title: "Analysis worker unavailable",
          description:
            safeError ||
            "The local analysis worker is unavailable. Return to setup and try again later.",
          tone: "warning",
        };
      }
      return {
        title: "Preparing your analysis",
        description:
          safeError || "The selected evidence is being prepared for analysis.",
        tone: "pending",
      };
    case "ready-to-analyze":
      return {
        title: "Ready to analyze",
        description: "Return to setup to review the selected evidence.",
        tone: "neutral",
      };
    case "queued":
      return {
        title: "Analysis is queued",
        description:
          "Your project is in the local queue and will start when a worker is available.",
        tone: "pending",
      };
    case "analyzing":
      return {
        title: "Analyzing your project",
        description: "We’re reviewing the selected repository evidence.",
        tone: "pending",
      };
    case "ready-to-review":
      return {
        title: "Analysis ready to review",
        description:
          "Your drafts are ready. Nothing has been saved to Achievement Library.",
        tone: "success",
      };
    case "approved":
      return {
        title: "Selected achievements saved",
        description: "Your reviewed achievements are in Achievement Library.",
        tone: "success",
      };
    case "needs-input":
      return {
        title: "Analysis needs more context",
        description:
          safeError || "Add the missing detail to continue this analysis.",
        tone: "warning",
      };
    case "partial":
      return {
        title: "Partial analysis is ready",
        description:
          safeError ||
          "Some repository evidence was unavailable. Review the available drafts and their limitations.",
        tone: "warning",
      };
    case "failed":
      return {
        title: "Analysis couldn’t finish",
        description: safeError
          ? `${safeError} No achievements were saved.`
          : "No achievements were saved.",
        tone: "error",
      };
    case "cancelled":
      return {
        title: "Analysis cancelled",
        description:
          "This run has stopped. Your setup and selected evidence remain available.",
        tone: "neutral",
      };
    case "interrupted":
      return {
        title: "Analysis was interrupted",
        description: safeError
          ? `The local worker was interrupted. Its last checkpoint must be reconciled before another analysis request can run. Details: ${safeError}`
          : "The local runtime stopped the worker. Its last checkpoint must be reconciled before another analysis request can run.",
        tone: "warning",
      };
    case "expired":
      return {
        title: "Analysis result expired",
        description:
          "These drafts are no longer available. Start a fresh analysis when you’re ready.",
        tone: "neutral",
      };
  }
}

function isAnalysisComplete(state: ImportLifecycle) {
  return (
    state === "ready-to-review" || state === "partial" || state === "approved"
  );
}

function isReviewCurrent(state: ImportLifecycle) {
  return state === "ready-to-review" || state === "partial";
}

function isAllComplete(state: ImportLifecycle) {
  return state === "approved";
}

function formatUtcTimestamp(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;

  return `${new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(timestamp)} UTC`;
}

function formatRetryDelay(seconds: number) {
  const delay = Math.ceil(seconds);
  if (delay < 60) return `${delay} ${delay === 1 ? "second" : "seconds"}`;
  if (delay < 3_600) {
    const minutes = Math.ceil(delay / 60);
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  const hours = Math.ceil(delay / 3_600);
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

function stepState(
  state: ImportLifecycle,
  step: "setup" | "analysis" | "review",
): StepState {
  if (step === "setup") return "complete";
  if (step === "analysis") {
    return isAnalysisComplete(state) ? "complete" : "current";
  }
  if (isAllComplete(state)) return "complete";
  return isReviewCurrent(state) ? "current" : "upcoming";
}

function ProgressStep({
  number,
  title,
  description,
  state,
  last = false,
}: {
  number: number;
  title: string;
  description: string;
  state: StepState;
  last?: boolean;
}) {
  return (
    <li
      className={`${styles.progressStep} ${styles[`step${state}`]}`}
      aria-current={state === "current" ? "step" : undefined}
    >
      <span className={styles.stepMarker} aria-hidden="true">
        {state === "complete" ? <Check size={16} strokeWidth={2.5} /> : number}
      </span>
      <span className={styles.stepText}>
        <span className={styles.stepTitle}>{title}</span>
        <span className={styles.stepDescription}>{description}</span>
      </span>
      {!last && <span className={styles.connector} aria-hidden="true" />}
    </li>
  );
}

function StageIcon({
  state,
  tone,
  errorCode,
}: {
  state: ImportLifecycle;
  tone: StatusCopy["tone"];
  errorCode?: string;
}) {
  if (
    state === "queued" ||
    state === "analyzing" ||
    (state === "preparing" && errorCode !== "unavailable")
  ) {
    return (
      <LoaderCircle
        className={styles.spinner}
        data-testid="analysis-status-spinner"
        size={22}
        aria-hidden="true"
      />
    );
  }
  if (state === "ready-to-review" || state === "approved") {
    return <Check size={21} strokeWidth={2.5} aria-hidden="true" />;
  }
  if (
    state === "needs-input" ||
    state === "partial" ||
    state === "interrupted"
  ) {
    return <Clock3 size={21} aria-hidden="true" />;
  }
  if (tone === "error" || tone === "warning") {
    return <CircleAlert size={21} aria-hidden="true" />;
  }
  return (
    <span className={styles.neutralMark} aria-hidden="true">
      •
    </span>
  );
}

export function AnalysisStatus({
  analysisStarted = true,
  busy = false,
  state,
  stage,
  createdAt,
  updatedAt,
  cancellationAvailable,
  retryAvailable,
  resumeAvailable,
  error,
  connectionState = "connected",
  onCancel,
  onRetry,
  onResumeSetup,
}: AnalysisStatusProps) {
  const headingId = useId();
  const awaitingConsent =
    !analysisStarted && (state === "ready-to-analyze" || state === "partial");
  const message = awaitingConsent
    ? {
        title: "Evidence prepared — analysis has not started",
        description:
          "Review the evidence and its limitations, then explicitly approve one analysis run.",
        tone: "neutral" as const,
      }
    : statusCopy(state, error);
  const isActive =
    (state === "preparing" && error?.code !== "unavailable") ||
    state === "queued" ||
    state === "analyzing";
  const stageText = awaitingConsent
    ? state === "partial"
      ? "Evidence prepared with coverage limitations"
      : "Evidence prepared for your approval"
    : stage.trim() || (state === "queued" ? "Queued" : message.title);
  const createdLabel = formatUtcTimestamp(createdAt);
  const updatedLabel = formatUtcTimestamp(updatedAt);
  const retryDelay =
    error?.code === "rate-limited" &&
    typeof error.retryAfterSeconds === "number" &&
    error.retryAfterSeconds > 0
      ? formatRetryDelay(error.retryAfterSeconds)
      : null;

  const progressState = awaitingConsent ? "ready-to-analyze" : state;
  const analysisStepState = stepState(progressState, "analysis");
  const reviewStepState = stepState(progressState, "review");
  const toneClassName = {
    pending: styles.tonePending,
    success: styles.toneSuccess,
    warning: styles.toneWarning,
    error: styles.toneError,
    neutral: styles.toneNeutral,
  }[message.tone];

  return (
    <section
      className={styles.workspace}
      data-state={state}
      aria-labelledby={headingId}
    >
      <nav className={styles.progress} aria-label="GitHub import progress">
        <ol className={styles.progressList}>
          <ProgressStep
            number={1}
            title="Set up"
            description="Choose repository and scope"
            state={stepState(state, "setup")}
          />
          <ProgressStep
            number={2}
            title="Analyze"
            description="Inspect selected evidence"
            state={analysisStepState}
          />
          <ProgressStep
            number={3}
            title="Review & save"
            description="Review achievements"
            state={reviewStepState}
            last
          />
        </ol>
      </nav>

      <div className={`${styles.statusCard} ${toneClassName}`}>
        <div className={styles.statusHeader}>
          <span className={styles.statusIcon} aria-hidden="true">
            <StageIcon
              state={state}
              tone={message.tone}
              errorCode={error?.code}
            />
          </span>
          <div
            className={styles.statusMessage}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <h2 id={headingId}>{message.title}</h2>
            <p>{message.description}</p>
          </div>
        </div>

        <div className={styles.stagePanel}>
          <div className={styles.stageCopy}>
            <span className={styles.stageLabel}>
              {isActive ? "Current stage" : "Latest stage"}
            </span>
            <p
              className={styles.stageValue}
              aria-live="polite"
              aria-atomic="true"
            >
              {stageText}
            </p>
          </div>
          {updatedLabel && (
            <dl className={styles.timestamps}>
              {createdLabel && (
                <div>
                  <dt>Started</dt>
                  <dd>
                    <time dateTime={createdAt}>{createdLabel}</time>
                  </dd>
                </div>
              )}
              <div>
                <dt>Updated</dt>
                <dd>
                  <time dateTime={updatedAt}>{updatedLabel}</time>
                </dd>
              </div>
            </dl>
          )}
        </div>

        {connectionState !== "connected" && (
          <p
            className={styles.connectionNotice}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {connectionState === "reconnecting"
              ? "Reconnecting to status updates. Your analysis state is unchanged."
              : "Live status updates are unavailable. Your analysis may still be running; check again when you return."}
          </p>
        )}

        {retryDelay && (
          <p
            className={styles.retryNotice}
            id={`${headingId}-retry-delay-note`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            The last response asked us to wait about {retryDelay} before another
            attempt. No automatic retry will run.
          </p>
        )}

        {retryAvailable && (
          <p
            className={styles.retryActionNotice}
            id={`${headingId}-retry-note`}
          >
            Retry prepares the evidence again. AI analysis requires your
            confirmation.
          </p>
        )}

        {isActive && (
          <p className={styles.keepWorking}>
            Keep this tab open. Reloading or closing it discards unsaved
            evidence.
          </p>
        )}

        <div className={styles.actions}>
          <div className={styles.recoveryActions}>
            {resumeAvailable && (
              <button
                className={styles.resumeButton}
                type="button"
                onClick={onResumeSetup}
              >
                {state === "needs-input"
                  ? "Add missing context"
                  : "Return to setup"}
              </button>
            )}
            {retryAvailable && (
              <button
                className={styles.retryButton}
                type="button"
                disabled={busy}
                onClick={onRetry}
                aria-describedby={
                  retryDelay
                    ? `${headingId}-retry-note ${headingId}-retry-delay-note`
                    : `${headingId}-retry-note`
                }
              >
                {state === "expired"
                  ? "Start a new analysis"
                  : "Retry analysis"}
              </button>
            )}
          </div>
          <button
            className={styles.cancelButton}
            type="button"
            aria-disabled={!cancellationAvailable}
            aria-describedby={
              cancellationAvailable ? undefined : `${headingId}-cancel-note`
            }
            onClick={() => {
              if (cancellationAvailable) onCancel();
            }}
          >
            Cancel analysis
          </button>
          {!cancellationAvailable && (
            <span className={styles.srOnly} id={`${headingId}-cancel-note`}>
              Cancellation is unavailable for the current analysis state.
            </span>
          )}
          <a className={styles.libraryLink} href="/library">
            Back to library
          </a>
        </div>
      </div>
    </section>
  );
}
