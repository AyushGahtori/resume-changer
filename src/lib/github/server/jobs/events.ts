import { createHash } from "node:crypto";
import { z } from "zod";

const SafeIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const IsoDateSchema = z.string().datetime({ offset: false });

export const JobOutboxEventTypeSchema = z.enum([
  "ready-to-review",
  "needs-input",
  "failed",
]);
export const JobFailureCodeSchema = z.enum([
  "analysis-failed",
  "deadline-exceeded",
  "invalid-evidence",
  "needs-context",
  "provider-outcome-unknown",
  "upstream-unavailable",
]);

export const JobOutboxEventSchema = z
  .object({
    id: SafeIdSchema,
    type: JobOutboxEventTypeSchema,
    jobId: SafeIdSchema,
    runId: SafeIdSchema,
    importId: SafeIdSchema,
    projectId: SafeIdSchema,
    createdAt: IsoDateSchema,
    resultRef: SafeIdSchema.nullable(),
    resultExpiresAt: IsoDateSchema.nullable(),
    failureCode: JobFailureCodeSchema.nullable(),
    readAt: IsoDateSchema.nullable(),
    dismissedAt: IsoDateSchema.nullable(),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.type === "ready-to-review" && !event.resultRef) {
      context.addIssue({
        code: "custom",
        path: ["resultRef"],
        message: "A ready-to-review event needs a result reference.",
      });
    }
    if (event.type === "failed" && !event.failureCode) {
      context.addIssue({
        code: "custom",
        path: ["failureCode"],
        message: "A failed event needs a safe failure code.",
      });
    }
  });

export type JobOutboxEventType = z.infer<typeof JobOutboxEventTypeSchema>;
export type JobOutboxEvent = z.infer<typeof JobOutboxEventSchema>;

export const JobNotificationSchema = z
  .object({
    id: SafeIdSchema,
    type: z.enum(["ready-to-review", "needs-input", "failed", "expired"]),
    jobId: SafeIdSchema,
    runId: SafeIdSchema,
    importId: SafeIdSchema,
    projectId: SafeIdSchema,
    createdAt: IsoDateSchema,
    destination: z.string().max(256).nullable(),
    failureCode: JobFailureCodeSchema.nullable(),
    readAt: IsoDateSchema.nullable(),
    dismissedAt: IsoDateSchema.nullable(),
  })
  .strict();

export type JobNotification = z.infer<typeof JobNotificationSchema>;

export type DomainErrorCode =
  | "invalid-input"
  | "unavailable"
  | "not-found"
  | "version-conflict"
  | "limit-exceeded"
  | "needs-context"
  | "invalid-evidence"
  | "io-error"
  | "cancelled"
  | "interrupted"
  | "upstream-error";

export type DomainError = {
  code: DomainErrorCode;
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  fieldErrors?: Record<string, string[]>;
};

export type Result<T> =
  { ok: true; value: T } | { ok: false; error: DomainError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function notificationIdFor(runId: string, type: JobOutboxEventType) {
  const hash = createHash("sha256")
    .update(`${runId}\u0000${type}`)
    .digest("hex")
    .slice(0, 32);
  return `github-event-${hash}`;
}

export function createJobOutboxEvent(
  input: Omit<JobOutboxEvent, "id" | "readAt" | "dismissedAt">,
): JobOutboxEvent {
  return JobOutboxEventSchema.parse({
    ...input,
    id: notificationIdFor(input.runId, input.type),
    readAt: null,
    dismissedAt: null,
  });
}

type NotificationSource = {
  outboxEvents: JobOutboxEvent[];
};

/** Project durable outbox entries into an inbox view without performing work. */
export function projectJobNotifications(
  sources: readonly NotificationSource[],
  now: Date,
): JobNotification[] {
  const byId = new Map<string, JobOutboxEvent>();
  for (const source of sources) {
    for (const rawEvent of source.outboxEvents) {
      const event = JobOutboxEventSchema.parse(rawEvent);
      const prior = byId.get(event.id);
      if (!prior) {
        byId.set(event.id, event);
        continue;
      }
      // Duplicate projections retain the user's read/dismiss state.
      byId.set(event.id, {
        ...prior,
        readAt: prior.readAt ?? event.readAt,
        dismissedAt: prior.dismissedAt ?? event.dismissedAt,
      });
    }
  }

  return [...byId.values()]
    .map((event) => {
      const expired =
        event.resultExpiresAt !== null &&
        Date.parse(event.resultExpiresAt) <= now.getTime();
      const type = expired ? "expired" : event.type;
      const destination = expired
        ? null
        : `/library/github/${encodeURIComponent(event.importId)}`;
      return JobNotificationSchema.parse({
        id: event.id,
        type,
        jobId: event.jobId,
        runId: event.runId,
        importId: event.importId,
        projectId: event.projectId,
        createdAt: event.createdAt,
        destination,
        failureCode: event.failureCode,
        readAt: event.readAt,
        dismissedAt: event.dismissedAt,
      });
    })
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}
