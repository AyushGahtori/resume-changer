import { isRunFailureCategory, type RunFailureCategory } from "./contracts";

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

export type JobLifecycle =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "needs-input";

export type BusyState = "idle" | "preparing" | "submitting" | "analyzing";

export type AttemptMarker =
  | "not-submitted"
  | "submitting"
  | "may-have-been-submitted"
  | "result-persisted"
  | "unknown";

export interface RunStatusInput {
  lifecycle: ImportLifecycle;
  /** The run whose current lifecycle/result is being rendered. */
  runId: string | null;
  jobState?: JobLifecycle | null;
  busy?: BusyState;
  preparedSelection?: "available" | "missing";
  attempt?: {
    runId: string | null;
    marker: AttemptMarker;
    number?: number;
  };
  result?:
    | { availability: "missing" }
    | { availability: "available"; runId: string; draftCount?: number };
  savedCount?: number;
  failure?: {
    runId: string;
    category: RunFailureCategory;
    stage?: string;
  };
}

export type RunPhase =
  | "not-started"
  | "preparing"
  | "awaiting-approval"
  | "submitting"
  | "analyzing"
  | "interrupted-unknown"
  | "failed"
  | "ready-with-drafts"
  | "ready-with-zero-drafts"
  | "saved"
  | "cancelled"
  | "needs-input"
  | "expired";

export interface RunStatusView {
  phase: RunPhase;
  title: string;
  summary: string;
  tone: "neutral" | "pending" | "warning" | "error" | "success";
  categoryLabel?: string;
  stageLabel?: string;
  draftCount?: number;
  outcomeUnknown: boolean;
  requiresReconciliation: boolean;
  canApprove: boolean;
  canSave: boolean;
}

const categoryLabels: Record<RunFailureCategory, string> = {
  "provider-failure": "Provider failure",
  "validation-failure": "Response validation",
  "budget-admission": "Budget admission",
  "result-staging": "Result storage",
  "final-acknowledgement": "Completion acknowledgement",
  authorization: "Authorization",
  deadline: "Deadline",
  cancellation: "Cancellation",
  unknown: "Unclassified outcome",
};

const stageLabels: Record<string, string> = {
  "run-admission": "Run admission",
  "initial-checkpoint": "Starting the run",
  "budget-admission": "Checking request limits",
  authorization: "Checking access",
  "provider-submission": "Submitting the analysis request",
  "provider-response": "Waiting for the analysis response",
  "result-validation": "Validating the response",
  "result-staging": "Storing the analysis result",
  "final-acknowledgement": "Confirming completion",
  deadline: "Run deadline",
  cancellation: "Cancellation",
};

function failureSummary(category?: RunFailureCategory): string {
  switch (category) {
    case "provider-failure":
      return "The provider reported a failure during analysis. No automatic retry was started.";
    case "validation-failure":
      return "The response did not pass the required validation checks, so it is not ready to review.";
    case "budget-admission":
      return "A local request or budget limit prevented this analysis from being submitted.";
    case "result-staging":
      return "An analysis result was returned, but saving that result for review failed. Check the current run before approving another attempt.";
    case "final-acknowledgement":
      return "The result may have been stored, but completion was not confirmed. Check the current run before approving another attempt.";
    case "authorization":
      return "Access was denied or changed. Review the connected account and repository permissions before continuing.";
    case "deadline":
      return "The run reached its deadline. Whether the provider finished is not confirmed.";
    case "cancellation":
      return "Cancellation was requested. The provider may have received the request, so its final outcome is not confirmed.";
    case "unknown":
    default:
      return "The analysis result could not be confirmed. The provider may have received the request. Check the current run before approving another attempt.";
  }
}

function failureLeavesOutcomeUnknown(category?: RunFailureCategory): boolean {
  return (
    category === "result-staging" ||
    category === "final-acknowledgement" ||
    category === "deadline" ||
    category === "cancellation" ||
    category === "unknown"
  );
}

function view(
  phase: RunPhase,
  title: string,
  summary: string,
  tone: RunStatusView["tone"],
  options: Partial<RunStatusView> = {},
): RunStatusView {
  return {
    phase,
    title,
    summary,
    tone,
    outcomeUnknown: phase === "interrupted-unknown",
    requiresReconciliation: phase === "interrupted-unknown",
    canApprove: phase === "awaiting-approval",
    canSave: phase === "ready-with-drafts",
    ...options,
  };
}

function isValidDraftCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

/**
 * Interprets the durable lifecycle, current transport state and the last
 * server-side attempt marker together. A prepared selection never masks a
 * failed or interrupted attempt.
 */
export function deriveRunStatus(input: RunStatusInput): RunStatusView {
  const failure =
    input.failure?.runId === input.runId ? input.failure : undefined;
  const attempt =
    input.attempt?.runId === input.runId ? input.attempt : undefined;
  const marker =
    attempt?.marker ??
    (input.lifecycle === "created" && input.runId === null
      ? "not-submitted"
      : "unknown");
  const categoryLabel =
    failure && isRunFailureCategory(failure.category)
      ? categoryLabels[failure.category]
      : undefined;
  const stageLabel =
    failure?.stage && Object.hasOwn(stageLabels, failure.stage)
      ? stageLabels[failure.stage]
      : undefined;
  const resultIsCurrent = Boolean(
    input.result?.availability === "available" &&
    input.runId &&
    input.result.runId === input.runId,
  );

  const hasSavedAchievements =
    typeof input.savedCount === "number" &&
    Number.isSafeInteger(input.savedCount) &&
    input.savedCount > 0;
  if (input.lifecycle === "approved" || hasSavedAchievements) {
    return view(
      "saved",
      "Selected achievements saved",
      "The reviewed achievements are in Achievement Library.",
      "success",
    );
  }

  if (resultIsCurrent && input.result?.availability === "available") {
    if (!isValidDraftCount(input.result.draftCount)) {
      return view(
        "interrupted-unknown",
        "Analysis result needs reconciliation",
        "A result reference exists, but its draft count could not be confirmed. Check the current run before approving another attempt.",
        "warning",
        { categoryLabel, stageLabel },
      );
    }
    if (input.result.draftCount === 0) {
      return view(
        "ready-with-zero-drafts",
        "Analysis finished with no drafts",
        "No achievements are ready to save. You can review the evidence or add more context before starting a new, explicitly approved run.",
        "neutral",
        { draftCount: 0, categoryLabel, stageLabel },
      );
    }
    return view(
      "ready-with-drafts",
      "Analysis ready to review",
      `${input.result.draftCount} ${input.result.draftCount === 1 ? "draft is" : "drafts are"} ready. Nothing has been saved to Achievement Library yet.`,
      "success",
      { draftCount: input.result.draftCount, categoryLabel, stageLabel },
    );
  }

  if (input.lifecycle === "interrupted" || input.jobState === "interrupted") {
    return view(
      "interrupted-unknown",
      "Analysis outcome is unknown",
      failureSummary(failure?.category),
      "warning",
      { categoryLabel, stageLabel },
    );
  }

  if (input.lifecycle === "failed" || input.jobState === "failed") {
    if (failureLeavesOutcomeUnknown(failure?.category)) {
      return view(
        "interrupted-unknown",
        "Analysis outcome needs checking",
        failureSummary(failure?.category),
        "warning",
        { categoryLabel, stageLabel },
      );
    }
    return view(
      "failed",
      "Analysis could not finish",
      failure?.category
        ? failureSummary(failure.category)
        : "The analysis did not produce a confirmed result. No achievements were saved.",
      "error",
      { categoryLabel, stageLabel },
    );
  }

  if (input.lifecycle === "cancelled" || input.jobState === "cancelled") {
    return view(
      "cancelled",
      "Analysis cancelled",
      "The run was cancelled. Any already submitted provider request may still finish, but no automatic retry will run.",
      "neutral",
      { categoryLabel, stageLabel },
    );
  }

  if (input.lifecycle === "expired") {
    return view(
      "expired",
      "Analysis result expired",
      "The previous result is no longer available. Prepare and review a fresh selection before approving another run.",
      "neutral",
    );
  }

  if (input.lifecycle === "needs-input" || input.jobState === "needs-input") {
    return view(
      "needs-input",
      "More context is needed",
      "Add the requested context, then review the evidence and approve any new analysis explicitly.",
      "warning",
    );
  }

  if (input.busy === "preparing" || input.lifecycle === "preparing") {
    return view(
      "preparing",
      "Preparing selected evidence",
      "The current selection is being checked and prepared.",
      "pending",
      { stageLabel },
    );
  }

  if (
    input.busy === "submitting" ||
    input.lifecycle === "queued" ||
    input.jobState === "queued"
  ) {
    return view(
      "submitting",
      "Submitting analysis request",
      "The run was accepted for processing. Provider receipt is not confirmed yet, and no second attempt will be submitted automatically.",
      "pending",
      { stageLabel },
    );
  }

  if (input.busy === "analyzing" || input.jobState === "running") {
    return view(
      "analyzing",
      "Analysis is running",
      "The current run is active. A page refresh or lost connection does not establish whether the provider finished.",
      "pending",
      { stageLabel },
    );
  }

  if (input.lifecycle === "created" && marker === "not-submitted") {
    return view(
      "not-started",
      "Project setup not started",
      "Choose a repository and scope to prepare evidence.",
      "neutral",
    );
  }

  if (
    marker === "submitting" ||
    marker === "may-have-been-submitted" ||
    marker === "result-persisted" ||
    marker === "unknown" ||
    input.lifecycle === "ready-to-review" ||
    input.lifecycle === "partial"
  ) {
    return view(
      "interrupted-unknown",
      "Analysis outcome needs checking",
      failureSummary(failure?.category),
      "warning",
      { categoryLabel, stageLabel },
    );
  }

  if (
    input.preparedSelection === "available" &&
    marker === "not-submitted" &&
    input.lifecycle === "ready-to-analyze"
  ) {
    return view(
      "awaiting-approval",
      "Evidence is ready for your review",
      "Analysis has not been submitted. Review the selected evidence and explicitly approve one run when you are ready.",
      "neutral",
    );
  }

  if (input.preparedSelection !== "available") {
    return view(
      "not-started",
      "Project setup not started",
      "Choose a repository and scope to prepare evidence.",
      "neutral",
    );
  }

  return view(
    "interrupted-unknown",
    "Analysis outcome needs checking",
    failureSummary(failure?.category),
    "warning",
    { categoryLabel, stageLabel },
  );
}

/** Read only the checkpoint fields this feature owns; never display raw data. */
export function attemptMarkerFromCheckpoint(value: unknown): AttemptMarker {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "unknown";
  }
  const checkpoint = value as Record<string, unknown>;
  if (checkpoint.providerState === "not-started") return "not-submitted";
  if (
    checkpoint.providerState === "completed" &&
    typeof checkpoint.providerResultRef === "string" &&
    /^[a-f0-9]{64}$/u.test(checkpoint.providerResultRef)
  ) {
    return "result-persisted";
  }
  if (
    checkpoint.providerState === "in-flight" ||
    checkpoint.runnerStage === "analysis-started"
  ) {
    return "may-have-been-submitted";
  }
  return "unknown";
}
