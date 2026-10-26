export type PrCapability =
  | "web-ui"
  | "api"
  | "data"
  | "ml-training"
  | "ml-serving"
  | "reporting"
  | "documentation"
  | "maintenance"
  | "unknown";

export type PrSignalSource = "title" | "changed-path";

export interface PrCapabilityHint {
  capability: PrCapability;
  source: PrSignalSource;
  reasonCode: string;
  reason: string;
}

export interface PrSignals {
  titleHints: PrCapabilityHint[];
  pathHints: PrCapabilityHint[];
  /** True when title hints are not supported by the changed-path hints. */
  titlePathMismatch: boolean;
  /** True only when every retained path is documentation or a documentation test. */
  documentationOnly: boolean;
}

const TITLE_RULES: ReadonlyArray<{
  pattern: RegExp;
  capabilities: ReadonlyArray<PrCapability>;
  reasonCode: string;
  reason: string;
}> = [
  {
    pattern:
      /\b(dashboard|chart|charts|visuali[sz]ation|feed|form|frontend|ui)\b/i,
    capabilities: ["web-ui", "reporting"],
    reasonCode: "title-suggests-ui-or-reporting",
    reason: "The title suggests a possible UI or reporting surface.",
  },
  {
    pattern: /\b(api|endpoint|route|controller|service)\b/i,
    capabilities: ["api"],
    reasonCode: "title-suggests-api",
    reason: "The title suggests a possible API or service change.",
  },
  {
    pattern: /\b(query|database|db|cache|index|migration|storage)\b/i,
    capabilities: ["data"],
    reasonCode: "title-suggests-data",
    reason: "The title suggests a possible data or storage change.",
  },
  {
    pattern:
      /\b(model|classifier|classification|training|train|accuracy|evaluation|eval)\b/i,
    capabilities: ["ml-training", "reporting"],
    reasonCode: "title-suggests-ml-or-evaluation",
    reason: "The title suggests possible model or evaluation work.",
  },
  {
    pattern: /\b(inference|serving|prediction|predict)\b/i,
    capabilities: ["ml-serving"],
    reasonCode: "title-suggests-model-serving",
    reason: "The title suggests possible model serving or inference work.",
  },
  {
    pattern: /\b(report|metrics|metric|benchmark|monitoring)\b/i,
    capabilities: ["reporting"],
    reasonCode: "title-suggests-reporting",
    reason: "The title suggests possible reporting or measurement context.",
  },
  {
    pattern: /\b(docs?|documentation|readme|guide)\b/i,
    capabilities: ["documentation"],
    reasonCode: "title-suggests-documentation",
    reason: "The title suggests documentation work.",
  },
  {
    pattern: /\b(dependenc(?:y|ies)|release|chore|format|lint|bump)\b/i,
    capabilities: ["maintenance"],
    reasonCode: "title-suggests-maintenance",
    reason: "The title suggests maintenance work.",
  },
];

const DOC_EXTENSIONS = /\.(?:md|mdx|rst|adoc|txt)$/i;
const TEST_PATH =
  /(?:^|\/)(?:__tests__|tests?|specs?)(?:\/|$)|\.(?:test|spec)\.[^/]+$/i;
const DOC_DIRECTORY = /^(?:docs?|documentation|wiki)(?:\/|$)/i;
const UI_PATH =
  /(?:^|\/)(?:app|pages|components|views|frontend|ui)(?:\/|$)|\.(?:tsx|jsx|vue|svelte)$/i;
const API_PATH =
  /(?:^|\/)(?:api|routes?|controllers?|handlers?|services?)(?:\/|$)|(?:^|\/)(?:route|controller|handler)\.[^/]+$/i;
const DATA_PATH =
  /(?:^|\/)(?:db|database|migrations?|queries|storage|repositories)(?:\/|$)|(?:^|\/)(?:schema|migration|query)\.[^/]+$/i;
const ML_TRAINING_PATH =
  /(?:^|\/)(?:ml|machine-learning|models?|training|train|evaluation|eval)(?:\/|$)|\.(?:ipynb|onnx|pt|pth)$/i;
const ML_SERVING_PATH =
  /(?:^|\/)(?:inference|serving|predict(?:ion)?)(?:\/|$)/i;
const REPORTING_PATH =
  /(?:^|\/)(?:reports?|metrics|benchmarks?|charts|visuali[sz]ation|monitoring|evaluations?|eval)(?:\/|$)/i;

function normalizeTitleForMatching(title: string): string {
  const conventionalPrefix =
    /^(?:feat(?:ure)?|fix|docs?|refactor|perf|test|build|ci|chore)(?:\([^)]{1,60}\))?:\s*/i;
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(conventionalPrefix, "")
    .toLocaleLowerCase("en-US");
}

function addHint(
  target: Map<string, PrCapabilityHint>,
  hint: PrCapabilityHint,
): void {
  target.set(`${hint.capability}:${hint.reasonCode}`, hint);
}

function titleHints(title: string): PrCapabilityHint[] {
  const normalized = normalizeTitleForMatching(title);
  const hints = new Map<string, PrCapabilityHint>();

  for (const rule of TITLE_RULES) {
    if (!rule.pattern.test(normalized)) continue;
    for (const capability of rule.capabilities) {
      addHint(hints, {
        capability,
        source: "title",
        reasonCode: rule.reasonCode,
        reason: rule.reason,
      });
    }
  }

  if (hints.size === 0) {
    addHint(hints, {
      capability: "unknown",
      source: "title",
      reasonCode: "title-no-known-hint",
      reason: "The title does not match a known scope hint.",
    });
  }

  return [...hints.values()];
}

function pathHints(path: string): PrCapabilityHint[] {
  const normalized = path.replaceAll("\\", "/").toLocaleLowerCase("en-US");
  const hints = new Map<string, PrCapabilityHint>();
  const isDocumentation =
    DOC_DIRECTORY.test(normalized) || DOC_EXTENSIONS.test(normalized);
  const isTest = TEST_PATH.test(normalized);

  if (isDocumentation) {
    addHint(hints, {
      capability: "documentation",
      source: "changed-path",
      reasonCode: "changed-documentation-path",
      reason:
        "The changed path is documentation, so it does not establish an implemented UI or service.",
    });
  }

  if (!isDocumentation && UI_PATH.test(normalized)) {
    addHint(hints, {
      capability: "web-ui",
      source: "changed-path",
      reasonCode: "changed-ui-implementation-path",
      reason:
        "The changed path is in a UI surface or uses a UI component extension.",
    });
  }

  if (!isDocumentation && API_PATH.test(normalized)) {
    addHint(hints, {
      capability: "api",
      source: "changed-path",
      reasonCode: "changed-api-implementation-path",
      reason:
        "The changed path is in an API, route, handler, controller, or service area.",
    });
  }

  if (!isDocumentation && DATA_PATH.test(normalized)) {
    addHint(hints, {
      capability: "data",
      source: "changed-path",
      reasonCode: "changed-data-implementation-path",
      reason:
        "The changed path is in a data, query, migration, or storage area.",
    });
  }

  if (!isDocumentation && ML_TRAINING_PATH.test(normalized)) {
    addHint(hints, {
      capability: "ml-training",
      source: "changed-path",
      reasonCode: "changed-ml-or-evaluation-path",
      reason: "The changed path is in a model, training, or evaluation area.",
    });
  }

  if (!isDocumentation && ML_SERVING_PATH.test(normalized)) {
    addHint(hints, {
      capability: "ml-serving",
      source: "changed-path",
      reasonCode: "changed-model-serving-path",
      reason: "The changed path is in a model serving or inference area.",
    });
  }

  if (!isDocumentation && REPORTING_PATH.test(normalized)) {
    addHint(hints, {
      capability: "reporting",
      source: "changed-path",
      reasonCode: "changed-reporting-path",
      reason: "The changed path is in a reporting or measurement area.",
    });
  }

  if (isTest) {
    addHint(hints, {
      capability: "unknown",
      source: "changed-path",
      reasonCode: "changed-test-corroboration-path",
      reason:
        "The changed path is a test and should corroborate implementation evidence rather than prove it by itself.",
    });
  }

  if (hints.size === 0) {
    addHint(hints, {
      capability: "unknown",
      source: "changed-path",
      reasonCode: "changed-path-needs-inspection",
      reason: "The path needs source inspection before assigning a capability.",
    });
  }

  return [...hints.values()];
}

export function createPrSignals(input: {
  title: string;
  changedPaths: ReadonlyArray<string>;
}): PrSignals {
  const titleHintList = titleHints(input.title);
  const pathHintList = input.changedPaths.flatMap(pathHints);
  const pathCapabilities = new Set(
    pathHintList
      .filter((hint) => hint.capability !== "unknown")
      .map((hint) => hint.capability),
  );
  const titleCapabilities = titleHintList
    .map((hint) => hint.capability)
    .filter(
      (capability) =>
        capability !== "unknown" && capability !== "documentation",
    );
  const hasImplementationPath = input.changedPaths.some(
    (path) =>
      !DOC_DIRECTORY.test(path) &&
      !DOC_EXTENSIONS.test(path) &&
      !TEST_PATH.test(path),
  );
  const documentationOnly =
    input.changedPaths.length > 0 &&
    input.changedPaths.every(
      (path) =>
        DOC_DIRECTORY.test(path) ||
        DOC_EXTENSIONS.test(path) ||
        (TEST_PATH.test(path) && DOC_EXTENSIONS.test(path)),
    );
  const titlePathMismatch =
    titleCapabilities.length > 0 &&
    (!hasImplementationPath ||
      titleCapabilities.every(
        (capability) => !pathCapabilities.has(capability),
      ));

  return {
    titleHints: titleHintList,
    pathHints: pathHintList,
    titlePathMismatch,
    documentationOnly,
  };
}
