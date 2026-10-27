import {
  err,
  ok,
  type AnalysisResult,
  type DomainError,
  type ExecutionContext,
  type ImportRecord,
  type JobRecord,
  type NotificationOutboxEvent,
  type Result,
} from "../../contracts";
import type {
  ImportJobRunnerFactory,
  ImportJobRunnerPort,
  JobStorePort,
  JsonValue,
} from "../../ports";

type RunnerOutput = ImportRecord | AnalysisResult;
type StoredRunnerOutput = {
  resultRef: string;
  notification: Omit<NotificationOutboxEvent, "createdAt">;
};

/**
 * Batch B's frozen JobStorePort is intentionally HTTP/service focused. The
 * local worker adapter adds the queue and read operations needed for a
 * standalone process without changing that shared contract.
 */
type WorkerJobStore = JobStorePort & {
  claimNext?: (input: {
    workerId: string;
    leaseMs: number;
    jobId?: string;
  }) => Promise<Result<JobRecord | null>>;
  getJob?: (
    input: { jobId: string },
    context: ExecutionContext,
  ) => Promise<Result<JobRecord>>;
  recoverExpiredLeases?: () => Promise<Result<{ recovered: number }>>;
  /** Persist the typed output and return its immutable reference/event data. */
  storeRunnerOutput?: (
    input: { job: JobRecord; output: RunnerOutput },
    context: ExecutionContext,
  ) => Promise<Result<StoredRunnerOutput>>;
};

type WorkerClock = {
  setTimeout(
    callback: () => void,
    delayMs: number,
  ): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
  setInterval(
    callback: () => void,
    delayMs: number,
  ): ReturnType<typeof setInterval>;
  clearInterval(timer: ReturnType<typeof setInterval>): void;
};

type RunnerDependencies = Parameters<ImportJobRunnerFactory>[0] & {
  workerId?: string;
  leaseMs?: number;
  heartbeatMs?: number;
  maxConcurrent?: number;
  clock?: WorkerClock;
};

type ActiveExecution = {
  controller: AbortController;
  promise: Promise<Result<JobRecord | null>>;
};

const systemClock: WorkerClock = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (timer) => clearInterval(timer),
};

const UNAVAILABLE: DomainError = {
  code: "unavailable",
  message: "The GitHub import worker is not ready to process jobs.",
  retryable: true,
};

const INTERRUPTED: DomainError = {
  code: "interrupted",
  message:
    "Analysis stopped before its result could be confirmed. Review status before retrying.",
  retryable: true,
};

function isResult<T>(value: unknown): value is Result<T> {
  return Boolean(
    value &&
    typeof value === "object" &&
    "ok" in value &&
    typeof (value as { ok?: unknown }).ok === "boolean",
  );
}

function safeError(error: unknown): DomainError {
  if (isResult(error) && !error.ok) return error.error;
  if (
    error &&
    typeof error === "object" &&
    "error" in error &&
    (error as { error?: unknown }).error &&
    typeof (error as { error: unknown }).error === "object"
  ) {
    const candidate = (error as { error: Partial<DomainError> }).error;
    if (
      typeof candidate.code === "string" &&
      typeof candidate.message === "string" &&
      typeof candidate.retryable === "boolean"
    ) {
      return candidate as DomainError;
    }
  }
  return {
    code: "upstream-error",
    message: "A project analysis service could not complete the request.",
    retryable: false,
  };
}

function validRunnerConfiguration(deps: RunnerDependencies) {
  const maxConcurrent = deps.maxConcurrent ?? 1;
  const leaseMs = deps.leaseMs ?? 30_000;
  const heartbeatMs =
    deps.heartbeatMs ?? Math.max(250, Math.floor(leaseMs / 3));
  if (
    !Number.isInteger(maxConcurrent) ||
    maxConcurrent < 1 ||
    maxConcurrent > 4 ||
    !Number.isInteger(leaseMs) ||
    leaseMs < 1_000 ||
    leaseMs > 10 * 60_000 ||
    !Number.isInteger(heartbeatMs) ||
    heartbeatMs < 50 ||
    heartbeatMs >= leaseMs
  ) {
    throw new RangeError(
      "The GitHub worker concurrency and lease settings are invalid.",
    );
  }
  return { maxConcurrent, leaseMs, heartbeatMs };
}

function identity(job: JobRecord, workerId: string) {
  const fence = job.lease?.fence ?? job.executionFence;
  if (!job.lease || job.lease.owner !== workerId || job.lease.fence !== fence) {
    return null;
  }
  return { jobId: job.id, workerId, fence };
}

function jsonCheckpoint(
  value: Record<string, unknown>,
): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

function workerFailure(error: DomainError): Result<JobRecord | null> {
  return err(error);
}

export const createImportJobRunner: ImportJobRunnerFactory = (
  factoryDependencies,
) => {
  const deps = factoryDependencies as RunnerDependencies;
  const jobs = deps.jobs as WorkerJobStore;
  const workerId = deps.workerId ?? `github-worker-${process.pid}`;
  const { maxConcurrent, leaseMs, heartbeatMs } =
    validRunnerConfiguration(deps);
  const clock = deps.clock ?? systemClock;
  const active = new Map<string, ActiveExecution>();
  let closed = false;
  let pendingClaims = 0;
  let resolveClaimsDrained: (() => void) | undefined;
  let pendingClaimsDrained = Promise.resolve();

  async function currentJob(
    jobId: string,
    context: ExecutionContext,
  ): Promise<Result<JobRecord>> {
    if (!jobs.getJob) return err(UNAVAILABLE);
    return jobs.getJob({ jobId }, context);
  }

  async function stopIfStale(
    job: JobRecord,
    identityValue: NonNullable<ReturnType<typeof identity>>,
    context: ExecutionContext,
    signal: AbortSignal,
  ): Promise<Result<JobRecord>> {
    if (signal.aborted) {
      const reason = signal.reason as Partial<DomainError> | undefined;
      return err(
        reason &&
          typeof reason.code === "string" &&
          typeof reason.message === "string" &&
          typeof reason.retryable === "boolean"
          ? (reason as DomainError)
          : INTERRUPTED,
      );
    }
    if (Date.parse(job.deadline) <= context.now().getTime()) {
      return err({
        code: "interrupted",
        message: "The job reached its execution deadline.",
        retryable: true,
      });
    }
    const current = await currentJob(job.id, context);
    if (!current.ok) return current;
    const record = current.value;
    if (
      record.state !== "running" ||
      record.executionFence !== identityValue.fence ||
      !record.lease ||
      record.lease.owner !== identityValue.workerId ||
      record.lease.fence !== identityValue.fence
    ) {
      return err({
        code: record.state === "cancelled" ? "cancelled" : "version-conflict",
        message:
          record.state === "cancelled"
            ? "This project analysis was cancelled."
            : "This worker no longer owns the current job lease.",
        retryable: false,
      });
    }
    return current;
  }

  async function runClaimed(
    job: JobRecord,
    controller: AbortController,
  ): Promise<Result<JobRecord | null>> {
    const runIdentity = identity(job, workerId);
    if (!runIdentity) {
      return workerFailure({
        code: "version-conflict",
        message: "The claimed job did not contain a valid worker lease.",
        retryable: false,
      });
    }

    const baseContext = await deps.contextFor(job);
    if (!baseContext.ok) return workerFailure(baseContext.error);
    const context: ExecutionContext = {
      ...baseContext.value,
      signal: controller.signal,
      runId: job.runId,
      deadline: job.deadline,
    };
    const deadline = Date.parse(job.deadline);
    if (!Number.isFinite(deadline) || deadline <= context.now().getTime()) {
      const failed = await deps.jobs.fail(
        { ...runIdentity, error: INTERRUPTED },
        context,
      );
      return failed.ok ? ok(failed.value) : workerFailure(failed.error);
    }

    let heartbeatInFlight = false;
    let failedByLease = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

    const abort = (reason: DomainError) => {
      if (controller.signal.aborted) return;
      controller.abort(reason);
    };

    const assertActive = async (): Promise<Result<JobRecord>> => {
      const current = await stopIfStale(
        job,
        runIdentity,
        context,
        controller.signal,
      );
      if (!current.ok) {
        if (current.error.code === "version-conflict") failedByLease = true;
        abort(current.error);
        return current;
      }
      return current;
    };

    const heartbeat = async () => {
      if (heartbeatInFlight || controller.signal.aborted || closed) return;
      heartbeatInFlight = true;
      try {
        const current = await assertActive();
        if (!current.ok) return;
        const renewed = await deps.jobs.renew(
          { ...runIdentity, leaseMs },
          context,
        );
        if (!renewed.ok) {
          if (renewed.error.code === "version-conflict") failedByLease = true;
          abort(renewed.error);
        }
      } catch {
        abort({
          code: "io-error",
          message: "The worker could not renew its job lease.",
          retryable: true,
        });
      } finally {
        heartbeatInFlight = false;
      }
    };

    // The shared budget ledger is the gate before any new upstream request.
    // Checking the durable fence here makes cancellation effective even when
    // the page that queued the work has gone away.
    const guardedContext: ExecutionContext = {
      ...context,
      budget: {
        ...context.budget,
        reserve: async (input) => {
          const current = await assertActive();
          if (!current.ok) return err(current.error);
          return context.budget.reserve(input);
        },
        commitUsage: context.budget.commitUsage,
        checkSelection: context.budget.checkSelection,
        remaining: context.budget.remaining,
        snapshot: context.budget.snapshot,
      },
    };

    timer = clock.setInterval(() => void heartbeat(), heartbeatMs);
    deadlineTimer = clock.setTimeout(
      () =>
        abort({
          code: "interrupted",
          message: "The job reached its execution deadline.",
          retryable: true,
        }),
      Math.max(0, deadline - context.now().getTime()),
    );

    try {
      const current = await assertActive();
      if (!current.ok) throw current.error;
      const initialCheckpoint = await deps.jobs.checkpoint(
        {
          ...runIdentity,
          stage: job.kind === "prepare" ? "preparing" : "analyzing",
          checkpoint: jsonCheckpoint({
            runnerStage:
              job.kind === "prepare" ? "prepare-started" : "analysis-started",
            providerState:
              job.kind === "prepare"
                ? "not-started"
                : job.checkpoint?.providerState === "completed"
                  ? "completed"
                  : "in-flight",
            ...(job.checkpoint?.providerState === "completed"
              ? { providerResultRef: job.checkpoint.providerResultRef }
              : {}),
            inputHash: job.inputHash,
            consentHash: job.consentHash,
          }),
        },
        guardedContext,
      );
      if (!initialCheckpoint.ok) throw initialCheckpoint.error;

      const result =
        job.kind === "prepare"
          ? await deps.executePrepare(job, guardedContext)
          : await deps.executeAnalyze(job, guardedContext);
      if (!result.ok) throw result.error;

      const stillCurrent = await assertActive();
      if (!stillCurrent.ok) throw stillCurrent.error;
      if (!jobs.storeRunnerOutput) throw UNAVAILABLE;
      const stored = await jobs.storeRunnerOutput(
        { job, output: result.value },
        guardedContext,
      );
      if (!stored.ok) {
        // If analysis returned, the upstream outcome is known but its durable
        // result could not be confirmed. Require explicit reconciliation.
        throw job.kind === "analyze" ? INTERRUPTED : stored.error;
      }

      if (job.kind === "analyze") {
        const resultCheckpoint = await deps.jobs.checkpoint(
          {
            ...runIdentity,
            stage: "analysis-result-persisted",
            checkpoint: jsonCheckpoint({
              runnerStage: "analysis-result-persisted",
              providerState: "completed",
              providerResultRef: stored.value.resultRef,
            }),
          },
          guardedContext,
        );
        if (!resultCheckpoint.ok) throw resultCheckpoint.error;
      }

      const beforeCommit = await assertActive();
      if (!beforeCommit.ok) throw beforeCommit.error;
      const completed = await deps.jobs.completeWithEvent(
        {
          ...runIdentity,
          resultRef: stored.value.resultRef,
          notification: stored.value.notification,
        },
        guardedContext,
      );
      if (!completed.ok) throw completed.error;
      return ok(completed.value);
    } catch (cause) {
      const error =
        cause && typeof cause === "object" && "code" in cause
          ? (cause as DomainError)
          : safeError(cause);
      if (failedByLease || error.code === "version-conflict") {
        const current = await currentJob(job.id, context);
        return current.ok ? ok(current.value) : workerFailure(current.error);
      }

      if (error.code === "cancelled") {
        const current = await currentJob(job.id, context);
        return current.ok ? ok(current.value) : workerFailure(current.error);
      }

      const normalizedError =
        job.kind === "analyze" &&
        (error.code === "io-error" || error.code === "upstream-error")
          ? INTERRUPTED
          : error;
      const failed = await deps.jobs.fail(
        { ...runIdentity, error: normalizedError },
        context,
      );
      if (!failed.ok && failed.error.code === "version-conflict") {
        const current = await currentJob(job.id, context);
        return current.ok ? ok(current.value) : workerFailure(current.error);
      }
      return failed.ok ? ok(failed.value) : workerFailure(failed.error);
    } finally {
      if (timer) clock.clearInterval(timer);
      if (deadlineTimer) clock.clearTimeout(deadlineTimer);
      if (!controller.signal.aborted) controller.abort();
      active.delete(job.id);
    }
  }

  const runner: ImportJobRunnerPort = {
    async runOnce(input = {}) {
      if (closed)
        return err({
          code: "unavailable",
          message: "The GitHub import worker is shutting down.",
          retryable: true,
        });
      if (active.size + pendingClaims >= maxConcurrent)
        return err({
          code: "unavailable",
          message: "The GitHub import worker is at its concurrency limit.",
          retryable: true,
        });
      if (!jobs.claimNext) return err(UNAVAILABLE);

      if (pendingClaims === 0) {
        pendingClaimsDrained = new Promise<void>((resolve) => {
          resolveClaimsDrained = resolve;
        });
      }
      pendingClaims += 1;
      try {
        const claimed = await jobs.claimNext({
          workerId,
          leaseMs,
          ...(input.jobId ? { jobId: input.jobId } : {}),
        });
        if (!claimed.ok) return claimed;
        if (!claimed.value) return ok(null);
        const claimedJob = claimed.value;
        if (active.has(claimedJob.id)) {
          return err({
            code: "version-conflict",
            message: "This job is already running in this worker.",
            retryable: false,
          });
        }

        const controller = new AbortController();
        const promise = runClaimed(claimedJob, controller);
        active.set(claimedJob.id, { controller, promise });
        return promise.finally(() => active.delete(claimedJob.id));
      } finally {
        pendingClaims -= 1;
        if (pendingClaims === 0) {
          resolveClaimsDrained?.();
          resolveClaimsDrained = undefined;
        }
      }
    },

    async recover() {
      if (closed)
        return err({
          code: "unavailable",
          message: "The GitHub import worker is shutting down.",
          retryable: true,
        });
      if (!jobs.recoverExpiredLeases) return err(UNAVAILABLE);
      return jobs.recoverExpiredLeases();
    },

    async shutdown() {
      if (!closed) {
        closed = true;
        await pendingClaimsDrained;
        for (const execution of active.values()) execution.controller.abort();
        await Promise.allSettled(
          [...active.values()].map((execution) => execution.promise),
        );
      }
      return ok({ closed: true });
    },
  };

  return runner;
};
