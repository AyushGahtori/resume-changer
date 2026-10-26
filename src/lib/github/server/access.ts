import "server-only";
import { createHash, randomBytes } from "node:crypto";
import {
  parseGithubCredentialHandle,
  type GithubCredentialHandle,
  type GithubCredentialScope,
  type GithubCredentialSecrets,
  type GithubCredentialVault,
} from "./credentials";

const STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;
const GITHUB_AUTHORIZATION_ENDPOINT =
  "https://github.com/login/oauth/authorize";
const REVOCATION_SETTINGS_URL =
  "https://github.com/settings/connections/applications";

export type GithubAccessErrorCode =
  | "invalid-input"
  | "forbidden"
  | "unavailable"
  | "not-found"
  | "rate-limited"
  | "upstream-error"
  | "io-error";

export type GithubAccessError = {
  code: GithubAccessErrorCode;
  message: string;
  retryable: boolean;
};

export type GithubAccessResult<T> =
  { ok: true; value: T } | { ok: false; error: GithubAccessError };

export type GithubAccountIdentity = {
  id: number;
  login: string;
};

export type GithubRepositorySummary = {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  visibility: "public" | "private";
  url: string;
};

export type GithubAccessConfig = {
  clientId: string;
  callbackUrl: string;
};

export type PendingGithubAuthorization = {
  stateHash: string;
  sessionId: string;
  callbackOrigin: string;
  callbackUrl: string;
  codeVerifier: string;
  expiresAt: string;
};

export type StoredGithubConnection = {
  sessionId: string;
  account: GithubAccountIdentity;
  credentialHandle: GithubCredentialHandle;
  connectedAt: string;
};

export type StoredGithubRepositoryGrant = {
  sessionId: string;
  repositoryId: string;
  installationId: number;
  credentialHandle: GithubCredentialHandle;
  expiresAt: string;
  permissions: { metadata: "read"; contents: "read"; pull_requests: "read" };
};

export type GithubAccessStore = {
  savePending(input: PendingGithubAuthorization): Promise<void>;
  /** Must atomically consume only when state, session, origin and expiry match. */
  consumePending(input: {
    stateHash: string;
    sessionId: string;
    callbackOrigin: string;
    now: string;
  }): Promise<PendingGithubAuthorization | undefined>;
  deletePendingForSession(sessionId: string): Promise<void>;
  getConnection(sessionId: string): Promise<StoredGithubConnection | undefined>;
  /** Must be atomic and return false if another connection already exists. */
  createConnectionIfAbsent(input: StoredGithubConnection): Promise<boolean>;
  /** Removes connection metadata and all repository-grant metadata for the session. */
  deleteConnection(sessionId: string): Promise<void>;
  listRepositoryGrants(
    sessionId: string,
  ): Promise<StoredGithubRepositoryGrant[]>;
  saveRepositoryGrant(input: StoredGithubRepositoryGrant): Promise<void>;
  removeRepositoryGrant(sessionId: string, repositoryId: string): Promise<void>;
  clearCaches(sessionId: string, repositoryId?: string): Promise<void>;
};

export type GithubUserTokenSet = {
  accessToken: string;
  accessExpiresAt?: string;
  refreshToken?: string;
  refreshExpiresAt?: string;
};

export type GithubInstallation = {
  id: number;
  account: { id: number; login: string; type: "User" | "Organization" };
  suspendedAt?: string | null;
};

export type GithubRepository = {
  id: number;
  name: string;
  private: boolean;
  owner: { login: string };
};

export type GithubInstallationToken = {
  accessToken: string;
  expiresAt: string;
  permissions: Record<string, string>;
  repositoryIds: string[];
};

/** Adapter implementations keep the client secret and app private key server-side. */
export type GithubAuthorizationExchange = {
  exchangeAuthorizationCode(input: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<GithubUserTokenSet>;
  refreshUserToken(input: {
    refreshToken: string;
  }): Promise<GithubUserTokenSet>;
  getAuthenticatedUser(input: {
    accessToken: string;
  }): Promise<GithubAccountIdentity>;
  listAccessibleInstallations(input: {
    accessToken: string;
  }): Promise<GithubInstallation[]>;
  listInstallationRepositories(input: {
    accessToken: string;
    installationId: number;
  }): Promise<GithubRepository[]>;
  createInstallationToken(input: {
    installationId: number;
    repositoryIds: [string];
    permissions: { metadata: "read"; contents: "read"; pull_requests: "read" };
  }): Promise<GithubInstallationToken>;
};

export class GithubAuthorizationError extends Error {
  constructor(readonly status?: number) {
    super("GitHub authorization request failed.");
    this.name = "GithubAuthorizationError";
  }
}

export type GithubAccessDependencies = {
  config?: GithubAccessConfig;
  store?: GithubAccessStore;
  credentialVault?: GithubCredentialVault;
  github?: GithubAuthorizationExchange;
  /** Idempotently fences/cancels queued and running work for the session. */
  cancellation?: { cancelJobs(sessionId: string): Promise<void> };
  clock: { now(): Date };
  randomBytes?: (length: number) => Uint8Array;
};

/** sessionId values must come from trusted server session middleware, never request bodies. */
export type GithubAccess = {
  beginConnection(input: {
    sessionId: string;
    callbackOrigin: string;
  }): Promise<
    GithubAccessResult<{ authorizationUrl: string; expiresAt: string }>
  >;
  completeAuthorization(input: {
    sessionId: string;
    callbackOrigin: string;
    state: string;
    code: string;
  }): Promise<
    GithubAccessResult<{ account: GithubAccountIdentity; connectedAt: string }>
  >;
  listAccessibleRepositories(input: { sessionId: string }): Promise<
    GithubAccessResult<{
      account: GithubAccountIdentity;
      repositories: GithubRepositorySummary[];
    }>
  >;
  authorizeRepository(input: {
    sessionId: string;
    repositoryId: string;
  }): Promise<
    GithubAccessResult<{
      account: GithubAccountIdentity;
      repository: GithubRepositorySummary;
      /** Internal server capability; connection routes must not expose it to browsers. */
      credentialHandle: GithubCredentialHandle;
      expiresAt: string;
    }>
  >;
  disconnect(input: { sessionId: string }): Promise<
    GithubAccessResult<{
      disconnected: true;
      upstreamRevoked: false;
      upstreamInstructions: string;
      upstreamRevocationUrl?: string;
      upstreamInstallationSettingsUrl?: string;
    }>
  >;
};

const REQUIRED_REPOSITORY_PERMISSIONS = {
  metadata: "read",
  contents: "read",
  pull_requests: "read",
} as const;

class AccessFault extends Error {
  constructor(readonly error: GithubAccessError) {
    super(error.message);
  }
}

type AccessibleRepository = {
  repository: GithubRepositorySummary;
  installationId: number;
};

function ok<T>(value: T): GithubAccessResult<T> {
  return { ok: true, value };
}

function fail<T = never>(error: GithubAccessError): GithubAccessResult<T> {
  return { ok: false, error };
}

function fault(
  code: GithubAccessErrorCode,
  message: string,
  retryable = false,
): AccessFault {
  return new AccessFault({ code, message, retryable });
}

function safeFailure(error: unknown): GithubAccessError {
  if (error instanceof AccessFault) return error.error;
  if (error instanceof GithubAuthorizationError) {
    if (error.status === 403)
      return {
        code: "forbidden",
        message:
          "GitHub denied repository access. The organization may require approval or the repository grant may have changed.",
        retryable: false,
      };
    if (error.status === 429)
      return {
        code: "rate-limited",
        message: "GitHub is temporarily rate-limiting this request.",
        retryable: true,
      };
    return {
      code: "upstream-error",
      message: "GitHub could not complete the authorization request.",
      retryable: Boolean(error.status && error.status >= 500),
    };
  }
  return {
    code: "io-error",
    message: "GitHub connection data could not be updated safely.",
    retryable: true,
  };
}

function asResult<T>(work: () => Promise<T>): Promise<GithubAccessResult<T>> {
  return work().then(ok, (error: unknown) => fail(safeFailure(error)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasExactKeys(
  value: unknown,
  keys: string[],
): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function requireSessionId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 256 ||
    !/^[A-Za-z0-9._:-]+$/.test(value)
  )
    throw fault("invalid-input", "The active session is invalid.");
  return value;
}

function requireRepositoryId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 20 ||
    !/^[1-9]\d*$/.test(value)
  )
    throw fault("invalid-input", "Select a valid GitHub repository.");
  return value;
}

function normalizeCallbackOrigin(value: unknown): string {
  if (typeof value !== "string" || value.length > 512)
    throw fault("invalid-input", "The GitHub callback origin is invalid.");
  try {
    const parsed = new URL(value);
    const localHttp =
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (
      parsed.origin !== value ||
      (!localHttp && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password
    )
      throw new Error("Invalid origin");
    return parsed.origin;
  } catch {
    throw fault("invalid-input", "The GitHub callback origin is invalid.");
  }
}

function validCallbackUrl(value: string): URL | undefined {
  try {
    const parsed = new URL(value);
    const localHttp =
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (
      (!localHttp && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      !parsed.pathname.startsWith("/")
    )
      return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function timestamp(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function requireToken(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 8192 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw fault("upstream-error", "GitHub returned an invalid credential.");
  return value;
}

function normalizeTokenSet(
  value: GithubUserTokenSet,
  now: Date,
): GithubCredentialSecrets {
  if (!isRecord(value))
    throw fault(
      "upstream-error",
      "GitHub returned an invalid authorization result.",
    );
  const accessToken = requireToken(value.accessToken);
  const accessExpiresAt =
    value.accessExpiresAt === undefined
      ? undefined
      : timestamp(value.accessExpiresAt);
  const refreshToken =
    value.refreshToken === undefined
      ? undefined
      : requireToken(value.refreshToken);
  const refreshExpiresAt =
    value.refreshExpiresAt === undefined
      ? undefined
      : timestamp(value.refreshExpiresAt);
  if (
    (value.accessExpiresAt !== undefined && !accessExpiresAt) ||
    (value.refreshToken !== undefined && !refreshToken) ||
    (value.refreshExpiresAt !== undefined && !refreshExpiresAt) ||
    (accessExpiresAt && Date.parse(accessExpiresAt) <= now.getTime()) ||
    (refreshExpiresAt && Date.parse(refreshExpiresAt) <= now.getTime())
  )
    throw fault(
      "upstream-error",
      "GitHub returned an expired authorization result.",
    );
  return { accessToken, accessExpiresAt, refreshToken, refreshExpiresAt };
}

function normalizeIdentity(value: unknown): GithubAccountIdentity {
  if (!isRecord(value))
    throw fault(
      "upstream-error",
      "GitHub returned an invalid account identity.",
    );
  const { id, login } = value;
  if (
    typeof id !== "number" ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    typeof login !== "string" ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(login)
  )
    throw fault(
      "upstream-error",
      "GitHub returned an invalid account identity.",
    );
  return { id, login };
}

function normalizeInstallation(value: unknown): GithubInstallation {
  if (!isRecord(value) || !isRecord(value.account))
    throw fault("upstream-error", "GitHub returned invalid installation data.");
  const { id, account, suspendedAt } = value;
  const identity = normalizeIdentity({ id: account.id, login: account.login });
  if (
    typeof id !== "number" ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    (account.type !== "User" && account.type !== "Organization") ||
    (suspendedAt !== undefined &&
      suspendedAt !== null &&
      !timestamp(suspendedAt))
  )
    throw fault("upstream-error", "GitHub returned invalid installation data.");
  return {
    id,
    account: { ...identity, type: account.type },
    suspendedAt: suspendedAt as string | null | undefined,
  };
}

function normalizeRepository(value: unknown): GithubRepositorySummary {
  if (!isRecord(value) || !isRecord(value.owner))
    throw fault("upstream-error", "GitHub returned invalid repository data.");
  const { id, name, private: isPrivate } = value;
  const owner = value.owner.login;
  if (
    typeof id !== "number" ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    typeof name !== "string" ||
    !/^[A-Za-z0-9_.-]{1,100}$/.test(name) ||
    typeof owner !== "string" ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner) ||
    typeof isPrivate !== "boolean"
  )
    throw fault("upstream-error", "GitHub returned invalid repository data.");
  const fullName = `${owner}/${name}`;
  return {
    id: String(id),
    owner,
    name,
    fullName,
    visibility: isPrivate ? "private" : "public",
    url: `https://github.com/${owner}/${name}`,
  };
}

function authorizationError(status?: number): AccessFault {
  if (status === 403)
    return fault(
      "forbidden",
      "GitHub denied repository access. The organization may require approval or the repository grant may have changed.",
    );
  if (status === 429)
    return fault(
      "rate-limited",
      "GitHub is temporarily rate-limiting this request.",
      true,
    );
  return fault(
    "upstream-error",
    "GitHub could not complete the authorization request.",
    Boolean(status && status >= 500),
  );
}

function callbackConfig(
  config: GithubAccessConfig | undefined,
  callbackOrigin: string,
): { clientId: string; callbackUrl: URL } {
  if (
    !config ||
    typeof config.clientId !== "string" ||
    config.clientId.length < 1 ||
    config.clientId.length > 256 ||
    /[\u0000-\u0020\u007f]/.test(config.clientId)
  )
    throw fault(
      "unavailable",
      "GitHub authorization is not configured on this server.",
      true,
    );
  const callbackUrl = validCallbackUrl(config.callbackUrl);
  if (!callbackUrl)
    throw fault(
      "unavailable",
      "GitHub authorization is not configured on this server.",
      true,
    );
  if (callbackUrl.origin !== callbackOrigin)
    throw fault(
      "invalid-input",
      "The GitHub callback origin does not match this app.",
    );
  return { clientId: config.clientId, callbackUrl };
}

function buildSecrets(value: GithubCredentialSecrets): GithubCredentialSecrets {
  return {
    accessToken: requireToken(value.accessToken),
    accessExpiresAt: value.accessExpiresAt,
    refreshToken:
      value.refreshToken === undefined
        ? undefined
        : requireToken(value.refreshToken),
    refreshExpiresAt: value.refreshExpiresAt,
  };
}

export function createGithubAccess(
  deps: GithubAccessDependencies,
): GithubAccess {
  const now = () => {
    const value = deps.clock.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
      throw fault("io-error", "The server clock is unavailable.", true);
    return value;
  };
  const bytes = deps.randomBytes ?? randomBytes;

  function requireCleanupPorts() {
    if (!deps.store || !deps.credentialVault || !deps.cancellation)
      throw fault(
        "unavailable",
        "Secure GitHub connection storage is not configured on this server.",
        true,
      );
    return {
      store: deps.store,
      vault: deps.credentialVault,
      cancellation: deps.cancellation,
    };
  }

  function requirePorts() {
    const cleanupPorts = requireCleanupPorts();
    if (
      !deps.github ||
      !deps.config ||
      !deps.config.clientId ||
      !validCallbackUrl(deps.config.callbackUrl)
    )
      throw fault(
        "unavailable",
        "GitHub authorization is not configured on this server.",
        true,
      );
    return { ...cleanupPorts, github: deps.github };
  }

  async function cleanupSession(sessionId: string): Promise<void> {
    const { store, vault, cancellation } = requireCleanupPorts();
    const outcomes = await Promise.allSettled([
      cancellation.cancelJobs(sessionId),
      store.clearCaches(sessionId),
      vault.deleteSession(sessionId),
      store.deletePendingForSession(sessionId),
      store.deleteConnection(sessionId),
    ]);
    if (outcomes.some((outcome) => outcome.status === "rejected"))
      throw fault(
        "io-error",
        "GitHub was disconnected locally, but cleanup is incomplete. Retry disconnect.",
        true,
      );
  }

  async function invalidateAfterUnauthorized(sessionId: string): Promise<void> {
    try {
      await cleanupSession(sessionId);
    } catch {
      // A 401 still fences this connection; public errors never include cleanup details.
    }
  }

  async function loadUserCredential(sessionId: string): Promise<{
    connection: StoredGithubConnection;
    secrets: GithubCredentialSecrets;
  }> {
    const { store, vault, github } = requirePorts();
    const connection = await store.getConnection(sessionId);
    if (!connection)
      throw fault(
        "forbidden",
        "Connect a GitHub account before selecting repositories.",
      );
    const handle = parseGithubCredentialHandle(connection.credentialHandle);
    if (!handle) {
      await invalidateAfterUnauthorized(sessionId);
      throw fault("forbidden", "Reconnect GitHub to continue.");
    }
    const scope: GithubCredentialScope = { sessionId, purpose: "user" };
    let secrets = await vault.read(handle, scope);
    if (!secrets) {
      await invalidateAfterUnauthorized(sessionId);
      throw fault("forbidden", "Reconnect GitHub to continue.");
    }
    secrets = buildSecrets(secrets);
    const currentTime = now();
    const accessExpiry = secrets.accessExpiresAt
      ? Date.parse(secrets.accessExpiresAt)
      : undefined;
    if (accessExpiry !== undefined && !Number.isFinite(accessExpiry)) {
      await invalidateAfterUnauthorized(sessionId);
      throw fault("forbidden", "Reconnect GitHub to continue.");
    }
    if (
      accessExpiry !== undefined &&
      accessExpiry <= currentTime.getTime() + TOKEN_REFRESH_MARGIN_MS
    ) {
      const refreshExpiry = secrets.refreshExpiresAt
        ? Date.parse(secrets.refreshExpiresAt)
        : undefined;
      if (
        !secrets.refreshToken ||
        (refreshExpiry !== undefined &&
          (!Number.isFinite(refreshExpiry) ||
            refreshExpiry <= currentTime.getTime()))
      ) {
        await invalidateAfterUnauthorized(sessionId);
        throw fault(
          "forbidden",
          "GitHub authorization expired or was revoked. Reconnect GitHub to continue.",
        );
      }
      let refreshed: GithubCredentialSecrets;
      try {
        refreshed = normalizeTokenSet(
          await github.refreshUserToken({ refreshToken: secrets.refreshToken }),
          currentTime,
        );
      } catch (error) {
        if (
          error instanceof GithubAuthorizationError &&
          (error.status === 400 || error.status === 401)
        ) {
          await invalidateAfterUnauthorized(sessionId);
          throw fault(
            "forbidden",
            "GitHub authorization expired or was revoked. Reconnect GitHub to continue.",
          );
        }
        throw error;
      }
      await vault.replace(handle, scope, refreshed);
      secrets = refreshed;
    }
    return { connection, secrets };
  }

  async function userApi<T>(
    sessionId: string,
    action: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    const { secrets } = await loadUserCredential(sessionId);
    try {
      return await action(secrets.accessToken);
    } catch (error) {
      if (error instanceof GithubAuthorizationError && error.status === 401) {
        await invalidateAfterUnauthorized(sessionId);
        throw fault(
          "forbidden",
          "GitHub authorization expired or was revoked. Reconnect GitHub.",
        );
      }
      throw error;
    }
  }

  async function loadAccessibleRepositories(sessionId: string): Promise<{
    account: GithubAccountIdentity;
    repositories: AccessibleRepository[];
  }> {
    const { github, store } = requirePorts();
    const connection = await store.getConnection(sessionId);
    if (!connection)
      throw fault(
        "forbidden",
        "Connect a GitHub account before selecting repositories.",
      );
    const actualAccount = normalizeIdentity(
      await userApi(sessionId, (accessToken) =>
        github.getAuthenticatedUser({ accessToken }),
      ),
    );
    if (actualAccount.id !== connection.account.id) {
      await invalidateAfterUnauthorized(sessionId);
      throw fault(
        "forbidden",
        "The GitHub account changed. Reconnect GitHub to continue.",
      );
    }

    const installations = await userApi(sessionId, async (accessToken) => {
      const values = await github.listAccessibleInstallations({ accessToken });
      if (!Array.isArray(values))
        throw fault(
          "upstream-error",
          "GitHub returned invalid installation data.",
        );
      return values.map(normalizeInstallation);
    });
    const repositoriesById = new Map<string, AccessibleRepository>();
    for (const installation of installations
      .filter((item) => !item.suspendedAt)
      .sort((left, right) => left.id - right.id)) {
      const repositories = await userApi(sessionId, async (accessToken) => {
        const values = await github.listInstallationRepositories({
          accessToken,
          installationId: installation.id,
        });
        if (!Array.isArray(values))
          throw fault(
            "upstream-error",
            "GitHub returned invalid repository data.",
          );
        return values.map(normalizeRepository);
      });
      for (const summary of repositories) {
        const existing = repositoriesById.get(summary.id);
        if (!existing)
          repositoriesById.set(summary.id, {
            repository: summary,
            installationId: installation.id,
          });
      }
    }

    const current = [...repositoriesById.values()];
    await pruneRemovedGrants(sessionId, current);
    return { account: actualAccount, repositories: current };
  }

  async function pruneRemovedGrants(
    sessionId: string,
    current: AccessibleRepository[],
  ): Promise<void> {
    const { store, vault } = requirePorts();
    const currentInstallations = new Map(
      current.map(({ repository, installationId }) => [
        repository.id,
        installationId,
      ]),
    );
    for (const grant of await store.listRepositoryGrants(sessionId)) {
      const id = requireRepositoryId(grant.repositoryId);
      if (currentInstallations.get(id) === grant.installationId) continue;
      const handle = parseGithubCredentialHandle(grant.credentialHandle);
      if (handle)
        await vault.delete(handle, {
          sessionId,
          purpose: "repository",
          repositoryId: id,
        });
      await store.removeRepositoryGrant(sessionId, id);
      await store.clearCaches(sessionId, id);
    }
  }

  return {
    beginConnection(input) {
      return asResult(async () => {
        const { store } = requirePorts();
        const sessionId = requireSessionId(input?.sessionId);
        const origin = normalizeCallbackOrigin(input?.callbackOrigin);
        const { clientId, callbackUrl } = callbackConfig(deps.config, origin);
        const currentTime = now();
        const state = Buffer.from(bytes(32)).toString("base64url");
        const codeVerifier = Buffer.from(bytes(32)).toString("base64url");
        if (state.length < 43 || codeVerifier.length < 43)
          throw fault(
            "io-error",
            "The server could not start a secure GitHub connection.",
          );
        const stateHash = createHash("sha256").update(state).digest("hex");
        const expiresAt = new Date(
          currentTime.getTime() + STATE_TTL_MS,
        ).toISOString();
        await store.savePending({
          stateHash,
          sessionId,
          callbackOrigin: origin,
          callbackUrl: callbackUrl.href,
          codeVerifier,
          expiresAt,
        });
        const challenge = createHash("sha256")
          .update(codeVerifier)
          .digest("base64url");
        const authorizationUrl = new URL(GITHUB_AUTHORIZATION_ENDPOINT);
        authorizationUrl.searchParams.set("client_id", clientId);
        authorizationUrl.searchParams.set("redirect_uri", callbackUrl.href);
        authorizationUrl.searchParams.set("state", state);
        authorizationUrl.searchParams.set("scope", "offline_access");
        authorizationUrl.searchParams.set("code_challenge", challenge);
        authorizationUrl.searchParams.set("code_challenge_method", "S256");
        return { authorizationUrl: authorizationUrl.href, expiresAt };
      });
    },

    completeAuthorization(input) {
      return asResult(async () => {
        const { store, vault, github } = requirePorts();
        const sessionId = requireSessionId(input?.sessionId);
        const origin = normalizeCallbackOrigin(input?.callbackOrigin);
        const { callbackUrl } = callbackConfig(deps.config, origin);
        if (
          typeof input?.state !== "string" ||
          input.state.length < 32 ||
          input.state.length > 256 ||
          typeof input?.code !== "string" ||
          input.code.length < 1 ||
          input.code.length > 4096 ||
          /[\u0000-\u001f\u007f]/.test(input.code)
        )
          throw fault(
            "invalid-input",
            "The GitHub authorization response is invalid.",
          );
        const currentTime = now();
        const stateHash = createHash("sha256")
          .update(input.state)
          .digest("hex");
        const pending = await store.consumePending({
          stateHash,
          sessionId,
          callbackOrigin: origin,
          now: currentTime.toISOString(),
        });
        if (!pending)
          throw fault(
            "forbidden",
            "GitHub authorization expired or was already used.",
          );
        if (
          pending.stateHash !== stateHash ||
          pending.sessionId !== sessionId ||
          pending.callbackOrigin !== origin ||
          pending.callbackUrl !== callbackUrl.href ||
          !timestamp(pending.expiresAt) ||
          Date.parse(pending.expiresAt) <= currentTime.getTime() ||
          typeof pending.codeVerifier !== "string" ||
          pending.codeVerifier.length < 43 ||
          pending.codeVerifier.length > 128
        )
          throw fault(
            "forbidden",
            "GitHub authorization expired or was already used.",
          );

        const secrets = normalizeTokenSet(
          await github.exchangeAuthorizationCode({
            code: input.code,
            redirectUri: callbackUrl.href,
            codeVerifier: pending.codeVerifier,
          }),
          currentTime,
        );
        const scope: GithubCredentialScope = { sessionId, purpose: "user" };
        const credentialHandle = parseGithubCredentialHandle(
          await vault.put({ scope, secrets }),
        );
        if (!credentialHandle)
          throw fault(
            "unavailable",
            "Secure GitHub credential storage is not configured.",
            true,
          );
        try {
          const account = normalizeIdentity(
            await github.getAuthenticatedUser({
              accessToken: secrets.accessToken,
            }),
          );
          const connectedAt = currentTime.toISOString();
          const created = await store.createConnectionIfAbsent({
            sessionId,
            account,
            credentialHandle,
            connectedAt,
          });
          if (!created)
            throw fault(
              "forbidden",
              "A GitHub account is already connected to this session.",
            );
          return { account, connectedAt };
        } catch (error) {
          await vault.delete(credentialHandle, scope).catch(() => undefined);
          throw error;
        }
      });
    },

    listAccessibleRepositories(input) {
      return asResult(async () => {
        const sessionId = requireSessionId(input?.sessionId);
        const accessible = await loadAccessibleRepositories(sessionId);
        return {
          account: accessible.account,
          repositories: accessible.repositories
            .map((entry) => entry.repository)
            .sort(
              (left, right) =>
                left.fullName.localeCompare(right.fullName) ||
                left.id.localeCompare(right.id),
            ),
        };
      });
    },

    authorizeRepository(input) {
      return asResult(async () => {
        if (!hasExactKeys(input, ["sessionId", "repositoryId"]))
          throw fault("invalid-input", "Select a valid GitHub repository.");
        const sessionId = requireSessionId(input.sessionId);
        const repositoryId = requireRepositoryId(input.repositoryId);
        const accessible = await loadAccessibleRepositories(sessionId);
        const selected = accessible.repositories.find(
          (entry) => entry.repository.id === repositoryId,
        );
        if (!selected)
          throw fault(
            "forbidden",
            "This repository is not currently accessible through your GitHub account and app installation.",
          );
        const { github, store, vault } = requirePorts();
        const token = await github.createInstallationToken({
          installationId: selected.installationId,
          repositoryIds: [repositoryId],
          permissions: REQUIRED_REPOSITORY_PERMISSIONS,
        });
        const accessToken = requireToken(token?.accessToken);
        const expiresAt = timestamp(token?.expiresAt);
        if (
          !Array.isArray(token.repositoryIds) ||
          token.repositoryIds.length !== 1 ||
          token.repositoryIds[0] !== repositoryId
        )
          throw fault(
            "forbidden",
            "GitHub did not return a credential scoped to this repository.",
          );
        if (!expiresAt || Date.parse(expiresAt) <= now().getTime())
          throw fault(
            "upstream-error",
            "GitHub returned an expired repository credential.",
          );
        if (
          token.permissions?.metadata !== "read" ||
          token.permissions?.contents !== "read" ||
          token.permissions?.pull_requests !== "read" ||
          Object.entries(token.permissions).some(
            ([name, value]) =>
              !Object.hasOwn(REQUIRED_REPOSITORY_PERMISSIONS, name) ||
              value !== "read",
          )
        )
          throw fault(
            "forbidden",
            "The GitHub app does not have the required read-only repository permissions.",
          );
        const scope: GithubCredentialScope = {
          sessionId,
          purpose: "repository",
          repositoryId,
        };
        const credentialHandle = parseGithubCredentialHandle(
          await vault.put({
            scope,
            secrets: { accessToken, accessExpiresAt: expiresAt },
          }),
        );
        if (!credentialHandle)
          throw fault(
            "unavailable",
            "Secure GitHub credential storage is not configured.",
            true,
          );
        const grant: StoredGithubRepositoryGrant = {
          sessionId,
          repositoryId,
          installationId: selected.installationId,
          credentialHandle,
          expiresAt,
          permissions: REQUIRED_REPOSITORY_PERMISSIONS,
        };
        let previous: StoredGithubRepositoryGrant | undefined;
        try {
          previous = (await store.listRepositoryGrants(sessionId)).find(
            (item) => item.repositoryId === repositoryId,
          );
          await store.saveRepositoryGrant(grant);
          await store.clearCaches(sessionId, repositoryId);
        } catch (error) {
          await vault.delete(credentialHandle, scope).catch(() => undefined);
          throw error;
        }
        if (previous) {
          const oldHandle = parseGithubCredentialHandle(
            previous.credentialHandle,
          );
          if (oldHandle && oldHandle !== credentialHandle)
            await vault.delete(oldHandle, scope).catch(() => undefined);
        }
        return {
          account: accessible.account,
          repository: selected.repository,
          credentialHandle,
          expiresAt,
        };
      });
    },

    disconnect(input) {
      return asResult(async () => {
        const sessionId = requireSessionId(input?.sessionId);
        await cleanupSession(sessionId);
        const clientId = deps.config?.clientId;
        return {
          disconnected: true as const,
          upstreamRevoked: false as const,
          upstreamInstructions:
            "This removes local credentials only. Revoke the GitHub authorization and uninstall the app separately in GitHub settings.",
          upstreamInstallationSettingsUrl:
            "https://github.com/settings/installations",
          ...(clientId && /^[A-Za-z0-9._-]{1,256}$/.test(clientId)
            ? {
                upstreamRevocationUrl: `${REVOCATION_SETTINGS_URL}/${encodeURIComponent(clientId)}`,
              }
            : {}),
        };
      });
    },
  };
}
