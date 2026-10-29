export type ProtectedRouteFailureStage = "request-handler" | "github-services";

const STARTUP_FAILURES = new Map([
  [
    "Hosted GitHub database credentials are unavailable.",
    "hosted-admin-missing",
  ],
  [
    "The hosted GitHub database project does not match.",
    "hosted-admin-project",
  ],
  ["A dedicated GitHub state namespace is required.", "hosted-namespace"],
  ["Durable GitHub state is already configured.", "hosted-state-duplicate"],
  ["Invalid credential vault configuration.", "hosted-vault"],
  [
    "The GitHub callback must match the approved app origin.",
    "hosted-callback",
  ],
  ["GitHub App credentials are incomplete.", "hosted-app-credentials"],
]);

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
  "MODULE_NOT_FOUND",
  "ERR_MODULE_NOT_FOUND",
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

  const message =
    typeof cause === "string"
      ? cause
      : cause &&
          typeof cause === "object" &&
          "message" in cause &&
          typeof cause.message === "string"
        ? cause.message
        : "";
  const stack =
    cause &&
    typeof cause === "object" &&
    "stack" in cause &&
    typeof cause.stack === "string"
      ? cause.stack
      : "";
  const vocabulary = new Set(
    "cannot find module require import not supported missing package export path extension unknown loading load failed invalid client server component only use outside scope esm asynchronous sync synchronous top level await syntax identifier defined file directory permission denied timed out workflow context runtime credential credentials project database firebase firestore google cloud admin genai key api enoent einval eperm eacces".split(
      " ",
    ),
  );
  const messageWords = message
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => vocabulary.has(word))
    .slice(0, 32);
  const sites = stack
    ? [
        ...stack.matchAll(
          /[/\\].next[/\\]server[/\\]chunks[/\\](\d+\.js):(\d+):(\d+)/g,
        ),
      ]
        .slice(0, 3)
        .map((match) => ({
          chunk: match[1],
          line: Number(match[2]),
          column: Number(match[3]),
        }))
    : [];
  const moduleFailure = /Cannot find module|Dynamic require of/.test(message);
  return {
    code: "ACCOUNT_REQUEST_FAILED",
    ...(messageWords.length ? { messageWords } : {}),
    causeType: typeof cause,
    ...(sites.length ? { sites } : {}),
    ...(moduleFailure ? { reason: "module-loading" } : {}),
    stage,
    errorName: SAFE_ERROR_NAMES.has(name) ? name : "OtherError",
    ...(STARTUP_FAILURES.has(message)
      ? { reason: STARTUP_FAILURES.get(message) }
      : {}),
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
