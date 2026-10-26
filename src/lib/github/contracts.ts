import type { ReactNode } from "react";
import { z } from "zod";

/** Shared contracts for the GitHub evidence-import feature. */
export const GITHUB_IMPORT_CONTRACT_VERSION = 1 as const;
export const GITHUB_IMPORT_SAFETY_POLICY_VERSION = "github-safety-v1" as const;
export const GITHUB_IMPORT_SELECTOR_VERSION =
  "contribution-selector-v1" as const;
export const GITHUB_IMPORT_PROMPT_VERSION = "repository-extraction-v1" as const;

export const GITHUB_IMPORT_POLICY = Object.freeze({
  targetFiles: { min: 8, max: 10 },
  targetInitialLines: { min: 600, max: 900 },
  filesPerRequest: 12,
  linesPerRequest: 1_500,
  linesPerFilePerRequest: 200,
  distinctFilesPerImport: 16,
  uniqueLinesPerImport: 2_000,
  uniqueLinesPerFile: 300,
  transmittedLineOccurrences: 3_000,
  fetchedBodies: 20,
  httpAttempts: 32,
  pullRequestHttpAttempts: 8,
  selectedPullRequestsForExtraction: 3,
  pullRequestTitleCharacters: 160,
  pullRequestDescriptionCharacters: 1_000,
  pullRequestContextTokens: 1_200,
  historyCommitSummaries: 20,
  historyCommitDetails: 3,
  redirects: 2,
  githubRequestConcurrency: 1,
  totalUpstreamBytes: 12 * 1024 * 1024,
  fetchedFileBytes: 64 * 1024,
  selectedCharactersPerFile: 12_000,
  selectedCharactersTotal: 80_000,
  inputTokensPerRequest: 24_000,
  inputTokensPerImport: 36_000,
  generatedTokensPerRequest: 6_144,
  draftPoints: 8,
  claims: 12,
  metricCandidates: 8,
  generationAttempts: 2,
  inspectionDeadlineMs: 60_000,
  extractionDeadlineMs: 120_000,
  stageRetentionMs: 24 * 60 * 60 * 1_000,
  cacheCapacityBytes: 50 * 1024 * 1024,
  deferredMeasurementRetentionMs: 30 * 24 * 60 * 60 * 1_000,
});

const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const sha = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i);
const utc = z.string().datetime();
const shortText = z.string().trim().min(1).max(500);
const longText = z.string().trim().min(1).max(8_000);

function isSafeRepositoryPath(path: string) {
  if (
    !path ||
    path.length > 1_024 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(path)
  ) {
    return false;
  }

  let decoded = path;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return false;
    }
  }

  if (decoded.startsWith("/") || decoded.includes("\\")) return false;
  const segments = decoded.split("/");
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      !/^[a-z]:/iu.test(segment) &&
      !/[\u0000-\u001f\u007f]/u.test(segment),
  );
}

export const RepositoryPathSchema = z
  .string()
  .max(1_024)
  .refine(isSafeRepositoryPath, "Repository paths must be relative and safe.");

export const DomainErrorCodeSchema = z.enum([
  "invalid-input",
  "forbidden",
  "unavailable",
  "not-found",
  "version-conflict",
  "limit-exceeded",
  "rate-limited",
  "needs-context",
  "invalid-evidence",
  "io-error",
  "cancelled",
  "interrupted",
  "upstream-error",
]);

export const DomainErrorSchema = z
  .object({
    code: DomainErrorCodeSchema,
    message: z.string().trim().min(1).max(500),
    retryable: z.boolean(),
    retryAfterSeconds: z.number().int().nonnegative().optional(),
    fieldErrors: z.record(z.string(), z.array(z.string().max(250))).optional(),
  })
  .strict();

export const DOMAIN_ERROR_HTTP_STATUS: Record<DomainErrorCode, number> = {
  "invalid-input": 400,
  forbidden: 403,
  "not-found": 404,
  "version-conflict": 409,
  cancelled: 409,
  interrupted: 409,
  "limit-exceeded": 413,
  "invalid-evidence": 422,
  "needs-context": 422,
  "rate-limited": 429,
  unavailable: 503,
  "io-error": 503,
  "upstream-error": 502,
};

export type DomainErrorCode = z.infer<typeof DomainErrorCodeSchema>;
export type DomainError = z.infer<typeof DomainErrorSchema>;
export type Result<T> =
  { ok: true; value: T } | { ok: false; error: DomainError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(error: DomainError): Result<T> {
  return { ok: false, error };
}

export function unavailableError(
  message = "GitHub import is not available in this build.",
): DomainError {
  return { code: "unavailable", message, retryable: false };
}

export type ImportLifecycle =
  | "created"
  | "preparing"
  | "ready-to-analyze"
  | "queued"
  | "analyzing"
  | "ready-to-review"
  | "approved"
  | "needs-input"
  | "partial"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "expired";

export type JobState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "needs-input";

export const RepositoryScopeSchema = z
  .object({
    repositoryId: z.string().regex(/^\d{1,30}$/),
    owner: shortText.max(100),
    name: shortText.max(100),
    canonicalUrl: z
      .string()
      .url()
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            url.protocol === "https:" &&
            url.hostname === "github.com" &&
            !url.username &&
            !url.password &&
            !url.port &&
            url.pathname.split("/").filter(Boolean).length === 2 &&
            !url.search &&
            !url.hash
          );
        } catch {
          return false;
        }
      }, "Use a canonical HTTPS GitHub repository URL."),
    visibility: z.enum(["public", "private"]),
    ref: shortText.max(255),
    commitSha: sha,
    packagePath: RepositoryPathSchema.optional(),
    selectedPullRequestNumbers: z.array(z.number().int().positive()).max(30),
    selectedPaths: z.array(RepositoryPathSchema).max(100),
    contributionStatement: z.string().trim().min(1).max(2_000),
    identitySource: z.enum(["github-account", "user-provided", "unknown"]),
  })
  .strict();
export type RepositoryScope = z.infer<typeof RepositoryScopeSchema>;

export const RepositorySummarySchema = z
  .object({
    repositoryId: z.string().regex(/^\d{1,30}$/),
    owner: shortText.max(100),
    name: shortText.max(100),
    canonicalUrl: z.string().url(),
    visibility: z.enum(["public", "private"]),
    defaultBranch: shortText.max(255).nullable(),
    permission: z.enum(["read", "write", "admin", "unknown"]),
  })
  .strict();
export type RepositorySummary = z.infer<typeof RepositorySummarySchema>;

export const PullRequestSummarySchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string().max(160),
    state: z.enum(["open", "closed", "merged", "unknown"]),
    authorLogin: z.string().max(100).nullable(),
    updatedAt: utc.nullable(),
    changedPaths: z.array(RepositoryPathSchema).max(100),
    headSha: sha.nullable(),
    baseSha: sha.nullable(),
    selected: z.boolean(),
  })
  .strict();
export type PullRequestSummary = z.infer<typeof PullRequestSummarySchema>;

export const FileCandidateSchema = z
  .object({
    id,
    path: RepositoryPathSchema,
    blobSha: sha,
    mode: z.enum(["100644", "100755", "120000", "160000"]),
    byteSize: z.number().int().nonnegative(),
    category: z.enum([
      "purpose",
      "manifest",
      "implementation",
      "test",
      "report",
      "documentation",
      "other",
    ]),
    reasonCodes: z.array(shortText.max(80)).max(20),
    safety: z.enum(["safe", "blocked", "needs-review"]),
    eligible: z.boolean(),
    selected: z.boolean(),
    pinned: z.boolean(),
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.eligible && candidate.safety !== "safe") {
      context.addIssue({
        code: "custom",
        path: ["eligible"],
        message: "Only safe candidates can be eligible.",
      });
    }
    if ((candidate.selected || candidate.pinned) && !candidate.eligible) {
      context.addIssue({
        code: "custom",
        path: ["selected"],
        message: "Blocked or ineligible candidates cannot be selected.",
      });
    }
  });
export type FileCandidate = z.infer<typeof FileCandidateSchema>;

export const EvidencePointerSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("lines"),
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive(),
    })
    .strict()
    .refine((pointer) => pointer.endLine >= pointer.startLine),
  z
    .object({
      kind: z.literal("report-fields"),
      fields: z.array(shortText).min(1).max(50),
    })
    .strict(),
]);

export const EvidenceItemSchema = z
  .object({
    id,
    snapshotId: id,
    commitSha: sha,
    path: RepositoryPathSchema,
    blobSha: sha,
    pointer: EvidencePointerSchema,
    excerpt: z.string().max(20_000),
    excerptSha256: sha256,
    category: FileCandidateSchema.shape.category,
    classification: z.enum([
      "observed",
      "documented",
      "user-provided",
      "inferred",
    ]),
  })
  .strict();
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const BudgetSummarySchema = z
  .object({
    fetchedFiles: z.number().int().nonnegative(),
    fetchedBytes: z.number().int().nonnegative(),
    httpAttempts: z.number().int().nonnegative(),
    selectedUniqueFiles: z.number().int().nonnegative(),
    selectedUniqueLines: z.number().int().nonnegative(),
    selectedCharacters: z.number().int().nonnegative(),
    transmittedLinesByRequest: z.array(z.number().int().nonnegative()).max(2),
    cumulativeTransmittedLines: z.number().int().nonnegative(),
    estimatedInputTokens: z.number().int().nonnegative().nullable(),
    reportedInputTokens: z.number().int().nonnegative().nullable(),
    limitReason: z.string().max(250).nullable(),
  })
  .strict();
export type BudgetSummary = z.infer<typeof BudgetSummarySchema>;

export const PreparedSelectionSchema = z
  .object({
    importId: id,
    runId: id,
    version: z.number().int().positive(),
    selectionHash: sha256,
    scope: RepositoryScopeSchema,
    selectedFileIds: z.array(id).max(GITHUB_IMPORT_POLICY.filesPerRequest),
    evidence: z.array(EvidenceItemSchema).max(300),
    limitations: z.array(z.string().max(500)).max(100),
    completeness: z.enum(["complete", "partial", "needs-context"]),
    budget: BudgetSummarySchema,
    providerDisclosure: z.string().trim().min(1).max(1_000),
    consentedAt: utc.nullable(),
  })
  .strict();
export type PreparedSelection = z.infer<typeof PreparedSelectionSchema>;

export const ContributionClaimSchema = z
  .object({
    id,
    text: z.string().trim().min(1).max(8_000),
    evidenceIds: z.array(id).max(50),
    userStatementIds: z.array(id).max(20),
    classification: z.enum([
      "observed",
      "documented",
      "user-provided",
      "inferred",
    ]),
    confirmedByUser: z.boolean(),
    confirmationVersion: z.number().int().positive().nullable(),
    limitations: z.array(z.string().max(500)).max(30),
  })
  .strict();
export type ContributionClaim = z.infer<typeof ContributionClaimSchema>;

export const DraftEditSchema = z
  .object({
    draftId: id,
    version: z.number().int().positive(),
    baseResultHash: sha256,
    text: z.string().trim().min(1).max(8_000),
    selectedForSave: z.boolean(),
    contributionConfirmed: z.boolean(),
    confirmedMetricResultIds: z
      .array(id)
      .max(GITHUB_IMPORT_POLICY.metricCandidates),
    updatedAt: utc,
  })
  .strict();
export type DraftEdit = z.infer<typeof DraftEditSchema>;

export const DraftSchema = z
  .object({
    id,
    version: z.number().int().positive(),
    projectId: id,
    text: z.string().trim().min(1).max(8_000),
    reviewedBaseText: z.string().trim().min(1).max(8_000),
    claimIds: z.array(id).max(GITHUB_IMPORT_POLICY.claims),
    supportStatus: z.enum([
      "supported",
      "needs-context",
      "partial",
      "unsupported",
    ]),
    selectedForSave: z.boolean(),
    contributionConfirmed: z.boolean(),
    metricResultIds: z.array(id).max(GITHUB_IMPORT_POLICY.metricCandidates),
    approvalEligible: z.boolean(),
    approvalErrors: z.array(z.string().max(500)).max(30),
  })
  .strict();
export type Draft = z.infer<typeof DraftSchema>;

export const ImportRecordSchema = z
  .object({
    id,
    version: z.number().int().positive(),
    source: z.enum(["personal", "demo"]),
    destinationProjectId: id,
    authorizationNamespaceHash: sha256,
    scope: RepositoryScopeSchema,
    selectionVersion: z.number().int().positive(),
    selectionHash: sha256.nullable(),
    lifecycle: z.enum([
      "created",
      "preparing",
      "ready-to-analyze",
      "queued",
      "analyzing",
      "ready-to-review",
      "approved",
      "needs-input",
      "partial",
      "failed",
      "cancelled",
      "interrupted",
      "expired",
    ]),
    activeRunId: id.nullable(),
    consent: z
      .object({
        reference: id,
        selectionVersion: z.number().int().positive(),
        selectionHash: sha256,
        consentedAt: utc,
      })
      .strict()
      .nullable(),
    preparedSelectionRef: sha256.nullable(),
    resultRef: sha256.nullable(),
    draftRefs: z.array(id).max(100),
    draftEdits: z.array(DraftEditSchema).max(GITHUB_IMPORT_POLICY.draftPoints),
    savedIds: z.array(id).max(100),
    retentionDeadline: utc,
    createdAt: utc,
    updatedAt: utc,
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.consent &&
      record.selectionHash !== record.consent.selectionHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["consent"],
        message: "Consent must match the current selection hash.",
      });
    }
    if (
      record.consent &&
      record.selectionVersion !== record.consent.selectionVersion
    ) {
      context.addIssue({
        code: "custom",
        path: ["consent"],
        message: "Consent must match the current selection version.",
      });
    }
  });
export type ImportRecord = z.infer<typeof ImportRecordSchema>;

export const NotificationOutboxEventSchema = z
  .object({
    id,
    importId: id,
    projectId: id,
    jobId: id,
    type: z.enum(["ready", "needs-input", "failed", "expired"]),
    createdAt: utc,
    destination: z.string().regex(/^\/library\/github\/[a-z0-9-]+$/),
  })
  .strict();
export type NotificationOutboxEvent = z.infer<
  typeof NotificationOutboxEventSchema
>;

export const JobRecordSchema = z
  .object({
    id,
    runId: id,
    importId: id,
    importVersion: z.number().int().positive(),
    idempotencyKeyHash: sha256,
    kind: z.enum(["prepare", "analyze"]),
    state: z.enum([
      "queued",
      "running",
      "completed",
      "failed",
      "cancelled",
      "interrupted",
      "needs-input",
    ]),
    stage: shortText.max(80),
    inputHash: sha256,
    consentHash: sha256.nullable(),
    executionFence: z.number().int().nonnegative(),
    lease: z
      .object({ owner: id, expiresAt: utc, fence: z.number().int().positive() })
      .strict()
      .nullable(),
    checkpoint: z.record(z.string(), z.unknown()).nullable(),
    cancellationRequestedAt: utc.nullable(),
    deadline: utc,
    usage: BudgetSummarySchema,
    error: DomainErrorSchema.nullable(),
    resultRef: sha256.nullable(),
    outboxEvents: z.array(NotificationOutboxEventSchema).max(20),
    createdAt: utc,
    updatedAt: utc,
  })
  .strict();
export type JobRecord = z.infer<typeof JobRecordSchema>;

export const NotificationSchema = NotificationOutboxEventSchema.extend({
  readAt: utc.nullable(),
  dismissedAt: utc.nullable(),
}).strict();
export type Notification = z.infer<typeof NotificationSchema>;

export const MetricDefinitionSchema = z
  .object({
    id,
    version: z.number().int().positive(),
    capability: shortText.max(100),
    task: shortText.max(100),
    quantity: shortText.max(100),
    unit: shortText.max(40),
    statistic: shortText.max(60),
    direction: z.enum(["higher-is-better", "lower-is-better", "neutral"]),
    allowedRange: z
      .object({ min: z.number().finite(), max: z.number().finite() })
      .strict(),
    requiredContext: z.array(shortText.max(120)).max(30),
    calculatorId: id.nullable(),
    rendererId: id,
    recipeId: id.nullable(),
  })
  .strict();
export type MetricDefinition = z.infer<typeof MetricDefinitionSchema>;
export type MeasurementDefinition = MetricDefinition;

export const MeasurementAnswerSchema = z
  .object({
    questionId: id,
    version: z.number().int().positive(),
    mode: z.enum(["result", "report", "target", "skip", "defer"]),
    originalValues: z.array(z.number().finite()).max(20),
    originalUnits: z.array(shortText.max(40)).max(20),
    definitionId: id.nullable(),
    statistic: shortText.max(60).nullable(),
    context: z.record(z.string(), z.string().max(500)),
    sourceEvidenceIds: z.array(id).max(30),
    attestation: z.enum([
      "measured",
      "user-attested",
      "documented",
      "target",
      "estimate",
      "none",
    ]),
    answerHash: sha256,
  })
  .strict()
  .superRefine((answer, context) => {
    if (answer.originalValues.length !== answer.originalUnits.length) {
      context.addIssue({
        code: "custom",
        path: ["originalUnits"],
        message: "Each original value must retain its original unit.",
      });
    }
    if (answer.mode === "target" && answer.attestation !== "target") {
      context.addIssue({
        code: "custom",
        path: ["attestation"],
        message: "A target answer must remain labeled as a target.",
      });
    }
    if (
      (answer.mode === "result" || answer.mode === "report") &&
      (answer.attestation === "target" || answer.attestation === "estimate")
    ) {
      context.addIssue({
        code: "custom",
        path: ["attestation"],
        message:
          "Targets and estimates cannot be accepted as measured results.",
      });
    }
    if (
      (answer.mode === "skip" || answer.mode === "defer") &&
      answer.originalValues.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["originalValues"],
        message: "Skip and defer answers cannot carry achieved values.",
      });
    }
  });
export type MeasurementAnswer = z.infer<typeof MeasurementAnswerSchema>;

export const MeasurementResultSchema = z
  .object({
    id,
    definitionId: id,
    version: z.number().int().positive(),
    originalValues: z.array(z.number().finite()).min(1).max(20),
    originalUnits: z.array(shortText.max(40)).min(1).max(20),
    normalizedValues: z.array(z.number().finite()).min(1).max(20),
    normalizedUnit: shortText.max(40),
    context: z.record(z.string(), z.string().max(500)),
    evidenceStatus: z.enum(["measured", "user-attested", "documented", "none"]),
    formulaVersion: shortText.max(80).nullable(),
    roundingPolicy: shortText.max(80).nullable(),
    derivedQuantity: z.number().finite().nullable(),
    rendererId: id,
    previewHash: sha256,
    confirmed: z.boolean(),
  })
  .strict();
export type MeasurementResult = z.infer<typeof MeasurementResultSchema>;

export const AnalysisResultSchema = z
  .object({
    summary: z.string().max(4_000),
    claims: z.array(ContributionClaimSchema).max(GITHUB_IMPORT_POLICY.claims),
    drafts: z.array(DraftSchema).max(GITHUB_IMPORT_POLICY.draftPoints),
    questionSuggestions: z.array(id).max(20),
    limitations: z.array(z.string().max(500)).max(100),
    model: z.string().max(200).nullable(),
    finishReason: z.string().max(100).nullable(),
    usage: z
      .object({
        promptTokens: z.number().int().nonnegative().nullable(),
        cachedTokens: z.number().int().nonnegative().nullable(),
        outputTokens: z.number().int().nonnegative().nullable(),
        reasoningTokens: z.number().int().nonnegative().nullable(),
        totalTokens: z.number().int().nonnegative().nullable(),
      })
      .strict(),
    selectionHash: sha256,
  })
  .strict();
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export const ImportCacheIdentitySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("safe-content"),
      repositoryId: z.string().regex(/^\d{1,30}$/),
      blobSha: sha,
      parserVersion: shortText.max(100),
      safetyPolicyVersion: shortText.max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal("selected-bundle"),
      repositoryId: z.string().regex(/^\d{1,30}$/),
      commitSha: sha,
      sourceHashes: z.array(sha).min(1).max(100),
      selectedFileIds: z
        .array(id)
        .min(1)
        .max(GITHUB_IMPORT_POLICY.filesPerRequest),
      selectionHash: sha256,
      scope: RepositoryScopeSchema,
      contributionContextHash: sha256,
      selectorVersion: shortText.max(100),
      safetyPolicyVersion: shortText.max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal("extraction-result"),
      repositoryId: z.string().regex(/^\d{1,30}$/),
      commitSha: sha,
      sourceHashes: z.array(sha).min(1).max(100),
      selectionHash: sha256,
      scope: RepositoryScopeSchema,
      contributionContextHash: sha256,
      selectorVersion: shortText.max(100),
      promptVersion: shortText.max(100),
      schemaVersion: shortText.max(100),
      model: shortText.max(200),
      settingsHash: sha256,
      safetyPolicyVersion: shortText.max(100),
    })
    .strict(),
]);
export type ImportCacheIdentity = z.infer<typeof ImportCacheIdentitySchema>;

export const ImportCacheValueSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("safe-content"),
      files: z
        .array(
          z
            .object({
              fileId: id,
              path: RepositoryPathSchema,
              blobSha: sha,
              content: z.string().max(GITHUB_IMPORT_POLICY.fetchedFileBytes),
            })
            .strict(),
        )
        .max(GITHUB_IMPORT_POLICY.distinctFilesPerImport),
    })
    .strict(),
  z
    .object({
      kind: z.literal("selected-bundle"),
      prepared: PreparedSelectionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("extraction-result"),
      result: AnalysisResultSchema,
    })
    .strict(),
]);
export type ImportCacheValue = z.infer<typeof ImportCacheValueSchema>;

export const ImportCacheEntrySchema = z
  .object({
    key: sha256,
    authorizationNamespaceHash: sha256,
    identity: ImportCacheIdentitySchema,
    value: ImportCacheValueSchema,
    valueHash: sha256,
    createdAt: utc,
    expiresAt: utc,
    byteSize: z.number().int().positive(),
  })
  .strict();
export type ImportCacheEntry = z.infer<typeof ImportCacheEntrySchema>;

export const BudgetSnapshotSchema = z
  .object({
    requests: z.number().int().nonnegative(),
    pullRequestRequests: z.number().int().nonnegative(),
    fetchedBodies: z.number().int().nonnegative(),
    fetchedBytes: z.number().int().nonnegative(),
    uniqueFiles: z.number().int().nonnegative(),
    uniqueLines: z.number().int().nonnegative(),
    transmittedLines: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    generationAttempts: z.number().int().nonnegative(),
  })
  .strict();
export type BudgetSnapshot = z.infer<typeof BudgetSnapshotSchema>;

export interface BudgetLedgerRef {
  reserve(input: {
    operation: string;
    amount: number;
  }): Promise<Result<{ reservationId: string }>>;
  commitUsage(input: {
    reservationId: string;
    actual: number | null;
  }): Promise<Result<BudgetSnapshot>>;
  checkSelection(input: {
    files: number;
    lines: number;
  }): Result<{ allowed: boolean; reason: string | null }>;
  remaining(): Result<BudgetSnapshot>;
  snapshot(): Result<BudgetSnapshot>;
}

export interface ExecutionContext {
  personalRoot: string;
  access: {
    sessionId: string;
    authorizationNamespace: string;
    accountId: string | null;
    grantedRepositoryIds: string[];
  };
  signal: AbortSignal;
  now: () => Date;
  runId: string;
  deadline: string;
  budget: BudgetLedgerRef;
}

export const ImportQuestionSchema = z
  .object({
    id,
    version: z.number().int().positive(),
    draftId: id,
    kind: z.enum(["contribution", "measurement"]),
    prompt: z.string().trim().min(1).max(1_000),
    required: z.boolean(),
    definitionId: id.nullable(),
    choices: z.array(shortText.max(150)).max(20),
    answered: z.boolean(),
  })
  .strict();
export type ImportQuestion = z.infer<typeof ImportQuestionSchema>;

export const ImportReviewStateSchema = z
  .object({
    import: ImportRecordSchema,
    prepared: PreparedSelectionSchema.nullable(),
    result: AnalysisResultSchema.nullable(),
    questions: z.array(ImportQuestionSchema).max(40),
    measurementResults: z.array(MeasurementResultSchema).max(40),
    canSaveDraftIds: z.array(id).max(8),
    expired: z.boolean(),
  })
  .strict();
export type ImportReviewState = z.infer<typeof ImportReviewStateSchema>;

export const DeferredMeasurementTaskSchema = z
  .object({
    id,
    version: z.number().int().positive(),
    projectId: id,
    draftId: id,
    claimContext: z.string().trim().min(1).max(2_000),
    questionId: id,
    questionVersion: z.number().int().positive(),
    definitionIds: z.array(id).max(10),
    createdAt: utc,
    retentionDeadline: utc,
  })
  .strict();
export type DeferredMeasurementTask = z.infer<
  typeof DeferredMeasurementTaskSchema
>;

/* ------------------------------ UI contracts ----------------------------- */

export type ConnectionState =
  "connected" | "disconnected" | "connecting" | "error";
export type ImportStep = "setup" | "analysis" | "review";
export type SaveState = "idle" | "saving" | "saved" | "error";

export interface ProjectOption {
  id: string;
  name: string;
}

export interface RepositorySetupProps {
  repositories: RepositorySummary[];
  selectedRepositoryId: string | null;
  projects: ProjectOption[];
  selectedProjectId: string | null;
  connectionState: ConnectionState;
  role: string;
  pullRequests: PullRequestSummary[];
  selectedPullRequestNumbers: number[];
  ready: boolean;
  error: DomainError | null;
  onConnect(): void;
  onRepositoryChange(repositoryId: string | null): void;
  onDestinationChange(projectId: string | null): void;
  onRoleChange(role: string): void;
  onPrSelectionChange(numbers: number[]): void;
}

export interface EvidencePanelProps {
  candidates: FileCandidate[];
  selectedIds: string[];
  pinnedIds: string[];
  excerpts: EvidenceItem[];
  limitations: string[];
  budget: BudgetSummary;
  onPin(fileId: string): void;
  onRemove(fileId: string): void;
  onInspect(fileId: string): void;
}

export interface AchievementReviewProps {
  drafts: Draft[];
  selectedIds: string[];
  contributionConfirmations: Record<string, boolean>;
  supportDetails: Record<string, string>;
  onTextChange(draftId: string, text: string, expectedVersion: number): void;
  onSelect(draftId: string, selected: boolean): void;
  onConfirmContribution(draftId: string, confirmed: boolean): void;
  onReject(draftId: string): void;
  onExpandMeasurement(draftId: string): void;
}

export interface MeasurementFieldsProps {
  questions: ImportQuestion[];
  answers: Record<string, MeasurementAnswer | undefined>;
  validation: Record<string, string[] | undefined>;
  previews: Record<string, MeasurementResult | undefined>;
  onAnswer(questionId: string, answer: MeasurementAnswer): void;
  onSkip(questionId: string, version: number): void;
  onDefer(questionId: string, version: number): void;
}

export interface ImportTrustRailProps {
  safetySummary: string[];
  runIdentity: { importId: string; runId: string | null; revision: string };
  budget: BudgetSummary;
  cost: {
    estimate: number | null;
    currency: string | null;
    uncertainty: string | null;
  };
  eligibleCount: number;
  selectedCount: number;
  saveState: SaveState;
  errors: DomainError[];
  onSave(): void;
  onDiscard(): void;
  onBack(): void;
}

export interface AnalysisStatusProps {
  state: ImportLifecycle;
  stage: string;
  createdAt: string;
  updatedAt: string;
  cancellationAvailable: boolean;
  retryAvailable: boolean;
  resumeAvailable: boolean;
  error: DomainError | null;
  onCancel(): void;
  onRetry(): void;
  onResumeSetup(): void;
}

export interface ImportNotificationsProps {
  items: Notification[];
  unreadCount: number;
  onRead(notificationId: string): void;
  onDismiss?: (notificationId: string) => void;
  onReview(notificationId: string): void;
}

export interface ImportLayoutProps {
  header: ReactNode;
  progress: ReactNode;
  main: ReactNode;
  rail?: ReactNode;
  actions?: ReactNode;
  state: ImportStep;
}

export interface ImportButtonProps {
  label: string;
  disabled?: boolean;
  busy?: boolean;
  variant?: "primary" | "secondary" | "quiet";
  onClick?: () => void;
}

export interface ImportStatusPillProps {
  state: ImportLifecycle;
  label: string;
}

export interface ImportInfoBannerProps {
  title: string;
  description: string;
  tone?: "info" | "warning" | "success" | "error";
}

export interface EvidenceChipProps {
  label: string;
  category: FileCandidate["category"];
  state?: "included" | "pinned" | "blocked";
}

export interface ImportWorkspaceProps {
  source: "personal" | "demo";
  importId: string | null;
  routeState: ImportStep;
  initialState: ImportReviewState | null;
  client: import("./ports").ImportClientPort;
}

export type GithubImportHarnessComponent =
  | "RepositorySetup"
  | "EvidencePanel"
  | "AchievementReview"
  | "MeasurementFields"
  | "ImportTrustRail"
  | "AnalysisStatus"
  | "ImportNotifications"
  | "ImportLayout";
