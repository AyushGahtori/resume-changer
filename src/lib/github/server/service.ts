import { createHash } from "node:crypto";
import {
  AnalysisResultSchema,
  DraftSchema,
  FileCandidateSchema,
  GITHUB_IMPORT_POLICY,
  ImportRecordSchema,
  PreparedSelectionSchema,
  RepositoryScopeSchema,
  err,
  ok,
  type AnalysisResult,
  type BudgetSummary,
  type DomainError,
  type Draft,
  type DraftEdit,
  type ExecutionContext,
  type FileCandidate,
  type ImportCacheIdentity,
  type ImportCacheValue,
  type ImportRecord,
  type ImportReviewState,
  type JobRecord,
  type PullRequestSummary,
  type Result,
} from "../contracts";
import type {
  ImportServiceFactory,
  ImportStorePort,
  JobStorePort,
  RepositorySnapshot,
} from "../ports";

const SELECTOR_VERSION = "github-selector-v1";
const SAFETY_POLICY_VERSION = "github-file-safety-v1";
const SOURCE_PARSER_VERSION = "github-source-text-v1";
const EXTRACTION_PROMPT_VERSION = "repository-achievements-v1";
const EXTRACTION_SCHEMA_VERSION = "github-analysis-result-v1";
const EXTRACTION_SETTINGS_HASH = createHash("sha256")
  .update("default-extraction-settings-v1")
  .digest("hex");
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const emptyBudget: BudgetSummary = {
  fetchedFiles: 0,
  fetchedBytes: 0,
  httpAttempts: 0,
  selectedUniqueFiles: 0,
  selectedUniqueLines: 0,
  selectedCharacters: 0,
  transmittedLinesByRequest: [],
  cumulativeTransmittedLines: 0,
  estimatedInputTokens: null,
  reportedInputTokens: null,
  limitReason: null,
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function domainError(
  code: DomainError["code"],
  message: string,
  retryable = false,
): DomainError {
  return { code, message, retryable };
}

function failure<T = never>(
  code: DomainError["code"],
  message: string,
  retryable = false,
): Result<T> {
  return err(domainError(code, message, retryable));
}

function isAuthorized(
  context: ExecutionContext,
  repositoryId: string,
): boolean {
  return Boolean(
    context?.access?.sessionId &&
    context.access.authorizationNamespace &&
    context.access.grantedRepositoryIds.includes(repositoryId) &&
    !context.signal.aborted,
  );
}

function validateContext(context: ExecutionContext): Result<void> {
  if (!context?.access?.sessionId || !context.access.authorizationNamespace)
    return failure(
      "forbidden",
      "An authorized personal workspace is required.",
    );
  if (context.signal.aborted)
    return failure("cancelled", "The operation was cancelled.");
  if (!Number.isFinite(Date.parse(context.deadline)))
    return failure("invalid-input", "A valid operation deadline is required.");
  return ok(undefined);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function contextHash(scope: ImportRecord["scope"]): string {
  return hash({
    contributionStatement: scope.contributionStatement,
    identitySource: scope.identitySource,
    selectedPullRequestNumbers: scope.selectedPullRequestNumbers,
    selectedPaths: scope.selectedPaths,
  });
}

function inventoryIdentity(input: {
  scope: ImportRecord["scope"];
  snapshot: RepositorySnapshot;
}): ImportCacheIdentity {
  return {
    kind: "inventory",
    repositoryId: input.scope.repositoryId,
    commitSha: input.snapshot.commitSha,
    scope: input.scope,
    inputHash: hash({
      treeSha: input.snapshot.treeSha,
      scope: input.scope,
      selectorVersion: SELECTOR_VERSION,
      safetyPolicyVersion: SAFETY_POLICY_VERSION,
    }),
    selectorVersion: SELECTOR_VERSION,
    safetyPolicyVersion: SAFETY_POLICY_VERSION,
  };
}

function selectedBundleIdentity(
  prepared: ReturnType<typeof PreparedSelectionSchema.parse>,
): ImportCacheIdentity {
  return {
    kind: "selected-bundle",
    repositoryId: prepared.scope.repositoryId,
    commitSha: prepared.scope.commitSha,
    sourceHashes: unique(prepared.evidence.map((item) => item.blobSha)).sort(),
    selectedFileIds: prepared.selectedFileIds,
    selectionHash: prepared.selectionHash,
    scope: prepared.scope,
    contributionContextHash: contextHash(prepared.scope),
    selectorVersion: SELECTOR_VERSION,
    safetyPolicyVersion: SAFETY_POLICY_VERSION,
  };
}

function extractionIdentity(
  prepared: ReturnType<typeof PreparedSelectionSchema.parse>,
  result: AnalysisResult,
): ImportCacheIdentity {
  return {
    kind: "extraction-result",
    repositoryId: prepared.scope.repositoryId,
    commitSha: prepared.scope.commitSha,
    sourceHashes: unique(prepared.evidence.map((item) => item.blobSha)).sort(),
    selectionHash: prepared.selectionHash,
    scope: prepared.scope,
    contributionContextHash: contextHash(prepared.scope),
    selectorVersion: SELECTOR_VERSION,
    promptVersion: EXTRACTION_PROMPT_VERSION,
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    model: result.model ?? "unknown",
    settingsHash: EXTRACTION_SETTINGS_HASH,
    safetyPolicyVersion: SAFETY_POLICY_VERSION,
  };
}

function toEditableDraft(
  draft: Draft,
  edit: DraftEdit | undefined,
  claimIds: Set<string>,
): Draft {
  const candidate = DraftSchema.parse({
    ...draft,
    text: edit?.text ?? draft.reviewedBaseText,
    version: edit?.version ?? draft.version,
    selectedForSave: edit?.selectedForSave ?? false,
    contributionConfirmed: edit?.contributionConfirmed ?? false,
    approvalEligible: false,
    approvalErrors: [],
  });
  const supportEligible =
    candidate.supportStatus === "supported" ||
    candidate.supportStatus === "partial";
  const claimsValid = candidate.claimIds.every((claimId) =>
    claimIds.has(claimId),
  );
  const metricsConfirmed = candidate.metricResultIds.every((metricId) =>
    edit?.confirmedMetricResultIds.includes(metricId),
  );
  const eligible =
    supportEligible &&
    claimsValid &&
    candidate.selectedForSave &&
    candidate.contributionConfirmed &&
    metricsConfirmed;
  const errors = [
    ...(supportEligible ? [] : ["This draft needs more supporting context."]),
    ...(claimsValid ? [] : ["This draft refers to an unavailable claim."]),
    ...(!candidate.contributionConfirmed
      ? ["Confirm your personal contribution before saving."]
      : []),
    ...(!metricsConfirmed
      ? ["Confirm or remove each proposed measurement before saving."]
      : []),
  ];
  return DraftSchema.parse({
    ...candidate,
    approvalEligible: eligible,
    approvalErrors: errors,
  });
}

function sanitizeAnalysis(
  input: AnalysisResult,
  destinationProjectId: string,
  prepared: ReturnType<typeof PreparedSelectionSchema.parse>,
): Result<AnalysisResult> {
  const parsed = AnalysisResultSchema.safeParse(input);
  if (!parsed.success || parsed.data.selectionHash !== prepared.selectionHash)
    return failure(
      "invalid-evidence",
      "The proposed analysis does not match the consented evidence.",
    );
  const evidenceIds = new Set(prepared.evidence.map((evidence) => evidence.id));
  const claimIds = new Set(parsed.data.claims.map((claim) => claim.id));
  const draftIds = new Set(parsed.data.drafts.map((draft) => draft.id));
  if (
    claimIds.size !== parsed.data.claims.length ||
    draftIds.size !== parsed.data.drafts.length ||
    parsed.data.claims.some((claim) =>
      claim.evidenceIds.some((evidenceId) => !evidenceIds.has(evidenceId)),
    ) ||
    parsed.data.drafts.some((draft) =>
      draft.claimIds.some((claimId) => !claimIds.has(claimId)),
    )
  )
    return failure(
      "invalid-evidence",
      "The proposed analysis refers to evidence or claims outside this selection.",
    );
  const claims = parsed.data.claims.map((claim) => ({
    ...claim,
    confirmedByUser: false,
    confirmationVersion: null,
  }));
  const result = AnalysisResultSchema.safeParse({
    ...parsed.data,
    claims,
    drafts: parsed.data.drafts.map((draft) => ({
      ...draft,
      projectId: destinationProjectId,
      selectedForSave: false,
      contributionConfirmed: false,
      approvalEligible: false,
      approvalErrors: [],
    })),
  });
  if (!result.success)
    return failure("upstream-error", "The proposed analysis was invalid.");
  return ok(result.data);
}

function prepareCompleteness(input: {
  missingDimensions: string[];
  inventoryPartial: boolean;
  snapshotPartial: boolean;
  prPartial: boolean;
  selectedCount: number;
}): "complete" | "partial" | "needs-context" {
  if (input.missingDimensions.length > 0 || input.selectedCount === 0)
    return "needs-context";
  return input.inventoryPartial || input.snapshotPartial || input.prPartial
    ? "partial"
    : "complete";
}

export const createImportService: ImportServiceFactory = (deps) => {
  async function getRecord(
    importId: string,
    context: ExecutionContext,
  ): Promise<Result<ImportRecord>> {
    const valid = validateContext(context);
    if (!valid.ok) return valid;
    if (!ID_PATTERN.test(importId))
      return failure("invalid-input", "The import ID is invalid.");
    return deps.store.get({ id: importId }, context);
  }

  async function getByRun(
    runId: string,
    context: ExecutionContext,
  ): Promise<Result<JobRecord | null>> {
    const job = await deps.jobs.getByRunId({ runId }, context);
    if (!job.ok) return job;
    if (job.value && job.value.runId !== runId)
      return failure(
        "invalid-evidence",
        "The job store returned a mismatched run.",
      );
    return job;
  }

  async function attachRun(
    record: ImportRecord,
    job: JobRecord,
    context: ExecutionContext,
  ): Promise<Result<ImportRecord>> {
    const current = await getRecord(record.id, context);
    if (!current.ok) return current;
    if (current.value.activeRunId === job.runId) return current;
    if (
      current.value.activeRunId !== null ||
      current.value.version !== job.importVersion ||
      current.value.selectionVersion !== job.selectionVersion
    )
      return failure(
        "version-conflict",
        "The import changed before its background job was attached.",
      );
    return deps.store.updateExpectedVersion(
      {
        id: current.value.id,
        expectedVersion: current.value.version,
        patch: { activeRunId: job.runId },
      },
      context,
    );
  }

  async function cancelJob(job: JobRecord, context: ExecutionContext) {
    if (job.state !== "queued" && job.state !== "running") return ok(job);
    const requested = await deps.jobs.requestCancel({ jobId: job.id }, context);
    if (requested.ok || requested.error.code !== "version-conflict")
      return requested;
    const latest = await getByRun(job.runId, context);
    if (!latest.ok) return latest;
    if (
      !latest.value ||
      (latest.value.state !== "queued" && latest.value.state !== "running")
    )
      return ok(latest.value ?? job);
    return requested;
  }

  async function readCacheByRef<T extends ImportCacheValue["kind"]>(
    ref: string | null,
    kind: T,
    context: ExecutionContext,
  ) {
    if (!ref) return ok(null);
    const entry = await deps.store.cacheGetByKey({ key: ref }, context);
    if (!entry.ok) return entry;
    if (!entry.value || entry.value.value.kind !== kind) return ok(null);
    return ok(entry.value.value as Extract<ImportCacheValue, { kind: T }>);
  }

  async function loadPrepared(record: ImportRecord, context: ExecutionContext) {
    const cached = await readCacheByRef(
      record.preparedSelectionRef,
      "selected-bundle",
      context,
    );
    if (!cached.ok) return cached;
    if (!cached.value) return ok(null);
    const prepared = PreparedSelectionSchema.safeParse(cached.value.prepared);
    if (
      !prepared.success ||
      prepared.data.importId !== record.id ||
      prepared.data.version !== record.selectionVersion ||
      prepared.data.selectionHash !== record.selectionHash ||
      prepared.data.scope.repositoryId !== record.scope.repositoryId ||
      prepared.data.scope.commitSha !== record.scope.commitSha
    )
      return failure(
        "invalid-evidence",
        "The saved evidence bundle does not match this import.",
      );
    return ok(prepared.data);
  }

  async function loadResult(record: ImportRecord, context: ExecutionContext) {
    const cached = await readCacheByRef(
      record.resultRef,
      "extraction-result",
      context,
    );
    if (!cached.ok) return cached;
    if (!cached.value) return ok(null);
    const result = AnalysisResultSchema.safeParse(cached.value.result);
    if (!result.success || result.data.selectionHash !== record.selectionHash)
      return failure(
        "invalid-evidence",
        "The saved analysis does not match this selection.",
      );
    return ok(result.data);
  }

  async function loadCandidates(
    record: ImportRecord,
    context: ExecutionContext,
  ) {
    const cached = await readCacheByRef(
      record.candidateInventoryRef,
      "inventory",
      context,
    );
    if (!cached.ok) return cached;
    return ok(cached.value?.candidates ?? []);
  }

  async function preserveReview(
    record: ImportRecord,
    context: ExecutionContext,
  ) {
    if (!record.resultRef || !record.selectionHash)
      return ok(record.reviewHistory);
    const result = await loadResult(record, context);
    if (!result.ok) return result;
    if (!result.value) return ok(record.reviewHistory);
    const prepared = await loadPrepared(record, context);
    if (!prepared.ok) return prepared;
    const runId = record.resultRunId ?? record.activeRunId;
    if (!runId) return ok(record.reviewHistory);
    if (record.reviewHistory.some((revision) => revision.runId === runId))
      return ok(record.reviewHistory);
    const revision = {
      runId,
      selectionVersion: prepared.value?.version ?? record.selectionVersion,
      selectionHash: record.selectionHash,
      preparedSelectionRef: record.preparedSelectionRef,
      resultRef: record.resultRef,
      draftRefs: record.draftRefs,
      draftEdits: record.draftEdits,
      destinationProjectId: record.destinationProjectId,
      savedIds: record.savedIds,
      createdAt: deps.now().toISOString(),
    };
    return ok([...record.reviewHistory, revision].slice(-20));
  }

  async function runIsCurrent(
    job: JobRecord,
    record: ImportRecord,
    expectedKind: "prepare" | "analyze",
    context: ExecutionContext,
  ): Promise<Result<void>> {
    if (
      job.kind !== expectedKind ||
      job.importId !== record.id ||
      job.runId !== context.runId ||
      job.state !== "running" ||
      !job.lease ||
      job.cancellationRequestedAt !== null
    )
      return failure("cancelled", "This background run is no longer active.");
    if (
      record.activeRunId !== job.runId ||
      job.selectionVersion !== record.selectionVersion ||
      !isAuthorized(context, record.scope.repositoryId)
    )
      return failure(
        "version-conflict",
        "The import changed while this run was queued.",
      );
    const latestJob = await getByRun(job.runId, context);
    if (!latestJob.ok) return latestJob;
    if (
      !latestJob.value ||
      latestJob.value.importId !== record.id ||
      latestJob.value.state !== "running" ||
      latestJob.value.cancellationRequestedAt !== null ||
      latestJob.value.executionFence !== job.executionFence ||
      latestJob.value.lease?.fence !== job.lease.fence
    )
      return failure(
        "cancelled",
        "This background run was cancelled or superseded.",
      );
    return ok(undefined);
  }

  return {
    async create(input, context) {
      const valid = validateContext(context);
      if (!valid.ok) return valid;
      if (input.source !== "personal")
        return failure(
          "forbidden",
          "Demo imports cannot be saved to a personal library.",
        );
      const scope = RepositoryScopeSchema.safeParse(input.scope);
      if (!scope.success)
        return failure("invalid-input", "Repository scope is invalid.");
      if (!isAuthorized(context, scope.data.repositoryId))
        return failure("forbidden", "Repository access is not authorized.");
      if (!ID_PATTERN.test(input.destinationProjectId))
        return failure(
          "invalid-input",
          "Choose an existing destination project.",
        );
      return deps.store.create(
        {
          source: input.source,
          destinationProjectId: input.destinationProjectId,
          scope: scope.data,
        },
        context,
      );
    },

    async prepare(input, context) {
      const current = await getRecord(input.importId, context);
      if (!current.ok) return current;
      let record = current.value;
      if (record.version !== input.expectedVersion)
        return failure(
          "version-conflict",
          "This import changed. Reload before preparing it.",
        );
      if (!isAuthorized(context, record.scope.repositoryId))
        return failure(
          "forbidden",
          "Repository access is no longer authorized.",
        );
      if (record.lifecycle === "approved" || record.lifecycle === "expired")
        return failure(
          "version-conflict",
          "This import can no longer be prepared.",
        );

      if (record.activeRunId) {
        const activeJob = await getByRun(record.activeRunId, context);
        if (!activeJob.ok) return activeJob;
        if (!activeJob.value || activeJob.value.importId !== record.id)
          return failure(
            "invalid-evidence",
            "The active preparation reference is invalid.",
          );
        if (
          activeJob.value.kind === "prepare" &&
          activeJob.value.selectionVersion === record.selectionVersion
        ) {
          if (
            activeJob.value.state === "queued" ||
            activeJob.value.state === "running"
          )
            return ok(activeJob.value);
          if (activeJob.value.state === "completed") {
            const cached = await loadPrepared(record, context);
            if (!cached.ok) return cached;
            if (cached.value) return ok(activeJob.value);
          }
        }
        const detached = await deps.store.updateExpectedVersion(
          {
            id: record.id,
            expectedVersion: record.version,
            patch: { activeRunId: null, lifecycle: "created" },
          },
          context,
        );
        if (!detached.ok) return detached;
        record = detached.value;
      }

      const inputHash = hash({
        importId: record.id,
        selectionVersion: record.selectionVersion,
        scope: record.scope,
        pinnedFileIds: record.pinnedFileIds,
        removedFileIds: record.removedFileIds,
      });
      const preparing = await deps.store.updateExpectedVersion(
        {
          id: record.id,
          expectedVersion: record.version,
          patch: { lifecycle: "preparing", activeRunId: null },
        },
        context,
      );
      if (!preparing.ok) return preparing;
      const enqueued = await deps.jobs.enqueue(
        {
          idempotencyKey: `prepare:${record.id}:${record.selectionVersion}:${preparing.value.version}:${inputHash}`,
          importId: record.id,
          projectId: record.destinationProjectId,
          importVersion: preparing.value.version,
          selectionVersion: record.selectionVersion,
          kind: "prepare",
          inputHash,
          consentHash: null,
          deadline: new Date(
            deps.now().getTime() + GITHUB_IMPORT_POLICY.inspectionDeadlineMs,
          ).toISOString(),
          usage: emptyBudget,
        },
        context,
      );
      if (!enqueued.ok) {
        await deps.store.updateExpectedVersion(
          {
            id: record.id,
            expectedVersion: preparing.value.version,
            patch: { lifecycle: "created" },
          },
          context,
        );
        return enqueued;
      }
      const attached = await attachRun(
        preparing.value,
        enqueued.value,
        context,
      );
      if (!attached.ok) {
        await cancelJob(enqueued.value, context);
        return attached;
      }
      return ok(enqueued.value);
    },

    async changeSelection(input, context) {
      const current = await getRecord(input.importId, context);
      if (!current.ok) return current;
      const record = current.value;
      if (record.version !== input.expectedVersion)
        return failure(
          "version-conflict",
          "This import changed. Reload before changing its scope.",
        );
      if (record.lifecycle === "approved" || record.lifecycle === "expired")
        return failure(
          "version-conflict",
          "This import can no longer be changed.",
        );
      const nextScope = RepositoryScopeSchema.safeParse(input.scope);
      if (!nextScope.success)
        return failure("invalid-input", "Repository scope is invalid.");
      if (!isAuthorized(context, nextScope.data.repositoryId))
        return failure(
          "forbidden",
          "Repository access is no longer authorized.",
        );
      const pins = unique(input.pinnedFileIds).sort();
      const removals = unique(input.removedFileIds ?? []).sort();
      if (
        pins.length > GITHUB_IMPORT_POLICY.filesPerRequest ||
        removals.length > 2_000 ||
        pins.some((id) => !ID_PATTERN.test(id)) ||
        removals.some((id) => !ID_PATTERN.test(id))
      )
        return failure(
          "invalid-input",
          "The manual file selection is invalid.",
        );
      if (pins.some((id) => removals.includes(id)))
        return failure(
          "invalid-input",
          "A file cannot be pinned and removed at once.",
        );

      const inventory = await loadCandidates(record, context);
      if (!inventory.ok) return inventory;
      const byId = new Map(
        inventory.value.map((candidate) => [candidate.id, candidate]),
      );
      for (const fileId of [...pins, ...removals]) {
        const candidate = byId.get(fileId);
        if (!candidate)
          return failure(
            "invalid-input",
            "A selected file is no longer in the inspected inventory.",
          );
        if (
          pins.includes(fileId) &&
          (!candidate.eligible || candidate.safety !== "safe")
        )
          return failure(
            "invalid-evidence",
            "Blocked or unsafe files cannot be pinned.",
          );
      }

      const nextDestination =
        input.destinationProjectId ?? record.destinationProjectId;
      if (!ID_PATTERN.test(nextDestination))
        return failure(
          "invalid-input",
          "Choose an existing destination project.",
        );
      const changed =
        hash(nextScope.data) !== hash(record.scope) ||
        hash(pins) !== hash(record.pinnedFileIds) ||
        hash(removals) !== hash(record.removedFileIds) ||
        nextDestination !== record.destinationProjectId;
      if (!changed) return ok(record);

      let reviewHistory = await preserveReview(record, context);
      if (!reviewHistory.ok) return reviewHistory;
      let activeJob: JobRecord | null = null;
      if (record.activeRunId) {
        const running = await getByRun(record.activeRunId, context);
        if (!running.ok) return running;
        if (running.value && running.value.importId !== record.id)
          return failure(
            "invalid-evidence",
            "The active job belongs to another import.",
          );
        activeJob = running.value;
      }
      const changedRecord = await deps.store.updateExpectedVersion(
        {
          id: record.id,
          expectedVersion: record.version,
          patch: {
            scope: nextScope.data,
            destinationProjectId: nextDestination,
            pinnedFileIds: pins,
            removedFileIds: removals,
            reviewHistory: reviewHistory.value,
            selectionHash: null,
            preparedSelectionRef: null,
            candidateInventoryRef: null,
            resultRef: null,
            resultRunId: null,
            draftRefs: [],
            draftEdits: [],
            consent: null,
            activeRunId: null,
            approvalKeyHash: null,
            lifecycle: "created",
          },
        },
        context,
      );
      if (!changedRecord.ok) return changedRecord;
      if (activeJob) {
        const cancelled = await cancelJob(activeJob, context);
        if (!cancelled.ok) return cancelled;
      }
      return changedRecord;
    },

    async enqueueAnalysis(input, context) {
      const current = await getRecord(input.importId, context);
      if (!current.ok) return current;
      const record = current.value;
      if (!isAuthorized(context, record.scope.repositoryId))
        return failure(
          "forbidden",
          "Repository access is no longer authorized.",
        );
      if (
        !ID_PATTERN.test(input.consentReference) ||
        !ID_PATTERN.test(input.idempotencyKey)
      )
        return failure(
          "invalid-input",
          "Consent and idempotency references are invalid.",
        );
      if (!record.selectionHash || record.selectionHash !== input.selectionHash)
        return failure(
          "version-conflict",
          "Consent must match the current prepared evidence.",
        );
      const prepared = await loadPrepared(record, context);
      if (!prepared.ok) return prepared;
      if (
        !prepared.value ||
        prepared.value.selectionHash !== input.selectionHash
      )
        return failure(
          "needs-context",
          "Prepare a current evidence bundle before analysis.",
        );
      if (
        prepared.value.selectedFileIds.length === 0 ||
        prepared.value.evidence.length === 0
      )
        return failure(
          "needs-context",
          "Add relevant source files before analysis.",
        );

      if (record.activeRunId) {
        const activeJob = await getByRun(record.activeRunId, context);
        if (!activeJob.ok) return activeJob;
        if (activeJob.value && activeJob.value.importId !== record.id)
          return failure(
            "invalid-evidence",
            "The active job belongs to another import.",
          );
        if (
          activeJob.value?.kind === "analyze" &&
          activeJob.value.importId === record.id &&
          activeJob.value.inputHash === input.selectionHash &&
          activeJob.value.consentHash === input.selectionHash &&
          activeJob.value.idempotencyKeyHash ===
            hashText(
              `${record.id}\u0000analysis:${record.id}:${record.selectionVersion}:${input.selectionHash}:${input.idempotencyKey}`,
            )
        )
          return ok(activeJob.value);
        if (
          activeJob.value &&
          (activeJob.value.state === "queued" ||
            activeJob.value.state === "running")
        )
          return failure(
            "version-conflict",
            "Another analysis run is already active.",
          );
      }

      if (record.version !== input.expectedVersion)
        return failure(
          "version-conflict",
          "This import changed. Review the current evidence before analyzing.",
        );
      const consentedAt = deps.now().toISOString();
      const queued = await deps.store.updateExpectedVersion(
        {
          id: record.id,
          expectedVersion: record.version,
          patch: {
            consent: {
              reference: input.consentReference,
              selectionVersion: record.selectionVersion,
              selectionHash: input.selectionHash,
              consentedAt,
            },
            lifecycle: "queued",
            activeRunId: null,
          },
        },
        context,
      );
      if (!queued.ok) return queued;

      const jobKey = `analysis:${record.id}:${record.selectionVersion}:${input.selectionHash}:${input.idempotencyKey}`;
      const enqueued = await deps.jobs.enqueue(
        {
          idempotencyKey: jobKey,
          importId: record.id,
          projectId: record.destinationProjectId,
          importVersion: queued.value.version,
          selectionVersion: record.selectionVersion,
          kind: "analyze",
          inputHash: input.selectionHash,
          consentHash: input.selectionHash,
          deadline: new Date(
            deps.now().getTime() + GITHUB_IMPORT_POLICY.extractionDeadlineMs,
          ).toISOString(),
          usage: prepared.value.budget,
        },
        context,
      );
      if (!enqueued.ok) return enqueued;
      const attached = await attachRun(queued.value, enqueued.value, context);
      if (!attached.ok) {
        await cancelJob(enqueued.value, context);
        return attached;
      }
      return ok(enqueued.value);
    },

    async executePrepare({ job, context }) {
      const valid = validateContext(context);
      if (!valid.ok) return valid;
      if (job.runId !== context.runId || job.kind !== "prepare")
        return failure(
          "invalid-input",
          "The preparation job identity is invalid.",
        );
      const read = await getRecord(job.importId, context);
      if (!read.ok) return read;
      let record = read.value;
      if (record.activeRunId === null && record.version === job.importVersion) {
        const attached = await attachRun(record, job, context);
        if (!attached.ok) return attached;
        record = attached.value;
      }
      const current = await runIsCurrent(job, record, "prepare", context);
      if (!current.ok) return current;
      if (record.preparedSelectionRef && record.selectionHash) {
        const prior = await loadPrepared(record, context);
        if (prior.ok && prior.value && record.activeRunId === job.runId)
          return ok(record);
      }

      const snapshot = await deps.repository.resolveSnapshot({
        scope: record.scope,
        context,
      });
      if (!snapshot.ok) return snapshot;
      if (
        snapshot.value.repositoryId !== record.scope.repositoryId ||
        snapshot.value.commitSha.toLowerCase() !==
          record.scope.commitSha.toLowerCase()
      )
        return failure(
          "invalid-evidence",
          "Repository identity or pinned revision changed.",
        );

      const inventoryKey = inventoryIdentity({
        scope: record.scope,
        snapshot: snapshot.value,
      });
      const cachedInventory = await deps.store.cacheGet(
        { identity: inventoryKey },
        context,
      );
      if (!cachedInventory.ok) return cachedInventory;
      let candidates: FileCandidate[];
      let inventoryCompleteness: "complete" | "partial";
      let inventoryLimitations: string[];
      const cachedInventoryValue = cachedInventory.value?.value;
      if (cachedInventoryValue?.kind === "inventory") {
        candidates = cachedInventoryValue.candidates;
        inventoryCompleteness = cachedInventoryValue.completeness;
        inventoryLimitations = cachedInventoryValue.limitations;
      } else {
        const inventory = await deps.repository.inventory({
          snapshot: snapshot.value,
          context,
        });
        if (!inventory.ok) return inventory;
        candidates = inventory.value.candidates;
        inventoryCompleteness = inventory.value.completeness;
        inventoryLimitations = inventory.value.limitations;
        if (
          candidates.length > 2_000 ||
          candidates.some(
            (candidate) => !FileCandidateSchema.safeParse(candidate).success,
          ) ||
          candidates.some(
            (candidate) => candidate.selected || candidate.pinned,
          ) ||
          new Set(candidates.map((candidate) => candidate.id)).size !==
            candidates.length
        )
          return failure(
            "invalid-evidence",
            "The inspected inventory is invalid or contains a preselected file.",
          );
        const stored = await deps.store.cachePut(
          {
            identity: inventoryKey,
            value: {
              kind: "inventory",
              candidates,
              completeness: inventoryCompleteness,
              limitations: inventoryLimitations,
            },
          },
          context,
        );
        if (!stored.ok) return stored;
      }

      let prContext: {
        selected: PullRequestSummary[];
        completeness: "complete" | "partial";
        limitations: string[];
      };
      if (record.scope.selectedPullRequestNumbers.length === 0) {
        prContext = { selected: [], completeness: "complete", limitations: [] };
      } else {
        const prs = await deps.pullRequests.readSelected({
          scope: record.scope,
          selectedNumbers: record.scope.selectedPullRequestNumbers,
          context,
        });
        if (!prs.ok) return prs;
        prContext = prs.value;
      }
      const selected = await deps.selector.select({
        inventory: candidates,
        scope: record.scope,
        prContext: prContext.selected,
        pinnedFileIds: record.pinnedFileIds,
        removedFileIds: record.removedFileIds,
        context,
      });
      if (!selected.ok) return selected;
      if (
        selected.value.selected.length > GITHUB_IMPORT_POLICY.filesPerRequest ||
        new Set(selected.value.selected.map((candidate) => candidate.id))
          .size !== selected.value.selected.length
      )
        return failure(
          "invalid-evidence",
          "The selector returned an invalid or oversized selection.",
        );
      const inventoryById = new Map(
        candidates.map((candidate) => [candidate.id, candidate]),
      );
      for (const candidate of selected.value.selected) {
        const source = inventoryById.get(candidate.id);
        if (
          !FileCandidateSchema.safeParse(candidate).success ||
          !source ||
          !source.eligible ||
          source.safety !== "safe" ||
          !candidate.eligible ||
          candidate.safety !== "safe" ||
          candidate.path !== source.path ||
          candidate.blobSha !== source.blobSha ||
          candidate.mode !== source.mode ||
          candidate.byteSize !== source.byteSize ||
          candidate.category !== source.category ||
          !candidate.selected ||
          candidate.pinned !== record.pinnedFileIds.includes(candidate.id)
        )
          return failure(
            "invalid-evidence",
            "The selector returned a file outside the safe inspected inventory.",
          );
      }
      const selectedIds = new Set(
        candidates
          .filter(
            (c) =>
              c.eligible &&
              c.safety === "safe" &&
              !record.removedFileIds.includes(c.id),
          )
          .map((candidate) => candidate.id),
      );
      if (
        record.pinnedFileIds.some((fileId) => !selectedIds.has(fileId)) ||
        record.pinnedFileIds.some((fileId) => {
          const candidate = candidates.find((item) => item.id === fileId);
          return (
            !candidate || !candidate.eligible || candidate.safety !== "safe"
          );
        })
      )
        return failure(
          "invalid-evidence",
          "A manually pinned file is unsafe or unavailable.",
        );

      const contentByFileId: Record<string, string> = {};
      const needsFetch: FileCandidate[] = [];
      for (const candidate of selected.value.selected) {
        const identity: ImportCacheIdentity = {
          kind: "safe-content",
          repositoryId: record.scope.repositoryId,
          blobSha: candidate.blobSha,
          parserVersion: SOURCE_PARSER_VERSION,
          safetyPolicyVersion: SAFETY_POLICY_VERSION,
        };
        const cached = await deps.store.cacheGet({ identity }, context);
        if (!cached.ok) return cached;
        const file =
          cached.value?.value.kind === "safe-content"
            ? cached.value.value.files.find(
                (item) => item.blobSha === candidate.blobSha,
              )
            : undefined;
        if (!file) {
          needsFetch.push(candidate);
          continue;
        }
        const screened = await deps.store.cachePut(
          {
            identity,
            value: {
              kind: "safe-content",
              files: [
                {
                  fileId: candidate.id,
                  path: candidate.path,
                  blobSha: candidate.blobSha,
                  content: file.content,
                },
              ],
            },
          },
          context,
        );
        if (!screened.ok) return screened;
        contentByFileId[candidate.id] = file.content;
      }
      if (needsFetch.length > 0) {
        const fetched = await deps.repository.readSelectedFiles({
          snapshot: snapshot.value,
          candidates: needsFetch,
          context,
        });
        if (!fetched.ok) return fetched;
        const byId = new Map(
          needsFetch.map((candidate) => [candidate.id, candidate]),
        );
        for (const file of fetched.value.files) {
          const candidate = byId.get(file.fileId);
          if (
            !candidate ||
            candidate.path !== file.path ||
            candidate.blobSha !== file.blobSha ||
            Object.hasOwn(contentByFileId, file.fileId)
          )
            return failure(
              "invalid-evidence",
              "Fetched source does not match the selected inventory.",
            );
          const identity: ImportCacheIdentity = {
            kind: "safe-content",
            repositoryId: record.scope.repositoryId,
            blobSha: candidate.blobSha,
            parserVersion: SOURCE_PARSER_VERSION,
            safetyPolicyVersion: SAFETY_POLICY_VERSION,
          };
          const stored = await deps.store.cachePut(
            {
              identity,
              value: {
                kind: "safe-content",
                files: [
                  {
                    fileId: candidate.id,
                    path: candidate.path,
                    blobSha: candidate.blobSha,
                    content: file.content,
                  },
                ],
              },
            },
            context,
          );
          if (!stored.ok) return stored;
          contentByFileId[candidate.id] = file.content;
        }
        if (
          needsFetch.some(
            (candidate) => !Object.hasOwn(contentByFileId, candidate.id),
          )
        )
          return failure(
            "invalid-evidence",
            "One or more selected files could not be read.",
          );
      }

      const completeness = prepareCompleteness({
        missingDimensions: selected.value.missingDimensions,
        inventoryPartial: inventoryCompleteness === "partial",
        snapshotPartial: snapshot.value.completeness === "partial",
        prPartial: prContext.completeness === "partial",
        selectedCount: selected.value.selected.length,
      });
      const limitations = unique([
        ...snapshot.value.limitations,
        ...inventoryLimitations,
        ...prContext.limitations,
        ...selected.value.limitations,
      ]).slice(0, 100);
      const packed = await deps.selector.pack({
        importId: record.id,
        selectionVersion: record.selectionVersion,
        scope: record.scope,
        selected: selected.value.selected,
        contentByFileId,
        limitations,
        completeness,
        context,
      });
      if (!packed.ok) return packed;
      const parsedPrepared = PreparedSelectionSchema.safeParse({
        ...packed.value,
        importId: record.id,
        runId: job.runId,
        version: record.selectionVersion,
        scope: record.scope,
        limitations,
        completeness,
        consentedAt: null,
      });
      if (
        !parsedPrepared.success ||
        new Set(parsedPrepared.data.selectedFileIds).size !==
          parsedPrepared.data.selectedFileIds.length ||
        (parsedPrepared.data.evidence.length === 0 &&
          parsedPrepared.data.completeness !== "needs-context") ||
        parsedPrepared.data.selectedFileIds.some(
          (fileId) => !selectedIds.has(fileId),
        ) ||
        new Set(parsedPrepared.data.evidence.map((evidence) => evidence.id))
          .size !== parsedPrepared.data.evidence.length ||
        parsedPrepared.data.evidence.some(
          (evidence) =>
            !candidates
              .filter(
                (c) =>
                  c.eligible &&
                  c.safety === "safe" &&
                  !record.removedFileIds.includes(c.id),
              )
              .some(
                (candidate) =>
                  candidate.path === evidence.path &&
                  candidate.blobSha === evidence.blobSha &&
                  candidate.category === evidence.category &&
                  evidence.commitSha === snapshot.value.commitSha &&
                  evidence.snapshotId === snapshot.value.snapshotId,
              ),
        )
      )
        return failure(
          "invalid-evidence",
          "The prepared excerpts do not match the safe selection.",
        );
      const currentAfterFetch = await getRecord(record.id, context);
      if (!currentAfterFetch.ok) return currentAfterFetch;
      const stillCurrent = await runIsCurrent(
        job,
        currentAfterFetch.value,
        "prepare",
        context,
      );
      if (!stillCurrent.ok) return stillCurrent;

      const selectedIdentity = selectedBundleIdentity(parsedPrepared.data);
      const storedBundle = await deps.store.cachePut(
        {
          identity: selectedIdentity,
          value: { kind: "selected-bundle", prepared: parsedPrepared.data },
        },
        context,
      );
      if (!storedBundle.ok) return storedBundle;
      const cachedInventoryEntry = await deps.store.cacheGet(
        { identity: inventoryKey },
        context,
      );
      if (!cachedInventoryEntry.ok) return cachedInventoryEntry;
      if (!cachedInventoryEntry.value)
        return failure(
          "io-error",
          "The inspected inventory was not retained.",
          true,
        );
      return deps.store.completePreparation(
        {
          id: record.id,
          expectedVersion: currentAfterFetch.value.version,
          runId: job.runId,
          selectionVersion: record.selectionVersion,
          selectionHash: parsedPrepared.data.selectionHash,
          preparedSelectionRef: storedBundle.value.key,
          candidateInventoryRef: cachedInventoryEntry.value.key,
        },
        context,
      );
    },

    async executeAnalyze({ job, context }) {
      const valid = validateContext(context);
      if (!valid.ok) return valid;
      if (job.runId !== context.runId || job.kind !== "analyze")
        return failure(
          "invalid-input",
          "The analysis job identity is invalid.",
        );
      const read = await getRecord(job.importId, context);
      if (!read.ok) return read;
      let record = read.value;
      if (record.activeRunId === null && record.version === job.importVersion) {
        const attached = await attachRun(record, job, context);
        if (!attached.ok) return attached;
        record = attached.value;
      }
      const current = await runIsCurrent(job, record, "analyze", context);
      if (!current.ok) return current;
      if (
        !record.selectionHash ||
        record.selectionHash !== job.inputHash ||
        job.consentHash !== record.selectionHash ||
        !record.consent ||
        record.consent.selectionHash !== record.selectionHash ||
        record.consent.selectionVersion !== record.selectionVersion
      )
        return failure(
          "forbidden",
          "Current consent for the exact evidence bundle is required.",
        );
      const prepared = await loadPrepared(record, context);
      if (!prepared.ok) return prepared;
      if (
        !prepared.value ||
        prepared.value.selectionHash !== record.selectionHash ||
        prepared.value.selectedFileIds.length === 0 ||
        prepared.value.evidence.length === 0
      )
        return failure(
          "needs-context",
          "The consented evidence bundle is unavailable.",
        );

      if (record.resultRunId === job.runId && record.resultRef) {
        const recovered = await loadResult(record, context);
        if (recovered.ok && recovered.value) return recovered;
      }

      const extracted = await deps.extractor.extract({
        prepared: {
          ...prepared.value,
          runId: job.runId,
          consentedAt: record.consent.consentedAt,
        },
        contribution: record.scope.contributionStatement,
        catalog: [...deps.catalog],
        context,
      });
      if (!extracted.ok) return extracted;
      const sanitized = sanitizeAnalysis(
        extracted.value,
        record.destinationProjectId,
        prepared.value,
      );
      if (!sanitized.ok) return sanitized;

      const after = await getRecord(record.id, context);
      if (!after.ok) return after;
      const stillCurrent = await runIsCurrent(
        job,
        after.value,
        "analyze",
        context,
      );
      if (!stillCurrent.ok) return stillCurrent;
      if (
        after.value.selectionVersion !== job.selectionVersion ||
        after.value.selectionHash !== sanitized.value.selectionHash ||
        after.value.consent?.selectionHash !== sanitized.value.selectionHash ||
        after.value.consent?.selectionVersion !== job.selectionVersion
      )
        return failure(
          "version-conflict",
          "The evidence or consent changed during analysis.",
        );
      const latestJob = await getByRun(job.runId, context);
      if (!latestJob.ok) return latestJob;
      if (
        !latestJob.value ||
        latestJob.value.importId !== record.id ||
        latestJob.value.state !== "running" ||
        latestJob.value.cancellationRequestedAt !== null ||
        latestJob.value.executionFence !== job.executionFence
      )
        return failure(
          "cancelled",
          "The analysis result was cancelled before it could be staged.",
        );

      const resultIdentity = extractionIdentity(
        prepared.value,
        sanitized.value,
      );
      const savedResult = await deps.store.cachePut(
        {
          identity: resultIdentity,
          value: { kind: "extraction-result", result: sanitized.value },
        },
        context,
      );
      if (!savedResult.ok) return savedResult;
      const history = await preserveReview(after.value, context);
      if (!history.ok) return history;
      const updated = await deps.store.completeAnalysis(
        {
          id: after.value.id,
          expectedVersion: after.value.version,
          runId: job.runId,
          selectionVersion: job.selectionVersion,
          selectionHash: sanitized.value.selectionHash,
          resultRef: savedResult.value.key,
          draftRefs: sanitized.value.drafts.map((draft) => draft.id),
          reviewHistory: history.value,
        },
        context,
      );
      if (!updated.ok) return updated;
      return ok(sanitized.value);
    },

    async get(input, context) {
      const loaded = await getRecord(input.importId, context);
      if (!loaded.ok) return loaded;
      let record = loaded.value;
      const candidates = await loadCandidates(record, context);
      if (!candidates.ok) return candidates;
      const prepared = await loadPrepared(record, context);
      if (!prepared.ok) return prepared;
      const result = await loadResult(record, context);
      if (!result.ok) return result;
      const priorReviews: ImportReviewState["priorReviews"] = [];
      for (const revision of record.reviewHistory) {
        const previousPrepared = await readCacheByRef(
          revision.preparedSelectionRef,
          "selected-bundle",
          context,
        );
        if (!previousPrepared.ok) return previousPrepared;
        const previousResult = await readCacheByRef(
          revision.resultRef,
          "extraction-result",
          context,
        );
        if (!previousResult.ok) return previousResult;
        priorReviews.push({
          runId: revision.runId,
          selectionVersion: revision.selectionVersion,
          selectionHash: revision.selectionHash,
          destinationProjectId: revision.destinationProjectId,
          prepared: previousPrepared.value?.prepared ?? null,
          result: previousResult.value?.result ?? null,
          draftEdits: revision.draftEdits,
          savedIds: revision.savedIds,
          createdAt: revision.createdAt,
        });
      }

      let lifecycle = record.lifecycle;
      if (record.activeRunId) {
        const job = await getByRun(record.activeRunId, context);
        if (!job.ok) return job;
        if (job.value) {
          if (job.value.importId !== record.id)
            return failure(
              "invalid-evidence",
              "The active job belongs to another import.",
            );
          if (job.value.state === "queued")
            lifecycle = job.value.kind === "prepare" ? "preparing" : "queued";
          else if (job.value.state === "running")
            lifecycle =
              job.value.kind === "prepare" ? "preparing" : "analyzing";
          else if (job.value.state === "completed")
            lifecycle =
              job.value.kind === "prepare"
                ? prepared.value?.completeness === "needs-context"
                  ? "needs-input"
                  : prepared.value?.completeness === "partial"
                    ? "partial"
                    : "ready-to-analyze"
                : "ready-to-review";
          else if (job.value.state === "needs-input") lifecycle = "needs-input";
          else if (job.value.state === "failed") lifecycle = "failed";
          else if (job.value.state === "cancelled") lifecycle = "cancelled";
          else if (job.value.state === "interrupted") lifecycle = "interrupted";
          if (job.value.state !== "queued" && job.value.state !== "running")
            record = { ...record, lifecycle, activeRunId: null };
          else record = { ...record, lifecycle };
        }
      }
      const claims = new Set(
        result.value?.claims.map((claim) => claim.id) ?? [],
      );
      const edits = new Map(
        record.draftEdits.map((edit) => [edit.draftId, edit]),
      );
      const measurementReview = result.value
        ? await deps.measurements.review(
            { importId: record.id, expectedVersion: record.version },
            context,
          )
        : ok({
            questions: [],
            measurementResults: [],
            draftResultIds: {} as Record<string, string[]>,
          });
      if (!measurementReview.ok) return measurementReview;
      const drafts =
        result.value?.drafts.map((draft) =>
          toEditableDraft(
            {
              ...draft,
              metricResultIds: [
                ...new Set([
                  ...draft.metricResultIds,
                  ...(measurementReview.value.draftResultIds?.[draft.id] ?? []),
                ]),
              ],
            },
            edits.get(draft.id),
            claims,
          ),
        ) ?? [];
      const state: ImportReviewState = {
        import: record,
        prepared: prepared.value
          ? {
              ...prepared.value,
              consentedAt:
                record.consent?.selectionHash === prepared.value.selectionHash
                  ? record.consent.consentedAt
                  : null,
            }
          : null,
        result: result.value ? { ...result.value, drafts } : null,
        candidates: candidates.value,
        priorReviews,
        questions: measurementReview.value.questions,
        measurementAnswers:
          "answers" in measurementReview.value
            ? (measurementReview.value.answers ?? {})
            : {},
        measurementResults: measurementReview.value.measurementResults,
        canSaveDraftIds: drafts
          .filter((draft) => draft.approvalEligible)
          .map((draft) => draft.id),
        expired:
          lifecycle === "expired" ||
          (Boolean(record.resultRef) && !result.value),
      };
      return ok(state);
    },

    async updateDraft(input, context) {
      const loaded = await getRecord(input.importId, context);
      if (!loaded.ok) return loaded;
      const record = loaded.value;
      if (record.version !== input.expectedVersion)
        return failure(
          "version-conflict",
          "This import changed. Reload before editing the draft.",
        );
      if (record.lifecycle === "approved" || record.lifecycle === "expired")
        return failure(
          "version-conflict",
          "This draft can no longer be edited.",
        );
      const result = await loadResult(record, context);
      if (!result.ok) return result;
      const draft = result.value?.drafts.find(
        (candidate) => candidate.id === input.draftId,
      );
      if (!draft)
        return failure(
          "not-found",
          "The draft is not part of this analysis result.",
        );
      if (input.text.trim().length === 0 || input.text.length > 8_000)
        return failure(
          "invalid-input",
          "Draft text must contain 1 to 8,000 characters.",
        );
      const previous = record.draftEdits.find(
        (edit) => edit.draftId === draft.id,
      );
      const localReview = await deps.measurements.review(
        { importId: record.id, expectedVersion: record.version },
        context,
      );
      if (!localReview.ok) return localReview;
      const availableMetricIds = [
        ...new Set([
          ...draft.metricResultIds,
          ...(localReview.value.draftResultIds?.[draft.id] ?? []),
        ]),
      ];
      const confirmedMetricResultIds =
        input.confirmedMetricResultIds ??
        previous?.confirmedMetricResultIds ??
        [];
      if (
        confirmedMetricResultIds.some(
          (id) => !availableMetricIds.includes(id),
        ) ||
        unique(confirmedMetricResultIds).length !==
          confirmedMetricResultIds.length
      )
        return failure(
          "invalid-input",
          "Only measurements attached to this draft can be confirmed.",
        );
      const edit: DraftEdit = {
        draftId: draft.id,
        version: (previous?.version ?? 0) + 1,
        baseResultHash: hash(draft),
        text: input.text.trim(),
        selectedForSave:
          input.selectedForSave ?? previous?.selectedForSave ?? false,
        contributionConfirmed:
          input.contributionConfirmed ??
          previous?.contributionConfirmed ??
          false,
        confirmedMetricResultIds,
        updatedAt: deps.now().toISOString(),
      };
      const edits = record.draftEdits.filter(
        (candidate) => candidate.draftId !== draft.id,
      );
      edits.push(edit);
      const saved = await deps.store.updateExpectedVersion(
        {
          id: record.id,
          expectedVersion: record.version,
          patch: { draftEdits: edits },
        },
        context,
      );
      if (!saved.ok) return saved;
      const claims = new Set(
        result.value?.claims.map((claim) => claim.id) ?? [],
      );
      return ok(
        toEditableDraft(
          { ...draft, metricResultIds: availableMetricIds },
          edit,
          claims,
        ),
      );
    },

    async approve(input, context) {
      const loaded = await getRecord(input.importId, context);
      if (!loaded.ok) return loaded;
      const record = loaded.value;
      const requestHash = hash({
        importId: record.id,
        selectionVersion: record.selectionVersion,
        selectionHash: record.selectionHash,
        destinationProjectId: record.destinationProjectId,
        selectedDraftIds: [...input.selectedDraftIds].sort(),
        idempotencyKey: input.idempotencyKey,
      });
      if (record.lifecycle === "approved") {
        if (record.approvalKeyHash !== requestHash)
          return failure(
            "version-conflict",
            "This import was already approved with a different selection.",
          );
        return ok({ savedIds: record.savedIds });
      }
      if (record.version !== input.expectedVersion)
        return failure(
          "version-conflict",
          "This import changed. Review it before saving.",
        );
      if (!ID_PATTERN.test(input.idempotencyKey))
        return failure(
          "invalid-input",
          "A valid approval idempotency key is required.",
        );
      if (
        !record.selectionHash ||
        !record.consent ||
        record.consent.selectionHash !== record.selectionHash ||
        record.consent.selectionVersion !== record.selectionVersion
      )
        return failure(
          "forbidden",
          "The current evidence selection has not been consented to.",
        );
      const result = await loadResult(record, context);
      if (!result.ok) return result;
      if (!result.value || result.value.selectionHash !== record.selectionHash)
        return failure(
          "needs-context",
          "A completed analysis is required before saving.",
        );
      if (record.activeRunId) {
        const job = await getByRun(record.activeRunId, context);
        if (!job.ok) return job;
        if (
          !job.value ||
          job.value.importId !== record.id ||
          job.value.kind !== "analyze" ||
          job.value.state !== "completed" ||
          record.resultRunId !== job.value.runId
        )
          return failure(
            "version-conflict",
            "The current analysis is not ready to review.",
          );
      } else {
        return failure(
          "version-conflict",
          "The completed analysis run could not be verified.",
        );
      }
      const selectedIds = unique(input.selectedDraftIds);
      if (
        selectedIds.length === 0 ||
        selectedIds.length !== input.selectedDraftIds.length
      )
        return failure(
          "invalid-input",
          "Select at least one unique draft to save.",
        );
      const claims = new Set(result.value.claims.map((claim) => claim.id));
      const edits = new Map(
        record.draftEdits.map((edit) => [edit.draftId, edit]),
      );
      const localReview = await deps.measurements.review(
        { importId: record.id, expectedVersion: record.version },
        context,
      );
      if (!localReview.ok) return localReview;
      const drafts = result.value.drafts.map((draft) =>
        toEditableDraft(
          {
            ...draft,
            metricResultIds: [
              ...new Set([
                ...draft.metricResultIds,
                ...(localReview.value.draftResultIds?.[draft.id] ?? []),
              ]),
            ],
          },
          edits.get(draft.id),
          claims,
        ),
      );
      const selected = selectedIds.map((id) =>
        drafts.find((draft) => draft.id === id),
      );
      if (selected.some((draft) => !draft))
        return failure(
          "invalid-input",
          "A selected draft is not part of this result.",
        );
      if (
        selected.some(
          (draft) => !draft!.selectedForSave || !draft!.approvalEligible,
        )
      )
        return failure(
          "needs-context",
          "Every selected draft needs contribution confirmation and supported evidence.",
        );
      const approved = await deps.approve.approveGithubImport(
        {
          importId: record.id,
          expectedVersion: record.version,
          selectedDraftIds: selectedIds,
          idempotencyKey: input.idempotencyKey,
        },
        context,
      );
      if (!approved.ok) return approved;
      const persisted = await deps.store.updateExpectedVersion(
        {
          id: record.id,
          expectedVersion: record.version,
          patch: {
            lifecycle: "approved",
            activeRunId: null,
            savedIds: approved.value.savedIds,
            approvalKeyHash: requestHash,
          },
        },
        context,
      );
      if (!persisted.ok) return persisted;
      return approved;
    },

    async cancel(input, context) {
      const loaded = await getRecord(input.importId, context);
      if (!loaded.ok) return loaded;
      const record = loaded.value;
      if (record.activeRunId !== input.runId)
        return failure(
          "version-conflict",
          "This run is no longer active for the import.",
        );
      const job = await getByRun(input.runId, context);
      if (!job.ok) return job;
      if (!job.value || job.value.importId !== record.id)
        return failure("not-found", "The active background job was not found.");
      if (job.value.state !== "queued" && job.value.state !== "running")
        return failure(
          "version-conflict",
          "The background job already finished.",
        );
      const cancelledRecord = await deps.store.updateExpectedVersion(
        {
          id: record.id,
          expectedVersion: record.version,
          patch: {
            lifecycle: "cancelled",
            activeRunId: null,
            consent: null,
          },
        },
        context,
      );
      if (!cancelledRecord.ok) return cancelledRecord;
      const cancelled = await cancelJob(job.value, context);
      if (!cancelled.ok) return cancelled;
      return cancelledRecord;
    },

    async discard(input, context) {
      const loaded = await getRecord(input.importId, context);
      if (!loaded.ok) return loaded;
      const record = loaded.value;
      if (record.version !== input.expectedVersion)
        return failure(
          "version-conflict",
          "This import changed. Reload before discarding it.",
        );
      if (record.lifecycle === "approved" || record.savedIds.length > 0)
        return failure(
          "forbidden",
          "Saved achievements cannot be discarded with their import.",
        );
      if (record.activeRunId) {
        const job = await getByRun(record.activeRunId, context);
        if (!job.ok) return job;
        if (job.value && job.value.importId !== record.id)
          return failure(
            "invalid-evidence",
            "The active job belongs to another import.",
          );
        if (job.value) {
          const cancelled = await cancelJob(job.value, context);
          if (!cancelled.ok && cancelled.error.code !== "version-conflict")
            return cancelled;
        }
      }
      return deps.store.discard(
        { id: record.id, expectedVersion: record.version },
        context,
      );
    },
  };
};
