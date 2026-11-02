import type {
  AnalysisResult,
  BudgetLedgerRef,
  BudgetSnapshot,
  BudgetSummary,
  ContributionClaim,
  DeferredMeasurementTask,
  DomainError,
  Draft,
  EvidenceItem,
  ExecutionContext,
  FileCandidate,
  ImportQuestion,
  ImportRecord,
  ImportCacheEntry,
  ImportCacheIdentity,
  ImportCacheValue,
  ImportReviewState,
  JobRecord,
  MeasurementAnswer,
  MeasurementDefinition,
  MeasurementResult,
  Notification,
  NotificationOutboxEvent,
  PreparedSelection,
  PullRequestSummary,
  RepositoryScope,
  RepositorySummary,
  Result,
} from "./contracts";

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface GithubHttpResponse {
  status: number;
  headers: {
    etag: string | null;
    rateLimitRemaining: number | null;
    rateLimitReset: string | null;
    retryAfterSeconds: number | null;
  };
  body: JsonValue;
  requestId: string | null;
}
export interface GithubTextResponse extends Omit<GithubHttpResponse, "body"> {
  text: string;
}

export interface GithubClientPort {
  getJson(input: {
    path: string;
    query?: Record<string, string>;
    context: ExecutionContext;
  }): Promise<Result<GithubHttpResponse>>;
  getText(input: {
    path: string;
    query?: Record<string, string>;
    context: ExecutionContext;
  }): Promise<Result<GithubTextResponse>>;
}
export type GithubClientFactory = (deps: {
  fetch: typeof fetch;
  apiOrigin: string;
  now: () => Date;
}) => GithubClientPort;

export interface GithubAccessPort {
  beginConnection(
    input: { returnTo: string },
    context: ExecutionContext,
  ): Promise<Result<{ authorizationUrl: string; state: string }>>;
  completeAuthorization(
    input: { code: string; state: string },
    context: ExecutionContext,
  ): Promise<Result<{ accountId: string; connectedAt: string }>>;
  listAccessibleRepositories(
    input: { cursor?: string | null },
    context: ExecutionContext,
  ): Promise<
    Result<{ repositories: RepositorySummary[]; nextCursor: string | null }>
  >;
  authorizeRepository(
    input: { repositoryId: string },
    context: ExecutionContext,
  ): Promise<Result<{ scope: RepositoryScope }>>;
  disconnect(
    input: { cancelActiveJobs: boolean },
    context: ExecutionContext,
  ): Promise<
    Result<{
      disconnected: true;
      upstreamRevocation: "requested" | "not-requested" | "unknown";
    }>
  >;
}
export type GithubAccessFactory = (deps: {
  credentials: CredentialPort;
  github: GithubClientPort;
  now: () => Date;
}) => GithubAccessPort;

export interface CredentialPort {
  read(input: {
    authorizationNamespace: string;
  }): Promise<Result<{ credentialHandle: string; accountId: string }>>;
  write(input: {
    authorizationNamespace: string;
    credentialHandle: string;
    accountId: string;
  }): Promise<Result<{ stored: true }>>;
  delete(input: {
    authorizationNamespace: string;
  }): Promise<Result<{ deleted: true }>>;
}

export interface RepositoryInspectorPort {
  resolveSnapshot(input: {
    scope: RepositoryScope;
    context: ExecutionContext;
  }): Promise<
    Result<{
      snapshotId: string;
      repositoryId: string;
      commitSha: string;
      treeSha: string;
      observedAt: string;
      completeness: "complete" | "partial";
      limitations: string[];
    }>
  >;
  inventory(input: {
    snapshot: RepositorySnapshot;
    context: ExecutionContext;
  }): Promise<
    Result<{
      candidates: FileCandidate[];
      completeness: "complete" | "partial";
      limitations: string[];
    }>
  >;
  readSelectedFiles(input: {
    snapshot: RepositorySnapshot;
    candidates: FileCandidate[];
    context: ExecutionContext;
  }): Promise<
    Result<{
      files: Array<{
        fileId: string;
        path: string;
        blobSha: string;
        content: string;
      }>;
    }>
  >;
}
export type RepositorySnapshot = {
  snapshotId: string;
  repositoryId: string;
  commitSha: string;
  treeSha: string;
  observedAt: string;
  completeness: "complete" | "partial";
  limitations: string[];
};
export type RepositoryInspectorFactory = (deps: {
  github: GithubClientPort;
  access: GithubAccessPort;
}) => RepositoryInspectorPort;

export interface PrContextReaderPort {
  listCandidates(input: {
    scope: RepositoryScope;
    context: ExecutionContext;
  }): Promise<
    Result<{
      candidates: PullRequestSummary[];
      completeness: "complete" | "partial";
      limitations: string[];
    }>
  >;
  readSelected(input: {
    scope: RepositoryScope;
    selectedNumbers: number[];
    context: ExecutionContext;
  }): Promise<
    Result<{
      selected: PullRequestSummary[];
      completeness: "complete" | "partial";
      limitations: string[];
    }>
  >;
}
export type PrContextReaderFactory = (deps: {
  github: GithubClientPort;
  access: GithubAccessPort;
}) => PrContextReaderPort;

export interface EvidenceSelectorPort {
  select(input: {
    inventory: FileCandidate[];
    scope: RepositoryScope;
    prContext: PullRequestSummary[];
    pinnedFileIds: string[];
    removedFileIds?: string[];
    context: ExecutionContext;
  }): Promise<
    Result<{
      selected: FileCandidate[];
      missingDimensions: string[];
      limitations: string[];
    }>
  >;
  pack(input: {
    importId: string;
    selectionVersion: number;
    scope: RepositoryScope;
    selected: FileCandidate[];
    contentByFileId: Record<string, string>;
    limitations: string[];
    completeness: PreparedSelection["completeness"];
    context: ExecutionContext;
  }): Promise<Result<PreparedSelection>>;
}
export type EvidenceSelectorFactory = (deps: {
  policy: SelectionPolicyPort;
  budget: BudgetLedgerRef;
}) => EvidenceSelectorPort;

export interface BudgetLedgerPort extends BudgetLedgerRef {
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
export type BudgetLedgerFactory = (config: {
  limits?: Partial<BudgetSnapshot>;
  deadline: string;
  now: () => Date;
}) => BudgetLedgerPort;

export interface ImportStorePort {
  create(
    input: {
      source: "personal" | "demo";
      destinationProjectId: string;
      scope: RepositoryScope;
    },
    context: ExecutionContext,
  ): Promise<Result<ImportRecord>>;
  get(
    input: { id: string },
    context: ExecutionContext,
  ): Promise<Result<ImportRecord>>;
  completePreparation(
    input: {
      id: string;
      expectedVersion: number;
      runId: string;
      selectionVersion: number;
      selectionHash: string;
      preparedSelectionRef: string;
      candidateInventoryRef: string;
    },
    context: ExecutionContext,
  ): Promise<Result<ImportRecord>>;
  completeAnalysis(
    input: {
      id: string;
      expectedVersion: number;
      runId: string;
      selectionVersion: number;
      selectionHash: string;
      resultRef: string;
      draftRefs: string[];
      reviewHistory: ImportRecord["reviewHistory"];
    },
    context: ExecutionContext,
  ): Promise<Result<ImportRecord>>;
  discard(
    input: { id: string; expectedVersion: number },
    context: ExecutionContext,
  ): Promise<Result<{ discarded: true }>>;
  updateExpectedVersion(
    input: {
      id: string;
      expectedVersion: number;
      patch: ImportRecordPatch;
    },
    context: ExecutionContext,
  ): Promise<Result<ImportRecord>>;
  cacheGet(
    input: { identity: ImportCacheIdentity },
    context: ExecutionContext,
  ): Promise<Result<ImportCacheEntry | null>>;
  cacheGetByKey(
    input: { key: string },
    context: ExecutionContext,
  ): Promise<Result<ImportCacheEntry | null>>;
  cachePut(
    input: {
      identity: ImportCacheIdentity;
      value: ImportCacheValue;
      expiresAt?: string;
    },
    context: ExecutionContext,
  ): Promise<Result<ImportCacheEntry>>;
  expire(
    input: { before?: string },
    context: ExecutionContext,
  ): Promise<Result<ImportStoreExpirySummary>>;
  invalidateAuthorizationNamespace(
    input: { authorizationNamespace: string },
    context: ExecutionContext,
  ): Promise<Result<{ removedEntries: number }>>;
}
export type ImportStoreFactory = (deps: {
  now: () => Date;
  id: () => string;
  isJobActive?: (input: {
    importId: string;
    runId: string;
  }) => Promise<boolean>;
  cacheCapacityBytes?: number;
}) => ImportStorePort;

export type ImportRecordPatch = Partial<
  Pick<
    ImportRecord,
    | "destinationProjectId"
    | "scope"
    | "selectionVersion"
    | "selectionHash"
    | "lifecycle"
    | "activeRunId"
    | "consent"
    | "preparedSelectionRef"
    | "resultRef"
    | "resultRunId"
    | "approvalKeyHash"
    | "draftRefs"
    | "draftEdits"
    | "savedIds"
    | "pinnedFileIds"
    | "removedFileIds"
    | "candidateInventoryRef"
    | "reviewHistory"
  >
>;

export interface ImportStoreExpirySummary {
  expiredImports: number;
  expiredCacheEntries: number;
  evictedCacheEntries: number;
  preservedActiveImports: number;
  bytesAfterCleanup: number;
}

export interface DeferredMeasurementTaskStorePort {
  create(
    input: Omit<
      DeferredMeasurementTask,
      "id" | "version" | "createdAt" | "retentionDeadline"
    >,
    context: ExecutionContext,
  ): Promise<Result<DeferredMeasurementTask>>;
  get(
    input: { id: string },
    context: ExecutionContext,
  ): Promise<Result<DeferredMeasurementTask>>;
  delete(
    input: { id: string; expectedVersion: number },
    context: ExecutionContext,
  ): Promise<Result<{ deleted: true }>>;
  expire(
    input: { before?: string },
    context: ExecutionContext,
  ): Promise<Result<{ expired: number }>>;
}
export type DeferredMeasurementTaskStoreFactory = (deps: {
  now: () => Date;
  id: () => string;
}) => DeferredMeasurementTaskStorePort;

export interface JobStorePort {
  enqueue(
    input: {
      idempotencyKey: string;
      importId: string;
      projectId: string;
      importVersion: number;
      selectionVersion: number;
      kind: "prepare" | "analyze";
      inputHash: string;
      consentHash: string | null;
      deadline: string;
      usage: BudgetSummary;
    },
    context: ExecutionContext,
  ): Promise<Result<JobRecord>>;
  getByRunId(
    input: { runId: string },
    context: ExecutionContext,
  ): Promise<Result<JobRecord | null>>;
  claim(
    input: { jobId: string; workerId: string; leaseMs: number },
    context: ExecutionContext,
  ): Promise<Result<JobRecord>>;
  renew(
    input: { jobId: string; workerId: string; fence: number; leaseMs: number },
    context: ExecutionContext,
  ): Promise<Result<JobRecord>>;
  checkpoint(
    input: {
      jobId: string;
      workerId: string;
      fence: number;
      stage: string;
      checkpoint: Record<string, JsonValue>;
    },
    context: ExecutionContext,
  ): Promise<Result<JobRecord>>;
  requestCancel(
    input: { jobId: string },
    context: ExecutionContext,
  ): Promise<Result<JobRecord>>;
  completeWithEvent(
    input: {
      jobId: string;
      workerId: string;
      fence: number;
      resultRef: string;
      notification: Omit<NotificationOutboxEvent, "createdAt">;
    },
    context: ExecutionContext,
  ): Promise<Result<JobRecord>>;
  fail(
    input: {
      jobId: string;
      workerId: string;
      fence: number;
      error: DomainError;
    },
    context: ExecutionContext,
  ): Promise<Result<JobRecord>>;
  recoverExpiredLease(
    input: { jobId: string },
    context: ExecutionContext,
  ): Promise<Result<JobRecord>>;
  listNotifications(
    input: { after?: string | null },
    context: ExecutionContext,
  ): Promise<Result<Notification[]>>;
  markRead(
    input: { notificationId: string; read: boolean },
    context: ExecutionContext,
  ): Promise<Result<Notification>>;
}
export type JobStoreFactory = (deps: {
  now: () => Date;
  id: () => string;
  maxQueueSize?: number;
}) => JobStorePort;

export interface NotificationPort {
  list(
    input: { after?: string | null },
    context: ExecutionContext,
  ): Promise<Result<Notification[]>>;
  markRead(
    input: { notificationId: string; read: boolean },
    context: ExecutionContext,
  ): Promise<Result<Notification>>;
}

export interface SelectionPolicyPort {
  scoreCandidate(input: {
    candidate: FileCandidate;
    scope: RepositoryScope;
    pullRequests: PullRequestSummary[];
  }): Result<number>;
  requiredDimensions(input: { scope: RepositoryScope }): Result<string[]>;
}
export type SelectionPolicyFactory = (config: {
  weights?: Record<string, number>;
  coverageRules?: Record<string, string[]>;
}) => SelectionPolicyPort;

export interface MeasurementPort {
  getApplicableDefinitions(input: {
    capability: string;
    task?: string;
  }): Result<MeasurementDefinition[]>;
  validateMeasurementAnswer(input: {
    answer: MeasurementAnswer;
    expectedVersion?: number;
  }): Result<MeasurementAnswer>;
  deriveMeasurementResult(input: {
    answer: MeasurementAnswer;
    baseline?: MeasurementAnswer;
  }): Result<MeasurementResult | null>;
  renderMetricClause(input: {
    result: MeasurementResult;
  }): Result<{ clause: string; previewHash: string }>;
}

export interface MeasurementServicePort {
  review(
    input: { importId: string; expectedVersion?: number },
    context: ExecutionContext,
  ): Promise<
    Result<{
      questions: ImportQuestion[];
      measurementResults: MeasurementResult[];
      draftResultIds?: Record<string, string[]>;
      answers?: Record<string, MeasurementAnswer>;
    }>
  >;
  questions(
    input: { importId: string; draftId?: string; expectedVersion?: number },
    context: ExecutionContext,
  ): Promise<Result<ImportQuestion[]>>;
  answer(
    input: {
      importId: string;
      questionId: string;
      expectedVersion: number;
      answer: MeasurementAnswer;
    },
    context: ExecutionContext,
  ): Promise<Result<{ version: number; result: MeasurementResult | null }>>;
  defer(
    input: { importId: string; questionId: string; expectedVersion: number },
    context: ExecutionContext,
  ): Promise<Result<{ deferredTaskId: string; retentionDeadline: string }>>;
  preview(
    input: { importId: string; draftId: string; measurementResultId?: string },
    context: ExecutionContext,
  ): Promise<Result<{ text: string; hash: string }>>;
}
export type MeasurementServiceFactory = (deps: {
  store: ImportStorePort;
  deferredTasks: DeferredMeasurementTaskStorePort;
  measurements: MeasurementPort;
  now: () => Date;
}) => MeasurementServicePort;

export interface ReportParserPort {
  parseMeasurementReport(input: {
    definitionId: string;
    source: string;
    context: ExecutionContext;
  }): Result<{
    candidates: MeasurementAnswer[];
    sourcePointers: EvidenceItem[];
    unsupported: string[];
  }>;
}

export interface RepositoryExtractorPort {
  extract(input: {
    prepared: PreparedSelection;
    contribution: string;
    catalog: MeasurementDefinition[];
    context: ExecutionContext;
  }): Promise<Result<AnalysisResult>>;
}
export type RepositoryExtractorFactory = (deps: {
  generate: (input: {
    prompt: string;
    schemaVersion: string;
    signal: AbortSignal;
  }) => Promise<
    Result<{ text: string; model: string | null; usage: BudgetSummary }>
  >;
  now: () => Date;
}) => RepositoryExtractorPort;

export interface ImportJobRunnerPort {
  runOnce(input?: { jobId?: string }): Promise<Result<JobRecord | null>>;
  recover(): Promise<Result<{ recovered: number }>>;
  shutdown(): Promise<Result<{ closed: true }>>;
}
export type ImportJobRunnerFactory = (deps: {
  jobs: JobStorePort;
  executePrepare: (
    job: JobRecord,
    context: ExecutionContext,
  ) => Promise<Result<ImportRecord>>;
  executeAnalyze: (
    job: JobRecord,
    context: ExecutionContext,
  ) => Promise<Result<AnalysisResult>>;
  contextFor: (job: JobRecord) => Promise<Result<ExecutionContext>>;
}) => ImportJobRunnerPort;

export interface ImportServicePort {
  create(
    input: {
      source: "personal" | "demo";
      destinationProjectId: string;
      scope: RepositoryScope;
    },
    context: ExecutionContext,
  ): Promise<Result<ImportRecord>>;
  prepare(
    input: { importId: string; expectedVersion: number },
    context: ExecutionContext,
  ): Promise<Result<JobRecord>>;
  changeSelection(
    input: {
      importId: string;
      expectedVersion: number;
      scope: RepositoryScope;
      pinnedFileIds: string[];
      removedFileIds?: string[];
      destinationProjectId?: string;
    },
    context: ExecutionContext,
  ): Promise<Result<ImportRecord>>;
  enqueueAnalysis(
    input: {
      importId: string;
      expectedVersion: number;
      selectionHash: string;
      consentReference: string;
      idempotencyKey: string;
    },
    context: ExecutionContext,
  ): Promise<Result<JobRecord>>;
  executePrepare(input: {
    job: JobRecord;
    context: ExecutionContext;
  }): Promise<Result<ImportRecord>>;
  executeAnalyze(input: {
    job: JobRecord;
    context: ExecutionContext;
  }): Promise<Result<AnalysisResult>>;
  get(
    input: { importId: string },
    context: ExecutionContext,
  ): Promise<Result<ImportReviewState>>;
  updateDraft(
    input: {
      importId: string;
      draftId: string;
      expectedVersion: number;
      text: string;
      selectedForSave?: boolean;
      contributionConfirmed?: boolean;
      confirmedMetricResultIds?: string[];
    },
    context: ExecutionContext,
  ): Promise<Result<Draft>>;
  approve(
    input: {
      importId: string;
      expectedVersion: number;
      selectedDraftIds: string[];
      idempotencyKey: string;
    },
    context: ExecutionContext,
  ): Promise<Result<{ savedIds: string[] }>>;
  cancel(
    input: { importId: string; runId: string },
    context: ExecutionContext,
  ): Promise<Result<ImportRecord>>;
  discard(
    input: { importId: string; expectedVersion: number },
    context: ExecutionContext,
  ): Promise<Result<{ discarded: true }>>;
}
export type ImportServiceFactory = (deps: {
  store: ImportStorePort;
  jobs: JobStorePort;
  repository: RepositoryInspectorPort;
  pullRequests: PrContextReaderPort;
  selector: EvidenceSelectorPort;
  extractor: RepositoryExtractorPort;
  catalog: readonly MeasurementDefinition[];
  measurements: MeasurementServicePort;
  approve: ApprovalPort;
  now: () => Date;
}) => ImportServicePort;

export interface ApprovalPort {
  approveGithubImport(
    input: {
      importId: string;
      expectedVersion: number;
      selectedDraftIds: string[];
      idempotencyKey: string;
    },
    context: ExecutionContext,
  ): Promise<Result<{ savedIds: string[] }>>;
  updateImportedAchievement(
    input: { achievementId: string; expectedVersion: number; text: string },
    context: ExecutionContext,
  ): Promise<Result<{ achievementId: string; version: number }>>;
}

export interface GithubServices {
  imports: ImportServicePort;
  jobs: JobStorePort;
  notifications: NotificationPort;
  access: GithubAccessPort;
}

export interface ImportClientPort {
  create(input: {
    source: "personal" | "demo";
    destinationProjectId: string;
    scope: RepositoryScope;
  }): Promise<Result<ImportRecord>>;
  get(importId: string): Promise<Result<ImportReviewState>>;
  prepare(
    importId: string,
    expectedVersion: number,
  ): Promise<Result<JobRecord>>;
  changeSelection(
    importId: string,
    expectedVersion: number,
    scope: RepositoryScope,
    pinnedFileIds: string[],
  ): Promise<Result<ImportRecord>>;
  enqueueAnalysis(
    importId: string,
    expectedVersion: number,
    selectionHash: string,
    consentReference: string,
  ): Promise<Result<JobRecord>>;
  updateDraft(
    importId: string,
    draftId: string,
    expectedVersion: number,
    text: string,
    review?: {
      selectedForSave?: boolean;
      contributionConfirmed?: boolean;
      confirmedMetricResultIds?: string[];
    },
  ): Promise<Result<Draft>>;
  approve(
    importId: string,
    expectedVersion: number,
    selectedDraftIds: string[],
    idempotencyKey: string,
  ): Promise<Result<{ savedIds: string[] }>>;
  cancel(importId: string, runId: string): Promise<Result<ImportRecord>>;
  discard(
    importId: string,
    expectedVersion: number,
  ): Promise<Result<{ discarded: true }>>;
  subscribeStatus(
    listener: (state: ImportReviewState) => void,
  ): Result<{ close(): void }>;
}

export interface GithubFactoryPorts {
  github: GithubClientPort;
  access: GithubAccessPort;
  repository: RepositoryInspectorPort;
  pullRequests: PrContextReaderPort;
  selector: EvidenceSelectorPort;
  budget: BudgetLedgerPort;
  imports: ImportStorePort;
  jobs: JobStorePort;
  measurements: MeasurementPort;
  measurementService: MeasurementServicePort;
  selectionPolicy: SelectionPolicyPort;
  reports: ReportParserPort;
  extractor: RepositoryExtractorPort;
  runner: ImportJobRunnerPort;
  service: ImportServicePort;
  approval: ApprovalPort;
  deferredTasks: DeferredMeasurementTaskStorePort;
}
