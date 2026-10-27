import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import {
  AccountAccessError,
  assertSameOrigin,
  getAppMode,
  readBoundedBody,
} from "@/lib/cloud/security";
import { accountFromRequest } from "@/lib/cloud/server-account";
import { getPersonalDataRoot } from "@/lib/data/root";
import {
  DOMAIN_ERROR_HTTP_STATUS,
  DomainErrorSchema,
  RepositoryScopeSchema,
  RepositorySummarySchema,
  type DomainError,
  type ExecutionContext,
} from "../contracts";
import type { GithubAccessPort } from "../ports";
import { getGithubServices } from "./composition";

const CALLBACK_PATH = "/api/github/connection/callback";
const SESSION_COOKIE = "github_session";
const SECURE_SESSION_COOKIE = "__Host-github_session";
const STATE_COOKIE = "github_connection_state";
const SECURE_STATE_COOKIE = "__Host-github_connection_state";
const OAUTH_STATE_COOKIE = "github_oauth_state";
const SECURE_OAUTH_STATE_COOKIE = "__Host-github_oauth_state";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;
const OAUTH_STATE_MAX_AGE = 10 * 60;
const CONNECTION_STATES = [
  "disconnected",
  "connecting",
  "connected",
  "denied",
  "expired",
  "unavailable",
] as const;
const EMPTY_BUDGET = {
  requests: 0,
  pullRequestRequests: 0,
  fetchedBodies: 0,
  fetchedBytes: 0,
  uniqueFiles: 0,
  uniqueLines: 0,
  transmittedLines: 0,
  inputTokens: 0,
  generationAttempts: 0,
};

export type GithubConnectionState = (typeof CONNECTION_STATES)[number];
export type GithubConnectionSession = {
  sessionId: string;
  authorizationNamespace: string;
  accountId: string | null;
  isLocal: boolean;
  state: GithubConnectionState | null;
  setSessionCookie?: string;
};

type ConnectionFailure = { status: number; error: DomainError };

export type GithubConnectionHandlerDependencies = {
  getAccess: () => GithubAccessPort | Promise<GithubAccessPort>;
  resolveSession: (
    request: Request,
    createIfMissing: boolean,
  ) => Promise<GithubConnectionSession | null>;
  createContext: (
    request: Request,
    session: GithubConnectionSession,
    now: Date,
  ) => ExecutionContext;
  getCallbackUrl: () => string | undefined;
  now: () => Date;
  assertMutationOrigin: (request: Request) => void;
};

function loopback(hostname: string) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

function matchesCallbackOrigin(request: Request, callback: URL) {
  const actual = new URL(request.url);
  return (
    actual.origin === callback.origin ||
    (process.env.VERCEL !== "1" &&
      getAppMode() === "local" &&
      loopback(actual.hostname) &&
      loopback(callback.hostname) &&
      actual.protocol === callback.protocol &&
      actual.port === callback.port)
  );
}

function secureRequest(request: Request) {
  return new URL(request.url).protocol === "https:";
}

function names(secure: boolean) {
  return {
    session: secure ? SECURE_SESSION_COOKIE : SESSION_COOKIE,
    state: secure ? SECURE_STATE_COOKIE : STATE_COOKIE,
    oauthState: secure ? SECURE_OAUTH_STATE_COOKIE : OAUTH_STATE_COOKIE,
    returnTo: secure ? "__Host-github_return_to" : "github_return_to",
  };
}

function readCookie(request: Request, name: string): string | undefined {
  const matches = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(name + "="));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : undefined;
}

function validState(value: string | undefined): value is GithubConnectionState {
  return CONNECTION_STATES.includes(value as GithubConnectionState);
}

function serializeCookie(
  name: string,
  value: string,
  secure: boolean,
  maxAge = SESSION_MAX_AGE,
) {
  return [
    name + "=" + value,
    "Path=/",
    "Max-Age=" + maxAge,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export async function resolveGithubConnectionSession(
  request: Request,
  options: {
    createIfMissing?: boolean;
    mode?: () => "local" | "firebase";
    accountFromRequest?: (request: Request) => Promise<{ uid: string }>;
    randomBytes?: (size: number) => Uint8Array;
  } = {},
): Promise<GithubConnectionSession | null> {
  const secure = secureRequest(request);
  const cookieNames = names(secure);
  if ((options.mode ?? getAppMode)() === "firebase") {
    const account = await (options.accountFromRequest ?? accountFromRequest)(
      request,
    );
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(account.uid))
      throw new AccountAccessError(
        "The account identity is invalid.",
        "FORBIDDEN",
        403,
      );
    const state = readCookie(request, cookieNames.state);
    return {
      sessionId: "account-" + account.uid,
      authorizationNamespace: "firebase:" + account.uid,
      accountId: account.uid,
      isLocal: false,
      state: validState(state) ? state : null,
    };
  }

  const url = new URL(request.url);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    (url.protocol === "http:" && !loopback(url.hostname))
  )
    throw new AccountAccessError(
      "Use localhost for local HTTP, or configure the app with HTTPS.",
      "FORBIDDEN",
      403,
    );

  const rawSessionId = readCookie(request, cookieNames.session);
  if (rawSessionId && /^[A-Za-z0-9_-]{43}$/.test(rawSessionId)) {
    const state = readCookie(request, cookieNames.state);
    return {
      sessionId: "local-" + rawSessionId,
      authorizationNamespace: "local:" + rawSessionId,
      accountId: null,
      isLocal: true,
      state: validState(state) ? state : null,
    };
  }
  if (!options.createIfMissing) return null;

  const value = Buffer.from((options.randomBytes ?? randomBytes)(32)).toString(
    "base64url",
  );
  if (!/^[A-Za-z0-9_-]{43}$/.test(value))
    throw new AccountAccessError(
      "A secure local GitHub session could not be created.",
      "CONFIGURATION_ERROR",
      503,
    );
  return {
    sessionId: "local-" + value,
    authorizationNamespace: "local:" + value,
    accountId: null,
    isLocal: true,
    state: null,
    setSessionCookie: serializeCookie(cookieNames.session, value, secure),
  };
}

function connectionBudget(): ExecutionContext["budget"] {
  const error: DomainError = {
    code: "unavailable",
    message: "An import budget is not active for a connection request.",
    retryable: false,
  };
  return {
    reserve: async () => ({ ok: false, error }),
    commitUsage: async () => ({ ok: false, error }),
    checkSelection: () => ({
      ok: true,
      value: {
        allowed: false,
        reason: "Connection requests do not select repository evidence.",
      },
    }),
    remaining: () => ({ ok: true, value: EMPTY_BUDGET }),
    snapshot: () => ({ ok: true, value: EMPTY_BUDGET }),
  };
}

function defaultContext(
  request: Request,
  session: GithubConnectionSession,
  now: Date,
): ExecutionContext {
  return {
    personalRoot: getPersonalDataRoot(),
    access: {
      sessionId: session.sessionId,
      authorizationNamespace: session.authorizationNamespace,
      accountId: session.accountId,
      grantedRepositoryIds: [],
    },
    signal: request.signal,
    now: () => new Date(now),
    runId: "github-connection-" + randomUUID(),
    deadline: new Date(now.getTime() + 60_000).toISOString(),
    budget: connectionBudget(),
  };
}

function failure(
  code: DomainError["code"],
  message: string,
  status: number,
): ConnectionFailure {
  return { status, error: { code, message, retryable: status >= 500 } };
}

function isFailure(value: unknown): value is ConnectionFailure {
  return Boolean(
    value &&
    typeof value === "object" &&
    "status" in value &&
    "error" in value &&
    typeof value.status === "number",
  );
}

function privateJson(body: unknown, status = 200, cookies: string[] = []) {
  const headers = new Headers({
    "Cache-Control": "private, no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return Response.json(body, { status, headers });
}

function errorResponse(error: ConnectionFailure) {
  return privateJson({ error: error.error }, error.status);
}

function portFailure(value: unknown): ConnectionFailure {
  const parsed = DomainErrorSchema.safeParse(value);
  return parsed.success
    ? { error: parsed.data, status: DOMAIN_ERROR_HTTP_STATUS[parsed.data.code] }
    : failure(
        "unavailable",
        "GitHub connection is temporarily unavailable.",
        503,
      );
}

function unexpected(error: unknown): Response {
  if (isFailure(error)) return errorResponse(error);
  if (error instanceof AccountAccessError) {
    const code: DomainError["code"] =
      error.code === "AUTH_REQUIRED" || error.code === "FORBIDDEN"
        ? "forbidden"
        : error.code === "CONFIGURATION_ERROR"
          ? "unavailable"
          : error.code === "PAYLOAD_TOO_LARGE"
            ? "limit-exceeded"
            : error.code === "RATE_LIMITED"
              ? "rate-limited"
              : "invalid-input";
    return errorResponse(failure(code, error.message, error.status));
  }
  return errorResponse(
    failure(
      "unavailable",
      "GitHub connection is temporarily unavailable.",
      503,
    ),
  );
}

function assertTrustedMutationOrigin(request: Request) {
  assertSameOrigin(request);
  const origin = request.headers.get("origin");
  if (!origin)
    throw new AccountAccessError(
      "This request must come from this website.",
      "FORBIDDEN",
      403,
    );

  const trustedOrigins = new Set<string>();
  const configuredOrigin = process.env.RESUME_APP_ORIGIN;
  if (configuredOrigin) {
    let parsed: URL;
    try {
      parsed = new URL(configuredOrigin);
    } catch {
      throw new AccountAccessError(
        "The app origin is not configured safely.",
        "CONFIGURATION_ERROR",
        503,
      );
    }
    if (parsed.protocol !== "https:" || parsed.origin !== configuredOrigin)
      throw new AccountAccessError(
        "The app origin is not configured safely.",
        "CONFIGURATION_ERROR",
        503,
      );
    trustedOrigins.add(parsed.origin);
  }

  if (process.env.VERCEL === "1") {
    for (const host of [
      process.env.VERCEL_URL,
      process.env.VERCEL_PROJECT_PRODUCTION_URL,
    ])
      if (host) trustedOrigins.add("https://" + host);
    if (!trustedOrigins.has(origin))
      throw new AccountAccessError(
        "This request must come from this website.",
        "FORBIDDEN",
        403,
      );
    return;
  }

  if (trustedOrigins.size && !trustedOrigins.has(origin))
    throw new AccountAccessError(
      "This request must come from this website.",
      "FORBIDDEN",
      403,
    );
  const parsedOrigin = new URL(origin);
  if (
    parsedOrigin.origin !== origin ||
    (parsedOrigin.protocol === "http:" && !loopback(parsedOrigin.hostname)) ||
    (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:")
  )
    throw new AccountAccessError(
      "Use localhost for local HTTP, or configure the app with HTTPS.",
      "FORBIDDEN",
      403,
    );
}

function configuredCallbackUrl(value: string | undefined): URL {
  if (!value)
    throw failure(
      "unavailable",
      "GitHub App callback setup is missing on this server.",
      503,
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw failure(
      "unavailable",
      "GitHub App callback setup is invalid on this server.",
      503,
    );
  }
  const localHttp = url.protocol === "http:" && loopback(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== CALLBACK_PATH ||
    url.href !== value ||
    (!localHttp && url.protocol !== "https:")
  )
    throw failure(
      "unavailable",
      "GitHub App callback setup must use the exact callback URL.",
      503,
    );
  if (process.env.VERCEL === "1" && url.protocol !== "https:")
    throw failure(
      "unavailable",
      "Hosted GitHub connections require an HTTPS callback URL.",
      503,
    );
  if (
    process.env.RESUME_APP_ORIGIN &&
    new URL(process.env.RESUME_APP_ORIGIN).origin !== url.origin
  )
    throw failure(
      "unavailable",
      "The GitHub callback URL must use the configured app origin.",
      503,
    );
  return url;
}

function validateAuthorizationUrl(
  value: string,
  returnedState: string,
  callbackUrl: URL,
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw failure(
      "upstream-error",
      "GitHub authorization returned an invalid destination.",
      502,
    );
  }
  const query = url.searchParams;
  const allowed = new Set([
    "client_id",
    "redirect_uri",
    "state",
    "scope",
    "code_challenge",
    "code_challenge_method",
  ]);
  const keys = [...query.keys()];
  const state = query.get("state");
  const challenge = query.get("code_challenge");
  const clientId = query.get("client_id");
  if (
    url.origin !== "https://github.com" ||
    url.pathname !== "/login/oauth/authorize" ||
    url.username ||
    url.password ||
    url.hash ||
    keys.some((key) => !allowed.has(key)) ||
    keys.some((key) => query.getAll(key).length !== 1) ||
    !clientId ||
    clientId.length > 256 ||
    (process.env.GITHUB_APP_CLIENT_ID &&
      clientId !== process.env.GITHUB_APP_CLIENT_ID) ||
    query.get("redirect_uri") !== callbackUrl.href ||
    !state ||
    !/^[A-Za-z0-9_-]{43,256}$/.test(state) ||
    returnedState !== state ||
    query.get("scope") !== "offline_access" ||
    !challenge ||
    !/^[A-Za-z0-9_-]{43}$/.test(challenge) ||
    query.get("code_challenge_method") !== "S256"
  )
    throw failure(
      "upstream-error",
      "GitHub authorization returned an unsafe destination.",
      502,
    );
  return url;
}

function stateCookie(request: Request, state: GithubConnectionState) {
  const secure = secureRequest(request);
  return serializeCookie(names(secure).state, state, secure);
}

function oauthStateCookie(request: Request, state: string, maxAge?: number) {
  const secure = secureRequest(request);
  return serializeCookie(
    names(secure).oauthState,
    state,
    secure,
    maxAge ?? OAUTH_STATE_MAX_AGE,
  );
}

function clearedOauthStateCookie(request: Request) {
  return oauthStateCookie(request, "", 0);
}

function clearedConnectionCookies(
  request: Request,
  session: GithubConnectionSession | null,
) {
  const secure = secureRequest(request);
  const cookieNames = names(secure);
  return [
    ...(session?.isLocal
      ? [serializeCookie(cookieNames.session, "", secure, 0)]
      : []),
    serializeCookie(cookieNames.state, "", secure, 0),
    clearedOauthStateCookie(request),
  ];
}

function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || value.length > 512)
    return "/library/github/new";
  let parsed: URL;
  try {
    parsed = new URL(value, "https://return.invalid");
  } catch {
    return "/library/github/new";
  }
  return parsed.origin === "https://return.invalid" &&
    /^\/library\/github\/(?:new|[a-z0-9]+(?:-[a-z0-9]+)*)$/.test(
      parsed.pathname,
    ) &&
    !parsed.hash &&
    [...parsed.searchParams.keys()].every((key) => key === "projectId") &&
    parsed.searchParams.getAll("projectId").length <= 1 &&
    (!parsed.searchParams.has("projectId") ||
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parsed.searchParams.get("projectId")!))
    ? parsed.pathname + parsed.search
    : "/library/github/new";
}

function redirectFromCallback(
  callbackUrl: URL,
  state: "connected" | "denied" | "expired" | "unavailable",
  cookies: string[] = [],
  returnTo = "/library/github/new",
) {
  const destination = new URL(safeReturnTo(returnTo), callbackUrl);
  destination.searchParams.set("githubConnection", state);
  const headers = new Headers({
    Location: destination.href,
    "Cache-Control": "private, no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

function callbackQuery(
  request: Request,
):
  | { kind: "authorization"; code: string; state: string }
  | { kind: "denied"; state: string }
  | { kind: "failed" } {
  const url = new URL(request.url);
  const query = url.searchParams;
  const allowed = new Set([
    "code",
    "state",
    "error",
    "error_description",
    "error_uri",
  ]);
  const keys = [...query.keys()];
  const state = query.get("state") ?? "";
  if (
    url.href.length > 8_192 ||
    keys.some((key) => !allowed.has(key)) ||
    keys.some((key) => query.getAll(key).length !== 1) ||
    !/^[A-Za-z0-9_-]{43,256}$/.test(state)
  )
    return { kind: "failed" };
  const upstreamError = query.get("error");
  if (upstreamError) {
    if (query.has("code")) return { kind: "failed" };
    return upstreamError === "access_denied"
      ? { kind: "denied", state }
      : { kind: "failed" };
  }
  const code = query.get("code") ?? "";
  if (!code || code.length > 4_096 || /[\u0000-\u001f\u007f]/.test(code))
    return { kind: "failed" };
  return { kind: "authorization", code, state };
}

function safeGithubRepositoryUrl(value: {
  canonicalUrl: string;
  owner: string;
  name: string;
}) {
  return (
    value.canonicalUrl ===
    `https://github.com/${encodeURIComponent(value.owner)}/${encodeURIComponent(value.name)}`
  );
}

function callbackFailureState(
  error: DomainError,
): "connected" | "denied" | "expired" | "unavailable" {
  if (error.code === "invalid-input") return "expired";
  if (error.code !== "forbidden") return "unavailable";
  if (/expired|already used/i.test(error.message)) return "expired";
  if (/already connected/i.test(error.message)) return "connected";
  return "denied";
}

export function createGithubConnectionHandlers(
  overrides: Partial<GithubConnectionHandlerDependencies> = {},
) {
  const deps: GithubConnectionHandlerDependencies = {
    getAccess: async () => (await getGithubServices()).access,
    resolveSession: (request, createIfMissing) =>
      resolveGithubConnectionSession(request, { createIfMissing }),
    createContext: defaultContext,
    getCallbackUrl: () => process.env.GITHUB_APP_CALLBACK_URL,
    now: () => new Date(),
    assertMutationOrigin: assertTrustedMutationOrigin,
    ...overrides,
  };

  async function start(request: Request): Promise<Response> {
    try {
      if (request.method !== "POST")
        return privateJson(
          {
            error: {
              code: "invalid-input",
              message: "Use POST to connect GitHub.",
              retryable: false,
            },
          },
          405,
        );
      deps.assertMutationOrigin(request);
      const callback = configuredCallbackUrl(deps.getCallbackUrl());
      if (!matchesCallbackOrigin(request, callback))
        throw failure(
          "invalid-input",
          "Open the app at the same origin configured for the GitHub callback.",
          400,
        );
      const session = await deps.resolveSession(request, true);
      if (!session)
        throw failure(
          "forbidden",
          "A local app session is required to connect GitHub.",
          401,
        );

      const body = await readBoundedBody(request, 1024);
      let payload: unknown;
      try {
        payload = JSON.parse(new TextDecoder().decode(body) || "{}");
      } catch {
        throw failure("invalid-input", "Use a valid connection request.", 400);
      }
      const returnTo = safeReturnTo(
        payload && typeof payload === "object" && "returnTo" in payload
          ? payload.returnTo
          : undefined,
      );
      const result = await (
        await deps.getAccess()
      ).beginConnection(
        { returnTo },
        deps.createContext(request, session, deps.now()),
      );
      if (!result.ok) {
        const error = portFailure(result.error);
        if (error.status >= 500)
          return privateJson(
            {
              data: {
                state: "unavailable",
                message: error.error.message,
              },
            },
            error.status,
            [
              ...(session.setSessionCookie ? [session.setSessionCookie] : []),
              stateCookie(request, "unavailable"),
            ],
          );
        return privateJson(
          {
            error: error.error,
          },
          error.status,
          session.setSessionCookie ? [session.setSessionCookie] : [],
        );
      }
      const destination = validateAuthorizationUrl(
        result.value.authorizationUrl,
        result.value.state,
        callback,
      );
      return privateJson(
        { data: { state: "connecting", authorizationUrl: destination.href } },
        200,
        [
          ...(session.setSessionCookie ? [session.setSessionCookie] : []),
          stateCookie(request, "connecting"),
          oauthStateCookie(request, result.value.state),
          serializeCookie(
            names(secureRequest(request)).returnTo,
            encodeURIComponent(returnTo),
            secureRequest(request),
            OAUTH_STATE_MAX_AGE,
          ),
        ],
      );
    } catch (error) {
      if (isFailure(error) && error.status >= 500)
        return privateJson(
          { data: { state: "unavailable", message: error.error.message } },
          error.status,
        );
      if (error instanceof AccountAccessError && error.status >= 500)
        return privateJson(
          { data: { state: "unavailable", message: error.message } },
          error.status,
        );
      if (!(error instanceof AccountAccessError) && !isFailure(error))
        return privateJson(
          {
            data: {
              state: "unavailable",
              message: "GitHub connection is temporarily unavailable.",
            },
          },
          503,
        );
      return unexpected(error);
    }
  }

  async function callback(request: Request): Promise<Response> {
    let callback: URL;
    try {
      callback = configuredCallbackUrl(deps.getCallbackUrl());
    } catch (error) {
      return unexpected(error);
    }
    let returnTo = "/library/github/new";
    try {
      returnTo = safeReturnTo(
        decodeURIComponent(
          readCookie(request, names(secureRequest(request)).returnTo) ?? "",
        ),
      );
    } catch {}
    const redirect = (
      target: URL,
      state: "connected" | "denied" | "expired" | "unavailable",
      cookies: string[],
    ) =>
      redirectFromCallback(
        target,
        state,
        [
          ...cookies,
          serializeCookie(
            names(secureRequest(request)).returnTo,
            "",
            secureRequest(request),
            0,
          ),
        ],
        returnTo,
      );
    const url = new URL(request.url);
    if (
      request.method !== "GET" ||
      !matchesCallbackOrigin(request, callback) ||
      url.pathname !== callback.pathname
    )
      return privateJson(
        {
          error: {
            code: "forbidden",
            message: "This GitHub callback does not match the configured app.",
            retryable: false,
          },
        },
        403,
      );

    let session: GithubConnectionSession | null;
    try {
      session = await deps.resolveSession(request, false);
    } catch {
      return redirect(callback, "expired", [clearedOauthStateCookie(request)]);
    }
    if (!session)
      return redirect(callback, "expired", [clearedOauthStateCookie(request)]);

    const query = callbackQuery(request);
    const expectedState = readCookie(
      request,
      names(secureRequest(request)).oauthState,
    );
    if (
      query.kind === "failed" ||
      !expectedState ||
      query.state !== expectedState
    )
      return redirect(callback, "expired", [
        stateCookie(request, "expired"),
        clearedOauthStateCookie(request),
      ]);
    if (query.kind === "denied")
      return redirect(callback, "denied", [
        stateCookie(request, "denied"),
        clearedOauthStateCookie(request),
      ]);

    try {
      const result = await (
        await deps.getAccess()
      ).completeAuthorization(
        { code: query.code, state: query.state },
        deps.createContext(request, session, deps.now()),
      );
      if (result.ok)
        return redirect(callback, "connected", [
          stateCookie(request, "connected"),
          clearedOauthStateCookie(request),
        ]);
      const error = portFailure(result.error);
      const state = callbackFailureState(error.error);
      return redirect(callback, state, [
        stateCookie(request, state),
        clearedOauthStateCookie(request),
      ]);
    } catch {
      return redirect(callback, "unavailable", [
        stateCookie(request, "unavailable"),
        clearedOauthStateCookie(request),
      ]);
    }
  }

  async function repositories(request: Request): Promise<Response> {
    if (request.method.toUpperCase() === "POST")
      return selectRepository(request);
    if (request.method.toUpperCase() !== "GET")
      return privateJson(
        {
          error: {
            code: "invalid-input",
            message: "Use GET to list repositories or POST to select one.",
            retryable: false,
          },
        },
        405,
      );

    try {
      const session = await deps.resolveSession(request, false);
      if (!session)
        return privateJson({
          data: {
            state: "disconnected",
            repositories: [],
            nextCursor: null,
          },
        });
      const query = new URL(request.url).searchParams;
      const queryKeys = [...query.keys()];
      const cursor = query.get("cursor");
      if (
        queryKeys.some((key) => key !== "cursor") ||
        query.getAll("cursor").length > 1 ||
        (cursor !== null &&
          (cursor.length === 0 ||
            cursor.length > 512 ||
            /[\u0000-\u001f\u007f]/.test(cursor)))
      )
        return errorResponse(
          failure(
            "invalid-input",
            "The repository page cursor is invalid.",
            400,
          ),
        );

      const result = await (
        await deps.getAccess()
      ).listAccessibleRepositories(
        { cursor },
        deps.createContext(request, session, deps.now()),
      );
      if (!result.ok) {
        const error = portFailure(result.error);
        if (error.status >= 500)
          return privateJson(
            {
              data: {
                state: "unavailable",
                repositories: [],
                nextCursor: null,
                message: error.error.message,
              },
            },
            error.status,
          );
        if (error.error.code !== "forbidden") return errorResponse(error);
        const state =
          session.state === "connected"
            ? "expired"
            : session.state === "connecting" ||
                session.state === "denied" ||
                session.state === "expired"
              ? session.state
              : "disconnected";
        const message =
          state === "expired"
            ? "GitHub access expired or changed. Reconnect to continue."
            : state === "denied"
              ? "GitHub authorization was declined."
              : state === "connecting"
                ? "Finish connecting GitHub to list repositories."
                : "Connect a GitHub account to list repositories.";
        return privateJson({
          data: { state, repositories: [], nextCursor: null, message },
        });
      }

      if (
        result.value.repositories.length > 100 ||
        (result.value.nextCursor !== null &&
          (result.value.nextCursor.length > 512 ||
            /[\u0000-\u001f\u007f]/.test(result.value.nextCursor)))
      )
        return errorResponse(
          failure(
            "upstream-error",
            "GitHub returned an invalid repository page.",
            502,
          ),
        );
      const parsed = result.value.repositories.map((repository) => {
        const safe = RepositorySummarySchema.safeParse(repository);
        if (!safe.success || !safeGithubRepositoryUrl(safe.data))
          throw failure(
            "upstream-error",
            "GitHub returned invalid repository metadata.",
            502,
          );
        return safe.data;
      });
      return privateJson(
        {
          data: {
            state: "connected",
            repositories: parsed,
            nextCursor: result.value.nextCursor,
            ...(parsed.length === 0
              ? {
                  message:
                    "No repositories are currently authorized for this GitHub App. Install it for a repository or ask an organization admin to approve access, then refresh.",
                }
              : {}),
          },
        },
        200,
        [stateCookie(request, "connected")],
      );
    } catch (error) {
      if (isFailure(error) && error.status >= 500)
        return privateJson(
          {
            data: {
              state: "unavailable",
              repositories: [],
              nextCursor: null,
              message: error.error.message,
            },
          },
          error.status,
        );
      if (error instanceof AccountAccessError && error.status >= 500)
        return privateJson(
          {
            data: {
              state: "unavailable",
              repositories: [],
              nextCursor: null,
              message: error.message,
            },
          },
          error.status,
        );
      if (!(error instanceof AccountAccessError) && !isFailure(error))
        return privateJson(
          {
            data: {
              state: "unavailable",
              repositories: [],
              nextCursor: null,
              message: "GitHub connection is temporarily unavailable.",
            },
          },
          503,
        );
      return unexpected(error);
    }
  }

  async function selectRepository(request: Request): Promise<Response> {
    try {
      deps.assertMutationOrigin(request);
      const session = await deps.resolveSession(request, false);
      if (!session)
        return privateJson(
          {
            error: {
              code: "forbidden",
              message:
                "Connect a GitHub account before selecting a repository.",
              retryable: false,
            },
          },
          401,
        );
      if (
        request.headers
          .get("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase() !== "application/json"
      )
        return errorResponse(
          failure("invalid-input", "Send a JSON repository selection.", 400),
        );

      let body: unknown;
      try {
        const bytes = await readBoundedBody(request, 4_096);
        body = JSON.parse(new TextDecoder().decode(bytes));
      } catch (error) {
        if (error instanceof AccountAccessError) return unexpected(error);
        return errorResponse(
          failure("invalid-input", "The repository selection is invalid.", 400),
        );
      }
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        !("repositoryId" in body) ||
        typeof body.repositoryId !== "string" ||
        !/^[1-9]\d{0,19}$/.test(body.repositoryId)
      )
        return errorResponse(
          failure("invalid-input", "Choose a valid GitHub repository.", 400),
        );

      const result = await (
        await deps.getAccess()
      ).authorizeRepository(
        { repositoryId: body.repositoryId },
        deps.createContext(request, session, deps.now()),
      );
      if (!result.ok) {
        const error = portFailure(result.error);
        return errorResponse(
          error.error.code === "forbidden" || error.error.code === "not-found"
            ? failure(
                "not-found",
                "The selected repository is not available to this GitHub connection.",
                404,
              )
            : error,
        );
      }
      const scope = RepositoryScopeSchema.safeParse(result.value.scope);
      if (!scope.success || !safeGithubRepositoryUrl(scope.data))
        return errorResponse(
          failure(
            "upstream-error",
            "GitHub returned invalid repository metadata.",
            502,
          ),
        );
      return privateJson(
        { data: { state: "connected", scope: scope.data } },
        200,
        [stateCookie(request, "connected")],
      );
    } catch (error) {
      return unexpected(error);
    }
  }

  async function disconnect(request: Request): Promise<Response> {
    try {
      deps.assertMutationOrigin(request);
      const session = await deps.resolveSession(request, false);
      if (!session)
        return privateJson(
          {
            data: {
              state: "disconnected",
              upstreamRevocation: "not-requested",
              message:
                "There is no local GitHub connection. Authorization and installation settings are managed on GitHub.",
              authorizationSettingsUrl:
                "https://github.com/settings/connections/applications",
              installationSettingsUrl:
                "https://github.com/settings/installations",
            },
          },
          200,
          clearedConnectionCookies(request, null),
        );
      const result = await (
        await deps.getAccess()
      ).disconnect(
        { cancelActiveJobs: true },
        deps.createContext(request, session, deps.now()),
      );
      if (!result.ok) {
        const error = portFailure(result.error);
        if (error.status >= 500)
          return privateJson(
            {
              data: {
                state: "unavailable",
                message: error.error.message,
              },
              error: error.error,
            },
            error.status,
          );
        return errorResponse(error);
      }
      return privateJson(
        {
          data: {
            state: "disconnected",
            upstreamRevocation: result.value.upstreamRevocation,
            message:
              "Local credentials were removed and affected jobs were cancelled. This does not revoke GitHub authorization or uninstall the app.",
            authorizationSettingsUrl:
              "https://github.com/settings/connections/applications",
            installationSettingsUrl:
              "https://github.com/settings/installations",
          },
        },
        200,
        clearedConnectionCookies(request, session),
      );
    } catch (error) {
      return unexpected(error);
    }
  }

  return { start, callback, repositories, disconnect };
}

const defaultHandlers = createGithubConnectionHandlers();
export const startGithubConnection = defaultHandlers.start;
export const githubConnectionCallback = defaultHandlers.callback;
export const githubConnectionRepositories = defaultHandlers.repositories;
export const disconnectGithubConnection = defaultHandlers.disconnect;
