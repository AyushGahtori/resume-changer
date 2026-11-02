import { describe, expect, it, vi } from "vitest";
import type {
  DomainError,
  ExecutionContext,
  RepositoryScope,
  RepositorySummary,
  Result,
} from "@/lib/github/contracts";
import type { GithubAccessPort } from "@/lib/github/ports";
import {
  createGithubConnectionHandlers,
  resolveGithubConnectionSession,
} from "@/lib/github/server/connection-session";

vi.mock("@/lib/cloud/server-account", () => ({
  accountFromRequest: vi.fn(async () => ({ uid: "test-account" })),
}));

const APP_ORIGIN = "http://localhost:3000";
const CALLBACK_URL = APP_ORIGIN + "/api/github/connection/callback";
const STATE = "A".repeat(43);
const CHALLENGE = "B".repeat(43);

const repository: RepositorySummary = {
  repositoryId: "101",
  owner: "octo",
  name: "sample",
  canonicalUrl: "https://github.com/octo/sample",
  visibility: "private",
  defaultBranch: "main",
  permission: "read",
};

const scope: RepositoryScope = {
  repositoryId: "101",
  owner: "octo",
  name: "sample",
  canonicalUrl: "https://github.com/octo/sample",
  visibility: "private",
  ref: "main",
  commitSha: "a".repeat(40),
  selectedPullRequestNumbers: [],
  selectedPaths: [],
  contributionStatement: "I maintained the service.",
  identitySource: "user-provided",
};

function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

function failure(code: DomainError["code"], message: string): Result<never> {
  return {
    ok: false,
    error: { code, message, retryable: false },
  };
}

function authorizationUrl(state = STATE) {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", "Iv1.example");
  url.searchParams.set("redirect_uri", CALLBACK_URL);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", "offline_access");
  url.searchParams.set("code_challenge", CHALLENGE);
  url.searchParams.set("code_challenge_method", "S256");
  return url.href;
}

function executionContext(sessionId: string): ExecutionContext {
  const zero = {
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
  const unavailable: DomainError = {
    code: "unavailable",
    message: "No import budget is used in this route test.",
    retryable: false,
  };
  return {
    personalRoot: "C:/personal",
    access: {
      sessionId,
      authorizationNamespace: "test:" + sessionId,
      accountId: null,
      grantedRepositoryIds: [],
    },
    signal: new AbortController().signal,
    now: () => new Date("2026-10-26T00:00:00.000Z"),
    runId: "github-connection-test",
    deadline: "2026-10-26T00:01:00.000Z",
    budget: {
      reserve: async () => ({ ok: false, error: unavailable }),
      commitUsage: async () => ({ ok: false, error: unavailable }),
      checkSelection: () => ({
        ok: true,
        value: { allowed: false, reason: "Not an analysis route." },
      }),
      remaining: () => success(zero),
      snapshot: () => success(zero),
    },
  };
}

function createAccess(
  updates: Partial<GithubAccessPort> = {},
): GithubAccessPort {
  const defaults: GithubAccessPort = {
    beginConnection: vi.fn(async () =>
      success({ authorizationUrl: authorizationUrl(), state: STATE }),
    ),
    completeAuthorization: vi.fn(async () =>
      success({ accountId: "42", connectedAt: "2026-10-26T00:00:00.000Z" }),
    ),
    listAccessibleRepositories: vi.fn(async () =>
      success({ repositories: [repository], nextCursor: null }),
    ),
    authorizeRepository: vi.fn(async () => success({ scope })),
    disconnect: vi.fn(async () =>
      success({
        disconnected: true as const,
        upstreamRevocation: "not-requested" as const,
      }),
    ),
  };
  return { ...defaults, ...updates };
}

function createHandlers(access = createAccess()) {
  const handlers = createGithubConnectionHandlers({
    getAccess: () => access,
    resolveSession: (request, createIfMissing) =>
      resolveGithubConnectionSession(request, {
        mode: () => "local",
        createIfMissing,
        randomBytes: (size) => new Uint8Array(size),
      }),
    createContext: (request, session, now) => ({
      ...executionContext(session.sessionId),
      signal: request.signal,
      now: () => new Date(now),
    }),
    getCallbackUrl: () => CALLBACK_URL,
    now: () => new Date("2026-10-26T00:00:00.000Z"),
    assertMutationOrigin(request) {
      const origin = request.headers.get("origin");
      if (origin !== new URL(request.url).origin)
        throw new Error("Cross-origin mutation blocked.");
    },
  });
  return { access, handlers };
}

function cookieHeader(response: Response) {
  const value = response.headers.get("set-cookie") ?? "";
  return value
    .split(/, (?=[^;,]+=)/u)
    .map((cookie) => cookie.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

function startRequest(body?: unknown) {
  return new Request(APP_ORIGIN + "/api/github/connection/start", {
    method: "POST",
    headers: {
      origin: APP_ORIGIN,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("GitHub connection routes", () => {
  it("starts with an exact GitHub destination and a protected local cookie", async () => {
    const { handlers } = createHandlers();
    const response = await handlers.start(
      startRequest({ returnTo: "https://attacker.example/" }),
    );
    const body = await response.json();
    const destination = new URL(body.data.authorizationUrl);

    expect(response.status).toBe(200);
    expect(body.data.state).toBe("connecting");
    expect(destination.origin).toBe("https://github.com");
    expect(destination.searchParams.get("redirect_uri")).toBe(CALLBACK_URL);
    expect(body.data.authorizationUrl).not.toContain("attacker.example");
    expect(body.data).not.toHaveProperty("sessionId");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
    expect(response.headers.get("set-cookie")).not.toContain("Secure");
    expect(response.headers.get("set-cookie")).toContain(
      "github_oauth_state=" + STATE,
    );
    expect(cookieHeader(response)).toContain("github_session=");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it.each([
    "/library/github/import-one",
    "/library/github/new?projectId=project-one",
    "https://attacker.example/",
    "//attacker.example/library/github/new",
    "/generate",
    "/library/github/new?redirect=https://attacker.example",
  ])("restores only safe import destinations: %s", async (returnTo) => {
    const { handlers } = createHandlers();
    const started = await handlers.start(startRequest({ returnTo }));
    expect(started.status).toBe(200);
    const completed = await handlers.callback(
      new Request(CALLBACK_URL + "?code=fictional-code&state=" + STATE, {
        headers: { cookie: cookieHeader(started) },
      }),
    );
    const destination = new URL(completed.headers.get("location")!);
    expect(destination.origin).toBe(APP_ORIGIN);
    const expected =
      returnTo.startsWith("/library/github/") && !returnTo.includes("redirect=")
        ? returnTo
        : "/library/github/new";
    expect(
      destination.pathname +
        (destination.searchParams.has("projectId")
          ? "?projectId=" + destination.searchParams.get("projectId")
          : ""),
    ).toBe(expected);
    expect(completed.headers.get("set-cookie")).toContain(
      "github_return_to=; Path=/; Max-Age=0",
    );
  });

  it("blocks cross-origin connection starts before calling the access port", async () => {
    const access = createAccess();
    const handlers = createGithubConnectionHandlers({
      getAccess: () => access,
      resolveSession: (request, createIfMissing) =>
        resolveGithubConnectionSession(request, {
          mode: () => "local",
          createIfMissing,
        }),
      getCallbackUrl: () => CALLBACK_URL,
      now: () => new Date("2026-10-26T00:00:00.000Z"),
    });
    const response = await handlers.start(
      new Request(APP_ORIGIN + "/api/github/connection/start", {
        method: "POST",
        headers: { origin: "https://attacker.example" },
      }),
    );

    expect(response.status).toBe(403);
    expect(access.beginConnection).not.toHaveBeenCalled();
  });

  it("binds callback completion to the session, consumes replay through the access port, and redirects safely", async () => {
    let consumed = false;
    const access = createAccess({
      completeAuthorization: vi.fn(async (input, context) => {
        if (
          consumed ||
          input.state !== STATE ||
          context.access.sessionId !== "local-" + "A".repeat(43)
        )
          return failure("forbidden", "The callback is expired.");
        consumed = true;
        return success({
          accountId: "42",
          connectedAt: "2026-10-26T00:00:00.000Z",
        });
      }),
    });
    const { handlers } = createHandlers(access);
    const start = await handlers.start(startRequest());
    const cookies = cookieHeader(start);
    const callback = (cookie: string) =>
      handlers.callback(
        new Request(CALLBACK_URL + "?code=oauth-code&state=" + STATE, {
          headers: { cookie },
        }),
      );

    const first = await callback(cookies);
    const replay = await callback(cookies);
    const firstLocation = new URL(first.headers.get("location") ?? "");
    const replayLocation = new URL(replay.headers.get("location") ?? "");

    expect(first.status).toBe(303);
    expect(firstLocation.origin).toBe(APP_ORIGIN);
    expect(firstLocation.pathname).toBe("/library/github/new");
    expect(firstLocation.searchParams.get("githubConnection")).toBe(
      "connected",
    );
    expect(first.headers.get("referrer-policy")).toBe("no-referrer");
    expect(first.headers.get("location")).not.toContain("oauth-code");
    expect(replayLocation.searchParams.get("githubConnection")).toBe("expired");
  });

  it("rejects a callback from another session before exchanging its code", async () => {
    let exchanged = false;
    const access = createAccess({
      completeAuthorization: vi.fn(async (_input, context) => {
        if (context.access.sessionId !== "local-" + "A".repeat(43))
          return failure(
            "forbidden",
            "GitHub authorization expired or was already used.",
          );
        exchanged = true;
        return success({
          accountId: "42",
          connectedAt: "2026-10-26T00:00:00.000Z",
        });
      }),
    });
    const { handlers } = createHandlers(access);
    const start = await handlers.start(startRequest());
    const wrongSession = cookieHeader(start).replace(
      "github_session=" + "A".repeat(43),
      "github_session=" + "C".repeat(43),
    );
    const response = await handlers.callback(
      new Request(CALLBACK_URL + "?code=oauth-code&state=" + STATE, {
        headers: { cookie: wrongSession },
      }),
    );

    expect(
      new URL(response.headers.get("location") ?? "").searchParams.get(
        "githubConnection",
      ),
    ).toBe("expired");
    expect(access.completeAuthorization).toHaveBeenCalledWith(
      { code: "oauth-code", state: STATE },
      expect.objectContaining({
        access: expect.objectContaining({
          sessionId: "local-" + "C".repeat(43),
        }),
      }),
    );
    expect(exchanged).toBe(false);
    expect(start.status).toBe(200);
  });

  it.each([
    "&installation_id=123&setup_action=update",
    "&scope=offline_access&provider_metadata=future-extension",
    "&returnTo=https%3A%2F%2Fattacker.example&sessionId=another-account",
  ])(
    "ignores unused OAuth response metadata without forwarding or reflecting it: %s",
    async (extra) => {
      const { access, handlers } = createHandlers();
      const started = await handlers.start(startRequest());
      const response = await handlers.callback(
        new Request(CALLBACK_URL + "?code=oauth-code&state=" + STATE + extra, {
          headers: { cookie: cookieHeader(started) },
        }),
      );
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        APP_ORIGIN + "/library/github/new?githubConnection=connected",
      );
      expect(access.completeAuthorization).toHaveBeenCalledExactlyOnceWith(
        { code: "oauth-code", state: STATE },
        expect.objectContaining({
          access: expect.objectContaining({
            sessionId: "local-" + "A".repeat(43),
          }),
        }),
      );
    },
  );

  it.each([
    { query: "code=oauth-code&state=" + STATE + "&state=" + STATE },
    { query: "code=oauth-code&code=another-code&state=" + STATE },
    { query: "code=oauth-code&error=access_denied&state=" + STATE },
    { query: "code=oauth-code&state=" + "B".repeat(43) },
    { query: "code=oauth-code&state=" + STATE, noStateCookie: true },
    {
      query:
        "code=oauth-code&state=" + STATE + "&metadata=" + "x".repeat(8_192),
    },
  ])(
    "rejects invalid OAuth responses even with unused metadata: $query",
    async ({ query, noStateCookie }) => {
      const { access, handlers } = createHandlers();
      const started = await handlers.start(startRequest());
      const cookie = cookieHeader(started)
        .split("; ")
        .filter(
          (value) => !noStateCookie || !value.startsWith("github_oauth_state="),
        )
        .join("; ");
      const response = await handlers.callback(
        new Request(CALLBACK_URL + "?" + query + "&extension=ignored", {
          headers: { cookie },
        }),
      );
      expect(
        new URL(response.headers.get("location")!).searchParams.get(
          "githubConnection",
        ),
      ).toBe("expired");
      expect(access.completeAuthorization).not.toHaveBeenCalled();
    },
  );

  it("reports GitHub organization or installation denial without exposing provider details", async () => {
    const access = createAccess({
      completeAuthorization: vi.fn(async () =>
        failure(
          "forbidden",
          "GitHub denied repository access. The organization may require approval or the repository grant may have changed.",
        ),
      ),
    });
    const { handlers } = createHandlers(access);
    const started = await handlers.start(startRequest());
    const response = await handlers.callback(
      new Request(CALLBACK_URL + "?code=oauth-code&state=" + STATE, {
        headers: { cookie: cookieHeader(started) },
      }),
    );

    expect(
      new URL(response.headers.get("location") ?? "").searchParams.get(
        "githubConnection",
      ),
    ).toBe("denied");
  });

  it("requires the issued browser-bound state before accepting an OAuth denial", async () => {
    const access = createAccess();
    const { handlers } = createHandlers(access);
    const started = await handlers.start(startRequest());
    const response = await handlers.callback(
      new Request(
        CALLBACK_URL + "?error=access_denied&state=" + "C".repeat(43),
        {
          headers: { cookie: cookieHeader(started) },
        },
      ),
    );

    expect(
      new URL(response.headers.get("location") ?? "").searchParams.get(
        "githubConnection",
      ),
    ).toBe("expired");
    expect(access.completeAuthorization).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("keeps declined and stale callback states distinct without reflecting provider text", async () => {
    const { handlers } = createHandlers();
    const started = await handlers.start(startRequest());
    const cookie = cookieHeader(started);
    const denied = await handlers.callback(
      new Request(CALLBACK_URL + "?error=access_denied&state=" + STATE, {
        headers: { cookie },
      }),
    );
    const malformed = await handlers.callback(
      new Request(CALLBACK_URL + "?error=unexpected&error_description=secret", {
        headers: { cookie },
      }),
    );

    expect(
      new URL(denied.headers.get("location") ?? "").searchParams.get(
        "githubConnection",
      ),
    ).toBe("denied");
    expect(
      new URL(malformed.headers.get("location") ?? "").searchParams.get(
        "githubConnection",
      ),
    ).toBe("expired");
    expect(malformed.headers.get("location")).not.toContain("secret");
  });

  it("lists only safe bounded metadata and hides whether an inaccessible repository exists", async () => {
    const { handlers } = createHandlers(
      createAccess({
        listAccessibleRepositories: vi.fn(async () =>
          success({ repositories: [repository], nextCursor: "next-page" }),
        ),
        authorizeRepository: vi.fn(async () =>
          failure("forbidden", "Private repo denied."),
        ),
      }),
    );
    const started = await handlers.start(startRequest());
    const cookie = cookieHeader(started);
    const list = await handlers.repositories(
      new Request(APP_ORIGIN + "/api/github/connection/repositories", {
        headers: { cookie },
      }),
    );
    const denied = await handlers.repositories(
      new Request(APP_ORIGIN + "/api/github/connection/repositories", {
        method: "POST",
        headers: {
          cookie,
          origin: APP_ORIGIN,
          "content-type": "application/json",
        },
        body: JSON.stringify({ repositoryId: "999" }),
      }),
    );

    const listed = await list.json();
    expect(listed.data.repositories).toEqual([repository]);
    expect(listed.data.nextCursor).toBe("next-page");
    expect(denied.status).toBe(404);
    expect(await denied.text()).not.toContain("Private repo denied.");
  });

  it("rejects unbounded pages and repository links outside GitHub", async () => {
    const oversized = createAccess({
      listAccessibleRepositories: vi.fn(async () =>
        success({
          repositories: Array.from({ length: 101 }, (_, index) => ({
            ...repository,
            repositoryId: String(index + 1),
          })),
          nextCursor: null,
        }),
      ),
    });
    const oversizedHandlers = createHandlers(oversized).handlers;
    const started = await oversizedHandlers.start(startRequest());
    const oversizedResponse = await oversizedHandlers.repositories(
      new Request(APP_ORIGIN + "/api/github/connection/repositories", {
        headers: { cookie: cookieHeader(started) },
      }),
    );

    const hostile = createAccess({
      listAccessibleRepositories: vi.fn(async () =>
        success({
          repositories: [
            {
              ...repository,
              canonicalUrl: "https://attacker.example/octo/sample",
            },
          ],
          nextCursor: null,
        }),
      ),
    });
    const hostileHandlers = createHandlers(hostile).handlers;
    const hostileStart = await hostileHandlers.start(startRequest());
    const hostileResponse = await hostileHandlers.repositories(
      new Request(APP_ORIGIN + "/api/github/connection/repositories", {
        headers: { cookie: cookieHeader(hostileStart) },
      }),
    );

    expect(oversizedResponse.status).toBe(502);
    expect(hostileResponse.status).toBe(502);
  });

  it("rejects ambiguous or unknown repository pagination parameters", async () => {
    const access = createAccess();
    const { handlers } = createHandlers(access);
    const started = await handlers.start(startRequest());
    const cookie = cookieHeader(started);

    const duplicate = await handlers.repositories(
      new Request(
        APP_ORIGIN +
          "/api/github/connection/repositories?cursor=first&cursor=second",
        { headers: { cookie } },
      ),
    );
    const unknown = await handlers.repositories(
      new Request(APP_ORIGIN + "/api/github/connection/repositories?page=2", {
        headers: { cookie },
      }),
    );

    expect(duplicate.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(access.listAccessibleRepositories).not.toHaveBeenCalled();
  });

  it("uses the current session when selecting a repository and hides inaccessible IDs", async () => {
    const access = createAccess({
      authorizeRepository: vi.fn(async (input, context) => {
        if (
          input.repositoryId !== "101" ||
          context.access.sessionId !== "local-" + "A".repeat(43)
        )
          return failure("forbidden", "Repository access is unavailable.");
        return success({ scope });
      }),
    });
    const { handlers } = createHandlers(access);
    const response = await handlers.repositories(
      new Request(APP_ORIGIN + "/api/github/connection/repositories", {
        method: "POST",
        headers: {
          cookie: "github_session=" + "C".repeat(43),
          origin: APP_ORIGIN,
          "content-type": "application/json",
        },
        body: JSON.stringify({ repositoryId: "101" }),
      }),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("local-");
    expect(access.authorizeRepository).toHaveBeenCalledWith(
      { repositoryId: "101" },
      expect.objectContaining({
        access: expect.objectContaining({
          sessionId: "local-" + "C".repeat(43),
        }),
      }),
    );
  });

  it("returns disconnected, connecting, and unavailable states explicitly", async () => {
    const unavailableAccess = createAccess({
      beginConnection: vi.fn(async () =>
        failure("unavailable", "Provider configuration is missing."),
      ),
      listAccessibleRepositories: vi.fn(async () =>
        failure("unavailable", "Provider configuration is missing."),
      ),
    });
    const { handlers } = createHandlers(unavailableAccess);
    const disconnected = await handlers.repositories(
      new Request(APP_ORIGIN + "/api/github/connection/repositories"),
    );
    const unavailable = await handlers.start(startRequest());
    const unavailableList = await handlers.repositories(
      new Request(APP_ORIGIN + "/api/github/connection/repositories", {
        headers: { cookie: cookieHeader(unavailable) },
      }),
    );

    expect((await disconnected.json()).data.state).toBe("disconnected");
    expect((await unavailable.json()).data.state).toBe("unavailable");
    expect((await unavailableList.json()).data.state).toBe("unavailable");
    expect(unavailable.status).toBe(503);

    const missingCallback = createGithubConnectionHandlers({
      getCallbackUrl: () => undefined,
    });
    const missingConfig = await missingCallback.start(startRequest());
    expect(missingConfig.status).toBe(503);
    expect((await missingConfig.json()).data.state).toBe("unavailable");
  });

  it("disconnects idempotently, cancels jobs, and clears the local session cookie", async () => {
    const access = createAccess();
    const { handlers } = createHandlers(access);
    const started = await handlers.start(startRequest());
    const response = await handlers.disconnect(
      new Request(APP_ORIGIN + "/api/github/connection/disconnect", {
        method: "POST",
        headers: { origin: APP_ORIGIN, cookie: cookieHeader(started) },
      }),
    );
    const again = await handlers.disconnect(
      new Request(APP_ORIGIN + "/api/github/connection/disconnect", {
        method: "POST",
        headers: { origin: APP_ORIGIN },
      }),
    );
    const data = (await response.json()).data;

    expect(data.state).toBe("disconnected");
    expect(data.upstreamRevocation).toBe("not-requested");
    expect(data.message).toContain("does not revoke GitHub authorization");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(access.disconnect).toHaveBeenCalledWith(
      { cancelActiveJobs: true },
      expect.objectContaining({
        access: expect.objectContaining({
          sessionId: "local-" + "A".repeat(43),
        }),
      }),
    );
    expect((await again.json()).data.state).toBe("disconnected");
  });

  it("uses Secure __Host cookies for HTTPS and refuses callback-origin substitution", async () => {
    const session = await resolveGithubConnectionSession(
      new Request("https://app.example/api/github/connection/start"),
      {
        mode: () => "local",
        createIfMissing: true,
        randomBytes: (size) => new Uint8Array(size).fill(2),
      },
    );
    const { handlers } = createHandlers();
    const mismatch = await handlers.callback(
      new Request(
        "https://attacker.example/api/github/connection/callback?code=x&state=" +
          STATE,
      ),
    );

    expect(session?.setSessionCookie).toContain("__Host-github_session=");
    expect(session?.setSessionCookie).toContain("Secure");
    expect(session?.setSessionCookie).toContain("HttpOnly");
    expect(mismatch.status).toBe(403);
    await expect(
      resolveGithubConnectionSession(
        new Request("http://attacker.example/api/github/connection/start"),
        { mode: () => "local", createIfMissing: true },
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("binds hosted GitHub access to the authenticated application account", async () => {
    const accountFromRequest = vi.fn(async () => ({ uid: "account_123" }));
    const session = await resolveGithubConnectionSession(
      new Request("https://app.example/api/github/connection/start"),
      {
        mode: () => "firebase",
        accountFromRequest,
      },
    );

    expect(accountFromRequest).toHaveBeenCalledOnce();
    expect(session).toMatchObject({
      sessionId: "account-account_123",
      authorizationNamespace: "firebase:account_123",
      accountId: "account_123",
      isLocal: false,
    });
    expect(session?.setSessionCookie).toBeUndefined();
  });
});
