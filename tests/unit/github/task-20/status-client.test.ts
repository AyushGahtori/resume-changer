import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ImportRecordSchema,
  ImportReviewStateSchema,
  type RepositoryScope,
} from "../../../../src/lib/github/contracts";
import {
  createImportClient,
  type EventSourceLike,
  type ImportClientTransport,
} from "../../../../src/lib/github/client";

const timestamp = "2026-10-26T00:00:00.000Z";
const scope: RepositoryScope = {
  repositoryId: "123",
  owner: "example",
  name: "repo",
  canonicalUrl: "https://github.com/example/repo",
  visibility: "public",
  ref: "main",
  commitSha: "a".repeat(40),
  selectedPullRequestNumbers: [],
  selectedPaths: [],
  contributionStatement: "Contributed to the project.",
  identitySource: "unknown",
};
const reviewState = ImportReviewStateSchema.parse({
  import: ImportRecordSchema.parse({
    id: "import-1",
    version: 1,
    source: "personal",
    destinationProjectId: "project-1",
    authorizationNamespaceHash: "b".repeat(64),
    scope,
    selectionVersion: 1,
    selectionHash: null,
    lifecycle: "ready-to-review",
    activeRunId: null,
    consent: null,
    preparedSelectionRef: null,
    resultRef: null,
    draftRefs: [],
    draftEdits: [],
    savedIds: [],
    retentionDeadline: "2026-10-27T00:00:00.000Z",
    createdAt: timestamp,
    updatedAt: timestamp,
  }),
  prepared: null,
  result: null,
  questions: [],
  measurementResults: [],
  canSaveDraftIds: [],
  expired: false,
});
const job = {
  id: "job-1",
  runId: "run-1",
  importId: "import-1",
  state: "completed",
  stage: "ready-to-review",
  updatedAt: timestamp,
  resultRef: "result-1",
  expired: false,
  safeError: null,
};
const notification = {
  id: "notification-1",
  jobId: "job-1",
  importId: "import-1",
  projectId: "project-1",
  type: "ready",
  createdAt: timestamp,
  readAt: "2026-10-26T00:01:00.000Z",
  dismissedAt: null,
  destination: "/library/github/import-1",
};
const event = {
  id: "event-1",
  cursor: "2026-10-26T00:00:00.000Z:job-1:000000000002:job",
  type: "job",
  createdAt: timestamp,
  job,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

class FakeEventSource implements EventSourceLike {
  onopen: EventSourceLike["onopen"] = null;
  onmessage: EventSourceLike["onmessage"] = null;
  onerror: EventSourceLike["onerror"] = null;
  closed = false;

  close() {
    this.closed = true;
  }

  open() {
    this.onopen?.call(this as unknown as EventSource, new Event("open"));
  }

  send(payload: unknown, lastEventId = "") {
    this.onmessage?.call(
      this as unknown as EventSource,
      new MessageEvent("message", {
        data: JSON.stringify({ data: payload }),
        lastEventId,
      }),
    );
  }

  fail() {
    this.onerror?.call(this as unknown as EventSource, new Event("error"));
  }
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

afterEach(() => vi.useRealTimers());

describe("GitHub import browser client", () => {
  it("validates DTOs and parses safe domain errors", async () => {
    const transport: ImportClientTransport = {
      async fetch(path) {
        if (String(path).includes("job-1"))
          return jsonResponse({ data: { ...job, state: "secret-success" } });
        return jsonResponse(
          {
            error: {
              code: "version-conflict",
              message: "Review this import again.",
              retryable: false,
            },
          },
          409,
        );
      },
    };
    const client = createImportClient(transport);

    const invalidJob = await client.readJob("job-1");
    const conflict = await client.changeSelection("import-1", 2, scope, []);

    expect(invalidJob).toMatchObject({
      ok: false,
      error: { code: "upstream-error", retryable: false },
    });
    expect(conflict).toEqual({
      ok: false,
      error: {
        code: "version-conflict",
        message: "Review this import again.",
        retryable: false,
      },
    });
  });

  it("marks an inbox item read without analyzing or approving anything", async () => {
    const calls: Array<{ path: string; method: string }> = [];
    const transport: ImportClientTransport = {
      async fetch(path, init) {
        calls.push({ path: String(path), method: init?.method ?? "GET" });
        if ((init?.method ?? "GET") === "GET")
          return jsonResponse({
            data: {
              notifications: [notification],
              nextCursor: "next-cursor",
              hasMore: false,
            },
          });
        return jsonResponse({ data: notification });
      },
    };
    const client = createImportClient(transport);

    const page = await client.listNotifications({ limit: 25 });
    const result = await client.markNotificationRead("notification-1");

    expect(page).toMatchObject({
      ok: true,
      value: {
        notifications: [{ id: "notification-1" }],
        nextCursor: "next-cursor",
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: { readAt: notification.readAt },
    });
    expect(calls).toEqual([
      {
        path: "/api/library/notifications?limit=25",
        method: "GET",
      },
      {
        path: "/api/library/notifications/notification-1/read",
        method: "POST",
      },
    ]);
  });

  it("deduplicates repeated events and reconnects from the last stable cursor", async () => {
    vi.useFakeTimers();
    const sources: Array<{ url: string; source: FakeEventSource }> = [];
    const transport: ImportClientTransport = {
      async fetch(path) {
        if (String(path).includes("/api/github/imports/"))
          return jsonResponse({ data: reviewState });
        return jsonResponse({
          data: { events: [], nextCursor: null, hasMore: false },
        });
      },
      eventSource(url) {
        const source = new FakeEventSource();
        sources.push({ url, source });
        return source;
      },
    };
    const client = createImportClient(transport);
    const received: string[] = [];
    const first = client.subscribeStatus((value) =>
      received.push(value.import.id),
    );
    const second = client.subscribeStatus((value) =>
      received.push(value.import.id),
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    sources[0]!.source.open();
    sources[0]!.source.send(event, event.cursor);
    sources[0]!.source.send(event, event.cursor);
    await flushPromises();

    expect(second.value).toBe(first.value);
    expect(received).toEqual(["import-1"]);
    expect(first.value.cursor).toBe(event.cursor);

    sources[0]!.source.fail();
    await vi.advanceTimersByTimeAsync(500);

    expect(sources).toHaveLength(2);
    expect(sources[1]!.url).toContain("cursor=");
    expect(sources[1]!.url).toContain(encodeURIComponent(event.cursor));
    sources[1]!.source.send(event, event.cursor);
    await flushPromises();
    expect(received).toEqual(["import-1"]);
    first.value.close();
  });

  it("retries local reconciliation before advancing the event cursor", async () => {
    vi.useFakeTimers();
    const source = new FakeEventSource();
    let statusReads = 0;
    const transport: ImportClientTransport = {
      async fetch(path) {
        if (String(path).includes("/api/github/imports/")) {
          statusReads += 1;
          if (statusReads === 1)
            return jsonResponse(
              {
                error: {
                  code: "unavailable",
                  message: "Retry the local status read.",
                  retryable: true,
                },
              },
              503,
            );
          return jsonResponse({ data: reviewState });
        }
        return jsonResponse({
          data: { events: [], nextCursor: null, hasMore: false },
        });
      },
      eventSource: () => source,
    };
    const client = createImportClient(transport);
    const received: string[] = [];
    const subscription = client.subscribeStatus((value) => {
      received.push(value.import.id);
    });
    expect(subscription.ok).toBe(true);
    if (!subscription.ok) return;

    source.open();
    source.send(event, event.cursor);
    await flushPromises();
    expect(received).toEqual([]);
    expect(subscription.value.cursor).toBeNull();

    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    expect(received).toEqual(["import-1"]);
    expect(subscription.value.cursor).toBe(event.cursor);
    subscription.value.close();
  });

  it("uses bounded local status polling when EventSource is unavailable", async () => {
    const paths: string[] = [];
    const transport: ImportClientTransport = {
      async fetch(path) {
        paths.push(String(path));
        if (String(path).includes("/api/github/imports/"))
          return jsonResponse({ data: reviewState });
        return jsonResponse({
          data: { events: [event], nextCursor: event.cursor, hasMore: false },
        });
      },
    };
    const client = createImportClient(transport);
    let subscription: ReturnType<typeof client.subscribeStatus>;
    const received = new Promise<string>((resolve) => {
      subscription = client.subscribeStatus((value) => {
        resolve(value.import.id);
        if (subscription?.ok) subscription.value.close();
      });
    });

    await expect(received).resolves.toBe("import-1");
    expect(paths).toHaveLength(2);
    expect(paths[0]).toContain("/api/github/jobs/events?mode=poll");
    expect(paths[0]).not.toContain("github.com");
    expect(paths[1]).toBe("/api/github/imports/import-1");
  });
});
