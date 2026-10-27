import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ImportRecordSchema,
  ok,
  type ExecutionContext,
  type ImportRecord,
  type MeasurementAnswer,
  type MeasurementDefinition,
} from "../../../../src/lib/github/contracts";
import { METRIC_CATALOG } from "../../../../src/lib/github/measurement-catalog";
import {
  createMeasurementService,
  measurementAnswerHash,
} from "../../../../src/lib/github/server/measurement-service";
import type {
  DeferredMeasurementTaskStorePort,
  ImportStorePort,
  MeasurementPort,
  MeasurementServiceFactory,
} from "../../../../src/lib/github/ports";

const fixedNow = new Date("2026-10-26T10:00:00.000Z");
const namespace = "session-1-private-namespace";
const selectionHash = "a".repeat(64);
const baseHash = "b".repeat(64);

let root: string;
let record: ImportRecord;
let context: ExecutionContext;
let store: ImportStorePort;
let service: ReturnType<MeasurementServiceFactory>;
let deferredCreate: ReturnType<typeof vi.fn>;
let measurementPortCalls: ReturnType<typeof vi.fn<() => void>>;
let deferredDelete: ReturnType<typeof vi.fn>;

function emptyBudget() {
  return {
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
}

function makeRecord(overrides: Partial<ImportRecord> = {}): ImportRecord {
  return ImportRecordSchema.parse({
    id: "import-one",
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
    selectionHash,
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
        baseResultHash: baseHash,
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
    ...overrides,
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
      commitUsage: async () => ok(emptyBudget()),
      checkSelection: () => ok({ allowed: true, reason: null }),
      remaining: () => ok(emptyBudget()),
      snapshot: () => ok(emptyBudget()),
    },
  };
}

function answerFor(
  questionId: string,
  version: number,
  overrides: Partial<Omit<MeasurementAnswer, "answerHash">> = {},
): MeasurementAnswer {
  const payload = {
    questionId,
    version,
    mode: "result" as const,
    originalValues: [400, 250],
    originalUnits: ["ms", "ms"],
    definitionId: "metric-web-publish-latency-p95",
    statistic: "p95",
    context: {
      capabilityId: "web-publishing",
      taskType: "web-publishing",
      startEvent: "submit click",
      endEvent: "confirmation visible",
      workload: "1 MiB image upload",
      environment: "Chrome 130, office Wi-Fi",
      averagingMode: "none",
      sourceDescription: "Local k6 report, run 24.",
    },
    sourceEvidenceIds: [],
    attestation: "user-attested" as const,
    ...overrides,
  };
  const answer = {
    ...payload,
    answerHash: measurementAnswerHash(payload as never),
  };
  return answer as MeasurementAnswer;
}

function publicMetricId(id: string): string {
  return (
    "metric-" +
    id
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
  );
}

function metricDto(id: string): MeasurementDefinition | undefined {
  const definition = METRIC_CATALOG.find(
    (candidate) => publicMetricId(candidate.id) === id,
  );
  if (!definition) return undefined;
  return {
    id,
    version: 1,
    capability: definition.capabilityIds[0],
    task: definition.taskTypes[0],
    quantity: definition.quantityKind,
    unit: definition.canonicalUnit ?? definition.allowedUnits[0] ?? "custom",
    statistic: definition.allowedStatistics[0],
    direction: definition.direction,
    allowedRange: {
      min: definition.validRange.min,
      max: definition.validRange.max,
    },
    requiredContext: [...definition.requiredContextFields],
    calculatorId: definition.formulaIds[0] ?? null,
    rendererId: definition.absoluteRendererId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
    recipeId: definition.recipeIds[0] ?? null,
  };
}

async function setup() {
  root = await mkdtemp(join(tmpdir(), "github-measurement-task18-"));
  record = makeRecord();
  context = makeContext();
  deferredCreate = vi.fn(async (input) => {
    return ok({
      ...input,
      id: "deferred-one",
      version: 1,
      createdAt: fixedNow.toISOString(),
      retentionDeadline: new Date(
        fixedNow.getTime() + 30 * 24 * 60 * 60_000,
      ).toISOString(),
    });
  });
  measurementPortCalls = vi.fn(() => {});
  const memoryStore = {
    get: vi.fn(async ({ id }: { id: string }) =>
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
    ),
    updateExpectedVersion: vi.fn(
      async (input: {
        id: string;
        expectedVersion: number;
        patch: Partial<ImportRecord>;
      }) => {
        if (
          input.id !== record.id ||
          input.expectedVersion !== record.version
        ) {
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
    ),
  };
  store = memoryStore as unknown as ImportStorePort;
  const measurementPort = {
    getApplicableDefinitions: (input: {
      capability: string;
      task?: string;
    }) => {
      measurementPortCalls();
      const definitions = METRIC_CATALOG.filter(
        (definition) =>
          definition.capabilityIds.includes(input.capability) &&
          (!input.task || definition.taskTypes.includes(input.task)),
      ).map((definition) => metricDto(publicMetricId(definition.id)));
      return ok(definitions.filter(Boolean) as MeasurementDefinition[]);
    },
    validateMeasurementAnswer: (input: {
      answer: MeasurementAnswer;
      expectedVersion?: number;
    }) => {
      measurementPortCalls();
      return ok(input.answer);
    },
    deriveMeasurementResult: (input: { answer: MeasurementAnswer }) => {
      measurementPortCalls();
      const answer = input.answer;
      const values = answer.originalValues;
      const derivedQuantity =
        values.length === 2
          ? Number((((values[0] - values[1]) / values[0]) * 100).toFixed(1))
          : null;
      return ok({
        id: "measurement-" + answer.answerHash.slice(0, 32),
        definitionId: answer.definitionId ?? "custom-metric-v1",
        version: answer.version,
        originalValues: values,
        originalUnits: answer.originalUnits,
        normalizedValues: values,
        normalizedUnit: answer.originalUnits[0] ?? "ms",
        context: answer.context,
        evidenceStatus:
          answer.mode === "report"
            ? "documented"
            : answer.attestation === "measured" ||
                answer.attestation === "user-attested" ||
                answer.attestation === "documented"
              ? answer.attestation
              : "none",
        formulaVersion: "1.0.0",
        roundingPolicy: "1.0.0",
        derivedQuantity,
        rendererId: "renderer-duration-comparison-v1",
        previewHash: answer.answerHash,
        confirmed: true,
      });
    },
    renderMetricClause: (input: {
      result: import("../../../../src/lib/github/contracts").MeasurementResult;
    }) => {
      measurementPortCalls();
      const result = input.result;
      const clause =
        result.derivedQuantity === null
          ? "recorded p95 publishing latency of " +
            result.normalizedValues[0] +
            " " +
            result.normalizedUnit
          : "recorded p95 publishing latency of " +
            result.normalizedValues[1] +
            " " +
            result.normalizedUnit +
            " (" +
            result.derivedQuantity +
            "% lower than baseline)";
      return ok({ clause, previewHash: result.previewHash });
    },
  } as unknown as MeasurementPort;
  deferredDelete = vi.fn(async () => ok({ deleted: true as const }));
  const deferredTasks = {
    create: deferredCreate,
    get: vi.fn(async () =>
      ok({
        id: "deferred-one",
        version: 1,
        projectId: "project-one",
        draftId: "draft-one",
        claimContext: "Implemented the publishing flow with retry handling.",
        questionId: "measurement-draft-one",
        questionVersion: 1,
        definitionIds: [],
        createdAt: fixedNow.toISOString(),
        retentionDeadline: new Date(
          fixedNow.getTime() + 30 * 24 * 60 * 60_000,
        ).toISOString(),
      }),
    ),
    delete: deferredDelete,
    expire: vi.fn(),
  } as unknown as DeferredMeasurementTaskStorePort;
  service = createMeasurementService({
    store,
    deferredTasks,
    measurements: measurementPort,
    now: () => new Date(fixedNow),
  });
}

beforeEach(async () => {
  await setup();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("local GitHub measurement interview", () => {
  it("derives a source-backed comparative preview locally and preserves the base text", async () => {
    const questions = await service.questions(
      { importId: record.id, expectedVersion: record.version },
      context,
    );
    expect(questions.ok).toBe(true);
    if (!questions.ok) return;
    const question = questions.value[0];
    const answer = answerFor(question.id, question.version);

    const saved = await service.answer(
      {
        importId: record.id,
        questionId: question.id,
        expectedVersion: record.version,
        answer,
      },
      context,
    );

    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.version).toBe(2);
    expect(saved.value.result?.originalValues).toEqual([400, 250]);
    expect(saved.value.result?.derivedQuantity).toBe(37.5);
    expect(saved.value.result?.confirmed).toBe(false);

    const preview = await service.preview(
      {
        importId: record.id,
        draftId: "draft-one",
        measurementResultId: saved.value.result?.id,
      },
      context,
    );
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value.text).toContain(
      "Implemented the publishing flow with retry handling.",
    );
    expect(preview.value.text).toMatch(/250|37\.5/);
    expect(preview.value.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(measurementPortCalls).toHaveBeenCalled();
  });

  it("rejects an ML metric when the selected task is regression", async () => {
    const questions = await service.questions({ importId: record.id }, context);
    if (!questions.ok) throw new Error("Questions were unavailable.");
    const question = questions.value[0];
    const answer = answerFor(question.id, question.version, {
      originalValues: [0.92],
      originalUnits: ["score"],
      definitionId: "metric-ml-classification-accuracy",
      statistic: "single-evaluation",
      context: {
        capabilityId: "machine-learning",
        taskType: "regression",
        dataset: "support tickets",
        datasetVersion: "2026-04",
        evaluationSplit: "held-out",
        averagingMode: "sample-weighted",
        sourceDescription: "Evaluation report.",
      },
    });

    const saved = await service.answer(
      {
        importId: record.id,
        questionId: question.id,
        expectedVersion: record.version,
        answer,
      },
      context,
    );

    expect(saved.ok).toBe(false);
    if (!saved.ok) expect(saved.error.code).toBe("invalid-input");
    expect(record.version).toBe(1);
  });

  it("keeps future targets separate from achieved-result previews", async () => {
    const questions = await service.questions({ importId: record.id }, context);
    if (!questions.ok) throw new Error("Questions were unavailable.");
    const question = questions.value[0];
    const answer = answerFor(question.id, question.version, {
      mode: "target",
      originalValues: [250],
      originalUnits: ["ms"],
      attestation: "target",
    });

    const saved = await service.answer(
      {
        importId: record.id,
        questionId: question.id,
        expectedVersion: record.version,
        answer,
      },
      context,
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.result).toBeNull();

    const preview = await service.preview(
      { importId: record.id, draftId: "draft-one" },
      context,
    );
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.value.text).toBe(record.draftEdits[0].text);
      expect(preview.value.text).not.toContain("250 ms");
    }
  });

  it("preserves report provenance as documented and unverified", async () => {
    const questions = await service.questions({ importId: record.id }, context);
    if (!questions.ok) throw new Error("Questions were unavailable.");
    const question = questions.value[0];
    const answer = answerFor(question.id, question.version, {
      mode: "report",
      originalValues: [250],
      originalUnits: ["ms"],
      attestation: "documented",
      context: {
        capabilityId: "web-publishing",
        taskType: "web-publishing",
        startEvent: "submit click",
        endEvent: "confirmation visible",
        workload: "1 MiB image upload",
        environment: "Chrome 130, office Wi-Fi",
        averagingMode: "none",
        sourceDescription: "Publishing report, run 24.",
      },
    });
    const saved = await service.answer(
      {
        importId: record.id,
        questionId: question.id,
        expectedVersion: record.version,
        answer,
      },
      context,
    );

    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.result?.evidenceStatus).toBe("documented");
    expect(saved.value.result?.confirmed).toBe(false);
  });

  it("completes a skipped measurement as a qualitative draft", async () => {
    const questions = await service.questions({ importId: record.id }, context);
    if (!questions.ok) throw new Error("Questions were unavailable.");
    const question = questions.value[0];
    const answer = answerFor(question.id, question.version, {
      mode: "skip",
      originalValues: [],
      originalUnits: [],
      definitionId: null,
      statistic: null,
      context: {},
      sourceEvidenceIds: [],
      attestation: "none",
    });

    const saved = await service.answer(
      {
        importId: record.id,
        questionId: question.id,
        expectedVersion: record.version,
        answer,
      },
      context,
    );
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.value.result).toBeNull();

    const preview = await service.preview(
      { importId: record.id, draftId: "draft-one" },
      context,
    );
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.value.text).toBe(record.draftEdits[0].text);
      expect(preview.value.text).not.toMatch(/\{\{.*metric.*\}\}/i);
    }
  });

  it("rejects stale import versions and tampered computed values", async () => {
    const questions = await service.questions({ importId: record.id }, context);
    if (!questions.ok) throw new Error("Questions were unavailable.");
    const question = questions.value[0];
    const staleAnswer = answerFor(question.id, question.version);
    const stale = await service.answer(
      {
        importId: record.id,
        questionId: question.id,
        expectedVersion: 9,
        answer: staleAnswer,
      },
      context,
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe("version-conflict");

    const tampered = {
      ...staleAnswer,
      computedPercentage: 99,
    };
    tampered.answerHash = measurementAnswerHash(tampered as never);
    const invalid = await service.answer(
      {
        importId: record.id,
        questionId: question.id,
        expectedVersion: record.version,
        answer: tampered as never,
      },
      context,
    );
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe("invalid-input");
    expect(record.version).toBe(1);
  });

  it("returns the prior result for the same answer hash without a second write", async () => {
    const questions = await service.questions({ importId: record.id }, context);
    if (!questions.ok) throw new Error("Questions were unavailable.");
    const question = questions.value[0];
    const answer = answerFor(question.id, question.version);
    const first = await service.answer(
      {
        importId: record.id,
        questionId: question.id,
        expectedVersion: record.version,
        answer,
      },
      context,
    );
    const retry = await service.answer(
      {
        importId: record.id,
        questionId: question.id,
        expectedVersion: 1,
        answer,
      },
      context,
    );

    expect(first.ok).toBe(true);
    expect(retry.ok).toBe(true);
    if (first.ok && retry.ok) {
      expect(retry.value.version).toBe(first.value.version);
      expect(retry.value.result?.id).toBe(first.value.result?.id);
    }
  });

  it("creates a retained deferred task that does not depend on staged imports", async () => {
    const questions = await service.questions({ importId: record.id }, context);
    if (!questions.ok) throw new Error("Questions were unavailable.");
    const deferred = await service.defer(
      {
        importId: record.id,
        questionId: questions.value[0].id,
        expectedVersion: record.version,
      },
      context,
    );

    expect(deferred.ok).toBe(true);
    if (deferred.ok) {
      expect(Date.parse(deferred.value.retentionDeadline)).toBeGreaterThan(
        Date.parse(record.retentionDeadline),
      );
      expect(deferredCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-one",
          draftId: "draft-one",
          claimContext: record.draftEdits[0].text,
        }),
        context,
      );
    }
  });

  it("deletes a deferred task when a measurement answer replaces it", async () => {
    const questions = await service.questions({ importId: record.id }, context);
    if (!questions.ok) throw new Error("Questions were unavailable.");
    const question = questions.value[0];
    const deferred = await service.defer(
      {
        importId: record.id,
        questionId: question.id,
        expectedVersion: record.version,
      },
      context,
    );
    if (!deferred.ok) throw new Error("Measurement could not be deferred.");

    const answer = answerFor(question.id, 2);
    const result = await service.answer(
      {
        importId: record.id,
        questionId: question.id,
        expectedVersion: record.version,
        answer,
      },
      context,
    );

    expect(result.ok).toBe(true);
    expect(deferredDelete).toHaveBeenCalledWith(
      { id: deferred.value.deferredTaskId, expectedVersion: 1 },
      context,
    );
  });

  it("invalidates previews after a base edit and resets answers after scope changes", async () => {
    const questions = await service.questions({ importId: record.id }, context);
    if (!questions.ok) throw new Error("Questions were unavailable.");
    const question = questions.value[0];
    const answer = answerFor(question.id, question.version);
    await service.answer(
      {
        importId: record.id,
        questionId: question.id,
        expectedVersion: record.version,
        answer,
      },
      context,
    );
    const first = await service.preview(
      { importId: record.id, draftId: "draft-one" },
      context,
    );
    if (!first.ok) throw new Error("First preview was unavailable.");

    record = ImportRecordSchema.parse({
      ...record,
      draftEdits: [
        {
          ...record.draftEdits[0],
          version: 2,
          text: "Improved the publishing flow with retry handling.",
          updatedAt: new Date(fixedNow.getTime() + 1_000).toISOString(),
        },
      ],
    });
    const edited = await service.preview(
      { importId: record.id, draftId: "draft-one" },
      context,
    );
    expect(edited.ok).toBe(true);
    if (edited.ok) {
      expect(edited.value.hash).not.toBe(first.value.hash);
      expect(edited.value.text).toContain("Improved the publishing flow");
    }

    const latestQuestions = await service.questions(
      { importId: record.id, expectedVersion: record.version },
      context,
    );
    if (!latestQuestions.ok)
      throw new Error("Updated questions were unavailable.");
    const latestQuestion = latestQuestions.value[0];
    const changedAnswer = answerFor(latestQuestion.id, latestQuestion.version, {
      originalValues: [500, 250],
    });
    const updated = await service.answer(
      {
        importId: record.id,
        questionId: latestQuestion.id,
        expectedVersion: record.version,
        answer: changedAnswer,
      },
      context,
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    const changedPreview = await service.preview(
      { importId: record.id, draftId: "draft-one" },
      context,
    );
    expect(changedPreview.ok).toBe(true);
    if (changedPreview.ok && edited.ok) {
      expect(changedPreview.value.hash).not.toBe(edited.value.hash);
      expect(changedPreview.value.text).toContain("50% lower");
    }

    record = ImportRecordSchema.parse({
      ...record,
      version: record.version + 1,
      selectionVersion: 2,
      selectionHash: "f".repeat(64),
    });
    const refreshed = await service.questions(
      { importId: record.id, expectedVersion: record.version },
      context,
    );
    expect(refreshed.ok).toBe(true);
    if (refreshed.ok) expect(refreshed.value[0].answered).toBe(false);
  });

  it("does not import a generated provider", async () => {
    const source = await readFile(
      new URL(
        "../../../../src/lib/github/server/measurement-service.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).not.toMatch(
      /from\s+["'][^"']*(?:provider|gemini|ai\/)[^"']*["']/i,
    );
  });
});
