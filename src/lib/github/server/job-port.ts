import {
  err,
  ok,
  JobRecordSchema,
  type ExecutionContext,
  type JobRecord,
  type Notification,
  type NotificationOutboxEvent,
  type Result,
} from "../contracts";
import type { ImportStorePort, JobStorePort } from "../ports";
import { createJobStore, type JobRecord as DurableJob } from "./jobs/store";
import { budgetSummary, ledgerFor } from "./budget-port";

export type DurableJobs = ReturnType<typeof createJobStore>;
export type WorkerJobs = JobStorePort & {
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
    input: { job: JobRecord; output: unknown },
    context: ExecutionContext,
  ): Promise<
    Result<{
      resultRef: string;
      notification: Omit<NotificationOutboxEvent, "createdAt">;
    }>
  >;
};

const denied = () =>
  err<never>({
    code: "forbidden",
    message: "This background job is unavailable in the current workspace.",
    retryable: false,
  });
export function jobDto(job: DurableJob): JobRecord {
  const usage = job.runnerData.usage ?? {
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
  return JobRecordSchema.parse({
    id: job.id,
    runId: job.runId,
    importId: job.importId,
    projectId: job.projectId,
    importVersion: job.importVersion,
    selectionVersion: job.selectionVersion,
    idempotencyKeyHash: job.idempotencyKeyHash,
    kind: job.kind,
    state: job.state,
    stage: job.checkpoint.stage,
    inputHash: job.inputHash,
    consentHash: job.consentHash,
    executionFence: job.executionFence,
    lease: job.lease
      ? {
          owner: job.lease.ownerId,
          expiresAt: job.lease.expiresAt,
          fence: job.executionFence,
        }
      : null,
    checkpoint: {
      ...job.runnerData,
      providerState: job.checkpoint.providerState,
      providerResultRef: job.checkpoint.providerResultRef,
    },
    cancellationRequestedAt: job.cancelRequestedAt,
    deadline: job.deadlineAt,
    usage,
    error: job.failureCode
      ? {
          code:
            job.state === "interrupted"
              ? "interrupted"
              : job.failureCode === "needs-context"
                ? "needs-context"
                : "upstream-error",
          message: "The background import needs review before continuing.",
          retryable: job.failureRetryable ?? false,
        }
      : null,
    resultRef: job.resultRef,
    outboxEvents: job.outboxEvents.map((e) => ({
      id: e.id,
      importId: e.importId,
      projectId: e.projectId,
      jobId: e.jobId,
      type: e.type === "ready-to-review" ? "ready" : e.type,
      createdAt: e.createdAt,
      destination: `/library/github/${e.importId}`,
    })),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
}

export function createJobPort(
  durable: DurableJobs,
  imports: ImportStorePort,
): WorkerJobs {
  const map = async (
    result: Promise<Result<DurableJob>>,
  ): Promise<Result<JobRecord>> => {
    const r = await result;
    return r.ok ? ok(jobDto(r.value)) : r;
  };
  async function authorize(job: DurableJob, context: ExecutionContext) {
    const owner = await imports.get({ id: job.importId }, context);
    return owner.ok && owner.value.destinationProjectId === job.projectId;
  }
  async function getJob(
    { jobId }: { jobId: string },
    context: ExecutionContext,
  ): Promise<Result<JobRecord>> {
    const r = await durable.get({ jobId });
    if (!r.ok) return r;
    if (!(await authorize(r.value, context))) return denied();
    return ok(jobDto(r.value));
  }
  async function checkpoint(
    input: Parameters<JobStorePort["checkpoint"]>[0],
    context: ExecutionContext,
  ): Promise<Result<JobRecord>> {
    for (let n = 0; n < 4; n++) {
      const raw = await durable.get({ jobId: input.jobId });
      if (!raw.ok) return raw;
      if (!(await authorize(raw.value, context))) return denied();
      let budgetData: Record<string, unknown> = {};
      try {
        const ledger = ledgerFor(context.budget);
        budgetData = {
          budget: ledger.snapshot(),
          usage: budgetSummary(ledger),
        };
      } catch {
        /* Unused status contexts need no run budget. */
      }
      const state =
        input.checkpoint.providerState ?? raw.value.checkpoint.providerState;
      const next = await durable.checkpoint({
        jobId: input.jobId,
        workerId: input.workerId,
        fence: input.fence,
        expectedCheckpointVersion: raw.value.checkpoint.version,
        checkpoint: {
          stage: input.stage,
          providerState: state,
          providerResultRef:
            input.checkpoint.providerResultRef ??
            raw.value.checkpoint.providerResultRef,
        },
        runnerData: {
          ...raw.value.runnerData,
          ...input.checkpoint,
          ...budgetData,
        },
      });
      if (next.ok) return ok(jobDto(next.value));
      if (next.error.code !== "version-conflict") return next;
    }
    return err({
      code: "version-conflict",
      message: "The worker checkpoint changed. Retry from its current lease.",
      retryable: true,
    });
  }
  return {
    async enqueue(input, context) {
      const owner = await imports.get({ id: input.importId }, context);
      if (!owner.ok) return owner;
      if (owner.value.destinationProjectId !== input.projectId) return denied();
      return map(
        durable.enqueue({
          idempotencyKey: input.idempotencyKey,
          importId: input.importId,
          projectId: input.projectId,
          importVersion: input.importVersion,
          selectionVersion: input.selectionVersion,
          selectionHash: input.inputHash,
          inputHash: input.inputHash,
          ...(input.consentHash ? { consentHash: input.consentHash } : {}),
          kind: input.kind,
          initialAllowance: {
            httpAttempts: 32,
            generationAttempts: 2,
            inputTokens: 36000,
          },
          deadlineAt: input.deadline,
        }),
      );
    },
    getJob,
    async getByRunId(input, context) {
      const r = await durable.getByRunId(input);
      if (!r.ok) return r;
      if (!r.value) return ok(null);
      if (!(await authorize(r.value, context))) return denied();
      return ok(jobDto(r.value));
    },
    async claimNext(input) {
      const r = await durable.claim({
        workerId: input.workerId,
        leaseDurationMs: input.leaseMs,
        ...(input.jobId ? { jobId: input.jobId } : {}),
      });
      return r.ok ? ok(r.value ? jobDto(r.value) : null) : r;
    },
    async claim(input, context) {
      const prior = await getJob({ jobId: input.jobId }, context);
      if (!prior.ok) return prior;
      const r = await durable.claim({
        workerId: input.workerId,
        jobId: input.jobId,
        leaseDurationMs: input.leaseMs,
      });
      return r.ok
        ? r.value
          ? ok(jobDto(r.value))
          : err({
              code: "version-conflict",
              message: "The job is no longer queued.",
              retryable: false,
            })
        : r;
    },
    async renew(input, context) {
      const authorized = await getJob(input, context);
      if (!authorized.ok) return authorized;
      return map(
        durable.renew({
          jobId: input.jobId,
          workerId: input.workerId,
          fence: input.fence,
          leaseDurationMs: input.leaseMs,
        }),
      );
    },
    checkpoint,
    async requestCancel(input, context) {
      const a = await getJob(input, context);
      return a.ok ? map(durable.requestCancel(input)) : a;
    },
    async completeWithEvent(input, context) {
      const a = await getJob(input, context);
      if (!a.ok) return a;
      return map(
        durable.completeWithEvent({
          jobId: input.jobId,
          workerId: input.workerId,
          fence: input.fence,
          resultRef: input.resultRef,
          eventType:
            a.value.kind === "prepare" ? "prepared" : "ready-to-review",
        }),
      );
    },
    async fail(input, context) {
      const a = await getJob(input, context);
      if (!a.ok) return a;
      return map(
        durable.fail({
          jobId: input.jobId,
          workerId: input.workerId,
          fence: input.fence,
          failureCode:
            input.error.code === "interrupted"
              ? "provider-outcome-unknown"
              : input.error.code === "needs-context"
                ? "needs-context"
                : input.error.code === "invalid-evidence"
                  ? "invalid-evidence"
                  : "upstream-unavailable",
        }),
      );
    },
    async recoverExpiredLease(input, context) {
      const a = await getJob(input, context);
      if (!a.ok) return a;
      const r = await durable.recoverExpiredLease(input);
      return r.ok ? getJob(input, context) : r;
    },
    async recoverExpiredLeases() {
      const r = await durable.recoverExpiredLease();
      return r.ok ? ok({ recovered: r.value.length }) : r;
    },
    async storeRunnerOutput({ job }, context) {
      const record = await imports.get({ id: job.importId }, context);
      if (!record.ok) return record;
      if (record.value.activeRunId !== job.runId)
        return err({
          code: "version-conflict",
          message: "A newer run owns this import.",
          retryable: false,
        });
      const resultRef =
        job.kind === "prepare"
          ? record.value.preparedSelectionRef
          : record.value.resultRef;
      if (!resultRef)
        return err({
          code: "io-error",
          message: "The worker output was not persisted.",
          retryable: true,
        });
      return ok({
        resultRef,
        notification: {
          id: `ready-${job.id}`,
          importId: job.importId,
          projectId: job.projectId,
          jobId: job.id,
          type: "ready",
          destination: `/library/github/${job.importId}`,
        },
      });
    },
    async listNotifications(input, context) {
      const all = await durable.listNotifications();
      if (!all.ok) return all;
      const visible: Notification[] = [];
      for (const n of all.value) {
        const raw = await durable.get({ jobId: n.jobId });
        if (!raw.ok || !(await authorize(raw.value, context))) continue;
        if (input.after && n.createdAt <= input.after) continue;
        visible.push({
          id: n.id,
          importId: n.importId,
          projectId: n.projectId,
          jobId: n.jobId,
          type: n.type === "ready-to-review" ? "ready" : n.type,
          createdAt: n.createdAt,
          destination: n.destination ?? `/library/github/${n.importId}`,
          readAt: n.readAt,
          dismissedAt: n.dismissedAt,
        });
      }
      return ok(visible);
    },
    async markRead(input, context) {
      const all = await this.listNotifications({}, context);
      if (!all.ok) return all;
      if (!all.value.some((n) => n.id === input.notificationId))
        return denied();
      const r = await durable.markRead(input);
      if (!r.ok) return r;
      const n = r.value;
      return ok({
        id: n.id,
        importId: n.importId,
        projectId: n.projectId,
        jobId: n.jobId,
        type: n.type === "ready-to-review" ? "ready" : n.type,
        createdAt: n.createdAt,
        destination: n.destination ?? `/library/github/${n.importId}`,
        readAt: n.readAt,
        dismissedAt: n.dismissedAt,
      });
    },
  };
}
