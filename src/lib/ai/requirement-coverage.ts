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

export function semanticMatchScore(text: string, requirement: string): number {
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

export function assessRequirementCoverage(
  input: AchievementSelectionInput,
  selectedIds: string[],
  options: {
    renderedSkillIds?: string[];
    requirements?: string[];
    renderedTexts?: Map<string, string>;
    summary?: string;
    inferredTermsById?: Map<string, string[]>;
  } = {},
): CoverageAssessment[] {
  const selected = new Set(selectedIds);
  const sources: CoverageEvidence[] = input.achievements.map((item) => ({
    kind: item.section === "experience" ? "job" : "project",
    id: item.id,
    label: [item.groupTitle, item.groupSubtitle].filter(Boolean).join(", "),
    quote: options.renderedTexts?.get(item.id) ?? evidenceText(item),
    selected: selected.has(item.id),
  }));
  sources.push(
    ...input.skills.map((skill) => ({
      kind: "skill" as const,
      id: skill.id,
      label: skill.name,
      quote: [skill.name, ...skill.aliases].join(" / "),
      selected: options.renderedSkillIds
        ? options.renderedSkillIds.includes(skill.id) ||
          includesPhrase(options.summary ?? "", skill.name)
        : skill.isListedOnCurrentResume,
    })),
  );
  for (const education of input.profile?.education ?? []) {
    sources.push({
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
      selected: true,
    });
  }
  for (const credential of input.profile?.credentials ?? []) {
    sources.push({
      kind: "credential",
      id: credential.id,
      label: credential.issuer,
      quote: credential.name,
      selected: true,
    });
  }
  return (options.requirements ?? getCoverageRequirements(input.analysis)).map(
    (requirement) => {
      const keys = requirementComponents(requirement);
      const degree = /bachelor|master|doctorate|degree/i.test(requirement);
      const practical =
        /^(design|develop|build|deploy|monitor|document|collect|experiment|collaborate)\b/i.test(
          requirement.trim(),
        );
      const eligible = sources.filter(
        (s) => !practical || s.kind === "job" || s.kind === "project",
      );
      const matches = eligible
        .map((source) => ({
          ...source,
          inferred: (options.inferredTermsById?.get(source.id) ?? []).some(
            (term) =>
              includesPhrase(requirement, term) ||
              keys.some((key) =>
                CONCEPTS[key].some((alias) => includesPhrase(term, alias)),
              ),
          ),
        }))
        .filter((s) =>
          degree
            ? s.kind === "education" && /bachelor|master|doctor/i.test(s.quote)
            : semanticMatchScore(s.quote, requirement) > 0,
        )
        .sort(
          (a, b) =>
            Number(b.selected) - Number(a.selected) ||
            (b.inferred ? 0 : strength[b.kind]) -
              (a.inferred ? 0 : strength[a.kind]),
        );
      const active = matches.filter((s) => s.selected);
      const covered = (pool: CoverageEvidence[]) =>
        keys.length
          ? keys.filter((k) =>
              pool.some((s) =>
                CONCEPTS[k].some((alias) => includesPhrase(s.quote, alias)),
              ),
            )
          : [];
      const activeKeys = covered(active);
      const components = componentCoverage(requirement, keys, activeKeys);
      let full = keys.length
        ? components.missing.length === 0
        : active.some((s) =>
            degree
              ? !/in progress/.test(s.quote)
              : semanticMatchScore(s.quote, requirement) >= 0.75,
          );
      if (keys.length === 1 && tokenSet(requirement).size >= 3) {
        const tokens = [...tokenSet(requirement)];
        const sufficientlySpecific = active.some(
          (source) =>
            tokens.filter((token) => tokenSet(source.quote).has(token)).length /
              tokens.length >=
            0.75,
        );
        if (!sufficientlySpecific) full = false;
      }
      if (degree && active.some((s) => /in progress/.test(s.quote)))
        full = false;
      // A related application is not proof of training or operating a complete ML lifecycle.
      if (
        /deploy(?:ing)?\s+(?:machine learning|ml)\s+models?/i.test(requirement)
      ) {
        const deployment = active.some(
          (source) =>
            /(?:deploy(?:ed|ing|ment)?|serv(?:ed|ing))[^.]{0,70}(?:ml|machine learning|models?)/i.test(
              source.quote,
            ) && /\b(aws|azure|google cloud|ec2)\b/i.test(source.quote),
        );
        if (!deployment) full = false;
      }
      if (
        /\btrain\b/i.test(requirement) &&
        !active.some((s) => /\btrain(?:ed|ing)?\b/i.test(s.quote))
      )
        full = false;
      if (
        /\bdocument\b/i.test(requirement) &&
        !active.some((s) => /document(?:ed|ation|ing)?/i.test(s.quote))
      )
        full = false;
      if (
        /portfolio.*(?:machine learning|ml).*projects?/i.test(requirement) &&
        /\bor\b/i.test(requirement)
      ) {
        full = active.some(
          (source) =>
            source.kind === "project" &&
            semanticMatchScore(source.quote, "machine learning") > 0,
        );
      }
      const directComponents = componentCoverage(
        requirement,
        keys,
        covered(active.filter((source) => !source.inferred)),
      );
      const dependsOnInference =
        keys.length > 0 && directComponents.missing.length > 0;
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
      const missingComponents = components.missing;
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
        requirement,
        status,
        evidence: useful,
        missingComponents,
        coveredByAchievementIds: active
          .filter((s) => s.kind === "job" || s.kind === "project")
          .map((s) => s.id),
        availableAchievementIds: matches
          .filter((s) => s.kind === "job" || s.kind === "project")
          .map((s) => s.id),
        reason: reason.slice(0, 500),
      };
    },
  );
}
