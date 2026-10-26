/**
 * Shared, in-memory accounting for one GitHub inspection/extraction run.
 *
 * This module deliberately stores evidence metadata and counts, never source
 * text. A caller reserves a complete request before sending it, commits the
 * provider-reported usage once, or releases a reservation only when it knows
 * the request was never sent.
 */

export const GITHUB_BUDGET_LIMITS = Object.freeze({
  inventoryEntries: 10_000,
  inventoryDepth: 8,
  inventoryWireBytes: 8 * 1024 * 1024,
  fetchedBodies: 20,
  decodedBytesPerBody: 64 * 1024,
  decodedBytesTotal: 512 * 1024,
  upstreamBytes: 12 * 1024 * 1024,
  httpAttempts: 32,
  prHttpAttempts: 8,
  selectedFilesPerRequest: 12,
  selectedFilesPerImport: 16,
  sourceLinesPerFilePerRequest: 200,
  sourceLinesPerRequest: 1_500,
  uniqueSourceLinesPerFile: 300,
  uniqueSourceLinesPerImport: 2_000,
  transmittedLineOccurrences: 3_000,
  selectedCharactersPerFile: 12_000,
  selectedCharactersTotal: 80_000,
  inputTokensPerRequest: 24_000,
  inputTokensPerImport: 36_000,
  generatedTokensPerRequest: 6_144,
  generationAttempts: 2,
  historyCommitSummaries: 20,
  historyCommitDetails: 3,
  requestDeadlineMs: 10_000,
  inspectionDeadlineMs: 60_000,
  extractionDeadlineMs: 120_000,
});

export const GITHUB_BUDGET_TARGETS = Object.freeze({
  normalInputTokens: { minimum: 6_000, maximum: 10_000 },
  normalFiles: { minimum: 8, maximum: 10 },
  normalSourceLines: { minimum: 600, maximum: 900 },
  recoveryInputTokens: { minimum: 2_000, maximum: 6_000 },
});

export type BudgetAttemptKind =
  "github-http" | "pr-http" | "token-count" | "generation" | "recovery";

export type BudgetLineRange = {
  startLine: number;
  endLine: number;
};

/** A single source file/patch/projection in the exact request being reserved. */
export type BudgetEvidenceInput = {
  /** Stable identity: repository ID + pinned revision + normalized path, or a patch identity. */
  fileId: string;
  /** Original source rows represented by this excerpt. Required for non-empty text. */
  ranges?: readonly BudgetLineRange[];
  /** Exact text to be transmitted. It is counted and discarded during reservation. */
  text?: string;
  /** Optional explicit payload count when text is assembled elsewhere. */
  characters?: number;
  /** Physical rows in a compact rendered projection. Counted alongside source ranges. */
  renderedLines?: number;
};

export type BudgetFetchedBody = {
  fileId: string;
  /** Upper bound for this response body, or measured bytes at commit time. */
  decodedBytes: number;
};

export type BudgetConsent = {
  selectionHash: string;
  selectionVersion: number;
  confirmedAt: string;
};

export type BudgetAttemptInput = {
  attemptId: string;
  kind: BudgetAttemptKind;
  /** Required for provider token counting and generation; binds use to consented content. */
  consent?: BudgetConsent;
  files?: readonly BudgetEvidenceInput[];
  /** Upper-bound estimate for the complete provider input, including policy and schema. */
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  estimatedReasoningTokens?: number;
  /** Required for HTTP attempts; cap the response stream to this remaining-wire reservation. */
  upstreamBytes?: number;
  /** Upper bound for each GitHub response body requested in this attempt. */
  fetchedBodies?: readonly BudgetFetchedBody[];
  inventoryEntries?: number;
  inventoryDepth?: number;
  inventoryWireBytes?: number;
  historyCommitSummaries?: number;
  historyCommitDetails?: number;
};

export type BudgetMeasuredUsage = {
  /** Actual encoded request + response bytes for a GitHub HTTP attempt. */
  upstreamBytes: number;
  /** Bodies actually returned by GitHub. An empty file is still one body. */
  fetchedBodies: readonly BudgetFetchedBody[];
  inventoryEntries: number;
  inventoryDepth: number;
  inventoryWireBytes: number;
  historyCommitSummaries: number;
  historyCommitDetails: number;
  /** Effective prompt tokens, including cached prompt tokens exactly once. */
  inputTokens: number;
  /** Result of the consented provider token-count preflight; not billed generation usage. */
  preflightInputTokens: number;
  /** Provider-reported subset of inputTokens; informational, never added again. */
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};

export type BudgetReason =
  | "invalid-attempt"
  | "invalid-evidence"
  | "reservation-conflict"
  | "reservation-overrun"
  | "unknown-attempt"
  | "already-released"
  | "release-must-be-unsent"
  | "external-consent-required"
  | "deadline-exceeded"
  | "http-request-in-flight"
  | "provider-request-in-flight"
  | "http-attempt-limit"
  | "pr-http-attempt-limit"
  | "generation-attempt-limit"
  | "fetched-body-limit"
  | "decoded-body-limit"
  | "decoded-total-limit"
  | "upstream-byte-limit"
  | "inventory-entry-limit"
  | "inventory-depth-limit"
  | "inventory-byte-limit"
  | "selected-file-request-limit"
  | "selected-file-import-limit"
  | "source-lines-per-file-request-limit"
  | "source-lines-request-limit"
  | "source-lines-per-file-import-limit"
  | "source-lines-import-limit"
  | "transmitted-line-limit"
  | "selected-characters-per-file-limit"
  | "selected-characters-total-limit"
  | "input-tokens-request-limit"
  | "input-tokens-import-limit"
  | "generated-tokens-request-limit"
  | "history-summary-limit"
  | "history-detail-limit";

export type BudgetError = {
  code: "invalid-input" | "forbidden" | "not-found" | "limit-exceeded";
  reason: BudgetReason;
  message: string;
  retryable: false;
};

export type BudgetResult<T> =
  { ok: true; value: T } | { ok: false; error: BudgetError };

export type BudgetTokenCounter = {
  limit: number;
  actual: number;
  estimated: number;
  unknown: number;
  remaining: number;
};

export type BudgetSummary = {
  deadlines: {
    inspectionRemainingMs: number;
    extractionRemainingMs: number;
    extractionStarted: boolean;
    inspectionExpired: boolean;
    extractionExpired: boolean;
    expired: boolean;
  };
  httpAttempts: { limit: number; used: number; remaining: number };
  prHttpAttempts: { limit: number; used: number; remaining: number };
  generationAttempts: { limit: number; used: number; remaining: number };
  fetchedBodies: { limit: number; used: number; remaining: number };
  decodedBytes: {
    limit: number;
    used: number;
    reserved: number;
    remaining: number;
  };
  upstreamBytes: {
    limit: number;
    used: number;
    reserved: number;
    remaining: number;
  };
  inventory: {
    entriesLimit: number;
    entriesUsed: number;
    depthLimit: number;
    deepest: number;
    wireBytesLimit: number;
    wireBytesUsed: number;
    wireBytesReserved: number;
  };
  selection: {
    filesLimit: number;
    filesUsed: number;
    uniqueSourceLinesLimit: number;
    uniqueSourceLinesUsed: number;
    transmittedLineOccurrencesLimit: number;
    transmittedLineOccurrencesUsed: number;
    charactersLimit: number;
    charactersUsed: number;
  };
  inputTokens: BudgetTokenCounter;
  providerTokenCount: {
    attempts: number;
    knownAttempts: number;
    unknownAttempts: number;
    measuredInputTokens: number;
  };
  generatedTokens: BudgetTokenCounter;
  outputTokens: BudgetTokenCounter;
  reasoningTokens: BudgetTokenCounter;
  history: {
    summariesLimit: number;
    summariesUsed: number;
    detailsLimit: number;
    detailsUsed: number;
  };
};

export type BudgetSelectionSummary = {
  filesThisRequest: number;
  sourceLinesThisRequest: number;
  uniqueSourceLinesAfter: number;
  transmittedLineOccurrencesAfter: number;
  charactersThisRequest: number;
  charactersAfter: number;
  inputTokensAfter: number;
};

export type BudgetSnapshot = {
  version: 1;
  createdAt: number;
  inspectionDeadlineAt: number;
  extractionDeadlineAt: number | null;
  operationDeadlineAt: number | null;
  attempts: readonly BudgetAttemptSnapshot[];
};

export type BudgetLedgerConfig = {
  /** UTC milliseconds or ISO timestamp. Defaults to a 60-second inspection deadline. */
  inspectionDeadlineAt?: number | string;
  /** UTC milliseconds or ISO timestamp. Otherwise the 120-second timer starts at first provider request. */
  extractionDeadlineAt?: number | string;
  /** Optional enclosing job deadline applied to both phases. */
  operationDeadlineAt?: number | string;
  /** Injected clock for deterministic callers/tests. */
  now?: () => number;
  /** Restore a prior content-free snapshot. */
  snapshot?: BudgetSnapshot;
};

export type BudgetLedger = {
  reserve(input: BudgetAttemptInput): BudgetResult<{
    attemptId: string;
    kind: BudgetAttemptKind;
    status: "reserved" | "committed" | "unknown";
    created: boolean;
  }>;
  commitUsage(
    attemptId: string,
    usage: BudgetMeasuredUsage | { known: false },
  ): BudgetResult<{ idempotent: boolean; usageKnown: boolean }>;
  /** Release only after the caller has confirmed that nothing was sent upstream. */
  release(
    attemptId: string,
    confirmNotSent: true,
  ): BudgetResult<{ released: boolean }>;
  /** Non-mutating admission check. reserve() repeats this check atomically. */
  checkSelection(input: {
    files: readonly BudgetEvidenceInput[];
    estimatedInputTokens?: number;
  }): BudgetResult<BudgetSelectionSummary>;
  remaining(): BudgetSummary;
  snapshot(): BudgetSnapshot;
};

type StoredEvidence = {
  fileId: string;
  ranges: BudgetLineRange[];
  renderedLines: number;
  requestLines: number;
  characters: number;
};

type StoredReservation = {
  upstreamBytes: number;
  fetchedBodies: BudgetFetchedBody[];
  inventoryEntries: number;
  inventoryDepth: number;
  inventoryWireBytes: number;
  historyCommitSummaries: number;
  historyCommitDetails: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};

type StoredUsage = StoredReservation & {
  cachedInputTokens: number;
  preflightInputTokens: number;
};

type BudgetAttemptSnapshot = {
  attemptId: string;
  kind: BudgetAttemptKind;
  consent: BudgetConsent | null;
  evidence: readonly StoredEvidence[];
  reserved: StoredReservation;
  status: "reserved" | "committed" | "unknown" | "released";
  actual: StoredUsage | null;
  commitSignature: string | null;
  commitError: BudgetReason | null;
};

type InternalState = {
  createdAt: number;
  inspectionDeadlineAt: number;
  extractionDeadlineAt: number | null;
  operationDeadlineAt: number | null;
  attempts: Map<string, BudgetAttemptSnapshot>;
};

const SAFE_BUDGET_MESSAGE =
  "The requested operation exceeds the shared inspection budget.";
const SAFE_INVALID_MESSAGE = "The budget request is invalid.";
const SAFE_CONSENT_MESSAGE =
  "Explicit consent for this exact selection is required.";

function failure<T>(
  code: BudgetError["code"],
  reason: BudgetReason,
  message = SAFE_BUDGET_MESSAGE,
): BudgetResult<T> {
  return { ok: false, error: { code, reason, message, retryable: false } };
}

function limitFailure<T>(reason: BudgetReason): BudgetResult<T> {
  return failure("limit-exceeded", reason);
}

function parseDeadline(
  value: number | string | undefined,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new TypeError("Invalid budget deadline");
  return parsed;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function normalizedText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Physical line count after CRLF/CR normalization; a final newline adds no empty content line. */
export function countPhysicalLines(text: string): number {
  const normalized = normalizedText(text);
  if (normalized.length === 0) return 0;
  const count = normalized.split("\n").length;
  return normalized.endsWith("\n") ? count - 1 : count;
}

function codePointLength(text: string): number {
  return Array.from(normalizedText(text)).length;
}

function mergeRanges(ranges: readonly BudgetLineRange[]): BudgetLineRange[] {
  const sorted = ranges
    .map((range) => ({ startLine: range.startLine, endLine: range.endLine }))
    .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  const merged: BudgetLineRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.startLine <= last.endLine + 1) {
      last.endLine = Math.max(last.endLine, range.endLine);
    } else {
      merged.push(range);
    }
  }
  return merged;
}

function rangeLineCount(ranges: readonly BudgetLineRange[]): number {
  return ranges.reduce(
    (total, range) => total + range.endLine - range.startLine + 1,
    0,
  );
}

function normalizeEvidence(
  inputs: readonly BudgetEvidenceInput[] | undefined,
): BudgetResult<StoredEvidence[]> {
  if (inputs === undefined) return { ok: true, value: [] };
  if (!Array.isArray(inputs))
    return failure("invalid-input", "invalid-evidence", SAFE_INVALID_MESSAGE);

  const grouped = new Map<
    string,
    { ranges: BudgetLineRange[]; renderedLines: number; characters: number }
  >();
  for (const item of inputs) {
    if (
      !item ||
      typeof item.fileId !== "string" ||
      item.fileId.trim().length === 0 ||
      item.fileId.length > 2_048 ||
      /[\u0000-\u001f\u007f]/.test(item.fileId)
    ) {
      return failure("invalid-input", "invalid-evidence", SAFE_INVALID_MESSAGE);
    }
    const ranges = item.ranges ?? [];
    if (!Array.isArray(ranges))
      return failure("invalid-input", "invalid-evidence", SAFE_INVALID_MESSAGE);
    for (const range of ranges) {
      if (
        !range ||
        !isNonNegativeInteger(range.startLine) ||
        !isNonNegativeInteger(range.endLine) ||
        range.startLine < 1 ||
        range.endLine < range.startLine
      ) {
        return failure(
          "invalid-input",
          "invalid-evidence",
          SAFE_INVALID_MESSAGE,
        );
      }
    }
    if (item.text !== undefined && typeof item.text !== "string") {
      return failure("invalid-input", "invalid-evidence", SAFE_INVALID_MESSAGE);
    }
    const derivedLines =
      item.text === undefined ? undefined : countPhysicalLines(item.text);
    const derivedCharacters =
      item.text === undefined ? undefined : codePointLength(item.text);
    if (derivedLines !== undefined && derivedLines > 0 && ranges.length === 0) {
      return failure("invalid-input", "invalid-evidence", SAFE_INVALID_MESSAGE);
    }
    if (
      item.renderedLines !== undefined &&
      !isNonNegativeInteger(item.renderedLines)
    ) {
      return failure("invalid-input", "invalid-evidence", SAFE_INVALID_MESSAGE);
    }
    if (
      item.characters !== undefined &&
      !isNonNegativeInteger(item.characters)
    ) {
      return failure("invalid-input", "invalid-evidence", SAFE_INVALID_MESSAGE);
    }
    if (
      derivedLines !== undefined &&
      item.renderedLines !== undefined &&
      derivedLines !== item.renderedLines
    ) {
      return failure("invalid-input", "invalid-evidence", SAFE_INVALID_MESSAGE);
    }
    if (
      derivedCharacters !== undefined &&
      item.characters !== undefined &&
      derivedCharacters !== item.characters
    ) {
      return failure("invalid-input", "invalid-evidence", SAFE_INVALID_MESSAGE);
    }

    const renderedLines = item.renderedLines ?? derivedLines ?? 0;
    const characters = item.characters ?? derivedCharacters ?? 0;
    const existing = grouped.get(item.fileId) ?? {
      ranges: [],
      renderedLines: 0,
      characters: 0,
    };
    existing.ranges.push(...ranges);
    existing.renderedLines += renderedLines;
    existing.characters += characters;
    grouped.set(item.fileId, existing);
  }

  const normalized: StoredEvidence[] = [];
  for (const [fileId, value] of grouped) {
    const ranges = mergeRanges(value.ranges);
    normalized.push({
      fileId,
      ranges,
      renderedLines: value.renderedLines,
      requestLines: Math.max(rangeLineCount(ranges), value.renderedLines),
      characters: value.characters,
    });
  }
  normalized.sort((a, b) => a.fileId.localeCompare(b.fileId));
  return { ok: true, value: normalized };
}

function emptyReservation(): StoredReservation {
  return {
    upstreamBytes: 0,
    fetchedBodies: [],
    inventoryEntries: 0,
    inventoryDepth: 0,
    inventoryWireBytes: 0,
    historyCommitSummaries: 0,
    historyCommitDetails: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  };
}

function normalizedAttempt(input: BudgetAttemptInput):
  | {
      ok: true;
      value: Omit<
        BudgetAttemptSnapshot,
        "status" | "actual" | "commitSignature" | "commitError"
      >;
    }
  | { ok: false; error: BudgetError } {
  if (
    !input ||
    typeof input.attemptId !== "string" ||
    input.attemptId.trim().length === 0 ||
    input.attemptId.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(input.attemptId)
  ) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        reason: "invalid-attempt",
        message: SAFE_INVALID_MESSAGE,
        retryable: false,
      },
    };
  }
  const kinds: BudgetAttemptKind[] = [
    "github-http",
    "pr-http",
    "token-count",
    "generation",
    "recovery",
  ];
  if (!kinds.includes(input.kind)) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        reason: "invalid-attempt",
        message: SAFE_INVALID_MESSAGE,
        retryable: false,
      },
    };
  }

  const external =
    input.kind === "token-count" ||
    input.kind === "generation" ||
    input.kind === "recovery";
  const http = input.kind === "github-http" || input.kind === "pr-http";
  const generation = input.kind === "generation" || input.kind === "recovery";
  let consent: BudgetConsent | null = null;
  if (external) {
    const candidate = input.consent;
    if (
      !candidate ||
      typeof candidate.selectionHash !== "string" ||
      !/^[\w:.-]{8,256}$/.test(candidate.selectionHash) ||
      !Number.isSafeInteger(candidate.selectionVersion) ||
      candidate.selectionVersion < 1 ||
      typeof candidate.confirmedAt !== "string" ||
      !Number.isFinite(Date.parse(candidate.confirmedAt))
    ) {
      return {
        ok: false,
        error: {
          code: "forbidden",
          reason: "external-consent-required",
          message: SAFE_CONSENT_MESSAGE,
          retryable: false,
        },
      };
    }
    consent = { ...candidate };
  }

  const evidence = normalizeEvidence(input.files);
  if (!evidence.ok) return evidence;
  const reserved = emptyReservation();
  const numericFields: (keyof StoredReservation)[] = [
    "upstreamBytes",
    "inventoryEntries",
    "inventoryDepth",
    "inventoryWireBytes",
    "historyCommitSummaries",
    "historyCommitDetails",
    "inputTokens",
    "outputTokens",
    "reasoningTokens",
  ];
  const source: Record<string, unknown> = {
    upstreamBytes: input.upstreamBytes,
    inventoryEntries: input.inventoryEntries,
    inventoryDepth: input.inventoryDepth,
    inventoryWireBytes: input.inventoryWireBytes,
    historyCommitSummaries: input.historyCommitSummaries,
    historyCommitDetails: input.historyCommitDetails,
    inputTokens: input.estimatedInputTokens,
    outputTokens: input.estimatedOutputTokens,
    reasoningTokens: input.estimatedReasoningTokens,
  };
  for (const field of numericFields) {
    const raw = source[field];
    if (raw !== undefined && !isNonNegativeInteger(raw)) {
      return {
        ok: false,
        error: {
          code: "invalid-input",
          reason: "invalid-attempt",
          message: SAFE_INVALID_MESSAGE,
          retryable: false,
        },
      };
    }
    (reserved[field] as number) = (raw as number | undefined) ?? 0;
  }
  if (
    (input.kind === "github-http" || input.kind === "pr-http") &&
    input.upstreamBytes === undefined
  ) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        reason: "invalid-attempt",
        message: SAFE_INVALID_MESSAGE,
        retryable: false,
      },
    };
  }
  if (
    generation &&
    (input.estimatedInputTokens === undefined ||
      input.estimatedOutputTokens === undefined ||
      input.estimatedReasoningTokens === undefined)
  ) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        reason: "invalid-attempt",
        message: SAFE_INVALID_MESSAGE,
        retryable: false,
      },
    };
  }
  if (
    input.kind === "token-count" &&
    (input.estimatedInputTokens !== undefined ||
      input.estimatedOutputTokens !== undefined ||
      input.estimatedReasoningTokens !== undefined)
  ) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        reason: "invalid-attempt",
        message: SAFE_INVALID_MESSAGE,
        retryable: false,
      },
    };
  }
  if (
    http &&
    (external ||
      input.files !== undefined ||
      input.estimatedInputTokens !== undefined ||
      input.estimatedOutputTokens !== undefined ||
      input.estimatedReasoningTokens !== undefined)
  ) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        reason: "invalid-attempt",
        message: SAFE_INVALID_MESSAGE,
        retryable: false,
      },
    };
  }
  if (
    !http &&
    (input.upstreamBytes !== undefined ||
      input.fetchedBodies !== undefined ||
      input.inventoryEntries !== undefined ||
      input.inventoryDepth !== undefined ||
      input.inventoryWireBytes !== undefined ||
      input.historyCommitSummaries !== undefined ||
      input.historyCommitDetails !== undefined)
  ) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        reason: "invalid-attempt",
        message: SAFE_INVALID_MESSAGE,
        retryable: false,
      },
    };
  }
  if (external && evidence.value.length === 0) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        reason: "invalid-evidence",
        message: SAFE_INVALID_MESSAGE,
        retryable: false,
      },
    };
  }

  const bodies = input.fetchedBodies ?? [];
  if (!Array.isArray(bodies)) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        reason: "invalid-attempt",
        message: SAFE_INVALID_MESSAGE,
        retryable: false,
      },
    };
  }
  for (const body of bodies) {
    if (
      !body ||
      typeof body.fileId !== "string" ||
      body.fileId.trim().length === 0 ||
      body.fileId.length > 2_048 ||
      !isNonNegativeInteger(body.decodedBytes)
    ) {
      return {
        ok: false,
        error: {
          code: "invalid-input",
          reason: "invalid-attempt",
          message: SAFE_INVALID_MESSAGE,
          retryable: false,
        },
      };
    }
  }
  if (new Set(bodies.map((body) => body.fileId)).size !== bodies.length) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        reason: "invalid-attempt",
        message: SAFE_INVALID_MESSAGE,
        retryable: false,
      },
    };
  }
  reserved.fetchedBodies = bodies
    .map((body) => ({ ...body }))
    .sort((a, b) => a.fileId.localeCompare(b.fileId));
  return {
    ok: true,
    value: {
      attemptId: input.attemptId,
      kind: input.kind,
      consent,
      evidence: evidence.value,
      reserved,
    },
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function inputSignature(
  input: Omit<
    BudgetAttemptSnapshot,
    "status" | "actual" | "commitSignature" | "commitError"
  >,
): string {
  return stableStringify(input);
}

function isActive(attempt: BudgetAttemptSnapshot): boolean {
  return attempt.status !== "released";
}

function actualTokenTotal(
  attempts: Iterable<BudgetAttemptSnapshot>,
  field: "inputTokens" | "outputTokens" | "reasoningTokens",
): number {
  let total = 0;
  for (const attempt of attempts) {
    if (
      (attempt.kind === "generation" || attempt.kind === "recovery") &&
      attempt.status === "committed" &&
      attempt.actual
    )
      total += attempt.actual[field];
  }
  return total;
}

function inFlightHttp(attempts: Iterable<BudgetAttemptSnapshot>): boolean {
  for (const attempt of attempts) {
    if (
      (attempt.kind === "github-http" || attempt.kind === "pr-http") &&
      attempt.status === "reserved"
    )
      return true;
  }
  return false;
}

function countKind(
  attempts: Iterable<BudgetAttemptSnapshot>,
  kinds: readonly BudgetAttemptKind[],
): number {
  let count = 0;
  for (const attempt of attempts)
    if (isActive(attempt) && kinds.includes(attempt.kind)) count += 1;
  return count;
}

function allEvidence(
  attempts: Iterable<BudgetAttemptSnapshot>,
): StoredEvidence[][] {
  const evidence: StoredEvidence[][] = [];
  for (const attempt of attempts) {
    if (isActive(attempt) && attempt.evidence.length > 0)
      evidence.push(attempt.evidence as StoredEvidence[]);
  }
  return evidence;
}

function unionRanges(
  left: readonly BudgetLineRange[],
  right: readonly BudgetLineRange[],
): BudgetLineRange[] {
  return mergeRanges([...left, ...right]);
}

function summarizeEvidence(evidenceSets: readonly StoredEvidence[][]): {
  files: number;
  uniqueLines: number;
  transmittedLines: number;
  characters: number;
  perFileRequestLines: Map<string, number>;
  perFileRequestCharacters: Map<string, number>;
  perFileUniqueLines: Map<string, number>;
} {
  const allFiles = new Set<string>();
  const uniqueRanges = new Map<string, BudgetLineRange[]>();
  const uniqueFloors = new Map<string, number>();
  const perFileRequestLines = new Map<string, number>();
  const perFileRequestCharacters = new Map<string, number>();
  let transmittedLines = 0;
  let characters = 0;

  for (const evidence of evidenceSets) {
    const requestRanges = new Map<string, BudgetLineRange[]>();
    const requestFloors = new Map<string, number>();
    const requestCharacters = new Map<string, number>();
    for (const file of evidence) {
      allFiles.add(file.fileId);
      requestRanges.set(
        file.fileId,
        unionRanges(requestRanges.get(file.fileId) ?? [], file.ranges),
      );
      requestFloors.set(
        file.fileId,
        (requestFloors.get(file.fileId) ?? 0) + file.renderedLines,
      );
      requestCharacters.set(
        file.fileId,
        (requestCharacters.get(file.fileId) ?? 0) + file.characters,
      );
      uniqueRanges.set(
        file.fileId,
        unionRanges(uniqueRanges.get(file.fileId) ?? [], file.ranges),
      );
      uniqueFloors.set(
        file.fileId,
        Math.max(uniqueFloors.get(file.fileId) ?? 0, file.renderedLines),
      );
    }
    for (const fileId of new Set([
      ...requestRanges.keys(),
      ...requestFloors.keys(),
    ])) {
      const requestLines = Math.max(
        rangeLineCount(requestRanges.get(fileId) ?? []),
        requestFloors.get(fileId) ?? 0,
      );
      transmittedLines += requestLines;
      perFileRequestLines.set(
        fileId,
        (perFileRequestLines.get(fileId) ?? 0) + requestLines,
      );
      const fileChars = requestCharacters.get(fileId) ?? 0;
      characters += fileChars;
      perFileRequestCharacters.set(
        fileId,
        (perFileRequestCharacters.get(fileId) ?? 0) + fileChars,
      );
    }
  }

  const perFileUniqueLines = new Map<string, number>();
  let uniqueLines = 0;
  for (const fileId of allFiles) {
    const count = Math.max(
      rangeLineCount(uniqueRanges.get(fileId) ?? []),
      uniqueFloors.get(fileId) ?? 0,
    );
    perFileUniqueLines.set(fileId, count);
    uniqueLines += count;
  }
  return {
    files: allFiles.size,
    uniqueLines,
    transmittedLines,
    characters,
    perFileRequestLines,
    perFileRequestCharacters,
    perFileUniqueLines,
  };
}

function sumAttemptResource(
  attempts: Iterable<BudgetAttemptSnapshot>,
  field: keyof StoredReservation,
): number {
  let total = 0;
  for (const attempt of attempts) {
    if (!isActive(attempt)) continue;
    if (attempt.status === "committed" && attempt.actual)
      total += attempt.actual[field as keyof StoredUsage] as number;
    else total += attempt.reserved[field] as number;
  }
  return total;
}

function sumCommittedOrUnknownResource(
  attempts: Iterable<BudgetAttemptSnapshot>,
  field: keyof StoredReservation,
): number {
  let total = 0;
  for (const attempt of attempts) {
    if (attempt.status === "committed" && attempt.actual)
      total += attempt.actual[field as keyof StoredUsage] as number;
    else if (attempt.status === "unknown")
      total += attempt.reserved[field] as number;
  }
  return total;
}

function sumPendingResource(
  attempts: Iterable<BudgetAttemptSnapshot>,
  field: keyof StoredReservation,
): number {
  let total = 0;
  for (const attempt of attempts)
    if (attempt.status === "reserved")
      total += attempt.reserved[field] as number;
  return total;
}

function fetchedBodyRecords(
  attempts: Iterable<BudgetAttemptSnapshot>,
): BudgetFetchedBody[] {
  const bodies: BudgetFetchedBody[] = [];
  for (const attempt of attempts) {
    if (!isActive(attempt)) continue;
    const selected =
      attempt.status === "committed" && attempt.actual
        ? attempt.actual.fetchedBodies
        : attempt.reserved.fetchedBodies;
    bodies.push(...selected);
  }
  return bodies;
}

function buildSummary(state: InternalState, now: number): BudgetSummary {
  const attempts = state.attempts.values();
  const records = [...attempts];
  const active = records.filter(isActive);
  const source = summarizeEvidence(allEvidence(records));
  const actualInput = actualTokenTotal(records, "inputTokens");
  const actualOutput = actualTokenTotal(records, "outputTokens");
  const actualReasoning = actualTokenTotal(records, "reasoningTokens");
  const estimatedInput = active.reduce(
    (sum, attempt) =>
      sum + (attempt.status === "reserved" ? attempt.reserved.inputTokens : 0),
    0,
  );
  const unknownInput = active.reduce(
    (sum, attempt) =>
      sum + (attempt.status === "unknown" ? attempt.reserved.inputTokens : 0),
    0,
  );
  const estimatedOutput = active.reduce(
    (sum, attempt) =>
      sum + (attempt.status === "reserved" ? attempt.reserved.outputTokens : 0),
    0,
  );
  const unknownOutput = active.reduce(
    (sum, attempt) =>
      sum + (attempt.status === "unknown" ? attempt.reserved.outputTokens : 0),
    0,
  );
  const estimatedReasoning = active.reduce(
    (sum, attempt) =>
      sum +
      (attempt.status === "reserved" ? attempt.reserved.reasoningTokens : 0),
    0,
  );
  const unknownReasoning = active.reduce(
    (sum, attempt) =>
      sum +
      (attempt.status === "unknown" ? attempt.reserved.reasoningTokens : 0),
    0,
  );
  const knownBodies = fetchedBodyRecords(records);
  const decodedUsed = records.reduce((sum, attempt) => {
    if (attempt.status !== "committed" && attempt.status !== "unknown")
      return sum;
    const bodies =
      attempt.status === "committed" && attempt.actual
        ? attempt.actual.fetchedBodies
        : attempt.reserved.fetchedBodies;
    return (
      sum + bodies.reduce((bodySum, body) => bodySum + body.decodedBytes, 0)
    );
  }, 0);
  const decodedReserved = active.reduce(
    (sum, attempt) =>
      attempt.status === "reserved"
        ? sum +
          attempt.reserved.fetchedBodies.reduce(
            (bodySum, body) => bodySum + body.decodedBytes,
            0,
          )
        : sum,
    0,
  );
  const upstreamUsed = sumCommittedOrUnknownResource(records, "upstreamBytes");
  const upstreamReserved = sumPendingResource(records, "upstreamBytes");
  const inventoryBytes = sumCommittedOrUnknownResource(
    records,
    "inventoryWireBytes",
  );
  const inventoryBytesReserved = sumPendingResource(
    records,
    "inventoryWireBytes",
  );
  const inventoryEntries = sumAttemptResource(records, "inventoryEntries");
  const deepest = active.reduce((max, attempt) => {
    const value =
      attempt.status === "committed" && attempt.actual
        ? attempt.actual.inventoryDepth
        : attempt.reserved.inventoryDepth;
    return Math.max(max, value);
  }, 0);
  const summaries = sumAttemptResource(records, "historyCommitSummaries");
  const details = sumAttemptResource(records, "historyCommitDetails");
  const httpUsed = countKind(records, ["github-http", "pr-http"]);
  const prUsed = countKind(records, ["pr-http"]);
  const countAttempts = countKind(records, ["token-count"]);
  const countKnownAttempts = records.filter(
    (attempt) =>
      attempt.kind === "token-count" && attempt.status === "committed",
  );
  const countUnknownAttempts = records.filter(
    (attempt) => attempt.kind === "token-count" && attempt.status === "unknown",
  );
  const measuredPreflightTokens = countKnownAttempts.reduce(
    (sum, attempt) => sum + (attempt.actual?.preflightInputTokens ?? 0),
    0,
  );
  const generationUsed = countKind(records, ["generation", "recovery"]);
  const inspectionRemaining = Math.max(
    0,
    Math.min(
      state.inspectionDeadlineAt,
      state.operationDeadlineAt ?? Infinity,
    ) - now,
  );
  const extractionDeadline =
    state.extractionDeadlineAt ??
    now + GITHUB_BUDGET_LIMITS.extractionDeadlineMs;
  const extractionRemaining = Math.max(
    0,
    Math.min(extractionDeadline, state.operationDeadlineAt ?? Infinity) - now,
  );
  const inspectionExpired = inspectionRemaining <= 0;
  const extractionExpired = extractionRemaining <= 0;
  const makeTokenCounter = (
    limit: number,
    actual: number,
    estimated: number,
    unknown: number,
  ): BudgetTokenCounter => ({
    limit,
    actual,
    estimated,
    unknown,
    remaining: Math.max(0, limit - actual - estimated - unknown),
  });

  return {
    deadlines: {
      inspectionRemainingMs: inspectionRemaining,
      extractionRemainingMs: extractionRemaining,
      extractionStarted: state.extractionDeadlineAt !== null,
      inspectionExpired,
      extractionExpired,
      expired: inspectionExpired && extractionExpired,
    },
    httpAttempts: {
      limit: GITHUB_BUDGET_LIMITS.httpAttempts,
      used: httpUsed,
      remaining: Math.max(0, GITHUB_BUDGET_LIMITS.httpAttempts - httpUsed),
    },
    prHttpAttempts: {
      limit: GITHUB_BUDGET_LIMITS.prHttpAttempts,
      used: prUsed,
      remaining: Math.max(0, GITHUB_BUDGET_LIMITS.prHttpAttempts - prUsed),
    },
    generationAttempts: {
      limit: GITHUB_BUDGET_LIMITS.generationAttempts,
      used: generationUsed,
      remaining: Math.max(
        0,
        GITHUB_BUDGET_LIMITS.generationAttempts - generationUsed,
      ),
    },
    fetchedBodies: {
      limit: GITHUB_BUDGET_LIMITS.fetchedBodies,
      used: new Set(knownBodies.map((body) => body.fileId)).size,
      remaining: Math.max(
        0,
        GITHUB_BUDGET_LIMITS.fetchedBodies -
          new Set(knownBodies.map((body) => body.fileId)).size,
      ),
    },
    decodedBytes: {
      limit: GITHUB_BUDGET_LIMITS.decodedBytesTotal,
      used: decodedUsed,
      reserved: decodedReserved,
      remaining: Math.max(
        0,
        GITHUB_BUDGET_LIMITS.decodedBytesTotal - decodedUsed - decodedReserved,
      ),
    },
    upstreamBytes: {
      limit: GITHUB_BUDGET_LIMITS.upstreamBytes,
      used: upstreamUsed,
      reserved: upstreamReserved,
      remaining: Math.max(
        0,
        GITHUB_BUDGET_LIMITS.upstreamBytes - upstreamUsed - upstreamReserved,
      ),
    },
    inventory: {
      entriesLimit: GITHUB_BUDGET_LIMITS.inventoryEntries,
      entriesUsed: inventoryEntries,
      depthLimit: GITHUB_BUDGET_LIMITS.inventoryDepth,
      deepest,
      wireBytesLimit: GITHUB_BUDGET_LIMITS.inventoryWireBytes,
      wireBytesUsed: inventoryBytes,
      wireBytesReserved: inventoryBytesReserved,
    },
    selection: {
      filesLimit: GITHUB_BUDGET_LIMITS.selectedFilesPerImport,
      filesUsed: source.files,
      uniqueSourceLinesLimit: GITHUB_BUDGET_LIMITS.uniqueSourceLinesPerImport,
      uniqueSourceLinesUsed: source.uniqueLines,
      transmittedLineOccurrencesLimit:
        GITHUB_BUDGET_LIMITS.transmittedLineOccurrences,
      transmittedLineOccurrencesUsed: source.transmittedLines,
      charactersLimit: GITHUB_BUDGET_LIMITS.selectedCharactersTotal,
      charactersUsed: source.characters,
    },
    inputTokens: makeTokenCounter(
      GITHUB_BUDGET_LIMITS.inputTokensPerImport,
      actualInput,
      estimatedInput,
      unknownInput,
    ),
    providerTokenCount: {
      attempts: countAttempts,
      knownAttempts: countKnownAttempts.length,
      unknownAttempts: countUnknownAttempts.length,
      measuredInputTokens: measuredPreflightTokens,
    },
    generatedTokens: makeTokenCounter(
      GITHUB_BUDGET_LIMITS.generatedTokensPerRequest *
        GITHUB_BUDGET_LIMITS.generationAttempts,
      actualOutput + actualReasoning,
      estimatedOutput + estimatedReasoning,
      unknownOutput + unknownReasoning,
    ),
    outputTokens: makeTokenCounter(
      GITHUB_BUDGET_LIMITS.generatedTokensPerRequest *
        GITHUB_BUDGET_LIMITS.generationAttempts,
      actualOutput,
      estimatedOutput,
      unknownOutput,
    ),
    reasoningTokens: makeTokenCounter(
      GITHUB_BUDGET_LIMITS.generatedTokensPerRequest *
        GITHUB_BUDGET_LIMITS.generationAttempts,
      actualReasoning,
      estimatedReasoning,
      unknownReasoning,
    ),
    history: {
      summariesLimit: GITHUB_BUDGET_LIMITS.historyCommitSummaries,
      summariesUsed: summaries,
      detailsLimit: GITHUB_BUDGET_LIMITS.historyCommitDetails,
      detailsUsed: details,
    },
  };
}

function measuredUsage(input: BudgetMeasuredUsage): BudgetResult<StoredUsage> {
  const fields: (keyof Omit<BudgetMeasuredUsage, "fetchedBodies">)[] = [
    "upstreamBytes",
    "inventoryEntries",
    "inventoryDepth",
    "inventoryWireBytes",
    "historyCommitSummaries",
    "historyCommitDetails",
    "inputTokens",
    "preflightInputTokens",
    "cachedInputTokens",
    "outputTokens",
    "reasoningTokens",
  ];
  if (!input || !Array.isArray(input.fetchedBodies)) {
    return failure("invalid-input", "invalid-attempt", SAFE_INVALID_MESSAGE);
  }
  for (const field of fields) {
    if (!isNonNegativeInteger(input[field])) {
      return failure("invalid-input", "invalid-attempt", SAFE_INVALID_MESSAGE);
    }
  }
  if (input.cachedInputTokens > input.inputTokens) {
    return failure("invalid-input", "invalid-attempt", SAFE_INVALID_MESSAGE);
  }
  const bodies = input.fetchedBodies
    .map((body) => ({ ...body }))
    .sort((a, b) => a.fileId.localeCompare(b.fileId));
  if (
    bodies.some(
      (body) =>
        typeof body.fileId !== "string" ||
        body.fileId.trim().length === 0 ||
        !isNonNegativeInteger(body.decodedBytes),
    )
  ) {
    return failure("invalid-input", "invalid-attempt", SAFE_INVALID_MESSAGE);
  }
  if (new Set(bodies.map((body) => body.fileId)).size !== bodies.length) {
    return failure("invalid-input", "invalid-attempt", SAFE_INVALID_MESSAGE);
  }
  return {
    ok: true,
    value: {
      upstreamBytes: input.upstreamBytes,
      fetchedBodies: bodies,
      inventoryEntries: input.inventoryEntries,
      inventoryDepth: input.inventoryDepth,
      inventoryWireBytes: input.inventoryWireBytes,
      historyCommitSummaries: input.historyCommitSummaries,
      historyCommitDetails: input.historyCommitDetails,
      inputTokens: input.inputTokens,
      preflightInputTokens: input.preflightInputTokens,
      cachedInputTokens: input.cachedInputTokens,
      outputTokens: input.outputTokens,
      reasoningTokens: input.reasoningTokens,
    },
  };
}

function actualExceedsReservation(
  attempt: BudgetAttemptSnapshot,
  actual: StoredUsage,
): boolean {
  if (
    actual.upstreamBytes > attempt.reserved.upstreamBytes ||
    actual.inventoryEntries > attempt.reserved.inventoryEntries ||
    actual.inventoryDepth > attempt.reserved.inventoryDepth ||
    actual.inventoryWireBytes > attempt.reserved.inventoryWireBytes ||
    actual.historyCommitSummaries > attempt.reserved.historyCommitSummaries ||
    actual.historyCommitDetails > attempt.reserved.historyCommitDetails ||
    ((attempt.kind === "generation" || attempt.kind === "recovery") &&
      actual.inputTokens > attempt.reserved.inputTokens) ||
    (attempt.kind !== "token-count" && actual.preflightInputTokens !== 0) ||
    actual.outputTokens > attempt.reserved.outputTokens ||
    actual.reasoningTokens > attempt.reserved.reasoningTokens
  )
    return true;
  const reserved = new Map(
    attempt.reserved.fetchedBodies.map((body) => [
      body.fileId,
      body.decodedBytes,
    ]),
  );
  return actual.fetchedBodies.some(
    (body) =>
      !reserved.has(body.fileId) ||
      body.decodedBytes > (reserved.get(body.fileId) ?? 0),
  );
}

function actualOverrunReason(
  attempt: BudgetAttemptSnapshot,
  actual: StoredUsage,
): BudgetReason | null {
  if (actual.upstreamBytes > GITHUB_BUDGET_LIMITS.upstreamBytes)
    return "upstream-byte-limit";
  if (
    actual.fetchedBodies.some(
      (body) => body.decodedBytes > GITHUB_BUDGET_LIMITS.decodedBytesPerBody,
    )
  )
    return "decoded-body-limit";
  if (
    actual.fetchedBodies.some(
      (body) =>
        !attempt.reserved.fetchedBodies.some(
          (reserved) => reserved.fileId === body.fileId,
        ),
    )
  )
    return "fetched-body-limit";
  if (actual.inventoryEntries > GITHUB_BUDGET_LIMITS.inventoryEntries)
    return "inventory-entry-limit";
  if (actual.inventoryDepth > GITHUB_BUDGET_LIMITS.inventoryDepth)
    return "inventory-depth-limit";
  if (actual.inventoryWireBytes > GITHUB_BUDGET_LIMITS.inventoryWireBytes)
    return "inventory-byte-limit";
  if (
    actual.historyCommitSummaries > GITHUB_BUDGET_LIMITS.historyCommitSummaries
  )
    return "history-summary-limit";
  if (actual.historyCommitDetails > GITHUB_BUDGET_LIMITS.historyCommitDetails)
    return "history-detail-limit";
  if (
    (attempt.kind === "token-count" &&
      actual.preflightInputTokens >
        GITHUB_BUDGET_LIMITS.inputTokensPerRequest) ||
    ((attempt.kind === "generation" || attempt.kind === "recovery") &&
      actual.inputTokens > GITHUB_BUDGET_LIMITS.inputTokensPerRequest)
  )
    return "input-tokens-request-limit";
  if (
    actual.outputTokens + actual.reasoningTokens >
    GITHUB_BUDGET_LIMITS.generatedTokensPerRequest
  )
    return "generated-tokens-request-limit";
  if (actual.inventoryWireBytes > actual.upstreamBytes)
    return "invalid-attempt";
  if (actualExceedsReservation(attempt, actual)) return "reservation-overrun";
  return null;
}

function measuredHardLimit(
  summary: BudgetSummary,
  attempt: BudgetAttemptSnapshot,
  actual: StoredUsage,
): BudgetReason | null {
  if (summary.httpAttempts.used > GITHUB_BUDGET_LIMITS.httpAttempts)
    return "http-attempt-limit";
  if (summary.prHttpAttempts.used > GITHUB_BUDGET_LIMITS.prHttpAttempts)
    return "pr-http-attempt-limit";
  if (summary.fetchedBodies.used > GITHUB_BUDGET_LIMITS.fetchedBodies)
    return "fetched-body-limit";
  if (summary.decodedBytes.used > GITHUB_BUDGET_LIMITS.decodedBytesTotal)
    return "decoded-total-limit";
  if (summary.upstreamBytes.used > GITHUB_BUDGET_LIMITS.upstreamBytes)
    return "upstream-byte-limit";
  if (summary.inventory.entriesUsed > GITHUB_BUDGET_LIMITS.inventoryEntries)
    return "inventory-entry-limit";
  if (summary.inventory.deepest > GITHUB_BUDGET_LIMITS.inventoryDepth)
    return "inventory-depth-limit";
  if (summary.inventory.wireBytesUsed > GITHUB_BUDGET_LIMITS.inventoryWireBytes)
    return "inventory-byte-limit";
  if (
    summary.history.summariesUsed > GITHUB_BUDGET_LIMITS.historyCommitSummaries
  )
    return "history-summary-limit";
  if (summary.history.detailsUsed > GITHUB_BUDGET_LIMITS.historyCommitDetails)
    return "history-detail-limit";
  if (summary.inputTokens.actual > GITHUB_BUDGET_LIMITS.inputTokensPerImport)
    return "input-tokens-import-limit";
  if (
    attempt.kind === "token-count" &&
    actual.preflightInputTokens > GITHUB_BUDGET_LIMITS.inputTokensPerRequest
  )
    return "input-tokens-request-limit";
  if (
    (attempt.kind === "generation" || attempt.kind === "recovery") &&
    actual.inputTokens > GITHUB_BUDGET_LIMITS.inputTokensPerRequest
  )
    return "input-tokens-request-limit";
  if (
    summary.generatedTokens.actual >
    GITHUB_BUDGET_LIMITS.generatedTokensPerRequest *
      GITHUB_BUDGET_LIMITS.generationAttempts
  ) {
    return "generated-tokens-request-limit";
  }
  if (
    actual.outputTokens + actual.reasoningTokens >
    GITHUB_BUDGET_LIMITS.generatedTokensPerRequest
  )
    return "generated-tokens-request-limit";
  return null;
}

function createState(config: BudgetLedgerConfig): InternalState {
  const now = config.now ?? Date.now;
  if (config.snapshot) {
    const snapshot = config.snapshot;
    if (
      snapshot.version !== 1 ||
      !Number.isFinite(snapshot.createdAt) ||
      !Number.isFinite(snapshot.inspectionDeadlineAt) ||
      !(
        snapshot.extractionDeadlineAt === null ||
        Number.isFinite(snapshot.extractionDeadlineAt)
      ) ||
      !(
        snapshot.operationDeadlineAt === null ||
        Number.isFinite(snapshot.operationDeadlineAt)
      ) ||
      !Array.isArray(snapshot.attempts)
    )
      throw new TypeError("Invalid budget snapshot");
    const attempts = new Map<string, BudgetAttemptSnapshot>();
    for (const attempt of snapshot.attempts) {
      if (
        !attempt ||
        typeof attempt.attemptId !== "string" ||
        attempts.has(attempt.attemptId)
      ) {
        throw new TypeError("Invalid budget snapshot");
      }
      if (
        !(["reserved", "committed", "unknown", "released"] as const).includes(
          attempt.status,
        )
      ) {
        throw new TypeError("Invalid budget snapshot");
      }
      attempts.set(
        attempt.attemptId,
        JSON.parse(JSON.stringify(attempt)) as BudgetAttemptSnapshot,
      );
    }
    return {
      createdAt: snapshot.createdAt,
      inspectionDeadlineAt: snapshot.inspectionDeadlineAt,
      extractionDeadlineAt: snapshot.extractionDeadlineAt,
      operationDeadlineAt: snapshot.operationDeadlineAt,
      attempts,
    };
  }
  const createdAt = now();
  return {
    createdAt,
    inspectionDeadlineAt: parseDeadline(
      config.inspectionDeadlineAt,
      createdAt + GITHUB_BUDGET_LIMITS.inspectionDeadlineMs,
    ),
    extractionDeadlineAt:
      config.extractionDeadlineAt === undefined
        ? null
        : parseDeadline(
            config.extractionDeadlineAt,
            createdAt + GITHUB_BUDGET_LIMITS.extractionDeadlineMs,
          ),
    operationDeadlineAt:
      config.operationDeadlineAt === undefined
        ? null
        : parseDeadline(config.operationDeadlineAt, createdAt),
    attempts: new Map(),
  };
}

function checkProjectedUsage(
  state: InternalState,
  proposed: BudgetAttemptSnapshot,
  now: number,
): BudgetResult<BudgetSelectionSummary> {
  const records = [...state.attempts.values()].filter(isActive);
  const http = proposed.kind === "github-http" || proposed.kind === "pr-http";
  const extraction =
    proposed.kind === "token-count" ||
    proposed.kind === "generation" ||
    proposed.kind === "recovery";
  const selectionCheck = proposed.attemptId === "selection-check";
  const deadline = extraction
    ? Math.min(
        state.extractionDeadlineAt ??
          now + GITHUB_BUDGET_LIMITS.extractionDeadlineMs,
        state.operationDeadlineAt ?? Infinity,
      )
    : Math.min(
        state.inspectionDeadlineAt,
        state.operationDeadlineAt ?? Infinity,
      );
  if (now >= deadline) return limitFailure("deadline-exceeded");
  if (http && inFlightHttp(records))
    return limitFailure("http-request-in-flight");
  if (
    !selectionCheck &&
    extraction &&
    records.some(
      (attempt) =>
        (attempt.kind === "token-count" ||
          attempt.kind === "generation" ||
          attempt.kind === "recovery") &&
        attempt.status === "reserved",
    )
  )
    return limitFailure("provider-request-in-flight");

  const existing = countKind(records, ["github-http", "pr-http"]);
  if (
    !selectionCheck &&
    http &&
    existing + 1 > GITHUB_BUDGET_LIMITS.httpAttempts
  )
    return limitFailure("http-attempt-limit");
  if (
    !selectionCheck &&
    proposed.kind === "pr-http" &&
    countKind(records, ["pr-http"]) + 1 > GITHUB_BUDGET_LIMITS.prHttpAttempts
  ) {
    return limitFailure("pr-http-attempt-limit");
  }
  if (
    !selectionCheck &&
    (proposed.kind === "generation" || proposed.kind === "recovery") &&
    countKind(records, ["generation", "recovery"]) + 1 >
      GITHUB_BUDGET_LIMITS.generationAttempts
  ) {
    return limitFailure("generation-attempt-limit");
  }
  if (
    !selectionCheck &&
    proposed.kind === "recovery" &&
    !records.some(
      (attempt) =>
        attempt.kind === "generation" &&
        (attempt.status === "committed" || attempt.status === "unknown"),
    )
  ) {
    return failure("invalid-input", "invalid-attempt", SAFE_INVALID_MESSAGE);
  }
  if (
    !selectionCheck &&
    proposed.kind === "generation" &&
    countKind(records, ["generation"]) > 0
  ) {
    return limitFailure("generation-attempt-limit");
  }
  if (
    !selectionCheck &&
    (proposed.kind === "generation" ||
      proposed.kind === "recovery" ||
      proposed.kind === "token-count") &&
    proposed.evidence.length === 0
  ) {
    return failure("invalid-input", "invalid-evidence", SAFE_INVALID_MESSAGE);
  }

  const evidenceSets = allEvidence(records);
  const proposedEvidence = proposed.evidence as StoredEvidence[];
  const requestUsage = summarizeEvidence([proposedEvidence]);
  const totalUsage = summarizeEvidence([...evidenceSets, proposedEvidence]);
  if (requestUsage.files > GITHUB_BUDGET_LIMITS.selectedFilesPerRequest)
    return limitFailure("selected-file-request-limit");
  if (totalUsage.files > GITHUB_BUDGET_LIMITS.selectedFilesPerImport)
    return limitFailure("selected-file-import-limit");
  if (
    [...requestUsage.perFileRequestLines.values()].some(
      (lines) => lines > GITHUB_BUDGET_LIMITS.sourceLinesPerFilePerRequest,
    )
  ) {
    return limitFailure("source-lines-per-file-request-limit");
  }
  if (
    requestUsage.transmittedLines > GITHUB_BUDGET_LIMITS.sourceLinesPerRequest
  )
    return limitFailure("source-lines-request-limit");
  if (
    [...totalUsage.perFileUniqueLines.values()].some(
      (lines) => lines > GITHUB_BUDGET_LIMITS.uniqueSourceLinesPerFile,
    )
  ) {
    return limitFailure("source-lines-per-file-import-limit");
  }
  if (totalUsage.uniqueLines > GITHUB_BUDGET_LIMITS.uniqueSourceLinesPerImport)
    return limitFailure("source-lines-import-limit");
  if (
    totalUsage.transmittedLines >
    GITHUB_BUDGET_LIMITS.transmittedLineOccurrences
  )
    return limitFailure("transmitted-line-limit");
  if (
    [...requestUsage.perFileRequestCharacters.values()].some(
      (chars) => chars > GITHUB_BUDGET_LIMITS.selectedCharactersPerFile,
    )
  ) {
    return limitFailure("selected-characters-per-file-limit");
  }
  if (
    [...totalUsage.perFileRequestCharacters.values()].some(
      (chars) => chars > GITHUB_BUDGET_LIMITS.selectedCharactersPerFile,
    )
  ) {
    return limitFailure("selected-characters-per-file-limit");
  }
  if (totalUsage.characters > GITHUB_BUDGET_LIMITS.selectedCharactersTotal)
    return limitFailure("selected-characters-total-limit");

  const bodyRecords = fetchedBodyRecords(records);
  const incomingBodies = proposed.reserved.fetchedBodies;
  const bodyIds = new Set([
    ...bodyRecords.map((body) => body.fileId),
    ...incomingBodies.map((body) => body.fileId),
  ]);
  if (bodyIds.size > GITHUB_BUDGET_LIMITS.fetchedBodies)
    return limitFailure("fetched-body-limit");
  if (
    incomingBodies.some(
      (body) => body.decodedBytes > GITHUB_BUDGET_LIMITS.decodedBytesPerBody,
    )
  )
    return limitFailure("decoded-body-limit");
  const decodedBytes =
    bodyRecords.reduce((sum, body) => sum + body.decodedBytes, 0) +
    incomingBodies.reduce((sum, body) => sum + body.decodedBytes, 0);
  if (decodedBytes > GITHUB_BUDGET_LIMITS.decodedBytesTotal)
    return limitFailure("decoded-total-limit");

  const upstreamUsed =
    sumAttemptResource(records, "upstreamBytes") +
    proposed.reserved.upstreamBytes;
  if (upstreamUsed > GITHUB_BUDGET_LIMITS.upstreamBytes)
    return limitFailure("upstream-byte-limit");
  const inventoryEntries =
    sumAttemptResource(records, "inventoryEntries") +
    proposed.reserved.inventoryEntries;
  if (inventoryEntries > GITHUB_BUDGET_LIMITS.inventoryEntries)
    return limitFailure("inventory-entry-limit");
  const deepest = Math.max(
    records.reduce(
      (max, attempt) =>
        Math.max(
          max,
          attempt.status === "committed" && attempt.actual
            ? attempt.actual.inventoryDepth
            : attempt.reserved.inventoryDepth,
        ),
      0,
    ),
    proposed.reserved.inventoryDepth,
  );
  if (deepest > GITHUB_BUDGET_LIMITS.inventoryDepth)
    return limitFailure("inventory-depth-limit");
  const inventoryBytes =
    sumAttemptResource(records, "inventoryWireBytes") +
    proposed.reserved.inventoryWireBytes;
  if (inventoryBytes > GITHUB_BUDGET_LIMITS.inventoryWireBytes)
    return limitFailure("inventory-byte-limit");
  if (proposed.reserved.inventoryWireBytes > proposed.reserved.upstreamBytes) {
    return failure("invalid-input", "invalid-attempt", SAFE_INVALID_MESSAGE);
  }

  const summaries =
    sumAttemptResource(records, "historyCommitSummaries") +
    proposed.reserved.historyCommitSummaries;
  if (summaries > GITHUB_BUDGET_LIMITS.historyCommitSummaries)
    return limitFailure("history-summary-limit");
  const details =
    sumAttemptResource(records, "historyCommitDetails") +
    proposed.reserved.historyCommitDetails;
  if (details > GITHUB_BUDGET_LIMITS.historyCommitDetails)
    return limitFailure("history-detail-limit");

  const inputTokensUsed = records.reduce((sum, attempt) => {
    if (attempt.status === "committed" && attempt.actual)
      return sum + attempt.actual.inputTokens;
    if (attempt.status === "reserved" || attempt.status === "unknown")
      return sum + attempt.reserved.inputTokens;
    return sum;
  }, 0);
  const inputTokens = inputTokensUsed + proposed.reserved.inputTokens;
  if (
    proposed.reserved.inputTokens > GITHUB_BUDGET_LIMITS.inputTokensPerRequest
  )
    return limitFailure("input-tokens-request-limit");
  if (inputTokens > GITHUB_BUDGET_LIMITS.inputTokensPerImport)
    return limitFailure("input-tokens-import-limit");
  const generatedThisRequest =
    proposed.reserved.outputTokens + proposed.reserved.reasoningTokens;
  if (generatedThisRequest > GITHUB_BUDGET_LIMITS.generatedTokensPerRequest)
    return limitFailure("generated-tokens-request-limit");
  const generatedAcrossRun =
    records.reduce((sum, attempt) => {
      if (attempt.status === "committed" && attempt.actual)
        return (
          sum + attempt.actual.outputTokens + attempt.actual.reasoningTokens
        );
      if (attempt.status === "reserved" || attempt.status === "unknown")
        return (
          sum + attempt.reserved.outputTokens + attempt.reserved.reasoningTokens
        );
      return sum;
    }, 0) + generatedThisRequest;
  if (
    generatedAcrossRun >
    GITHUB_BUDGET_LIMITS.generatedTokensPerRequest *
      GITHUB_BUDGET_LIMITS.generationAttempts
  ) {
    return limitFailure("generated-tokens-request-limit");
  }
  if (
    proposed.reserved.historyCommitSummaries >
      GITHUB_BUDGET_LIMITS.historyCommitSummaries ||
    proposed.reserved.historyCommitDetails >
      GITHUB_BUDGET_LIMITS.historyCommitDetails
  )
    return failure("invalid-input", "invalid-attempt", SAFE_INVALID_MESSAGE);

  return {
    ok: true,
    value: {
      filesThisRequest: requestUsage.files,
      sourceLinesThisRequest: requestUsage.transmittedLines,
      uniqueSourceLinesAfter: totalUsage.uniqueLines,
      transmittedLineOccurrencesAfter: totalUsage.transmittedLines,
      charactersThisRequest: requestUsage.characters,
      charactersAfter: totalUsage.characters,
      inputTokensAfter: inputTokens,
    },
  };
}

function toSnapshot(state: InternalState): BudgetSnapshot {
  return {
    version: 1,
    createdAt: state.createdAt,
    inspectionDeadlineAt: state.inspectionDeadlineAt,
    extractionDeadlineAt: state.extractionDeadlineAt,
    operationDeadlineAt: state.operationDeadlineAt,
    attempts: [...state.attempts.values()].map(
      (attempt) => JSON.parse(JSON.stringify(attempt)) as BudgetAttemptSnapshot,
    ),
  };
}

/** Create the authoritative ledger for one import run. */
export function createBudgetLedger(
  config: BudgetLedgerConfig = {},
): BudgetLedger {
  const clock = config.now ?? Date.now;
  const state = createState(config);

  function reserve(input: BudgetAttemptInput): BudgetResult<{
    attemptId: string;
    kind: BudgetAttemptKind;
    status: "reserved" | "committed" | "unknown";
    created: boolean;
  }> {
    const normalized = normalizedAttempt(input);
    if (!normalized.ok) return normalized;
    const candidate = normalized.value;
    const signature = inputSignature(candidate);
    const existing = state.attempts.get(candidate.attemptId);
    if (existing) {
      if (
        inputSignature({
          attemptId: existing.attemptId,
          kind: existing.kind,
          consent: existing.consent,
          evidence: existing.evidence,
          reserved: existing.reserved,
        }) !== signature
      ) {
        return failure(
          "invalid-input",
          "reservation-conflict",
          SAFE_INVALID_MESSAGE,
        );
      }
      if (existing.status === "released")
        return failure(
          "invalid-input",
          "already-released",
          SAFE_INVALID_MESSAGE,
        );
      return {
        ok: true,
        value: {
          attemptId: existing.attemptId,
          kind: existing.kind,
          status: existing.status,
          created: false,
        },
      };
    }
    const projected: BudgetAttemptSnapshot = {
      ...candidate,
      status: "reserved",
      actual: null,
      commitSignature: null,
      commitError: null,
    };
    const admission = checkProjectedUsage(state, projected, clock());
    if (!admission.ok) return admission;
    if (
      (candidate.kind === "token-count" ||
        candidate.kind === "generation" ||
        candidate.kind === "recovery") &&
      state.extractionDeadlineAt === null
    ) {
      state.extractionDeadlineAt =
        clock() + GITHUB_BUDGET_LIMITS.extractionDeadlineMs;
    }
    state.attempts.set(candidate.attemptId, projected);
    return {
      ok: true,
      value: {
        attemptId: candidate.attemptId,
        kind: candidate.kind,
        status: "reserved",
        created: true,
      },
    };
  }

  function commitUsage(
    attemptId: string,
    usage: BudgetMeasuredUsage | { known: false },
  ): BudgetResult<{ idempotent: boolean; usageKnown: boolean }> {
    const attempt = state.attempts.get(attemptId);
    if (!attempt)
      return failure("not-found", "unknown-attempt", SAFE_INVALID_MESSAGE);
    if (attempt.status === "released")
      return failure("invalid-input", "already-released", SAFE_INVALID_MESSAGE);
    if ("known" in usage && usage.known === false) {
      const signature = stableStringify({ known: false });
      if (attempt.status === "committed" || attempt.status === "unknown") {
        if (attempt.commitSignature === signature)
          return {
            ok: true,
            value: {
              idempotent: true,
              usageKnown: attempt.status === "committed",
            },
          };
        return failure(
          "invalid-input",
          "reservation-conflict",
          SAFE_INVALID_MESSAGE,
        );
      }
      attempt.status = "unknown";
      attempt.commitSignature = signature;
      return { ok: true, value: { idempotent: false, usageKnown: false } };
    }
    const measured = measuredUsage(usage as BudgetMeasuredUsage);
    if (!measured.ok) return measured;
    const signature = stableStringify(measured.value);
    if (attempt.status === "committed") {
      if (attempt.commitSignature === signature) {
        if (attempt.commitError) return limitFailure(attempt.commitError);
        return { ok: true, value: { idempotent: true, usageKnown: true } };
      }
      return failure(
        "invalid-input",
        "reservation-conflict",
        SAFE_INVALID_MESSAGE,
      );
    }
    const http = attempt.kind === "github-http" || attempt.kind === "pr-http";
    const nonZeroHttpUsage =
      measured.value.upstreamBytes !== 0 ||
      measured.value.fetchedBodies.length > 0 ||
      measured.value.inventoryEntries !== 0 ||
      measured.value.inventoryDepth !== 0 ||
      measured.value.inventoryWireBytes !== 0 ||
      measured.value.historyCommitSummaries !== 0 ||
      measured.value.historyCommitDetails !== 0;
    const nonZeroTokenUsage =
      measured.value.inputTokens !== 0 ||
      measured.value.cachedInputTokens !== 0 ||
      measured.value.outputTokens !== 0 ||
      measured.value.reasoningTokens !== 0;
    const invalidPreflightUsage =
      attempt.kind === "token-count"
        ? nonZeroTokenUsage || measured.value.preflightInputTokens < 1
        : measured.value.preflightInputTokens !== 0;
    if (
      (http &&
        (nonZeroTokenUsage || measured.value.preflightInputTokens !== 0)) ||
      (!http && nonZeroHttpUsage) ||
      invalidPreflightUsage
    ) {
      return failure("invalid-input", "invalid-attempt", SAFE_INVALID_MESSAGE);
    }
    if (measured.value.inventoryWireBytes > measured.value.upstreamBytes) {
      return failure("invalid-input", "invalid-attempt", SAFE_INVALID_MESSAGE);
    }
    attempt.actual = measured.value;
    attempt.status = "committed";
    attempt.commitSignature = signature;
    const summary = buildSummary(state, clock());
    const hardLimit = measuredHardLimit(summary, attempt, measured.value);
    if (hardLimit) {
      attempt.commitError = hardLimit;
      return limitFailure(hardLimit);
    }
    const overrun = actualOverrunReason(attempt, measured.value);
    if (overrun) {
      attempt.commitError = overrun;
      return limitFailure(overrun);
    }
    return { ok: true, value: { idempotent: false, usageKnown: true } };
  }

  function release(
    attemptId: string,
    confirmNotSent: true,
  ): BudgetResult<{ released: boolean }> {
    if (confirmNotSent !== true)
      return failure(
        "invalid-input",
        "release-must-be-unsent",
        SAFE_INVALID_MESSAGE,
      );
    const attempt = state.attempts.get(attemptId);
    if (!attempt)
      return failure("not-found", "unknown-attempt", SAFE_INVALID_MESSAGE);
    if (attempt.status === "released")
      return { ok: true, value: { released: false } };
    if (attempt.status !== "reserved")
      return failure(
        "invalid-input",
        "release-must-be-unsent",
        SAFE_INVALID_MESSAGE,
      );
    attempt.status = "released";
    return { ok: true, value: { released: true } };
  }

  function checkSelection(input: {
    files: readonly BudgetEvidenceInput[];
    estimatedInputTokens?: number;
  }): BudgetResult<BudgetSelectionSummary> {
    if (
      input.estimatedInputTokens !== undefined &&
      !isNonNegativeInteger(input.estimatedInputTokens)
    ) {
      return failure("invalid-input", "invalid-attempt", SAFE_INVALID_MESSAGE);
    }
    const evidence = normalizeEvidence(input.files);
    if (!evidence.ok) return evidence;
    const proposed: BudgetAttemptSnapshot = {
      attemptId: "selection-check",
      kind: "generation",
      consent: null,
      evidence: evidence.value,
      reserved: {
        ...emptyReservation(),
        inputTokens: input.estimatedInputTokens ?? 0,
      },
      status: "reserved",
      actual: null,
      commitSignature: null,
      commitError: null,
    };
    return checkProjectedUsage(state, proposed, clock());
  }

  return {
    reserve,
    commitUsage,
    release,
    checkSelection,
    remaining: () => buildSummary(state, clock()),
    snapshot: () => toSnapshot(state),
  };
}
