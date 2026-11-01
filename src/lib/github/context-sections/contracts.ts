export const BASELINE_TEXT_FILE_LIMIT_BYTES = 64 * 1024;
export const EXPERIMENTAL_TEXT_FILE_LIMIT_BYTES = 256 * 1024;

export const CONTEXT_SECTION_LIMITS = Object.freeze({
  maxRunBytes: 512 * 1024,
  maxDecodedMemoryBytes: 512 * 1024,
  maxReadAttempts: 20,
  maxExcerptBytes: 12_000,
  maxExcerptLines: 200,
  maxLineCharacters: 2_000,
  maxPathLength: 1_024,
  maxSectionsPerFile: 64,
  maxCacheBytes: 1024 * 1024,
});

export type ContextSectionIntent =
  "overview" | "implementation" | "verification" | "configuration" | "unknown";

export type ContextSectionRole =
  "overview" | "implementation" | "verification" | "configuration" | "unknown";

export type ContextSectionKind =
  | "file"
  | "markdown-section"
  | "paragraph"
  | "declaration"
  | "nested-declaration"
  | "signature"
  | "python-declaration";

export type ContextEvidenceStatus =
  "source" | "documented" | "planned" | "unknown";

export interface PinnedRepositoryIdentity {
  repositoryId: string;
  owner: string;
  name: string;
  commitSha: string;
}

export interface PinnedFileIdentity {
  fileId: string;
  path: string;
  blobSha: string;
  /** Exact size from the pinned inventory, when available. */
  byteSize?: number;
  /** Git mode. Only regular blobs (100644 and 100755) are readable. */
  mode: string;
}

export interface PinnedBlobAuthorizationRequest {
  repositoryId: string;
  authorizationNamespace: string;
  deadlineEpochMs: number;
  signal: AbortSignal;
}

export interface PinnedBlobRequest {
  repository: PinnedRepositoryIdentity;
  file: PinnedFileIdentity;
  authorizationNamespace: string;
  /** The adapter must enforce this while streaming, before yielding bytes. */
  maxBytes: number;
  deadlineEpochMs: number;
  signal: AbortSignal;
}

export interface PinnedBlobResponse {
  /** Identity of the repository and pinned-tree entry actually read. */
  repositoryId: string;
  commitSha: string;
  path: string;
  blobSha: string;
  body: AsyncIterable<Uint8Array>;
}

/**
 * Production adapters must authorize the repository, use the fixed GitHub API
 * origin, resolve the file from the requested pinned tree, and enforce the
 * streamed byte/deadline/signal limits before yielding chunks.
 */
export interface PinnedBlobSource {
  /** Recheck live access before every cache hit, in-flight reuse, or source read. */
  isAuthorized(input: PinnedBlobAuthorizationRequest): Promise<boolean>;
  openPinnedBlob(input: PinnedBlobRequest): Promise<PinnedBlobResponse>;
}

export interface SectionReadContext {
  /** Opaque account/grant scope; it is used only to partition memory caches. */
  authorizationNamespace: string;
  signal: AbortSignal;
  deadlineEpochMs: number;
}

export interface SectionReadBudget {
  /** Defaults to 256 KiB. Callers can lower, but never raise, this limit. */
  maxFileBytes?: number;
  /** Approximate UTF-16 text memory, budgeted separately from downloaded bytes. */
  maxDecodedMemoryBytes?: number;
  /** Defaults to the existing 12,000-character per-file evidence ceiling. */
  maxExcerptBytes?: number;
  /** Defaults to the existing 200-line per-file evidence ceiling. */
  maxExcerptLines?: number;
}

export interface ContextSection {
  id: string;
  repositoryId: string;
  commitSha: string;
  path: string;
  blobSha: string;
  contentHash: string;
  lineStart: number;
  lineEnd: number;
  excerpt: string;
  role: ContextSectionRole;
  kind: ContextSectionKind;
  evidenceStatus: ContextEvidenceStatus;
  completeness: "complete" | "partial";
  partialContext?: string;
  warnings: readonly string[];
  dependencyHints: readonly string[];
  byteSize: number;
  estimatedTokens: number;
  score: number;
}

export type SectionReaderErrorCode =
  | "invalid-input"
  | "forbidden"
  | "blocked-path"
  | "binary-content"
  | "invalid-utf8"
  | "unsafe-content"
  | "source-mismatch"
  | "source-size-mismatch"
  | "file-too-large"
  | "line-too-long"
  | "run-budget-exceeded"
  | "decoded-memory-limit"
  | "deadline-exceeded"
  | "cancelled"
  | "empty-text"
  | "source-error";

export interface SectionReaderError {
  code: SectionReaderErrorCode;
  message: string;
  retryable: boolean;
}

export type SectionReadResult =
  | {
      ok: true;
      repositoryId: string;
      commitSha: string;
      path: string;
      blobSha: string;
      sourceBytes: number;
      lineCount: number;
      excerptBytes: number;
      sections: readonly ContextSection[];
      limitations: readonly string[];
      untrustedInstructions: boolean;
      cacheHit: boolean;
    }
  | { ok: false; error: SectionReaderError; cacheHit: false };

export interface ContextSectionReaderOptions {
  now?: () => number;
  maxRunBytes?: number;
  maxReadAttempts?: number;
  maxCacheBytes?: number;
}

export interface ReadSectionsInput {
  repository: PinnedRepositoryIdentity;
  file: PinnedFileIdentity;
  context: SectionReadContext;
  intent: ContextSectionIntent;
  relevanceTerms?: readonly string[];
  budget?: SectionReadBudget;
}

export interface ReadManySectionsInput {
  repository: PinnedRepositoryIdentity;
  files: readonly PinnedFileIdentity[];
  context: SectionReadContext;
  intent: ContextSectionIntent;
  relevanceTerms?: readonly string[];
  budget?: SectionReadBudget;
}

export interface ReadManySectionsResult {
  results: readonly {
    fileId: string;
    result: SectionReadResult;
  }[];
  successfulFiles: number;
  failedFiles: number;
  downloadedBytes: number;
  limitations: readonly string[];
}
