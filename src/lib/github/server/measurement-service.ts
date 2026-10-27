import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  assertLocalStatePath,
  readLocalState,
  writeLocalState,
  withLocalStateLock,
} from "./local-state";
import { z } from "zod";
import {
  AnalysisResultSchema,
  DomainErrorSchema,
  GITHUB_IMPORT_POLICY,
  ImportQuestionSchema,
  MeasurementAnswerSchema,
  MeasurementResultSchema,
  err,
  ok,
  type DomainError,
  type DraftEdit,
  type ExecutionContext,
  type ImportRecord,
  type ImportQuestion,
  type MeasurementAnswer,
  type MeasurementResult,
  type Result,
} from "../contracts";
import {
  MEASUREMENT_CATALOG_VERSION,
  METRIC_CATALOG,
  getApplicableDefinitions,
  type MeasurementContext,
  type MetricDefinition,
} from "../measurement-catalog";
import type {
  ImportStorePort,
  MeasurementPort,
  MeasurementServiceFactory,
} from "../ports";

const interviewStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    catalogVersion: z.literal(MEASUREMENT_CATALOG_VERSION),
    importId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    authorizationNamespaceHash: z.string().regex(/^[a-f0-9]{64}$/),
    scopeHash: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.string().datetime(),
    questions: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
            draftId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
            version: z.number().int().positive(),
            definitionIds: z.array(z.string().min(1).max(160)).max(20),
            answer: MeasurementAnswerSchema.nullable(),
            result: MeasurementResultSchema.nullable(),
            branch: z
              .enum(["result", "report", "target", "skipped", "deferred"])
              .nullable(),
            preview: z
              .object({
                hash: z.string().regex(/^[a-f0-9]{64}$/),
                answerHash: z
                  .string()
                  .regex(/^[a-f0-9]{64}$/)
                  .nullable(),
                baseTextHash: z.string().regex(/^[a-f0-9]{64}$/),
                text: z.string().trim().min(1).max(8_000),
              })
              .strict()
              .nullable(),
            deferredTaskId: z
              .string()
              .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
              .nullable(),
            deferredRetentionDeadline: z.string().datetime().nullable(),
          })
          .strict(),
      )
      .max(GITHUB_IMPORT_POLICY.draftPoints),
  })
  .strict();

type InterviewState = z.infer<typeof interviewStateSchema>;
type QuestionState = InterviewState["questions"][number];
type ServiceFaultCode = DomainError["code"];

const MODE_CHOICES = [
  "Yes, I have a result",
  "There is a report to review",
  "Help me measure it",
  "Continue without a number",
  "Set a future target",
] as const;

const ENGINE_CONTEXT_FIELDS = [
  "capabilityId",
  "taskType",
  "startEvent",
  "endEvent",
  "endpoint",
  "workload",
  "environment",
  "observationWindow",
  "dataset",
  "datasetVersion",
  "evaluationSplit",
  "positiveClass",
  "targetUnit",
  "taskDescription",
  "observationPeriod",
  "toolVersion",
  "revision",
] as const;

function serviceFault(
  code: ServiceFaultCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): never {
  const candidate = DomainErrorSchema.parse({
    code,
    message,
    retryable: code === "io-error" || code === "unavailable",
    ...(fieldErrors ? { fieldErrors } : {}),
  });
  throw Object.assign(new Error(message), { domainError: candidate });
}

function errorResult(error: unknown): DomainError {
  if (error && typeof error === "object" && "domainError" in error) {
    const parsed = DomainErrorSchema.safeParse(error.domainError);
    if (parsed.success) return parsed.data;
  }
  if (isAbortError(error)) {
    return {
      code: "cancelled",
      message: "The local measurement operation was cancelled.",
      retryable: false,
    };
  }
  return {
    code: "io-error",
    message: "The local measurement state could not be read or saved.",
    retryable: true,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function hashValue(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

/**
 * Hash the exact answer fields that are submitted to the service. The hash is
 * checked on receipt and is also used as the answer idempotency key.
 */
export function measurementAnswerHash(
  answer: Omit<MeasurementAnswer, "answerHash">,
): string {
  return hashValue(answer);
}

function publicDefinitionId(id: string): string {
  if (id === "custom.v1") return "custom-metric-v1";
  const slug = id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return "metric-" + slug;
}

function definitionForPublicId(id: string): MetricDefinition | undefined {
  if (id === "custom-metric-v1") return undefined;
  return METRIC_CATALOG.find(
    (definition) => publicDefinitionId(definition.id) === id,
  );
}

function definitionChoices(): string[] {
  return METRIC_CATALOG.map(
    (definition) =>
      "metric:" + publicDefinitionId(definition.id) + " — " + definition.label,
  ).concat(["metric:custom-metric-v1 — Describe a custom measurement"]);
}

function newQuestion(draftId: string): QuestionState {
  return {
    id: "measurement-" + draftId,
    draftId,
    version: 1,
    definitionIds: [
      ...METRIC_CATALOG.map((definition) => publicDefinitionId(definition.id)),
      publicDefinitionId("custom.v1"),
    ],
    answer: null,
    result: null,
    branch: null,
    preview: null,
    deferredTaskId: null,
    deferredRetentionDeadline: null,
  };
}

function scopeHash(record: ImportRecord): string {
  return hashValue({
    scope: record.scope,
    destinationProjectId: record.destinationProjectId,
    selectionVersion: record.selectionVersion,
    selectionHash: record.selectionHash,
  });
}

function freshState(
  record: ImportRecord,
  authorizationNamespace: string,
): InterviewState {
  return {
    schemaVersion: 1,
    catalogVersion: MEASUREMENT_CATALOG_VERSION,
    importId: record.id,
    authorizationNamespaceHash: hashValue(authorizationNamespace),
    scopeHash: scopeHash(record),
    expiresAt: record.retentionDeadline,
    questions: record.draftRefs
      .slice(0, GITHUB_IMPORT_POLICY.draftPoints)
      .map(newQuestion),
  };
}

function reconcileState(
  current: InterviewState | null,
  record: ImportRecord,
  authorizationNamespace: string,
): InterviewState {
  const namespaceHash = hashValue(authorizationNamespace);
  if (
    !current ||
    current.importId !== record.id ||
    current.authorizationNamespaceHash !== namespaceHash ||
    current.catalogVersion !== MEASUREMENT_CATALOG_VERSION ||
    current.scopeHash !== scopeHash(record) ||
    current.expiresAt !== record.retentionDeadline
  ) {
    return freshState(record, authorizationNamespace);
  }

  const draftIds = record.draftRefs.slice(0, GITHUB_IMPORT_POLICY.draftPoints);
  const byDraft = new Map(
    current.questions.map((question) => [question.draftId, question]),
  );
  return {
    ...current,
    questions: draftIds.map(
      (draftId) => byDraft.get(draftId) ?? newQuestion(draftId),
    ),
  };
}

function publicQuestion(question: QuestionState): ImportQuestion {
  const choices = [...MODE_CHOICES, ...definitionChoices()].slice(0, 20);
  return ImportQuestionSchema.parse({
    id: question.id,
    version: question.version,
    draftId: question.draftId,
    kind: "measurement",
    prompt:
      "Did you measure a result for this contribution? Choose a compatible metric, review its context, or continue without a number.",
    required: false,
    definitionId: null,
    choices,
    answered: question.answer !== null,
  });
}

function checkContext(context: ExecutionContext): void {
  if (context.signal.aborted) {
    serviceFault("cancelled", "The local measurement operation was cancelled.");
  }
  const deadline = Date.parse(context.deadline);
  if (!Number.isFinite(deadline) || deadline <= context.now().getTime()) {
    serviceFault("interrupted", "The local measurement operation has expired.");
  }
}

function checkReviewRecord(
  record: ImportRecord,
  now: Date,
  allowApproved = false,
): void {
  if (Date.parse(record.retentionDeadline) <= now.getTime()) {
    serviceFault("not-found", "This measurement review has expired.");
  }
  if (
    ![
      "ready-to-review",
      "partial",
      ...(allowApproved ? ["approved"] : []),
    ].includes(record.lifecycle)
  ) {
    serviceFault(
      "version-conflict",
      "Measurements are available only for drafts that are ready for review.",
    );
  }
}

function checkExpectedVersion(actual: number, expected: number): void {
  if (!Number.isSafeInteger(expected) || expected < 1 || actual !== expected) {
    serviceFault(
      "version-conflict",
      "The import changed. Reload its current measurement questions.",
    );
  }
}

function validateAnswerEnvelope(
  input: MeasurementAnswer,
  question: QuestionState,
): MeasurementAnswer {
  const parsed = MeasurementAnswerSchema.safeParse({
    ...input,
    // Catalog IDs contain dots, while the frozen transport DTO permits only
    // hyphenated IDs. The service exposes a safe local alias and maps it back
    // to the versioned catalog before invoking the engine.
    definitionId: null,
  });
  if (!parsed.success) {
    serviceFault("invalid-input", "The measurement answer is invalid.", {
      answer: parsed.error.issues.map((issue) => issue.message),
    });
  }
  if (input.questionId !== question.id) {
    serviceFault(
      "invalid-input",
      "The answer belongs to a different question.",
      {
        questionId: ["Choose a current measurement question."],
      },
    );
  }
  if (input.mode === "defer") {
    serviceFault(
      "invalid-input",
      "Use the Help me measure it action to create a deferred task.",
    );
  }
  return { ...parsed.data, definitionId: input.definitionId };
}

function answerHashMatches(answer: MeasurementAnswer): boolean {
  const { answerHash, ...payload } = answer;
  return answerHash === measurementAnswerHash(payload);
}

function measurementContext(answer: MeasurementAnswer): MeasurementContext {
  const context: Record<string, unknown> = {};
  for (const field of ENGINE_CONTEXT_FIELDS) {
    const value = answer.context[field];
    if (value !== undefined && value.trim() !== "")
      context[field] = value.trim();
  }
  const sampleCount = answer.context.sampleCount;
  if (sampleCount !== undefined && sampleCount.trim() !== "") {
    const parsed = Number(sampleCount);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      serviceFault(
        "invalid-input",
        "Sample count must be a positive integer.",
        {
          sampleCount: ["Enter a positive integer sample count."],
        },
      );
    }
    context.sampleCount = parsed;
  }
  const evaluationSplit = context.evaluationSplit;
  if (
    evaluationSplit !== undefined &&
    ![
      "training",
      "validation",
      "test",
      "held-out",
      "cross-validation",
    ].includes(String(evaluationSplit))
  ) {
    serviceFault("invalid-input", "Choose a supported evaluation split.", {
      evaluationSplit: ["Choose a supported dataset split."],
    });
  }
  return context as MeasurementContext;
}

function requireCompatibleDefinition(
  answer: MeasurementAnswer,
  question: QuestionState,
): MetricDefinition | null {
  if (answer.mode === "skip") {
    if (answer.definitionId !== null || answer.originalValues.length > 0) {
      serviceFault(
        "invalid-input",
        "A skipped metric cannot contain a result.",
      );
    }
    return null;
  }
  if (answer.mode === "defer") {
    serviceFault("invalid-input", "Use the defer action for measurement help.");
  }
  const publicId = answer.definitionId;
  if (!publicId || !question.definitionIds.includes(publicId)) {
    serviceFault(
      "needs-context",
      "Choose a metric from the local catalog before entering a value.",
      { definitionId: ["Select a supported metric definition."] },
    );
  }
  if (publicId === "custom-metric-v1") {
    if (answer.mode === "target") {
      serviceFault(
        "invalid-input",
        "A custom measurement cannot be stored as a target result.",
      );
    }
    return null;
  }
  const definition = definitionForPublicId(publicId);
  if (!definition) {
    serviceFault(
      "invalid-input",
      "The selected metric definition is unavailable.",
    );
  }
  const context = answer.context;
  const capabilityId = context.capabilityId?.trim().toLowerCase();
  const taskType = context.taskType?.trim().toLowerCase();
  if (!capabilityId || !taskType) {
    serviceFault(
      "needs-context",
      "Confirm the capability and task before attaching a measurement.",
      {
        capabilityId: ["Choose the capability this contribution implements."],
        taskType: ["Choose the task being measured."],
      },
    );
  }
  const applicable = getApplicableDefinitions({ capabilityId, taskType });
  if (
    !applicable.definitions.some((candidate) => candidate.id === definition.id)
  ) {
    serviceFault(
      "invalid-input",
      "That metric does not match the selected capability and task.",
      { definitionId: ["Choose a metric that matches this task."] },
    );
  }
  return definition;
}

function deriveAnswer(
  answer: MeasurementAnswer,
  question: QuestionState,
  measurements: MeasurementPort,
): Result<MeasurementResult | null> {
  const definition = requireCompatibleDefinition(answer, question);
  measurementContext(answer);

  if (
    answer.mode === "result" &&
    answer.attestation === "user-attested" &&
    !answer.context.sourceDescription?.trim() &&
    answer.sourceEvidenceIds.length === 0
  ) {
    serviceFault(
      "needs-context",
      "Describe how the result was measured before using it.",
      {
        sourceDescription: [
          "Describe the measurement method or add a source reference.",
        ],
      },
    );
  }
  if (
    answer.mode === "report" &&
    !answer.context.sourceDescription?.trim() &&
    answer.sourceEvidenceIds.length === 0
  ) {
    serviceFault(
      "needs-context",
      "Describe the report source or select its evidence.",
      { sourceDescription: ["Identify the report being reviewed."] },
    );
  }

  if (definition && answer.mode !== "skip") {
    const capabilityId = answer.context.capabilityId?.trim().toLowerCase();
    const taskType = answer.context.taskType?.trim().toLowerCase();
    const catalog = measurements.getApplicableDefinitions({
      capability: capabilityId ?? "",
      task: taskType,
    });
    if (!catalog.ok) return err(catalog.error);
    const publicId = publicDefinitionId(definition.id);
    if (
      !catalog.value.some(
        (candidate) =>
          candidate.id === definition.id ||
          candidate.id === publicId ||
          publicDefinitionId(candidate.id) === publicId,
      )
    ) {
      serviceFault(
        "invalid-input",
        "That metric is not available for the selected capability and task.",
        { definitionId: ["Choose a compatible metric definition."] },
      );
    }
  }

  const validated = measurements.validateMeasurementAnswer({
    answer,
  });
  if (!validated.ok) return err(validated.error);

  // Targets and qualitative skips are stored as interview branches, never as
  // achieved MeasurementResult records or resume clauses.
  if (answer.mode === "target" || answer.mode === "skip") return ok(null);

  const derived = measurements.deriveMeasurementResult({
    answer: validated.value,
  });
  if (!derived.ok) return err(derived.error);
  if (!derived.value) return ok(null);
  if (derived.value.definitionId !== answer.definitionId) {
    serviceFault(
      "invalid-evidence",
      "The measurement engine returned a result for a different definition.",
    );
  }
  const parsed = MeasurementResultSchema.safeParse({
    ...derived.value,
    confirmed: false,
  });
  if (!parsed.success) {
    serviceFault(
      "invalid-input",
      "The measurement engine returned an invalid result.",
    );
  }
  return ok(parsed.data);
}
async function baseDraftText(
  record: ImportRecord,
  draftId: string,
  context: ExecutionContext,
  store: ImportStorePort,
): Promise<{
  edit: DraftEdit;
  hash: string;
}> {
  let edit = record.draftEdits.find(
    (candidate) => candidate.draftId === draftId,
  );
  if (!edit && record.resultRef) {
    const cached = await store.cacheGetByKey(
      { key: record.resultRef },
      context,
    );
    if (!cached.ok) serviceFault(cached.error.code, cached.error.message);
    const value = cached.value?.value;
    if (value?.kind === "extraction-result") {
      const result = AnalysisResultSchema.parse(value.result);
      const draft =
        result.selectionHash === record.selectionHash
          ? result.drafts.find((d) => d.id === draftId)
          : undefined;
      if (draft)
        edit = {
          draftId,
          version: draft.version,
          baseResultHash: hashValue(draft),
          text: draft.reviewedBaseText,
          selectedForSave: false,
          contributionConfirmed: false,
          confirmedMetricResultIds: [],
          updatedAt: record.updatedAt,
        };
    }
  }
  if (!edit) {
    serviceFault(
      "needs-context",
      "The reviewed draft text is not available for a safe measurement preview.",
      {
        draftId: ["Reload the current draft before previewing a measurement."],
      },
    );
  }
  return { edit, hash: hashValue(edit) };
}

type InterviewPaths = { root: string; file: string };
async function pathsFor(
  context: ExecutionContext,
  importId: string,
): Promise<InterviewPaths> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(importId))
    serviceFault("invalid-input", "The import identifier is invalid.");
  const root = context.personalRoot;
  const file = join(
    root,
    ".github-import-measurements",
    hashValue(context.access.authorizationNamespace),
    importId + ".json",
  );
  await assertLocalStatePath(root, file);
  return { root, file };
}
async function withInterviewLock<T>(
  context: ExecutionContext,
  importId: string,
  run: (paths: InterviewPaths) => Promise<T>,
): Promise<T> {
  const paths = await pathsFor(context, importId);
  return withLocalStateLock(paths.root, paths.file, async () => {
    checkContext(context);
    return run(paths);
  });
}
async function readState(
  paths: InterviewPaths,
): Promise<InterviewState | null> {
  try {
    return interviewStateSchema.parse(
      JSON.parse(await readLocalState(paths.root, paths.file, 1024 * 1024)),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
async function writeState(
  paths: InterviewPaths,
  state: InterviewState,
): Promise<void> {
  const text = JSON.stringify(interviewStateSchema.parse(state));
  if (Buffer.byteLength(text) > 1024 * 1024)
    serviceFault("limit-exceeded", "Measurement state exceeds its limit.");
  await writeLocalState(paths.root, paths.file, text);
}

async function readReconciledState(
  paths: InterviewPaths,
  record: ImportRecord,
  authorizationNamespace: string,
  now: Date,
): Promise<InterviewState> {
  const current = await readState(paths);
  const state = reconcileState(current, record, authorizationNamespace);
  if (Date.parse(state.expiresAt) <= now.getTime()) {
    serviceFault("not-found", "This measurement review has expired.");
  }
  if (
    !current ||
    current.importId !== state.importId ||
    current.authorizationNamespaceHash !== state.authorizationNamespaceHash ||
    current.catalogVersion !== state.catalogVersion ||
    current.scopeHash !== state.scopeHash ||
    current.expiresAt !== state.expiresAt
  ) {
    await writeState(paths, state);
  }
  return state;
}

function isSameAnswer(question: QuestionState, answerHash: string): boolean {
  return question.answer?.answerHash === answerHash;
}

function answerBranch(answer: MeasurementAnswer): QuestionState["branch"] {
  if (answer.mode === "skip") return "skipped";
  if (answer.mode === "target") return "target";
  if (answer.mode === "report") return "report";
  if (answer.mode === "result") return "result";
  return null;
}

export const createMeasurementService: MeasurementServiceFactory = (deps) => ({
  async review(input, context) {
    try {
      checkContext(context);
      const loaded = await deps.store.get({ id: input.importId }, context);
      if (!loaded.ok) return loaded;
      const record = loaded.value;
      checkReviewRecord(record, deps.now(), true);
      if (input.expectedVersion !== undefined)
        checkExpectedVersion(record.version, input.expectedVersion);
      return await withInterviewLock(context, record.id, async (paths) => {
        const state = await readReconciledState(
          paths,
          record,
          context.access.authorizationNamespace,
          deps.now(),
        );
        return ok({
          questions: state.questions.map(publicQuestion),
          measurementResults: state.questions.flatMap((q) =>
            q.result ? [q.result] : [],
          ),
          draftResultIds: Object.fromEntries(
            state.questions.map((q) => [
              q.draftId,
              q.result ? [q.result.id] : [],
            ]),
          ),
        });
      });
    } catch (error) {
      return err(errorResult(error));
    }
  },
  async questions(input, context) {
    try {
      checkContext(context);
      const loaded = await deps.store.get({ id: input.importId }, context);
      if (!loaded.ok) return loaded;
      const record = loaded.value;
      checkReviewRecord(record, deps.now());
      if (input.expectedVersion !== undefined) {
        checkExpectedVersion(record.version, input.expectedVersion);
      }
      return await withInterviewLock(context, input.importId, async (paths) => {
        const state = await readReconciledState(
          paths,
          record,
          context.access.authorizationNamespace,
          deps.now(),
        );
        const questions = state.questions.filter(
          (question) => !input.draftId || question.draftId === input.draftId,
        );
        if (input.draftId && !questions.length) {
          serviceFault("not-found", "No review draft matches that question.");
        }
        return ok(questions.map(publicQuestion));
      });
    } catch (error) {
      return err(errorResult(error));
    }
  },

  async answer(input, context) {
    try {
      checkContext(context);
      const loaded = await deps.store.get({ id: input.importId }, context);
      if (!loaded.ok) return loaded;
      const record = loaded.value;
      checkReviewRecord(record, deps.now());
      const hashMatches = answerHashMatches(input.answer);
      if (!hashMatches) {
        serviceFault("invalid-input", "The answer hash is invalid.", {
          answerHash: ["Recalculate the hash after editing an answer."],
        });
      }
      return await withInterviewLock(context, input.importId, async (paths) => {
        const state = await readReconciledState(
          paths,
          record,
          context.access.authorizationNamespace,
          deps.now(),
        );
        const question = state.questions.find(
          (candidate) => candidate.id === input.questionId,
        );
        if (!question) {
          serviceFault("not-found", "The measurement question was not found.");
        }
        const validated = validateAnswerEnvelope(input.answer, question);
        if (isSameAnswer(question, validated.answerHash)) {
          return ok({ version: record.version, result: question.result });
        }
        checkExpectedVersion(record.version, input.expectedVersion);
        if (validated.version !== question.version) {
          serviceFault(
            "version-conflict",
            "The measurement question changed. Reload it before answering.",
          );
        }
        const derived = deriveAnswer(validated, question, deps.measurements);
        if (!derived.ok) return err(derived.error);
        if (question.deferredTaskId) {
          const deferred = await deps.deferredTasks.get(
            { id: question.deferredTaskId },
            context,
          );
          if (deferred.ok) {
            const deleted = await deps.deferredTasks.delete(
              {
                id: deferred.value.id,
                expectedVersion: deferred.value.version,
              },
              context,
            );
            if (!deleted.ok) return deleted;
          } else if (deferred.error.code !== "not-found") {
            return deferred;
          }
        }
        const updated = await deps.store.updateExpectedVersion(
          { id: record.id, expectedVersion: record.version, patch: {} },
          context,
        );
        if (!updated.ok) return updated;
        const nextQuestion: QuestionState = {
          ...question,
          version: question.version + 1,
          answer: validated,
          result: derived.value,
          branch: answerBranch(validated),
          preview: null,
          deferredTaskId: null,
          deferredRetentionDeadline: null,
        };
        const nextState: InterviewState = {
          ...state,
          questions: state.questions.map((candidate) =>
            candidate.id === question.id ? nextQuestion : candidate,
          ),
        };
        await writeState(paths, nextState);
        return ok({ version: updated.value.version, result: derived.value });
      });
    } catch (error) {
      return err(errorResult(error));
    }
  },

  async defer(input, context) {
    try {
      checkContext(context);
      const loaded = await deps.store.get({ id: input.importId }, context);
      if (!loaded.ok) return loaded;
      const record = loaded.value;
      checkReviewRecord(record, deps.now());
      return await withInterviewLock(context, input.importId, async (paths) => {
        const state = await readReconciledState(
          paths,
          record,
          context.access.authorizationNamespace,
          deps.now(),
        );
        const question = state.questions.find(
          (candidate) => candidate.id === input.questionId,
        );
        if (!question) {
          serviceFault("not-found", "The measurement question was not found.");
        }
        if (
          question.branch === "deferred" &&
          question.deferredTaskId &&
          question.deferredRetentionDeadline
        ) {
          return ok({
            deferredTaskId: question.deferredTaskId,
            retentionDeadline: question.deferredRetentionDeadline,
          });
        }
        checkExpectedVersion(record.version, input.expectedVersion);
        const edit = record.draftEdits.find(
          (candidate) => candidate.draftId === question.draftId,
        );
        const claimContext = (
          edit?.text ?? record.scope.contributionStatement
        ).slice(0, 2_000);
        if (!claimContext.trim()) {
          serviceFault(
            "needs-context",
            "Add a short contribution statement before deferring measurement help.",
          );
        }
        const created = await deps.deferredTasks.create(
          {
            projectId: record.destinationProjectId,
            draftId: question.draftId,
            claimContext,
            questionId: question.id,
            questionVersion: question.version,
            definitionIds: question.definitionIds.slice(0, 10),
          },
          context,
        );
        if (!created.ok) return created;
        const updated = await deps.store.updateExpectedVersion(
          { id: record.id, expectedVersion: record.version, patch: {} },
          context,
        );
        if (!updated.ok) {
          await deps.deferredTasks.delete(
            { id: created.value.id, expectedVersion: created.value.version },
            context,
          );
          return updated;
        }
        const nextQuestion: QuestionState = {
          ...question,
          version: question.version + 1,
          answer: null,
          result: null,
          branch: "deferred",
          preview: null,
          deferredTaskId: created.value.id,
          deferredRetentionDeadline: created.value.retentionDeadline,
        };
        await writeState(paths, {
          ...state,
          questions: state.questions.map((candidate) =>
            candidate.id === question.id ? nextQuestion : candidate,
          ),
        });
        return ok({
          deferredTaskId: created.value.id,
          retentionDeadline: created.value.retentionDeadline,
        });
      });
    } catch (error) {
      return err(errorResult(error));
    }
  },

  async preview(input, context) {
    try {
      checkContext(context);
      const loaded = await deps.store.get({ id: input.importId }, context);
      if (!loaded.ok) return loaded;
      const record = loaded.value;
      checkReviewRecord(record, deps.now());
      if (!record.draftRefs.includes(input.draftId)) {
        serviceFault("not-found", "The requested review draft was not found.");
      }
      const draft = await baseDraftText(
        record,
        input.draftId,
        context,
        deps.store,
      );
      return await withInterviewLock(context, input.importId, async (paths) => {
        const state = await readReconciledState(
          paths,
          record,
          context.access.authorizationNamespace,
          deps.now(),
        );
        const question = state.questions.find(
          (candidate) => candidate.draftId === input.draftId,
        );
        if (!question) {
          serviceFault(
            "not-found",
            "No measurement question matches this draft.",
          );
        }
        if (question.branch === "target" || question.branch === "deferred") {
          return ok({
            text: draft.edit.text,
            hash: hashValue({
              importId: record.id,
              draftId: input.draftId,
              baseTextHash: draft.hash,
              selectionHash: record.selectionHash,
              questionId: question.id,
              questionVersion: question.version,
              answerHash: question.answer?.answerHash ?? null,
              templateVersion: "github-measurement-preview-v1",
              branch: question.branch,
            }),
          });
        }

        let clause: string | null = null;
        let rendererPreviewHash: string | null = null;
        let result: MeasurementResult | null = null;
        if (question.answer && question.branch !== "skipped") {
          const derived = deriveAnswer(
            question.answer,
            question,
            deps.measurements,
          );
          if (!derived.ok) return err(derived.error);
          result = derived.value;
          if (result) {
            const rendered = deps.measurements.renderMetricClause({ result });
            if (!rendered.ok) return err(rendered.error);
            clause = rendered.value.clause;
            rendererPreviewHash = rendered.value.previewHash;
          }
          if (
            input.measurementResultId &&
            input.measurementResultId !== result?.id
          ) {
            serviceFault(
              "version-conflict",
              "The selected measurement changed. Reload its current preview.",
            );
          }
          if (
            question.result &&
            result &&
            question.result.previewHash !== result.previewHash
          ) {
            serviceFault(
              "version-conflict",
              "The measurement changed after it was answered.",
            );
          }
        } else if (input.measurementResultId) {
          serviceFault(
            "not-found",
            "A skipped or unanswered measurement has no result to preview.",
          );
        }

        const text =
          clause && result ? draft.edit.text + " " + clause : draft.edit.text;
        if (text.length > 8_000) {
          serviceFault(
            "limit-exceeded",
            "The measurement wording would exceed the reviewed draft length.",
          );
        }
        const hash = hashValue({
          importId: record.id,
          draftId: input.draftId,
          importVersion: record.version,
          selectionHash: record.selectionHash,
          scopeHash: scopeHash(record),
          questionId: question.id,
          questionVersion: question.version,
          answerHash: question.answer?.answerHash ?? null,
          resultHash: result?.previewHash ?? null,
          rendererPreviewHash,
          baseTextHash: draft.hash,
          text,
          templateVersion: "github-measurement-preview-v1",
        });
        const nextQuestion: QuestionState = {
          ...question,
          preview: {
            hash,
            answerHash: question.answer?.answerHash ?? null,
            baseTextHash: draft.hash,
            text,
          },
        };
        await writeState(paths, {
          ...state,
          questions: state.questions.map((candidate) =>
            candidate.id === question.id ? nextQuestion : candidate,
          ),
        });
        return ok({ text, hash });
      });
    } catch (error) {
      return err(errorResult(error));
    }
  },
});

/** Trusted local answer records used by approval; never read from request bodies. */
export async function readReviewedMeasurements(
  record: ImportRecord,
  context: ExecutionContext,
) {
  return withInterviewLock(context, record.id, async (paths) => {
    const state = await readReconciledState(
      paths,
      record,
      context.access.authorizationNamespace,
      context.now(),
    );
    return state.questions.flatMap((q) =>
      q.answer && q.result
        ? [
            {
              draftId: q.draftId,
              answer: q.answer,
              result: q.result,
              preview: q.preview,
            },
          ]
        : [],
    );
  });
}
