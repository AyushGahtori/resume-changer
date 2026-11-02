import {
  METRIC_CATALOG,
  type MeasurementContext,
  type MeasurementContextField,
  type MeasurementFormulaId,
  type MeasurementMode,
  type MeasurementStatus,
  type MetricDefinition,
} from "./measurement-catalog";

export const MEASUREMENT_FORMULA_VERSION = "1.0.0" as const;
export const MEASUREMENT_ROUNDING_POLICY = {
  version: "1.0.0",
  calculationDecimalPlaces: 8,
  absoluteDisplayDecimalPlaces: 2,
  percentDisplayDecimalPlaces: 1,
  scoreDisplayDecimalPlaces: 1,
  speedupDisplayDecimalPlaces: 2,
} as const;
export const MEASUREMENT_ROUNDING_POLICY_VERSION =
  MEASUREMENT_ROUNDING_POLICY.version;

export interface MeasurementObservationInput {
  value: number;
  unit: string;
  statistic: string;
  averagingMode: string;
  context: MeasurementContext;
}

export interface MeasurementAnswerInput {
  definitionId?: string;
  mode: MeasurementMode;
  status: MeasurementStatus;
  customMetric?: {
    label?: string;
    value?: number;
    unit?: string;
    contextDescription?: string;
  };
  observation?: MeasurementObservationInput;
  baseline?: MeasurementObservationInput;
  comparison?: MeasurementObservationInput;
  evidence?: {
    sourceDescription?: string;
    evidenceIds?: readonly string[];
  };
}

export type MeasurementErrorCode =
  | "invalid-input"
  | "unsupported-definition"
  | "task-mismatch"
  | "missing-context"
  | "invalid-unit"
  | "incompatible-units"
  | "invalid-range"
  | "invalid-statistic"
  | "invalid-averaging"
  | "zero-baseline"
  | "incompatible-context"
  | "ineligible-status";

export interface MeasurementValidationError {
  code: MeasurementErrorCode;
  field: string;
  message: string;
}

export interface NormalizedObservation {
  original: MeasurementObservationInput;
  normalized: {
    value: number;
    unit: string;
    statistic: string;
    averagingMode: string;
    context: MeasurementContext;
  };
}

export interface ValidatedMeasurementAnswer {
  definition: MetricDefinition | null;
  customMeasurement?: {
    label: string;
    value: number;
    unit: string;
    contextDescription: string | null;
  };
  mode: MeasurementMode;
  status: MeasurementStatus;
  observations: readonly NormalizedObservation[];
  evidence: {
    sourceDescription: string | null;
    evidenceIds: readonly string[];
  };
}

export type ValidationOutcome =
  | { ok: true; value: ValidatedMeasurementAnswer }
  | { ok: false; errors: readonly MeasurementValidationError[] };

export interface DerivedMeasurementValue {
  formulaId: MeasurementFormulaId;
  formulaVersion: typeof MEASUREMENT_FORMULA_VERSION;
  value: number;
  unit: string;
}

interface MeasurementResultBase {
  definition: MetricDefinition | null;
  customMeasurement?: ValidatedMeasurementAnswer["customMeasurement"];
  evidenceStatus: MeasurementStatus;
  originalObservations: readonly MeasurementObservationInput[];
  normalizedObservations: readonly NormalizedObservation["normalized"][];
  evidence: ValidatedMeasurementAnswer["evidence"];
  formulaVersion: typeof MEASUREMENT_FORMULA_VERSION;
  roundingPolicyVersion: typeof MEASUREMENT_ROUNDING_POLICY_VERSION;
  limitations: readonly string[];
}

export type MeasurementResult =
  | (MeasurementResultBase & {
      kind: "measurement";
      evidenceStatus: "measured" | "user-attested";
      derived: readonly DerivedMeasurementValue[];
    })
  | (MeasurementResultBase & {
      kind: "documented";
      evidenceStatus: "documented";
      derived: readonly DerivedMeasurementValue[];
    })
  | (MeasurementResultBase & {
      kind: "custom-review";
      evidenceStatus: "measured" | "user-attested" | "documented";
      derived: readonly [];
    })
  | (MeasurementResultBase & {
      kind: "target";
      evidenceStatus: "target";
      derived: readonly [];
    })
  | (MeasurementResultBase & {
      kind: "estimate";
      evidenceStatus: "estimate";
      derived: readonly [];
    })
  | (MeasurementResultBase & {
      kind: "qualitative";
      evidenceStatus: "no-result";
      derived: readonly [];
    });

export type DerivationOutcome =
  | { ok: true; value: MeasurementResult }
  | { ok: false; errors: readonly MeasurementValidationError[] };

export interface MetricDraft {
  label: string;
  value: string;
  unit?: string;
  context: string;
  evidence: string;
}

export type RenderedMetricClause =
  | { kind: "metric-candidate"; clause: string; metricDraft: MetricDraft }
  | {
      kind: "review-note";
      clause: string;
      evidenceStatus:
        "measured" | "user-attested" | "documented" | "target" | "estimate";
    }
  | { kind: "qualitative"; clause: null; evidenceStatus: "no-result" };

interface UnitDefinition {
  dimension:
    | "duration"
    | "fraction"
    | "requests-rate"
    | "operations-rate"
    | "records-rate"
    | "length"
    | "mass";
  canonicalUnit: string;
  factor: number;
}

const unitDefinitions: Readonly<Record<string, UnitDefinition>> = {
  ms: { dimension: "duration", canonicalUnit: "ms", factor: 1 },
  millisecond: { dimension: "duration", canonicalUnit: "ms", factor: 1 },
  milliseconds: { dimension: "duration", canonicalUnit: "ms", factor: 1 },
  s: { dimension: "duration", canonicalUnit: "ms", factor: 1000 },
  sec: { dimension: "duration", canonicalUnit: "ms", factor: 1000 },
  second: { dimension: "duration", canonicalUnit: "ms", factor: 1000 },
  seconds: { dimension: "duration", canonicalUnit: "ms", factor: 1000 },
  us: { dimension: "duration", canonicalUnit: "ms", factor: 0.001 },
  µs: { dimension: "duration", canonicalUnit: "ms", factor: 0.001 },
  μs: { dimension: "duration", canonicalUnit: "ms", factor: 0.001 },
  fraction: { dimension: "fraction", canonicalUnit: "fraction", factor: 1 },
  ratio: { dimension: "fraction", canonicalUnit: "fraction", factor: 1 },
  "%": { dimension: "fraction", canonicalUnit: "fraction", factor: 0.01 },
  percent: { dimension: "fraction", canonicalUnit: "fraction", factor: 0.01 },
  "requests/s": {
    dimension: "requests-rate",
    canonicalUnit: "requests/s",
    factor: 1,
  },
  "req/s": {
    dimension: "requests-rate",
    canonicalUnit: "requests/s",
    factor: 1,
  },
  "requests/min": {
    dimension: "requests-rate",
    canonicalUnit: "requests/s",
    factor: 1 / 60,
  },
  "operations/s": {
    dimension: "operations-rate",
    canonicalUnit: "operations/s",
    factor: 1,
  },
  "records/s": {
    dimension: "records-rate",
    canonicalUnit: "records/s",
    factor: 1,
  },
  m: { dimension: "length", canonicalUnit: "m", factor: 1 },
  meter: { dimension: "length", canonicalUnit: "m", factor: 1 },
  meters: { dimension: "length", canonicalUnit: "m", factor: 1 },
  km: { dimension: "length", canonicalUnit: "m", factor: 1000 },
  cm: { dimension: "length", canonicalUnit: "m", factor: 0.01 },
  mm: { dimension: "length", canonicalUnit: "m", factor: 0.001 },
  kg: { dimension: "mass", canonicalUnit: "kg", factor: 1 },
  g: { dimension: "mass", canonicalUnit: "kg", factor: 0.001 },
};

const zeroBaselineFormulaIds = new Set<MeasurementFormulaId>([
  "latency-reduction-percent",
  "speedup-factor",
  "throughput-gain-percent",
  "runtime-reduction-percent",
  "error-reduction-percent",
]);

export function validateMeasurementAnswer(input: unknown): ValidationOutcome {
  const errors: MeasurementValidationError[] = [];
  if (!isRecord(input)) {
    return failure(
      "invalid-input",
      "answer",
      "Provide a measurement answer object.",
    );
  }

  const mode = input.mode;
  const status = input.status;
  if (!isMeasurementMode(mode) || !isMeasurementStatus(status)) {
    return failure(
      "invalid-input",
      "mode",
      "Choose a supported measurement answer type.",
    );
  }

  if (mode === "skip") {
    if (status !== "no-result") {
      return failure(
        "ineligible-status",
        "status",
        "A skipped measurement must have no-result status.",
      );
    }
    if (
      input.observation !== undefined ||
      input.baseline !== undefined ||
      input.comparison !== undefined
    ) {
      return failure(
        "invalid-input",
        "observation",
        "A qualitative skip cannot include numeric results.",
      );
    }
    return {
      ok: true,
      value: {
        definition: null,
        mode,
        status,
        observations: [],
        evidence: normalizeEvidence(input.evidence),
      },
    };
  }

  const definitionId = readNonEmptyString(input.definitionId);
  if (definitionId === "custom.v1") {
    return validateCustomMeasurement(input, mode, status);
  }
  const definition = METRIC_CATALOG.find((item) => item.id === definitionId);
  if (!definition) {
    return failure(
      "unsupported-definition",
      "definitionId",
      "Choose a supported metric definition; unsupported metrics need a custom review.",
    );
  }

  if (!statusMatchesMode(mode, status)) {
    return failure(
      "ineligible-status",
      "status",
      "Use measured, user-attested, documented, target, estimate, or no-result only with its matching answer type.",
    );
  }

  const evidence = normalizeEvidence(input.evidence);
  if (
    (status === "measured" ||
      status === "user-attested" ||
      status === "documented") &&
    !evidence.sourceDescription
  ) {
    errors.push({
      code: "missing-context",
      field: "evidence.sourceDescription",
      message: "Describe where the result came from or how it was measured.",
    });
  }

  const observations: NormalizedObservation[] = [];
  if (mode === "comparison") {
    if (
      input.observation !== undefined ||
      !isRecord(input.baseline) ||
      !isRecord(input.comparison)
    ) {
      return failure(
        "invalid-input",
        "comparison",
        "A comparison needs both a baseline and a comparison observation.",
      );
    }
    const baseline = normalizeObservation(
      input.baseline,
      definition,
      "baseline",
    );
    const comparison = normalizeObservation(
      input.comparison,
      definition,
      "comparison",
    );
    errors.push(...baseline.errors, ...comparison.errors);
    if (!baseline.value || !comparison.value) {
      return { ok: false, errors };
    }
    validateComparisonCompatibility(
      baseline.value,
      comparison.value,
      definition,
      errors,
    );
    if (
      definition.formulaIds.some((formulaId) =>
        zeroBaselineFormulaIds.has(formulaId),
      ) &&
      baseline.value.normalized.value === 0
    ) {
      errors.push({
        code: "zero-baseline",
        field: "baseline.value",
        message: "This comparison formula needs a non-zero baseline.",
      });
    }
    if (errors.length > 0) return { ok: false, errors };
    observations.push(baseline.value, comparison.value);
  } else {
    if (
      input.baseline !== undefined ||
      input.comparison !== undefined ||
      !isRecord(input.observation)
    ) {
      return failure(
        "invalid-input",
        "observation",
        "Provide one observation for an absolute result, target, or estimate.",
      );
    }
    const observation = normalizeObservation(
      input.observation,
      definition,
      "observation",
    );
    errors.push(...observation.errors);
    if (!observation.value || errors.length > 0) return { ok: false, errors };
    observations.push(observation.value);
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { definition, mode, status, observations, evidence },
  };
}

export function deriveMeasurementResult(input: unknown): DerivationOutcome {
  const validated = validateMeasurementAnswer(input);
  if (!validated.ok) return validated;

  const answer = validated.value;
  const base: MeasurementResultBase = {
    definition: answer.definition,
    customMeasurement: answer.customMeasurement,
    evidenceStatus: answer.status,
    originalObservations: answer.observations.map((item) => item.original),
    normalizedObservations: answer.observations.map((item) => item.normalized),
    evidence: answer.evidence,
    formulaVersion: MEASUREMENT_FORMULA_VERSION,
    roundingPolicyVersion: MEASUREMENT_ROUNDING_POLICY_VERSION,
    limitations: buildLimitations(answer),
  };

  if (answer.mode === "skip") {
    return {
      ok: true,
      value: {
        ...base,
        kind: "qualitative",
        evidenceStatus: "no-result",
        derived: [],
      },
    };
  }

  if (answer.customMeasurement) {
    return {
      ok: true,
      value: {
        ...base,
        kind: "custom-review",
        evidenceStatus: answer.status as
          "measured" | "user-attested" | "documented",
        derived: [],
      },
    };
  }

  if (answer.mode === "target") {
    return {
      ok: true,
      value: { ...base, kind: "target", evidenceStatus: "target", derived: [] },
    };
  }

  if (answer.mode === "estimate") {
    return {
      ok: true,
      value: {
        ...base,
        kind: "estimate",
        evidenceStatus: "estimate",
        derived: [],
      },
    };
  }

  const derived = deriveValues(answer);
  if (!derived.ok) return derived;
  if (answer.status === "documented") {
    return {
      ok: true,
      value: {
        ...base,
        kind: "documented",
        evidenceStatus: "documented",
        derived: derived.value,
      },
    };
  }
  if (answer.status !== "measured" && answer.status !== "user-attested") {
    return failure(
      "ineligible-status",
      "status",
      "Only measured or user-attested values can form an achievement metric candidate.",
    );
  }
  return {
    ok: true,
    value: {
      ...base,
      kind: "measurement",
      evidenceStatus: answer.status,
      derived: derived.value,
    },
  };
}

export function renderMetricClause(
  result: MeasurementResult,
): RenderedMetricClause {
  if (result.kind === "qualitative") {
    return { kind: "qualitative", clause: null, evidenceStatus: "no-result" };
  }

  if (result.kind === "custom-review") {
    const custom = result.customMeasurement;
    if (!custom) {
      return {
        kind: "review-note",
        clause: "Custom measurement needs manual review before use.",
        evidenceStatus: result.evidenceStatus,
      };
    }
    const context = custom.contextDescription
      ? ` Context: ${custom.contextDescription}.`
      : "";
    return {
      kind: "review-note",
      evidenceStatus: result.evidenceStatus,
      clause: `Custom measurement submitted for manual review: ${custom.label}, ${formatNumber(custom.value, MEASUREMENT_ROUNDING_POLICY.absoluteDisplayDecimalPlaces)} ${custom.unit}. No automatic conversion, comparison formula, or achievement wording is applied.${context}`,
    };
  }

  const definition = result.definition;
  if (!definition) {
    return {
      kind: "review-note",
      clause:
        "No metric definition is attached; review this entry as qualitative context.",
      evidenceStatus: "documented",
    };
  }

  if (result.kind === "target" || result.kind === "estimate") {
    const observation = result.normalizedObservations[0];
    return {
      kind: "review-note",
      evidenceStatus: result.evidenceStatus,
      clause: `${result.kind === "target" ? "Future target" : "Estimate only"} (not a measured result): ${definition.label} of ${displayObservationValue(observation.value, observation.unit, definition)}.`,
    };
  }

  const clause = buildClause(result);
  if (result.kind === "documented") {
    return {
      kind: "review-note",
      evidenceStatus: "documented",
      clause: `Documentation reports ${clause.toLowerCase()} (unverified; not an independently measured result).`,
    };
  }

  const metricDraft = buildMetricDraft(result);
  return { kind: "metric-candidate", clause, metricDraft };
}

function validateCustomMeasurement(
  input: Record<string, unknown>,
  mode: MeasurementMode,
  status: MeasurementStatus,
): ValidationOutcome {
  if (
    mode !== "absolute" ||
    !["measured", "user-attested", "documented"].includes(status)
  ) {
    return failure(
      "ineligible-status",
      "mode",
      "Custom measurements support absolute values for manual review only; targets, estimates, and comparisons need a supported definition.",
    );
  }
  if (
    input.observation !== undefined ||
    input.baseline !== undefined ||
    input.comparison !== undefined
  ) {
    return failure(
      "invalid-input",
      "observation",
      "Provide custom values in the custom metric fields only.",
    );
  }

  const errors: MeasurementValidationError[] = [];
  const custom = isRecord(input.customMetric) ? input.customMetric : {};
  const label = readNonEmptyString(custom.label);
  const unit = readNonEmptyString(custom.unit);
  const value = custom.value;
  const contextDescription = readNonEmptyString(custom.contextDescription);
  const evidence = normalizeEvidence(input.evidence);
  if (!label || label.length > 120) {
    errors.push({
      code: "invalid-input",
      field: "customMetric.label",
      message: "Enter a custom metric label of 120 characters or fewer.",
    });
  }
  if (!unit || unit.length > 40) {
    errors.push({
      code: "invalid-unit",
      field: "customMetric.unit",
      message: "Enter a custom unit of 40 characters or fewer.",
    });
  }
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > 1_000_000_000_000
  ) {
    errors.push({
      code: "invalid-range",
      field: "customMetric.value",
      message: "Enter a finite custom value within ±1,000,000,000,000.",
    });
  }
  if (
    custom.contextDescription !== undefined &&
    (!contextDescription || contextDescription.length > 300)
  ) {
    errors.push({
      code: "invalid-input",
      field: "customMetric.contextDescription",
      message: "Custom context must be 300 characters or fewer.",
    });
  }
  if (!evidence.sourceDescription) {
    errors.push({
      code: "missing-context",
      field: "evidence.sourceDescription",
      message:
        "Describe where the custom result came from or how it was measured.",
    });
  }
  if (errors.length > 0 || !label || !unit || typeof value !== "number") {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      definition: null,
      customMeasurement: {
        label,
        value,
        unit,
        contextDescription,
      },
      mode,
      status,
      observations: [],
      evidence,
    },
  };
}

function normalizeObservation(
  input: Record<string, unknown>,
  definition: MetricDefinition,
  fieldPrefix: string,
): {
  value: NormalizedObservation | null;
  errors: MeasurementValidationError[];
} {
  const errors: MeasurementValidationError[] = [];
  const value = input.value;
  const unit = readNonEmptyString(input.unit);
  const statistic = readNonEmptyString(input.statistic);
  const averagingMode = readNonEmptyString(input.averagingMode);
  const context = normalizeContext(input.context);

  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push({
      code: "invalid-input",
      field: `${fieldPrefix}.value`,
      message: "Enter a finite numeric value.",
    });
  }
  if (!unit) {
    errors.push({
      code: "invalid-unit",
      field: `${fieldPrefix}.unit`,
      message: "Choose an explicit measurement unit.",
    });
  }
  if (
    !statistic ||
    !definition.allowedStatistics.some((allowed) => allowed === statistic)
  ) {
    errors.push({
      code: "invalid-statistic",
      field: `${fieldPrefix}.statistic`,
      message: `Choose a statistic supported by ${definition.label}.`,
    });
  }
  if (
    !averagingMode ||
    !definition.allowedAveragingModes.some(
      (allowed) => allowed === averagingMode,
    )
  ) {
    errors.push({
      code: "invalid-averaging",
      field: `${fieldPrefix}.averagingMode`,
      message: `Choose an averaging method supported by ${definition.label}.`,
    });
  }

  const unitInfo = unit ? resolveUnit(unit, definition, context) : null;
  if (unit && !unitInfo) {
    errors.push({
      code: "invalid-unit",
      field: `${fieldPrefix}.unit`,
      message: `The unit is not supported for ${definition.label}.`,
    });
  }

  errors.push(...validateRequiredContext(context, definition, fieldPrefix));
  const taskType = normalizeIdentifier(context.taskType);
  if (
    taskType &&
    !definition.taskTypes.some(
      (candidate) => normalizeIdentifier(candidate) === taskType,
    )
  ) {
    errors.push({
      code: "task-mismatch",
      field: `${fieldPrefix}.context.taskType`,
      message: `This definition does not apply to the ${context.taskType} task type.`,
    });
  }
  const capabilityId = normalizeIdentifier(context.capabilityId);
  if (
    capabilityId &&
    !definition.capabilityIds.some(
      (candidate) => normalizeIdentifier(candidate) === capabilityId,
    )
  ) {
    errors.push({
      code: "task-mismatch",
      field: `${fieldPrefix}.context.capabilityId`,
      message: `This definition does not apply to the ${context.capabilityId} capability.`,
    });
  }

  if (typeof value === "number" && Number.isFinite(value) && unitInfo) {
    const normalizedValue = value * unitInfo.factor;
    if (
      !Number.isFinite(normalizedValue) ||
      normalizedValue < definition.validRange.min ||
      normalizedValue > definition.validRange.max
    ) {
      errors.push({
        code: "invalid-range",
        field: `${fieldPrefix}.value`,
        message: `The normalized value must be between ${definition.validRange.min} and ${definition.validRange.max} ${unitInfo.canonicalUnit}.`,
      });
    }
    if (errors.length === 0 && statistic && averagingMode && unit) {
      return {
        value: {
          original: {
            value: value as number,
            unit: typeof input.unit === "string" ? input.unit : unit,
            statistic:
              typeof input.statistic === "string" ? input.statistic : statistic,
            averagingMode:
              typeof input.averagingMode === "string"
                ? input.averagingMode
                : averagingMode,
            context: { ...context },
          },
          normalized: {
            value: normalizedValue,
            unit: unitInfo.canonicalUnit,
            statistic,
            averagingMode,
            context,
          },
        },
        errors,
      };
    }
  }

  return { value: null, errors };
}

function resolveUnit(
  unit: string,
  definition: MetricDefinition,
  context: MeasurementContext,
): UnitDefinition | null {
  const normalizedUnit = normalizeUnit(unit);
  const info = unitDefinitions[normalizedUnit];
  if (!info) return null;
  if (definition.unitDimension !== "contextual") {
    if (info.dimension !== definition.unitDimension) return null;
    const allowed = definition.allowedUnits.map(normalizeUnit);
    if (!allowed.includes(normalizedUnit)) return null;
    return info;
  }

  const targetUnit = context.targetUnit
    ? unitDefinitions[normalizeUnit(context.targetUnit)]
    : null;
  if (!targetUnit || targetUnit.dimension !== info.dimension) return null;
  return info;
}

function validateRequiredContext(
  context: MeasurementContext,
  definition: MetricDefinition,
  prefix: string,
): MeasurementValidationError[] {
  const errors: MeasurementValidationError[] = [];
  for (const field of definition.requiredContextFields) {
    const value = context[field];
    if (
      typeof value === "string"
        ? value.trim().length === 0
        : typeof value !== "number" || !Number.isFinite(value)
    ) {
      errors.push({
        code: "missing-context",
        field: `${prefix}.context.${field}`,
        message: `Provide ${contextFieldLabel(field)} to interpret this measurement.`,
      });
    }
  }
  if (
    context.evaluationSplit !== undefined &&
    ![
      "training",
      "validation",
      "test",
      "held-out",
      "cross-validation",
    ].includes(context.evaluationSplit)
  ) {
    errors.push({
      code: "invalid-input",
      field: `${prefix}.context.evaluationSplit`,
      message:
        "Choose a supported evaluation split and keep its meaning explicit.",
    });
  }
  if (
    context.sampleCount !== undefined &&
    (!Number.isInteger(context.sampleCount) || context.sampleCount <= 0)
  ) {
    errors.push({
      code: "invalid-range",
      field: `${prefix}.context.sampleCount`,
      message: "Sample count must be a positive whole number.",
    });
  }
  for (const [field, value] of Object.entries(context)) {
    if (typeof value === "string" && value.length > 300) {
      errors.push({
        code: "invalid-input",
        field: `${prefix}.context.${field}`,
        message: "Context fields must be 300 characters or fewer.",
      });
    }
  }
  return errors;
}

function validateComparisonCompatibility(
  baseline: NormalizedObservation,
  comparison: NormalizedObservation,
  definition: MetricDefinition,
  errors: MeasurementValidationError[],
): void {
  if (baseline.normalized.unit !== comparison.normalized.unit) {
    errors.push({
      code: "incompatible-units",
      field: "comparison.unit",
      message: "Baseline and comparison values must use compatible units.",
    });
  }
  if (baseline.normalized.statistic !== comparison.normalized.statistic) {
    errors.push({
      code: "incompatible-context",
      field: "comparison.statistic",
      message:
        "Use the same statistic for both measurements, such as p95 compared with p95.",
    });
  }
  if (
    baseline.normalized.averagingMode !== comparison.normalized.averagingMode
  ) {
    errors.push({
      code: "incompatible-context",
      field: "comparison.averagingMode",
      message: "Use the same averaging method for both measurements.",
    });
  }

  for (const field of definition.requiredContextFields) {
    if (
      !sameContextValue(
        baseline.normalized.context[field],
        comparison.normalized.context[field],
      )
    ) {
      errors.push({
        code: "incompatible-context",
        field: `comparison.context.${field}`,
        message: `Baseline and comparison must use the same ${contextFieldLabel(field)}.`,
      });
    }
  }
}

function deriveValues(
  answer: ValidatedMeasurementAnswer,
):
  | { ok: true; value: readonly DerivedMeasurementValue[] }
  | { ok: false; errors: readonly MeasurementValidationError[] } {
  const definition = answer.definition;
  if (
    !definition ||
    answer.mode === "skip" ||
    answer.mode === "target" ||
    answer.mode === "estimate"
  ) {
    return { ok: true, value: [] };
  }
  if (answer.mode === "absolute") return { ok: true, value: [] };

  const baseline = answer.observations[0]?.normalized.value;
  const comparison = answer.observations[1]?.normalized.value;
  if (baseline === undefined || comparison === undefined) {
    return failure(
      "invalid-input",
      "comparison",
      "Both comparison values are required.",
    );
  }

  const formulas: Record<MeasurementFormulaId, number> = {
    "latency-reduction-percent": ((baseline - comparison) / baseline) * 100,
    "speedup-factor": baseline / comparison,
    "throughput-gain-percent": ((comparison - baseline) / baseline) * 100,
    "percentage-point-difference": (comparison - baseline) * 100,
    "runtime-reduction-percent": ((baseline - comparison) / baseline) * 100,
    "error-reduction-percent": ((baseline - comparison) / baseline) * 100,
  };
  const unitForFormula: Record<MeasurementFormulaId, string> = {
    "latency-reduction-percent": "%",
    "speedup-factor": "×",
    "throughput-gain-percent": "%",
    "percentage-point-difference": "percentage points",
    "runtime-reduction-percent": "%",
    "error-reduction-percent": "%",
  };

  const values = definition.formulaIds.map((formulaId) => ({
    formulaId,
    formulaVersion: MEASUREMENT_FORMULA_VERSION,
    value: roundCalculation(formulas[formulaId]),
    unit: unitForFormula[formulaId],
  }));
  const invalid = values.find((item) => !Number.isFinite(item.value));
  if (invalid) {
    return failure(
      "zero-baseline",
      "comparison.value",
      `The ${invalid.formulaId} formula needs non-zero values.`,
    );
  }
  return { ok: true, value: values };
}

function buildLimitations(
  answer: ValidatedMeasurementAnswer,
): readonly string[] {
  const limitations: string[] = [];
  if (
    answer.observations.some(
      (item) => item.normalized.context.evaluationSplit === "training",
    )
  ) {
    limitations.push(
      "Training evaluation does not establish held-out performance.",
    );
  }
  if (answer.status === "documented") {
    limitations.push(
      "A documented statement is unverified until supported by a measurement and reviewed by the user.",
    );
  }
  if (answer.status === "user-attested") {
    limitations.push("User-attested context is not independently verified.");
  }
  if (answer.status === "estimate") {
    limitations.push(
      "An estimate is not a measured result and cannot become an achievement metric.",
    );
  }
  if (answer.status === "target") {
    limitations.push(
      "A target is a future goal and cannot become an achievement metric.",
    );
  }
  return limitations;
}

function buildClause(
  result: Extract<MeasurementResult, { kind: "measurement" | "documented" }>,
): string {
  const definition = result.definition;
  if (!definition) return "No supported metric definition is available.";
  const normalized = result.normalizedObservations;
  let valueText = "";
  if (normalized.length === 1) {
    const observation = normalized[0];
    valueText = `${definition.label}: ${displayObservationValue(observation.value, observation.unit, definition)}`;
  } else {
    const primary = result.derived.find(
      (item) => item.formulaId !== "speedup-factor",
    );
    const baseline = normalized[0];
    const comparison = normalized[1];
    if (primary) {
      const magnitude = Math.abs(primary.value);
      const change =
        primary.formulaId === "percentage-point-difference"
          ? `${formatNumber(magnitude, MEASUREMENT_ROUNDING_POLICY.percentDisplayDecimalPlaces)} percentage points`
          : `${formatNumber(magnitude, MEASUREMENT_ROUNDING_POLICY.percentDisplayDecimalPlaces)}%`;
      const verb =
        primary.value === 0
          ? ""
          : definition.direction === "lower-is-better"
            ? primary.value > 0
              ? "decreased"
              : "increased"
            : primary.value > 0
              ? "increased"
              : "decreased";
      valueText =
        primary.value === 0
          ? `${definition.label} was unchanged (${displayObservationValue(baseline.value, baseline.unit, definition)} to ${displayObservationValue(comparison.value, comparison.unit, definition)})`
          : `${definition.label} ${verb} by ${change} (${displayObservationValue(baseline.value, baseline.unit, definition)} to ${displayObservationValue(comparison.value, comparison.unit, definition)})`;
    }
  }

  const lastObservation = normalized[normalized.length - 1];
  const qualifiers = contextQualifiers(
    lastObservation?.context ?? {},
    lastObservation,
  );
  const statusPrefix =
    result.evidenceStatus === "measured"
      ? "Measured"
      : result.evidenceStatus === "user-attested"
        ? "User-attested"
        : "";
  const prefix = statusPrefix ? `${statusPrefix} ` : "";
  return `${prefix}${valueText}${qualifiers ? `; ${qualifiers}` : ""}.`;
}

function buildMetricDraft(
  result: Extract<MeasurementResult, { kind: "measurement" }>,
): MetricDraft {
  const definition = result.definition;
  const normalized = result.normalizedObservations;
  const primaryDerived = result.derived.find(
    (item) => item.formulaId !== "speedup-factor",
  );
  const observation = normalized[0];
  const isFraction =
    !primaryDerived && definition?.unitDimension === "fraction";
  const measurementValue = primaryDerived
    ? round(
        primaryDerived.value,
        MEASUREMENT_ROUNDING_POLICY.percentDisplayDecimalPlaces,
      )
    : round(
        isFraction ? observation.value * 100 : observation.value,
        isFraction
          ? MEASUREMENT_ROUNDING_POLICY.scoreDisplayDecimalPlaces
          : MEASUREMENT_ROUNDING_POLICY.absoluteDisplayDecimalPlaces,
      );
  const metricUnit =
    primaryDerived?.unit ?? (isFraction ? "%" : observation.unit);
  const lastObservation = normalized[normalized.length - 1];
  const contexts = contextQualifiers(
    lastObservation?.context ?? {},
    lastObservation,
  );
  const originals = result.originalObservations
    .map((observation) => `${observation.value} ${observation.unit}`)
    .join(" → ");
  const formulaDetails =
    result.derived.length > 0
      ? ` Formula: ${result.derived.map((item) => `${item.formulaId}@${item.formulaVersion}=${item.value} ${item.unit}`).join(", ")}. Rounding policy: ${result.roundingPolicyVersion}.`
      : ` Rounding policy: ${result.roundingPolicyVersion}.`;
  const source = result.evidence.sourceDescription
    ? ` Source: ${result.evidence.sourceDescription}.`
    : "";
  const evidenceIds =
    result.evidence.evidenceIds.length > 0
      ? ` Evidence IDs: ${result.evidence.evidenceIds.join(", ")}.`
      : "";
  const limitations =
    result.limitations.length > 0
      ? ` Limits: ${result.limitations.join(" ")}`
      : "";

  return {
    label: primaryDerived
      ? `${definition?.label ?? "Metric"} change`
      : (definition?.label ?? "Metric"),
    value: formatNumber(
      measurementValue,
      primaryDerived
        ? MEASUREMENT_ROUNDING_POLICY.percentDisplayDecimalPlaces
        : isFraction
          ? MEASUREMENT_ROUNDING_POLICY.scoreDisplayDecimalPlaces
          : MEASUREMENT_ROUNDING_POLICY.absoluteDisplayDecimalPlaces,
    ),
    unit: metricUnit,
    context: contexts || "Measurement context recorded.",
    evidence: `${result.evidenceStatus}; definition ${definition?.id}@${definition?.version}; original value(s): ${originals}.${formulaDetails}${source}${evidenceIds}${limitations}`,
  };
}

function contextQualifiers(
  context: MeasurementContext,
  observation?: NormalizedObservation["normalized"],
): string {
  const parts: string[] = [];
  if (context.startEvent && context.endEvent)
    parts.push(`timing ${context.startEvent} to ${context.endEvent}`);
  if (context.endpoint) parts.push(`endpoint ${context.endpoint}`);
  if (context.workload) parts.push(`workload ${context.workload}`);
  if (context.dataset) {
    const version = context.datasetVersion ? ` ${context.datasetVersion}` : "";
    const split = context.evaluationSplit
      ? `, ${context.evaluationSplit} split`
      : "";
    parts.push(`dataset ${context.dataset}${version}${split}`);
  }
  if (context.positiveClass)
    parts.push(`positive class ${context.positiveClass}`);
  if (context.targetUnit) parts.push(`target unit ${context.targetUnit}`);
  if (context.taskDescription) parts.push(`task ${context.taskDescription}`);
  if (context.environment) parts.push(`environment ${context.environment}`);
  if (context.observationWindow)
    parts.push(`window ${context.observationWindow}`);
  if (context.observationPeriod)
    parts.push(`period ${context.observationPeriod}`);
  if (context.sampleCount !== undefined)
    parts.push(`${context.sampleCount} samples`);
  if (context.toolVersion) parts.push(`tool ${context.toolVersion}`);
  if (context.revision) parts.push(`revision ${context.revision}`);
  if (
    observation?.statistic &&
    !["single-evaluation", "rate-over-window", "p95"].includes(
      observation.statistic,
    )
  ) {
    parts.push(`statistic ${observation.statistic}`);
  }
  if (observation?.averagingMode && observation.averagingMode !== "none") {
    parts.push(`${observation.averagingMode} aggregation`);
  }
  return parts.join("; ");
}

function displayObservationValue(
  value: number,
  unit: string,
  definition: MetricDefinition,
): string {
  if (definition.unitDimension === "fraction") {
    return `${formatNumber(value * 100, MEASUREMENT_ROUNDING_POLICY.scoreDisplayDecimalPlaces)}%`;
  }
  return `${formatNumber(value, MEASUREMENT_ROUNDING_POLICY.absoluteDisplayDecimalPlaces)} ${unit}`;
}

function normalizeContext(value: unknown): MeasurementContext {
  if (!isRecord(value)) return {};
  const result: Record<string, string | number> = {};
  const stringFields: readonly MeasurementContextField[] = [
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
  ];
  for (const field of stringFields) {
    if (typeof value[field] === "string") result[field] = value[field].trim();
  }
  if (typeof value.sampleCount === "number")
    result.sampleCount = value.sampleCount;
  return result as MeasurementContext;
}

function normalizeEvidence(
  value: unknown,
): ValidatedMeasurementAnswer["evidence"] {
  if (!isRecord(value)) return { sourceDescription: null, evidenceIds: [] };
  const sourceDescription = readNonEmptyString(value.sourceDescription);
  const evidenceIds = Array.isArray(value.evidenceIds)
    ? value.evidenceIds.filter(
        (item): item is string =>
          typeof item === "string" &&
          item.trim().length > 0 &&
          item.length <= 200,
      )
    : [];
  return {
    sourceDescription:
      sourceDescription && sourceDescription.length <= 500
        ? sourceDescription
        : null,
    evidenceIds,
  };
}

function sameContextValue(left: unknown, right: unknown): boolean {
  if (typeof left === "string" && typeof right === "string") {
    return normalizeIdentifier(left) === normalizeIdentifier(right);
  }
  return left === right;
}

function contextFieldLabel(field: MeasurementContextField): string {
  return field.replace(/([A-Z])/g, " $1").toLowerCase();
}

function statusMatchesMode(
  mode: MeasurementMode,
  status: MeasurementStatus,
): boolean {
  if (mode === "absolute" || mode === "comparison") {
    return (
      status === "measured" ||
      status === "user-attested" ||
      status === "documented"
    );
  }
  if (mode === "target") return status === "target";
  if (mode === "estimate") return status === "estimate";
  return status === "no-result";
}

function formatNumber(value: number, digits: number): string {
  return formatRounded(round(value, digits));
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

function roundCalculation(value: number): number {
  return Number(
    value.toFixed(MEASUREMENT_ROUNDING_POLICY.calculationDecimalPlaces),
  );
}

function formatRounded(value: number): string {
  return Object.is(value, -0) ? "0" : String(value);
}

function normalizeUnit(unit: string): string {
  return unit.trim().toLowerCase().replace(/\s+/g, "");
}

function normalizeIdentifier(value: string | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMeasurementMode(value: unknown): value is MeasurementMode {
  return (
    value === "absolute" ||
    value === "comparison" ||
    value === "target" ||
    value === "estimate" ||
    value === "skip"
  );
}

function isMeasurementStatus(value: unknown): value is MeasurementStatus {
  return (
    value === "measured" ||
    value === "user-attested" ||
    value === "documented" ||
    value === "target" ||
    value === "estimate" ||
    value === "no-result"
  );
}

function failure(
  code: MeasurementErrorCode,
  field: string,
  message: string,
): { ok: false; errors: readonly MeasurementValidationError[] } {
  return { ok: false, errors: [{ code, field, message }] };
}
