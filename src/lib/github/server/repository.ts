import { createHash } from "node:crypto";
import {
  buildRepositoryInventory,
  type RepositoryInventory,
  type RepositoryInventoryLimits,
} from "./inventory";

export type GithubErrorCode =
  | "invalid-input"
  | "forbidden"
  | "unavailable"
  | "not-found"
  | "version-conflict"
  | "limit-exceeded"
  | "rate-limited"
  | "needs-context"
  | "invalid-evidence"
  | "io-error"
  | "cancelled"
  | "interrupted"
  | "upstream-error";

export interface GithubDomainError {
  code: GithubErrorCode;
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  fieldErrors?: Record<string, string>;
}

export type Result<T> =
  { ok: true; value: T } | { ok: false; error: GithubDomainError };

export interface GithubJsonResponse<T> {
  data: T;
  status: number;
  wireBytes: number;
  decodedBytes?: number;
  headers?: {
    etag?: string;
    rateLimitRemaining?: number;
    rateLimitReset?: number;
    retryAfter?: number;
  };
}

export interface GithubJsonClient<Context> {
  getJson<T = unknown>(request: {
    path: string;
    query?: Readonly<Record<string, string | number | boolean>>;
    context: Context;
  }): Promise<Result<GithubJsonResponse<T>>>;
}

export interface RepositoryScopeInput {
  repositoryUrl: string;
  ref?: string;
  packagePath?: string;
}

export type RepositoryVisibility = "public" | "private" | "internal";

/** Immutable identity for all later tree and content lookups. */
export interface RepositorySnapshot {
  snapshotId: string;
  repositoryId: number;
  owner: string;
  name: string;
  url: string;
  visibility: RepositoryVisibility;
  ref: string;
  commitSha: string;
  treeSha: string;
  packagePath?: string;
}

export interface RepositoryInspector<Context> {
  resolveSnapshot(args: {
    scope: RepositoryScopeInput;
    context: Context;
  }): Promise<Result<RepositorySnapshot>>;
  inventory(args: {
    snapshot: RepositorySnapshot;
    context: Context;
  }): Promise<Result<RepositoryInventory>>;
}

export interface RepositoryInspectorDependencies<Context> {
  client: GithubJsonClient<Context>;
  inventoryLimits?: Partial<RepositoryInventoryLimits>;
}

interface ParsedRepositoryRoot {
  owner: string;
  name: string;
}

interface RepositoryMetadataResponse {
  id?: unknown;
  name?: unknown;
  full_name?: unknown;
  owner?: { login?: unknown };
  default_branch?: unknown;
  private?: unknown;
  visibility?: unknown;
}

interface CommitResponse {
  sha?: unknown;
  commit?: { tree?: { sha?: unknown } };
}

const OWNER_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const REPOSITORY_PATTERN = /^[a-zA-Z0-9_.-]{1,100}$/;
const REF_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,254}$/;
const FULL_SHA_PATTERN = /^[a-fA-F0-9]{40}$/;

function fail<T>(error: GithubDomainError): Result<T> {
  return { ok: false, error };
}

function domainError(
  code: GithubErrorCode,
  message: string,
  retryable = false,
  fieldErrors?: Record<string, string>,
): GithubDomainError {
  return { code, message, retryable, ...(fieldErrors ? { fieldErrors } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidOwner(value: string): boolean {
  return OWNER_PATTERN.test(value);
}

function isValidRepositoryName(value: string): boolean {
  return (
    REPOSITORY_PATTERN.test(value) &&
    value !== "." &&
    value !== ".." &&
    !value.includes("..")
  );
}

/**
 * Accept only a GitHub repository root. Deliberately rejects encoded path
 * segments, credentials, ports, query strings, and arbitrary GitHub subpages.
 */
export function parseGithubRepositoryRoot(
  repositoryUrl: string,
): Result<ParsedRepositoryRoot> {
  if (
    typeof repositoryUrl !== "string" ||
    repositoryUrl.length > 2048 ||
    /[\u0000-\u0020\u007f]/.test(repositoryUrl)
  ) {
    return fail(
      domainError(
        "invalid-input",
        "Enter a valid GitHub repository URL.",
        false,
        {
          repositoryUrl: "Use an https://github.com/owner/repository URL.",
        },
      ),
    );
  }

  const match = /^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+)\/?$/i.exec(
    repositoryUrl,
  );
  if (!match || match[1].includes("%") || match[2].includes("%")) {
    return fail(
      domainError(
        "invalid-input",
        "Enter a valid GitHub repository URL.",
        false,
        {
          repositoryUrl:
            "Use the repository root on github.com without a query or fragment.",
        },
      ),
    );
  }

  const owner = match[1];
  const rawName = match[2];
  const name = rawName.toLowerCase().endsWith(".git")
    ? rawName.slice(0, -4)
    : rawName;

  if (!isValidOwner(owner) || !isValidRepositoryName(name)) {
    return fail(
      domainError(
        "invalid-input",
        "Enter a valid GitHub repository URL.",
        false,
        {
          repositoryUrl:
            "The owner or repository name is not a valid path segment.",
        },
      ),
    );
  }

  return { ok: true, value: { owner, name } };
}

/** Validate a Git ref before encoding it as one API path segment. */
export function validateGithubRef(ref: string): Result<string> {
  const components = typeof ref === "string" ? ref.split("/") : [];
  const valid =
    typeof ref === "string" &&
    ref.length <= 255 &&
    REF_PATTERN.test(ref) &&
    !ref.includes("%") &&
    !ref.includes("..") &&
    !ref.includes("@{") &&
    !ref.endsWith("/") &&
    !components.some(
      (component) =>
        !component ||
        component === "." ||
        component === ".." ||
        component.startsWith(".") ||
        component.endsWith(".") ||
        component.toLowerCase().endsWith(".lock"),
    );

  if (!valid) {
    return fail(
      domainError(
        "invalid-input",
        "Enter a valid branch, tag, or commit reference.",
        false,
        {
          ref: "The reference contains an unsafe or invalid path component.",
        },
      ),
    );
  }

  return { ok: true, value: ref };
}

/** Normalize a user-selected package path without accepting traversal. */
export function normalizePackagePath(
  packagePath: string | undefined,
): Result<string | undefined> {
  if (packagePath === undefined || packagePath === "") {
    return { ok: true, value: undefined };
  }

  if (
    typeof packagePath !== "string" ||
    packagePath.length > 1024 ||
    packagePath.startsWith("/") ||
    packagePath.endsWith("/") ||
    packagePath.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(packagePath) ||
    /%(?:2e|2f|5c)/i.test(packagePath)
  ) {
    return fail(
      domainError(
        "invalid-input",
        "Choose a safe repository package path.",
        false,
        {
          packagePath:
            "Use a relative path without dot segments or encoded separators.",
        },
      ),
    );
  }

  const components = packagePath.split("/");
  if (
    components.some(
      (component) => !component || component === "." || component === "..",
    )
  ) {
    return fail(
      domainError(
        "invalid-input",
        "Choose a safe repository package path.",
        false,
        {
          packagePath:
            "Use a relative path without dot segments or encoded separators.",
        },
      ),
    );
  }

  return { ok: true, value: packagePath };
}

function isFullSha(value: unknown): value is string {
  return typeof value === "string" && FULL_SHA_PATTERN.test(value);
}

function unavailableRepository(): GithubDomainError {
  return domainError("not-found", "The repository or revision is unavailable.");
}

function safeClientError(error: GithubDomainError): GithubDomainError {
  if (error.code === "not-found") return unavailableRepository();
  return error;
}

function snapshotId(
  repositoryId: number,
  commitSha: string,
  treeSha: string,
): string {
  const digest = createHash("sha256")
    .update(
      `${repositoryId}\n${commitSha.toLowerCase()}\n${treeSha.toLowerCase()}`,
    )
    .digest("hex");
  return `github-snapshot-${digest}`;
}

function requestFailure<Context>(
  thrown: unknown,
  context: Context,
): Result<never> {
  const maybeSignal = isRecord(context) ? context.signal : undefined;
  if (isRecord(maybeSignal) && maybeSignal.aborted === true) {
    return fail(
      domainError("cancelled", "Repository inspection was cancelled."),
    );
  }
  return fail(
    domainError(
      "io-error",
      "GitHub repository metadata could not be read.",
      true,
    ),
  );
}

async function getJson<Context, T>(
  client: GithubJsonClient<Context>,
  request: {
    path: string;
    context: Context;
  },
): Promise<Result<GithubJsonResponse<T>>> {
  try {
    const result = await client.getJson<T>(request);
    if (!result.ok) return fail(safeClientError(result.error));
    if (result.value.status === 404) return fail(unavailableRepository());
    if (
      !Number.isInteger(result.value.status) ||
      result.value.status < 200 ||
      result.value.status >= 300
    ) {
      return fail(
        domainError(
          "upstream-error",
          "GitHub returned an invalid metadata response.",
          true,
        ),
      );
    }
    return result;
  } catch (error) {
    return requestFailure(error, request.context);
  }
}

function parseRepositoryMetadata(value: unknown): Result<{
  repositoryId: number;
  owner: string;
  name: string;
  defaultBranch?: string;
  visibility: RepositoryVisibility;
}> {
  if (!isRecord(value)) {
    return fail(
      domainError(
        "upstream-error",
        "GitHub returned invalid repository metadata.",
      ),
    );
  }

  const id = value.id;
  const name = value.name;
  const ownerValue = value.owner;
  const owner = isRecord(ownerValue) ? ownerValue.login : undefined;
  if (
    typeof id !== "number" ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    typeof name !== "string" ||
    !isValidRepositoryName(name) ||
    typeof owner !== "string" ||
    !isValidOwner(owner) ||
    typeof value.private !== "boolean"
  ) {
    return fail(
      domainError(
        "upstream-error",
        "GitHub returned invalid repository identity metadata.",
      ),
    );
  }

  if (
    value.visibility !== undefined &&
    !["public", "private", "internal"].includes(String(value.visibility))
  ) {
    return fail(
      domainError(
        "upstream-error",
        "GitHub returned invalid repository visibility metadata.",
      ),
    );
  }

  if (typeof value.full_name === "string") {
    const [fullNameOwner, fullNameRepository, ...extra] =
      value.full_name.split("/");
    if (
      extra.length > 0 ||
      !fullNameOwner ||
      !fullNameRepository ||
      fullNameOwner.toLowerCase() !== owner.toLowerCase() ||
      fullNameRepository.toLowerCase() !== name.toLowerCase()
    ) {
      return fail(
        domainError(
          "upstream-error",
          "GitHub returned inconsistent repository identity metadata.",
        ),
      );
    }
  }

  const visibility: RepositoryVisibility =
    value.visibility === "internal"
      ? "internal"
      : value.private === true
        ? "private"
        : "public";
  const defaultBranch = value.default_branch;
  if (
    defaultBranch !== undefined &&
    defaultBranch !== null &&
    typeof defaultBranch !== "string"
  ) {
    return fail(
      domainError(
        "upstream-error",
        "GitHub returned an invalid default branch.",
      ),
    );
  }

  return {
    ok: true,
    value: {
      repositoryId: id,
      owner,
      name,
      defaultBranch:
        typeof defaultBranch === "string" ? defaultBranch : undefined,
      visibility,
    },
  };
}

function parseCommit(
  value: unknown,
): Result<{ commitSha: string; treeSha: string }> {
  if (!isRecord(value)) {
    return fail(
      domainError("upstream-error", "GitHub returned invalid commit metadata."),
    );
  }
  const sha = value.sha;
  const commit = value.commit;
  const tree = isRecord(commit) ? commit.tree : undefined;
  const treeSha = isRecord(tree) ? tree.sha : undefined;
  if (!isFullSha(sha) || !isFullSha(treeSha)) {
    return fail(
      domainError(
        "upstream-error",
        "GitHub did not return a full commit and tree SHA.",
      ),
    );
  }
  return {
    ok: true,
    value: { commitSha: sha.toLowerCase(), treeSha: treeSha.toLowerCase() },
  };
}

export function createRepositoryInspector<Context>(
  dependencies: RepositoryInspectorDependencies<Context>,
): RepositoryInspector<Context> {
  return {
    async resolveSnapshot({ scope, context }) {
      if (!scope || typeof scope.repositoryUrl !== "string") {
        return fail(
          domainError(
            "invalid-input",
            "Choose a GitHub repository URL.",
            false,
            {
              repositoryUrl: "A repository URL is required.",
            },
          ),
        );
      }

      const parsedRoot = parseGithubRepositoryRoot(scope.repositoryUrl);
      if (!parsedRoot.ok) return parsedRoot;

      const packagePath = normalizePackagePath(scope.packagePath);
      if (!packagePath.ok) return packagePath;

      const requestedRef =
        scope.ref === undefined ? undefined : validateGithubRef(scope.ref);
      if (requestedRef && !requestedRef.ok) return requestedRef;

      const requestedOwner = encodeURIComponent(parsedRoot.value.owner);
      const requestedName = encodeURIComponent(parsedRoot.value.name);
      const repositoryResult = await getJson<
        Context,
        RepositoryMetadataResponse
      >(dependencies.client, {
        path: `/repos/${requestedOwner}/${requestedName}`,
        context,
      });
      if (!repositoryResult.ok) return repositoryResult;

      const repository = parseRepositoryMetadata(repositoryResult.value.data);
      if (!repository.ok) return repository;

      const ref = requestedRef
        ? requestedRef.value
        : repository.value.defaultBranch;
      if (!ref) {
        return fail(
          domainError(
            "needs-context",
            "This repository has no default branch. Choose a branch, tag, or commit.",
            false,
            { ref: "Select a repository revision to inspect." },
          ),
        );
      }
      const validatedRef = validateGithubRef(ref);
      if (!validatedRef.ok) return validatedRef;

      const canonicalOwner = encodeURIComponent(repository.value.owner);
      const canonicalName = encodeURIComponent(repository.value.name);
      const commitResult = await getJson<Context, CommitResponse>(
        dependencies.client,
        {
          path: `/repos/${canonicalOwner}/${canonicalName}/commits/${encodeURIComponent(validatedRef.value)}`,
          context,
        },
      );
      if (!commitResult.ok) return commitResult;

      const commit = parseCommit(commitResult.value.data);
      if (!commit.ok) return commit;

      const url = `https://github.com/${repository.value.owner}/${repository.value.name}`;
      return {
        ok: true,
        value: {
          snapshotId: snapshotId(
            repository.value.repositoryId,
            commit.value.commitSha,
            commit.value.treeSha,
          ),
          repositoryId: repository.value.repositoryId,
          owner: repository.value.owner,
          name: repository.value.name,
          url,
          visibility: repository.value.visibility,
          ref: validatedRef.value,
          commitSha: commit.value.commitSha,
          treeSha: commit.value.treeSha,
          ...(packagePath.value ? { packagePath: packagePath.value } : {}),
        },
      };
    },

    async inventory({ snapshot, context }) {
      return buildRepositoryInventory({
        snapshot,
        context,
        client: dependencies.client,
        limits: dependencies.inventoryLimits,
      });
    },
  };
}
