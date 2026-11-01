export const RUN_DIAGNOSTIC_STAGES = [
  "run-admission",
  "initial-checkpoint",
  "budget-admission",
  "authorization",
  "provider-submission",
  "provider-response",
  "result-validation",
  "result-staging",
  "final-acknowledgement",
  "deadline",
  "cancellation",
] as const;

export type RunDiagnosticStage = (typeof RUN_DIAGNOSTIC_STAGES)[number];

export const RUN_FAILURE_CATEGORIES = [
  "provider-failure",
  "validation-failure",
  "budget-admission",
  "result-staging",
  "final-acknowledgement",
  "authorization",
  "deadline",
  "cancellation",
  "unknown",
] as const;

export type RunFailureCategory = (typeof RUN_FAILURE_CATEGORIES)[number];

export function isRunFailureCategory(
  value: unknown,
): value is RunFailureCategory {
  return (
    typeof value === "string" &&
    (RUN_FAILURE_CATEGORIES as readonly string[]).includes(value)
  );
}

export const SAFE_DOMAIN_ERROR_CODES = [
  "invalid-input",
  "forbidden",
  "unavailable",
  "not-found",
  "version-conflict",
  "limit-exceeded",
  "rate-limited",
  "needs-context",
  "invalid-evidence",
  "io-error",
  "cancelled",
  "interrupted",
  "upstream-error",
] as const;

export type SafeDomainErrorCode = (typeof SAFE_DOMAIN_ERROR_CODES)[number];

export function isRunDiagnosticStage(
  value: unknown,
): value is RunDiagnosticStage {
  return (
    typeof value === "string" &&
    (RUN_DIAGNOSTIC_STAGES as readonly string[]).includes(value)
  );
}

export function isSafeDomainErrorCode(
  value: unknown,
): value is SafeDomainErrorCode {
  return (
    typeof value === "string" &&
    (SAFE_DOMAIN_ERROR_CODES as readonly string[]).includes(value)
  );
}
