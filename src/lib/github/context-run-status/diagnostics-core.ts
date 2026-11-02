import { createHash } from "node:crypto";
import {
  isRunDiagnosticStage,
  isSafeDomainErrorCode,
  type RunDiagnosticStage,
  type RunFailureCategory,
  type SafeDomainErrorCode,
} from "./contracts";

export const MAX_DIAGNOSTIC_ATTEMPTS = 2;
export const MAX_DIAGNOSTIC_ELAPSED_MS = 10 * 60_000;

export type RunDiagnosticEvent =
  | {
      event: "stage";
      operationRef: string;
      runRef: string;
      attempt: number;
      stage: RunDiagnosticStage;
      elapsedMs: number | null;
      elapsedCapped: boolean;
    }
  | {
      event: "failure";
      operationRef: string;
      runRef: string;
      attempt: number;
      stage: RunDiagnosticStage;
      category: RunFailureCategory;
      errorCode?: SafeDomainErrorCode;
      upstreamStatus?: number;
      elapsedMs: number | null;
      elapsedCapped: boolean;
      aborted: boolean;
      deadlineExceeded: boolean;
    };

export interface RunDiagnosticSession {
  stage(stage: unknown): void;
  failure(input?: {
    stage?: unknown;
    errorCode?: unknown;
    upstreamStatus?: unknown;
    aborted?: unknown;
    deadlineExceeded?: unknown;
  }): void;
}

export interface RunDiagnosticOptions {
  operationId: string;
  runId: string;
  attempt: number;
  startedAtMs: number;
  now?: () => number;
  write: (event: RunDiagnosticEvent) => void;
}

const noopSession: RunDiagnosticSession = {
  stage: () => undefined,
  failure: () => undefined,
};

function validIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value);
}

function reference(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function parseStatus(value: unknown): number | undefined {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
  ) {
    return value;
  }
  if (typeof value === "string" && /^HTTP_[1-5][0-9]{2}$/u.test(value)) {
    return Number(value.slice(5));
  }
  return undefined;
}

function safeElapsed(startedAtMs: number, now: () => number) {
  let current: number;
  try {
    current = now();
  } catch {
    return { elapsedMs: null, elapsedCapped: false };
  }
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(current)) {
    return { elapsedMs: null, elapsedCapped: false };
  }
  const elapsed = Math.max(0, Math.floor(current - startedAtMs));
  return {
    elapsedMs: Math.min(elapsed, MAX_DIAGNOSTIC_ELAPSED_MS),
    elapsedCapped: elapsed > MAX_DIAGNOSTIC_ELAPSED_MS,
  };
}

export function classifyRunFailure(input: {
  stage: RunDiagnosticStage;
  errorCode?: SafeDomainErrorCode;
  aborted?: boolean;
  deadlineExceeded?: boolean;
}): RunFailureCategory {
  if (input.deadlineExceeded || input.stage === "deadline") return "deadline";
  if (
    input.aborted ||
    input.stage === "cancellation" ||
    input.errorCode === "cancelled"
  ) {
    return "cancellation";
  }
  if (input.stage === "budget-admission") return "budget-admission";
  if (input.stage === "authorization") return "authorization";
  if (input.stage === "result-staging") return "result-staging";
  if (input.stage === "final-acknowledgement") {
    return "final-acknowledgement";
  }
  if (input.stage === "result-validation") return "validation-failure";
  if (
    input.stage === "provider-submission" ||
    input.stage === "provider-response"
  ) {
    return "provider-failure";
  }
  if (input.errorCode === "limit-exceeded") return "budget-admission";
  if (input.errorCode === "forbidden") return "authorization";
  if (
    input.errorCode === "invalid-input" ||
    input.errorCode === "invalid-evidence" ||
    input.errorCode === "needs-context"
  ) {
    return "validation-failure";
  }
  if (
    input.errorCode === "rate-limited" ||
    input.errorCode === "upstream-error"
  ) {
    return "provider-failure";
  }
  return "unknown";
}

/**
 * Creates a content-free, correlation-safe recorder for one bounded attempt.
 * Only allowlisted stage/error labels and hashed operation identifiers reach
 * the sink. Sink failures never affect the run.
 */
export function createRunDiagnosticSession(
  options: RunDiagnosticOptions,
): RunDiagnosticSession {
  if (
    typeof options.operationId !== "string" ||
    !validIdentifier(options.operationId) ||
    typeof options.runId !== "string" ||
    !validIdentifier(options.runId) ||
    !Number.isInteger(options.attempt) ||
    options.attempt < 1 ||
    options.attempt > MAX_DIAGNOSTIC_ATTEMPTS
  ) {
    return noopSession;
  }

  const now = options.now ?? Date.now;
  const operationRef = reference(options.operationId);
  const runRef = reference(options.runId);
  let currentStage: RunDiagnosticStage = "run-admission";

  function emit(event: RunDiagnosticEvent) {
    try {
      options.write(Object.freeze(event));
    } catch {
      // Diagnostics are best effort and must never change job behavior.
    }
  }

  function base(stage: RunDiagnosticStage) {
    return {
      operationRef,
      runRef,
      attempt: options.attempt,
      stage,
      ...safeElapsed(options.startedAtMs, now),
    };
  }

  return {
    stage(value) {
      if (!isRunDiagnosticStage(value)) return;
      currentStage = value;
      emit({ event: "stage", ...base(value) });
    },
    failure(input = {}) {
      const stage = isRunDiagnosticStage(input.stage)
        ? input.stage
        : currentStage;
      const errorCode = isSafeDomainErrorCode(input.errorCode)
        ? input.errorCode
        : undefined;
      const aborted = input.aborted === true;
      const deadlineExceeded = input.deadlineExceeded === true;
      const upstreamStatus = parseStatus(input.upstreamStatus);
      emit({
        event: "failure",
        ...base(stage),
        category: classifyRunFailure({
          stage,
          errorCode,
          aborted,
          deadlineExceeded,
        }),
        ...(errorCode ? { errorCode } : {}),
        ...(upstreamStatus ? { upstreamStatus } : {}),
        aborted,
        deadlineExceeded,
      });
    },
  };
}
