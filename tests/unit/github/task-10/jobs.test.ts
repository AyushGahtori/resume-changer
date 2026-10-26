import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createJobStore,
  type JobRecord,
  type JobStoreDependencies,
} from "../../../../src/lib/github/server/jobs/store";
import type { Result } from "../../../../src/lib/github/server/jobs/events";

const roots: string[] = [];
const BASE_TIME = Date.parse("2026-10-26T10:00:00.000Z");
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const ALLOWANCE = {
  providerRequests: 2,
  inputTokens: 500,
  outputTokens: 200,
};

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

function expectError<T>(result: Result<T>, code: string) {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
}

async function makeRuntime(
  options: {
    maxQueuedJobs?: number;
    leaseDurationMs?: number;
    renameFile?: JobStoreDependencies["renameFile"];
  } = {},
) {
  const rootDir = await mkdtemp(join(tmpdir(), "github-job-store-"));
  roots.push(rootDir);
  let currentTime = BASE_TIME;
  let id = 0;
  const dependencies: JobStoreDependencies = {
    rootDir,
    clock: { now: () => new Date(currentTime) },
    createId: () => `generated-${++id}`,
    maxQueuedJobs: options.maxQueuedJobs ?? 10,
    leaseDurationMs: options.leaseDurationMs ?? 1_000,
    lockWaitMs: 5_000,
    ...(options.renameFile ? { renameFile: options.renameFile } : {}),
  };
  return {
    rootDir,
    dependencies,
    store: createJobStore(dependencies),
    now: () => new Date(currentTime),
    advance: (milliseconds: number) => {
      currentTime += milliseconds;
    },
  };
}

function enqueueInput(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: "request-1",
    importId: "import-1",
    projectId: "project-1",
    importVersion: 2,
    selectionVersion: 3,
    selectionHash: HASH_A,
    inputHash: HASH_B,
    consentHash: HASH_C,
    kind: "analyze",
    initialAllowance: ALLOWANCE,
    deadlineAt: new Date(BASE_TIME + 60 * 60_000).toISOString(),
    ...overrides,
  };
}

async function enqueue(
  store: ReturnType<typeof createJobStore>,
  overrides = {},
) {
  return unwrap(await store.enqueue(enqueueInput(overrides)));
}

async function claim(
  store: ReturnType<typeof createJobStore>,
  workerId = "worker-1",
): Promise<JobRecord> {
  const claimed = unwrap(await store.claim({ workerId }));
  if (!claimed) throw new Error("Expected a queued job to be claimed.");
  return claimed;
}

async function completeCheckpoint(
  store: ReturnType<typeof createJobStore>,
  job: JobRecord,
) {
  const inFlight = unwrap(
    await store.checkpoint({
      jobId: job.id,
      workerId: job.lease!.ownerId,
      fence: job.executionFence,
      expectedCheckpointVersion: job.checkpoint.version,
      checkpoint: {
        stage: "provider-request",
        providerState: "in-flight",
      },
      usage: {
        reserved: {
          providerRequests: 1,
          inputTokens: 50,
          outputTokens: 20,
        },
      },
    }),
  );
  return unwrap(
    await store.checkpoint({
      jobId: inFlight.id,
      workerId: inFlight.lease!.ownerId,
      fence: inFlight.executionFence,
      expectedCheckpointVersion: inFlight.checkpoint.version,
      checkpoint: {
        stage: "provider-complete",
        providerState: "completed",
        providerResultRef: "provider-result-1",
      },
      usage: {
        reported: {
          providerRequests: 1,
          inputTokens: 50,
          outputTokens: 20,
        },
        reserved: {
          providerRequests: 0,
          inputTokens: 0,
          outputTokens: 0,
        },
      },
    }),
  );
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
  vi.restoreAllMocks();
});

describe("GitHub durable job store", () => {
  it("deduplicates identical enqueue requests and rejects key reuse with changed inputs", async () => {
    const { store } = await makeRuntime();
    const first = await enqueue(store);
    const repeated = await enqueue(store);

    expect(repeated.id).toBe(first.id);
    expect(repeated.runId).toBe(first.runId);

    const conflict = await store.enqueue(
      enqueueInput({ selectionHash: "d".repeat(64) }),
    );
    expectError(conflict, "version-conflict");
  });

  it("bounds queued work before accepting another unique job", async () => {
    const { store } = await makeRuntime({ maxQueuedJobs: 1 });
    await enqueue(store);

    const overflow = await store.enqueue(
      enqueueInput({ idempotencyKey: "request-2" }),
    );
    expectError(overflow, "limit-exceeded");
  });

  it("requires an injected absolute personal-data root", async () => {
    expect(() => createJobStore({ rootDir: "relative-data-root" })).toThrow(
      "absolute resolved personal data root",
    );
  });

  it("allows only one worker to claim a queued job", async () => {
    const { store } = await makeRuntime();
    const queued = await enqueue(store);

    const results = await Promise.all([
      store.claim({ workerId: "worker-a" }),
      store.claim({ workerId: "worker-b" }),
    ]);
    const claims = results.map(unwrap).filter(Boolean);

    expect(claims).toHaveLength(1);
    expect(claims[0]?.id).toBe(queued.id);
    expect(claims[0]?.state).toBe("running");
    expect(claims[0]?.executionFence).toBe(1);
  });

  it("renews the active lease without changing its fence", async () => {
    const { store, advance } = await makeRuntime();
    await enqueue(store);
    const running = await claim(store, "worker-a");
    advance(900);

    const renewed = unwrap(
      await store.renew({
        jobId: running.id,
        workerId: "worker-a",
        fence: running.executionFence,
      }),
    );
    expect(renewed.executionFence).toBe(running.executionFence);
    expect(renewed.lease?.expiresAt).toBe(
      new Date(BASE_TIME + 1_900).toISOString(),
    );

    advance(200);
    expect(unwrap(await store.recoverExpiredLease())).toEqual([]);
    expect(unwrap(await store.claim({ workerId: "worker-b" }))).toBeNull();
  });

  it("fences stale workers and versions checkpoints independently", async () => {
    const { store } = await makeRuntime();
    await enqueue(store);
    const running = await claim(store, "worker-a");
    const checkpointed = unwrap(
      await store.checkpoint({
        jobId: running.id,
        workerId: "worker-a",
        fence: running.executionFence,
        expectedCheckpointVersion: 0,
        checkpoint: { stage: "fetching-source", providerState: "not-started" },
      }),
    );

    expect(checkpointed.checkpoint.version).toBe(1);
    expectError(
      await store.checkpoint({
        jobId: running.id,
        workerId: "worker-a",
        fence: running.executionFence,
        expectedCheckpointVersion: 0,
        checkpoint: { stage: "old-checkpoint", providerState: "not-started" },
      }),
      "version-conflict",
    );
    expectError(
      await store.renew({
        jobId: running.id,
        workerId: "worker-b",
        fence: running.executionFence,
      }),
      "version-conflict",
    );
  });

  it("recovers safe checkpoints with a new fence so the old worker cannot finish", async () => {
    const { store, advance } = await makeRuntime();
    const prepared = await enqueue(store, {
      idempotencyKey: "prepare-1",
      kind: "prepare",
      consentHash: undefined,
    });
    const running = await claim(store);
    expect(running.id).toBe(prepared.id);
    advance(1_001);

    const recovered = unwrap(await store.recoverExpiredLease());
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.state).toBe("queued");
    expect(recovered[0]?.executionFence).toBe(2);

    const reclaimed = await claim(store, "worker-2");
    expect(reclaimed.executionFence).toBe(3);
    expectError(
      await store.checkpoint({
        jobId: running.id,
        workerId: "worker-1",
        fence: running.executionFence,
        expectedCheckpointVersion: 0,
        checkpoint: { stage: "late-write", providerState: "not-started" },
      }),
      "version-conflict",
    );
  });

  it("does not exceed the queue bound when recovering an expired lease", async () => {
    const { store, advance } = await makeRuntime({ maxQueuedJobs: 1 });
    const expiredJob = await enqueue(store, {
      idempotencyKey: "prepare-1",
      kind: "prepare",
      consentHash: undefined,
    });
    const running = await claim(store);
    const waitingJob = await enqueue(store, {
      idempotencyKey: "prepare-2",
      kind: "prepare",
      consentHash: undefined,
    });
    advance(1_001);

    const recovered = unwrap(await store.recoverExpiredLease());
    expect(recovered[0]?.id).toBe(expiredJob.id);
    expect(recovered[0]?.state).toBe("interrupted");
    expect(recovered[0]?.retryRequired).toBe(true);
    expect(unwrap(await store.claim({ workerId: "worker-next" }))?.id).toBe(
      waitingJob.id,
    );
    expect(running.id).toBe(expiredJob.id);
  });

  it("interrupts an uncertain paid request and retains its reservation", async () => {
    const { store, advance } = await makeRuntime();
    await enqueue(store);
    const running = await claim(store);
    const inFlight = unwrap(
      await store.checkpoint({
        jobId: running.id,
        workerId: running.lease!.ownerId,
        fence: running.executionFence,
        expectedCheckpointVersion: 0,
        checkpoint: { stage: "provider-request", providerState: "in-flight" },
        usage: {
          reserved: {
            providerRequests: 1,
            inputTokens: 150,
            outputTokens: 100,
          },
        },
      }),
    );
    expectError(
      await store.checkpoint({
        jobId: running.id,
        workerId: running.lease!.ownerId,
        fence: running.executionFence,
        expectedCheckpointVersion: inFlight.checkpoint.version,
        checkpoint: {
          stage: "provider-not-started",
          providerState: "not-started",
        },
      }),
      "version-conflict",
    );
    advance(1_001);

    const recovered = unwrap(
      await store.recoverExpiredLease({ jobId: running.id }),
    );
    expect(recovered[0]?.state).toBe("interrupted");
    expect(recovered[0]?.retryRequired).toBe(true);
    expect(recovered[0]?.usageLedger.uncertain).toBe(true);
    expect(recovered[0]?.usageLedger.reserved).toEqual(
      inFlight.usageLedger.reserved,
    );
    expect(unwrap(await store.claim({ workerId: "worker-2" }))).toBeNull();
    expectError(
      await store.completeWithEvent({
        jobId: running.id,
        workerId: running.lease!.ownerId,
        fence: running.executionFence,
        resultRef: "late-result",
      }),
      "version-conflict",
    );
  });

  it("cancels durably and rejects a provider response that arrives afterward", async () => {
    const { store } = await makeRuntime();
    await enqueue(store);
    const running = await claim(store);
    const cancelled = unwrap(await store.requestCancel({ jobId: running.id }));

    expect(cancelled.state).toBe("cancelled");
    expect(cancelled.cancelRequestedAt).not.toBeNull();
    expect(cancelled.executionFence).toBe(running.executionFence + 1);
    expectError(
      await store.completeWithEvent({
        jobId: running.id,
        workerId: running.lease!.ownerId,
        fence: running.executionFence,
        resultRef: "late-result",
      }),
      "version-conflict",
    );
    expect(unwrap(await store.listNotifications())).toEqual([]);
  });

  it("commits a ready result and one unread event, then reconciles read state across store instances", async () => {
    const runtime = await makeRuntime();
    await enqueue(runtime.store);
    const running = await claim(runtime.store);
    const completed = await completeCheckpoint(runtime.store, running);
    const completeInput = {
      jobId: completed.id,
      workerId: completed.lease!.ownerId,
      fence: completed.executionFence,
      resultRef: "draft-results-1",
      resultExpiresAt: new Date(BASE_TIME + 24 * 60 * 60_000).toISOString(),
    };

    const first = unwrap(await runtime.store.completeWithEvent(completeInput));
    unwrap(await runtime.store.completeWithEvent(completeInput));
    unwrap(await runtime.store.completeWithEvent(completeInput));
    expect(first.state).toBe("completed");

    const notifications = unwrap(await runtime.store.listNotifications());
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.type).toBe("ready-to-review");
    expect(notifications[0]?.destination).toBe("/library/github/import-1");
    expect(notifications[0]?.readAt).toBeNull();

    const notificationId = notifications[0]!.id;
    unwrap(await runtime.store.markRead({ notificationId, read: true }));
    const secondTab = createJobStore(runtime.dependencies);
    expect(
      unwrap(await secondTab.listNotifications())[0]?.readAt,
    ).not.toBeNull();
    unwrap(
      await secondTab.markRead({
        notificationId,
        read: false,
        dismissed: true,
      }),
    );
    expect(unwrap(await runtime.store.listNotifications())).toEqual([]);
    const all = unwrap(
      await runtime.store.listNotifications({ includeDismissed: true }),
    );
    expect(all[0]?.readAt).toBeNull();
    expect(all[0]?.dismissedAt).not.toBeNull();

    const serialized = JSON.stringify(all);
    expect(serialized).not.toContain("draft-results-1");
    expect(serialized).not.toMatch(/token|private source|achievement text/i);
  });

  it("projects expired results as expired items without a review destination", async () => {
    const { store, now } = await makeRuntime();
    await enqueue(store);
    const running = await claim(store);
    const completed = await completeCheckpoint(store, running);
    unwrap(
      await store.completeWithEvent({
        jobId: completed.id,
        workerId: completed.lease!.ownerId,
        fence: completed.executionFence,
        resultRef: "expired-results",
        resultExpiresAt: new Date(now().getTime() - 1).toISOString(),
      }),
    );

    const [notification] = unwrap(await store.listNotifications());
    expect(notification?.type).toBe("expired");
    expect(notification?.destination).toBeNull();
  });

  it("keeps completion and outbox atomic when rename fails, then completes once after recovery", async () => {
    const runtime = await makeRuntime();
    await enqueue(runtime.store);
    const running = await claim(runtime.store);
    const completedCheckpoint = await completeCheckpoint(
      runtime.store,
      running,
    );
    const failingStore = createJobStore({
      ...runtime.dependencies,
      renameFile: async () => {
        throw new Error("simulated rename failure");
      },
    });
    const completeInput = {
      jobId: completedCheckpoint.id,
      workerId: completedCheckpoint.lease!.ownerId,
      fence: completedCheckpoint.executionFence,
      resultRef: "durable-result",
    };

    expectError(
      await failingStore.completeWithEvent(completeInput),
      "io-error",
    );
    expect(unwrap(await runtime.store.listNotifications())).toEqual([]);

    runtime.advance(1_001);
    const recovered = unwrap(await runtime.store.recoverExpiredLease());
    expect(recovered[0]?.state).toBe("queued");
    const claimedAgain = await claim(runtime.store, "worker-2");
    expect(claimedAgain.checkpoint.providerResultRef).toBe("provider-result-1");
    unwrap(
      await runtime.store.completeWithEvent({
        jobId: claimedAgain.id,
        workerId: claimedAgain.lease!.ownerId,
        fence: claimedAgain.executionFence,
        resultRef: "durable-result",
      }),
    );

    const notifications = unwrap(await runtime.store.listNotifications());
    expect(notifications).toHaveLength(1);
    const persisted = JSON.parse(
      await readFile(
        join(runtime.rootDir, "data", "github-jobs", "jobs.json"),
        "utf8",
      ),
    ) as { jobs: Array<{ state: string; outboxEvents: unknown[] }> };
    expect(persisted.jobs[0]?.state).toBe("completed");
    expect(persisted.jobs[0]?.outboxEvents).toHaveLength(1);
  });

  it("keeps notification reads separate from the approved library", async () => {
    const { rootDir, store } = await makeRuntime();
    await enqueue(store);
    const running = await claim(store);
    const checkpointed = await completeCheckpoint(store, running);
    const completed = unwrap(
      await store.completeWithEvent({
        jobId: checkpointed.id,
        workerId: checkpointed.lease!.ownerId,
        fence: checkpointed.executionFence,
        resultRef: "draft-results-2",
      }),
    );
    const [notification] = unwrap(await store.listNotifications());
    unwrap(
      await store.markRead({ notificationId: notification!.id, read: true }),
    );

    expect(completed.state).toBe("completed");
    await expect(
      readFile(join(rootDir, "data", "resume-library.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
