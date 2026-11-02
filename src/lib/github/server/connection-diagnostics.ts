import type { DomainError } from "../contracts";

const oauthErrors = new Set([
  "access_denied",
  "incorrect_client_credentials",
  "redirect_uri_mismatch",
  "bad_verification_code",
  "invalid_scope",
  "unverified_user_email",
  "unsupported_response_type",
  "server_error",
  "temporarily_unavailable",
]);

/** Fixed labels and presence checks only; never include URLs, cookies or codes. */
export function callbackValidationDetails(
  request: Request,
  expectedState: string | undefined,
  kind: "authorization" | "denied" | "failed",
) {
  const params = new URL(request.url).searchParams;
  const error = params.get("error");
  const allowed = new Set([
    "code",
    "state",
    "error",
    "error_description",
    "error_uri",
  ]);
  return {
    kind,
    hasCode: params.has("code"),
    hasState: params.has("state"),
    hasStateCookie: Boolean(expectedState),
    stateMatches: Boolean(
      expectedState && params.get("state") === expectedState,
    ),
    hasExtraParameters: [...params.keys()].some((key) => !allowed.has(key)),
    hasRepeatedParameters: [...params.keys()].some(
      (key) => params.getAll(key).length !== 1,
    ),
    ...(error ? { oauthError: oauthErrors.has(error) ? error : "other" } : {}),
  };
}

const reasons = new Map([
  [
    "Connect a GitHub account before selecting repositories.",
    "no-stored-connection",
  ],
  ["Reconnect GitHub to continue.", "missing-user-credential"],
  [
    "GitHub authorization expired or was already used.",
    "pending-authorization-missing",
  ],
  [
    "A GitHub account is already connected to this session.",
    "already-connected",
  ],
  [
    "The GitHub account changed. Reconnect GitHub to continue.",
    "identity-changed",
  ],
  [
    "GitHub authorization expired or was revoked. Reconnect GitHub to continue.",
    "credential-expired",
  ],
  [
    "GitHub authorization expired or was revoked. Reconnect GitHub.",
    "github-rejected-user-token",
  ],
]);

export function connectionFailureDetails(error: DomainError) {
  return { code: error.code, reason: reasons.get(error.message) ?? "other" };
}

export function reportConnectionFailure(stage: string, details: object) {
  if (process.env.VERCEL === "1")
    console.warn("GitHub connection failure.", { stage, ...details });
}
