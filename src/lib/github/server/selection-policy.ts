import {
  err,
  FileCandidateSchema,
  ok,
  PullRequestSummarySchema,
  RepositoryScopeSchema,
  type DomainError,
  type PullRequestSummary,
} from "../contracts";
import type { SelectionPolicyFactory, SelectionPolicyPort } from "../ports";
import { createPrSignals } from "./pr-signals";

const REQUIRED_DIMENSIONS = [
  "purpose",
  "method",
  "attribution",
  "corroboration",
] as const;

const ALLOWED_DIMENSIONS = new Set([
  ...REQUIRED_DIMENSIONS,
  "measurement-context",
]);

const MAX_WEIGHT = 1_000;

/**
 * Ranking defaults for the shared selector-policy port. A score ranks safe,
 * eligible evidence; it never makes an excluded file eligible or changes a
 * selector's file, line, byte, request, or token limits.
 */
export const DEFAULT_SELECTION_WEIGHTS: Readonly<Record<string, number>> =
  Object.freeze({
    "category.purpose": 8,
    "category.manifest": 4,
    "category.implementation": 18,
    "category.test": 14,
    "category.report": 10,
    "category.documentation": 3,
    "category.other": 0,
    "candidate.selected": 18,
    "candidate.pinned": 80,
    "scope.selected-path": 50,
    "scope.package-path": 12,
    "scope.contribution-path-term": 2,
    "pr.changed-path": 45,
    "pr.title-path-term": 2,
    "reason.contribution": 14,
    "reason.core-method": 14,
    "reason.product-surface": 10,
    "reason.corroboration": 12,
    "reason.measurement": 8,
    "reason.entrypoint-candidate": 5,
    "reason.selected-package-scope": 8,
    "reason.root-context": 2,
  });

const EMPTY_CONFIG_ERROR: DomainError = {
  code: "invalid-input",
  message: "Selection policy configuration is invalid.",
  retryable: false,
};

/**
 * Creates a deterministic ranking policy for the frozen selector-policy
 * contract. `coverageRules` keys are `all`, `private`, `selected-paths`,
 * `selected-prs`, or `unknown-identity`; their values add required evidence
 * dimensions to the four contribution-first defaults.
 */
export const createSelectionPolicy: SelectionPolicyFactory = (config = {}) => {
  const weights = { ...DEFAULT_SELECTION_WEIGHTS };
  const configuredWeights = config.weights;
  const configuredRules = config.coverageRules;
  let configValid = true;

  if (configuredWeights !== undefined) {
    if (!isRecord(configuredWeights)) {
      configValid = false;
    } else {
      for (const [name, value] of Object.entries(configuredWeights)) {
        if (
          !name.trim() ||
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          Math.abs(value) > MAX_WEIGHT
        ) {
          configValid = false;
          break;
        }
        weights[name] = value;
      }
    }
  }

  if (configuredRules !== undefined) {
    if (!isRecord(configuredRules)) {
      configValid = false;
    } else {
      for (const [rule, dimensions] of Object.entries(configuredRules)) {
        if (
          !isValidRule(rule) ||
          !Array.isArray(dimensions) ||
          dimensions.some(
            (dimension) =>
              typeof dimension !== "string" ||
              !ALLOWED_DIMENSIONS.has(dimension),
          )
        ) {
          configValid = false;
          break;
        }
      }
    }
  }

  function invalidConfig<T>(): ReturnType<typeof err<T>> {
    return err<T>(EMPTY_CONFIG_ERROR);
  }

  const policy: SelectionPolicyPort = {
    scoreCandidate(input) {
      if (!configValid) return invalidConfig<number>();
      if (!input || !Array.isArray(input.pullRequests)) {
        return err({
          code: "invalid-input",
          message: "Selection policy input is invalid.",
          retryable: false,
        });
      }

      const candidateResult = FileCandidateSchema.safeParse(input.candidate);
      const scopeResult = RepositoryScopeSchema.safeParse(input.scope);
      if (!candidateResult.success || !scopeResult.success) {
        return err({
          code: "invalid-input",
          message: "Selection policy input is invalid.",
          retryable: false,
        });
      }

      const candidate = candidateResult.data;
      const scope = scopeResult.data;
      if (!candidate.eligible || candidate.safety !== "safe") {
        return err({
          code: "invalid-evidence",
          message: "Only safe, eligible files can be ranked for retrieval.",
          retryable: false,
        });
      }

      const pullRequests: PullRequestSummary[] = [];
      for (const pullRequest of input.pullRequests) {
        const parsed = PullRequestSummarySchema.safeParse(pullRequest);
        if (!parsed.success) {
          return err({
            code: "invalid-input",
            message: "Selection policy input is invalid.",
            retryable: false,
          });
        }
        pullRequests.push(parsed.data);
      }

      const selectedNumbers = new Set(scope.selectedPullRequestNumbers);
      const selectedPullRequests = pullRequests.filter(
        (pullRequest) =>
          pullRequest.selected &&
          (selectedNumbers.size === 0 ||
            selectedNumbers.has(pullRequest.number)),
      );
      let score = weight(`category.${candidate.category}`);

      if (candidate.selected) score += weight("candidate.selected");
      if (candidate.pinned) score += weight("candidate.pinned");
      if (scope.selectedPaths.includes(candidate.path)) {
        score += weight("scope.selected-path");
      }
      if (
        scope.packagePath &&
        (candidate.path === scope.packagePath ||
          candidate.path.startsWith(`${scope.packagePath}/`))
      ) {
        score += weight("scope.package-path");
      }

      for (const reasonCode of new Set(candidate.reasonCodes)) {
        score += weight(`reason.${reasonCode}`);
      }

      if (
        scope.contributionStatement &&
        hasPathTermOverlap(scope.contributionStatement, candidate.path)
      ) {
        score += weight("scope.contribution-path-term");
      }

      const selectedChangedPath = selectedPullRequests.some((pullRequest) =>
        pullRequest.changedPaths.includes(candidate.path),
      );
      if (selectedChangedPath) score += weight("pr.changed-path");

      // PR titles are weak and untrusted hints. A title that disagrees with
      // changed paths (or describes a docs-only PR) contributes no ranking
      // weight, and never establishes authorship.
      const titleHintIsSupported = selectedPullRequests.some((pullRequest) => {
        if (pullRequest.changedPaths.length === 0) return false;
        const signals = createPrSignals({
          title: pullRequest.title,
          changedPaths: pullRequest.changedPaths,
        });
        return (
          !signals.titlePathMismatch &&
          !signals.documentationOnly &&
          hasPathTermOverlap(pullRequest.title, candidate.path)
        );
      });
      if (!selectedChangedPath && titleHintIsSupported) {
        score += weight("pr.title-path-term");
      }

      return Number.isFinite(score)
        ? ok(score)
        : err({
            code: "invalid-input",
            message: "Selection policy score could not be calculated.",
            retryable: false,
          });
    },

    requiredDimensions({ scope }) {
      if (!configValid) return invalidConfig<string[]>();
      const scopeResult = RepositoryScopeSchema.safeParse(scope);
      if (!scopeResult.success) {
        return err({
          code: "invalid-input",
          message: "Selection policy scope is invalid.",
          retryable: false,
        });
      }

      const normalizedScope = scopeResult.data;
      const rules = configuredRules ?? {};
      const dimensions = new Set<string>(REQUIRED_DIMENSIONS);
      const matchingRules = [
        "all",
        ...(normalizedScope.visibility === "private" ? ["private"] : []),
        ...(normalizedScope.selectedPaths.length > 0 ? ["selected-paths"] : []),
        ...(normalizedScope.selectedPullRequestNumbers.length > 0
          ? ["selected-prs"]
          : []),
        ...(normalizedScope.identitySource === "unknown"
          ? ["unknown-identity"]
          : []),
      ];
      if (normalizedScope.identitySource === "unknown") {
        // An unknown identity always requires an explicit contribution fact.
        dimensions.add("attribution");
      }

      for (const rule of matchingRules) {
        for (const dimension of rules[rule] ?? []) dimensions.add(dimension);
      }

      return ok([...dimensions]);
    },
  };

  function weight(key: string): number {
    return weights[key] ?? 0;
  }

  return policy;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isValidRule(rule: string): boolean {
  return (
    rule === "all" ||
    rule === "private" ||
    rule === "selected-paths" ||
    rule === "selected-prs" ||
    rule === "unknown-identity"
  );
}

function hasPathTermOverlap(text: string, path: string): boolean {
  const stopWords = new Set([
    "about",
    "after",
    "and",
    "for",
    "from",
    "into",
    "that",
    "the",
    "this",
    "with",
  ]);
  const textTerms = new Set(
    text
      .toLocaleLowerCase("en-US")
      .split(/[^a-z0-9]+/u)
      .filter((term) => term.length > 2 && !stopWords.has(term)),
  );
  return path
    .toLocaleLowerCase("en-US")
    .split(/[^a-z0-9]+/u)
    .some((term) => term.length > 2 && textTerms.has(term));
}
