import type {
  AnalysisStatusProps,
  AchievementReviewProps,
  BudgetSummary,
  Draft,
  EvidencePanelProps,
  FileCandidate,
  ImportLifecycle,
  ImportNotificationsProps,
  ImportQuestion,
  ImportTrustRailProps,
  JobRecord,
  MeasurementAnswer,
  MeasurementFieldsProps,
  MeasurementResult,
  Notification,
  PullRequestSummary,
  RepositoryScope,
  RepositorySetupProps,
  RepositorySummary,
} from "../../../lib/github/contracts";

const now = "2026-10-26T12:00:00.000Z";
const revision = "0123456789abcdef0123456789abcdef01234567";
const sourceHash = "abcdef0123456789abcdef0123456789abcdef01";
const resultHash = "a".repeat(64);

export const githubImportFixtureScope: RepositoryScope = {
  repositoryId: "700001",
  owner: "example-labs",
  name: "fictional-dashboard",
  canonicalUrl: "https://github.com/example-labs/fictional-dashboard",
  visibility: "public",
  ref: "main",
  commitSha: revision,
  packagePath: "apps/dashboard",
  selectedPullRequestNumbers: [17],
  selectedPaths: ["apps/dashboard/src/summary.ts"],
  contributionStatement:
    "I implemented the summary aggregation and its regression tests.",
  identitySource: "user-provided",
};

export const githubImportFixtureBudget: BudgetSummary = {
  fetchedFiles: 4,
  fetchedBytes: 18_400,
  httpAttempts: 6,
  selectedUniqueFiles: 3,
  selectedUniqueLines: 82,
  selectedCharacters: 3_860,
  transmittedLinesByRequest: [82],
  cumulativeTransmittedLines: 82,
  estimatedInputTokens: 7_400,
  reportedInputTokens: null,
  limitReason: null,
};

export function readyRepository(): RepositorySummary {
  return {
    repositoryId: "700001",
    owner: "example-labs",
    name: "fictional-dashboard",
    canonicalUrl: "https://github.com/example-labs/fictional-dashboard",
    visibility: "public",
    defaultBranch: "main",
    permission: "write",
  };
}

export function emptyRepositoryList() {
  return {
    repositories: [] as RepositorySummary[],
    connectionState: "connected" as const,
  };
}

export function privateRepositoryDenied() {
  return {
    repositories: [] as RepositorySummary[],
    connectionState: "error" as const,
    error: {
      code: "forbidden" as const,
      message:
        "This account does not have access to the selected private repository.",
      retryable: false,
    },
  };
}

function pullRequest(
  overrides: Partial<PullRequestSummary> = {},
): PullRequestSummary {
  return {
    number: 17,
    title: "Add project summary aggregation",
    state: "merged",
    authorLogin: "example-contributor",
    updatedAt: now,
    changedPaths: [
      "apps/dashboard/src/summary.ts",
      "apps/dashboard/test/summary.test.ts",
    ],
    headSha: revision,
    baseSha: sourceHash,
    selected: true,
    ...overrides,
  };
}

export function prFreeContext(): PullRequestSummary[] {
  return [];
}

export function teamPullRequestContext(): PullRequestSummary[] {
  return [pullRequest({ authorLogin: "team-member", selected: false })];
}

export function hybridPullRequestContext(): PullRequestSummary[] {
  return [
    pullRequest(),
    pullRequest({
      number: 18,
      title: "Document reporting flow",
      changedPaths: ["docs/reporting.md"],
      authorLogin: "another-contributor",
      selected: false,
    }),
  ];
}

export function safeFileCandidate(): FileCandidate {
  return {
    id: "summary-implementation",
    path: "apps/dashboard/src/summary.ts",
    blobSha: sourceHash,
    mode: "100644",
    byteSize: 2_480,
    category: "implementation",
    reasonCodes: ["selected-pr-path", "matches-contribution-scope"],
    safety: "safe",
    eligible: true,
    selected: true,
    pinned: false,
  };
}

export function blockedFileCandidate(): FileCandidate {
  return {
    id: "blocked-environment-example",
    path: "config/.env.example",
    blobSha: sourceHash,
    mode: "100644",
    byteSize: 620,
    category: "other",
    reasonCodes: ["secret-bearing-config-pattern"],
    safety: "blocked",
    eligible: false,
    selected: false,
    pinned: false,
  };
}

export function manualFileCandidate(): FileCandidate {
  return {
    id: "manual-summary-test",
    path: "apps/dashboard/test/summary.test.ts",
    blobSha: revision,
    mode: "100644",
    byteSize: 1_930,
    category: "test",
    reasonCodes: ["user-pinned"],
    safety: "safe",
    eligible: true,
    selected: true,
    pinned: true,
  };
}

export function supportedDraft(): Draft {
  return {
    id: "summary-regression-draft",
    version: 1,
    projectId: "fictional-dashboard-project",
    text: "Implemented project summary aggregation and added regression coverage for empty datasets.",
    reviewedBaseText:
      "Implemented project summary aggregation and added regression coverage for empty datasets.",
    claimIds: ["summary-aggregation-claim"],
    supportStatus: "supported",
    selectedForSave: true,
    contributionConfirmed: true,
    metricResultIds: [],
    approvalEligible: true,
    approvalErrors: [],
  };
}

export function needsContextDraft(): Draft {
  return {
    id: "summary-impact-draft",
    version: 1,
    projectId: "fictional-dashboard-project",
    text: "Improved dashboard response time for reporting workflows.",
    reviewedBaseText:
      "Improved dashboard response time for reporting workflows.",
    claimIds: ["summary-performance-claim"],
    supportStatus: "needs-context",
    selectedForSave: false,
    contributionConfirmed: false,
    metricResultIds: [],
    approvalEligible: false,
    approvalErrors: ["No comparable latency measurement was supplied."],
  };
}

export function measuredAnswer(): MeasurementAnswer {
  return {
    questionId: "summary-latency-question",
    version: 1,
    mode: "result",
    originalValues: [245],
    originalUnits: ["ms"],
    definitionId: "web-api-latency-p95",
    statistic: "p95",
    context: {
      operation: "summary endpoint",
      environment: "synthetic test fixture",
    },
    sourceEvidenceIds: ["summary-test-evidence"],
    attestation: "measured",
    answerHash: resultHash,
  };
}

export function noMetricAnswer(): MeasurementAnswer {
  return {
    questionId: "summary-latency-question",
    version: 1,
    mode: "skip",
    originalValues: [],
    originalUnits: [],
    definitionId: null,
    statistic: null,
    context: {},
    sourceEvidenceIds: [],
    attestation: "none",
    answerHash: sourceHash.padEnd(64, "0"),
  };
}

export function targetMeasurementAnswer(): MeasurementAnswer {
  return {
    questionId: "summary-latency-question",
    version: 1,
    mode: "target",
    originalValues: [200],
    originalUnits: ["ms"],
    definitionId: "web-api-latency-p95",
    statistic: "p95",
    context: { operation: "summary endpoint", note: "future target only" },
    sourceEvidenceIds: [],
    attestation: "target",
    answerHash: "b".repeat(64),
  };
}

export function measuredResult(): MeasurementResult {
  return {
    id: "summary-latency-result",
    definitionId: "web-api-latency-p95",
    version: 1,
    originalValues: [245],
    originalUnits: ["ms"],
    normalizedValues: [245],
    normalizedUnit: "ms",
    context: {
      operation: "summary endpoint",
      environment: "synthetic test fixture",
    },
    evidenceStatus: "measured",
    formulaVersion: null,
    roundingPolicy: null,
    derivedQuantity: null,
    rendererId: "latency-absolute-v1",
    previewHash: resultHash,
    confirmed: false,
  };
}

export function measurementQuestion(): ImportQuestion {
  return {
    id: "summary-latency-question",
    version: 1,
    draftId: supportedDraft().id,
    kind: "measurement",
    prompt: "Do you have a measured result for this endpoint?",
    required: false,
    definitionId: "web-api-latency-p95",
    choices: ["Measured result", "Skip", "Defer"],
    answered: false,
  };
}

export function queuedJob(): JobRecord {
  return job("queued");
}

export function runningJob(): JobRecord {
  return job("running");
}

export function readyJob(): JobRecord {
  return job("completed");
}

export function failedJob(): JobRecord {
  return job("failed");
}

export function interruptedJob(): JobRecord {
  return job("interrupted");
}

function job(state: JobRecord["state"]): JobRecord {
  return {
    id: "summary-" + state + "-job",
    runId: "summary-analysis-run",
    importId: "summary-import",
    projectId: "fictional-dashboard-project",
    importVersion: 2,
    selectionVersion: 1,
    idempotencyKeyHash: "c".repeat(64),
    kind: "analyze",
    state,
    stage: state === "completed" ? "ready-to-review" : state,
    inputHash: resultHash,
    consentHash: resultHash,
    executionFence: state === "queued" ? 0 : 1,
    lease:
      state === "running"
        ? {
            owner: "synthetic-worker",
            expiresAt: "2026-10-26T12:01:00.000Z",
            fence: 1,
          }
        : null,
    checkpoint:
      state === "running" ? { stage: "extracting", completedFiles: 2 } : null,
    cancellationRequestedAt: null,
    deadline: "2026-10-26T12:02:00.000Z",
    usage: githubImportFixtureBudget,
    error:
      state === "failed"
        ? {
            code: "upstream-error",
            message: "Synthetic provider failure.",
            retryable: true,
          }
        : state === "interrupted"
          ? {
              code: "interrupted",
              message: "Synthetic worker interruption.",
              retryable: true,
            }
          : null,
    resultRef: state === "completed" ? resultHash : null,
    outboxEvents:
      state === "completed"
        ? [
            {
              id: "summary-ready-event",
              importId: "summary-import",
              projectId: "fictional-dashboard-project",
              jobId: "summary-completed-job",
              type: "ready",
              createdAt: now,
              destination: "/library/github/summary-import",
            },
          ]
        : [],
    createdAt: "2026-10-26T11:58:00.000Z",
    updatedAt: now,
  };
}

export function readNotification(): Notification {
  return notification("ready", now);
}

export function unreadNotification(): Notification {
  return notification("ready", null);
}

export function expiredNotification(): Notification {
  return notification("expired", null);
}

function notification(
  type: Notification["type"],
  readAt: string | null,
): Notification {
  return {
    id: "summary-" + type + "-event",
    importId: "summary-import",
    projectId: "fictional-dashboard-project",
    jobId: "summary-completed-job",
    type,
    createdAt: now,
    readAt,
    dismissedAt: null,
    destination: "/library/github/summary-import",
  };
}

export function exactBudget(): BudgetSummary {
  return { ...githubImportFixtureBudget };
}

export function overLimitBudget(): BudgetSummary {
  return {
    ...githubImportFixtureBudget,
    selectedUniqueFiles: 13,
    selectedUniqueLines: 1_501,
    transmittedLinesByRequest: [1_501],
    cumulativeTransmittedLines: 3_001,
    limitReason: "source-line-or-file-limit",
  };
}

export function setupProps(
  mode: "ready" | "empty" | "private-denied" = "ready",
): RepositorySetupProps {
  const denied = mode === "private-denied" ? privateRepositoryDenied() : null;
  const empty = mode === "empty";
  return {
    repositories: mode === "ready" ? [readyRepository()] : [],
    selectedRepositoryId: mode === "ready" ? "700001" : null,
    projects: [
      { id: "fictional-dashboard-project", name: "Fictional Dashboard" },
    ],
    selectedProjectId: mode === "empty" ? null : "fictional-dashboard-project",
    connectionState: denied?.connectionState ?? "connected",
    role: githubImportFixtureScope.contributionStatement,
    pullRequests: mode === "ready" ? hybridPullRequestContext() : [],
    selectedPullRequestNumbers: mode === "ready" ? [17] : [],
    ready: mode === "ready",
    error: denied?.error ?? null,
    onConnect: () => undefined,
    onRepositoryChange: () => undefined,
    onDestinationChange: () => undefined,
    onRoleChange: () => undefined,
    onPrSelectionChange: () => undefined,
  };
}

export function evidenceProps(
  mode: "safe" | "blocked" | "manual" = "safe",
): EvidencePanelProps {
  const candidate =
    mode === "blocked"
      ? blockedFileCandidate()
      : mode === "manual"
        ? manualFileCandidate()
        : safeFileCandidate();
  return {
    candidates: [candidate],
    selectedIds: candidate.selected ? [candidate.id] : [],
    pinnedIds: candidate.pinned ? [candidate.id] : [],
    excerpts: [],
    limitations:
      mode === "blocked"
        ? ["The candidate was excluded by the safety policy."]
        : [],
    budget: mode === "blocked" ? overLimitBudget() : exactBudget(),
    onPin: () => undefined,
    onRemove: () => undefined,
    onInspect: () => undefined,
  };
}

export function achievementReviewProps(
  mode: "supported" | "needs-context" = "supported",
): AchievementReviewProps {
  const draft = mode === "supported" ? supportedDraft() : needsContextDraft();
  return {
    drafts: [draft],
    selectedIds: draft.selectedForSave ? [draft.id] : [],
    contributionConfirmations: { [draft.id]: draft.contributionConfirmed },
    supportDetails: { [draft.id]: draft.approvalErrors.join(" ") },
    onTextChange: () => undefined,
    onSelect: () => undefined,
    onConfirmContribution: () => undefined,
    onReject: () => undefined,
    onExpandMeasurement: () => undefined,
  };
}

export function measurementFieldsProps(
  mode: "measured" | "no-metric" | "target" = "measured",
): MeasurementFieldsProps {
  const answer =
    mode === "measured"
      ? measuredAnswer()
      : mode === "target"
        ? targetMeasurementAnswer()
        : noMetricAnswer();
  const question = measurementQuestion();
  return {
    questions: [question],
    answers: { [question.id]: answer },
    validation: {},
    previews: mode === "measured" ? { [question.id]: measuredResult() } : {},
    onAnswer: () => undefined,
    onSkip: () => undefined,
    onDefer: () => undefined,
  };
}

export function trustRailProps(overLimit = false): ImportTrustRailProps {
  return {
    safetySummary: [
      "Safe excerpts selected",
      "No credentials stored in the import record",
    ],
    runIdentity: {
      importId: "summary-import",
      runId: "summary-analysis-run",
      revision,
    },
    budget: overLimit ? overLimitBudget() : exactBudget(),
    cost: {
      estimate: null,
      currency: null,
      uncertainty: "Provider cost is unknown in this fixture.",
    },
    eligibleCount: overLimit ? 0 : 1,
    selectedCount: 1,
    saveState: "idle",
    errors: overLimit
      ? [
          {
            code: "limit-exceeded",
            message: "Synthetic budget is over the configured limit.",
            retryable: false,
          },
        ]
      : [],
    onSave: () => undefined,
    onDiscard: () => undefined,
    onBack: () => undefined,
  };
}

export function analysisStatusProps(
  state: ImportLifecycle,
): AnalysisStatusProps {
  return {
    state,
    stage: state,
    createdAt: "2026-10-26T11:58:00.000Z",
    updatedAt: now,
    cancellationAvailable: state === "queued" || state === "analyzing",
    retryAvailable: state === "failed" || state === "interrupted",
    resumeAvailable: state === "needs-input",
    error:
      state === "failed"
        ? {
            code: "upstream-error",
            message: "Synthetic provider failure.",
            retryable: true,
          }
        : null,
    onCancel: () => undefined,
    onRetry: () => undefined,
    onResumeSetup: () => undefined,
  };
}

export function notificationsProps(
  mode: "read" | "unread" | "expired" = "unread",
): ImportNotificationsProps {
  const item =
    mode === "read"
      ? readNotification()
      : mode === "expired"
        ? expiredNotification()
        : unreadNotification();
  return {
    items: [item],
    unreadCount: item.readAt === null ? 1 : 0,
    onRead: () => undefined,
    onReview: () => undefined,
  };
}
