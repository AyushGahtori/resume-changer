import "server-only";

export type GithubCredentialHandle = string & {
  readonly __githubCredentialHandle: unique symbol;
};

export type GithubCredentialPurpose = "user" | "repository";

export type GithubCredentialScope = {
  sessionId: string;
  purpose: GithubCredentialPurpose;
  repositoryId?: string;
};

/** Secret values stay inside server-only code and the injected secure vault. */
export type GithubCredentialSecrets = {
  accessToken: string;
  accessExpiresAt?: string;
  refreshToken?: string;
  refreshExpiresAt?: string;
};

/**
 * Use owner-managed GitHub App credentials from an OS credential store or a secret manager.
 * Missing configuration must return unavailable; there is no plaintext fallback.
 * Implementations must use encrypted/OS-backed server storage. A handle is an
 * opaque reference, never a token and never an authorization decision by itself.
 */
export type GithubCredentialVault = {
  put(input: {
    scope: GithubCredentialScope;
    secrets: GithubCredentialSecrets;
  }): Promise<GithubCredentialHandle>;
  read(
    handle: GithubCredentialHandle,
    expectedScope: GithubCredentialScope,
  ): Promise<GithubCredentialSecrets | undefined>;
  replace(
    handle: GithubCredentialHandle,
    expectedScope: GithubCredentialScope,
    secrets: GithubCredentialSecrets,
  ): Promise<void>;
  delete(
    handle: GithubCredentialHandle,
    expectedScope: GithubCredentialScope,
  ): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
};

export function parseGithubCredentialHandle(
  value: unknown,
): GithubCredentialHandle | undefined {
  if (
    typeof value !== "string" ||
    value.length < 20 ||
    value.length > 256 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  )
    return undefined;
  return value as GithubCredentialHandle;
}
