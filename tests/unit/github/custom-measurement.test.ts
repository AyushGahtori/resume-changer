import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ImportRecordSchema,
  ok,
  type ExecutionContext,
  type ImportRecord,
  type MeasurementAnswer,
} from "../../../src/lib/github/contracts";
import {
  createMeasurementService,
  measurementAnswerHash,
} from "../../../src/lib/github/server/measurement-service";
import { createMeasurementPort } from "../../../src/lib/github/server/measurement-port";
import type {
  DeferredMeasurementTaskStorePort,
  ImportStorePort,
} from "../../../src/lib/github/ports";

const fixedNow = new Date("2026-10-26T10:00:00.000Z");
const namespace = "session-custom-metric";
let root = "";
let record: ImportRecord;

function makeRecord(): ImportRecord {
  return ImportRecordSchema.parse({
    id: "import-custom",
    version: 1,
    source: "personal",
    destinationProjectId: "project-one",
    authorizationNamespaceHash: createHash("sha256")
      .update(namespace)
      .digest("hex"),
    scope: {
      repositoryId: "1234",
      owner: "example",
      name: "publishing-app",
      canonicalUrl: "https://github.com/example/publishing-app",
      visibility: "public",
      ref: "main",
      commitSha: "c".repeat(40),
      selectedPullRequestNumbers: [12],
      selectedPaths: ["src/publish.ts"],
      contributionStatement: "I implemented the publishing flow.",
      identitySource: "user-provided",
    },
    selectionVersion: 1,
    selectionHash: "a".repeat(64),
    lifecycle: "ready-to-review",
    activeRunId: null,
    consent: null,
    preparedSelectionRef: null,
    resultRef: "d".repeat(64),
    draftRefs: ["draft-one"],
    draftEdits: [
      {
        draftId: "draft-one",
        version: 1,
        baseResultHash: "b".repeat(64),
        text: "Implemented the publishing flow with retry handling.",
        selectedForSave: true,
        contributionConfirmed: true,
        confirmedMetricResultIds: [],
        updatedAt: fixedNow.toISOString(),
      },
    ],
    savedIds: [],
    retentionDeadline: new Date(fixedNow.getTime() + 60 * 60_000).toISOString(),
    createdAt: fixedNow.toISOString(),
    updatedAt: fixedNow.toISOString(),
  });
}

function makeContext(): ExecutionContext {
  return {
    personalRoot: root,
    access: {
      sessionId: "session-one",
      authorizationNamespace: namespace,
      accountId: "account-one",
      grantedRepositoryIds: ["1234"],
    },
    signal: new AbortController().signal,
    now: () => new Date(fixedNow),
    runId: "run-one",
    deadline: new Date(fixedNow.getTime() + 5 * 60_000).toISOString(),
    budget: {
      reserve: async () => ok({ reservationId: "reservation-one" }),
      commitUsage: async () =>
        ok({
          requests: 0,
          pullRequestRequests: 0,
          fetchedBodies: 0,
          fetchedBytes: 0,
          uniqueFiles: 0,
          uniqueLines: 0,
          transmittedLines: 0,
          inputTokens: 0,
          generationAttempts: 0,
        }),
      checkSelection: () => ok({ allowed: true, reason: null }),
      remaining: () =>
        ok({
          requests: 0,
          pullRequestRequests: 0,
          fetchedBodies: 0,
          fetchedBytes: 0,
          uniqueFiles: 0,
          uniqueLines: 0,
          transmittedLines: 0,
          inputTokens: 0,
          generationAttempts: 0,
        }),
      snapshot: () =>
        ok({
          requests: 0,
          pullRequestRequests: 0,
          fetchedBodies: 0,
          fetchedBytes: 0,
          uniqueFiles: 0,
          uniqueLines: 0,
          transmittedLines: 0,
          inputTokens: 0,
          generationAttempts: 0,
        }),
    },
  };
}

function answerFor(
  questionId: string,
  version: number,
  overrides: Partial<Omit<MeasurementAnswer, "answerHash">>,
): MeasurementAnswer {
  const payload = {
    questionId,
    version,
    mode: "result" as const,
    originalValues: [12.5],
    originalUnits: ["widgets"],
    definitionId: "custom-metric-v1",
    statistic: null,
    context: {
      customLabel: "queue depth",
      contextDescription: "Peak weekday backlog",
      sourceDescription: "Operator count from the fictional dashboard",
    },
    sourceEvidenceIds: [] as string[],
    attestation: "measured" as const,
    ...overrides,
  };
  return {
    ...payload,
    answerHash: measurementAnswerHash(payload),
  };
}

async function setup() {
  root = await mkdtemp(join(tmpdir(), "github-custom-measurement-"));
  record = makeRecord();
  const store = {
    get: async ({ id }: { id: string }) =>
      id === record.id
        ? ok(structuredClone(record))
        : {
            ok: false as const,
            error: {
              code: "not-found" as const,
              message: "Import not found.",
              retryable: false,
            },
          },
    updateExpectedVersion: async (input: {
      id: string;
      expectedVersion: number;
      patch: Partial<ImportRecord>;
    }) => {
      if (input.id !== record.id || input.expectedVersion !== record.version) {
        return {
          ok: false as const,
          error: {
            code: "version-conflict" as const,
            message: "Import changed.",
            retryable: false,
          },
        };
      }
      record = ImportRecordSchema.parse({
        ...record,
        ...input.patch,
        version: record.version + 1,
        updatedAt: fixedNow.toISOString(),
      });
      return ok(structuredClone(record));
    },
  } as unknown as ImportStorePort;
  return createMeasurementService({
    store,
    deferredTasks: {
      get: async () => ({
        ok: false as const,
        error: {
          code: "not-found" as const,
          message: "missing",
          retryable: false,
        },
      }),
    } as unknown as DeferredMeasurementTaskStorePort,
    measurements: createMeasurementPort(),
    now: () => new Date(fixedNow),
  });
}

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("custom measurement review", () => {
  it("advertises the hyphenated custom metric and stores an unconfirmed review", async () => {
    const service = await setup();
    const context = makeContext();
    const questions = await service.questions({ importId: record.id }, context);
    expect(questions.ok).toBe(true);
    if (!questions.ok) return;
    const question = questions.value[0];
    expect(question.choices).toContain(
      "metric:custom-metric-v1 — Describe a custom measurement",
    );

    const saved = await service.answer(
      {
        importId: record.id,
        questionId: question.id,
        expectedVersion: record.version,
        answer: answerFor(question.id, question.version, {}),
      },
      context,
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.result).toMatchObject({
      definitionId: "custom-metric-v1",
      originalValues: [12.5],
      originalUnits: ["widgets"],
      evidenceStatus: "measured",
      confirmed: false,
    });

    const review = await service.review({ importId: record.id }, context);
    expect(review.ok).toBe(true);
    if (!review.ok) return;
    expect(review.value.measurementResults).toEqual([
      expect.objectContaining({
        definitionId: "custom-metric-v1",
        confirmed: false,
      }),
    ]);
  });

  it("rejects an unsafe custom value before saving a review", async () => {
    const service = await setup();
    const context = makeContext();
    const questions = await service.questions({ importId: record.id }, context);
    if (!questions.ok) throw new Error(questions.error.message);
    const question = questions.value[0];
    const saved = await service.answer(
      {
        importId: record.id,
        questionId: question.id,
        expectedVersion: record.version,
        answer: answerFor(question.id, question.version, {
          originalValues: [1_000_000_000_001],
        }),
      },
      context,
    );
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.message).toContain("finite custom value");

    const review = await service.review({ importId: record.id }, context);
    expect(review.ok).toBe(true);
    if (!review.ok) return;
    expect(review.value.measurementResults).toEqual([]);
  });
});
