import { createHash, randomUUID } from "node:crypto";
import { rename } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import {
  assertLocalStatePath,
  withLocalStateLock,
  readLocalState,
  writeLocalState,
} from "../local-state";
import {
  createJobOutboxEvent,
  JobFailureCodeSchema,
  JobOutboxEventSchema,
  JobNotificationSchema,
  ok,
  projectJobNotifications,
  type DomainError,
  type JobNotification,
  type Result,
} from "./events";

const STORE_SCHEMA_VERSION = 1;
const DEFAULT_MAX_QUEUED_JOBS = 100;
const DEFAULT_MAX_ACTIVE_JOBS = 1;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_LOCK_WAIT_MS = 5_000;
const MAX_LEASE_MS = 10 * 60_000;
const DEFAULT_RESULT_TTL_MS = 24 * 60 * 60_000;

const MAX_BUDGET_COUNTER = Number.MAX_SAFE_INTEGER;

const SafeIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);
const IsoDateSchema = z.string().datetime({ offset: false });
const BudgetKeySchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-zA-Z][a-zA-Z0-9]*$/);
const BudgetValuesSchema = z
  .record(BudgetKeySchema, z.number().int().min(0).max(MAX_BUDGET_COUNTER))
  .refine((values) => Object.keys(values).length <= 32);
const InitialAllowanceSchema = BudgetValuesSchema.refine(
  (values) => Object.keys(values).length > 0,
);
const ProviderStateSchema = z.enum([
  "not-started",
  "in-flight",
  "completed",
  "unknown",
]);
const JobKindSchema = z.enum(["prepare", "analyze"]);
const JobStateSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "needs-input",
]);

const UsageLedgerSchema = z
  .object({
    reported: BudgetValuesSchema,
    reserved: BudgetValuesSchema,
    uncertain: z.boolean(),
  })
  .strict();

const JobCheckpointSchema = z
  .object({
    version: z.number().int().min(0),
    stage: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9-]*$/),
    providerState: ProviderStateSchema,
    providerResultRef: SafeIdSchema.nullable(),
    updatedAt: IsoDateSchema,
  })
  .strict()
  .superRefine((checkpoint, context) => {
    if (
      checkpoint.providerState === "completed" &&
      checkpoint.providerResultRef === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["providerResultRef"],
        message: "Completed provider work needs a safe result reference.",
      });
    }
  });

const LeaseSchema = z
  .object({
    ownerId: SafeIdSchema,
    acquiredAt: IsoDateSchema,
    expiresAt: IsoDateSchema,
  })
  .strict()
  .refine(
    (lease) => Date.parse(lease.expiresAt) > Date.parse(lease.acquiredAt),
  );

export const JobRecordSchema = z
  .object({
    id: SafeIdSchema,
    runId: SafeIdSchema,
    importId: SafeIdSchema,
    projectId: SafeIdSchema,
    importVersion: z.number().int().positive(),
    selectionVersion: z.number().int().positive(),
    kind: JobKindSchema,
    state: JobStateSchema,
    version: z.number().int().positive(),
    inputHash: Sha256Schema,
    selectionHash: Sha256Schema,
    consentHash: Sha256Schema.nullable(),
    idempotencyKeyHash: Sha256Schema,
    enqueuePayloadHash: Sha256Schema,
    createdAt: IsoDateSchema,
    updatedAt: IsoDateSchema,
    deadlineAt: IsoDateSchema,
    initialAllowance: InitialAllowanceSchema,
    usageLedger: UsageLedgerSchema,
    checkpoint: JobCheckpointSchema,
    executionFence: z.number().int().min(0),
    lease: LeaseSchema.nullable(),
    cancelRequestedAt: IsoDateSchema.nullable(),
    retryRequired: z.boolean(),
    resultRef: SafeIdSchema.nullable(),
    resultExpiresAt: IsoDateSchema.nullable(),
    failureCode: JobFailureCodeSchema.nullable(),
    failureRetryable: z.boolean().nullable(),
    outboxEvents: z.array(JobOutboxEventSchema).max(8),
  })
  .strict()
  .superRefine((job, context) => {
    if (job.kind === "analyze" && job.consentHash === null) {
      context.addIssue({
        code: "custom",
        path: ["consentHash"],
        message: "Analysis jobs need an immutable consent hash.",
      });
    }
    if (job.state === "running" && job.lease === null) {
      context.addIssue({
        code: "custom",
        path: ["lease"],
        message: "A running job needs an active lease.",
      });
    }
    if (job.state !== "running" && job.lease !== null) {
      context.addIssue({
        code: "custom",
        path: ["lease"],
        message: "Only a running job may retain a lease.",
      });
    }
    if (
      job.state === "completed" &&
      (job.resultRef === null || job.resultExpiresAt === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["resultRef"],
        message: "A completed result needs a reference and retention deadline.",
      });
    }
    if (job.state === "running" && job.cancelRequestedAt !== null) {
      context.addIssue({
        code: "custom",
        path: ["cancelRequestedAt"],
        message: "A durably cancelled job cannot keep running.",
      });
    }
    if (
      job.outboxEvents.some(
        (event) =>
          event.jobId !== job.id ||
          event.runId !== job.runId ||
          event.importId !== job.importId ||
          event.projectId !== job.projectId,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["outboxEvents"],
        message: "An outbox event must refer to its owning job.",
      });
    }
  });

export type JobRecord = z.infer<typeof JobRecordSchema>;
export type JobKind = z.infer<typeof JobKindSchema>;
export type JobState = z.infer<typeof JobStateSchema>;
export type JobFailureCode = z.infer<typeof JobFailureCodeSchema>;
export type BudgetValues = z.infer<typeof BudgetValuesSchema>;

const JobStoreDocumentSchema = z
  .object({
    schemaVersion: z.literal(STORE_SCHEMA_VERSION),
    jobs: z.array(JobRecordSchema).max(10_000),
  })
  .strict()
  .superRefine((store, context) => {
    const ids = new Set<string>();
    const runIds = new Set<string>();
    const idempotencyKeys = new Set<string>();
    const eventIds = new Set<string>();
    for (const [index, job] of store.jobs.entries()) {
      if (ids.has(job.id)) {
        context.addIssue({
          code: "custom",
          path: ["jobs", index, "id"],
          message: "Job IDs must be unique.",
        });
      }
      if (runIds.has(job.runId)) {
        context.addIssue({
          code: "custom",
          path: ["jobs", index, "runId"],
          message: "Run IDs must be unique.",
        });
      }
      if (idempotencyKeys.has(job.idempotencyKeyHash)) {
        context.addIssue({
          code: "custom",
          path: ["jobs", index, "idempotencyKeyHash"],
          message: "An idempotency key may identify only one job.",
        });
      }
      ids.add(job.id);
      runIds.add(job.runId);
      idempotencyKeys.add(job.idempotencyKeyHash);
      for (const [eventIndex, event] of job.outboxEvents.entries()) {
        if (eventIds.has(event.id)) {
          context.addIssue({
            code: "custom",
            path: ["jobs", index, "outboxEvents", eventIndex, "id"],
            message: "An outbox event may be stored only once.",
          });
        }
        eventIds.add(event.id);
      }
    }
  });

type JobStoreDocument = z.infer<typeof JobStoreDocumentSchema>;

const EnqueueInputSchema = z
  .object({
    idempotencyKey: z.string().min(1).max(200),
    importId: SafeIdSchema,
    projectId: SafeIdSchema,
    importVersion: z.number().int().positive(),
    selectionVersion: z.number().int().positive(),
    selectionHash: Sha256Schema,
    inputHash: Sha256Schema,
    consentHash: Sha256Schema.optional(),
    kind: JobKindSchema,
    initialAllowance: InitialAllowanceSchema,
    deadlineAt: IsoDateSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.kind === "analyze" && !input.consentHash) {
      context.addIssue({
        code: "custom",
        path: ["consentHash"],
        message: "Analysis jobs need explicit consent for this selection.",
      });
    }
  });

const ClaimInputSchema = z
  .object({
    workerId: SafeIdSchema,
    kinds: z.array(JobKindSchema).min(1).max(2).optional(),
    leaseDurationMs: z.number().int().positive().max(MAX_LEASE_MS).optional(),
  })
  .strict();

const FencedInputSchema = z
  .object({
    jobId: SafeIdSchema,
    workerId: SafeIdSchema,
    fence: z.number().int().positive(),
  })
  .strict();

const CheckpointInputSchema = FencedInputSchema.extend({
  expectedCheckpointVersion: z.number().int().min(0),
  checkpoint: z
    .object({
      stage: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9][a-z0-9-]*$/),
      providerState: ProviderStateSchema,
      providerResultRef: SafeIdSchema.nullable().optional(),
    })
    .strict(),
  usage: z
    .object({
      reported: BudgetValuesSchema.optional(),
      reserved: BudgetValuesSchema.optional(),
    })
    .strict()
    .optional(),
  leaseDurationMs: z.number().int().positive().max(MAX_LEASE_MS).optional(),
}).strict();

const RenewInputSchema = FencedInputSchema.extend({
  leaseDurationMs: z.number().int().positive().max(MAX_LEASE_MS).optional(),
}).strict();

const CancelInputSchema = z.object({ jobId: SafeIdSchema }).strict();

const CompleteInputSchema = FencedInputSchema.extend({
  resultRef: SafeIdSchema,
  resultExpiresAt: IsoDateSchema.optional(),
  eventType: z.enum(["ready-to-review", "needs-input"]).optional(),
}).strict();

const FailInputSchema = FencedInputSchema.extend({
  failureCode: JobFailureCodeSchema,
}).strict();

const RecoverInputSchema = z
  .object({ jobId: SafeIdSchema.optional() })
  .strict();

const ListNotificationsInputSchema = z
  .object({
    includeRead: z.boolean().optional(),
    includeDismissed: z.boolean().optional(),
  })
  .strict();

const MarkReadInputSchema = z
  .object({
    notificationId: SafeIdSchema,
    read: z.boolean().optional(),
    dismissed: z.boolean().optional(),
  })
  .strict();

export type JobStoreDependencies = {
  /** Resolved personal data root. The store never discovers a root from cwd. */
  rootDir: string;
  clock?: { now(): Date };
  createId?: () => string;
  maxQueuedJobs?: number;
  maxActiveJobs?: number;
  leaseDurationMs?: number;
  lockWaitMs?: number;
  /** Replaceable for deterministic atomic-rename failure tests. */
  renameFile?: typeof rename;
};

export class JobStoreFault extends Error {
  constructor(readonly domainError: DomainError) {
    super(domainError.message);
    this.name = "JobStoreFault";
  }
}

function fault(
  code: DomainError["code"],
  message: string,
  retryable = false,
): JobStoreFault {
  return new JobStoreFault({ code, message, retryable });
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function sortedBudget(values: BudgetValues): BudgetValues {
  return Object.fromEntries(
    Object.entries(values).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function emptyUsage(allowance: BudgetValues) {
  return Object.fromEntries(Object.keys(allowance).map((key) => [key, 0]));
}

function hasReservation(values: BudgetValues) {
  return Object.values(values).some((value) => value > 0);
}

function validateUsage(
  allowance: BudgetValues,
  reported: BudgetValues,
  reserved: BudgetValues,
  previousReported?: BudgetValues,
) {
  const allowedKeys = new Set(Object.keys(allowance));
  for (const key of [...Object.keys(reported), ...Object.keys(reserved)]) {
    if (!allowedKeys.has(key)) {
      throw fault(
        "invalid-input",
        "The usage ledger contains a counter outside the accepted allowance.",
      );
    }
  }
  for (const key of allowedKeys) {
    const nextReported = reported[key] ?? 0;
    const nextReserved = reserved[key] ?? 0;
    if (previousReported && nextReported < (previousReported[key] ?? 0)) {
      throw fault(
        "version-conflict",
        "Usage checkpoints must not move reported totals backwards.",
      );
    }
    if (nextReported + nextReserved > allowance[key]) {
      throw fault(
        "limit-exceeded",
        "The job usage exceeds its recorded allowance.",
      );
    }
  }
  return {
    reported: sortedBudget(reported),
    reserved: sortedBudget(reserved),
  };
}

function nowIso(clock: { now(): Date }) {
  const value = clock.now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw fault("io-error", "The job store clock returned an invalid time.");
  }
  return value.toISOString();
}

function validateSafeId(value: string) {
  return SafeIdSchema.safeParse(value).success;
}

function storeMessageFor(error: unknown): DomainError {
  if (error instanceof JobStoreFault) return error.domainError;
  return {
    code: "io-error",
    message: "GitHub job data could not be read or saved.",
    retryable: true,
  };
}

function asResult<T>(operation: () => Promise<T>): Promise<Result<T>> {
  return operation()
    .then((value) => ok(value))
    .catch((error: unknown) => ({ ok: false, error: storeMessageFor(error) }));
}

function appendEvent(job: JobRecord, event: JobRecord["outboxEvents"][number]) {
  if (job.outboxEvents.some((candidate) => candidate.id === event.id)) {
    return job.outboxEvents;
  }
  return [...job.outboxEvents, event];
}

function failureIsRetryable(code: JobFailureCode) {
  return (
    code === "analysis-failed" ||
    code === "provider-outcome-unknown" ||
    code === "upstream-unavailable"
  );
}

function newFailureEvent(
  job: JobRecord,
  code: JobFailureCode,
  createdAt: string,
) {
  const type = code === "needs-context" ? "needs-input" : "failed";
  return createJobOutboxEvent({
    type,
    jobId: job.id,
    runId: job.runId,
    importId: job.importId,
    projectId: job.projectId,
    createdAt,
    resultRef: null,
    resultExpiresAt: null,
    failureCode: type === "failed" ? code : null,
  });
}

function makeEmptyStore(): JobStoreDocument {
  return { schemaVersion: STORE_SCHEMA_VERSION, jobs: [] };
}

export function createJobStore(dependencies: JobStoreDependencies) {
  if (
    !dependencies.rootDir ||
    !dependencies.rootDir.trim() ||
    !isAbsolute(dependencies.rootDir)
  ) {
    throw new Error(
      "createJobStore requires the absolute resolved personal data root.",
    );
  }
  const rootDir = resolve(dependencies.rootDir);
  const dataDirectory = join(rootDir, "data", "github-jobs");
  const storePath = join(dataDirectory, "jobs.json");
  const lockPath = `${storePath}.lock`;
  const clock = dependencies.clock ?? { now: () => new Date() };
  const createId = dependencies.createId ?? randomUUID;
  const maxQueuedJobs = dependencies.maxQueuedJobs ?? DEFAULT_MAX_QUEUED_JOBS;
  const maxActiveJobs = dependencies.maxActiveJobs ?? DEFAULT_MAX_ACTIVE_JOBS;
  const defaultLeaseMs = dependencies.leaseDurationMs ?? DEFAULT_LEASE_MS;
  const lockWaitMs = dependencies.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS;
  const renameFile = dependencies.renameFile ?? rename;

  if (
    !Number.isSafeInteger(maxQueuedJobs) ||
    maxQueuedJobs < 1 ||
    maxQueuedJobs > 10_000 ||
    !Number.isSafeInteger(maxActiveJobs) ||
    maxActiveJobs < 1 ||
    maxActiveJobs > 100 ||
    !Number.isSafeInteger(defaultLeaseMs) ||
    defaultLeaseMs < 1 ||
    defaultLeaseMs > MAX_LEASE_MS ||
    !Number.isSafeInteger(lockWaitMs) ||
    lockWaitMs < 0 ||
    lockWaitMs > 60_000
  ) {
    throw new Error("createJobStore received an invalid bounded-store policy.");
  }

  async function readStore(): Promise<JobStoreDocument> {
    try {
      const raw = await readLocalState(rootDir, storePath, 32 * 1024 * 1024);
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        throw fault(
          "io-error",
          "Saved GitHub job data contains invalid JSON and was left unchanged.",
        );
      }
      const parsed = JobStoreDocumentSchema.safeParse(value);
      if (!parsed.success) {
        throw fault(
          "io-error",
          "Saved GitHub job data does not match its schema and was left unchanged.",
        );
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof JobStoreFault) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return makeEmptyStore();
      }
      throw fault("io-error", "Saved GitHub job data could not be read.", true);
    }
  }

  async function saveStore(store: JobStoreDocument) {
    const parsed = JobStoreDocumentSchema.safeParse(store);
    if (!parsed.success) {
      throw fault("io-error", "The GitHub job update failed validation.");
    }
    try {
      await writeLocalState(
        rootDir,
        storePath,
        `${JSON.stringify(parsed.data, null, 2)}\n`,
        renameFile,
      );
    } catch (error) {
      if (error instanceof JobStoreFault) throw error;
      throw fault(
        "io-error",
        "GitHub job data could not be saved; the previous record was preserved.",
        true,
      );
    }
  }

  async function mutate<T>(
    operation: (
      store: JobStoreDocument,
      timestamp: string,
    ) => {
      value: T;
      changed: boolean;
    },
  ) {
    await assertLocalStatePath(rootDir, lockPath);
    return withLocalStateLock(
      rootDir,
      storePath,
      async () => {
        const store = await readStore();
        const timestamp = nowIso(clock);
        const result = operation(store, timestamp);
        if (result.changed) await saveStore(store);
        return result.value;
      },
      lockWaitMs,
    );
  }

  function findJob(store: JobStoreDocument, jobId: string) {
    const job = store.jobs.find((candidate) => candidate.id === jobId);
    if (!job) throw fault("not-found", "GitHub job not found.");
    return job;
  }

  function requireCurrentLease(
    job: JobRecord,
    input: { workerId: string; fence: number },
    timestamp: string,
  ) {
    if (
      job.state !== "running" ||
      job.executionFence !== input.fence ||
      job.lease?.ownerId !== input.workerId
    ) {
      throw fault(
        "version-conflict",
        "This worker no longer owns the current job lease.",
      );
    }
    if (Date.parse(job.lease.expiresAt) <= Date.parse(timestamp)) {
      throw fault(
        "version-conflict",
        "The job lease expired before this update was accepted.",
      );
    }
    if (job.cancelRequestedAt !== null) {
      throw fault("cancelled", "The GitHub job was cancelled.");
    }
  }

  return {
    isImportRunActive(input: {
      importId: string;
      runId: string;
    }): Promise<boolean> {
      return readStore().then((store) =>
        store.jobs.some(
          (job) =>
            job.importId === input.importId &&
            job.runId === input.runId &&
            (job.state === "queued" || job.state === "running"),
        ),
      );
    },

    enqueue(input: unknown): Promise<Result<JobRecord>> {
      return asResult(async () => {
        const parsed = EnqueueInputSchema.safeParse(input);
        if (!parsed.success) {
          throw fault("invalid-input", "The GitHub job request is invalid.");
        }
        const data = parsed.data;
        const initialAllowance = sortedBudget(data.initialAllowance);
        const keyHash = hash(`${data.importId}\u0000${data.idempotencyKey}`);
        const payloadHash = hash(
          JSON.stringify({
            ...data,
            initialAllowance,
            idempotencyKey: undefined,
          }),
        );
        return mutate((store, timestamp) => {
          if (Date.parse(data.deadlineAt) <= Date.parse(timestamp)) {
            throw fault(
              "invalid-input",
              "The job deadline must be in the future.",
            );
          }
          const prior = store.jobs.find(
            (job) => job.idempotencyKeyHash === keyHash,
          );
          if (prior) {
            if (prior.enqueuePayloadHash !== payloadHash) {
              throw fault(
                "version-conflict",
                "This idempotency key was already used for different job inputs.",
              );
            }
            return { value: prior, changed: false };
          }
          const queuedCount = store.jobs.filter(
            (job) => job.state === "queued",
          ).length;
          if (queuedCount >= maxQueuedJobs) {
            throw fault(
              "limit-exceeded",
              "The GitHub analysis queue is full. Try again after a job finishes.",
            );
          }
          const id = createId();
          const runId = createId();
          const claimedIds = new Set(
            store.jobs.flatMap((job) => [job.id, job.runId]),
          );
          if (
            !validateSafeId(id) ||
            !validateSafeId(runId) ||
            id === runId ||
            claimedIds.has(id) ||
            claimedIds.has(runId)
          ) {
            throw fault(
              "io-error",
              "The job store could not create unique IDs.",
            );
          }
          const checkpoint = {
            version: 0,
            stage: "queued",
            providerState: "not-started" as const,
            providerResultRef: null,
            updatedAt: timestamp,
          };
          const job: JobRecord = {
            id,
            runId,
            importId: data.importId,
            projectId: data.projectId,
            importVersion: data.importVersion,
            selectionVersion: data.selectionVersion,
            kind: data.kind,
            state: "queued",
            version: 1,
            inputHash: data.inputHash,
            selectionHash: data.selectionHash,
            consentHash: data.consentHash ?? null,
            idempotencyKeyHash: keyHash,
            enqueuePayloadHash: payloadHash,
            createdAt: timestamp,
            updatedAt: timestamp,
            deadlineAt: data.deadlineAt,
            initialAllowance,
            usageLedger: {
              reported: emptyUsage(initialAllowance),
              reserved: emptyUsage(initialAllowance),
              uncertain: false,
            },
            checkpoint,
            executionFence: 0,
            lease: null,
            cancelRequestedAt: null,
            retryRequired: false,
            resultRef: null,
            resultExpiresAt: null,
            failureCode: null,
            failureRetryable: null,
            outboxEvents: [],
          };
          const checked = JobRecordSchema.safeParse(job);
          if (!checked.success) {
            throw fault("invalid-input", "The GitHub job request is invalid.");
          }
          store.jobs.push(checked.data);
          return { value: checked.data, changed: true };
        });
      });
    },

    claim(input: unknown): Promise<Result<JobRecord | null>> {
      return asResult(async () => {
        const parsed = ClaimInputSchema.safeParse(input);
        if (!parsed.success) {
          throw fault("invalid-input", "The worker claim request is invalid.");
        }
        const { workerId, kinds } = parsed.data;
        const leaseMs = parsed.data.leaseDurationMs ?? defaultLeaseMs;
        return mutate((store, timestamp) => {
          const timestampMs = Date.parse(timestamp);
          let changed = false;
          for (const job of store.jobs) {
            if (
              job.state !== "queued" ||
              Date.parse(job.deadlineAt) > timestampMs
            )
              continue;
            job.state = "failed";
            job.failureCode = "deadline-exceeded";
            job.failureRetryable = false;
            job.retryRequired = false;
            job.updatedAt = timestamp;
            job.version += 1;
            job.outboxEvents = appendEvent(
              job,
              newFailureEvent(job, "deadline-exceeded", timestamp),
            );
            changed = true;
          }
          const activeCount = store.jobs.filter(
            (job) => job.state === "running",
          ).length;
          if (activeCount >= maxActiveJobs) {
            return { value: null, changed };
          }
          const job = store.jobs
            .filter(
              (candidate) =>
                candidate.state === "queued" &&
                (!kinds || kinds.includes(candidate.kind)),
            )
            .sort(
              (left, right) =>
                left.createdAt.localeCompare(right.createdAt) ||
                left.id.localeCompare(right.id),
            )[0];
          if (!job) return { value: null, changed };
          job.state = "running";
          job.executionFence += 1;
          job.lease = {
            ownerId: workerId,
            acquiredAt: timestamp,
            expiresAt: new Date(timestampMs + leaseMs).toISOString(),
          };
          job.updatedAt = timestamp;
          job.version += 1;
          return { value: job, changed: true };
        });
      });
    },

    renew(input: unknown): Promise<Result<JobRecord>> {
      return asResult(async () => {
        const parsed = RenewInputSchema.safeParse(input);
        if (!parsed.success) {
          throw fault("invalid-input", "The lease renewal request is invalid.");
        }
        const leaseMs = parsed.data.leaseDurationMs ?? defaultLeaseMs;
        return mutate((store, timestamp) => {
          const job = findJob(store, parsed.data.jobId);
          requireCurrentLease(job, parsed.data, timestamp);
          job.lease = {
            ...job.lease!,
            expiresAt: new Date(Date.parse(timestamp) + leaseMs).toISOString(),
          };
          job.updatedAt = timestamp;
          job.version += 1;
          return { value: job, changed: true };
        });
      });
    },

    checkpoint(input: unknown): Promise<Result<JobRecord>> {
      return asResult(async () => {
        const parsed = CheckpointInputSchema.safeParse(input);
        if (!parsed.success) {
          throw fault("invalid-input", "The job checkpoint is invalid.");
        }
        const leaseMs = parsed.data.leaseDurationMs ?? defaultLeaseMs;
        return mutate((store, timestamp) => {
          const job = findJob(store, parsed.data.jobId);
          requireCurrentLease(job, parsed.data, timestamp);
          if (
            job.checkpoint.version !== parsed.data.expectedCheckpointVersion
          ) {
            throw fault(
              "version-conflict",
              "The job checkpoint changed before this update was saved.",
            );
          }
          const nextProviderState = parsed.data.checkpoint.providerState;
          const allowedProviderTransitions: Record<
            z.infer<typeof ProviderStateSchema>,
            readonly z.infer<typeof ProviderStateSchema>[]
          > = {
            "not-started": ["not-started", "in-flight"],
            "in-flight": ["in-flight", "unknown", "completed"],
            unknown: ["unknown", "completed"],
            completed: ["completed"],
          };
          if (
            !allowedProviderTransitions[job.checkpoint.providerState].includes(
              nextProviderState,
            )
          ) {
            throw fault(
              "version-conflict",
              "Provider checkpoints cannot move backwards or repeat paid work.",
            );
          }
          if (
            job.checkpoint.providerState === "completed" &&
            parsed.data.checkpoint.providerResultRef !==
              job.checkpoint.providerResultRef
          ) {
            throw fault(
              "version-conflict",
              "A completed provider result reference cannot be replaced.",
            );
          }
          if (
            parsed.data.checkpoint.providerResultRef !== undefined &&
            nextProviderState !== "completed" &&
            parsed.data.checkpoint.providerResultRef !== null
          ) {
            throw fault(
              "invalid-input",
              "A provider result reference requires a completed checkpoint.",
            );
          }
          const requestedReported = sortedBudget(
            parsed.data.usage?.reported ?? job.usageLedger.reported,
          );
          const requestedReserved = sortedBudget(
            parsed.data.usage?.reserved ?? job.usageLedger.reserved,
          );
          const usage = validateUsage(
            job.initialAllowance,
            requestedReported,
            requestedReserved,
            job.usageLedger.reported,
          );
          const nextCheckpoint = {
            version: job.checkpoint.version + 1,
            stage: parsed.data.checkpoint.stage,
            providerState: nextProviderState,
            providerResultRef: parsed.data.checkpoint.providerResultRef ?? null,
            updatedAt: timestamp,
          };
          const checked = JobCheckpointSchema.safeParse(nextCheckpoint);
          if (!checked.success) {
            throw fault(
              "invalid-input",
              "The job checkpoint is missing required provider state.",
            );
          }
          job.checkpoint = checked.data;
          job.usageLedger = {
            ...usage,
            uncertain:
              nextProviderState === "unknown" ||
              (nextProviderState === "in-flight" && job.usageLedger.uncertain),
          };
          job.lease = {
            ...job.lease!,
            expiresAt: new Date(Date.parse(timestamp) + leaseMs).toISOString(),
          };
          job.updatedAt = timestamp;
          job.version += 1;
          return { value: job, changed: true };
        });
      });
    },

    requestCancel(input: unknown): Promise<Result<JobRecord>> {
      return asResult(async () => {
        const parsed = CancelInputSchema.safeParse(input);
        if (!parsed.success) {
          throw fault("invalid-input", "The cancellation request is invalid.");
        }
        return mutate((store, timestamp) => {
          const job = findJob(store, parsed.data.jobId);
          if (job.state === "cancelled") return { value: job, changed: false };
          if (job.state !== "queued" && job.state !== "running") {
            throw fault(
              "version-conflict",
              "A finished GitHub job cannot be cancelled.",
            );
          }
          job.state = "cancelled";
          job.cancelRequestedAt = timestamp;
          job.executionFence += 1;
          job.lease = null;
          job.retryRequired = false;
          job.updatedAt = timestamp;
          job.version += 1;
          return { value: job, changed: true };
        });
      });
    },

    completeWithEvent(input: unknown): Promise<Result<JobRecord>> {
      return asResult(async () => {
        const parsed = CompleteInputSchema.safeParse(input);
        if (!parsed.success) {
          throw fault("invalid-input", "The job completion is invalid.");
        }
        return mutate((store, timestamp) => {
          const job = findJob(store, parsed.data.jobId);
          const eventType =
            parsed.data.eventType ??
            (job.kind === "analyze" ? "ready-to-review" : "needs-input");
          if (job.executionFence !== parsed.data.fence)
            throw fault(
              "version-conflict",
              "This worker no longer owns the current job fence.",
            );
          if (
            (job.state === "completed" || job.state === "needs-input") &&
            job.resultRef === parsed.data.resultRef &&
            job.outboxEvents.some(
              (event) =>
                event.type === eventType && event.resultRef === job.resultRef,
            )
          ) {
            return { value: job, changed: false };
          }
          requireCurrentLease(job, parsed.data, timestamp);
          if (
            (job.kind === "analyze" && eventType !== "ready-to-review") ||
            (job.kind === "prepare" && eventType === "ready-to-review")
          ) {
            throw fault(
              "invalid-input",
              "The completion event does not match the job kind.",
            );
          }
          if (
            eventType === "ready-to-review" &&
            (job.checkpoint.providerState !== "completed" ||
              job.checkpoint.providerResultRef === null ||
              job.usageLedger.uncertain ||
              hasReservation(job.usageLedger.reserved))
          ) {
            throw fault(
              "interrupted",
              "Analysis cannot be marked ready until provider completion and usage are reconciled.",
              true,
            );
          }
          const expiry =
            parsed.data.resultExpiresAt ??
            new Date(
              Date.parse(timestamp) + DEFAULT_RESULT_TTL_MS,
            ).toISOString();
          const event = createJobOutboxEvent({
            type: eventType,
            jobId: job.id,
            runId: job.runId,
            importId: job.importId,
            projectId: job.projectId,
            createdAt: timestamp,
            resultRef: parsed.data.resultRef,
            resultExpiresAt: expiry,
            failureCode: null,
          });
          job.state =
            eventType === "ready-to-review" ? "completed" : "needs-input";
          job.resultRef = parsed.data.resultRef;
          job.resultExpiresAt = expiry;
          job.failureCode = null;
          job.failureRetryable = null;
          job.retryRequired = false;
          job.lease = null;
          job.updatedAt = timestamp;
          job.version += 1;
          job.usageLedger = { ...job.usageLedger, uncertain: false };
          job.outboxEvents = appendEvent(job, event);
          return { value: job, changed: true };
        });
      });
    },

    fail(input: unknown): Promise<Result<JobRecord>> {
      return asResult(async () => {
        const parsed = FailInputSchema.safeParse(input);
        if (!parsed.success) {
          throw fault("invalid-input", "The job failure update is invalid.");
        }
        return mutate((store, timestamp) => {
          const job = findJob(store, parsed.data.jobId);
          if (
            (job.state === "failed" ||
              job.state === "interrupted" ||
              job.state === "needs-input") &&
            job.failureCode === parsed.data.failureCode
          ) {
            return { value: job, changed: false };
          }
          requireCurrentLease(job, parsed.data, timestamp);
          const code = parsed.data.failureCode;
          const uncertainProvider =
            code === "provider-outcome-unknown" ||
            (job.kind === "analyze" &&
              (job.checkpoint.providerState === "in-flight" ||
                job.checkpoint.providerState === "unknown"));
          const state = uncertainProvider
            ? "interrupted"
            : code === "needs-context"
              ? "needs-input"
              : "failed";
          job.state = state;
          job.failureCode = uncertainProvider
            ? "provider-outcome-unknown"
            : code;
          job.failureRetryable = uncertainProvider
            ? true
            : failureIsRetryable(code);
          job.retryRequired = uncertainProvider;
          job.usageLedger = {
            ...job.usageLedger,
            uncertain: uncertainProvider || job.usageLedger.uncertain,
          };
          job.lease = null;
          job.updatedAt = timestamp;
          job.version += 1;
          job.outboxEvents = appendEvent(
            job,
            newFailureEvent(job, job.failureCode, timestamp),
          );
          return { value: job, changed: true };
        });
      });
    },

    recoverExpiredLease(input: unknown = {}): Promise<Result<JobRecord[]>> {
      return asResult(async () => {
        const parsed = RecoverInputSchema.safeParse(input);
        if (!parsed.success) {
          throw fault(
            "invalid-input",
            "The lease recovery request is invalid.",
          );
        }
        return mutate((store, timestamp) => {
          const timestampMs = Date.parse(timestamp);
          const recovered: JobRecord[] = [];
          for (const job of store.jobs) {
            if (
              (parsed.data.jobId && job.id !== parsed.data.jobId) ||
              job.state !== "running" ||
              job.lease === null ||
              Date.parse(job.lease.expiresAt) > timestampMs
            ) {
              continue;
            }
            job.executionFence += 1;
            job.lease = null;
            job.updatedAt = timestamp;
            job.version += 1;
            if (Date.parse(job.deadlineAt) <= timestampMs) {
              job.state = "failed";
              job.failureCode = "deadline-exceeded";
              job.failureRetryable = false;
              job.retryRequired = false;
              job.outboxEvents = appendEvent(
                job,
                newFailureEvent(job, "deadline-exceeded", timestamp),
              );
            } else if (
              job.kind === "analyze" &&
              (job.checkpoint.providerState === "in-flight" ||
                job.checkpoint.providerState === "unknown" ||
                (job.checkpoint.providerState === "completed" &&
                  job.checkpoint.providerResultRef === null))
            ) {
              job.state = "interrupted";
              job.failureCode = "provider-outcome-unknown";
              job.failureRetryable = true;
              job.retryRequired = true;
              job.usageLedger = { ...job.usageLedger, uncertain: true };
              job.outboxEvents = appendEvent(
                job,
                newFailureEvent(job, "provider-outcome-unknown", timestamp),
              );
            } else {
              const queuedCount = store.jobs.filter(
                (candidate) => candidate.state === "queued",
              ).length;
              if (queuedCount >= maxQueuedJobs) {
                job.state = "interrupted";
                job.failureCode = "upstream-unavailable";
                job.failureRetryable = true;
                job.retryRequired = true;
                job.outboxEvents = appendEvent(
                  job,
                  newFailureEvent(job, "upstream-unavailable", timestamp),
                );
              } else {
                job.state = "queued";
                job.failureCode = null;
                job.failureRetryable = null;
                job.retryRequired = false;
              }
            }
            recovered.push(job);
          }
          return { value: recovered, changed: recovered.length > 0 };
        });
      });
    },

    listNotifications(input: unknown = {}): Promise<Result<JobNotification[]>> {
      return asResult(async () => {
        const parsed = ListNotificationsInputSchema.safeParse(input);
        if (!parsed.success) {
          throw fault("invalid-input", "The notification query is invalid.");
        }
        const store = await readStore();
        const notifications = projectJobNotifications(store.jobs, clock.now());
        return notifications
          .filter(
            (notification) =>
              (parsed.data.includeRead ?? true) || notification.readAt === null,
          )
          .filter(
            (notification) =>
              (parsed.data.includeDismissed ?? false) ||
              notification.dismissedAt === null,
          );
      });
    },

    markRead(input: unknown): Promise<Result<JobNotification>> {
      return asResult(async () => {
        const parsed = MarkReadInputSchema.safeParse(input);
        if (!parsed.success) {
          throw fault("invalid-input", "The notification update is invalid.");
        }
        return mutate((store, timestamp) => {
          let owner: JobRecord | undefined;
          let eventIndex = -1;
          for (const job of store.jobs) {
            const index = job.outboxEvents.findIndex(
              (event) => event.id === parsed.data.notificationId,
            );
            if (index !== -1) {
              owner = job;
              eventIndex = index;
              break;
            }
          }
          if (!owner || eventIndex < 0) {
            throw fault("not-found", "Achievement notification not found.");
          }
          const event = owner.outboxEvents[eventIndex]!;
          const nextReadAt =
            parsed.data.read === undefined
              ? (event.readAt ?? timestamp)
              : parsed.data.read
                ? (event.readAt ?? timestamp)
                : null;
          const nextDismissedAt =
            parsed.data.dismissed === undefined
              ? event.dismissedAt
              : parsed.data.dismissed
                ? (event.dismissedAt ?? timestamp)
                : null;
          const changed =
            nextReadAt !== event.readAt ||
            nextDismissedAt !== event.dismissedAt;
          if (changed) {
            owner.outboxEvents[eventIndex] = {
              ...event,
              readAt: nextReadAt,
              dismissedAt: nextDismissedAt,
            };
            owner.updatedAt = timestamp;
            owner.version += 1;
          }
          const projected = projectJobNotifications([owner], clock.now()).find(
            (notification) => notification.id === event.id,
          );
          if (!projected) {
            throw fault("io-error", "The notification could not be projected.");
          }
          const checked = JobNotificationSchema.safeParse(projected);
          if (!checked.success) {
            throw fault("io-error", "The notification record is invalid.");
          }
          return { value: checked.data, changed };
        });
      });
    },
  };
}
