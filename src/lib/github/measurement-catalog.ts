export const MEASUREMENT_CATALOG_VERSION = "1.0.0" as const;

export type MeasurementStatus =
  | "measured"
  | "user-attested"
  | "documented"
  | "target"
  | "estimate"
  | "no-result";

export type MeasurementMode =
  "absolute" | "comparison" | "target" | "estimate" | "skip";

export type MetricDirection = "lower-is-better" | "higher-is-better";
export type MetricStatistic =
  "p50" | "p95" | "single-evaluation" | "rate-over-window" | "mean";
export type MetricAveragingMode =
  | "none"
  | "sample-weighted"
  | "macro"
  | "binary-positive-class"
  | "mean"
  | "median";

export type MeasurementContextField =
  | "capabilityId"
  | "taskType"
  | "startEvent"
  | "endEvent"
  | "endpoint"
  | "workload"
  | "environment"
  | "observationWindow"
  | "dataset"
  | "datasetVersion"
  | "evaluationSplit"
  | "positiveClass"
  | "targetUnit"
  | "taskDescription"
  | "observationPeriod"
  | "sampleCount"
  | "toolVersion"
  | "revision";

export interface MeasurementContext {
  capabilityId?: string;
  taskType?: string;
  startEvent?: string;
  endEvent?: string;
  endpoint?: string;
  workload?: string;
  environment?: string;
  observationWindow?: string;
  dataset?: string;
  datasetVersion?: string;
  evaluationSplit?:
    "training" | "validation" | "test" | "held-out" | "cross-validation";
  positiveClass?: string;
  targetUnit?: string;
  taskDescription?: string;
  observationPeriod?: string;
  sampleCount?: number;
  toolVersion?: string;
  revision?: string;
}

export type MeasurementUnitDimension =
  "duration" | "fraction" | "requests-rate" | "contextual";

export type MeasurementFormulaId =
  | "latency-reduction-percent"
  | "speedup-factor"
  | "throughput-gain-percent"
  | "percentage-point-difference"
  | "runtime-reduction-percent"
  | "error-reduction-percent";

export interface MetricDefinition {
  readonly id: string;
  readonly version: "1.0.0";
  readonly label: string;
  readonly explanation: string;
  readonly capabilityIds: readonly string[];
  readonly taskTypes: readonly string[];
  readonly quantityKind: "duration" | "rate" | "score" | "error";
  readonly unitDimension: MeasurementUnitDimension;
  readonly allowedUnits: readonly string[];
  readonly canonicalUnit: string | null;
  readonly validRange: { readonly min: number; readonly max: number };
  readonly direction: MetricDirection;
  readonly allowedStatistics: readonly MetricStatistic[];
  readonly allowedAveragingModes: readonly MetricAveragingMode[];
  readonly requiredContextFields: readonly MeasurementContextField[];
  readonly absoluteRendererId: string;
  readonly comparisonRendererId?: string;
  readonly formulaIds: readonly MeasurementFormulaId[];
  readonly recipeIds: readonly string[];
}

const definitions = [
  {
    id: "web.publish-latency.p95",
    version: "1.0.0",
    label: "p95 publishing latency",
    explanation:
      "Time from the stated publishing start event to confirmation, at the 95th percentile.",
    capabilityIds: ["web-publishing"],
    taskTypes: ["web-publishing"],
    quantityKind: "duration",
    unitDimension: "duration",
    allowedUnits: ["ms", "s", "us"],
    canonicalUnit: "ms",
    validRange: { min: 0.001, max: 86_400_000 },
    direction: "lower-is-better",
    allowedStatistics: ["p95"],
    allowedAveragingModes: ["none"],
    requiredContextFields: [
      "taskType",
      "startEvent",
      "endEvent",
      "workload",
      "environment",
    ],
    absoluteRendererId: "duration-absolute.v1",
    comparisonRendererId: "duration-comparison.v1",
    formulaIds: ["latency-reduction-percent", "speedup-factor"],
    recipeIds: ["web-publishing-latency.v1"],
  },
  {
    id: "web.api-latency.p95",
    version: "1.0.0",
    label: "p95 API latency",
    explanation:
      "Time spent by the named endpoint, at the 95th percentile; this is not end-to-end browser latency.",
    capabilityIds: ["web-api"],
    taskTypes: ["web-api"],
    quantityKind: "duration",
    unitDimension: "duration",
    allowedUnits: ["ms", "s", "us"],
    canonicalUnit: "ms",
    validRange: { min: 0.001, max: 86_400_000 },
    direction: "lower-is-better",
    allowedStatistics: ["p95"],
    allowedAveragingModes: ["none"],
    requiredContextFields: ["taskType", "endpoint", "workload", "environment"],
    absoluteRendererId: "duration-absolute.v1",
    comparisonRendererId: "duration-comparison.v1",
    formulaIds: ["latency-reduction-percent", "speedup-factor"],
    recipeIds: ["web-api-performance.v1"],
  },
  {
    id: "web.api-throughput.rate",
    version: "1.0.0",
    label: "API request throughput",
    explanation:
      "Successful requests per second over the stated observation window and workload.",
    capabilityIds: ["web-api"],
    taskTypes: ["web-api"],
    quantityKind: "rate",
    unitDimension: "requests-rate",
    allowedUnits: ["requests/s", "req/s", "requests/min"],
    canonicalUnit: "requests/s",
    validRange: { min: 0, max: 1_000_000_000_000 },
    direction: "higher-is-better",
    allowedStatistics: ["rate-over-window"],
    allowedAveragingModes: ["mean"],
    requiredContextFields: [
      "taskType",
      "endpoint",
      "workload",
      "environment",
      "observationWindow",
    ],
    absoluteRendererId: "rate-absolute.v1",
    comparisonRendererId: "rate-comparison.v1",
    formulaIds: ["throughput-gain-percent"],
    recipeIds: ["web-api-performance.v1"],
  },
  {
    id: "ml.classification.accuracy",
    version: "1.0.0",
    label: "classification accuracy",
    explanation:
      "Fraction of evaluated examples classified correctly; the split and dataset must be named.",
    capabilityIds: ["machine-learning"],
    taskTypes: ["classification"],
    quantityKind: "score",
    unitDimension: "fraction",
    allowedUnits: ["fraction", "%"],
    canonicalUnit: "fraction",
    validRange: { min: 0, max: 1 },
    direction: "higher-is-better",
    allowedStatistics: ["single-evaluation"],
    allowedAveragingModes: ["sample-weighted"],
    requiredContextFields: [
      "taskType",
      "dataset",
      "datasetVersion",
      "evaluationSplit",
    ],
    absoluteRendererId: "score-absolute.v1",
    comparisonRendererId: "score-comparison.v1",
    formulaIds: ["percentage-point-difference"],
    recipeIds: ["ml-classification-evaluation.v1"],
  },
  {
    id: "ml.classification.macro-f1",
    version: "1.0.0",
    label: "macro-F1 score",
    explanation:
      "Unweighted mean of per-class F1 scores; retain the class set and evaluation split.",
    capabilityIds: ["machine-learning"],
    taskTypes: ["classification"],
    quantityKind: "score",
    unitDimension: "fraction",
    allowedUnits: ["fraction", "%"],
    canonicalUnit: "fraction",
    validRange: { min: 0, max: 1 },
    direction: "higher-is-better",
    allowedStatistics: ["single-evaluation"],
    allowedAveragingModes: ["macro"],
    requiredContextFields: [
      "taskType",
      "dataset",
      "datasetVersion",
      "evaluationSplit",
    ],
    absoluteRendererId: "score-absolute.v1",
    comparisonRendererId: "score-comparison.v1",
    formulaIds: ["percentage-point-difference"],
    recipeIds: ["ml-classification-evaluation.v1"],
  },
  {
    id: "ml.classification.roc-auc.binary",
    version: "1.0.0",
    label: "binary ROC-AUC score",
    explanation:
      "Area under the binary receiver operating characteristic curve for the named positive class.",
    capabilityIds: ["machine-learning"],
    taskTypes: ["classification"],
    quantityKind: "score",
    unitDimension: "fraction",
    allowedUnits: ["fraction", "%"],
    canonicalUnit: "fraction",
    validRange: { min: 0, max: 1 },
    direction: "higher-is-better",
    allowedStatistics: ["single-evaluation"],
    allowedAveragingModes: ["binary-positive-class"],
    requiredContextFields: [
      "taskType",
      "dataset",
      "datasetVersion",
      "evaluationSplit",
      "positiveClass",
    ],
    absoluteRendererId: "score-absolute.v1",
    comparisonRendererId: "score-comparison.v1",
    formulaIds: ["percentage-point-difference"],
    recipeIds: ["ml-classification-evaluation.v1"],
  },
  {
    id: "ml.regression.mae",
    version: "1.0.0",
    label: "mean absolute error",
    explanation:
      "Mean absolute prediction error in the target's unit; evaluation split and target unit are required.",
    capabilityIds: ["machine-learning"],
    taskTypes: ["regression"],
    quantityKind: "error",
    unitDimension: "contextual",
    allowedUnits: ["same-dimension-as-target"],
    canonicalUnit: null,
    validRange: { min: 0, max: 1_000_000_000_000 },
    direction: "lower-is-better",
    allowedStatistics: ["mean"],
    allowedAveragingModes: ["mean"],
    requiredContextFields: [
      "taskType",
      "dataset",
      "datasetVersion",
      "evaluationSplit",
      "targetUnit",
    ],
    absoluteRendererId: "error-absolute.v1",
    comparisonRendererId: "error-comparison.v1",
    formulaIds: ["error-reduction-percent"],
    recipeIds: ["ml-regression-evaluation.v1"],
  },
  {
    id: "ml.regression.rmse",
    version: "1.0.0",
    label: "root mean squared error",
    explanation:
      "Root mean squared prediction error in the target's unit; evaluation split and target unit are required.",
    capabilityIds: ["machine-learning"],
    taskTypes: ["regression"],
    quantityKind: "error",
    unitDimension: "contextual",
    allowedUnits: ["same-dimension-as-target"],
    canonicalUnit: null,
    validRange: { min: 0, max: 1_000_000_000_000 },
    direction: "lower-is-better",
    allowedStatistics: ["mean"],
    allowedAveragingModes: ["mean"],
    requiredContextFields: [
      "taskType",
      "dataset",
      "datasetVersion",
      "evaluationSplit",
      "targetUnit",
    ],
    absoluteRendererId: "error-absolute.v1",
    comparisonRendererId: "error-comparison.v1",
    formulaIds: ["error-reduction-percent"],
    recipeIds: ["ml-regression-evaluation.v1"],
  },
  {
    id: "automation.task-runtime",
    version: "1.0.0",
    label: "automation task runtime",
    explanation:
      "Elapsed time for the same repeatable task and comparable inputs, before and after automation.",
    capabilityIds: ["workflow-automation"],
    taskTypes: ["automation"],
    quantityKind: "duration",
    unitDimension: "duration",
    allowedUnits: ["ms", "s", "us"],
    canonicalUnit: "ms",
    validRange: { min: 0.001, max: 86_400_000 },
    direction: "lower-is-better",
    allowedStatistics: ["mean", "p50"],
    allowedAveragingModes: ["mean", "median"],
    requiredContextFields: [
      "taskType",
      "taskDescription",
      "workload",
      "environment",
      "observationPeriod",
      "sampleCount",
    ],
    absoluteRendererId: "duration-absolute.v1",
    comparisonRendererId: "duration-comparison.v1",
    formulaIds: ["runtime-reduction-percent", "speedup-factor"],
    recipeIds: ["automation-runtime.v1"],
  },
] as const satisfies readonly MetricDefinition[];

export const METRIC_CATALOG: readonly MetricDefinition[] = definitions;

export interface MetricCatalogQuery {
  capabilityId?: string;
  taskType?: string;
}

export interface MetricCatalogSelection {
  catalogVersion: typeof MEASUREMENT_CATALOG_VERSION;
  definitions: readonly MetricDefinition[];
  fallback: {
    id: "custom.v1";
    label: "Describe a custom measurement";
    explanation: string;
  };
}

export function getApplicableDefinitions(
  query: MetricCatalogQuery,
): MetricCatalogSelection {
  const capabilityId = normalizeIdentifier(query.capabilityId);
  const taskType = normalizeIdentifier(query.taskType);
  const hasScope = capabilityId !== "" || taskType !== "";
  const applicable = hasScope
    ? METRIC_CATALOG.filter((definition) => {
        const capabilityMatches =
          capabilityId === "" ||
          definition.capabilityIds.some(
            (candidate) => normalizeIdentifier(candidate) === capabilityId,
          );
        const taskMatches =
          taskType === "" ||
          definition.taskTypes.some(
            (candidate) => normalizeIdentifier(candidate) === taskType,
          );
        return capabilityMatches && taskMatches;
      })
    : [];

  return {
    catalogVersion: MEASUREMENT_CATALOG_VERSION,
    definitions: applicable,
    fallback: {
      id: "custom.v1",
      label: "Describe a custom measurement",
      explanation:
        "Enter a user-defined absolute result and its unit for review. No automatic comparison formula or achievement wording is available for a custom metric.",
    },
  };
}

function normalizeIdentifier(value: string | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
