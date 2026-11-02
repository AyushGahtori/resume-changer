export type ProtectedRouteFailureStage = "request-handler" | "github-services";

/** Wraps an internal failure with a fixed stage label without exposing details. */
export class ProtectedRouteFailure extends Error {
  constructor(
    readonly stage: ProtectedRouteFailureStage,
    cause: unknown,
  ) {
    super("A private account service failed.", { cause });
    this.name = "ProtectedRouteFailure";
  }
}

const SAFE_ERROR_NAMES = new Set([
  "Error",
  "TypeError",
  "SyntaxError",
  "FirebaseError",
  "FirebaseAppError",
  "GoogleError",
  "ApiError",
  "GrpcStatusError",
  "ProtectedRouteFailure",
]);

const SAFE_ERROR_CODES = new Set([
  "ERR_REQUIRE_ESM",
  "ERR_REQUIRE_ASYNC_MODULE",
  "app/invalid-credential",
  "app/invalid-app-options",
  "app/no-app",
  "auth/insufficient-permission",
  "auth/invalid-credential",
  "auth/invalid-user-token",
  "auth/user-not-found",
  "deadline-exceeded",
  "failed-precondition",
  "firestore/permission-denied",
  "invalid-argument",
  "not-found",
  "permission-denied",
  "resource-exhausted",
  "unauthenticated",
  "unavailable",
]);

function causeOf(error: unknown): unknown {
  if (error instanceof ProtectedRouteFailure) return error.cause;
  return error;
}

/** Metadata only: never return an exception message, stack, URL, or secret. */
export function protectedRouteFailureDetails(error: unknown) {
  const stage =
    error instanceof ProtectedRouteFailure ? error.stage : "request-handler";
  const cause = causeOf(error);
  const name =
    cause && typeof cause === "object" && "name" in cause
      ? String(cause.name)
      : "Error";
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? cause.code
      : undefined;
  const status =
    cause && typeof cause === "object" && "status" in cause
      ? cause.status
      : undefined;

  return {
    code: "ACCOUNT_REQUEST_FAILED",
    stage,
    errorName: SAFE_ERROR_NAMES.has(name) ? name : "OtherError",
    ...(typeof code === "string" && SAFE_ERROR_CODES.has(code)
      ? { errorCode: code }
      : {}),
    ...(typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 599
      ? { httpStatus: status }
      : {}),
  };
}
