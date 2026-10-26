export const MEASUREMENT_RECIPE_VERSION = "1.0.0" as const;

export interface MeasurementRecipe {
  readonly id: string;
  readonly version: typeof MEASUREMENT_RECIPE_VERSION;
  readonly title: string;
  readonly summary: string;
  readonly steps: readonly string[];
  readonly cautions: readonly string[];
}

export const MEASUREMENT_RECIPES: readonly MeasurementRecipe[] = [
  {
    id: "web-publishing-latency.v1",
    version: MEASUREMENT_RECIPE_VERSION,
    title: "Measure a publishing flow",
    summary:
      "Measure a clearly bounded publishing operation in a repeatable environment.",
    steps: [
      "Name the start and confirmation events and the payload or workload being measured.",
      "Choose a lab or field setting, then record device, network, and application revision.",
      "Collect repeated observations and report the selected percentile with its run context.",
      "Compare against a baseline only when the operation and conditions are comparable.",
    ],
    cautions: [
      "Do not describe endpoint timing as the complete browser publishing experience.",
      "A recipe is guidance only; it does not run a benchmark or create a result.",
    ],
  },
  {
    id: "web-api-performance.v1",
    version: MEASUREMENT_RECIPE_VERSION,
    title: "Measure API latency or throughput",
    summary:
      "Keep the endpoint, request mix, load, and observation window explicit.",
    steps: [
      "Name the endpoint, representative request mix, and observation window.",
      "Record environment, concurrency or load, correctness, and errors alongside performance.",
      "Report the latency percentile or successful request rate used by the measurement.",
      "Use the same endpoint, workload, statistic, and environment for a before-and-after comparison.",
    ],
    cautions: [
      "Configured virtual users are not evidence of actual users or throughput.",
      "A recipe is guidance only; it does not send requests or create a result.",
    ],
  },
  {
    id: "ml-classification-evaluation.v1",
    version: MEASUREMENT_RECIPE_VERSION,
    title: "Evaluate a classifier",
    summary:
      "Select a task-specific score and preserve the dataset and split definition.",
    steps: [
      "Record the dataset version, evaluation split, class balance, and positive class when relevant.",
      "Choose the metric definition and averaging method before recording the score.",
      "Keep held-out evaluation data separate from training and tuning data.",
      "Retain the evaluation report and revision so the result can be reviewed later.",
    ],
    cautions: [
      "Accuracy, macro-F1, and ROC-AUC describe different properties and are not interchangeable.",
      "A training score does not establish held-out performance.",
      "A recipe is guidance only; it does not load data or run evaluation code.",
    ],
  },
  {
    id: "ml-regression-evaluation.v1",
    version: MEASUREMENT_RECIPE_VERSION,
    title: "Evaluate a regression model",
    summary:
      "Keep the target unit, dataset, split, and error aggregation attached to the result.",
    steps: [
      "Name the prediction target and its unit, dataset version, and evaluation split.",
      "Choose an error definition such as MAE or RMSE and record its aggregation method.",
      "Compare only the same error definition, target, unit dimension, split, and evaluation conditions.",
      "Retain the report and revision with the result and note known data limitations.",
    ],
    cautions: [
      "An error measured in one unit cannot be reported as another without a supported conversion.",
      "A recipe is guidance only; it does not load data or run evaluation code.",
    ],
  },
  {
    id: "automation-runtime.v1",
    version: MEASUREMENT_RECIPE_VERSION,
    title: "Measure an automation workflow",
    summary:
      "Compare a repeatable task before and after automation on comparable inputs.",
    steps: [
      "Define the task boundaries, input size, completion criteria, and failure criteria.",
      "Observe the manual and automated workflows over a recorded period and sample count.",
      "Keep the environment and timing statistic consistent across both runs.",
      "Preserve the observations and report a runtime change only after comparison.",
    ],
    cautions: [
      "Estimated time saved is not a measured runtime result.",
      "A recipe is guidance only; it does not start workflows or create a result.",
    ],
  },
];

export function getMeasurementRecipe(
  id: string,
): MeasurementRecipe | undefined {
  return MEASUREMENT_RECIPES.find((recipe) => recipe.id === id);
}
