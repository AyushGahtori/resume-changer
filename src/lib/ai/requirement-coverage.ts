import type { AchievementSelectionInput, JobAnalysisResult } from "./contracts";
import { evidenceText } from "./evidence";

export type CoverageEvidence = {
  kind: "job" | "project" | "skill" | "education" | "credential";
  id: string;
  label: string;
  quote: string;
  selected: boolean;
  inferred?: boolean;
};
export type CoverageStatus =
  | "supported"
  | "partial"
  | "uncertain"
  | "evidence-not-selected"
  | "no-evidence-found";
export type CoverageAssessment = {
  requirement: string;
  priority: "required" | "responsibility" | "preferred";
  facets: Array<{
    label: string;
    alternatives: string[];
    matchedBy: string[];
  }>;
  coveredByAchievementIds: string[];
  availableAchievementIds: string[];
  status: CoverageStatus;
  evidence: CoverageEvidence[];
  missingComponents: string[];
  reason: string;
};

export function normalizeEvidence(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g, (number) =>
      number.replace(/,/g, ""),
    )
    .normalize("NFKD")
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();
}
export function includesPhrase(text: string, phrase: string) {
  return ` ${normalizeEvidence(text)} `.includes(
    ` ${normalizeEvidence(phrase)} `,
  );
}

const CONCEPTS: Record<string, string[]> = {
  go: ["go", "golang"],
  java: ["java"],
  javascript: ["javascript", "js"],
  typescript: ["typescript", "ts"],
  "c++": ["c++", "cpp"],
  provisioning: ["provisioning", "provision", "provisioned"],
  python: ["python"],
  numpy: ["numpy"],
  pandas: ["pandas"],
  "scikit-learn": ["scikit-learn", "sklearn"],
  pytorch: ["pytorch", "torch"],
  tensorflow: ["tensorflow", "tf"],
  sql: ["sql", "postgresql", "mysql", "sql queries"],
  git: ["git"],
  docker: ["docker"],
  "REST APIs": ["rest api", "rest apis", "restful api", "restful apis"],
  fastapi: ["fastapi"],
  flask: ["flask"],
  aws: ["aws", "amazon web services", "ec2"],
  azure: ["azure"],
  "Google Cloud": ["google cloud", "gcp"],
  mlflow: ["mlflow"],
  "large language models": [
    "large language model",
    "large language models",
    "llm",
    "llms",
    "langgraph",
    "langchain",
  ],
  nlp: ["nlp", "natural language processing"],
  transformers: ["transformers", "transformer architectures", "transformer"],
  "deep learning": [
    "deep learning",
    "cnn",
    "convolutional neural network",
    "convolutional neural networks",
  ],
  "neural networks": [
    "neural network",
    "neural networks",
    "cnn",
    "convolutional",
  ],
  "model evaluation": [
    "model evaluation",
    "evaluates call performance",
    "evaluate call performance",
    "response-quality scoring",
    "evaluation metrics",
  ],
  "supervised learning": ["supervised learning", "lightgbm", "xgboost"],
  "unsupervised learning": [
    "unsupervised learning",
    "k-means",
    "kmeans",
    "dbscan",
  ],
  classification: ["classification", "classifier", "classifiers"],
  regression: ["regression"],
  clustering: ["clustering", "k-means", "kmeans", "dbscan"],
  "feature engineering": [
    "feature engineering",
    "feature extraction",
    "feature selection",
  ],
  "hyperparameter tuning": [
    "hyperparameter tuning",
    "hyperparameter optimization",
    "grid search",
    "random search",
    "optuna",
  ],
  "data preprocessing": [
    "data preprocessing",
    "preprocess",
    "preprocessing",
    "data cleaning",
    "cleaned datasets",
  ],
  "data drift": ["data drift", "model drift", "drift detection"],
  "experiment tracking": [
    "experiment tracking",
    "tracked experiments",
    "mlflow",
    "weights and biases",
  ],
  "model versioning": [
    "model versioning",
    "versioned models",
    "model registry",
  ],
  mlops: ["mlops", "ml operations"],
  "CI/CD": ["ci/cd", "continuous integration", "continuous delivery"],
  "cloud deployment": [
    "cloud deployment",
    "aws ec2 deployment",
    "cloud execution",
    "cloud deployments",
    "cloud services",
  ],
  "feature store": ["feature store", "feature stores"],
  "infrastructure as code": ["infrastructure as code", "iac", "terraform"],
  "machine learning": [
    "machine learning",
    "ml",
    "llm",
    "llms",
    "large language models",
    "lightgbm",
    "xgboost",
    "tensorflow",
    "pytorch",
  ],
  "problem solving": [
    "problem solving",
    "identified bottlenecks",
    "identify cpu throttling",
    "diagnose",
    "fixed critical",
  ],
  communication: [
    "communication",
    "cross functional",
    "collaborated",
    "authored",
    "documentation",
  ],
};
const ACTIONS: Record<string, string[]> = {
  design: ["design", "designed", "architected"],
  train: ["train", "trained", "training"],
  optimize: ["optimize", "optimized", "tuned", "improved"],
  collect: ["collect", "collected", "gathered"],
  clean: ["clean", "cleaned", "preprocess", "preprocessed"],
  analyze: ["analyze", "analyzed", "analysed"],
  develop: ["develop", "developed", "built", "implemented"],
  build: ["build", "built", "developed", "implemented"],
  deploy: ["deploy", "deployed", "served", "shipped"],
  monitor: ["monitor", "monitored", "tracked"],
  document: ["document", "documented", "authored"],
  collaborate: ["collaborate", "collaborated", "partnered"],
};
const STOP = new Set(
  "a an the and or in on of to for with using such as strong proficiency experience familiarity knowledge understanding techniques basic related field fields ability years".split(
    " ",
  ),
);

function tokenSet(text: string) {
  return new Set(
    normalizeEvidence(text)
      .split(" ")
      .filter((token) => token.length > 2 && !STOP.has(token))
      .map((token) => token.replace(/(ing|ed|s)$/, "").replace(/e$/, "")),
  );
}

export function requirementComponents(requirement: string) {
  let keys = Object.keys(CONCEPTS).filter((key) =>
    CONCEPTS[key].some((alias) => includesPhrase(requirement, alias)),
  );
  if (
    /\bsupervised\b/i.test(requirement) &&
    /\blearning\b/i.test(requirement) &&
    !keys.includes("supervised learning")
  )
    keys.push("supervised learning");
  // "supervised" must not be manufactured from the substring "unsupervised".
  if (keys.includes("neural networks") && keys.includes("deep learning"))
    keys = keys.filter((k) => k !== "neural networks");
  if (
    keys.includes("machine learning") &&
    keys.length > 1 &&
    !includesPhrase(requirement, "machine learning") &&
    !includesPhrase(requirement, "ML")
  )
    keys = keys.filter((k) => k !== "machine learning");
  return keys;
}

function alternativeKeys(requirement: string, keys: string[]) {
  if (!/\bor\b/i.test(requirement)) return [];
  const normalized = requirement.toLowerCase();
  const orIndex = normalized.lastIndexOf(" or ");
  const boundaries = [" using ", " through ", " with ", " and "]
    .map((marker) => normalized.lastIndexOf(marker, orIndex))
    .filter((index) => index >= 0);
  const tail = boundaries.length
    ? requirement.slice(Math.max(...boundaries))
    : requirement;
  return keys.filter((key) =>
    CONCEPTS[key].some((alias) => includesPhrase(tail, alias)),
  );
}

/** The smallest claims a JD sentence asks the resume to demonstrate. */
export function buildRequirementFacets(requirement: string) {
  const keys = requirementComponents(requirement);
  const alternatives = alternativeKeys(requirement, keys);
  const facets = keys
    .filter((key) => !alternatives.includes(key))
    .map((key) => ({ label: key, alternatives: CONCEPTS[key] }));
  if (alternatives.length)
    facets.push({
      label: alternatives.join(" or "),
      alternatives: alternatives.flatMap((key) => CONCEPTS[key]),
    });

  // Responsibilities often contain several verbs, each of which is a distinct
  // claim. A technology name alone cannot prove that work was performed.
  const lead = requirement.split(
    /\b(?:machine learning|ml|models?|datasets?|systems?|pipelines?|services?|through|using|with|for)\b/i,
  )[0];
  for (const [action, aliases] of Object.entries(ACTIONS)) {
    if (new RegExp(`\\b${action}\\b`, "i").test(lead))
      facets.push({ label: action, alternatives: aliases });
  }
  return facets.length
    ? facets
    : [{ label: requirement, alternatives: [requirement] }];
}

export function requirementPriority(
  analysis: JobAnalysisResult,
  requirement: string,
): CoverageAssessment["priority"] {
  if (analysis.requiredQualifications.includes(requirement)) return "required";
  if (analysis.responsibilities.includes(requirement)) return "responsibility";
  return "preferred";
}

function componentCoverage(
  requirement: string,
  keys: string[],
  covered: string[],
) {
  const alternatives = alternativeKeys(requirement, keys);
  const mandatory = keys.filter((key) => !alternatives.includes(key));
  const missing = mandatory.filter((key) => !covered.includes(key));
  if (alternatives.length && !alternatives.some((key) => covered.includes(key)))
    missing.push(alternatives.join(" or "));
  const total = mandatory.length + Number(alternatives.length > 0);
  return { missing, score: total ? (total - missing.length) / total : 0 };
}

let semanticMatchEvaluations = 0;

/** How many times source text was matched to a requirement in this process. */
export function semanticMatchEvaluationCount() {
  return semanticMatchEvaluations;
}

/** Test hook so a case can measure matching work from a clean counter. */
export function resetSemanticMatchEvaluationCount() {
  semanticMatchEvaluations = 0;
}

export function semanticMatchScore(text: string, requirement: string): number {
  semanticMatchEvaluations += 1;
  if (includesPhrase(text, requirement)) return 1;
  const components = requirementComponents(requirement);
  if (components.length) {
    const covered = components.filter((key) =>
      CONCEPTS[key].some((alias) => includesPhrase(text, alias)),
    );
    return componentCoverage(requirement, components, covered).score;
  }
  const required = [...tokenSet(requirement)];
  const available = tokenSet(text);
  if (!required.length) return 0;
  const ratio =
    required.filter((t) => available.has(t)).length / required.length;
  return ratio >= 0.5 ? ratio : 0;
}

export function getCoverageRequirements(analysis: JobAnalysisResult) {
  return [
    ...new Set([
      ...analysis.requiredQualifications,
      ...analysis.responsibilities,
      ...analysis.preferredQualifications,
    ]),
  ];
}

const strength = { job: 5, project: 4, education: 3, credential: 2, skill: 1 };

type CoverageOptions = {
  renderedSkillIds?: string[];
  requirements?: string[];
  renderedTexts?: Map<string, string>;
  summary?: string;
  inferredTermsById?: Map<string, string[]>;
};

type IndexedSource = {
  kind: CoverageEvidence["kind"];
  id: string;
  label: string;
  quote: string;
  tokens: Set<string>;
  pinnedSelected: boolean;
  achievement: boolean;
  inProgress: boolean;
  degreeQuote: boolean;
  deployment: boolean;
  train: boolean;
  document: boolean;
  machineLearning: boolean;
  coveredKeys: Set<string>;
};

type IndexedRequirement = {
  requirement: string;
  priority: CoverageAssessment["priority"];
  keys: string[];
  facets: Array<{ label: string; alternatives: string[] }>;
  degree: boolean;
  eligible: number[];
  score: number[];
  inferred: boolean[];
  facetHits: boolean[][];
  deployModels: boolean;
  trainWord: boolean;
  documentWord: boolean;
  portfolio: boolean;
  specificTokens: string[] | null;
};

type CoverageIndex = {
  sources: IndexedSource[];
  requirements: IndexedRequirement[];
  affected: Map<string, number[]>;
};

const coverageIndexes = new WeakMap<
  AchievementSelectionInput,
  Map<string, CoverageIndex>
>();

function coverageOptionsKey(options: CoverageOptions) {
  const renderedTexts = options.renderedTexts
    ? [...options.renderedTexts.entries()].sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      )
    : null;
  const inferred = options.inferredTermsById
    ? [...options.inferredTermsById.entries()]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([id, terms]) => [id, [...terms]])
    : null;
  return JSON.stringify([
    options.requirements ?? null,
    options.summary ?? null,
    options.renderedSkillIds ?? null,
    renderedTexts,
    inferred,
  ]);
}

function coveredConceptKeys(quote: string) {
  const covered = new Set<string>();
  for (const [key, aliases] of Object.entries(CONCEPTS)) {
    if (aliases.some((alias) => includesPhrase(quote, alias))) covered.add(key);
  }
  return covered;
}

function indexSource(
  source: Pick<
    IndexedSource,
    "kind" | "id" | "label" | "quote" | "pinnedSelected" | "achievement"
  >,
): IndexedSource {
  const { quote } = source;
  return {
    ...source,
    tokens: tokenSet(quote),
    inProgress: /in progress/.test(quote),
    degreeQuote: /bachelor|master|doctor/i.test(quote),
    deployment:
      /(?:deploy(?:ed|ing|ment)?|serv(?:ed|ing))[^.]{0,70}(?:ml|machine learning|models?)/i.test(
        quote,
      ) && /\b(aws|azure|google cloud|ec2)\b/i.test(quote),
    train: /\btrain(?:ed|ing)?\b/i.test(quote),
    document: /document(?:ed|ation|ing)?/i.test(quote),
    machineLearning: semanticMatchScore(quote, "machine learning") > 0,
    coveredKeys: coveredConceptKeys(quote),
  };
}

function buildCoverageIndex(
  input: AchievementSelectionInput,
  options: CoverageOptions,
): CoverageIndex {
  const sources = input.achievements.map((item) =>
    indexSource({
      kind: item.section === "experience" ? "job" : "project",
      id: item.id,
      label: [item.groupTitle, item.groupSubtitle].filter(Boolean).join(", "),
      quote: options.renderedTexts?.get(item.id) ?? evidenceText(item),
      pinnedSelected: false,
      achievement: true,
    }),
  );
  sources.push(
    ...input.skills.map((skill) =>
      indexSource({
        kind: "skill",
        id: skill.id,
        label: skill.name,
        quote: [skill.name, ...skill.aliases].join(" / "),
        pinnedSelected: options.renderedSkillIds
          ? options.renderedSkillIds.includes(skill.id) ||
            includesPhrase(options.summary ?? "", skill.name)
          : skill.isListedOnCurrentResume,
        achievement: false,
      }),
    ),
  );
  for (const education of input.profile?.education ?? []) {
    sources.push(
      indexSource({
        kind: "education",
        id: education.id,
        label: education.institutions.join(" / "),
        quote: [
          education.degree,
          education.fieldOfStudy,
          education.programName,
          education.description,
          education.endDate === null ? "in progress" : education.endDate,
        ]
          .filter(Boolean)
          .join(" "),
        pinnedSelected: true,
        achievement: false,
      }),
    );
  }
  for (const credential of input.profile?.credentials ?? []) {
    sources.push(
      indexSource({
        kind: "credential",
        id: credential.id,
        label: credential.issuer,
        quote: credential.name,
        pinnedSelected: true,
        achievement: false,
      }),
    );
  }

  const requirements = (
    options.requirements ?? getCoverageRequirements(input.analysis)
  ).map((requirement) => {
    const keys = requirementComponents(requirement);
    const facets = buildRequirementFacets(requirement);
    const degree = /bachelor|master|doctorate|degree/i.test(requirement);
    const practical =
      /^(design|develop|build|deploy|monitor|document|collect|experiment|collaborate)\b/i.test(
        requirement.trim(),
      );
    const eligible = sources.flatMap((source, index) =>
      !practical || source.kind === "job" || source.kind === "project"
        ? [index]
        : [],
    );
    const useFacetScore = facets.length === 1 && keys.length === 0;
    const score: number[] = [];
    const inferred: boolean[] = [];
    const facetHits: boolean[][] = [];
    for (const sourceIndex of eligible) {
      const source = sources[sourceIndex];
      score.push(degree ? 0 : semanticMatchScore(source.quote, requirement));
      const terms = options.inferredTermsById?.get(source.id) ?? [];
      inferred.push(
        terms.some(
          (term) =>
            includesPhrase(requirement, term) ||
            keys.some((key) =>
              CONCEPTS[key].some((alias) => includesPhrase(term, alias)),
            ),
        ),
      );
      facetHits.push(
        facets.map((facet) =>
          facet.alternatives.some((alias) =>
            useFacetScore
              ? semanticMatchScore(source.quote, alias) >= 0.75
              : includesPhrase(source.quote, alias),
          ),
        ),
      );
    }
    const tokens = [...tokenSet(requirement)];
    return {
      requirement,
      priority: requirementPriority(input.analysis, requirement),
      keys,
      facets,
      degree,
      eligible,
      score,
      inferred,
      facetHits,
      deployModels: /deploy(?:ing)?\s+(?:machine learning|ml)\s+models?/i.test(
        requirement,
      ),
      trainWord: /\btrain\b/i.test(requirement),
      documentWord: /\bdocument\b/i.test(requirement),
      portfolio:
        /portfolio.*(?:machine learning|ml).*projects?/i.test(requirement) &&
        /\bor\b/i.test(requirement),
      specificTokens: keys.length === 1 && tokens.length >= 3 ? tokens : null,
    } satisfies IndexedRequirement;
  });

  const affected = new Map<string, number[]>();
  requirements.forEach((requirement, requirementIndex) => {
    const seen = new Set<string>();
    requirement.eligible.forEach((sourceIndex, local) => {
      const source = sources[sourceIndex];
      const matches = requirement.degree
        ? source.kind === "education" && source.degreeQuote
        : requirement.score[local] > 0;
      if (!matches || !source.achievement || seen.has(source.id)) return;
      seen.add(source.id);
      const indexes = affected.get(source.id);
      if (indexes) indexes.push(requirementIndex);
      else affected.set(source.id, [requirementIndex]);
    });
  });
  return { sources, requirements, affected };
}

function coverageIndex(
  input: AchievementSelectionInput,
  options: CoverageOptions,
) {
  let cached = coverageIndexes.get(input);
  if (!cached) {
    cached = new Map();
    coverageIndexes.set(input, cached);
  }
  const key = coverageOptionsKey(options);
  const existing = cached.get(key);
  if (existing) return existing;
  const built = buildCoverageIndex(input, options);
  cached.set(key, built);
  return built;
}

function sourceSelected(source: IndexedSource, selected: Set<string>) {
  return source.achievement ? selected.has(source.id) : source.pinnedSelected;
}

function assessIndexedRequirement(
  index: CoverageIndex,
  requirement: IndexedRequirement,
  selected: Set<string>,
): CoverageAssessment {
  const matching = requirement.eligible
    .map((sourceIndex, local) => ({ sourceIndex, local }))
    .filter(({ sourceIndex, local }) => {
      const source = index.sources[sourceIndex];
      return requirement.degree
        ? source.kind === "education" && source.degreeQuote
        : requirement.score[local] > 0;
    })
    .sort((left, right) => {
      const a = index.sources[left.sourceIndex];
      const b = index.sources[right.sourceIndex];
      return (
        Number(sourceSelected(b, selected)) -
          Number(sourceSelected(a, selected)) ||
        (requirement.inferred[right.local] ? 0 : strength[b.kind]) -
          (requirement.inferred[left.local] ? 0 : strength[a.kind])
      );
    });
  const evidenceFor = ({
    sourceIndex,
    local,
  }: {
    sourceIndex: number;
    local: number;
  }): CoverageEvidence => {
    const source = index.sources[sourceIndex];
    return {
      kind: source.kind,
      id: source.id,
      label: source.label,
      quote: source.quote,
      selected: sourceSelected(source, selected),
      inferred: requirement.inferred[local],
    };
  };
  const matches = matching.map(evidenceFor);
  const activeLocals = matching.filter(({ sourceIndex }) =>
    sourceSelected(index.sources[sourceIndex], selected),
  );
  const active = activeLocals.map(evidenceFor);
  const facets = requirement.facets.map((facet, facetIndex) => ({
    ...facet,
    matchedBy: activeLocals
      .filter(({ local }) => requirement.facetHits[local][facetIndex])
      .map(({ sourceIndex }) => index.sources[sourceIndex].id),
  }));
  const covered = (pool: typeof matching) =>
    requirement.keys.length
      ? requirement.keys.filter((key) =>
          pool.some(({ sourceIndex }) =>
            index.sources[sourceIndex].coveredKeys.has(key),
          ),
        )
      : [];
  const activeKeys = covered(activeLocals);
  const components = componentCoverage(
    requirement.requirement,
    requirement.keys,
    activeKeys,
  );
  let full = requirement.keys.length
    ? components.missing.length === 0
    : activeLocals.some(({ sourceIndex, local }) =>
        requirement.degree
          ? !index.sources[sourceIndex].inProgress
          : requirement.score[local] >= 0.75,
      );
  if (requirement.specificTokens) {
    const tokens = requirement.specificTokens;
    const sufficientlySpecific = activeLocals.some(({ sourceIndex }) => {
      const sourceTokens = index.sources[sourceIndex].tokens;
      return (
        tokens.filter((token) => sourceTokens.has(token)).length /
          tokens.length >=
        0.75
      );
    });
    if (!sufficientlySpecific) full = false;
  }
  if (
    requirement.degree &&
    activeLocals.some(
      ({ sourceIndex }) => index.sources[sourceIndex].inProgress,
    )
  )
    full = false;
  if (facets.some((facet) => facet.matchedBy.length === 0)) full = false;
  if (requirement.priority === "responsibility") {
    const actions = facets.filter((facet) => facet.label in ACTIONS);
    const terms = facets.filter((facet) => !(facet.label in ACTIONS));
    if (
      actions.length &&
      terms.length &&
      !active.some(
        (source) =>
          (source.kind === "job" || source.kind === "project") &&
          actions.every((facet) => facet.matchedBy.includes(source.id)) &&
          terms.some((facet) => facet.matchedBy.includes(source.id)),
      )
    )
      full = false;
  }
  // A related application is not proof of training or operating a complete ML lifecycle.
  if (requirement.deployModels) {
    if (
      !activeLocals.some(
        ({ sourceIndex }) => index.sources[sourceIndex].deployment,
      )
    )
      full = false;
  }
  if (
    requirement.trainWord &&
    !activeLocals.some(({ sourceIndex }) => index.sources[sourceIndex].train)
  )
    full = false;
  if (
    requirement.documentWord &&
    !activeLocals.some(({ sourceIndex }) => index.sources[sourceIndex].document)
  )
    full = false;
  if (requirement.portfolio) {
    full = activeLocals.some(
      ({ sourceIndex }) =>
        index.sources[sourceIndex].kind === "project" &&
        index.sources[sourceIndex].machineLearning,
    );
  }
  const directComponents = componentCoverage(
    requirement.requirement,
    requirement.keys,
    covered(activeLocals.filter(({ local }) => !requirement.inferred[local])),
  );
  const dependsOnInference =
    requirement.keys.length > 0 && directComponents.missing.length > 0;
  const status: CoverageStatus =
    full && dependsOnInference
      ? "uncertain"
      : full
        ? "supported"
        : active.length
          ? "partial"
          : matches.length
            ? "evidence-not-selected"
            : "no-evidence-found";
  const missingComponents = [
    ...new Set([
      ...components.missing,
      ...facets
        .filter((facet) => !facet.matchedBy.length)
        .map((facet) => facet.label),
    ]),
  ];
  const useful = active.length ? active : matches;
  const reason =
    status === "supported"
      ? "The included evidence supports the requirement; job evidence is preferred over project and declared-skill evidence."
      : status === "uncertain"
        ? "Coverage depends on a disclosed framework inference. Confirm that the project used this framework."
        : status === "partial"
          ? `Related evidence exists, but the complete requirement is not established${missingComponents.length ? `: ${missingComponents.join(", ")}` : "."}`
          : status === "evidence-not-selected"
            ? "Relevant evidence is available but omitted from this resume."
            : "No supporting evidence was found; add facts or confirm relevant experience.";
  return {
    requirement: requirement.requirement,
    priority: requirement.priority,
    facets,
    status,
    evidence: useful,
    missingComponents,
    coveredByAchievementIds: active
      .filter((source) => source.kind === "job" || source.kind === "project")
      .map((source) => source.id),
    availableAchievementIds: matches
      .filter((source) => source.kind === "job" || source.kind === "project")
      .map((source) => source.id),
    reason: reason.slice(0, 500),
  };
}

/**
 * Match each source to each requirement once, then project selection changes
 * from those facts. Selection repeats this projection for every candidate.
 */
export function openRequirementCoverage(
  input: AchievementSelectionInput,
  options: CoverageOptions = {},
) {
  const index = coverageIndex(input, options);
  return {
    affectedBy(achievementId: string) {
      return index.affected.get(achievementId) ?? [];
    },
    assess(
      selectedIds: readonly string[],
      requirementIndexes?: readonly number[],
    ) {
      const selected = new Set(selectedIds);
      const indexes =
        requirementIndexes ?? index.requirements.map((_, item) => item);
      return indexes.map((item) =>
        assessIndexedRequirement(index, index.requirements[item], selected),
      );
    },
  };
}

export function assessRequirementCoverage(
  input: AchievementSelectionInput,
  selectedIds: string[],
  options: CoverageOptions = {},
): CoverageAssessment[] {
  return openRequirementCoverage(input, options).assess(selectedIds);
}
