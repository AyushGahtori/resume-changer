import {
  err,
  unavailableError,
  type ImportCacheEntry,
  type Result,
} from "../contracts";
import type {
  ApprovalPort,
  BudgetLedgerPort,
  EvidenceSelectorPort,
  GithubAccessPort,
  GithubClientPort,
  GithubFactoryPorts,
  GithubServices,
  ImportClientPort,
  DeferredMeasurementTaskStorePort,
  ImportServicePort,
  ImportStorePort,
  ImportStoreExpirySummary,
  ImportJobRunnerPort,
  JobStorePort,
  MeasurementPort,
  MeasurementServicePort,
  NotificationPort,
  PrContextReaderPort,
  RepositoryExtractorPort,
  RepositoryInspectorPort,
  ReportParserPort,
  SelectionPolicyPort,
} from "../ports";

const unavailable = <T>(): Result<T> => err(unavailableError());
const unavailableAsync = <T>() => Promise.resolve(unavailable<T>());

/** Safe stand-ins used until a feature owner replaces the matching port. */
export function createUnavailableGithubClient(): GithubClientPort {
  return {
    getJson: unavailableAsync,
    getText: unavailableAsync,
  };
}

export function createUnavailableGithubAccess(): GithubAccessPort {
  return {
    beginConnection: unavailableAsync,
    completeAuthorization: unavailableAsync,
    listAccessibleRepositories: unavailableAsync,
    authorizeRepository: unavailableAsync,
    disconnect: unavailableAsync,
  };
}

export function createUnavailableRepositoryInspector(): RepositoryInspectorPort {
  return {
    resolveSnapshot: unavailableAsync,
    inventory: unavailableAsync,
  };
}

export function createUnavailablePrContextReader(): PrContextReaderPort {
  return {
    listCandidates: unavailableAsync,
    readSelected: unavailableAsync,
  };
}

export function createUnavailableEvidenceSelector(): EvidenceSelectorPort {
  return {
    select: unavailableAsync,
    pack: unavailableAsync,
  };
}

export function createUnavailableBudgetLedger(): BudgetLedgerPort {
  return {
    reserve: unavailableAsync,
    commitUsage: unavailableAsync,
    checkSelection: unavailable,
    remaining: unavailable,
    snapshot: unavailable,
  };
}

export function createUnavailableImportStore(): ImportStorePort {
  return {
    create: unavailableAsync,
    get: unavailableAsync,
    updateExpectedVersion: unavailableAsync,
    cacheGet: unavailableAsync,
    cachePut: unavailableAsync,
    expire: async (): Promise<Result<ImportStoreExpirySummary>> =>
      unavailable(),
    invalidateAuthorizationNamespace: unavailableAsync,
  };
}

export function createUnavailableDeferredMeasurementTaskStore(): DeferredMeasurementTaskStorePort {
  return {
    create: unavailableAsync,
    get: unavailableAsync,
    delete: unavailableAsync,
    expire: unavailableAsync,
  };
}

export function createUnavailableJobStore(): JobStorePort {
  return {
    enqueue: unavailableAsync,
    claim: unavailableAsync,
    renew: unavailableAsync,
    checkpoint: unavailableAsync,
    requestCancel: unavailableAsync,
    completeWithEvent: unavailableAsync,
    fail: unavailableAsync,
    recoverExpiredLease: unavailableAsync,
    listNotifications: unavailableAsync,
    markRead: unavailableAsync,
  };
}

export function createUnavailableNotificationPort(): NotificationPort {
  return {
    list: unavailableAsync,
    markRead: unavailableAsync,
  };
}

export function createUnavailableMeasurementPort(): MeasurementPort {
  return {
    getApplicableDefinitions: unavailable,
    validateMeasurementAnswer: unavailable,
    deriveMeasurementResult: unavailable,
    renderMetricClause: unavailable,
  };
}

export function createUnavailableMeasurementService(): MeasurementServicePort {
  return {
    questions: unavailableAsync,
    answer: unavailableAsync,
    defer: unavailableAsync,
    preview: unavailableAsync,
  };
}

export function createUnavailableSelectionPolicy(): SelectionPolicyPort {
  return {
    scoreCandidate: unavailable,
    requiredDimensions: unavailable,
  };
}

export function createUnavailableReportParser(): ReportParserPort {
  return {
    parseMeasurementReport: unavailable,
  };
}

export function createUnavailableRepositoryExtractor(): RepositoryExtractorPort {
  return {
    extract: unavailableAsync,
  };
}

export function createUnavailableImportJobRunner(): ImportJobRunnerPort {
  return {
    runOnce: unavailableAsync,
    recover: unavailableAsync,
    shutdown: unavailableAsync,
  };
}

export function createUnavailableApprovalPort(): ApprovalPort {
  return {
    approveGithubImport: unavailableAsync,
    updateImportedAchievement: unavailableAsync,
  };
}

export function createUnavailableImportService(): ImportServicePort {
  return {
    create: unavailableAsync,
    prepare: unavailableAsync,
    changeSelection: unavailableAsync,
    enqueueAnalysis: unavailableAsync,
    executePrepare: unavailableAsync,
    executeAnalyze: unavailableAsync,
    get: unavailableAsync,
    updateDraft: unavailableAsync,
    approve: unavailableAsync,
    cancel: unavailableAsync,
    discard: unavailableAsync,
  };
}

export function createUnavailableGithubPorts(): GithubFactoryPorts {
  return {
    github: createUnavailableGithubClient(),
    access: createUnavailableGithubAccess(),
    repository: createUnavailableRepositoryInspector(),
    pullRequests: createUnavailablePrContextReader(),
    selector: createUnavailableEvidenceSelector(),
    budget: createUnavailableBudgetLedger(),
    imports: createUnavailableImportStore(),
    jobs: createUnavailableJobStore(),
    measurements: createUnavailableMeasurementPort(),
    measurementService: createUnavailableMeasurementService(),
    selectionPolicy: createUnavailableSelectionPolicy(),
    reports: createUnavailableReportParser(),
    extractor: createUnavailableRepositoryExtractor(),
    runner: createUnavailableImportJobRunner(),
    service: createUnavailableImportService(),
    approval: createUnavailableApprovalPort(),
    deferredTasks: createUnavailableDeferredMeasurementTaskStore(),
  };
}

export function createUnavailableGithubServices(): GithubServices {
  const ports = createUnavailableGithubPorts();
  return {
    imports: ports.service,
    jobs: ports.jobs,
    notifications: createUnavailableNotificationPort(),
    access: ports.access,
  };
}

export function createUnavailableImportClient(): ImportClientPort {
  return {
    create: unavailableAsync,
    get: unavailableAsync,
    prepare: unavailableAsync,
    changeSelection: unavailableAsync,
    enqueueAnalysis: unavailableAsync,
    updateDraft: unavailableAsync,
    approve: unavailableAsync,
    cancel: unavailableAsync,
    discard: unavailableAsync,
    subscribeStatus: unavailable,
  };
}

export function unavailableCacheEntry(): Result<ImportCacheEntry> {
  return unavailable();
}
