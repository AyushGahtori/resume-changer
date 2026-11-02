import { afterEach, describe, expect, it, vi } from "vitest";
import {
  err,
  ok,
  type AnalysisResult,
  type ExecutionContext,
  type ImportRecord,
  type JobRecord,
  type NotificationOutboxEvent,
  type Result,
} from "../../../../src/lib/github/contracts";
import { createImportJobRunner } from "../../../../src/lib/github/server/jobs/runner";
import type {
  ImportJobRunnerFactory,
  JobStorePort,
} from "../../../../src/lib/github/ports";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const BASE = Date.now();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeJob(kind: "prepare" | "analyze" = "analyze", id = "job-one") {
  return {
    id,
    runId: `run-${id}`,
    importId: `import-${id}`,
    importVersion: 2,
    idempotencyKeyHash: HASH_A,
    kind,
    state: "queued",
    stage: "queued",
    inputHash: HASH_B,
    consentHash: kind === "analyze" ? HASH_A : null,
    executionFence: 0,
    lease: null,
    checkpoint: null,
    cancellationRequestedAt: null,
    deadline: new Date(BASE + 60 * 60_000).toISOString(),
    usage: {
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
    },
    error: null,
    resultRef: null,
    outboxEvents: [],
    createdAt: new Date(BASE).toISOString(),
    updatedAt: new Date(BASE).toISOString(),
  } as unknown as JobRecord;
}

const analysis: AnalysisResult = {
  summary: "The selected source supports a qualitative draft.",
  claims: [],
  drafts: [],
  questionSuggestions: [],
  limitations: [],
  model: "mock-model",
  finishReason: "stop",
  usage: {
    promptTokens: null,
    cachedTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    totalTokens: null,
  },
  selectionHash: HASH_A,
};

const prepared: ImportRecord = {
  pinnedFileIds: [],
  removedFileIds: [],
  candidateInventoryRef: null,
  resultRunId: null,
  approvalKeyHash: null,
  reviewHistory: [],
  id: "import-job-one",
  version: 2,
  source: "personal",
  destinationProjectId: "project-one",
  authorizationNamespaceHash: HASH_A,
  scope: {} as ImportRecord["scope"],
  selectionVersion: 1,
  selectionHash: HASH_A,
  lifecycle: "ready-to-analyze",
  activeRunId: "run-job-one",
  consent: null,
  preparedSelectionRef: HASH_B,
  resultRef: null,
  draftRefs: [],
  draftEdits: [],
  savedIds: [],
  retentionDeadline: new Date(BASE + 60 * 60_000).toISOString(),
  createdAt: new Date(BASE).toISOString(),
  updatedAt: new Date(BASE).toISOString(),
};

const readyEvent = (
  job: JobRecord,
): Omit<NotificationOutboxEvent, "createdAt"> => ({
  id: `event-${job.id}`,
  importId: job.importId,
  projectId: "project-one",
  jobId: job.id,
  type: "ready",
  destination: `/library/github/${job.importId}`,
});

function makeContext(job: JobRecord): ExecutionContext {
  const snapshot = {
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
  return {
    personalRoot: "C:/temp/github-worker-test",
    access: {
      sessionId: "session-one",
      authorizationNamespace: "namespace-one",
      accountId: "account-one",
      grantedRepositoryIds: ["repository-one"],
    },
    signal: new AbortController().signal,
    now: () => new Date(),
    runId: job.runId,
    deadline: job.deadline,
    budget: {
      reserve: vi.fn(async () => ok({ reservationId: "reservation-one" })),
      commitUsage: vi.fn(async () => ok(snapshot)),
      checkSelection: vi.fn(() => ok({ allowed: true, reason: null })),
      remaining: vi.fn(() => ok(snapshot)),
      snapshot: vi.fn(() => ok(snapshot)),
    },
  };
}

type RunnerStoreExtensions = {
  claimNext(input: {
    workerId: string;
    leaseMs: number;
    jobId?: string;
  }): Promise<Result<JobRecord | null>>;
  getJob(
    input: { jobId: string },
    context: ExecutionContext,
  ): Promise<Result<JobRecord>>;
  recoverExpiredLeases(): Promise<Result<{ recovered: number }>>;
  storeRunnerOutput(
    input: {
      job: JobRecord;
      output: ImportRecord | AnalysisResult;
    },
    context: ExecutionContext,
  ): Promise<
    Result<{
      resultRef: string;
      notification: Omit<NotificationOutboxEvent, "createdAt">;
    }>
  >;
};

function makeHarness(options?: {
  kind?: "prepare" | "analyze";
  deadlineMs?: number;
  executePrepare?: (
    job: JobRecord,
    context: ExecutionContext,
  ) => Promise<Result<ImportRecord>>;
  executeAnalyze?: (
    job: JobRecord,
    context: ExecutionContext,
  ) => Promise<Result<AnalysisResult>>;
  maxConcurrent?: number;
}) {
  const workerId = "worker-one";
  let current = makeJob(options?.kind);
  if (options?.deadlineMs !== undefined) {
    current = {
      ...current,
      deadline: new Date(Date.now() + options.deadlineMs).toISOString(),
    };
  }
  const jobs = {
    claimNext: vi.fn(
      async (input: { workerId: string; leaseMs: number; jobId?: string }) => {
        if (
          current.state !== "queued" ||
          (input.jobId && current.id !== input.jobId)
        ) {
          return ok(null);
        }
        current = {
          ...current,
          state: "running",
          stage: "claimed",
          executionFence: current.executionFence + 1,
          lease: {
            owner: input.workerId,
            expiresAt: new Date(Date.now() + input.leaseMs).toISOString(),
            fence: current.executionFence + 1,
          },
        };
        return ok(current);
      },
    ),
    async getJob() {
      return ok(current);
    },
    recoverExpiredLeases: vi.fn(async () => {
      return ok({ recovered: 0 });
    }),
    async renew(input: { leaseMs: number }) {
      if (current.state !== "running") {
        return err({
          code: "cancelled",
          message: "Cancelled.",
          retryable: false,
        });
      }
      current = {
        ...current,
        lease: {
          ...current.lease!,
          expiresAt: new Date(Date.now() + input.leaseMs).toISOString(),
        },
      };
      return ok(current);
    },
    checkpoint: vi.fn(
      async (input: { stage: string; checkpoint: Record<string, unknown> }) => {
        current = {
          ...current,
          stage: input.stage,
          checkpoint: input.checkpoint,
        };
        return ok(current);
      },
    ),
    completeWithEvent: vi.fn(
      async (input: {
        resultRef: string;
        notification: Omit<NotificationOutboxEvent, "createdAt">;
      }) => {
        current = {
          ...current,
          state: "completed",
          stage: "completed",
          resultRef: input.resultRef,
          lease: null,
          outboxEvents: [
            { ...input.notification, createdAt: new Date().toISOString() },
          ],
        };
        return ok(current);
      },
    ),
    async fail(input: { error: JobRecord["error"] }) {
      current = {
        ...current,
        state: input.error?.code === "interrupted" ? "interrupted" : "failed",
        stage: "failed",
        error: input.error,
        lease: null,
      };
      return ok(current);
    },
    async requestCancel() {
      current = {
        ...current,
        state: "cancelled",
        cancellationRequestedAt: new Date().toISOString(),
        executionFence: current.executionFence + 1,
        lease: null,
      };
      return ok(current);
    },
    storeRunnerOutput: vi.fn(async (input: { job: JobRecord }) => {
      return ok({ resultRef: HASH_B, notification: readyEvent(input.job) });
    }),
  } as unknown as JobStorePort & RunnerStoreExtensions;

  const executePrepare =
    options?.executePrepare ?? vi.fn(async () => ok(prepared));
  const executeAnalyze =
    options?.executeAnalyze ?? vi.fn(async () => ok(analysis));
  const contextFor = vi.fn(async (job: JobRecord) => ok(makeContext(job)));
  const runner = createImportJobRunner({
    jobs,
    executePrepare,
    executeAnalyze,
    contextFor,
    workerId,
    leaseMs: 3_000,
    heartbeatMs: 100,
    maxConcurrent: options?.maxConcurrent,
  } as Parameters<ImportJobRunnerFactory>[0]);

  return {
    runner,
    jobs,
    get current() {
      return current;
    },
    set current(value: JobRecord) {
      current = value;
    },
    executePrepare,
    executeAnalyze,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("GitHub import worker runner", () => {
  it("claims persisted work and completes one job/outbox transition independently of page navigation", async () => {
    const harness = makeHarness();
    const result = await harness.runner.runOnce();

    expect(result).toMatchObject({ ok: true, value: { state: "completed" } });
    expect(harness.executeAnalyze).toHaveBeenCalledOnce();
    expect(harness.jobs.checkpoint).toHaveBeenCalledTimes(2);
    expect(harness.jobs.checkpoint).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        checkpoint: expect.objectContaining({ providerState: "in-flight" }),
      }),
      expect.anything(),
    );
    expect(harness.jobs.completeWithEvent).toHaveBeenCalledOnce();
    expect(harness.current.outboxEvents).toHaveLength(1);
  });

  it("dispatches preparation jobs to the prepare executor", async () => {
    const harness = makeHarness({ kind: "prepare" });
    const result = await harness.runner.runOnce();

    expect(result).toMatchObject({ ok: true, value: { state: "completed" } });
    expect(harness.executePrepare).toHaveBeenCalledOnce();
    expect(harness.executeAnalyze).not.toHaveBeenCalled();
  });

  it("limits concurrent claims even when runOnce is called twice", async () => {
    const started = deferred<void>();
    const finish = deferred<Result<AnalysisResult>>();
    const harness = makeHarness({
      executeAnalyze: vi.fn(async () => {
        started.resolve();
        return finish.promise;
      }),
    });

    const first = harness.runner.runOnce();
    await started.promise;
    const second = await harness.runner.runOnce();

    expect(second).toMatchObject({ ok: false, error: { code: "unavailable" } });
    expect(harness.jobs.claimNext).toHaveBeenCalledOnce();
    finish.resolve(ok(analysis));
    await first;
  });

  it("waits for an in-progress claim before completing shutdown", async () => {
    const claim = deferred<Result<JobRecord | null>>();
    const harness = makeHarness();
    vi.spyOn(harness.jobs, "claimNext").mockReturnValueOnce(claim.promise);

    const run = harness.runner.runOnce();
    let shutdownSettled = false;
    const shutdown = harness.runner.shutdown().then(() => {
      shutdownSettled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(shutdownSettled).toBe(false);

    claim.resolve(ok(null));
    await expect(run).resolves.toEqual(ok(null));
    await shutdown;
    expect(shutdownSettled).toBe(true);
  });

  it("lets only one competing worker own a persisted job lease", async () => {
    const started = deferred<void>();
    const finish = deferred<Result<AnalysisResult>>();
    const harness = makeHarness({
      executeAnalyze: vi.fn(async () => {
        started.resolve();
        return finish.promise;
      }),
    });
    const secondWorker = createImportJobRunner({
      jobs: harness.jobs,
      executePrepare: async () => ok(prepared),
      executeAnalyze: async () => ok(analysis),
      contextFor: async (job) => ok(makeContext(job)),
      workerId: "worker-two",
    } as Parameters<ImportJobRunnerFactory>[0]);

    const first = harness.runner.runOnce();
    await started.promise;
    expect(await secondWorker.runOnce()).toEqual(ok(null));

    finish.resolve(ok(analysis));
    expect(await first).toMatchObject({
      ok: true,
      value: { state: "completed" },
    });
  });

  it("observes a durable cancellation before the next budgeted request and rejects the late response", async () => {
    let observedSignal: AbortSignal | undefined;
    const resultReady = deferred<Result<AnalysisResult>>();
    const harness = makeHarness({
      executeAnalyze: vi.fn(async (_job, context) => {
        observedSignal = context.signal;
        await harness.jobs.requestCancel({ jobId: "job-one" }, context);
        const reserve = await context.budget.reserve({
          operation: "github-content",
          amount: 1,
        });
        expect(reserve.ok).toBe(false);
        return resultReady.promise;
      }),
    });

    const execution = harness.runner.runOnce();
    await vi.waitFor(() => expect(observedSignal?.aborted).toBe(true));
    resultReady.resolve(ok(analysis));
    const result = await execution;

    expect(result).toMatchObject({ ok: true, value: { state: "cancelled" } });
    expect(harness.jobs.completeWithEvent).not.toHaveBeenCalled();
  });

  it("fences a late provider response after another worker takes the lease", async () => {
    const response = deferred<Result<AnalysisResult>>();
    let started = false;
    const harness = makeHarness({
      executeAnalyze: vi.fn(async () => {
        started = true;
        return response.promise;
      }),
    });

    const execution = harness.runner.runOnce();
    await vi.waitFor(() => expect(started).toBe(true));
    harness.current = {
      ...harness.current,
      executionFence: harness.current.executionFence + 1,
      lease: {
        owner: "worker-two",
        fence: harness.current.executionFence + 1,
        expiresAt: new Date(Date.now() + 3_000).toISOString(),
      },
    };
    response.resolve(ok(analysis));
    const result = await execution;

    expect(result).toMatchObject({
      ok: true,
      value: { lease: { owner: "worker-two" } },
    });
    expect(harness.jobs.completeWithEvent).not.toHaveBeenCalled();
  });

  it("uses the store's recovery policy on restart and reports a missing worker adapter honestly", async () => {
    const harness = makeHarness();
    expect(await harness.runner.recover()).toEqual(ok({ recovered: 0 }));
    expect(harness.jobs.recoverExpiredLeases).toHaveBeenCalledOnce();

    const withoutAdapter = createImportJobRunner({
      jobs: {} as JobStorePort,
      executePrepare: async () => ok(prepared),
      executeAnalyze: async () => ok(analysis),
      contextFor: async (job) => ok(makeContext(job)),
    });
    expect(await withoutAdapter.runOnce()).toMatchObject({
      ok: false,
      error: { code: "unavailable" },
    });
  });

  it("marks an analysis whose deadline expires as interrupted", async () => {
    vi.useFakeTimers({ now: BASE });
    const started = deferred<void>();
    const harness = makeHarness({
      deadlineMs: 50,
      executeAnalyze: vi.fn(async (_job, context) => {
        started.resolve();
        return new Promise<Result<AnalysisResult>>((resolve) => {
          context.signal.addEventListener(
            "abort",
            () =>
              resolve(
                err({
                  code: "interrupted",
                  message: "Stopped.",
                  retryable: true,
                }),
              ),
            { once: true },
          );
        });
      }),
    });
    harness.current = {
      ...harness.current,
      deadline: new Date(BASE + 50).toISOString(),
    };

    const execution = harness.runner.runOnce();
    await started.promise;
    await vi.advanceTimersByTimeAsync(51);
    const result = await execution;

    expect(result).toMatchObject({ ok: true, value: { state: "interrupted" } });
    expect(harness.jobs.completeWithEvent).not.toHaveBeenCalled();
  });
});
