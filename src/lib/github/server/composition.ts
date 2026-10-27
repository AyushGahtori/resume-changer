import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { getPersonalDataRoot } from "../../data/root";
import { createUnavailableGithubPorts } from "./unavailable";
import {
  createJobStore,
  JobRecordSchema as DurableJobRecordSchema,
  type JobRecord as DurableJobRecord,
} from "./jobs/store";
import {
  JobNotificationSchema,
  projectJobNotifications,
  type JobNotification as DurableNotification,
} from "./jobs/events";
import { readLocalState } from "./local-state";
import type { DomainError, ExecutionContext, Result } from "../contracts";
import type {
  GithubFactoryPorts,
  GithubServices,
  ImportJobRunnerPort,
  MeasurementServicePort,
  DeferredMeasurementTaskStorePort,
} from "../ports";

export type GithubJobStatus = {
  id: string;
  runId: string;
  importId: string;
  state:
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted"
    | "needs-input";
  stage: string;
  updatedAt: string;
  resultRef: string | null;
  expired: boolean;
  safeError: DomainError | null;
};

export type GithubNotification = {
  id: string;
  jobId: string;
  importId: string;
  projectId: string;
  type: "ready" | "needs-input" | "failed" | "expired";
  createdAt: string;
  readAt: string | null;
  dismissedAt: string | null;
  destination: string | null;
};

export type GithubNotificationPage = {
  notifications: GithubNotification[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type GithubStatusEvent = {
  id: string;
  cursor: string;
  type: "job" | "notification";
  createdAt: string;
  job?: GithubJobStatus;
  notification?: GithubNotification;
};

export type GithubStatusPage = {
  events: GithubStatusEvent[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type GithubRequestIdentity = {
  request: Request;
  accountId?: string;
  signal: AbortSignal;
};

export type GithubContextResult = Result<ExecutionContext>;

export type GithubRuntimeBindings = {
  createContext(input: GithubRequestIdentity): Promise<GithubContextResult>;
};

export type GithubServerServices = Omit<GithubServices, "notifications"> & {
  measurements: MeasurementServicePort;
  deferredTasks: DeferredMeasurementTaskStorePort;
  runner: ImportJobRunnerPort;

  notifications: {
    list(
      input: {
        cursor: string | null;
        limit: number;
      },
      context: ExecutionContext,
    ): Promise<Result<GithubNotificationPage>>;
    markRead(
      input: {
        notificationId: string;
      },
      context: ExecutionContext,
    ): Promise<Result<GithubNotification>>;
  };
  createContext(input: GithubRequestIdentity): Promise<GithubContextResult>;
  status: {
    getJob(input: {
      jobId: string;
      context: ExecutionContext;
    }): Promise<Result<GithubJobStatus>>;
  };
  events: {
    /** Reads the durable local outbox only. */
    read(input: {
      context: ExecutionContext;
      cursor: string | null;
      limit: number;
    }): Promise<Result<GithubStatusPage>>;
  };
  worker: {
    run(input: { signal: AbortSignal }): Promise<Result<void>>;
  };
};

export type GithubServicesFactory = (input: {
  personalRoot: string;
  now: () => Date;
}) => GithubServerServices | Promise<GithubServerServices>;

export type GithubRuntimeFactory = (input: {
  personalRoot: string;
  now: () => Date;
}) =>
  | { ports: GithubFactoryPorts; bindings: GithubRuntimeBindings }
  | Promise<{ ports: GithubFactoryPorts; bindings: GithubRuntimeBindings }>;

export type GithubCompositionInput = {
  ports: GithubFactoryPorts;
  bindings: GithubRuntimeBindings;
  personalRoot: string;
  now?: () => Date;
};

const unavailableError: DomainError = {
  code: "unavailable",
  message: "GitHub import services are not configured yet.",
  retryable: true,
};

const unavailableResult = <T>(): Result<T> => ({
  ok: false,
  error: unavailableError,
});

const forbiddenJobError: DomainError = {
  code: "forbidden",
  message: "This job is not available in the current session.",
  retryable: false,
};

const DurableJobStoreSchema = z
  .object({
    schemaVersion: z.literal(1),
    jobs: z.array(DurableJobRecordSchema).max(10_000),
  })
  .strict();

function notificationDto(value: DurableNotification): GithubNotification {
  return {
    id: value.id,
    jobId: value.jobId,
    importId: value.importId,
    projectId: value.projectId,
    type: value.type === "ready-to-review" ? "ready" : value.type,
    createdAt: value.createdAt,
    readAt: value.readAt,
    dismissedAt: value.dismissedAt,
    destination: value.destination,
  };
}

function eventCursor(
  value: DurableNotification,
  expiresAt: string | null = null,
): string {
  const changedAt = [
    value.createdAt,
    value.readAt ?? value.createdAt,
    value.dismissedAt ?? value.createdAt,
    value.type === "expired" ? (expiresAt ?? value.createdAt) : value.createdAt,
  ]
    .sort()
    .at(-1)!;
  return `${changedAt}:${value.id}:${value.readAt ? "1" : "0"}:${value.dismissedAt ? "1" : "0"}:${value.type}`;
}

function stableEventId(namespace: "job" | "notification", ...parts: string[]) {
  const digest = createHash("sha256")
    .update(parts.join("\u0000"))
    .digest("hex");
  return `${namespace}-${digest}`;
}

function notificationEvent(
  value: DurableNotification,
  expiresAt: string | null = null,
): GithubStatusEvent {
  const notification = notificationDto(value);
  return {
    id: stableEventId(
      "notification",
      value.id,
      value.type,
      value.readAt ?? "unread",
      value.dismissedAt ?? "active",
    ),
    cursor: eventCursor(value, expiresAt),
    type: "notification",
    createdAt: value.createdAt,
    notification,
  };
}

function jobStatus(value: DurableJobRecord, now: Date): GithubJobStatus {
  const expired =
    value.resultExpiresAt !== null &&
    Date.parse(value.resultExpiresAt) <= now.getTime();
  const safeError: DomainError | null = value.failureCode
    ? {
        code:
          value.failureCode === "needs-context"
            ? "needs-context"
            : value.failureCode === "invalid-evidence"
              ? "invalid-evidence"
              : value.failureCode === "deadline-exceeded"
                ? "limit-exceeded"
                : value.failureCode === "analysis-failed"
                  ? "upstream-error"
                  : "unavailable",
        message:
          value.failureCode === "needs-context"
            ? "Add the missing contribution context and try again."
            : value.failureCode === "invalid-evidence"
              ? "The selected repository evidence could not be verified."
              : "GitHub analysis could not be completed.",
        retryable: value.failureRetryable ?? false,
      }
    : null;
  return {
    id: value.id,
    runId: value.runId,
    importId: value.importId,
    state: value.state,
    stage: value.checkpoint.stage,
    updatedAt: value.updatedAt,
    resultRef: expired ? null : value.resultRef,
    expired,
    safeError,
  };
}

function jobEvent(value: DurableJobRecord, now: Date): GithubStatusEvent {
  const status = jobStatus(value, now);
  const changedAt = status.expired ? value.resultExpiresAt! : value.updatedAt;
  return {
    id: stableEventId(
      "job",
      value.id,
      String(value.version),
      status.expired ? "expired" : "active",
    ),
    cursor: `${changedAt}:${value.id}:${String(value.version).padStart(12, "0")}:job:${status.expired ? "expired" : "active"}`,
    type: "job",
    createdAt: changedAt,
    job: status,
  };
}

/** Bind the stable Gate-0 ports to Task 20's status, notification, and worker boundary. */
export function composeGithubServices(
  input: GithubCompositionInput,
): GithubServerServices {
  if (
    !isAbsolute(input.personalRoot) ||
    resolve(input.personalRoot) !== input.personalRoot
  ) {
    throw new Error("GitHub services require one resolved personal data root.");
  }
  const { ports, bindings } = input;
  const now = input.now ?? (() => new Date());
  const durableJobs = createJobStore({
    rootDir: input.personalRoot,
    clock: { now },
  });

  async function readDurableJobs(): Promise<DurableJobRecord[]> {
    let content: string;
    try {
      content = await readLocalState(
        input.personalRoot,
        join(input.personalRoot, "data", "github-jobs", "jobs.json"),
        32 * 1024 * 1024,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const parsed = DurableJobStoreSchema.safeParse(JSON.parse(content));
    if (!parsed.success)
      throw new Error("The saved GitHub job state is invalid.");
    return parsed.data.jobs;
  }

  async function authorizedNotifications(
    context: ExecutionContext,
    jobs?: DurableJobRecord[],
  ): Promise<
    Result<{
      notifications: DurableNotification[];
      expiresAtById: Map<string, string | null>;
    }>
  > {
    let records = jobs;
    if (!records) {
      try {
        records = await readDurableJobs();
      } catch {
        return {
          ok: false,
          error: {
            code: "io-error",
            message: "Saved GitHub job state could not be read safely.",
            retryable: true,
          },
        };
      }
    }
    const projected = projectJobNotifications(records, now());
    const expiresAtById = new Map<string, string | null>();
    for (const job of records) {
      for (const event of job.outboxEvents) {
        expiresAtById.set(event.id, event.resultExpiresAt);
      }
    }
    const visible: DurableNotification[] = [];
    for (const candidate of projected) {
      const notification = JobNotificationSchema.safeParse(candidate);
      if (!notification.success) continue;
      const owner = await ports.imports.get(
        { id: notification.data.importId },
        context,
      );
      if (!owner.ok) {
        if (owner.error.code === "io-error") return owner;
        continue;
      }
      if (owner.value.destinationProjectId === notification.data.projectId)
        visible.push(notification.data);
    }
    return { ok: true, value: { notifications: visible, expiresAtById } };
  }

  async function listNotifications(
    context: ExecutionContext,
    cursor: string | null,
    limit: number,
  ): Promise<Result<GithubNotificationPage>> {
    const result = await authorizedNotifications(context);
    if (!result.ok) return { ok: false, error: result.error };
    const sorted = result.value.notifications
      .map((notification) => ({
        notification,
        cursor: eventCursor(
          notification,
          result.value.expiresAtById.get(notification.id),
        ),
      }))
      .filter(({ cursor: nextCursor }) => !cursor || nextCursor > cursor)
      .sort((left, right) => left.cursor.localeCompare(right.cursor));
    const page = sorted.slice(0, limit);
    return {
      ok: true,
      value: {
        notifications: page.map(({ notification }) =>
          notificationDto(notification),
        ),
        nextCursor: page.at(-1)?.cursor ?? cursor,
        hasMore: sorted.length > page.length,
      },
    };
  }

  async function createContext(
    identity: GithubRequestIdentity,
  ): Promise<GithubContextResult> {
    const result = await bindings.createContext(identity);
    if (!result.ok) return result;
    if (result.value.personalRoot !== input.personalRoot) {
      return {
        ok: false,
        error: {
          code: "io-error",
          message:
            "The GitHub session is bound to a different local data root.",
          retryable: false,
        },
      };
    }
    return result;
  }

  return {
    imports: ports.service,
    jobs: ports.jobs,
    access: ports.access,
    measurements: ports.measurementService,
    deferredTasks: ports.deferredTasks,
    runner: ports.runner,
    notifications: {
      async list({ cursor, limit }, context) {
        return listNotifications(context, cursor ?? null, limit ?? 100);
      },
      async markRead({ notificationId }, context) {
        const visible = await authorizedNotifications(context);
        if (!visible.ok) return { ok: false, error: visible.error };
        if (
          !visible.value.notifications.some(
            (item) => item.id === notificationId,
          )
        )
          return {
            ok: false,
            error: {
              code: "not-found",
              message: "Achievement notification not found.",
              retryable: false,
            },
          };
        const result = await durableJobs.markRead({
          notificationId,
          read: true,
        });
        if (!result.ok) return result;
        const checked = JobNotificationSchema.safeParse(result.value);
        if (!checked.success)
          return {
            ok: false,
            error: {
              code: "io-error",
              message: "The notification record is invalid.",
              retryable: false,
            },
          };
        return { ok: true, value: notificationDto(checked.data) };
      },
    },
    createContext,
    status: {
      async getJob({ jobId, context }) {
        let jobs: DurableJobRecord[];
        try {
          jobs = await readDurableJobs();
        } catch {
          return {
            ok: false,
            error: {
              code: "io-error",
              message: "Saved GitHub job state could not be read safely.",
              retryable: true,
            },
          };
        }
        const job = jobs.find((candidate) => candidate.id === jobId);
        if (!job)
          return {
            ok: false,
            error: {
              code: "not-found",
              message: "GitHub job not found.",
              retryable: false,
            },
          };
        const owner = await ports.imports.get({ id: job.importId }, context);
        if (!owner.ok) {
          if (
            owner.error.code === "not-found" ||
            owner.error.code === "forbidden"
          )
            return { ok: false, error: forbiddenJobError };
          return owner;
        }
        if (owner.value.destinationProjectId !== job.projectId)
          return {
            ok: false,
            error: {
              code: "not-found",
              message: "GitHub job not found.",
              retryable: false,
            },
          };
        return {
          ok: true,
          value: jobStatus(job, now()),
        };
      },
    },
    events: {
      async read({ context, cursor, limit }) {
        const jobsResult = await readDurableJobs().then(
          (value) => ({ ok: true as const, value }),
          () => ({
            ok: false as const,
            error: {
              code: "io-error" as const,
              message: "Saved GitHub job state could not be read safely.",
              retryable: true,
            },
          }),
        );
        if (!jobsResult.ok) return jobsResult;
        const notificationsResult = await authorizedNotifications(
          context,
          jobsResult.value,
        );
        if (!notificationsResult.ok)
          return { ok: false, error: notificationsResult.error };

        const candidates: GithubStatusEvent[] =
          notificationsResult.value.notifications
            .map((notification) =>
              notificationEvent(
                notification,
                notificationsResult.value.expiresAtById.get(notification.id),
              ),
            )
            .filter((event) => !cursor || event.cursor > cursor);
        for (const job of jobsResult.value) {
          const owner = await ports.imports.get({ id: job.importId }, context);
          if (!owner.ok) {
            if (owner.error.code === "io-error") return owner;
            continue;
          }
          if (owner.value.destinationProjectId !== job.projectId) continue;
          const event = jobEvent(job, now());
          if (!cursor || event.cursor > cursor) candidates.push(event);
        }
        candidates.sort((left, right) =>
          left.cursor.localeCompare(right.cursor),
        );
        const events = candidates.slice(0, limit);
        return {
          ok: true,
          value: {
            events,
            nextCursor: events.at(-1)?.cursor ?? cursor,
            hasMore: candidates.length > events.length,
          },
        };
      },
    },
    worker: {
      async run({ signal }) {
        try {
          const recovered = await ports.runner.recover();
          if (!recovered.ok) return recovered;
          while (!signal.aborted) {
            const result = await ports.runner.runOnce();
            if (!result.ok) return result;
            if (result.value === null) {
              await new Promise<void>((resolve) => {
                const timeout = setTimeout(done, 500);
                function done() {
                  signal.removeEventListener("abort", abort);
                  resolve();
                }
                function abort() {
                  clearTimeout(timeout);
                  done();
                }
                signal.addEventListener("abort", abort, { once: true });
              });
            }
          }
          return { ok: true, value: undefined };
        } finally {
          await ports.runner.shutdown();
        }
      },
    },
  };
}

/** Creates the single process factory that binds peer ports to one personal root. */
export function createGithubServicesFactory(
  createRuntime: GithubRuntimeFactory,
): GithubServicesFactory {
  return async ({ personalRoot, now }) => {
    const { ports, bindings } = await createRuntime({ personalRoot, now });
    return composeGithubServices({ ports, bindings, personalRoot, now });
  };
}

function unavailableServices(): GithubServerServices {
  const ports = createUnavailableGithubPorts();
  return composeGithubServices({
    ports,
    personalRoot: getPersonalDataRoot(),
    bindings: {
      async createContext() {
        return unavailableResult();
      },
    },
  });
}

let configuredFactory: GithubServicesFactory | undefined;
let servicesPromise: Promise<GithubServerServices> | undefined;

/** Process startup installs the Task 02–19 factory bindings once, for Next and the worker. */
export function configureGithubServices(factory: GithubServicesFactory): void {
  if (configuredFactory && configuredFactory !== factory) {
    throw new Error("GitHub services have already been configured.");
  }
  if (configuredFactory === factory) return;
  configuredFactory = factory;
  servicesPromise = undefined;
}

export function getGithubServices(): Promise<GithubServerServices> {
  if (!configuredFactory) {
    if (!servicesPromise)
      servicesPromise = Promise.resolve(unavailableServices());
    return servicesPromise;
  }
  if (!servicesPromise) {
    const personalRoot = getPersonalDataRoot();
    servicesPromise = Promise.resolve(
      configuredFactory({ personalRoot, now: () => new Date() }),
    ).catch(() => unavailableServices());
  }
  return servicesPromise;
}

/** Test hook; production code configures the process once and never resets it. */
export function resetGithubServicesForTests(): void {
  configuredFactory = undefined;
  servicesPromise = undefined;
}

export function newGithubRequestContext(input: {
  personalRoot: string;
  sessionId: string;
  authorizationNamespace: string;
  grantedRepositoryIds: string[];
  accountId?: string | null;
  signal: AbortSignal;
  budget: ExecutionContext["budget"];
  now?: () => Date;
}): ExecutionContext {
  const now = input.now ?? (() => new Date());
  const current = now();
  return {
    personalRoot: input.personalRoot,
    access: {
      sessionId: input.sessionId,
      authorizationNamespace: input.authorizationNamespace,
      accountId: input.accountId ?? null,
      grantedRepositoryIds: [...new Set(input.grantedRepositoryIds)],
    },
    signal: input.signal,
    now,
    runId: randomUUID(),
    deadline: new Date(current.getTime() + 30_000).toISOString(),
    budget: input.budget,
  };
}
