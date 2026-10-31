import { evidenceReadiness, evidenceRecoveryNotes } from "./evidence-readiness";
import {
  EVIDENCE_LIMITS,
  classifyPath,
  domainError,
  getPathExclusionReason,
  inspectFileContent,
  normalizeRepositoryPath,
  normalizeSourceText,
  sha256,
  type DomainError,
  type EvidenceCategory,
  type FileCandidate,
  type FileExclusion,
  type Result,
} from "./file-policy-core";
import { extractMeaningfulBlocks, mergeLineRanges } from "./evidence-core";

export type EvidenceDimension =
  | "purpose"
  | "method"
  | "attribution"
  | "corroboration"
  | "measurement-context";

export interface RepositoryScope {
  repositoryId: string;
  owner: string;
  name: string;
  fullSha: string;
  canonicalUrl?: string;
  visibility?: "public" | "private";
  ref?: string;
  packagePath?: string;
  selectedPaths?: readonly string[];
  selectedPrNumbers?: readonly number[];
  selectedPrPaths?: readonly string[];
  contributionStatement?: string;
  identitySource?: "self-declared" | "authenticated" | "unknown";
  role?: string;
}

export interface SelectedPullRequest {
  number: number;
  title: string;
  changedPaths: readonly string[];
}

export interface PreparedPrContext {
  number: number;
  title?: string;
  changedPaths: string[];
  untrustedSource: true;
}

export interface PullRequestContext {
  selectedPullRequests: readonly SelectedPullRequest[];
  partial?: boolean;
  omittedCount?: number;
}

export interface BudgetFileSelection {
  fileId: string;
  path: string;
  blobSha: string;
  ranges: Array<{ lineStart: number; lineEnd: number }>;
  bytes: number;
  characters: number;
  transmitted: boolean;
}

export interface BudgetSelectionRequest {
  runId: string;
  requestKind: "initial" | "recovery";
  files: BudgetFileSelection[];
  uniqueLineCount: number;
  transmittedLineCount: number;
  totalCharacters: number;
  prContextCharacters: number;
  contextCharacters: number;
  estimatedSourceTokens: number;
  estimatedPrContextTokens: number;
  estimatedInputTokens: number;
  totalFetchedBytes: number;
}

export interface BudgetAdmission {
  allowed: boolean;
  exhaustedDimensions?: readonly string[];
}

/** Narrow local port matching the frozen ledger contract; Task 07 owns its implementation. */
export interface SelectorBudgetLedger {
  checkSelection(
    request: BudgetSelectionRequest,
  ): Promise<Result<BudgetAdmission>>;
}

export interface EvidenceExecutionContext {
  runId: string;
  snapshotId: string;
  signal?: AbortSignal;
  deadlineAt?: string;
  clock: () => Date;
  budgetLedger: SelectorBudgetLedger;
  requestKind?: "initial" | "recovery";
}

export interface FetchedFile {
  text: string;
  blobSha: string;
  byteSize: number;
}

export interface FetchFileRequest {
  scope: RepositoryScope;
  candidate: FileCandidate;
  maxBytes: number;
  context: EvidenceExecutionContext;
}

export interface EvidenceSelectorDependencies {
  fetchFile: (request: FetchFileRequest) => Promise<Result<FetchedFile>>;
  scoreCandidate?: (
    candidate: RankedCandidate,
    scope: RepositoryScope,
    prs: PullRequestContext,
  ) => Result<number>;
  requiredDimensions?: (scope: RepositoryScope) => Result<EvidenceDimension[]>;
}

export interface SelectorInput {
  inventory: readonly FileCandidate[];
  scope: RepositoryScope;
  prContext: PullRequestContext;
  pinnedFileIds: readonly string[];
  removedFileIds?: readonly string[];
  context: EvidenceExecutionContext;
}

export interface RankedCandidate {
  candidate: FileCandidate;
  category: EvidenceCategory;
  score: number;
  reasonCodes: string[];
  pinned: boolean;
  selectedPath: boolean;
  changedInSelectedPr: boolean;
}

export interface DuplicateFileAlias {
  duplicateFileId: string;
  canonicalFileId: string;
  path: string;
}

export interface SelectionPlan {
  runId: string;
  snapshotId: string;
  scope: RepositoryScope;
  selectedFiles: RankedCandidate[];
  rankedCandidates: RankedCandidate[];
  excludedFiles: FileExclusion[];
  duplicateFileAliases: DuplicateFileAlias[];
  pinConflicts: FileExclusion[];
  limitations: string[];
  removedFileIds: string[];
  prTitles: string[];
  selectedPrContext: PreparedPrContext[];
  missingDimensions: EvidenceDimension[];
  status: "ready" | "partial" | "needs-context";
}

export interface EvidenceItem {
  id: string;
  snapshotId: string;
  repositoryId: string;
  fullSha: string;
  path: string;
  blobSha: string;
  lineStart: number;
  lineEnd: number;
  excerpt: string;
  excerptHash: string;
  category: EvidenceCategory;
  reasonCodes: string[];
  sourceClassification: "observed" | "documented";
  untrustedSource: boolean;
  alternateOrigins: string[];
}

export interface ReplacementRecommendation {
  fileId: string;
  reasonCode: string;
  message: string;
}

export interface PreparedEvidence {
  runId: string;
  snapshotId: string;
  scope: RepositoryScope;
  selectedPrContext: PreparedPrContext[];
  repositoryId: string;
  fullSha: string;
  selectedFileIds: string[];
  duplicateFileAliases: DuplicateFileAlias[];
  evidence: EvidenceItem[];
  excludedFiles: FileExclusion[];
  pinConflicts: FileExclusion[];
  replacementRecommendations: ReplacementRecommendation[];
  limitations: string[];
  missingDimensions: EvidenceDimension[];
  completeness: "complete" | "partial" | "needs-context";
  fetchedFileCount: number;
  fetchedBytes: number;
  uniqueLineCount: number;
  transmittedLineCount: number;
  totalCharacters: number;
  selectionHash: string;
  requiresConsent: true;
}

const MAX_AUTO_FILES = EVIDENCE_LIMITS.maxFilesPerRequest - 3;
const MAX_AUTO_REFERENCES = EVIDENCE_LIMITS.maxFilesPerRequest - MAX_AUTO_FILES;
const MAX_SELECTED_PRS = 3;
const MAX_CHANGED_PATHS = 120;
const MAX_PR_CONTEXT_CHARACTERS = 2_400;
const CATEGORY_SCORE: Record<EvidenceCategory, number> = {
  purpose: 12,
  stack: 10,
  "product-surface": 22,
  "core-method": 24,
  corroboration: 19,
  measurement: 14,
  "ui-style": 8,
  helper: 18,
  unknown: 0,
};
const TITLE_STOP_WORDS = new Set([
  "add",
  "and",
  "bug",
  "build",
  "chore",
  "change",
  "ci",
  "docs",
  "feature",
  "feat",
  "fix",
  "improve",
  "issue",
  "make",
  "new",
  "perf",
  "refactor",
  "test",
  "update",
]);

export function createEvidenceSelector(
  dependencies: EvidenceSelectorDependencies,
) {
  return {
    select(input: SelectorInput): Result<SelectionPlan> {
      const scopeResult = validateScope(input.scope);
      if (!scopeResult.ok) return scopeResult;
      if (
        !Array.isArray(input.inventory) ||
        !Array.isArray(input.pinnedFileIds) ||
        (input.removedFileIds !== undefined &&
          !Array.isArray(input.removedFileIds)) ||
        !input.prContext ||
        !Array.isArray(input.prContext.selectedPullRequests)
      ) {
        return {
          ok: false,
          error: domainError(
            "invalid-input",
            "Evidence selection input is invalid.",
          ),
        };
      }
      if (!input.context || !input.context.runId || !input.context.snapshotId) {
        return {
          ok: false,
          error: domainError(
            "invalid-input",
            "A run and snapshot identity are required.",
          ),
        };
      }

      const pinnedIds = new Set(input.pinnedFileIds);
      const removedIds = new Set(input.removedFileIds ?? []);
      const conflictedIds = [...pinnedIds].filter((id) => removedIds.has(id));
      if (conflictedIds.length > 0) {
        return {
          ok: false,
          error: domainError(
            "invalid-input",
            "A file cannot be pinned and removed in the same selection.",
          ),
        };
      }

      const exclusions: FileExclusion[] = [];
      const safeCandidates: FileCandidate[] = [];
      const seenIds = new Set<string>();
      for (const candidate of input.inventory) {
        if (
          !candidate ||
          typeof candidate.id !== "string" ||
          !candidate.id ||
          seenIds.has(candidate.id)
        ) {
          exclusions.push({
            fileId:
              typeof candidate?.id === "string" ? candidate.id : "unknown",
            reasonCode: "invalid-candidate",
          });
          continue;
        }
        seenIds.add(candidate.id);
        const reasonCode = getPathExclusionReason(candidate);
        if (reasonCode) {
          exclusions.push({
            fileId: candidate.id,
            ...(normalizeRepositoryPath(candidate.path)
              ? { path: candidate.path }
              : {}),
            reasonCode,
          });
          continue;
        }
        if (!isSha(candidate.blobSha)) {
          exclusions.push({
            fileId: candidate.id,
            path: candidate.path,
            reasonCode: "invalid-blob-identity",
          });
          continue;
        }
        if (removedIds.has(candidate.id)) {
          exclusions.push({
            fileId: candidate.id,
            path: candidate.path,
            reasonCode: "user-removed",
          });
          continue;
        }
        safeCandidates.push(candidate);
      }

      const candidateById = new Map(
        safeCandidates.map((candidate) => [candidate.id, candidate]),
      );
      const pinConflicts: FileExclusion[] = [];
      for (const pinnedId of pinnedIds) {
        if (candidateById.has(pinnedId)) continue;
        const existing = input.inventory.find(
          (candidate) => candidate?.id === pinnedId,
        );
        const reasonCode = existing
          ? (getPathExclusionReason(existing) ?? "invalid-candidate")
          : "pinned-file-unavailable";
        pinConflicts.push({
          fileId: pinnedId,
          ...(existing && normalizeRepositoryPath(existing.path)
            ? { path: existing.path }
            : {}),
          reasonCode,
        });
      }

      const selectedPathSet = new Set(
        (input.scope.selectedPaths ?? [])
          .map(normalizeRepositoryPath)
          .filter((path): path is string => Boolean(path)),
      );
      const changedPathSet = new Set<string>();
      const prTitles: string[] = [];
      const selectedPrContext: PreparedPrContext[] = [];
      let prTitleBlocked = false;
      let prTitleUntrusted = false;
      let invalidPrIdentity = false;
      let changedPathCount = 0;
      for (const pr of input.prContext.selectedPullRequests.slice(
        0,
        MAX_SELECTED_PRS,
      )) {
        if (
          !pr ||
          typeof pr !== "object" ||
          !Number.isInteger(pr.number) ||
          pr.number < 1
        ) {
          invalidPrIdentity = true;
          continue;
        }
        if (!Array.isArray(pr.changedPaths)) {
          invalidPrIdentity = true;
          continue;
        }
        let safeTitle: string | undefined;
        if (typeof pr.title === "string") {
          const candidateTitle = pr.title.slice(0, 160);
          const titleSafety = inspectFileContent(
            candidateTitle,
            "selected-pr-title.txt",
          );
          if (titleSafety.safe) {
            safeTitle = candidateTitle;
            prTitles.push(candidateTitle);
            prTitleUntrusted ||= titleSafety.untrustedInstructions;
          } else {
            prTitleBlocked = true;
          }
        }
        const changedPaths: string[] = [];
        for (const path of pr.changedPaths) {
          if (changedPathCount >= MAX_CHANGED_PATHS) break;
          const normalized = normalizeRepositoryPath(path);
          if (normalized) {
            changedPathSet.add(normalized);
            changedPaths.push(normalized);
          }
          changedPathCount += 1;
        }
        selectedPrContext.push({
          number: pr.number,
          ...(safeTitle ? { title: safeTitle } : {}),
          changedPaths,
          untrustedSource: true as const,
        });
      }

      const scope: RepositoryScope = {
        ...input.scope,
        selectedPrNumbers:
          selectedPrContext.length > 0
            ? selectedPrContext.map(({ number }) => number)
            : input.scope.selectedPrNumbers,
        selectedPrPaths: [...changedPathSet],
      };
      const terms = collectContributionTerms(scope);
      const titleTerms = collectTitleTerms(prTitles);
      const rankedCandidates = safeCandidates
        .filter((candidate) => {
          const category = candidate.category ?? classifyPath(candidate.path);
          const direct =
            selectedPathSet.has(candidate.path) ||
            changedPathSet.has(candidate.path);
          const uiScoped = isUiScoped(
            scope.role,
            prTitles,
            selectedPathSet,
            changedPathSet,
          );
          if (
            category === "ui-style" &&
            !uiScoped &&
            !pinnedIds.has(candidate.id)
          ) {
            exclusions.push({
              fileId: candidate.id,
              path: candidate.path,
              reasonCode: "out-of-scope-ui-style",
            });
            return false;
          }
          return direct || category !== "unknown";
        })
        .map((candidate) =>
          rankCandidate(candidate, {
            pinned: pinnedIds.has(candidate.id),
            selectedPath: selectedPathSet.has(candidate.path),
            changedInSelectedPr: changedPathSet.has(candidate.path),
            packagePath: scope.packagePath,
            role: scope.role,
            titleTerms,
            relevanceTerms: terms,
          }),
        )
        .sort(compareRankedCandidates);

      for (const pinnedId of pinnedIds) {
        if (
          !candidateById.has(pinnedId) ||
          rankedCandidates.some((entry) => entry.candidate.id === pinnedId)
        )
          continue;
        const candidate = candidateById.get(pinnedId);
        if (candidate) {
          rankedCandidates.unshift(
            rankCandidate(candidate, {
              pinned: true,
              selectedPath: selectedPathSet.has(candidate.path),
              changedInSelectedPr: changedPathSet.has(candidate.path),
              packagePath: scope.packagePath,
              role: scope.role,
              titleTerms,
              relevanceTerms: terms,
            }),
          );
        }
      }

      if (dependencies.scoreCandidate) {
        for (const ranked of rankedCandidates) {
          const score = dependencies.scoreCandidate(
            ranked,
            scope,
            input.prContext,
          );
          if (!score.ok) return score;
          ranked.score = score.value;
        }
        rankedCandidates.sort(compareRankedCandidates);
      }
      const { selectedFiles, duplicateFileAliases } = chooseFiles(
        rankedCandidates,
        pinnedIds,
        pinConflicts,
      );
      const limits =
        input.prContext.selectedPullRequests.length > MAX_SELECTED_PRS ||
        input.prContext.partial ||
        (input.prContext.omittedCount ?? 0) > 0 ||
        changedPathCount > MAX_CHANGED_PATHS ||
        invalidPrIdentity;
      const limitations: string[] = [];
      if (limits)
        limitations.push("PR history or changed-path coverage is partial.");
      if (prTitleBlocked)
        limitations.push(
          "A selected PR title contained sensitive content and was omitted.",
        );
      if (prTitleUntrusted)
        limitations.push(
          "Selected PR titles contain instruction-like text and are treated as untrusted data.",
        );
      if (input.prContext.selectedPullRequests.length === 0) {
        limitations.push(
          "No selected PR context was available; role and manual path scope guide retrieval.",
        );
      }
      if ((scope.contributionStatement ?? "").trim().length === 0) {
        limitations.push(
          "Personal contribution has not been described by the user.",
        );
      }
      if (pinConflicts.length > 0) {
        limitations.push(
          "One or more requested files could not be selected safely; narrow or replace those pins.",
        );
      }

      const missingDimensions = getPlanMissingDimensions(selectedFiles, scope);
      if (dependencies.requiredDimensions) {
        const dimensions = dependencies.requiredDimensions(scope);
        if (!dimensions.ok) return dimensions;
        if (
          dimensions.value.includes("measurement-context") &&
          !selectedFiles.some((f) => f.category === "measurement")
        )
          missingDimensions.push("measurement-context");
      }
      limitations.push(...evidenceRecoveryNotes(missingDimensions));
      const readiness = evidenceReadiness({
        missingDimensions,
        selectedCount: selectedFiles.length,
        pinConflicts: pinConflicts.length,
        partial: limits,
      });
      const status = readiness === "complete" ? "ready" : readiness;

      return {
        ok: true,
        value: {
          runId: input.context.runId,
          snapshotId: input.context.snapshotId,
          scope,
          selectedFiles,
          rankedCandidates,
          excludedFiles: deduplicateExclusions(exclusions),
          duplicateFileAliases,
          pinConflicts,
          limitations,
          removedFileIds: [...removedIds],
          prTitles,
          selectedPrContext,
          missingDimensions,
          status,
        },
      };
    },

    async pack(input: {
      selected: SelectionPlan;
      context: EvidenceExecutionContext;
    }): Promise<Result<PreparedEvidence>> {
      return packSelection(input.selected, input.context, dependencies);
    },
  };
}

function validateScope(scope: RepositoryScope): Result<void> {
  if (
    !scope ||
    typeof scope.repositoryId !== "string" ||
    !scope.repositoryId.trim() ||
    typeof scope.owner !== "string" ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37})$/.test(scope.owner) ||
    typeof scope.name !== "string" ||
    !/^[A-Za-z0-9_.-]{1,100}$/.test(scope.name) ||
    typeof scope.fullSha !== "string" ||
    !isSha(scope.fullSha)
  ) {
    return {
      ok: false,
      error: domainError(
        "invalid-input",
        "Repository scope is invalid or not pinned to a full revision.",
      ),
    };
  }
  if (
    (scope.role !== undefined &&
      (typeof scope.role !== "string" || scope.role.length > 160)) ||
    (scope.contributionStatement !== undefined &&
      (typeof scope.contributionStatement !== "string" ||
        scope.contributionStatement.length > 2_000)) ||
    (scope.ref !== undefined &&
      (typeof scope.ref !== "string" || scope.ref.length > 255))
  ) {
    return {
      ok: false,
      error: domainError(
        "invalid-input",
        "Contribution context exceeds its safe input bounds.",
      ),
    };
  }
  if (scope.packagePath && !normalizeRepositoryPath(scope.packagePath)) {
    return {
      ok: false,
      error: domainError(
        "invalid-input",
        "The selected package path is invalid.",
      ),
    };
  }
  if (
    scope.visibility &&
    scope.visibility !== "public" &&
    scope.visibility !== "private"
  ) {
    return {
      ok: false,
      error: domainError("invalid-input", "Repository visibility is invalid."),
    };
  }
  if (
    scope.selectedPrNumbers &&
    (!Array.isArray(scope.selectedPrNumbers) ||
      scope.selectedPrNumbers.length > MAX_SELECTED_PRS ||
      scope.selectedPrNumbers.some(
        (number) => !Number.isInteger(number) || number < 1,
      ))
  ) {
    return {
      ok: false,
      error: domainError("invalid-input", "Selected PR scope is invalid."),
    };
  }
  for (const paths of [scope.selectedPaths, scope.selectedPrPaths]) {
    if (paths === undefined) continue;
    if (
      !Array.isArray(paths) ||
      paths.length > MAX_CHANGED_PATHS ||
      paths.some((path) => !normalizeRepositoryPath(path))
    ) {
      return {
        ok: false,
        error: domainError(
          "invalid-input",
          "Selected repository paths are invalid.",
        ),
      };
    }
  }
  if (
    scope.canonicalUrl &&
    scope.canonicalUrl !== `https://github.com/${scope.owner}/${scope.name}`
  ) {
    return {
      ok: false,
      error: domainError("invalid-input", "Repository origin is invalid."),
    };
  }
  return { ok: true, value: undefined };
}

function rankCandidate(
  candidate: FileCandidate,
  signals: {
    pinned: boolean;
    selectedPath: boolean;
    changedInSelectedPr: boolean;
    packagePath?: string;
    role?: string;
    titleTerms: readonly string[];
    relevanceTerms: readonly string[];
  },
): RankedCandidate {
  const category = candidate.category ?? classifyPath(candidate.path);
  let score = CATEGORY_SCORE[category];
  const reasonCodes = [reasonForCategory(category)];
  if (signals.pinned) {
    score += 1_000;
    reasonCodes.unshift("user-pinned");
  }
  if (signals.selectedPath) reasonCodes.push("selected-contribution-path");
  if (signals.changedInSelectedPr) {
    reasonCodes.push("selected-pr-changed-path");
  }
  if (signals.selectedPath || signals.changedInSelectedPr) {
    score += 30;
  }
  const packagePath = signals.packagePath
    ? normalizeRepositoryPath(signals.packagePath)
    : null;
  if (
    packagePath &&
    (candidate.path === packagePath ||
      candidate.path.startsWith(`${packagePath}/`))
  ) {
    score += 20;
    reasonCodes.push("selected-package");
  }

  const pathTerms = pathWords(candidate.path);
  const roleWords = pathWords(signals.role ?? "");
  const roleMatches = roleWords.filter((word) =>
    pathTerms.includes(word),
  ).length;
  if (roleMatches > 0) {
    score += Math.min(12, roleMatches * 4);
    reasonCodes.push("role-path-hint");
  }

  const titleMatches = signals.titleTerms.filter((word) =>
    pathTerms.includes(word),
  ).length;
  if (
    titleMatches > 0 &&
    !signals.changedInSelectedPr &&
    !signals.selectedPath
  ) {
    score += Math.min(5, titleMatches * 2);
    reasonCodes.push("pr-title-hint");
  }
  const contributionMatches = signals.relevanceTerms.filter((word) =>
    pathTerms.includes(word),
  ).length;
  if (
    contributionMatches > 0 &&
    !signals.selectedPath &&
    !signals.changedInSelectedPr
  ) {
    score += Math.min(8, contributionMatches * 2);
    reasonCodes.push("contribution-term-hint");
  }
  if (category === "ui-style") reasonCodes.push("relevant-ui-style");

  return {
    candidate,
    category,
    score,
    reasonCodes: [...new Set(reasonCodes)],
    pinned: signals.pinned,
    selectedPath: signals.selectedPath,
    changedInSelectedPr: signals.changedInSelectedPr,
  };
}

function chooseFiles(
  ranked: RankedCandidate[],
  pinnedIds: Set<string>,
  pinConflicts: FileExclusion[],
): {
  selectedFiles: RankedCandidate[];
  duplicateFileAliases: DuplicateFileAlias[];
} {
  const selected: RankedCandidate[] = [];
  const aliases: DuplicateFileAlias[] = [];
  const seenBlob = new Map<string, RankedCandidate>();
  const categoryCounts = new Map<EvidenceCategory, number>();
  const selectedPathCount = () => selected.length + aliases.length;

  for (const item of ranked) {
    if (!pinnedIds.has(item.candidate.id)) continue;
    if (selectedPathCount() >= EVIDENCE_LIMITS.maxFilesPerRequest) {
      pinConflicts.push({
        fileId: item.candidate.id,
        path: item.candidate.path,
        reasonCode: "pinned-file-budget-conflict",
      });
      continue;
    }
    const duplicate = seenBlob.get(item.candidate.blobSha.toLowerCase());
    if (duplicate) {
      aliases.push({
        duplicateFileId: item.candidate.id,
        canonicalFileId: duplicate.candidate.id,
        path: item.candidate.path,
      });
      categoryCounts.set(
        item.category,
        (categoryCounts.get(item.category) ?? 0) + 1,
      );
      continue;
    }
    selected.push(item);
    seenBlob.set(item.candidate.blobSha.toLowerCase(), item);
    categoryCounts.set(
      item.category,
      (categoryCounts.get(item.category) ?? 0) + 1,
    );
  }

  const autoLimit = Math.min(
    EVIDENCE_LIMITS.maxFilesPerRequest,
    Math.max(MAX_AUTO_FILES, selectedPathCount()),
  );
  // Explicit scope keeps its order. Reserve a bounded automatic slot for a
  // related test instead of letting many equally ranked entrypoints crowd it out.
  const explicit = ranked.filter(
    (item) => item.selectedPath || item.changedInSelectedPr,
  );
  const automatic = ranked.filter(
    (item) => !item.selectedPath && !item.changedInSelectedPr,
  );
  const method = ranked.find((item) =>
    ["core-method", "product-surface", "helper"].includes(item.category),
  );
  const genericTerms = new Set([
    "src",
    "lib",
    "tests",
    "test",
    "spec",
    "unit",
    "integration",
    "app",
    "index",
    "page",
    "tsx",
    "jsx",
  ]);
  const methodTerms = new Set(
    method
      ? pathWords(method.candidate.path).filter(
          (word) => word.length > 2 && !genericTerms.has(word),
        )
      : [],
  );
  const corroboration = automatic.find(
    (item) =>
      item.category === "corroboration" &&
      pathWords(item.candidate.path).some((word) => methodTerms.has(word)),
  );
  const preferred = corroboration
    ? [method, corroboration].filter(
        (item): item is RankedCandidate =>
          Boolean(item) && automatic.includes(item!),
      )
    : [];
  const ordered = [
    ...explicit,
    ...preferred,
    ...automatic.filter((item) => !preferred.includes(item)),
  ];
  for (const item of ordered) {
    if (pinnedIds.has(item.candidate.id) || selectedPathCount() >= autoLimit)
      continue;
    const duplicate = seenBlob.get(item.candidate.blobSha.toLowerCase());
    if (duplicate) {
      aliases.push({
        duplicateFileId: item.candidate.id,
        canonicalFileId: duplicate.candidate.id,
        path: item.candidate.path,
      });
      categoryCounts.set(
        item.category,
        (categoryCounts.get(item.category) ?? 0) + 1,
      );
      continue;
    }

    const categoryCount = categoryCounts.get(item.category) ?? 0;
    const categoryLimit =
      item.category === "purpose" || item.category === "stack"
        ? 2
        : item.category === "corroboration"
          ? 4
          : item.category === "measurement"
            ? 2
            : item.category === "ui-style"
              ? 3
              : EVIDENCE_LIMITS.maxFilesPerRequest;
    if (categoryCount >= categoryLimit) continue;

    selected.push(item);
    seenBlob.set(item.candidate.blobSha.toLowerCase(), item);
    categoryCounts.set(item.category, categoryCount + 1);
  }
  return { selectedFiles: selected, duplicateFileAliases: aliases };
}

async function packSelection(
  plan: SelectionPlan,
  context: EvidenceExecutionContext,
  dependencies: EvidenceSelectorDependencies,
): Promise<Result<PreparedEvidence>> {
  if (context.runId !== plan.runId || context.snapshotId !== plan.snapshotId) {
    return {
      ok: false,
      error: domainError(
        "invalid-input",
        "Selection and execution context do not match.",
      ),
    };
  }
  if (context.signal?.aborted) {
    return {
      ok: false,
      error: domainError("cancelled", "Evidence preparation was cancelled."),
    };
  }
  if (isPastDeadline(context)) {
    return {
      ok: false,
      error: domainError(
        "interrupted",
        "Evidence preparation exceeded its deadline.",
      ),
    };
  }

  const excludedFiles = [...plan.excludedFiles];
  const limitations = [...plan.limitations];
  const pinConflicts = [...plan.pinConflicts];
  const duplicateFileAliases = [...plan.duplicateFileAliases];
  const replacementRecommendations: ReplacementRecommendation[] =
    pinConflicts.map((entry) => ({
      fileId: entry.fileId,
      reasonCode: entry.reasonCode,
      message:
        "Choose another safe file or narrow the contribution scope to fit this selection.",
    }));
  const fetched: Array<{ ranked: RankedCandidate; file: FetchedFile }> = [];
  let fetchedBytes = 0;
  const attempted = new Set<string>();
  const selected = [...plan.selectedFiles];
  const inventory = plan.rankedCandidates;
  let fetchedFileCount = 0;

  const fetchCandidate = async (ranked: RankedCandidate) => {
    if (attempted.has(ranked.candidate.id)) return;
    if (context.signal?.aborted)
      throw domainError("cancelled", "Evidence preparation was cancelled.");
    if (isPastDeadline(context))
      throw domainError(
        "interrupted",
        "Evidence preparation exceeded its deadline.",
      );
    if (attempted.size >= EVIDENCE_LIMITS.maxFetchedFiles) {
      excludedFiles.push({
        fileId: ranked.candidate.id,
        path: ranked.candidate.path,
        reasonCode: "fetch-count-budget",
      });
      recordPinConflict(ranked, "fetch-count-budget");
      return;
    }
    const expectedBytes = ranked.candidate.byteSize;
    if (fetchedBytes + expectedBytes > EVIDENCE_LIMITS.maxFetchedBytes) {
      excludedFiles.push({
        fileId: ranked.candidate.id,
        path: ranked.candidate.path,
        reasonCode: "fetch-byte-budget",
      });
      recordPinConflict(ranked, "fetch-byte-budget");
      return;
    }

    attempted.add(ranked.candidate.id);
    let result: Result<FetchedFile>;
    try {
      result = await dependencies.fetchFile({
        scope: plan.scope,
        candidate: ranked.candidate,
        maxBytes: EVIDENCE_LIMITS.maxFileBytes,
        context,
      });
    } catch {
      excludedFiles.push({
        fileId: ranked.candidate.id,
        path: ranked.candidate.path,
        reasonCode: "file-fetch-failed",
      });
      limitations.push(
        "Some selected file content could not be retrieved at the pinned revision.",
      );
      recordPinConflict(ranked, "file-fetch-failed");
      return;
    }
    if (!result.ok) {
      excludedFiles.push({
        fileId: ranked.candidate.id,
        path: ranked.candidate.path,
        reasonCode: safeFetchReason(result.error),
      });
      limitations.push(
        "Some selected file content could not be retrieved at the pinned revision.",
      );
      recordPinConflict(ranked, safeFetchReason(result.error));
      return;
    }

    if (
      !result.value ||
      typeof result.value.text !== "string" ||
      typeof result.value.blobSha !== "string" ||
      !Number.isSafeInteger(result.value.byteSize)
    ) {
      excludedFiles.push({
        fileId: ranked.candidate.id,
        path: ranked.candidate.path,
        reasonCode: "invalid-fetched-content",
      });
      recordPinConflict(ranked, "invalid-fetched-content");
      return;
    }
    const actualBytes = Buffer.byteLength(result.value.text, "utf8");
    if (
      result.value.blobSha.toLowerCase() !==
        ranked.candidate.blobSha.toLowerCase() ||
      actualBytes > EVIDENCE_LIMITS.maxFileBytes ||
      actualBytes !== result.value.byteSize ||
      fetchedBytes + actualBytes > EVIDENCE_LIMITS.maxFetchedBytes
    ) {
      excludedFiles.push({
        fileId: ranked.candidate.id,
        path: ranked.candidate.path,
        reasonCode: "content-boundary-mismatch",
      });
      limitations.push(
        "A file did not match its pinned inventory metadata or exceeded the local content bounds.",
      );
      recordPinConflict(ranked, "content-boundary-mismatch");
      return;
    }

    fetchedBytes += actualBytes;
    fetchedFileCount += 1;
    const contentCheck = inspectFileContent(
      result.value.text,
      ranked.candidate.path,
    );
    if (!contentCheck.safe) {
      excludedFiles.push({
        fileId: ranked.candidate.id,
        path: ranked.candidate.path,
        reasonCode: contentCheck.reasonCode ?? "unsafe-content",
      });
      recordPinConflict(ranked, contentCheck.reasonCode ?? "unsafe-content");
      return;
    }
    fetched.push({
      ranked,
      file: {
        ...result.value,
        text: normalizeSourceText(result.value.text),
        byteSize: actualBytes,
      },
    });
    if (contentCheck.staleDocumentation) {
      limitations.push(
        "Planning language was found in overview documentation; current implementation controls behavior claims.",
      );
    }
    if (contentCheck.untrustedInstructions) {
      limitations.push(
        "Repository excerpts include instruction-like text and must be treated as untrusted source data.",
      );
    }
  };

  function recordPinConflict(ranked: RankedCandidate, reasonCode: string) {
    if (
      !ranked.pinned ||
      pinConflicts.some((entry) => entry.fileId === ranked.candidate.id)
    )
      return;
    pinConflicts.push({
      fileId: ranked.candidate.id,
      path: ranked.candidate.path,
      reasonCode,
    });
    replacementRecommendations.push({
      fileId: ranked.candidate.id,
      reasonCode,
      message:
        reasonCode === "secret-content" || reasonCode === "secret-bearing-path"
          ? "This pinned file contains sensitive material and cannot be included; choose a different safe file."
          : "This pinned file cannot fit the current evidence limits; choose another safe file or narrow the contribution scope.",
    });
  }

  async function checkBudget(
    request: BudgetSelectionRequest,
  ): Promise<Result<BudgetAdmission>> {
    try {
      return await context.budgetLedger.checkSelection(request);
    } catch {
      return {
        ok: false,
        error: domainError(
          "unavailable",
          "The shared evidence budget could not be checked.",
          true,
        ),
      };
    }
  }

  try {
    for (const ranked of selected) await fetchCandidate(ranked);
  } catch (error) {
    const domain = isDomainError(error)
      ? error
      : domainError("unavailable", "Evidence preparation could not continue.");
    return { ok: false, error: domain };
  }

  const referenced = findReferencedCandidates(
    fetched,
    inventory,
    plan.removedFileIds,
  );
  if (referenced.unresolvedCount > 0) {
    limitations.push(
      "Some local imports or aliases could not be resolved in the bounded inventory; related coverage may be incomplete.",
    );
  }
  try {
    for (const ranked of referenced.candidates.slice(0, MAX_AUTO_REFERENCES)) {
      if (
        selected.length + plan.duplicateFileAliases.length >=
        EVIDENCE_LIMITS.maxFilesPerRequest
      )
        break;
      if (
        plan.selectedFiles.some(
          (entry) => entry.candidate.id === ranked.candidate.id,
        )
      )
        continue;
      selected.push({
        ...ranked,
        reasonCodes: [...ranked.reasonCodes, "related-helper"],
      });
      await fetchCandidate(selected.at(-1)!);
    }
  } catch (error) {
    const domain = isDomainError(error)
      ? error
      : domainError("unavailable", "Evidence preparation could not continue.");
    return { ok: false, error: domain };
  }

  const selectedPathNames = new Set(
    selected.map(({ candidate }) => candidate.path),
  );
  let prContextCharacters = 0;
  let prContextWasTrimmed = false;
  const includedPrPaths = new Set<string>();
  const selectedPrContext: PreparedPrContext[] = plan.selectedPrContext.map(
    (pr) => {
      let title = pr.title;
      if (
        title &&
        prContextCharacters + title.length <= MAX_PR_CONTEXT_CHARACTERS
      ) {
        prContextCharacters += title.length;
      } else if (title) {
        title = undefined;
        prContextWasTrimmed = true;
      }
      const changedPaths: string[] = [];
      for (const path of pr.changedPaths) {
        if (!selectedPathNames.has(path) || includedPrPaths.has(path)) continue;
        if (
          changedPaths.length >= EVIDENCE_LIMITS.maxFilesPerRequest ||
          prContextCharacters + path.length > MAX_PR_CONTEXT_CHARACTERS
        ) {
          prContextWasTrimmed = true;
          continue;
        }
        changedPaths.push(path);
        includedPrPaths.add(path);
        prContextCharacters += path.length;
      }
      return {
        number: pr.number,
        ...(title ? { title } : {}),
        changedPaths,
        untrustedSource: true as const,
      };
    },
  );
  if (prContextWasTrimmed) {
    limitations.push(
      "Some selected PR context was omitted to stay within the bounded prompt context.",
    );
  }

  const evidence: EvidenceItem[] = [];
  const evidenceByHash = new Map<string, EvidenceItem>();
  const selectedFileIds: string[] = [];
  const lineRangesByFile = new Map<
    string,
    Array<{ lineStart: number; lineEnd: number }>
  >();
  let totalCharacters = 0;
  let transmittedLineCount = 0;
  let uniqueLineCount = 0;

  for (const { ranked, file } of fetched) {
    if (!selectedFileIds.includes(ranked.candidate.id))
      selectedFileIds.push(ranked.candidate.id);
    const contentCheck = inspectFileContent(file.text, ranked.candidate.path);
    const terms = collectRelevanceTerms(plan.scope, plan.prTitles);
    const blocks = extractMeaningfulBlocks(
      file.text,
      ranked.candidate.path,
      ranked.category,
      terms,
    );
    if (blocks.length === 0) {
      excludedFiles.push({
        fileId: ranked.candidate.id,
        path: ranked.candidate.path,
        reasonCode: "no-complete-meaningful-block",
      });
      if (ranked.pinned) {
        pinConflicts.push({
          fileId: ranked.candidate.id,
          path: ranked.candidate.path,
          reasonCode: "pinned-block-does-not-fit",
        });
        replacementRecommendations.push({
          fileId: ranked.candidate.id,
          reasonCode: "pinned-block-does-not-fit",
          message:
            "Choose a smaller complete source block or narrow the pinned file scope.",
        });
      }
      continue;
    }

    let admittedForFile = 0;
    for (const block of blocks) {
      const already = lineRangesByFile.get(ranked.candidate.id) ?? [];
      const nextRanges = mergeLineRanges([
        ...already,
        { lineStart: block.lineStart, lineEnd: block.lineEnd },
      ]);
      const nextFileLines = countRanges(nextRanges);
      const excerptHash = sha256(block.excerpt);
      const duplicate = evidenceByHash.get(excerptHash);
      const nextCharacters =
        totalCharacters + (duplicate ? 0 : block.excerpt.length);
      const nextTotalLines =
        transmittedLineCount +
        (duplicate ? 0 : block.lineEnd - block.lineStart + 1);
      if (
        nextFileLines > EVIDENCE_LIMITS.maxLinesPerFile ||
        block.excerpt.length > EVIDENCE_LIMITS.maxCharsPerFile ||
        nextTotalLines > EVIDENCE_LIMITS.maxLinesPerRequest ||
        nextCharacters > EVIDENCE_LIMITS.maxCharsPerRequest
      ) {
        if (ranked.pinned) {
          pinConflicts.push({
            fileId: ranked.candidate.id,
            path: ranked.candidate.path,
            reasonCode: "pinned-selection-budget-conflict",
          });
          replacementRecommendations.push({
            fileId: ranked.candidate.id,
            reasonCode: "pinned-selection-budget-conflict",
            message:
              "This safe pin exceeds the excerpt limits; remove optional excerpts or narrow the pinned source scope.",
          });
        }
        continue;
      }

      if (duplicate) {
        if (!duplicate.alternateOrigins.includes(ranked.candidate.path)) {
          const canonicalFileId = plan.rankedCandidates.find(
            (candidate) => candidate.candidate.path === duplicate.path,
          )?.candidate.id;
          const alias = canonicalFileId
            ? {
                duplicateFileId: ranked.candidate.id,
                canonicalFileId,
                path: ranked.candidate.path,
              }
            : undefined;
          if (
            alias &&
            !duplicateFileAliases.some(
              (entry) => entry.duplicateFileId === alias.duplicateFileId,
            )
          ) {
            const withAlias: SelectionPlan = {
              ...plan,
              duplicateFileAliases: [...duplicateFileAliases, alias],
            };
            const admission = await checkBudget(
              makeBudgetRequest(
                context,
                withAlias,
                selectedPrContext,
                evidence,
                {
                  ...duplicate,
                  path: alias.path,
                  blobSha: ranked.candidate.blobSha,
                  lineStart: block.lineStart,
                  lineEnd: block.lineEnd,
                  excerpt: block.excerpt,
                },
                file.byteSize,
                fetchedBytes,
                totalCharacters,
                transmittedLineCount,
              ),
            );
            if (!admission.ok && admission.error.code !== "limit-exceeded")
              return admission;
            if (!admission.ok || !admission.value.allowed) {
              excludedFiles.push({
                fileId: ranked.candidate.id,
                path: ranked.candidate.path,
                reasonCode: "shared-budget-conflict",
              });
              limitations.push(
                "Duplicate source paths exceeded the shared distinct-file budget.",
              );
              if (ranked.pinned)
                recordPinConflict(ranked, "shared-budget-conflict");
              continue;
            }
            duplicateFileAliases.push(alias);
            uniqueLineCount += block.lineEnd - block.lineStart + 1;
          }
          duplicate.alternateOrigins.push(ranked.candidate.path);
        }
        continue;
      }

      const evidenceItem: EvidenceItem = {
        id: `github-evidence-${sha256(`${plan.scope.repositoryId}:${plan.scope.fullSha}:${ranked.candidate.path}:${block.lineStart}:${block.lineEnd}:${excerptHash}`).slice(0, 24)}`,
        snapshotId: plan.snapshotId,
        repositoryId: plan.scope.repositoryId,
        fullSha: plan.scope.fullSha,
        path: ranked.candidate.path,
        blobSha: ranked.candidate.blobSha,
        lineStart: block.lineStart,
        lineEnd: block.lineEnd,
        excerpt: block.excerpt,
        excerptHash,
        category: block.category,
        reasonCodes: ranked.reasonCodes,
        sourceClassification:
          block.category === "purpose" ? "documented" : "observed",
        untrustedSource: contentCheck.untrustedInstructions,
        alternateOrigins: duplicateFileAliases
          .filter((alias) => alias.canonicalFileId === ranked.candidate.id)
          .map((alias) => alias.path),
      };

      const proposal = makeBudgetRequest(
        context,
        plan,
        selectedPrContext,
        evidence,
        evidenceItem,
        file.byteSize,
        fetchedBytes,
        totalCharacters + block.excerpt.length,
        transmittedLineCount + (block.lineEnd - block.lineStart + 1),
      );
      const admission = await checkBudget(proposal);
      if (!admission.ok) {
        if (admission.error.code !== "limit-exceeded") return admission;
        if (ranked.pinned) {
          pinConflicts.push({
            fileId: ranked.candidate.id,
            path: ranked.candidate.path,
            reasonCode: "shared-budget-conflict",
          });
          replacementRecommendations.push({
            fileId: ranked.candidate.id,
            reasonCode: "shared-budget-conflict",
            message:
              "The shared run budget cannot fit this pin; replace another selection or narrow the contribution scope.",
          });
        }
        limitations.push(
          "The shared run budget excluded optional evidence; the bundle may not cover every required dimension.",
        );
        continue;
      }
      if (!admission.value.allowed) {
        if (ranked.pinned) {
          pinConflicts.push({
            fileId: ranked.candidate.id,
            path: ranked.candidate.path,
            reasonCode: "shared-budget-conflict",
          });
          replacementRecommendations.push({
            fileId: ranked.candidate.id,
            reasonCode: "shared-budget-conflict",
            message:
              "The shared run budget cannot fit this pin; replace another selection or narrow the contribution scope.",
          });
        }
        limitations.push(
          "The shared run budget excluded optional evidence; the bundle may not cover every required dimension.",
        );
        continue;
      }

      evidence.push(evidenceItem);
      evidenceByHash.set(excerptHash, evidenceItem);
      lineRangesByFile.set(ranked.candidate.id, nextRanges);
      uniqueLineCount += nextFileLines - countRanges(already);
      totalCharacters += block.excerpt.length;
      transmittedLineCount += block.lineEnd - block.lineStart + 1;
      admittedForFile += 1;
    }
    if (
      admittedForFile === 0 &&
      ranked.pinned &&
      !pinConflicts.some((entry) => entry.fileId === ranked.candidate.id)
    ) {
      pinConflicts.push({
        fileId: ranked.candidate.id,
        path: ranked.candidate.path,
        reasonCode: "pinned-file-not-included",
      });
    }
  }

  for (const alias of duplicateFileAliases) {
    const canonicalPath = plan.rankedCandidates.find(
      (candidate) => candidate.candidate.id === alias.canonicalFileId,
    )?.candidate.path;
    if (
      canonicalPath &&
      evidence.some((item) => item.path === canonicalPath) &&
      selectedFileIds.includes(alias.canonicalFileId) &&
      !selectedFileIds.includes(alias.duplicateFileId)
    ) {
      selectedFileIds.push(alias.duplicateFileId);
    }
  }

  for (const alias of plan.duplicateFileAliases) {
    const canonicalPath = plan.rankedCandidates.find(
      (candidate) => candidate.candidate.id === alias.canonicalFileId,
    )?.candidate.path;
    const canonicalRanges = evidence
      .filter((item) => item.path === canonicalPath)
      .map((item) => ({ lineStart: item.lineStart, lineEnd: item.lineEnd }));
    if (canonicalRanges.length > 0) {
      uniqueLineCount += countRanges(mergeLineRanges(canonicalRanges));
    }
  }

  const missingDimensions = deriveMissingDimensions(
    evidence,
    plan.scope,
    plan.missingDimensions,
  );
  limitations.push(...evidenceRecoveryNotes(missingDimensions));
  const completeness = evidenceReadiness({
    missingDimensions,
    selectedCount: evidence.length,
    pinConflicts: pinConflicts.length,
    partial: limitations.length > 0 || excludedFiles.length > 0,
  });

  const selectionHash = sha256(
    JSON.stringify({
      scope: canonicalScopeForHash(plan.scope),
      selectedPrContext,
      selectedFileIds,
      evidence: evidence.map((item) => ({
        id: item.id,
        excerptHash: item.excerptHash,
        lineStart: item.lineStart,
        lineEnd: item.lineEnd,
      })),
      missingDimensions,
      pinConflicts: pinConflicts.map(({ fileId, reasonCode }) => ({
        fileId,
        reasonCode,
      })),
    }),
  );

  return {
    ok: true,
    value: {
      runId: plan.runId,
      snapshotId: plan.snapshotId,
      scope: plan.scope,
      selectedPrContext,
      repositoryId: plan.scope.repositoryId,
      fullSha: plan.scope.fullSha,
      selectedFileIds,
      duplicateFileAliases,
      evidence,
      excludedFiles: deduplicateExclusions(excludedFiles),
      pinConflicts: deduplicateExclusions(pinConflicts),
      replacementRecommendations: deduplicateRecommendations(
        replacementRecommendations,
      ),
      limitations: [...new Set(limitations)],
      missingDimensions,
      completeness,
      fetchedFileCount,
      fetchedBytes,
      uniqueLineCount,
      transmittedLineCount,
      totalCharacters,
      selectionHash,
      requiresConsent: true,
    },
  };
}

function makeBudgetRequest(
  context: EvidenceExecutionContext,
  plan: SelectionPlan,
  selectedPrContext: PreparedPrContext[],
  existing: EvidenceItem[],
  next: EvidenceItem,
  fileBytes: number,
  totalFetchedBytes: number,
  totalCharacters: number,
  transmittedLineCount: number,
): BudgetSelectionRequest {
  const items = [...existing, next];
  const grouped = new Map<string, BudgetFileSelection>();
  for (const item of items) {
    const entry = grouped.get(item.path) ?? {
      fileId:
        plan.rankedCandidates.find(
          (candidate) => candidate.candidate.path === item.path,
        )?.candidate.id ?? item.path,
      path: item.path,
      blobSha: item.blobSha,
      ranges: [],
      bytes: item.path === next.path ? fileBytes : 0,
      characters: 0,
      transmitted: true,
    };
    entry.ranges.push({ lineStart: item.lineStart, lineEnd: item.lineEnd });
    entry.characters += item.excerpt.length;
    grouped.set(item.path, entry);
  }
  for (const alias of plan.duplicateFileAliases) {
    const canonical = grouped.get(
      plan.rankedCandidates.find(
        (candidate) => candidate.candidate.id === alias.canonicalFileId,
      )?.candidate.path ?? "",
    );
    if (!canonical) continue;
    grouped.set(alias.path, {
      fileId: alias.duplicateFileId,
      path: alias.path,
      blobSha: canonical.blobSha,
      ranges: [...canonical.ranges],
      bytes: 0,
      characters: 0,
      transmitted: false,
    });
  }
  const allRanges = [...grouped.values()].flatMap((file) =>
    mergeLineRanges(file.ranges),
  );
  const prContextCharacters = selectedPrContext.reduce(
    (total, pr) =>
      total +
      (pr.title?.length ?? 0) +
      pr.changedPaths.reduce((sum, path) => sum + path.length, 0),
    0,
  );
  const contextCharacters =
    prContextCharacters +
    (plan.scope.contributionStatement?.length ?? 0) +
    (plan.scope.role?.length ?? 0) +
    plan.scope.owner.length +
    plan.scope.name.length;
  const estimatedSourceTokens = Math.ceil(totalCharacters / 2);
  const estimatedPrContextTokens = Math.ceil(prContextCharacters / 2);
  return {
    runId: context.runId,
    requestKind: context.requestKind ?? "initial",
    files: [...grouped.values()].map((file) => ({
      ...file,
      ranges: mergeLineRanges(file.ranges),
    })),
    uniqueLineCount: allRanges.reduce(
      (count, range) => count + range.lineEnd - range.lineStart + 1,
      0,
    ),
    transmittedLineCount,
    totalCharacters,
    prContextCharacters,
    contextCharacters,
    estimatedSourceTokens,
    estimatedPrContextTokens,
    estimatedInputTokens:
      Math.ceil(contextCharacters / 2) + estimatedSourceTokens,
    totalFetchedBytes,
  };
}

function findReferencedCandidates(
  fetched: Array<{ ranked: RankedCandidate; file: FetchedFile }>,
  inventory: RankedCandidate[],
  removedFileIds: string[],
): { candidates: RankedCandidate[]; unresolvedCount: number } {
  const removed = new Set(removedFileIds);
  const byPath = new Map(
    inventory.map((entry) => [entry.candidate.path, entry]),
  );
  const referenced = new Map<string, RankedCandidate>();
  let unresolvedCount = 0;
  for (const { ranked, file } of fetched) {
    if (
      ranked.category !== "product-surface" &&
      ranked.category !== "core-method"
    )
      continue;
    for (const specifier of extractLocalImports(file.text)) {
      const resolvedPath = resolveImportPath(
        ranked.candidate.path,
        specifier,
        byPath,
      );
      if (!resolvedPath) {
        unresolvedCount += 1;
        continue;
      }
      const target = byPath.get(resolvedPath);
      if (
        !target ||
        removed.has(target.candidate.id) ||
        target.category === "purpose" ||
        target.category === "stack"
      )
        continue;
      referenced.set(target.candidate.id, {
        ...target,
        category: target.category === "unknown" ? "helper" : target.category,
        score: target.score + 12,
        reasonCodes: [...new Set([...target.reasonCodes, "related-helper"])],
      });
    }
  }

  const implementationBases = new Set(
    fetched
      .filter(
        ({ ranked }) =>
          ranked.category === "core-method" ||
          ranked.category === "product-surface",
      )
      .map(({ ranked }) => baseName(ranked.candidate.path)),
  );
  for (const candidate of inventory) {
    if (
      candidate.category !== "corroboration" ||
      removed.has(candidate.candidate.id)
    )
      continue;
    const name = baseName(candidate.candidate.path);
    if (
      [...implementationBases].some(
        (base) => name.includes(base) || base.includes(name),
      )
    ) {
      referenced.set(candidate.candidate.id, {
        ...candidate,
        score: candidate.score + 10,
        reasonCodes: [...new Set([...candidate.reasonCodes, "related-test"])],
      });
    }
  }
  return {
    candidates: [...referenced.values()].sort(compareRankedCandidates),
    unresolvedCount,
  };
}

function extractLocalImports(source: string): string[] {
  const imports = new Set<string>();
  const patterns = [
    /\b(?:from\s*|import\s*)["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    /^\s*from\s+(\.{1,2}[\w./]*)\s+import\b/gm,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const value = match[1];
      if (
        value.startsWith(".") ||
        value.startsWith("@/") ||
        value.startsWith("~/")
      )
        imports.add(value);
    }
  }
  return [...imports];
}

function resolveImportPath(
  sourcePath: string,
  specifier: string,
  inventory: Map<string, RankedCandidate>,
): string | null {
  const stack = sourcePath.split("/");
  stack.pop();
  for (const segment of specifier.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") {
      if (stack.length === 0) return null;
      stack.pop();
    } else {
      stack.push(segment);
    }
  }
  const base = stack.join("/");
  const possible = [
    base,
    ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"].map(
      (extension) => `${base}${extension}`,
    ),
    ...["index.ts", "index.tsx", "index.js", "index.jsx", "__init__.py"].map(
      (name) => `${base}/${name}`,
    ),
  ];
  return possible.find((path) => inventory.has(path)) ?? null;
}

function deriveMissingDimensions(
  evidence: EvidenceItem[],
  scope: RepositoryScope,
  prior: EvidenceDimension[],
): EvidenceDimension[] {
  const categories = new Set(evidence.map((item) => item.category));
  const missing = new Set(prior);
  if (!categories.has("purpose") && !(scope.contributionStatement ?? "").trim())
    missing.add("purpose");
  if (
    !categories.has("core-method") &&
    !categories.has("product-surface") &&
    !categories.has("helper")
  ) {
    missing.add("method");
  } else {
    missing.delete("method");
  }
  if (!(scope.contributionStatement ?? "").trim()) missing.add("attribution");
  else missing.delete("attribution");
  if (!categories.has("corroboration")) missing.add("corroboration");
  else missing.delete("corroboration");
  return [...missing].sort();
}

function canonicalScopeForHash(scope: RepositoryScope) {
  return {
    repositoryId: scope.repositoryId,
    owner: scope.owner,
    name: scope.name,
    canonicalUrl: scope.canonicalUrl ?? null,
    visibility: scope.visibility ?? null,
    ref: scope.ref ?? null,
    fullSha: scope.fullSha.toLowerCase(),
    packagePath: scope.packagePath ?? null,
    selectedPaths: [...(scope.selectedPaths ?? [])].sort(),
    selectedPrNumbers: [...(scope.selectedPrNumbers ?? [])].sort(
      (left, right) => left - right,
    ),
    selectedPrPaths: [...(scope.selectedPrPaths ?? [])].sort(),
    contributionStatement: scope.contributionStatement?.trim() ?? null,
    identitySource: scope.identitySource ?? "unknown",
    role: scope.role?.trim() ?? null,
  };
}

function getPlanMissingDimensions(
  selected: RankedCandidate[],
  scope: RepositoryScope,
): EvidenceDimension[] {
  const categories = new Set(selected.map((entry) => entry.category));
  const missing: EvidenceDimension[] = [];
  if (!categories.has("purpose") && !(scope.contributionStatement ?? "").trim())
    missing.push("purpose");
  if (
    !categories.has("core-method") &&
    !categories.has("product-surface") &&
    !categories.has("helper")
  )
    missing.push("method");
  if (!(scope.contributionStatement ?? "").trim()) missing.push("attribution");
  if (!categories.has("corroboration")) missing.push("corroboration");
  return missing;
}

function collectRelevanceTerms(
  scope: RepositoryScope,
  titles: readonly string[],
): string[] {
  const source = `${scope.role ?? ""} ${scope.contributionStatement ?? ""} ${titles.join(" ")}`;
  return [
    ...new Set(
      pathWords(source).filter(
        (word) => word.length > 2 && !TITLE_STOP_WORDS.has(word),
      ),
    ),
  ].slice(0, 40);
}

function collectContributionTerms(scope: RepositoryScope): string[] {
  const source = `${scope.role ?? ""} ${scope.contributionStatement ?? ""}`;
  return [
    ...new Set(
      pathWords(source).filter(
        (word) => word.length > 2 && !TITLE_STOP_WORDS.has(word),
      ),
    ),
  ].slice(0, 40);
}

function collectTitleTerms(titles: readonly string[]): string[] {
  return [
    ...new Set(
      pathWords(titles.join(" ")).filter((word) => !TITLE_STOP_WORDS.has(word)),
    ),
  ].slice(0, 20);
}

function pathWords(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isUiScoped(
  role: string | undefined,
  titles: readonly string[],
  selectedPaths: Set<string>,
  changedPaths: Set<string>,
): boolean {
  return (
    /\b(?:ui|ux|frontend|front-end|dashboard|web|visual|responsive|component|style)\b/i.test(
      `${role ?? ""} ${titles.join(" ")}`,
    ) ||
    [...selectedPaths, ...changedPaths].some((path) =>
      /\.(?:css|scss|sass|less)$/i.test(path),
    )
  );
}

function reasonForCategory(category: EvidenceCategory): string {
  switch (category) {
    case "purpose":
      return "purpose-context";
    case "stack":
      return "stack-context";
    case "product-surface":
      return "product-boundary";
    case "core-method":
      return "implementation-method";
    case "corroboration":
      return "corroborating-test";
    case "measurement":
      return "measurement-context";
    case "ui-style":
      return "ui-style-evidence";
    case "helper":
      return "supporting-helper";
    default:
      return "candidate-relevance";
  }
}

function compareRankedCandidates(
  left: RankedCandidate,
  right: RankedCandidate,
): number {
  return (
    right.score - left.score ||
    left.candidate.path.localeCompare(right.candidate.path)
  );
}

function isPastDeadline(context: EvidenceExecutionContext): boolean {
  return Boolean(
    context.deadlineAt &&
    context.clock().getTime() > Date.parse(context.deadlineAt),
  );
}

function countRanges(
  ranges: readonly { lineStart: number; lineEnd: number }[],
): number {
  return ranges.reduce(
    (count, range) => count + range.lineEnd - range.lineStart + 1,
    0,
  );
}

function safeFetchReason(error: DomainError): string {
  switch (error.code) {
    case "cancelled":
      return "fetch-cancelled";
    case "interrupted":
      return "fetch-interrupted";
    case "limit-exceeded":
      return "fetch-budget-exceeded";
    case "not-found":
      return "file-unavailable";
    case "forbidden":
      return "file-access-unavailable";
    default:
      return "file-fetch-failed";
  }
}

function isDomainError(value: unknown): value is DomainError {
  return Boolean(
    value &&
    typeof value === "object" &&
    "code" in value &&
    "message" in value &&
    "retryable" in value,
  );
}

function isSha(value: string): boolean {
  return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value);
}

function baseName(path: string): string {
  const name = path.split("/").at(-1) ?? path;
  return name
    .replace(/\.(?:test|spec)\.[^.]+$/i, "")
    .replace(/\.[^.]+$/, "")
    .toLowerCase();
}

function deduplicateExclusions(exclusions: FileExclusion[]): FileExclusion[] {
  const seen = new Set<string>();
  return exclusions.filter((entry) => {
    const key = `${entry.fileId}:${entry.reasonCode}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deduplicateRecommendations(
  recommendations: ReplacementRecommendation[],
): ReplacementRecommendation[] {
  const seen = new Set<string>();
  return recommendations.filter((entry) => {
    const key = `${entry.fileId}:${entry.reasonCode}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
