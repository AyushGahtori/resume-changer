"use client";

import { z } from "zod";
import { apiFetch } from "../cloud/api-fetch";
import {
  DraftSchema,
  DomainErrorSchema,
  ImportRecordSchema,
  ImportReviewStateSchema,
  JobRecordSchema,
  MeasurementAnswerSchema,
  MeasurementResultSchema,
  type Draft,
  type DomainError,
  type ImportRecord,
  type ImportReviewState,
  type JobRecord,
  type MeasurementAnswer,
  type RepositoryScope,
  type Result,
} from "./contracts";
import type { ImportClientPort } from "./ports";

const EnvelopeSchema = z
  .object({
    data: z.unknown(),
    version: z.number().int().positive().optional(),
  })
  .passthrough();

const StatusEventSchema = z
  .object({
    id: z.string().min(1).max(128),
    cursor: z.string().min(1).max(256),
    type: z.enum(["job", "notification"]),
    createdAt: z.iso.datetime(),
    job: z
      .object({
        id: z.string().min(1).max(128),
        runId: z.string().min(1).max(128),
        importId: z.string().min(1).max(128),
      })
      .passthrough()
      .optional(),
    notification: z
      .object({
        id: z.string().min(1).max(128),
        importId: z.string().min(1).max(128),
      })
      .passthrough()
      .optional(),
  })
  .strict()
  .refine(
    (event) =>
      (event.type === "job" && Boolean(event.job) && !event.notification) ||
      (event.type === "notification" &&
        Boolean(event.notification) &&
        !event.job),
  );

const StatusPageSchema = z
  .object({
    events: z.array(StatusEventSchema).max(100),
    nextCursor: z.string().max(256).nullable(),
    hasMore: z.boolean(),
  })
  .strict();

const JobStatusResponseSchema = z
  .object({
    id: z.string().min(1).max(128),
    runId: z.string().min(1).max(128),
    importId: z.string().min(1).max(128),
    state: z.enum([
      "queued",
      "running",
      "completed",
      "failed",
      "cancelled",
      "interrupted",
      "needs-input",
    ]),
    stage: z.string().min(1).max(120),
    updatedAt: z.iso.datetime(),
    resultRef: z.string().max(256).nullable(),
    expired: z.boolean(),
    safeError: DomainErrorSchema.nullable(),
  })
  .strict();

const ClientNotificationSchema = z
  .object({
    id: z.string().min(1).max(128),
    jobId: z.string().min(1).max(128),
    importId: z.string().min(1).max(128),
    projectId: z.string().min(1).max(128),
    type: z.enum(["ready", "needs-input", "failed", "expired"]),
    createdAt: z.iso.datetime(),
    readAt: z.iso.datetime().nullable(),
    dismissedAt: z.iso.datetime().nullable(),
    destination: z.string().max(512).nullable(),
  })
  .strict();

export type ClientNotification = z.infer<typeof ClientNotificationSchema>;
export type ClientNotificationPage = {
  notifications: ClientNotification[];
  nextCursor: string | null;
  hasMore: boolean;
};
export type ClientJobStatus = z.infer<typeof JobStatusResponseSchema>;

export type EventSourceMessage = MessageEvent;
export type EventSourceLike = Pick<
  EventSource,
  "onopen" | "onmessage" | "onerror" | "close"
>;

export type ImportClientTransport = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  eventSource?: (url: string) => EventSourceLike;
};

export type GithubImportClient = Omit<ImportClientPort, "subscribeStatus"> & {
  previewMeasurementDraft(input: {
    importId: string;
    draftId: string;
    measurementResultId?: string;
  }): Promise<Result<{ text: string; hash: string }>>;
  /** Local, versioned measurement answer; no model request is made. */
  answerMeasurement(input: {
    importId: string;
    questionId: string;
    expectedVersion: number;
    answer: MeasurementAnswer;
  }): Promise<
    Result<{
      version: number;
      result: z.infer<typeof MeasurementResultSchema> | null;
    }>
  >;
  read(importId: string): Promise<Result<ImportReviewState>>;
  select(
    importId: string,
    expectedVersion: number,
    scope: RepositoryScope,
    pinnedFileIds: string[],
  ): Promise<Result<ImportRecord>>;
  analyze(
    importId: string,
    expectedVersion: number,
    selectionHash: string,
    consentReference: string,
  ): Promise<Result<JobRecord>>;
  listNotifications(input?: {
    cursor?: string | null;
    limit?: number;
  }): Promise<Result<ClientNotificationPage>>;
  markNotificationRead(
    notificationId: string,
  ): Promise<Result<ClientNotification>>;
  readJob(jobId: string): Promise<Result<ClientJobStatus>>;
  subscribeStatus(
    listener: (state: ImportReviewState) => void,
    onError?: (error: DomainError) => void,
    cursor?: string | null,
  ): Result<{ close(): void; readonly cursor: string | null }>;
};

function browserTransport(): ImportClientTransport {
  return {
    fetch: (input, init) => apiFetch(input, init),
    ...(typeof window !== "undefined" && typeof EventSource !== "undefined"
      ? { eventSource: (url: string) => new EventSource(url) }
      : {}),
  };
}

function requestError(body: unknown, status: number): DomainError {
  if (body && typeof body === "object" && "error" in body) {
    const parsed = DomainErrorSchema.safeParse(body.error);
    if (parsed.success) return parsed.data;
  }
  const code: DomainError["code"] =
    status === 400
      ? "invalid-input"
      : status === 401 || status === 403
        ? "forbidden"
        : status === 404
          ? "not-found"
          : status === 409
            ? "version-conflict"
            : status === 413
              ? "limit-exceeded"
              : status === 422
                ? "invalid-evidence"
                : status === 429
                  ? "rate-limited"
                  : status >= 500
                    ? "unavailable"
                    : "upstream-error";
  return {
    code,
    message:
      status >= 500
        ? "GitHub import is temporarily unavailable."
        : "The GitHub import request could not be completed.",
    retryable: status === 429 || status >= 500,
  };
}

function idSegment(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value))
    throw new TypeError("The GitHub import ID is invalid.");
  return encodeURIComponent(value);
}

function validateVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new TypeError("The expected import version is invalid.");
}

const ImportCreateResponseSchema = ImportRecordSchema;
const JobResponseSchema = JobRecordSchema;
const ReviewResponseSchema = ImportReviewStateSchema;
const DraftResponseSchema = DraftSchema;
const SavedIdsSchema = z
  .object({ savedIds: z.array(z.string()).max(100) })
  .strip();
const DiscardedSchema = z.object({ discarded: z.literal(true) }).strict();
const AnswerResultSchema = z
  .object({
    version: z.number().int().positive(),
    result: MeasurementResultSchema.nullable(),
  })
  .strict();
const NotificationPageSchema = z
  .object({
    notifications: z.array(ClientNotificationSchema).max(100),
    nextCursor: z.string().max(256).nullable(),
    hasMore: z.boolean(),
  })
  .strict();

export function createImportClient(
  transport: ImportClientTransport = browserTransport(),
): GithubImportClient {
  let activeSubscription: {
    close(): void;
    readonly cursor: string | null;
  } | null = null;

  async function request<T>(
    path: string,
    init: RequestInit,
    schema: z.ZodType<T>,
  ): Promise<Result<T>> {
    let response: Response;
    try {
      response = await transport.fetch(path, {
        credentials: "same-origin",
        cache: "no-store",
        ...init,
        headers: {
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      });
    } catch {
      return {
        ok: false,
        error: {
          code: "unavailable",
          message: "GitHub import could not reach the local service.",
          retryable: true,
        },
      };
    }

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok)
      return { ok: false, error: requestError(body, response.status) };
    const envelope = EnvelopeSchema.safeParse(body);
    if (!envelope.success) {
      return {
        ok: false,
        error: {
          code: "upstream-error",
          message: "The GitHub import service returned an invalid response.",
          retryable: false,
        },
      };
    }
    const value = schema.safeParse(envelope.data.data);
    if (!value.success) {
      return {
        ok: false,
        error: {
          code: "upstream-error",
          message: "The GitHub import service returned an invalid response.",
          retryable: false,
        },
      };
    }
    return { ok: true, value: value.data };
  }

  const postJson = <T>(path: string, body: unknown, schema: z.ZodType<T>) =>
    request(path, { method: "POST", body: JSON.stringify(body) }, schema);
  const putJson = <T>(path: string, body: unknown, schema: z.ZodType<T>) =>
    request(path, { method: "PUT", body: JSON.stringify(body) }, schema);

  async function get(importId: string): Promise<Result<ImportReviewState>> {
    return request(
      `/api/github/imports/${idSegment(importId)}`,
      { method: "GET" },
      ReviewResponseSchema,
    );
  }

  function subscribeStatus(
    listener: (state: ImportReviewState) => void,
    onError: (error: DomainError) => void = () => undefined,
    initialCursor: string | null = null,
  ): Result<{ close(): void; readonly cursor: string | null }> {
    if (activeSubscription) return { ok: true, value: activeSubscription };

    let closed = false;
    let cursor = initialCursor;
    let eventSource: EventSourceLike | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let pollAbort: AbortController | undefined;
    let polling = false;
    let failures = 0;
    let probes = 0;
    let backoff = 500;
    const seen = new Set<string>();
    const inFlight = new Set<string>();
    const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const retryCounts = new Map<string, number>();

    const handle = {
      close() {
        if (closed) return;
        closed = true;
        eventSource?.close();
        pollAbort?.abort();
        if (retryTimer) clearTimeout(retryTimer);
        if (pollTimer) clearTimeout(pollTimer);
        for (const timer of retryTimers.values()) clearTimeout(timer);
        retryTimers.clear();
        if (activeSubscription === handle) activeSubscription = null;
      },
      get cursor() {
        return cursor;
      },
    };
    activeSubscription = handle;

    function retryDelivery(event: z.infer<typeof StatusEventSchema>): void {
      if (closed || retryTimers.has(event.id)) return;
      const attempts = (retryCounts.get(event.id) ?? 0) + 1;
      retryCounts.set(event.id, attempts);
      const delay = Math.min(500 * 2 ** Math.min(attempts - 1, 5), 15_000);
      retryTimers.set(
        event.id,
        setTimeout(() => {
          retryTimers.delete(event.id);
          void deliver(event);
        }, delay),
      );
    }

    async function deliver(raw: unknown): Promise<boolean> {
      const parsed = StatusEventSchema.safeParse(raw);
      if (!parsed.success) {
        onError({
          code: "upstream-error",
          message: "The status stream returned an invalid event.",
          retryable: false,
        });
        return false;
      }
      const event = parsed.data;
      if (seen.has(event.id) || event.cursor === cursor) return true;
      if (inFlight.has(event.id) || retryTimers.has(event.id)) return false;
      const importId = event.job?.importId ?? event.notification?.importId;
      if (!importId) return false;
      inFlight.add(event.id);
      try {
        const state = await get(importId);
        if (!state.ok) {
          onError(state.error);
          retryDelivery(event);
          return false;
        }
        seen.add(event.id);
        if (seen.size > 1024) seen.delete(seen.values().next().value as string);
        if (!cursor || event.cursor > cursor) cursor = event.cursor;
        retryCounts.delete(event.id);
        listener(state.value);
        return true;
      } finally {
        inFlight.delete(event.id);
      }
    }

    async function pollOnce(): Promise<boolean> {
      const controller = new AbortController();
      pollAbort = controller;
      const query = new URLSearchParams({ mode: "poll", limit: "100" });
      if (cursor) query.set("cursor", cursor);
      try {
        const response = await transport.fetch(
          `/api/github/jobs/events?${query.toString()}`,
          {
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          onError(requestError(body, response.status));
          return false;
        }
        const envelope = EnvelopeSchema.safeParse(body);
        const page = envelope.success
          ? StatusPageSchema.safeParse(envelope.data.data)
          : null;
        if (!page?.success) {
          onError({
            code: "upstream-error",
            message: "The status endpoint returned an invalid response.",
            retryable: false,
          });
          return false;
        }
        for (const event of page.data.events) await deliver(event);
        return true;
      } catch {
        if (!controller.signal.aborted)
          onError({
            code: "unavailable",
            message: "The local status endpoint could not be reached.",
            retryable: true,
          });
        return false;
      } finally {
        if (pollAbort === controller) pollAbort = undefined;
      }
    }

    function startPolling(): void {
      if (closed || polling) return;
      polling = true;
      backoff = 500;
      void pollLoop();
    }

    async function pollLoop(): Promise<void> {
      while (!closed && polling) {
        const okay = await pollOnce();
        if (closed || !polling) return;
        probes += 1;
        if (probes >= 5 && transport.eventSource) {
          probes = 0;
          openStream();
        }
        const delay = okay ? 1_000 : backoff;
        backoff = Math.min(backoff * 2, 15_000);
        await new Promise<void>((resolve) => {
          pollTimer = setTimeout(() => {
            pollTimer = undefined;
            resolve();
          }, delay);
        });
      }
    }

    function reconnect(): void {
      if (closed || polling || retryTimer) return;
      const delay = Math.min(500 * 2 ** Math.min(failures - 1, 5), 15_000);
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        openStream();
      }, delay);
    }

    function openStream(): void {
      if (closed || !transport.eventSource) {
        if (!closed) startPolling();
        return;
      }
      eventSource?.close();
      const query = new URLSearchParams();
      if (cursor) query.set("cursor", cursor);
      try {
        eventSource = transport.eventSource(
          `/api/github/jobs/events${query.size ? `?${query}` : ""}`,
        );
      } catch {
        startPolling();
        return;
      }
      const current = eventSource;
      current.onopen = () => {
        failures = 0;
        backoff = 500;
        polling = false;
        pollAbort?.abort();
        if (pollTimer) {
          clearTimeout(pollTimer);
          pollTimer = undefined;
        }
      };
      current.onmessage = (message) => {
        try {
          const body: unknown = JSON.parse(message.data);
          const payload =
            body && typeof body === "object" && "data" in body
              ? body.data
              : body;
          void deliver(payload);
        } catch {
          onError({
            code: "upstream-error",
            message: "The status stream returned invalid data.",
            retryable: false,
          });
        }
      };
      current.onerror = () => {
        current.close();
        if (eventSource === current) eventSource = undefined;
        failures += 1;
        if (failures >= 3) startPolling();
        else reconnect();
      };
    }

    openStream();
    return { ok: true, value: handle };
  }

  const client: GithubImportClient = {
    create(input) {
      return postJson("/api/github/imports", input, ImportCreateResponseSchema);
    },
    async get(importId) {
      return get(importId);
    },
    read(importId) {
      return get(importId);
    },
    prepare(importId, expectedVersion) {
      validateVersion(expectedVersion);
      return postJson(
        `/api/github/imports/${idSegment(importId)}/inspect`,
        { expectedVersion },
        JobResponseSchema,
      );
    },
    changeSelection(importId, expectedVersion, scope, pinnedFileIds) {
      validateVersion(expectedVersion);
      return putJson(
        `/api/github/imports/${idSegment(importId)}/selection`,
        { expectedVersion, scope, pinnedFileIds },
        ImportRecordSchema,
      );
    },
    select(importId, expectedVersion, scope, pinnedFileIds) {
      return client.changeSelection(
        importId,
        expectedVersion,
        scope,
        pinnedFileIds,
      );
    },
    enqueueAnalysis(
      importId,
      expectedVersion,
      selectionHash,
      consentReference,
    ) {
      validateVersion(expectedVersion);
      return postJson(
        `/api/github/imports/${idSegment(importId)}/extract`,
        {
          expectedVersion,
          selectionHash,
          consentReference,
          providerConsent: true,
          idempotencyKey: consentReference,
        },
        JobResponseSchema,
      );
    },
    analyze(importId, expectedVersion, selectionHash, consentReference) {
      return client.enqueueAnalysis(
        importId,
        expectedVersion,
        selectionHash,
        consentReference,
      );
    },
    updateDraft(importId, draftId, expectedVersion, text, review) {
      validateVersion(expectedVersion);
      return putJson(
        `/api/github/imports/${idSegment(importId)}/drafts/${idSegment(draftId)}`,
        { expectedVersion, text, ...review },
        DraftResponseSchema,
      );
    },
    previewMeasurementDraft({ importId, draftId, measurementResultId }) {
      return request(
        `/api/github/imports/${idSegment(importId)}/drafts/${idSegment(draftId)}/preview${measurementResultId ? `?measurementResultId=${encodeURIComponent(measurementResultId)}` : ""}`,
        { method: "GET" },
        z
          .object({
            text: z.string().max(4000),
            hash: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      );
    },
    answerMeasurement({ importId, questionId, expectedVersion, answer }) {
      validateVersion(expectedVersion);
      const parsedAnswer = MeasurementAnswerSchema.safeParse(answer);
      if (!parsedAnswer.success)
        return Promise.resolve({
          ok: false,
          error: {
            code: "invalid-input",
            message: "The measurement answer is invalid.",
            retryable: false,
          },
        });
      return putJson(
        `/api/github/imports/${idSegment(importId)}/measurement-answers/${idSegment(questionId)}`,
        { expectedVersion, answer: parsedAnswer.data },
        AnswerResultSchema,
      );
    },
    approve(importId, expectedVersion, selectedDraftIds, idempotencyKey) {
      validateVersion(expectedVersion);
      return postJson(
        `/api/github/imports/${idSegment(importId)}/approve`,
        { expectedVersion, selectedDraftIds, idempotencyKey },
        SavedIdsSchema,
      );
    },
    cancel(importId, runId) {
      return postJson(
        `/api/github/imports/${idSegment(importId)}/cancel`,
        { runId },
        ImportRecordSchema,
      );
    },
    discard(importId, expectedVersion) {
      validateVersion(expectedVersion);
      return request(
        `/api/github/imports/${idSegment(importId)}`,
        {
          method: "DELETE",
          body: JSON.stringify({ expectedVersion, confirmDiscard: true }),
        },
        DiscardedSchema,
      );
    },
    listNotifications({ cursor = null, limit = 50 } = {}) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw new TypeError("The notification page size is invalid.");
      const query = new URLSearchParams({ limit: String(limit) });
      if (cursor) query.set("cursor", cursor);
      return request(
        `/api/library/notifications?${query}`,
        { method: "GET" },
        NotificationPageSchema,
      );
    },
    markNotificationRead(notificationId) {
      return postJson(
        `/api/library/notifications/${idSegment(notificationId)}/read`,
        {},
        ClientNotificationSchema,
      );
    },
    readJob(jobId) {
      return request(
        `/api/github/jobs/${idSegment(jobId)}`,
        { method: "GET" },
        JobStatusResponseSchema,
      );
    },
    subscribeStatus,
  };
  return client;
}

/** One shared client instance is intended to be mounted by the app shell. */
export const githubImportClient = createImportClient();
