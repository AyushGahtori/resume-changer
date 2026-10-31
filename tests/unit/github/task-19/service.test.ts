import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  err,
  ok,
  type AnalysisResult,
  type BudgetSnapshot,
  type ExecutionContext,
  type FileCandidate,
  type ImportCacheEntry,
  type ImportCacheIdentity,
  type ImportCacheValue,
  type ImportRecord,
  type JobRecord,
  type PreparedSelection,
  type Result,
} from "../../../../src/lib/github/contracts";
import type {
  ApprovalPort,
  EvidenceSelectorPort,
  ImportServiceFactory,
  ImportStorePort,
  JobStorePort,
  PrContextReaderPort,
  RepositoryInspectorPort,
} from "../../../../src/lib/github/ports";
import { createImportService } from "../../../../src/lib/github/server/service";
import { githubImportFixtureScope } from "../../../fixtures/github/gate0";

const NOW = "2026-10-27T10:00:00.000Z";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const BODY_ONE = "export function summarize(rows) { return rows.length; }\n";
const BODY_TWO = "export function normalize(value) { return value.trim(); }\n";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function candidate(
  id: string,
  path: string,
  content: string,
  category: FileCandidate["category"] = "implementation",
): FileCandidate {
  return {
    id,
    path,
    blobSha: createHash("sha1")
      .update(`blob ${Buffer.byteLength(content)}\0`)
      .update(content)
      .digest("hex"),
    mode: "100644",
    byteSize: Buffer.byteLength(content),
    category,
    reasonCodes: ["selected-pr-path"],
    safety: "safe",
    eligible: true,
    selected: false,
    pinned: false,
  };
}

function emptyBudgetSnapshot(): BudgetSnapshot {
  return {
    requests: 0,
    pullRequestRequests: 0,
    fetchedBodies: 0,
    fetchedBytes: 0,
    uniqueFiles: 0,
    uniqueLines: 0,
    transmittedLines: 0,
    inputTokens: 0,
    generationAttempts: 0,
  };
}

function makeContext(runId = "request-run"): ExecutionContext {
  const budget = {
    reserve: vi.fn(async () => ok({ reservationId: "reservation-one" })),
    commitUsage: vi.fn(async () => ok(emptyBudgetSnapshot())),
    checkSelection: vi.fn(() => ok({ allowed: true, reason: null })),
    remaining: vi.fn(() => ok(emptyBudgetSnapshot())),
    snapshot: vi.fn(() => ok(emptyBudgetSnapshot())),
  };
  return {
    personalRoot: "C:/fake-personal-root",
    access: {
      sessionId: "session-one",
      authorizationNamespace: "account-one",
      accountId: "account-one",
      grantedRepositoryIds: [githubImportFixtureScope.repositoryId],
    },
    signal: new AbortController().signal,
    now: () => new Date(NOW),
    runId,
    deadline: new Date(Date.parse(NOW) + 120_000).toISOString(),
    budget,
  };
}

function analysisFor(prepared: PreparedSelection): AnalysisResult {
  const claimId = "summary-claim";
  return {
    summary: "The selected source implements summary aggregation.",
    claims: [
      {
        id: claimId,
        text: "The source implements summary aggregation.",
        evidenceIds: [prepared.evidence[0]!.id],
        userStatementIds: [],
        classification: "observed",
        confirmedByUser: true,
        confirmationVersion: 1,
        limitations: [],
      },
    ],
    drafts: [
      {
        id: "summary-draft",
        version: 1,
        projectId: "project-one",
        text: "Implemented summary aggregation for the reporting workflow.",
        reviewedBaseText:
          "Implemented summary aggregation for the reporting workflow.",
        claimIds: [claimId],
        supportStatus: "supported",
        selectedForSave: true,
        contributionConfirmed: true,
        metricResultIds: [],
        approvalEligible: true,
        approvalErrors: [],
      },
    ],
    questionSuggestions: [],
    limitations: [],
    model: "fake-model",
    finishReason: "stop",
    usage: {
      promptTokens: null,
      cachedTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      totalTokens: null,
    },
    selectionHash: prepared.selectionHash,
  };
}

function makePrepared(input: {
  importId: string;
  selectionVersion: number;
  runId: string;
  scope: typeof githubImportFixtureScope;
  selected: FileCandidate[];
  contentByFileId: Record<string, string>;
  completeness: PreparedSelection["completeness"];
  limitations: string[];
}): PreparedSelection {
  const evidence = input.selected.map((item) => {
    const excerpt = input.contentByFileId[item.id]!;
    return {
      id: `evidence-${item.id}`,
      snapshotId: "snapshot-one",
      commitSha: input.scope.commitSha,
      path: item.path,
      blobSha: item.blobSha,
      pointer: { kind: "lines" as const, startLine: 1, endLine: 1 },
      excerpt,
      excerptSha256: sha256(excerpt),
      category: item.category,
      classification: "observed" as const,
    };
  });
  const selectionHash = sha256(
    canonical({
      scope: input.scope,
      selectedFileIds: input.selected.map((item) => item.id),
      evidence: evidence.map(({ id, blobSha, excerptSha256 }) => ({
        id,
        blobSha,
        excerptSha256,
      })),
    }),
  );
  return {
    importId: input.importId,
    runId: input.runId,
    version: input.selectionVersion,
    selectionHash,
    scope: input.scope,
    selectedFileIds: input.selected.map((item) => item.id),
    evidence,
    limitations: input.limitations,
    completeness: input.completeness,
    budget: {
      fetchedFiles: input.selected.length,
      fetchedBytes: Object.values(input.contentByFileId).reduce(
        (sum, content) => sum + Buffer.byteLength(content),
        0,
      ),
      httpAttempts: 0,
      selectedUniqueFiles: input.selected.length,
      selectedUniqueLines: input.selected.length,
      selectedCharacters: Object.values(input.contentByFileId).join("").length,
      transmittedLinesByRequest: [],
      cumulativeTransmittedLines: 0,
      estimatedInputTokens: null,
      reportedInputTokens: null,
      limitReason: null,
    },
    providerDisclosure:
      "No source has been sent to an AI provider. Consent is required for this exact selection.",
    consentedAt: null,
  };
}

function harness(
  options: {
    prFree?: boolean;
    partial?: boolean;
    needsContext?: boolean;
    missingDimensions?: string[];
    packedCompleteness?: PreparedSelection["completeness"];
    packedLimitations?: string[];
    emptyEvidence?: boolean;
    emptySelection?: boolean;
    cancelBeforeAnalysisCommit?: boolean;
    includeSecondCandidate?: boolean;
    approvalFails?: boolean;
  } = {},
) {
  let record: ImportRecord | null = null;
  let nextJob = 0;
  let nextRun = 0;
  let nextImport = 0;
  let candidateInventory: FileCandidate[] = [
    candidate("summary-source", "apps/dashboard/src/summary.ts", BODY_ONE),
    ...(options.includeSecondCandidate
      ? [
          candidate(
            "normalizer-source",
            "apps/dashboard/src/normalize.ts",
            BODY_TWO,
          ),
        ]
      : []),
    {
      id: "blocked-example",
      path: "config/.env.example",
      blobSha: SHA,
      mode: "100644",
      byteSize: 50,
      category: "other",
      reasonCodes: ["secret-bearing-config-pattern"],
      safety: "blocked",
      eligible: false,
      selected: false,
      pinned: false,
    },
  ];
  const bodies = new Map([
    ["summary-source", BODY_ONE],
    ["normalizer-source", BODY_TWO],
  ]);
  const cache = new Map<string, ImportCacheEntry>();
  const cacheByIdentity = new Map<string, ImportCacheEntry>();
  const jobsByRun = new Map<string, JobRecord>();
  const jobsByKey = new Map<string, JobRecord>();

  const store = {
    create: vi.fn(async (input, context): Promise<Result<ImportRecord>> => {
      nextImport += 1;
      const importId = `import-${nextImport}`;
      const recordValue = {
        id: importId,
        version: 1,
        source: input.source,
        destinationProjectId: input.destinationProjectId,
        authorizationNamespaceHash: sha256(
          context.access.authorizationNamespace,
        ),
        scope: input.scope,
        selectionVersion: 1,
        selectionHash: null,
        lifecycle: "created" as const,
        activeRunId: null,
        consent: null,
        preparedSelectionRef: null,
        resultRef: null,
        resultRunId: null,
        approvalKeyHash: null,
        draftRefs: [],
        draftEdits: [],
        reviewHistory: [],
        savedIds: [],
        retentionDeadline: new Date(Date.parse(NOW) + 86_400_000).toISOString(),
        createdAt: NOW,
        updatedAt: NOW,
      };
      const { ImportRecordSchema } =
        await import("../../../../src/lib/github/contracts");
      record = ImportRecordSchema.parse(recordValue);
      return ok(record);
    }),
    get: vi.fn(async ({ id }, context): Promise<Result<ImportRecord>> => {
      if (!record || record.id !== id)
        return err({
          code: "not-found",
          message: "Import not found.",
          retryable: false,
        });
      if (
        !context.access.grantedRepositoryIds.includes(record.scope.repositoryId)
      )
        return err({
          code: "forbidden",
          message: "No grant.",
          retryable: false,
        });
      return ok(record);
    }),
    updateExpectedVersion: vi.fn(
      async (
        { id, expectedVersion, patch },
        context,
      ): Promise<Result<ImportRecord>> => {
        if (!record || record.id !== id)
          return err({
            code: "not-found",
            message: "Import not found.",
            retryable: false,
          });
        if (record.version !== expectedVersion)
          return err({
            code: "version-conflict",
            message: "Stale import.",
            retryable: false,
          });
        const changedSelection =
          (patch.scope && canonical(patch.scope) !== canonical(record.scope)) ||
          (patch.destinationProjectId &&
            patch.destinationProjectId !== record.destinationProjectId) ||
          (patch.pinnedFileIds &&
            canonical(patch.pinnedFileIds) !==
              canonical(record.pinnedFileIds)) ||
          (patch.removedFileIds &&
            canonical(patch.removedFileIds) !==
              canonical(record.removedFileIds)) ||
          (patch.selectionHash !== undefined &&
            patch.selectionHash !== record.selectionHash);
        const next = {
          ...record,
          ...patch,
          version: record.version + 1,
          updatedAt: NOW,
        };
        if (changedSelection) {
          Object.assign(next, {
            selectionVersion: record.selectionVersion + 1,
            selectionHash: null,
            consent: null,
            preparedSelectionRef: null,
            candidateInventoryRef: null,
            resultRef: null,
            resultRunId: null,
            approvalKeyHash: null,
            draftRefs: [],
            draftEdits: [],
            savedIds: [],
            activeRunId: null,
            lifecycle: "created",
          });
        }
        const { ImportRecordSchema } =
          await import("../../../../src/lib/github/contracts");
        record = ImportRecordSchema.parse(next);
        return ok(record);
      },
    ),
    completePreparation: vi.fn(async (input): Promise<Result<ImportRecord>> => {
      if (
        !record ||
        record.id !== input.id ||
        record.version !== input.expectedVersion
      )
        return err({
          code: "version-conflict",
          message: "Stale preparation.",
          retryable: false,
        });
      if (
        record.lifecycle !== "preparing" ||
        !record.activeRunId ||
        record.activeRunId !== input.runId ||
        record.selectionVersion !== input.selectionVersion
      )
        return err({
          code: "version-conflict",
          message: "Preparation is no longer current.",
          retryable: false,
        });
      if (jobsByRun.get(input.runId)?.state !== "running")
        return err({
          code: "cancelled",
          message: "Preparation was cancelled.",
          retryable: false,
        });
      record = {
        ...record,
        selectionHash: input.selectionHash,
        preparedSelectionRef: input.preparedSelectionRef,
        candidateInventoryRef: input.candidateInventoryRef,
        version: record.version + 1,
        updatedAt: NOW,
      };
      return ok(record);
    }),
    completeAnalysis: vi.fn(async (input): Promise<Result<ImportRecord>> => {
      if (
        !record ||
        record.id !== input.id ||
        record.version !== input.expectedVersion
      )
        return err({
          code: "version-conflict",
          message: "Stale analysis.",
          retryable: false,
        });
      if (
        record.activeRunId !== input.runId ||
        record.selectionVersion !== input.selectionVersion ||
        record.selectionHash !== input.selectionHash ||
        !record.consent ||
        record.consent.selectionVersion !== input.selectionVersion ||
        record.consent.selectionHash !== input.selectionHash ||
        jobsByRun.get(input.runId)?.state !== "running"
      )
        return err({
          code: "cancelled",
          message: "Analysis no longer owns the consented selection.",
          retryable: false,
        });
      record = {
        ...record,
        resultRef: input.resultRef,
        resultRunId: input.runId,
        draftRefs: input.draftRefs,
        draftEdits: [],
        reviewHistory: input.reviewHistory,
        lifecycle: "analyzing",
        version: record.version + 1,
        updatedAt: NOW,
      };
      return ok(record);
    }),
    discard: vi.fn(
      async ({ id, expectedVersion }): Promise<Result<{ discarded: true }>> => {
        if (!record || record.id !== id || record.version !== expectedVersion)
          return err({
            code: "version-conflict",
            message: "Stale import.",
            retryable: false,
          });
        record = null;
        return ok({ discarded: true });
      },
    ),
    cacheGet: vi.fn(
      async ({ identity }): Promise<Result<ImportCacheEntry | null>> =>
        ok(cacheByIdentity.get(canonical(identity)) ?? null),
    ),
    cacheGetByKey: vi.fn(
      async ({ key }): Promise<Result<ImportCacheEntry | null>> =>
        ok(cache.get(key) ?? null),
    ),
    cachePut: vi.fn(
      async ({ identity, value }): Promise<Result<ImportCacheEntry>> => {
        if (
          options.cancelBeforeAnalysisCommit &&
          value.kind === "extraction-result" &&
          record?.activeRunId
        ) {
          const activeJob = jobsByRun.get(record.activeRunId);
          if (activeJob)
            jobsByRun.set(activeJob.runId, {
              ...activeJob,
              state: "cancelled",
              stage: "cancelled",
              cancellationRequestedAt: NOW,
              lease: null,
              updatedAt: NOW,
            });
        }
        const key = sha256(canonical({ identity, namespace: "account-one" }));
        const entry: ImportCacheEntry = {
          key,
          authorizationNamespaceHash: sha256("account-one"),
          identity,
          value,
          valueHash: sha256(canonical(value)),
          createdAt: NOW,
          expiresAt: new Date(Date.parse(NOW) + 86_400_000).toISOString(),
          byteSize: Math.max(1, Buffer.byteLength(canonical(value))),
        };
        cache.set(key, entry);
        cacheByIdentity.set(canonical(identity), entry);
        return ok(entry);
      },
    ),
  } as unknown as ImportStorePort;

  const jobs = {
    enqueue: vi.fn(async (input, context): Promise<Result<JobRecord>> => {
      const idempotencyKeyHash = sha256(
        `${input.importId}\0${input.idempotencyKey}`,
      );
      const prior = jobsByKey.get(idempotencyKeyHash);
      if (prior) return ok(prior);
      nextJob += 1;
      nextRun += 1;
      const job: JobRecord = {
        id: `job-${nextJob}`,
        runId: `run-${nextRun}`,
        importId: input.importId,
        projectId: input.projectId,
        importVersion: input.importVersion,
        selectionVersion: input.selectionVersion,
        idempotencyKeyHash,
        kind: input.kind,
        state: "queued",
        stage: "queued",
        inputHash: input.inputHash,
        consentHash: input.consentHash,
        executionFence: 0,
        lease: null,
        checkpoint: null,
        cancellationRequestedAt: null,
        deadline: input.deadline,
        usage: input.usage,
        error: null,
        resultRef: null,
        outboxEvents: [],
        createdAt: NOW,
        updatedAt: NOW,
      };
      jobsByRun.set(job.runId, job);
      jobsByKey.set(idempotencyKeyHash, job);
      return ok(job);
    }),
    getByRunId: vi.fn(async ({ runId }): Promise<Result<JobRecord | null>> =>
      ok(jobsByRun.get(runId) ?? null),
    ),
    requestCancel: vi.fn(async ({ jobId }): Promise<Result<JobRecord>> => {
      const job = [...jobsByRun.values()].find((item) => item.id === jobId);
      if (!job)
        return err({
          code: "not-found",
          message: "Job missing.",
          retryable: false,
        });
      const cancelled = {
        ...job,
        state: "cancelled" as const,
        stage: "cancelled",
        cancellationRequestedAt: NOW,
        lease: null,
        updatedAt: NOW,
      };
      jobsByRun.set(job.runId, cancelled);
      return ok(cancelled);
    }),
  } as unknown as JobStorePort;

  const first = candidate(
    "summary-source",
    "apps/dashboard/src/summary.ts",
    BODY_ONE,
  );
  const second = candidate(
    "normalizer-source",
    "apps/dashboard/src/normalize.ts",
    BODY_TWO,
  );
  const snapshot = {
    snapshotId: "snapshot-one",
    repositoryId: githubImportFixtureScope.repositoryId,
    commitSha: githubImportFixtureScope.commitSha,
    treeSha: SHA,
    observedAt: NOW,
    completeness: options.partial
      ? ("partial" as const)
      : ("complete" as const),
    limitations: options.partial ? ["The tree was truncated."] : [],
  };
  const readSelectedFiles = vi.fn(
    async (
      input: Parameters<RepositoryInspectorPort["readSelectedFiles"]>[0],
    ) =>
      ok({
        files: input.candidates.map((item) => ({
          fileId: item.id,
          path: item.path,
          blobSha: item.blobSha,
          content: bodies.get(item.id)!,
        })),
      }),
  );
  const repository = {
    resolveSnapshot: vi.fn(async () => ok(snapshot)),
    inventory: vi.fn(async () =>
      ok({
        candidates: candidateInventory,
        completeness: options.partial
          ? ("partial" as const)
          : ("complete" as const),
        limitations: options.partial ? ["The inventory is incomplete."] : [],
      }),
    ),
    readSelectedFiles,
  } as unknown as RepositoryInspectorPort;
  const pullRequests = {
    listCandidates: vi.fn(async () =>
      ok({
        candidates: [],
        completeness: "complete" as const,
        limitations: [],
      }),
    ),
    readSelected: vi.fn(
      async (input: Parameters<PrContextReaderPort["readSelected"]>[0]) =>
        ok({
          selected: input.selectedNumbers.map((number) => ({
            number,
            title: "Add summary aggregation",
            state: "merged" as const,
            authorLogin: "example-contributor",
            updatedAt: NOW,
            changedPaths: ["apps/dashboard/src/summary.ts"],
            headSha: SHA,
            baseSha: githubImportFixtureScope.commitSha,
            selected: true,
          })),
          completeness: "complete" as const,
          limitations: [],
        }),
    ),
  } as unknown as PrContextReaderPort;
  const selector = {
    select: vi.fn(
      async (input: Parameters<EvidenceSelectorPort["select"]>[0]) => {
        const safe = input.inventory.filter(
          (item) =>
            item.eligible &&
            item.safety === "safe" &&
            !(input.removedFileIds ?? []).includes(item.id),
        );
        const selected = safe
          .filter(
            (item) =>
              !options.emptySelection &&
              (item.id === first.id || input.pinnedFileIds.includes(item.id)),
          )
          .map((item) => ({
            ...item,
            selected: true,
            pinned: input.pinnedFileIds.includes(item.id),
          }));
        return ok({
          selected,
          missingDimensions:
            options.missingDimensions ??
            (options.needsContext ? ["team-role"] : []),
          limitations: [],
        });
      },
    ),
    pack: vi.fn(async (input: Parameters<EvidenceSelectorPort["pack"]>[0]) =>
      ok({
        ...makePrepared({
          importId: input.importId,
          selectionVersion: input.selectionVersion,
          runId: input.context.runId,
          scope: input.scope,
          selected: input.selected,
          contentByFileId: input.contentByFileId,
          completeness: options.packedCompleteness ?? input.completeness,
          limitations: [
            ...input.limitations,
            ...(options.packedLimitations ?? []),
          ],
        }),
        ...(options.emptyEvidence ? { evidence: [] } : {}),
      }),
    ),
  } as unknown as EvidenceSelectorPort;
  const extractor = {
    extract: vi.fn(async ({ prepared }) => ok(analysisFor(prepared))),
  };
  const measurements = {
    review: vi.fn(async () => ok({ questions: [], measurementResults: [] })),
    questions: vi.fn(async () => ok([])),
    answer: vi.fn(async () => ok({ version: 1, result: null })),
    defer: vi.fn(async () =>
      ok({ deferredTaskId: "deferred-one", retentionDeadline: NOW }),
    ),
    preview: vi.fn(async () => ok({ text: "", hash: SHA })),
  };
  const approval = {
    approveGithubImport: vi.fn(async () =>
      options.approvalFails
        ? err({
            code: "io-error",
            message: "Library write failed.",
            retryable: true,
          })
        : ok({ savedIds: ["saved-one"] }),
    ),
    updateImportedAchievement: vi.fn(async () =>
      ok({ achievementId: "saved-one", version: 2 }),
    ),
  } as ApprovalPort;
  const service = createImportService({
    store,
    jobs,
    repository,
    pullRequests,
    selector,
    extractor,
    catalog: [],
    measurements,
    approve: approval,
    now: () => new Date(NOW),
  } as Parameters<ImportServiceFactory>[0]);

  function running(job: JobRecord): JobRecord {
    const current = jobsByRun.get(job.runId)!;
    const claimed: JobRecord = {
      ...current,
      state: "running",
      stage: "running",
      executionFence: 1,
      lease: {
        owner: "worker-one",
        expiresAt: new Date(Date.parse(NOW) + 60_000).toISOString(),
        fence: 1,
      },
      updatedAt: NOW,
    };
    jobsByRun.set(job.runId, claimed);
    return claimed;
  }

  function finish(job: JobRecord, resultRef = SHA) {
    const current = jobsByRun.get(job.runId)!;
    jobsByRun.set(job.runId, {
      ...current,
      state: "completed",
      stage: "ready-to-review",
      lease: null,
      resultRef,
      updatedAt: NOW,
    });
  }

  return {
    service,
    store,
    jobs,
    repository,
    readSelectedFiles,
    pullRequests,
    selector,
    extractor,
    measurements,
    approval,
    context: makeContext(),
    running,
    finish,
    get record() {
      return record;
    },
    setCandidates(value: FileCandidate[]) {
      candidateInventory = value;
    },
  };
}

async function unwrap<T>(result: Result<T>): Promise<T> {
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

async function prepare(
  h: ReturnType<typeof harness>,
  scope = githubImportFixtureScope,
) {
  const created = await unwrap(
    await h.service.create(
      { source: "personal", destinationProjectId: "project-one", scope },
      h.context,
    ),
  );
  const queued = await unwrap(
    await h.service.prepare(
      { importId: created.id, expectedVersion: created.version },
      h.context,
    ),
  );
  const running = h.running(queued);
  const workerContext = { ...h.context, runId: running.runId };
  const preparedRecord = await unwrap(
    await h.service.executePrepare({ job: running, context: workerContext }),
  );
  h.finish(queued);
  return { created, queued, running, preparedRecord, workerContext };
}

async function analyze(
  h: ReturnType<typeof harness>,
  preparedRecord: ImportRecord,
) {
  const queued = await unwrap(
    await h.service.enqueueAnalysis(
      {
        importId: preparedRecord.id,
        expectedVersion: preparedRecord.version,
        selectionHash: preparedRecord.selectionHash!,
        consentReference: "consent-one",
        idempotencyKey: "analysis-one",
      },
      h.context,
    ),
  );
  const running = h.running(queued);
  const workerContext = { ...h.context, runId: running.runId };
  const result = await unwrap(
    await h.service.executeAnalyze({ job: running, context: workerContext }),
  );
  h.finish(queued);
  return { queued, running, workerContext, result, record: h.record! };
}

describe("GitHub import service orchestration", () => {
  it("keeps missing corroboration analyzable as partial evidence without calling AI during preparation", async () => {
    const h = harness({
      missingDimensions: ["corroboration"],
      packedCompleteness: "partial",
    });
    const { preparedRecord } = await prepare(h);
    const state = await unwrap(
      await h.service.get({ importId: preparedRecord.id }, h.context),
    );
    expect(state.prepared?.completeness).toBe("partial");
    expect(state.import.lifecycle).toBe("partial");
    expect(state.prepared?.limitations.join(" ")).toContain("No test evidence");
    expect(h.extractor.extract).not.toHaveBeenCalled();
  });
  it.each(["method", "attribution", "unknown-critical-requirement"])(
    "still blocks a missing %s requirement",
    async (dimension) => {
      const h = harness({
        missingDimensions: [dimension],
        packedCompleteness: "complete",
      });
      const { preparedRecord } = await prepare(h);
      const state = await unwrap(
        await h.service.get({ importId: preparedRecord.id }, h.context),
      );
      expect(state.prepared?.completeness).toBe("needs-context");
      expect(h.extractor.extract).not.toHaveBeenCalled();
    },
  );
  it("preserves a stricter packed verdict and the packer's recovery explanation", async () => {
    const h = harness({
      packedCompleteness: "needs-context",
      packedLimitations: ["A pinned file could not be included safely."],
    });
    const { preparedRecord } = await prepare(h);
    const state = await unwrap(
      await h.service.get({ importId: preparedRecord.id }, h.context),
    );
    expect(state.prepared?.completeness).toBe("needs-context");
    expect(state.prepared?.limitations).toContain(
      "A pinned file could not be included safely.",
    );
  });
  it("blocks an empty final evidence bundle even when the earlier plan looked complete", async () => {
    const h = harness({ emptyEvidence: true });
    const { preparedRecord } = await prepare(h);
    const state = await unwrap(
      await h.service.get({ importId: preparedRecord.id }, h.context),
    );
    expect(state.prepared?.completeness).toBe("needs-context");
    expect(h.extractor.extract).not.toHaveBeenCalled();
  });

  it("prepares a pinned snapshot and does not fall back to unselected PRs", async () => {
    const h = harness({ prFree: true });
    const scope = {
      ...githubImportFixtureScope,
      selectedPullRequestNumbers: [],
    };
    const { preparedRecord } = await prepare(h, scope);
    const review = await unwrap(
      await h.service.get({ importId: preparedRecord.id }, h.context),
    );

    expect(preparedRecord.selectionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(review.prepared?.scope.commitSha).toBe(scope.commitSha);
    expect(review.prepared?.selectedFileIds).toEqual(["summary-source"]);
    expect(h.pullRequests.readSelected).not.toHaveBeenCalled();
    expect(h.pullRequests.listCandidates).not.toHaveBeenCalled();
    expect(h.repository.resolveSnapshot).toHaveBeenCalledTimes(1);
  });

  it("reports partial coverage and reuses cached inventory/content for a safe manual addition", async () => {
    const h = harness({ partial: true, includeSecondCandidate: true });
    const { preparedRecord } = await prepare(h);
    const changed = await unwrap(
      await h.service.changeSelection(
        {
          importId: preparedRecord.id,
          expectedVersion: preparedRecord.version,
          scope: githubImportFixtureScope,
          pinnedFileIds: ["normalizer-source"],
        },
        h.context,
      ),
    );
    const queued = await unwrap(
      await h.service.prepare(
        { importId: changed.id, expectedVersion: changed.version },
        h.context,
      ),
    );
    const running = h.running(queued);
    const secondPrepared = await unwrap(
      await h.service.executePrepare({
        job: running,
        context: { ...h.context, runId: running.runId },
      }),
    );
    const review = await unwrap(
      await h.service.get({ importId: secondPrepared.id }, h.context),
    );

    expect(review.prepared?.completeness).toBe("partial");
    expect(
      review.candidates.find((item) => item.id === "normalizer-source")?.pinned,
    ).toBe(false);
    expect(review.prepared?.selectedFileIds).toEqual([
      "summary-source",
      "normalizer-source",
    ]);
    expect(h.repository.inventory).toHaveBeenCalledTimes(1);
    expect(h.readSelectedFiles).toHaveBeenCalledTimes(2);
    expect(
      h.readSelectedFiles.mock.calls[1]?.[0].candidates.map((item) => item.id),
    ).toEqual(["normalizer-source"]);
    expect(h.selector.select).toHaveBeenCalledTimes(2);
  });

  it("rejects unsafe manual pins before changing versions or queuing work", async () => {
    const h = harness();
    const { preparedRecord } = await prepare(h);
    const beforeCalls = (h.jobs.enqueue as unknown as ReturnType<typeof vi.fn>)
      .mock.calls.length;
    const result = await h.service.changeSelection(
      {
        importId: preparedRecord.id,
        expectedVersion: preparedRecord.version,
        scope: githubImportFixtureScope,
        pinnedFileIds: ["blocked-example"],
      },
      h.context,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid-evidence");
    expect(h.record?.version).toBe(preparedRecord.version);
    expect(
      (h.jobs.enqueue as unknown as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(beforeCalls);
  });

  it("requires exact prepared consent and returns the same run for duplicate intent", async () => {
    const h = harness();
    const { preparedRecord } = await prepare(h);
    const enqueueCountBeforeMismatch = (
      h.jobs.enqueue as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.length;
    const mismatch = await h.service.enqueueAnalysis(
      {
        importId: preparedRecord.id,
        expectedVersion: preparedRecord.version,
        selectionHash: "f".repeat(64),
        consentReference: "consent-one",
        idempotencyKey: "analysis-one",
      },
      h.context,
    );
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.error.code).toBe("version-conflict");
    expect(h.extractor.extract).not.toHaveBeenCalled();

    const input = {
      importId: preparedRecord.id,
      expectedVersion: preparedRecord.version,
      selectionHash: preparedRecord.selectionHash!,
      consentReference: "consent-one",
      idempotencyKey: "analysis-one",
    };
    const first = await unwrap(
      await h.service.enqueueAnalysis(input, h.context),
    );
    const latest = h.record!;
    const duplicate = await unwrap(
      await h.service.enqueueAnalysis(
        { ...input, expectedVersion: latest.version },
        h.context,
      ),
    );

    expect(duplicate.runId).toBe(first.runId);
    expect(h.jobs.enqueue).toHaveBeenCalledTimes(
      enqueueCountBeforeMismatch + 1,
    );
  });

  it("returns needs-input for missing role context and for an empty safe selection", async () => {
    const contextMissing = harness({ needsContext: true });
    const first = await prepare(contextMissing);
    const firstReview = await unwrap(
      await contextMissing.service.get(
        { importId: first.preparedRecord.id },
        contextMissing.context,
      ),
    );
    expect(firstReview.import.lifecycle).toBe("needs-input");
    expect(firstReview.prepared?.completeness).toBe("needs-context");

    const noSafeSelection = harness({ emptySelection: true });
    const second = await prepare(noSafeSelection);
    const secondReview = await unwrap(
      await noSafeSelection.service.get(
        { importId: second.preparedRecord.id },
        noSafeSelection.context,
      ),
    );
    expect(secondReview.import.lifecycle).toBe("needs-input");
    expect(secondReview.prepared?.selectedFileIds).toEqual([]);
  });

  it("versions destination changes and requires a fresh prepared consent", async () => {
    const h = harness();
    const { preparedRecord } = await prepare(h);
    const changed = await unwrap(
      await h.service.changeSelection(
        {
          importId: preparedRecord.id,
          expectedVersion: preparedRecord.version,
          scope: githubImportFixtureScope,
          pinnedFileIds: [],
          destinationProjectId: "project-two",
        },
        h.context,
      ),
    );

    expect(changed.selectionVersion).toBe(preparedRecord.selectionVersion + 1);
    expect(changed.selectionHash).toBeNull();
    expect(changed.consent).toBeNull();
    expect(changed.preparedSelectionRef).toBeNull();

    const nextJob = await unwrap(
      await h.service.prepare(
        { importId: changed.id, expectedVersion: changed.version },
        h.context,
      ),
    );
    const running = h.running(nextJob);
    const preparedAgain = await unwrap(
      await h.service.executePrepare({
        job: running,
        context: { ...h.context, runId: running.runId },
      }),
    );
    const review = await unwrap(
      await h.service.get({ importId: preparedAgain.id }, h.context),
    );
    expect(review.import.destinationProjectId).toBe("project-two");
    expect(review.prepared?.selectionHash).toBeTruthy();
  });

  it("fences cancelled and stale preparation workers before they can commit", async () => {
    const h = harness();
    const created = await unwrap(
      await h.service.create(
        {
          source: "personal",
          destinationProjectId: "project-one",
          scope: githubImportFixtureScope,
        },
        h.context,
      ),
    );
    const queued = await unwrap(
      await h.service.prepare(
        { importId: created.id, expectedVersion: created.version },
        h.context,
      ),
    );
    const running = h.running(queued);
    const cancelled = await unwrap(
      await h.service.cancel(
        { importId: created.id, runId: running.runId },
        h.context,
      ),
    );
    const stale = await h.service.executePrepare({
      job: running,
      context: { ...h.context, runId: running.runId },
    });

    expect(cancelled.lifecycle).toBe("cancelled");
    expect(stale.ok).toBe(false);
    expect(h.repository.resolveSnapshot).not.toHaveBeenCalled();
    expect(h.store.completePreparation).not.toHaveBeenCalled();
  });

  it("rejects a cancellation that races the analysis result commit", async () => {
    const h = harness({ cancelBeforeAnalysisCommit: true });
    const { preparedRecord } = await prepare(h);
    const queued = await unwrap(
      await h.service.enqueueAnalysis(
        {
          importId: preparedRecord.id,
          expectedVersion: preparedRecord.version,
          selectionHash: preparedRecord.selectionHash!,
          consentReference: "consent-one",
          idempotencyKey: "analysis-one",
        },
        h.context,
      ),
    );
    const running = h.running(queued);
    const result = await h.service.executeAnalyze({
      job: running,
      context: { ...h.context, runId: running.runId },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("cancelled");
    expect(h.store.completeAnalysis).toHaveBeenCalledTimes(1);
    expect(h.record?.resultRef).toBeNull();
  });

  it("refuses extraction claims that cite evidence outside the prepared bundle", async () => {
    const h = harness();
    const { preparedRecord } = await prepare(h);
    const queued = await unwrap(
      await h.service.enqueueAnalysis(
        {
          importId: preparedRecord.id,
          expectedVersion: preparedRecord.version,
          selectionHash: preparedRecord.selectionHash!,
          consentReference: "consent-one",
          idempotencyKey: "analysis-one",
        },
        h.context,
      ),
    );
    const running = h.running(queued);
    h.extractor.extract.mockImplementationOnce(async ({ prepared }) => {
      const result = analysisFor(prepared);
      result.claims[0]!.evidenceIds = ["invented-evidence"];
      return ok(result);
    });
    const result = await h.service.executeAnalyze({
      job: running,
      context: { ...h.context, runId: running.runId },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid-evidence");
    expect(h.store.completeAnalysis).not.toHaveBeenCalled();
    expect(h.record?.resultRef).toBeNull();
  });

  it("preserves reviewed edits when approval fails and recovers the staged result without extraction", async () => {
    const h = harness({ approvalFails: true });
    const { preparedRecord } = await prepare(h);
    const analyzed = await analyze(h, preparedRecord);
    const review = await unwrap(
      await h.service.get({ importId: analyzed.record.id }, h.context),
    );
    const draft = review.result!.drafts[0]!;
    const edited = await unwrap(
      await h.service.updateDraft(
        {
          importId: analyzed.record.id,
          draftId: draft.id,
          expectedVersion: review.import.version,
          text: "Implemented and reviewed summary aggregation.",
          selectedForSave: true,
          contributionConfirmed: true,
        },
        h.context,
      ),
    );
    const failed = await h.service.approve(
      {
        importId: analyzed.record.id,
        expectedVersion: h.record!.version,
        selectedDraftIds: [draft.id],
        idempotencyKey: "approval-one",
      },
      h.context,
    );
    const afterFailure = await unwrap(
      await h.service.get({ importId: analyzed.record.id }, h.context),
    );

    expect(failed.ok).toBe(false);
    expect(edited.text).toBe("Implemented and reviewed summary aggregation.");
    expect(afterFailure.result?.drafts[0]?.text).toBe(edited.text);
    expect(afterFailure.result?.drafts[0]?.selectedForSave).toBe(true);
    expect(h.extractor.extract).toHaveBeenCalledTimes(1);
    expect(h.measurements.review).toHaveBeenCalled();
  });

  it("does not invoke extraction for get, draft editing, measurement questions or save", async () => {
    const h = harness();
    const { preparedRecord } = await prepare(h);
    const analyzed = await analyze(h, preparedRecord);
    const review = await unwrap(
      await h.service.get({ importId: analyzed.record.id }, h.context),
    );
    const draft = review.result!.drafts[0]!;
    const edited = await unwrap(
      await h.service.updateDraft(
        {
          importId: analyzed.record.id,
          draftId: draft.id,
          expectedVersion: review.import.version,
          text: draft.text,
          selectedForSave: true,
          contributionConfirmed: true,
        },
        h.context,
      ),
    );
    const saved = await unwrap(
      await h.service.approve(
        {
          importId: analyzed.record.id,
          expectedVersion: h.record!.version,
          selectedDraftIds: [edited.id],
          idempotencyKey: "approval-one",
        },
        h.context,
      ),
    );

    expect(saved.savedIds).toEqual(["saved-one"]);
    expect(h.extractor.extract).toHaveBeenCalledTimes(1);
    expect(h.measurements.review).toHaveBeenCalled();
    expect(h.approval.approveGithubImport).toHaveBeenCalledTimes(1);
  });

  it("keeps edited suggestions in prior review when an explicitly updated run replaces them", async () => {
    const h = harness();
    const { preparedRecord } = await prepare(h);
    const firstAnalysis = await analyze(h, preparedRecord);
    const firstReview = await unwrap(
      await h.service.get({ importId: firstAnalysis.record.id }, h.context),
    );
    const firstDraft = firstReview.result!.drafts[0]!;
    await unwrap(
      await h.service.updateDraft(
        {
          importId: firstAnalysis.record.id,
          draftId: firstDraft.id,
          expectedVersion: firstReview.import.version,
          text: "A carefully reviewed point that must remain visible.",
          selectedForSave: true,
          contributionConfirmed: true,
        },
        h.context,
      ),
    );
    const updatedScope = {
      ...githubImportFixtureScope,
      selectedPaths: [
        ...githubImportFixtureScope.selectedPaths,
        "apps/dashboard/src/normalize.ts",
      ],
    };
    const changed = await unwrap(
      await h.service.changeSelection(
        {
          importId: firstAnalysis.record.id,
          expectedVersion: h.record!.version,
          scope: updatedScope,
          pinnedFileIds: [],
        },
        h.context,
      ),
    );
    const prepareJob = await unwrap(
      await h.service.prepare(
        { importId: changed.id, expectedVersion: changed.version },
        h.context,
      ),
    );
    const runningPrepare = h.running(prepareJob);
    const nextPrepared = await unwrap(
      await h.service.executePrepare({
        job: runningPrepare,
        context: { ...h.context, runId: runningPrepare.runId },
      }),
    );
    h.finish(prepareJob);
    const secondAnalysis = await analyze(h, nextPrepared);
    const updatedReview = await unwrap(
      await h.service.get({ importId: secondAnalysis.record.id }, h.context),
    );

    expect(updatedReview.priorReviews).toHaveLength(1);
    expect(updatedReview.priorReviews[0]?.draftEdits[0]?.text).toBe(
      "A carefully reviewed point that must remain visible.",
    );
    expect(updatedReview.result?.drafts[0]?.selectedForSave).toBe(false);
    expect(h.extractor.extract).toHaveBeenCalledTimes(2);
  });
});
