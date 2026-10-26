import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGithubAccess,
  GithubAuthorizationError,
  type GithubAccessDependencies,
  type GithubAccessStore,
  type GithubAuthorizationExchange,
  type GithubInstallation,
  type GithubRepository,
  type PendingGithubAuthorization,
  type StoredGithubConnection,
  type StoredGithubRepositoryGrant,
} from "../../../../src/lib/github/server/access";
import type {
  GithubCredentialHandle,
  GithubCredentialScope,
  GithubCredentialSecrets,
  GithubCredentialVault,
} from "../../../../src/lib/github/server/credentials";

const SESSION_ID = "local-session_01";
const CALLBACK_ORIGIN = "https://app.example.test";
const CALLBACK_URL = `${CALLBACK_ORIGIN}/api/github/connection/callback`;
const USER_TOKEN = "ghu_test_user_secret_value";
const ROTATED_USER_TOKEN = "ghu_rotated_user_secret_value";
const INSTALLATION_TOKEN = "ghs_test_repository_secret_value";

function isoAfter(
  milliseconds: number,
  from = new Date("2030-01-01T00:00:00.000Z"),
) {
  return new Date(from.getTime() + milliseconds).toISOString();
}

function sameScope(left: GithubCredentialScope, right: GithubCredentialScope) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function createHarness() {
  let currentTime = new Date("2030-01-01T00:00:00.000Z");
  let randomCall = 0;
  const pending = new Map<string, PendingGithubAuthorization>();
  const connections = new Map<string, StoredGithubConnection>();
  const repositoryGrants = new Map<string, StoredGithubRepositoryGrant>();
  const credentials = new Map<
    string,
    { scope: GithubCredentialScope; secrets: GithubCredentialSecrets }
  >();
  const repositories = new Map<number, GithubRepository[]>([
    [
      41,
      [
        {
          id: 101,
          name: "resume-changer",
          private: true,
          owner: { login: "AyushGahtori" },
        },
      ],
    ],
  ]);
  const installations: GithubInstallation[] = [
    {
      id: 41,
      account: { id: 72, login: "ExampleOrg", type: "Organization" },
    },
  ];
  const calls = {
    exchange: vi.fn(async () => ({
      accessToken: USER_TOKEN,
      accessExpiresAt: isoAfter(8 * 60 * 60 * 1000, currentTime),
      refreshToken: "ghr_test_refresh_secret_value",
      refreshExpiresAt: isoAfter(180 * 24 * 60 * 60 * 1000, currentTime),
    })),
    refresh: vi.fn(async () => ({
      accessToken: ROTATED_USER_TOKEN,
      accessExpiresAt: isoAfter(8 * 60 * 60 * 1000, currentTime),
      refreshToken: "ghr_rotated_refresh_secret_value",
      refreshExpiresAt: isoAfter(180 * 24 * 60 * 60 * 1000, currentTime),
    })),
    getUser: vi.fn(async () => ({ id: 501, login: "AyushGahtori" })),
    listInstallations: vi.fn(async () => installations),
    listRepositories: vi.fn(
      async ({ installationId }: { installationId: number }) =>
        repositories.get(installationId) ?? [],
    ),
    createInstallationToken: vi.fn(async () => ({
      accessToken: INSTALLATION_TOKEN,
      expiresAt: isoAfter(60 * 60 * 1000, currentTime),
      permissions: {
        metadata: "read",
        contents: "read",
        pull_requests: "read",
      },
      repositoryIds: ["101"],
    })),
  };

  const store: GithubAccessStore = {
    async savePending(record) {
      pending.set(record.stateHash, record);
    },
    async consumePending(input) {
      const record = pending.get(input.stateHash);
      if (
        !record ||
        record.sessionId !== input.sessionId ||
        record.callbackOrigin !== input.callbackOrigin ||
        Date.parse(record.expiresAt) <= Date.parse(input.now)
      )
        return undefined;
      pending.delete(input.stateHash);
      return record;
    },
    async deletePendingForSession(sessionId) {
      for (const [hash, record] of pending)
        if (record.sessionId === sessionId) pending.delete(hash);
    },
    async getConnection(sessionId) {
      return connections.get(sessionId);
    },
    async createConnectionIfAbsent(record) {
      if (connections.has(record.sessionId)) return false;
      connections.set(record.sessionId, record);
      return true;
    },
    async deleteConnection(sessionId) {
      connections.delete(sessionId);
      for (const [key, grant] of repositoryGrants)
        if (grant.sessionId === sessionId) repositoryGrants.delete(key);
    },
    async listRepositoryGrants(sessionId) {
      return [...repositoryGrants.values()].filter(
        (grant) => grant.sessionId === sessionId,
      );
    },
    async saveRepositoryGrant(grant) {
      repositoryGrants.set(`${grant.sessionId}:${grant.repositoryId}`, grant);
    },
    async removeRepositoryGrant(sessionId, repositoryId) {
      repositoryGrants.delete(`${sessionId}:${repositoryId}`);
    },
    async clearCaches() {},
  };

  const credentialVault: GithubCredentialVault = {
    async put({ scope, secrets }) {
      const handle =
        `opaque-credential-handle-${String(credentials.size + 1).padStart(4, "0")}` as GithubCredentialHandle;
      credentials.set(handle, { scope, secrets: { ...secrets } });
      return handle;
    },
    async read(handle, scope) {
      const entry = credentials.get(handle);
      return entry && sameScope(entry.scope, scope)
        ? { ...entry.secrets }
        : undefined;
    },
    async replace(handle, scope, secrets) {
      const entry = credentials.get(handle);
      if (!entry || !sameScope(entry.scope, scope))
        throw new Error("Credential handle scope mismatch");
      credentials.set(handle, { scope, secrets: { ...secrets } });
    },
    async delete(handle, scope) {
      const entry = credentials.get(handle);
      if (entry && sameScope(entry.scope, scope)) credentials.delete(handle);
    },
    async deleteSession(sessionId) {
      for (const [handle, entry] of credentials)
        if (entry.scope.sessionId === sessionId) credentials.delete(handle);
    },
  };

  const github: GithubAuthorizationExchange = {
    exchangeAuthorizationCode: calls.exchange,
    refreshUserToken: calls.refresh,
    getAuthenticatedUser: calls.getUser,
    listAccessibleInstallations: calls.listInstallations,
    listInstallationRepositories: calls.listRepositories,
    createInstallationToken: calls.createInstallationToken,
  };
  const cancellation = { cancelJobs: vi.fn(async () => undefined) };
  const deps: GithubAccessDependencies = {
    config: { clientId: "Iv1.test-client", callbackUrl: CALLBACK_URL },
    store,
    credentialVault,
    github,
    cancellation,
    clock: { now: () => new Date(currentTime) },
    randomBytes(length) {
      randomCall += 1;
      return new Uint8Array(length).fill(randomCall);
    },
  };
  const access = createGithubAccess(deps);

  return {
    access,
    calls,
    connections,
    credentials,
    pending,
    repositoryGrants,
    repositories,
    store,
    credentialVault,
    cancellation,
    deps,
    advance(milliseconds: number) {
      currentTime = new Date(currentTime.getTime() + milliseconds);
    },
    get now() {
      return currentTime;
    },
    async connect(sessionId = SESSION_ID) {
      const begin = await access.beginConnection({
        sessionId,
        callbackOrigin: CALLBACK_ORIGIN,
      });
      if (!begin.ok) throw new Error(begin.error.message);
      const state = new URL(begin.value.authorizationUrl).searchParams.get(
        "state",
      );
      if (!state) throw new Error("No state in authorization URL");
      const complete = await access.completeAuthorization({
        sessionId,
        callbackOrigin: CALLBACK_ORIGIN,
        state,
        code: "synthetic-code",
      });
      if (!complete.ok) throw new Error(complete.error.message);
      return { state, connected: complete.value };
    },
  };
}

describe("GitHub authorization core", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it("starts a one-use, session-bound PKCE authorization with the exact callback", async () => {
    const result = await harness.access.beginConnection({
      sessionId: SESSION_ID,
      callbackOrigin: CALLBACK_ORIGIN,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const url = new URL(result.value.authorizationUrl);
    const state = url.searchParams.get("state");
    const challenge = url.searchParams.get("code_challenge");
    expect(url.origin + url.pathname).toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("Iv1.test-client");
    expect(url.searchParams.get("redirect_uri")).toBe(CALLBACK_URL);
    expect(url.searchParams.get("scope")).toBe("offline_access");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(state).toHaveLength(43);
    expect(challenge).toHaveLength(43);
    expect(result.value.expiresAt).toBe("2030-01-01T00:10:00.000Z");
    expect([...harness.pending.values()][0]).toMatchObject({
      sessionId: SESSION_ID,
      callbackOrigin: CALLBACK_ORIGIN,
      callbackUrl: CALLBACK_URL,
    });
    expect(JSON.stringify([...harness.pending.values()])).not.toContain(state);
  });

  it("rejects mismatched session and callback origin without consuming the valid state", async () => {
    const begin = await harness.access.beginConnection({
      sessionId: SESSION_ID,
      callbackOrigin: CALLBACK_ORIGIN,
    });
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    const state = new URL(begin.value.authorizationUrl).searchParams.get(
      "state",
    )!;

    const wrongSession = await harness.access.completeAuthorization({
      sessionId: "another-session",
      callbackOrigin: CALLBACK_ORIGIN,
      state,
      code: "synthetic-code",
    });
    expect(wrongSession).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });

    const wrongOrigin = await harness.access.completeAuthorization({
      sessionId: SESSION_ID,
      callbackOrigin: "https://attacker.example.test",
      state,
      code: "synthetic-code",
    });
    expect(wrongOrigin).toMatchObject({
      ok: false,
      error: { code: "invalid-input" },
    });

    const correct = await harness.access.completeAuthorization({
      sessionId: SESSION_ID,
      callbackOrigin: CALLBACK_ORIGIN,
      state,
      code: "synthetic-code",
    });
    expect(correct.ok).toBe(true);
    expect(harness.calls.exchange).toHaveBeenCalledTimes(1);
  });

  it("consumes callback state exactly once and rejects expired state", async () => {
    const { state } = await harness.connect();
    const replay = await harness.access.completeAuthorization({
      sessionId: SESSION_ID,
      callbackOrigin: CALLBACK_ORIGIN,
      state,
      code: "second-code",
    });
    expect(replay).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(harness.calls.exchange).toHaveBeenCalledTimes(1);

    const second = await harness.access.beginConnection({
      sessionId: "another-session",
      callbackOrigin: CALLBACK_ORIGIN,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const expiredState = new URL(
      second.value.authorizationUrl,
    ).searchParams.get("state")!;
    harness.advance(10 * 60 * 1000 + 1);
    const expired = await harness.access.completeAuthorization({
      sessionId: "another-session",
      callbackOrigin: CALLBACK_ORIGIN,
      state: expiredState,
      code: "expired-code",
    });
    expect(expired).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(harness.calls.exchange).toHaveBeenCalledTimes(1);
  });

  it("returns only safe identity and repository data, then issues a one-repository read-only credential", async () => {
    await harness.connect();
    const listed = await harness.access.listAccessibleRepositories({
      sessionId: SESSION_ID,
    });
    expect(listed).toMatchObject({
      ok: true,
      value: {
        account: { id: 501, login: "AyushGahtori" },
        repositories: [
          {
            id: "101",
            fullName: "AyushGahtori/resume-changer",
            visibility: "private",
            url: "https://github.com/AyushGahtori/resume-changer",
          },
        ],
      },
    });

    const authorized = await harness.access.authorizeRepository({
      sessionId: SESSION_ID,
      repositoryId: "101",
    });
    expect(authorized.ok).toBe(true);
    expect(harness.calls.createInstallationToken).toHaveBeenCalledWith({
      installationId: 41,
      repositoryIds: ["101"],
      permissions: {
        metadata: "read",
        contents: "read",
        pull_requests: "read",
      },
    });
    if (!authorized.ok) return;
    expect(authorized.value.credentialHandle).not.toContain(INSTALLATION_TOKEN);
    expect(authorized.value.expiresAt).toBe("2030-01-01T01:00:00.000Z");
    expect(harness.repositoryGrants.get(`${SESSION_ID}:101`)).toMatchObject({
      installationId: 41,
      permissions: {
        metadata: "read",
        contents: "read",
        pull_requests: "read",
      },
    });
  });

  it("rejects an installation token whose returned scope is broader or unexpected", async () => {
    await harness.connect();
    harness.calls.createInstallationToken.mockResolvedValueOnce({
      accessToken: INSTALLATION_TOKEN,
      expiresAt: isoAfter(60 * 60 * 1000, harness.now),
      permissions: {
        metadata: "read",
        contents: "read",
        pull_requests: "read",
      },
      repositoryIds: ["102"],
    });
    const result = await harness.access.authorizeRepository({
      sessionId: SESSION_ID,
      repositoryId: "101",
    });
    expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(harness.repositoryGrants.size).toBe(0);
    expect(harness.credentials.size).toBe(1);
  });
  it("rejects extra installation permissions even when required reads are present", async () => {
    await harness.connect();
    const permissions = {
      metadata: "read" as const,
      contents: "read" as const,
      pull_requests: "read" as const,
      administration: "write" as const,
    };
    harness.calls.createInstallationToken.mockResolvedValueOnce({
      accessToken: INSTALLATION_TOKEN,
      expiresAt: isoAfter(60 * 60 * 1000, harness.now),
      permissions,
      repositoryIds: ["101"],
    });
    expect(
      await harness.access.authorizeRepository({
        sessionId: SESSION_ID,
        repositoryId: "101",
      }),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(harness.repositoryGrants.size).toBe(0);
  });
  it("does not accept a browser-supplied installation ID", async () => {
    await harness.connect();
    const forged = await harness.access.authorizeRepository({
      sessionId: SESSION_ID,
      repositoryId: "101",
      installationId: 999999,
    } as unknown as { sessionId: string; repositoryId: string });
    expect(forged).toMatchObject({
      ok: false,
      error: { code: "invalid-input" },
    });
    expect(harness.calls.createInstallationToken).not.toHaveBeenCalled();
  });

  it("honors removed repository access on the next check and deletes its scoped credential", async () => {
    await harness.connect();
    const authorized = await harness.access.authorizeRepository({
      sessionId: SESSION_ID,
      repositoryId: "101",
    });
    expect(authorized.ok).toBe(true);
    const oldHandle = [...harness.credentials.keys()].find((handle) =>
      handle.startsWith("opaque-credential-handle-0002"),
    );
    expect(oldHandle).toBeDefined();

    harness.repositories.set(41, []);
    const selectedAgain = await harness.access.authorizeRepository({
      sessionId: SESSION_ID,
      repositoryId: "101",
    });
    expect(selectedAgain).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(harness.repositoryGrants.has(`${SESSION_ID}:101`)).toBe(false);
    expect(harness.credentials.has(oldHandle!)).toBe(false);
    expect(harness.calls.createInstallationToken).toHaveBeenCalledTimes(1);
  });

  it("keeps organization-denied repositories inaccessible", async () => {
    await harness.connect();
    harness.calls.listRepositories.mockRejectedValueOnce(
      new GithubAuthorizationError(403),
    );
    const result = await harness.access.listAccessibleRepositories({
      sessionId: SESSION_ID,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(harness.calls.createInstallationToken).not.toHaveBeenCalled();
  });

  it("refreshes expired user credentials server-side without returning either token", async () => {
    await harness.connect();
    const connection = harness.connections.get(SESSION_ID)!;
    const userHandle = connection.credentialHandle;
    const scope = { sessionId: SESSION_ID, purpose: "user" as const };
    await harness.credentialVault.replace(userHandle, scope, {
      accessToken: USER_TOKEN,
      accessExpiresAt: isoAfter(30_000, harness.now),
      refreshToken: "ghr_test_refresh_secret_value",
      refreshExpiresAt: isoAfter(60_000, harness.now),
    });

    const result = await harness.access.listAccessibleRepositories({
      sessionId: SESSION_ID,
    });
    expect(result.ok).toBe(true);
    expect(harness.calls.refresh).toHaveBeenCalledTimes(1);
    expect(await harness.credentialVault.read(userHandle, scope)).toMatchObject(
      {
        accessToken: ROTATED_USER_TOKEN,
      },
    );
    expect(JSON.stringify(result)).not.toContain(USER_TOKEN);
    expect(JSON.stringify(result)).not.toContain(ROTATED_USER_TOKEN);
  });

  it("clears credentials when GitHub rejects an expired refresh token", async () => {
    await harness.connect();
    const connection = harness.connections.get(SESSION_ID)!;
    const userHandle = connection.credentialHandle;
    const scope = { sessionId: SESSION_ID, purpose: "user" as const };
    await harness.credentialVault.replace(userHandle, scope, {
      accessToken: USER_TOKEN,
      accessExpiresAt: isoAfter(30_000, harness.now),
      refreshToken: "ghr_revoked_refresh_secret_value",
      refreshExpiresAt: isoAfter(60_000, harness.now),
    });
    harness.calls.refresh.mockRejectedValueOnce(
      new GithubAuthorizationError(400),
    );

    const result = await harness.access.listAccessibleRepositories({
      sessionId: SESSION_ID,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(harness.connections.has(SESSION_ID)).toBe(false);
    expect(harness.credentials.size).toBe(0);
  });
  it("invalidates a revoked user authorization after GitHub returns 401", async () => {
    await harness.connect();
    harness.calls.getUser.mockRejectedValueOnce(
      new GithubAuthorizationError(401),
    );
    const result = await harness.access.listAccessibleRepositories({
      sessionId: SESSION_ID,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(harness.connections.has(SESSION_ID)).toBe(false);
    expect(harness.credentials.size).toBe(0);
    expect(harness.cancellation.cancelJobs).toHaveBeenCalledWith(SESSION_ID);
  });

  it("disconnects idempotently, clears local credentials and reports upstream revocation separately", async () => {
    await harness.connect();
    const authorized = await harness.access.authorizeRepository({
      sessionId: SESSION_ID,
      repositoryId: "101",
    });
    expect(authorized.ok).toBe(true);

    const first = await harness.access.disconnect({ sessionId: SESSION_ID });
    const second = await harness.access.disconnect({ sessionId: SESSION_ID });
    expect(first).toMatchObject({
      ok: true,
      value: {
        disconnected: true,
        upstreamRevoked: false,
        upstreamInstructions: expect.stringContaining("local credentials only"),
        upstreamInstallationSettingsUrl:
          "https://github.com/settings/installations",
        upstreamRevocationUrl:
          "https://github.com/settings/connections/applications/Iv1.test-client",
      },
    });
    expect(second).toMatchObject({ ok: true, value: { disconnected: true } });
    expect(harness.connections.has(SESSION_ID)).toBe(false);
    expect(harness.repositoryGrants.size).toBe(0);
    expect(harness.credentials.size).toBe(0);
    expect(harness.cancellation.cancelJobs).toHaveBeenCalledTimes(2);
  });

  it("returns unavailable when secure storage or app configuration is missing", async () => {
    const missingStorage = createGithubAccess({
      ...harness.deps,
      credentialVault: undefined,
    });
    const storageResult = await missingStorage.beginConnection({
      sessionId: SESSION_ID,
      callbackOrigin: CALLBACK_ORIGIN,
    });
    expect(storageResult).toMatchObject({
      ok: false,
      error: { code: "unavailable" },
    });

    const missingConfig = createGithubAccess({
      ...harness.deps,
      config: undefined,
    });
    const configResult = await missingConfig.beginConnection({
      sessionId: SESSION_ID,
      callbackOrigin: CALLBACK_ORIGIN,
    });
    expect(configResult).toMatchObject({
      ok: false,
      error: { code: "unavailable" },
    });
  });

  it("never logs or returns tokens in public DTOs or safe errors", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const connected = await harness.connect();
      const listed = await harness.access.listAccessibleRepositories({
        sessionId: SESSION_ID,
      });
      const authorized = await harness.access.authorizeRepository({
        sessionId: SESSION_ID,
        repositoryId: "101",
      });
      const denied = await harness.access.authorizeRepository({
        sessionId: SESSION_ID,
        repositoryId: "999",
      });
      harness.calls.listRepositories.mockRejectedValueOnce(
        new Error(`provider error ${USER_TOKEN}`),
      );
      const safeError = await harness.access.listAccessibleRepositories({
        sessionId: SESSION_ID,
      });
      const publicValues = JSON.stringify([
        connected.connected,
        listed,
        authorized,
        denied,
        safeError,
      ]);
      const allLogs = [log.mock.calls, warn.mock.calls, error.mock.calls]
        .flat(2)
        .join(" ");
      for (const secret of [
        USER_TOKEN,
        ROTATED_USER_TOKEN,
        INSTALLATION_TOKEN,
      ]) {
        expect(publicValues).not.toContain(secret);
        expect(allLogs).not.toContain(secret);
      }
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
