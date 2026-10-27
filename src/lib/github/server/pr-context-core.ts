import { createPrSignals, type PrSignals } from "./pr-signals";

export const PR_CONTEXT_LIMITS = {
  candidateSummaries: 30,
  selectedPullRequests: 3,
  changedPaths: 120,
  fileRowsPerPage: 30,
  filePagesPerPullRequest: 2,
  httpAttempts: 8,
  titlePromptCharacters: 160,
} as const;

export type GithubDomainErrorCode =
  | "invalid-input"
  | "forbidden"
  | "unavailable"
  | "not-found"
  | "limit-exceeded"
  | "rate-limited"
  | "needs-context"
  | "io-error"
  | "cancelled"
  | "interrupted"
  | "upstream-error";

export interface GithubDomainError {
  code: GithubDomainErrorCode;
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  /** Safe transport count only. Never include upstream response text. */
  attempts?: number;
}

export type GithubResult<T> =
  { ok: true; value: T } | { ok: false; error: GithubDomainError };

export interface GithubReadResponse<T> {
  data: T;
  status: number;
  etag?: string | null;
  hasNextPage?: boolean;
  /** Actual wire attempts reported by the shared fixed-origin client, when available. */
  attempts?: number;
}

export interface PrExecutionContext {
  runId: string;
  signal: AbortSignal;
  /** Identity of the run-scoped shared ledger. The client owns actual wire-attempt accounting. */
  budgetLedger: object;
}

export interface PrGithubClient {
  getJson<T>(input: {
    path: string;
    query?: Readonly<Record<string, string | number>>;
    context: PrExecutionContext;
  }): Promise<GithubResult<GithubReadResponse<T>>>;
}

export interface PrRepositoryScope {
  repositoryId: number;
  owner: string;
  name: string;
  canonicalUrl?: string;
  visibility?: "public" | "private";
  ref: string;
  commitSha: string;
}

export interface PrContextReaderDependencies {
  github: PrGithubClient;
}

export interface PrRepositoryIdentity {
  id: number | null;
  owner: string | null;
  name: string | null;
  fullName: string | null;
}

export interface PrRevisionAssociation {
  repository: PrRepositoryIdentity | null;
  ref: string | null;
  sha: string | null;
}

export type PrState = "open" | "closed" | "unknown";
export type PrMergeState = "open" | "closed-unmerged" | "merged" | "unknown";
export type PrFileStatus =
  | "added"
  | "modified"
  | "removed"
  | "renamed"
  | "copied"
  | "changed"
  | "unknown";

export interface PrAuthorHint {
  id: number | null;
  login: string | null;
  kind: "user" | "bot" | "unknown";
}

export interface PrCandidate {
  id: number;
  number: number;
  title: string;
  /** Bounded inert preview for a later extraction prompt; never an ownership assertion. */
  titleForPrompt: string;
  author: PrAuthorHint;
  state: PrState;
  mergeState: PrMergeState;
  mergedAt: string | null;
  draft: boolean;
  updatedAt: string | null;
  base: PrRevisionAssociation;
  head: PrRevisionAssociation;
  signals: PrSignals;
}

export interface PrChangedPath {
  /** GitHub's path at the selected PR revision; not proof the path exists in the pinned snapshot. */
  filename: string;
  /** Original name for a rename. For deletions, filename remains the removed historical path. */
  previousFilename: string | null;
  status: PrFileStatus;
  additions: number | null;
  deletions: number | null;
  changes: number | null;
  evidenceKind: "historical-pr-metadata";
  currentSnapshotContentVerified: false;
  reasonCodes: string[];
}

export interface SelectedPrContext {
  id: number;
  number: number;
  title: string;
  titleForPrompt: string;
  author: PrAuthorHint;
  state: PrState;
  mergeState: PrMergeState;
  mergedAt: string | null;
  draft: boolean;
  base: PrRevisionAssociation;
  head: PrRevisionAssociation;
  mergeCommitSha: string | null;
  currentSnapshotSha: string;
  snapshotRelation: "head-exact-match" | "base-exact-match" | "no-exact-match";
  changedPaths: PrChangedPath[];
  signals: PrSignals;
  contribution: {
    status: "unconfirmed";
    reasonCode: "user-confirmation-required";
  };
}

export interface PrContextResult<T> {
  currentSnapshot: {
    repositoryId: number;
    owner: string;
    name: string;
    ref: string;
    commitSha: string;
  };
  items: T[];
  historyScope: "bounded-recent-list" | "user-selected-pull-requests";
  partial: boolean;
  limitations: string[];
  /** This module does not establish authorship, exclusive contribution, or impact. */
  attribution: "unconfirmed";
}

interface ParsedRevision {
  value: PrRevisionAssociation;
  complete: boolean;
}

interface ParsedPr {
  value: PrCandidate;
  complete: boolean;
}

interface ParsedFile {
  value: PrChangedPath;
  complete: boolean;
}

const HEX_SHA = /^[a-f0-9]{40}$/i;
const REPOSITORY_PART = /^[A-Za-z0-9_.-]{1,100}$/;
const RECENT_CANDIDATE_SCOPE = "recent-list-does-not-search-older-history";
const LIST_UNAVAILABLE = "recent-candidate-list-incomplete";
const SELECTED_PR_UNAVAILABLE = "selected-pr-details-incomplete";
const FILE_PAGE_UNAVAILABLE = "changed-path-page-incomplete";
const CHANGED_PATH_CAP = "changed-path-limit-reached";
const REQUEST_CAP = "pr-request-budget-exhausted";
const MAX_PAGES = "changed-path-pagination-truncated";
const CURRENT_SNAPSHOT_LIMITATION =
  "pr-metadata-does-not-verify-current-snapshot-content";

const attemptsByLedger = new WeakMap<object, number>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function cleanDate(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 80 ||
    !Number.isFinite(Date.parse(value))
  ) {
    return null;
  }
  return value;
}

function cleanRef(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 255)
    return null;
  if (/[\u0000-\u0020\u007f]/.test(value)) return null;
  return value;
}

function cleanSha(value: unknown): string | null {
  return typeof value === "string" && HEX_SHA.test(value)
    ? value.toLowerCase()
    : null;
}

function cleanTitle(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value;
}

function promptTitle(title: string): string {
  const limit = PR_CONTEXT_LIMITS.titlePromptCharacters;
  if (title.length <= limit) return title;
  return `${Array.from(title)
    .slice(0, limit - 1)
    .join("")}…`;
}

function safeRepositoryIdentity(value: unknown): PrRepositoryIdentity | null {
  if (!isRecord(value)) return null;
  const ownerRecord = isRecord(value.owner) ? value.owner : null;
  const owner =
    typeof ownerRecord?.login === "string" &&
    REPOSITORY_PART.test(ownerRecord.login)
      ? ownerRecord.login
      : null;
  const name =
    typeof value.name === "string" && REPOSITORY_PART.test(value.name)
      ? value.name
      : null;
  const id = positiveInteger(value.id);

  return {
    id,
    owner,
    name,
    fullName: owner && name ? `${owner}/${name}` : null,
  };
}

function parseRevision(value: unknown): ParsedRevision {
  if (!isRecord(value)) {
    return {
      value: { repository: null, ref: null, sha: null },
      complete: false,
    };
  }

  const repository = safeRepositoryIdentity(value.repo);
  const ref = cleanRef(value.ref);
  const sha = cleanSha(value.sha);
  const repositoryComplete =
    repository !== null &&
    repository.id !== null &&
    repository.fullName !== null;

  return {
    value: { repository, ref, sha },
    complete: repositoryComplete && ref !== null && sha !== null,
  };
}

function parseAuthor(value: unknown): PrAuthorHint {
  if (!isRecord(value)) return { id: null, login: null, kind: "unknown" };
  const login =
    typeof value.login === "string" && value.login.length <= 100
      ? value.login
      : null;
  const id = positiveInteger(value.id);
  const type =
    typeof value.type === "string" ? value.type.toLocaleLowerCase("en-US") : "";
  const kind =
    type === "bot" || login?.toLocaleLowerCase("en-US").endsWith("[bot]")
      ? "bot"
      : login || id
        ? "user"
        : "unknown";
  return { id, login, kind };
}

function parseState(value: unknown): PrState {
  return value === "open" || value === "closed" ? value : "unknown";
}

function mergeState(
  state: PrState,
  mergedAt: string | null,
  isMerged: unknown,
): PrMergeState {
  if (mergedAt !== null || isMerged === true) return "merged";
  if (state === "closed") return "closed-unmerged";
  if (state === "open") return "open";
  return "unknown";
}

function parsePr(value: unknown): ParsedPr | null {
  if (!isRecord(value)) return null;
  const id = positiveInteger(value.id);
  const number = positiveInteger(value.number);
  const title = cleanTitle(value.title);
  if (id === null || number === null || title === null) return null;

  const state = parseState(value.state);
  const mergedAt = cleanDate(value.merged_at);
  const base = parseRevision(value.base);
  const head = parseRevision(value.head);
  const signals = createPrSignals({ title, changedPaths: [] });

  return {
    value: {
      id,
      number,
      title,
      titleForPrompt: promptTitle(title),
      author: parseAuthor(value.user),
      state,
      mergeState: mergeState(state, mergedAt, value.merged),
      mergedAt,
      draft: value.draft === true,
      updatedAt: cleanDate(value.updated_at),
      base: base.value,
      head: head.value,
      signals,
    },
    complete: base.complete && head.complete && state !== "unknown",
  };
}

function safeRelativePath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 1_000)
    return null;
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    return null;
  if (/^[A-Za-z]:/.test(value) || /%(?:2f|5c)/i.test(value)) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }

  const segments = decoded.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  )
    return null;
  if (decoded.includes("\\") || /^[A-Za-z]:/.test(decoded)) return null;
  return value;
}

function parseFileStatus(value: unknown): PrFileStatus {
  switch (value) {
    case "added":
    case "modified":
    case "removed":
    case "renamed":
    case "copied":
    case "changed":
      return value;
    default:
      return "unknown";
  }
}

function parseFile(value: unknown): ParsedFile | null {
  if (!isRecord(value)) return null;
  const filename = safeRelativePath(value.filename);
  if (filename === null) return null;
  const status = parseFileStatus(value.status);
  const previousRaw = value.previous_filename;
  const previousFilename =
    previousRaw === undefined || previousRaw === null
      ? null
      : safeRelativePath(previousRaw);
  const previousIsValid =
    previousRaw === undefined ||
    previousRaw === null ||
    previousFilename !== null;
  const fileSignals = createPrSignals({ title: "", changedPaths: [filename] });

  return {
    value: {
      filename,
      previousFilename,
      status,
      additions: nonNegativeInteger(value.additions),
      deletions: nonNegativeInteger(value.deletions),
      changes: nonNegativeInteger(value.changes),
      evidenceKind: "historical-pr-metadata",
      currentSnapshotContentVerified: false,
      reasonCodes: fileSignals.pathHints.map((hint) => hint.reasonCode),
    },
    complete: status !== "unknown" && previousIsValid,
  };
}

function scopeError(scope: PrRepositoryScope): GithubDomainError | null {
  if (!positiveInteger(scope.repositoryId)) {
    return {
      code: "invalid-input",
      message: "The repository scope is invalid.",
      retryable: false,
    };
  }
  if (
    typeof scope.owner !== "string" ||
    typeof scope.name !== "string" ||
    !REPOSITORY_PART.test(scope.owner) ||
    !REPOSITORY_PART.test(scope.name)
  ) {
    return {
      code: "invalid-input",
      message: "The repository scope is invalid.",
      retryable: false,
    };
  }
  if (typeof scope.commitSha !== "string" || !HEX_SHA.test(scope.commitSha)) {
    return {
      code: "invalid-input",
      message: "A pinned full commit revision is required.",
      retryable: false,
    };
  }
  if (cleanRef(scope.ref) === null) {
    return {
      code: "invalid-input",
      message: "The repository ref is invalid.",
      retryable: false,
    };
  }
  return null;
}

function currentSnapshot(
  scope: PrRepositoryScope,
): PrContextResult<never>["currentSnapshot"] {
  return {
    repositoryId: scope.repositoryId,
    owner: scope.owner,
    name: scope.name,
    ref: scope.ref,
    commitSha: scope.commitSha.toLowerCase(),
  };
}

function pullRequestRoot(scope: PrRepositoryScope): string {
  return `/repos/${encodeURIComponent(scope.owner)}/${encodeURIComponent(scope.name)}/pulls`;
}

function requestError(
  code: GithubDomainErrorCode,
  message: string,
): GithubDomainError {
  return {
    code,
    message,
    retryable:
      code === "rate-limited" ||
      code === "unavailable" ||
      code === "upstream-error",
  };
}

function recordAttempts(
  context: PrExecutionContext,
  previous: number,
  actualAttempts: unknown,
): void {
  const reported = positiveInteger(actualAttempts);
  const consumed = reported === null ? 1 : Math.max(1, reported);
  attemptsByLedger.set(
    context.budgetLedger,
    Math.min(PR_CONTEXT_LIMITS.httpAttempts, previous + consumed),
  );
}

async function request<T>(
  github: PrGithubClient,
  input: {
    path: string;
    query?: Readonly<Record<string, string | number>>;
    context: PrExecutionContext;
  },
): Promise<GithubResult<GithubReadResponse<T>>> {
  const previous = attemptsByLedger.get(input.context.budgetLedger) ?? 0;
  if (previous >= PR_CONTEXT_LIMITS.httpAttempts) {
    return {
      ok: false,
      error: requestError(
        "limit-exceeded",
        "The pull request inspection request limit was reached.",
      ),
    };
  }

  // The fixed-origin client owns per-wire attempt reservations and the shared 32-attempt cap.
  // This task-local guard also prevents a reader from issuing more than eight PR API operations.
  attemptsByLedger.set(input.context.budgetLedger, previous + 1);
  try {
    const result = await github.getJson<T>(input);
    if (result.ok)
      recordAttempts(input.context, previous, result.value.attempts);
    else recordAttempts(input.context, previous, result.error.attempts);
    return result;
  } catch {
    recordAttempts(input.context, previous, 1);
    return {
      ok: false,
      error: requestError(
        "upstream-error",
        "The pull request service could not be reached.",
      ),
    };
  }
}

function addLimitation(limitations: string[], reason: string): void {
  if (!limitations.includes(reason)) limitations.push(reason);
}

function parseArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function snapshotRelation(
  currentSha: string,
  base: PrRevisionAssociation,
  head: PrRevisionAssociation,
): SelectedPrContext["snapshotRelation"] {
  const normalizedCurrent = currentSha.toLowerCase();
  if (head.sha?.toLowerCase() === normalizedCurrent) return "head-exact-match";
  if (base.sha?.toLowerCase() === normalizedCurrent) return "base-exact-match";
  return "no-exact-match";
}

function buildSelectedPr(
  parsed: ParsedPr,
  changedPaths: PrChangedPath[],
  scope: PrRepositoryScope,
): SelectedPrContext {
  const candidate = parsed.value;
  return {
    id: candidate.id,
    number: candidate.number,
    title: candidate.title,
    titleForPrompt: candidate.titleForPrompt,
    author: candidate.author,
    state: candidate.state,
    mergeState: candidate.mergeState,
    mergedAt: candidate.mergedAt,
    draft: candidate.draft,
    base: candidate.base,
    head: candidate.head,
    mergeCommitSha: null,
    currentSnapshotSha: scope.commitSha.toLowerCase(),
    snapshotRelation: snapshotRelation(
      scope.commitSha,
      candidate.base,
      candidate.head,
    ),
    changedPaths,
    signals: createPrSignals({
      title: candidate.title,
      changedPaths: changedPaths.flatMap((path) => [
        path.filename,
        ...(path.previousFilename ? [path.previousFilename] : []),
      ]),
    }),
    contribution: {
      status: "unconfirmed",
      reasonCode: "user-confirmation-required",
    },
  };
}

function parseMergeCommitSha(value: unknown): string | null {
  return cleanSha(value);
}

function missingPrError(code: GithubDomainErrorCode): boolean {
  return (
    code === "limit-exceeded" ||
    code === "rate-limited" ||
    code === "unavailable" ||
    code === "not-found" ||
    code === "forbidden" ||
    code === "upstream-error"
  );
}

export function createPrContextReader(deps: PrContextReaderDependencies) {
  return {
    async listCandidates(input: {
      scope: PrRepositoryScope;
      context: PrExecutionContext;
    }): Promise<GithubResult<PrContextResult<PrCandidate>>> {
      const invalid = scopeError(input.scope);
      if (invalid) return { ok: false, error: invalid };

      const limitations: string[] = [RECENT_CANDIDATE_SCOPE];
      const response = await request<unknown>(deps.github, {
        path: pullRequestRoot(input.scope),
        query: {
          state: "all",
          sort: "updated",
          direction: "desc",
          per_page: PR_CONTEXT_LIMITS.candidateSummaries,
          page: 1,
        },
        context: input.context,
      });

      if (!response.ok) {
        addLimitation(limitations, LIST_UNAVAILABLE);
        return {
          ok: true,
          value: {
            currentSnapshot: currentSnapshot(input.scope),
            items: [],
            historyScope: "bounded-recent-list",
            partial: true,
            limitations,
            attribution: "unconfirmed",
          },
        };
      }

      const rows = parseArray(response.value.data);
      if (rows === null) {
        addLimitation(limitations, LIST_UNAVAILABLE);
        return {
          ok: true,
          value: {
            currentSnapshot: currentSnapshot(input.scope),
            items: [],
            historyScope: "bounded-recent-list",
            partial: true,
            limitations,
            attribution: "unconfirmed",
          },
        };
      }

      const items: PrCandidate[] = [];
      let partial =
        response.value.hasNextPage === true ||
        rows.length > PR_CONTEXT_LIMITS.candidateSummaries;
      for (const row of rows.slice(0, PR_CONTEXT_LIMITS.candidateSummaries)) {
        const parsed = parsePr(row);
        if (!parsed) {
          partial = true;
          addLimitation(limitations, LIST_UNAVAILABLE);
          continue;
        }
        if (!parsed.complete) {
          partial = true;
          addLimitation(limitations, CURRENT_SNAPSHOT_LIMITATION);
        }
        items.push(parsed.value);
      }

      if (rows.length >= PR_CONTEXT_LIMITS.candidateSummaries) partial = true;

      return {
        ok: true,
        value: {
          currentSnapshot: currentSnapshot(input.scope),
          items,
          historyScope: "bounded-recent-list",
          partial,
          limitations,
          attribution: "unconfirmed",
        },
      };
    },

    async readSelected(input: {
      scope: PrRepositoryScope;
      selectedNumbers: ReadonlyArray<number>;
      context: PrExecutionContext;
    }): Promise<GithubResult<PrContextResult<SelectedPrContext>>> {
      const invalid = scopeError(input.scope);
      if (invalid) return { ok: false, error: invalid };
      if (
        !Array.isArray(input.selectedNumbers) ||
        input.selectedNumbers.length > PR_CONTEXT_LIMITS.selectedPullRequests
      ) {
        return {
          ok: false,
          error: requestError(
            "limit-exceeded",
            "Select no more than three pull requests.",
          ),
        };
      }
      if (
        input.selectedNumbers.some(
          (number) => positiveInteger(number) === null,
        ) ||
        new Set(input.selectedNumbers).size !== input.selectedNumbers.length
      ) {
        return {
          ok: false,
          error: requestError(
            "invalid-input",
            "Selected pull request numbers must be unique positive integers.",
          ),
        };
      }

      const limitations: string[] = [];
      const items: SelectedPrContext[] = [];
      let partial = false;
      let retainedPaths = 0;

      for (const number of input.selectedNumbers) {
        const detail = await request<unknown>(deps.github, {
          path: `${pullRequestRoot(input.scope)}/${number}`,
          context: input.context,
        });
        if (!detail.ok) {
          if (!missingPrError(detail.error.code))
            return { ok: false, error: detail.error };
          partial = true;
          addLimitation(
            limitations,
            detail.error.code === "limit-exceeded"
              ? REQUEST_CAP
              : SELECTED_PR_UNAVAILABLE,
          );
          if (detail.error.code === "limit-exceeded") break;
          continue;
        }

        const parsed = parsePr(detail.value.data);
        if (!parsed || parsed.value.number !== number) {
          partial = true;
          addLimitation(limitations, SELECTED_PR_UNAVAILABLE);
          continue;
        }
        if (!parsed.complete) {
          partial = true;
          addLimitation(limitations, CURRENT_SNAPSHOT_LIMITATION);
        }

        const files: PrChangedPath[] = [];
        let page = 1;
        let hasNextPage = false;
        while (
          page <= PR_CONTEXT_LIMITS.filePagesPerPullRequest &&
          retainedPaths < PR_CONTEXT_LIMITS.changedPaths
        ) {
          const filesResult = await request<unknown>(deps.github, {
            path: `${pullRequestRoot(input.scope)}/${number}/files`,
            query: { per_page: PR_CONTEXT_LIMITS.fileRowsPerPage, page },
            context: input.context,
          });

          if (!filesResult.ok) {
            partial = true;
            addLimitation(
              limitations,
              filesResult.error.code === "limit-exceeded"
                ? REQUEST_CAP
                : FILE_PAGE_UNAVAILABLE,
            );
            break;
          }

          const rows = parseArray(filesResult.value.data);
          if (rows === null) {
            partial = true;
            addLimitation(limitations, FILE_PAGE_UNAVAILABLE);
            break;
          }

          if (rows.length > PR_CONTEXT_LIMITS.fileRowsPerPage) {
            partial = true;
            addLimitation(limitations, FILE_PAGE_UNAVAILABLE);
          }
          const boundedRows = rows.slice(0, PR_CONTEXT_LIMITS.fileRowsPerPage);
          for (const row of boundedRows) {
            if (retainedPaths >= PR_CONTEXT_LIMITS.changedPaths) {
              partial = true;
              addLimitation(limitations, CHANGED_PATH_CAP);
              break;
            }
            const parsedFile = parseFile(row);
            if (!parsedFile) {
              partial = true;
              addLimitation(limitations, FILE_PAGE_UNAVAILABLE);
              continue;
            }
            files.push(parsedFile.value);
            retainedPaths += 1;
            if (!parsedFile.complete) {
              partial = true;
              addLimitation(limitations, FILE_PAGE_UNAVAILABLE);
            }
          }

          hasNextPage =
            filesResult.value.hasNextPage ??
            boundedRows.length === PR_CONTEXT_LIMITS.fileRowsPerPage;
          if (!hasNextPage) break;
          if (page === PR_CONTEXT_LIMITS.filePagesPerPullRequest) {
            partial = true;
            addLimitation(limitations, MAX_PAGES);
            break;
          }
          if (
            (attemptsByLedger.get(input.context.budgetLedger) ?? 0) >=
            PR_CONTEXT_LIMITS.httpAttempts
          ) {
            partial = true;
            addLimitation(limitations, REQUEST_CAP);
            break;
          }
          page += 1;
        }

        if (retainedPaths >= PR_CONTEXT_LIMITS.changedPaths && hasNextPage) {
          partial = true;
          addLimitation(limitations, CHANGED_PATH_CAP);
        }

        const selected = buildSelectedPr(parsed, files, input.scope);
        selected.mergeCommitSha = parseMergeCommitSha(
          isRecord(detail.value.data)
            ? detail.value.data.merge_commit_sha
            : null,
        );
        items.push(selected);

        if (
          (attemptsByLedger.get(input.context.budgetLedger) ?? 0) >=
          PR_CONTEXT_LIMITS.httpAttempts
        ) {
          if (
            input.selectedNumbers.indexOf(number) <
            input.selectedNumbers.length - 1
          ) {
            partial = true;
            addLimitation(limitations, REQUEST_CAP);
          }
          break;
        }
      }

      if (
        input.selectedNumbers.length > 0 &&
        items.length < input.selectedNumbers.length
      ) {
        partial = true;
        addLimitation(limitations, SELECTED_PR_UNAVAILABLE);
      }
      if (items.some((item) => item.changedPaths.length > 0)) {
        addLimitation(limitations, CURRENT_SNAPSHOT_LIMITATION);
      }

      return {
        ok: true,
        value: {
          currentSnapshot: currentSnapshot(input.scope),
          items,
          historyScope: "user-selected-pull-requests",
          partial,
          limitations,
          attribution: "unconfirmed",
        },
      };
    },
  };
}
