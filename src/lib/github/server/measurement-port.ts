import { createHash } from "node:crypto";
import {
  METRIC_CATALOG,
  getApplicableDefinitions,
  type MeasurementContext,
  type MetricDefinition,
} from "../measurement-catalog";
import {
  deriveMeasurementResult,
  renderMetricClause,
  validateMeasurementAnswer,
  type MeasurementAnswerInput,
} from "../measurements";
import {
  MeasurementAnswerSchema,
  MeasurementResultSchema,
  MetricDefinitionSchema,
  err,
  ok,
  type MeasurementAnswer,
  type MeasurementDefinition,
  type MeasurementResult,
  type Result,
} from "../contracts";
import type { MeasurementPort } from "../ports";

export const metricId = (id: string) =>
  "metric-" +
  id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const slug = (id: string) =>
  id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");

export const measurementDefinitions: MeasurementDefinition[] =
  METRIC_CATALOG.map((d) =>
    MetricDefinitionSchema.parse({
      id: metricId(d.id),
      version: 1,
      capability: d.capabilityIds[0],
      task: d.taskTypes[0],
      quantity: d.quantityKind,
      unit: d.canonicalUnit ?? "same-dimension-as-target",
      statistic: d.allowedStatistics[0],
      direction: d.direction,
      allowedRange: d.validRange,
      requiredContext: d.requiredContextFields,
      calculatorId: d.formulaIds[0] ? slug(d.formulaIds[0]) : null,
      rendererId: slug(d.absoluteRendererId),
      recipeId: d.recipeIds[0] ? slug(d.recipeIds[0]) : null,
    }),
  );

function invalid(message: string): Result<never> {
  return err({ code: "invalid-input", message, retryable: false });
}
function definition(id: string | null): MetricDefinition | undefined {
  return METRIC_CATALOG.find((d) => metricId(d.id) === id);
}

function engineInput(answer: MeasurementAnswer): MeasurementAnswerInput {
  const d = definition(answer.definitionId);
  const context = { ...answer.context } as unknown as MeasurementContext;
  if (answer.context.sampleCount)
    context.sampleCount = Number(answer.context.sampleCount);
  const observation = (i: number) => ({
    value: answer.originalValues[i]!,
    unit: answer.originalUnits[i]!,
    statistic: answer.statistic ?? "",
    averagingMode:
      answer.context.averagingMode ??
      (d?.allowedAveragingModes.includes("none")
        ? "none"
        : (d?.allowedAveragingModes[0] ?? "none")),
    context,
  });
  const comparison = answer.originalValues.length === 2;
  return {
    definitionId: d?.id,
    mode:
      answer.mode === "skip" || answer.mode === "defer"
        ? "skip"
        : answer.mode === "target"
          ? "target"
          : comparison
            ? "comparison"
            : "absolute",
    status:
      answer.mode === "skip" || answer.mode === "defer"
        ? "no-result"
        : answer.attestation === "none"
          ? "documented"
          : answer.attestation,
    ...(comparison
      ? { baseline: observation(0), comparison: observation(1) }
      : answer.originalValues.length
        ? { observation: observation(0) }
        : {}),
    evidence: {
      sourceDescription: answer.context.sourceDescription,
      evidenceIds: answer.sourceEvidenceIds,
    },
  };
}

function derive(
  answer: MeasurementAnswer,
): Result<{ result: MeasurementResult; clause: string }> {
  const input = engineInput(answer);
  const derived = deriveMeasurementResult(input);
  if (!derived.ok)
    return invalid(
      derived.errors
        .map((e) => e.message)
        .join(" ")
        .slice(0, 500),
    );
  const rendered = renderMetricClause(derived.value);
  if (rendered.kind !== "metric-candidate")
    return err({
      code: "needs-context",
      message:
        "Only measured or explicitly attested results can enrich an achievement.",
      retryable: false,
    });
  const d = definition(answer.definitionId)!;
  const previewHash = digest(rendered.clause);
  return ok({
    clause: rendered.clause,
    result: MeasurementResultSchema.parse({
      id: "result-" + digest(JSON.stringify(answer)).slice(0, 32),
      definitionId: metricId(d.id),
      version: answer.version,
      originalValues: answer.originalValues,
      originalUnits: answer.originalUnits,
      normalizedValues: derived.value.normalizedObservations.map(
        (o) => o.value,
      ),
      normalizedUnit: derived.value.normalizedObservations[0]?.unit,
      context: { ...answer.context, statistic: answer.statistic ?? "" },
      evidenceStatus: derived.value.evidenceStatus,
      formulaVersion: derived.value.formulaVersion,
      roundingPolicy: derived.value.roundingPolicyVersion,
      derivedQuantity:
        "derived" in derived.value
          ? (derived.value.derived[0]?.value ?? null)
          : null,
      rendererId: slug(
        input.mode === "comparison"
          ? (d.comparisonRendererId ?? d.absoluteRendererId)
          : d.absoluteRendererId,
      ),
      previewHash,
      confirmed: false,
    }),
  });
}

/** Lossless DTO adapter to Task 8's deterministic engine; no provider or IO. */
export function createMeasurementPort(): MeasurementPort {
  return {
    getApplicableDefinitions({ capability, task }) {
      const ids = new Set(
        getApplicableDefinitions({
          capabilityId: capability,
          taskType: task,
        }).definitions.map((d) => metricId(d.id)),
      );
      return ok(measurementDefinitions.filter((d) => ids.has(d.id)));
    },
    validateMeasurementAnswer({ answer, expectedVersion }) {
      const parsed = MeasurementAnswerSchema.safeParse(answer);
      if (!parsed.success) return invalid("The measurement answer is invalid.");
      if (expectedVersion !== undefined && answer.version !== expectedVersion)
        return err({
          code: "version-conflict",
          message: "The measurement answer changed.",
          retryable: false,
        });
      if (
        answer.mode !== "skip" &&
        answer.mode !== "defer" &&
        !definition(answer.definitionId)
      )
        return invalid("Choose a supported metric definition.");
      const checked = validateMeasurementAnswer(engineInput(answer));
      return checked.ok
        ? ok(parsed.data)
        : invalid(
            checked.errors
              .map((e) => e.message)
              .join(" ")
              .slice(0, 500),
          );
    },
    deriveMeasurementResult({ answer }) {
      if (
        answer.mode === "skip" ||
        answer.mode === "defer" ||
        answer.mode === "target"
      )
        return ok(null);
      const result = derive(answer);
      return result.ok ? ok(result.value.result) : result;
    },
    renderMetricClause({ result }) {
      const parsed = MeasurementResultSchema.safeParse(result);
      if (!parsed.success) return invalid("The measurement result is invalid.");
      const answer: MeasurementAnswer = {
        questionId: "render-result",
        version: result.version,
        mode: "result",
        originalValues: result.originalValues,
        originalUnits: result.originalUnits,
        definitionId: result.definitionId,
        statistic:
          result.context.statistic ??
          definition(result.definitionId)?.allowedStatistics[0] ??
          null,
        context: result.context,
        sourceEvidenceIds: [],
        attestation:
          result.evidenceStatus === "none"
            ? "documented"
            : result.evidenceStatus,
        answerHash: "0".repeat(64),
      };
      const value = derive(answer);
      if (!value.ok) return value;
      if (
        value.value.result.previewHash !== result.previewHash ||
        JSON.stringify(value.value.result.normalizedValues) !==
          JSON.stringify(result.normalizedValues) ||
        value.value.result.derivedQuantity !== result.derivedQuantity ||
        value.value.result.normalizedUnit !== result.normalizedUnit
      )
        return err({
          code: "invalid-evidence",
          message: "The measurement changed after calculation.",
          retryable: false,
        });
      return ok({
        clause: value.value.clause,
        previewHash: value.value.result.previewHash,
      });
    },
  };
}
