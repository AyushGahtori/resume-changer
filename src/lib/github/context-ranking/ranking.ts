import {
  RANKING_ALGORITHM_VERSION,
  type ContributionScope,
  type DependencyGraph,
  type EvidenceRole,
  type ExcludedCandidate,
  type FeatureCoverage,
  type ProjectMap,
  type RankedCandidate,
  type RankingContext,
  type RankingResult,
  type ScreenedSection,
  type SelectionBudget,
  type SelectionRequest,
  type SelectionResult,
  type ScoreComponents,
} from "./types";
import {
  buildDependencyGraph,
  effectiveEvidenceRole,
  normalizeRepositoryPath,
  relatedImplementationTargets,
} from "./graph";

export const RANKING_WEIGHTS = {
  scopeRelevance: 1.2,
  featureGain: 3.2,
  implementationDepth: 1.8,
  dependencyRelevance: 1.25,
  provenanceConfidence: 1,
  roleFit: 1.5,
  redundancy: 2,
  costEfficiency: 0.75,
} as const;

const ROLE_FIT: Readonly<Record<EvidenceRole, number>> = {
  overview: 0.85,
  implementation: 1,
  verification: 0.55,
  configuration: 0.5,
  unknown: 0.25,
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface RankCandidatesRequest {
  projectMap: ProjectMap;
  sections: readonly ScreenedSection[];
  context: RankingContext;
  graph?: DependencyGraph;
  selectedSectionIds?: readonly string[];
  pinnedSectionIds?: readonly string[];
}

interface CandidateValidation {
  eligible: ScreenedSection[];
  excluded: ExcludedCandidate[];
  diagnostics: string[];
}

interface DependencySignals {
  nodesByPath: ReadonlyMap<string, DependencyGraph["nodes"][number]>;
  incomingByPath: ReadonlyMap<
    string,
    readonly DependencyGraph["edges"][number][]
  >;
  implementationTargetsByWrapper: ReadonlyMap<string, readonly string[]>;
  wrapperSourcesByImplementation: ReadonlyMap<string, readonly string[]>;
  entrypointPaths: ReadonlySet<string>;
}

function buildDependencySignals(
  graph: DependencyGraph,
  projectMap: ProjectMap,
): DependencySignals {
  const nodesByPath = new Map(graph.nodes.map((node) => [node.path, node]));
  const incomingByPath = new Map<string, DependencyGraph["edges"][number][]>();
  for (const edge of graph.edges) {
    if (edge.status !== "resolved" || !edge.toPath) continue;
    const incoming = incomingByPath.get(edge.toPath) ?? [];
    incoming.push(edge);
    incomingByPath.set(edge.toPath, incoming);
  }
  const implementationTargetsByWrapper = new Map<string, readonly string[]>();
  const wrapperSourcesByImplementation = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (!node.isThinWrapper) continue;
    const targets = relatedImplementationTargets(graph, node.path);
    implementationTargetsByWrapper.set(node.path, targets);
    for (const target of targets) {
      const wrappers = wrapperSourcesByImplementation.get(target) ?? [];
      wrappers.push(node.path);
      wrapperSourcesByImplementation.set(target, wrappers);
    }
  }
  for (const [target, wrappers] of wrapperSourcesByImplementation) {
    wrapperSourcesByImplementation.set(target, [...new Set(wrappers)].sort());
  }
  const entrypointPaths = new Set(
    projectMap.packageBoundaries
      .flatMap((item) => item.entrypoints ?? [])
      .map((path) => normalizeRepositoryPath(path))
      .filter((path): path is string => path !== null),
  );
  return {
    nodesByPath,
    incomingByPath,
    implementationTargetsByWrapper,
    wrapperSourcesByImplementation,
    entrypointPaths,
  };
}

function isWithin(path: string, root: string): boolean {
  return root === "" || path === root || path.startsWith(`${root}/`);
}

function scopePathMatch(path: string, paths: readonly string[]): boolean {
  const normalizedCandidate = normalizeRepositoryPath(path);
  if (!normalizedCandidate) return false;
  return paths.some((rawPath) => {
    const normalizedPath = normalizeRepositoryPath(rawPath, true);
    return (
      normalizedPath !== null && isWithin(normalizedCandidate, normalizedPath)
    );
  });
}

function explicitScopeMatch(
  section: ScreenedSection,
  scope: ContributionScope,
): boolean {
  const paths = scope.paths ?? [];
  const features = new Set(scope.featureIds ?? []);
  if (paths.length === 0 && features.size === 0) return true;
  return (
    scopePathMatch(section.path, paths) ||
    (section.featureTargets ?? []).some((featureId) => features.has(featureId))
  );
}

function scopeRelevance(
  section: ScreenedSection,
  scope: ContributionScope,
): number {
  const pathMatch = scopePathMatch(section.path, scope.paths ?? []);
  const featureIds = new Set(scope.featureIds ?? []);
  const featureMatch = (section.featureTargets ?? []).some((featureId) =>
    featureIds.has(featureId),
  );
  const match = pathMatch || featureMatch;
  const confidence =
    scope.source === "user-confirmed"
      ? 1
      : scope.source === "user-reported"
        ? 0.86
        : scope.source === "repository-suggestion"
          ? 0.58
          : 0.75;

  if (match) return confidence;
  switch (scope.mode) {
    case "whole-project":
      // This supports discovery breadth; it is not an authorship assertion.
      return 0.58;
    case "selected-areas":
      return 0.18;
    case "shared":
      return 0.34;
    case "unsure":
      return 0.25;
  }
}

function validateCandidates(
  projectMap: ProjectMap,
  sections: readonly ScreenedSection[],
  scope: ContributionScope,
): CandidateValidation {
  const eligible: ScreenedSection[] = [];
  const excluded: ExcludedCandidate[] = [];
  const diagnostics = new Set<string>();
  const ids = new Set<string>();

  for (const section of sections) {
    if (ids.has(section.id)) {
      excluded.push({
        sectionId: section.id,
        path: section.path,
        reason: "duplicate-section-id",
      });
      diagnostics.add("duplicate-section-id");
      continue;
    }
    ids.add(section.id);

    if (!section.safety.eligible || section.safety.screening === "unsafe") {
      excluded.push({
        sectionId: section.id,
        path: section.path,
        reason: "unsafe-section",
      });
      continue;
    }
    if (section.safety.screening !== "safe") {
      excluded.push({
        sectionId: section.id,
        path: section.path,
        reason: "unreviewed-section",
      });
      continue;
    }
    if (
      section.provenance.repositoryId !== projectMap.repository.repositoryId
    ) {
      excluded.push({
        sectionId: section.id,
        path: section.path,
        reason: "foreign-repository",
      });
      continue;
    }
    if (section.provenance.commitSha !== projectMap.repository.commitSha) {
      excluded.push({
        sectionId: section.id,
        path: section.path,
        reason: "foreign-revision",
      });
      continue;
    }
    if (!normalizeRepositoryPath(section.path)) {
      excluded.push({
        sectionId: section.id,
        path: section.path,
        reason: "invalid-path",
      });
      continue;
    }
    if (
      scope.enforceExplicitScope &&
      (scope.paths?.length || scope.featureIds?.length) &&
      !explicitScopeMatch(section, scope)
    ) {
      excluded.push({
        sectionId: section.id,
        path: section.path,
        reason: "outside-explicit-scope",
      });
      continue;
    }
    eligible.push(section);
  }

  return {
    eligible: eligible.sort(
      (left, right) =>
        compareText(left.path, right.path) || compareText(left.id, right.id),
    ),
    excluded: excluded.sort(
      (left, right) =>
        compareText(left.path, right.path) ||
        compareText(left.sectionId, right.sectionId),
    ),
    diagnostics: [...diagnostics].sort(),
  };
}

function tokenEstimate(section: ScreenedSection): number {
  const supplied = section.estimatedTokens;
  if (
    typeof supplied === "number" &&
    Number.isFinite(supplied) &&
    supplied > 0
  ) {
    return Math.ceil(supplied);
  }
  return Math.max(1, Math.ceil(section.excerpt.length / 4));
}

function normalizeForDuplicateCheck(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function duplicateGroups(
  sections: readonly ScreenedSection[],
): Map<string, string[]> {
  const byContent = new Map<string, string[]>();
  for (const section of sections) {
    const normalized = normalizeForDuplicateCheck(section.excerpt);
    // Short common fragments (headers/imports) are not useful duplicate evidence.
    if (normalized.length < 80) continue;
    const ids = byContent.get(normalized) ?? [];
    ids.push(section.id);
    byContent.set(normalized, ids);
  }
  const byId = new Map<string, string[]>();
  for (const ids of byContent.values()) {
    if (ids.length < 2) continue;
    const sorted = ids.sort();
    for (const id of sorted)
      byId.set(
        id,
        sorted.filter((other) => other !== id),
      );
  }
  return byId;
}

function weightedFeatureArea(
  projectMap: ProjectMap,
  featureId: string,
): number {
  const area = projectMap.featureAreas.find((item) => item.id === featureId);
  if (!area) return 0;
  return area.status === "confirmed" ? 1 : 0.6;
}

function coveredForRole(
  sections: readonly ScreenedSection[],
  role: EvidenceRole,
  selectedIds: ReadonlySet<string>,
): Set<string> {
  return new Set(
    sections
      .filter(
        (section) =>
          selectedIds.has(section.id) &&
          effectiveEvidenceRole(section) === role,
      )
      .flatMap((section) => section.featureTargets ?? []),
  );
}

function featureGain(
  projectMap: ProjectMap,
  section: ScreenedSection,
  alreadyCovered: ReadonlySet<string>,
): { value: number; newlyCovered: string[] } {
  const denominator = projectMap.featureAreas.reduce(
    (sum, area) => sum + (area.status === "confirmed" ? 1 : 0.6),
    0,
  );
  const newlyCovered = [...new Set(section.featureTargets ?? [])]
    .filter(
      (featureId) =>
        !alreadyCovered.has(featureId) &&
        weightedFeatureArea(projectMap, featureId) > 0,
    )
    .sort();
  const gain = newlyCovered.reduce(
    (sum, featureId) => sum + weightedFeatureArea(projectMap, featureId),
    0,
  );
  return {
    value: denominator > 0 ? Math.min(1, gain / denominator) : 0,
    newlyCovered,
  };
}

function implementationDepth(
  section: ScreenedSection,
  graph: DependencyGraph,
): number {
  if (effectiveEvidenceRole(section) !== "implementation") return 0;
  const node = graph.nodes.find((item) => item.path === section.path);
  if (!node) return 0.12;
  const sizeSignal = Math.min(node.codeLineCount / 100, 0.28);
  const logicSignal = Math.min(node.logicSignalCount / 12, 0.42);
  const baseline = 0.18 + sizeSignal + logicSignal;
  return Math.max(
    0,
    Math.min(1, node.isThinWrapper ? baseline * 0.28 : baseline),
  );
}

function dependencyRelevance(
  section: ScreenedSection,
  signals: DependencySignals,
): number {
  const node = signals.nodesByPath.get(section.path);
  if (!node) return 0;
  const incoming = signals.incomingByPath.get(section.path) ?? [];
  const wrapperSources =
    signals.wrapperSourcesByImplementation.get(section.path) ?? [];
  const inboundSubstantive = new Set(
    incoming
      .map((edge) => signals.nodesByPath.get(edge.fromPath))
      .filter((candidate) => candidate && !candidate.isThinWrapper)
      .map((candidate) => candidate?.path),
  ).size;
  const inboundWrapper = incoming.filter(
    (edge) => signals.nodesByPath.get(edge.fromPath)?.isThinWrapper,
  ).length;
  const fromEntrypoint = incoming.some((edge) =>
    signals.entrypointPaths.has(edge.fromPath),
  );
  const inboundSignal = Math.min(inboundSubstantive, 4) * 0.055;
  const wrapperSignal = Math.min(inboundWrapper, 3) * 0.025;
  const targetSignal = wrapperSources.length > 0 ? 0.4 : 0;
  const entrySignal = fromEntrypoint ? 0.12 : 0;
  const wrapperPenalty = node.isThinWrapper ? 0.12 : 0;
  // Incoming fan-in is intentionally capped so a tiny common helper cannot dominate.
  return Math.max(
    0,
    Math.min(
      0.78,
      inboundSignal +
        wrapperSignal +
        targetSignal +
        entrySignal -
        wrapperPenalty,
    ),
  );
}

function provenanceConfidence(section: ScreenedSection): number {
  const hasBlobIdentity = Boolean(section.provenance.blobSha);
  switch (section.provenance.status) {
    case "observed":
      return hasBlobIdentity ? 1 : 0.8;
    case "documented":
      return hasBlobIdentity ? 0.82 : 0.68;
    case "inferred":
      return hasBlobIdentity ? 0.58 : 0.44;
  }
}

function scoreCandidate(
  section: ScreenedSection,
  allEligible: readonly ScreenedSection[],
  projectMap: ProjectMap,
  context: RankingContext,
  graph: DependencyGraph,
  dependencySignals: DependencySignals,
  selectedIds: ReadonlySet<string>,
  duplicateMap: ReadonlyMap<string, readonly string[]>,
  pinnedIds: ReadonlySet<string>,
  targetRole?: EvidenceRole,
  tokenNormalizer = 500,
): RankedCandidate {
  const selectedFeatureIds = coveredForRole(
    allEligible,
    effectiveEvidenceRole(section),
    selectedIds,
  );
  const role = effectiveEvidenceRole(section);
  const feature = featureGain(projectMap, section, selectedFeatureIds);
  const estimate = tokenEstimate(section);
  const costEfficiency = 1 / (1 + estimate / tokenNormalizer);
  const duplicates = duplicateMap.get(section.id) ?? [];
  const duplicateOfSelected = duplicates.some((id) => selectedIds.has(id));
  const redundancy = duplicateOfSelected ? 1 : duplicates.length > 0 ? 0.2 : 0;
  const roleFit = targetRole ? (role === targetRole ? 1 : 0) : ROLE_FIT[role];
  const node = dependencySignals.nodesByPath.get(section.path);
  const wrapperSourcePaths =
    dependencySignals.wrapperSourcesByImplementation.get(section.path) ?? [];
  const dependencyTargetPaths =
    dependencySignals.implementationTargetsByWrapper.get(section.path) ?? [];
  const components: ScoreComponents = {
    scopeRelevance: scopeRelevance(section, context.scope),
    featureGain: feature.value,
    implementationDepth: implementationDepth(section, graph),
    dependencyRelevance: dependencyRelevance(section, dependencySignals),
    provenanceConfidence: provenanceConfidence(section),
    roleFit,
    redundancy,
    estimatedTokenCost: estimate,
    costEfficiency,
  };
  const totalScore =
    components.scopeRelevance * RANKING_WEIGHTS.scopeRelevance +
    components.featureGain * RANKING_WEIGHTS.featureGain +
    components.implementationDepth * RANKING_WEIGHTS.implementationDepth +
    components.dependencyRelevance * RANKING_WEIGHTS.dependencyRelevance +
    components.provenanceConfidence * RANKING_WEIGHTS.provenanceConfidence +
    components.roleFit * RANKING_WEIGHTS.roleFit -
    components.redundancy * RANKING_WEIGHTS.redundancy +
    components.costEfficiency * RANKING_WEIGHTS.costEfficiency;

  const reasonCodes: string[] = [];
  if (components.scopeRelevance >= 0.75)
    reasonCodes.push("matches-contribution-scope");
  else if (context.scope.mode === "whole-project")
    reasonCodes.push("whole-project-discovery");
  if (feature.newlyCovered.length > 0)
    reasonCodes.push("adds-feature-coverage");
  if (role === "implementation" && components.implementationDepth >= 0.55) {
    reasonCodes.push("substantive-implementation");
  }
  if (dependencyTargetPaths.length > 0)
    reasonCodes.push("links-to-implementation");
  if (wrapperSourcePaths.length > 0)
    reasonCodes.push("resolves-wrapper-to-implementation");
  if (components.dependencyRelevance >= 0.2 && !node?.isThinWrapper) {
    reasonCodes.push("supports-project-dependency-flow");
  }
  if (section.provenance.blobSha) reasonCodes.push("bound-to-repository-blob");
  if (role === "verification") reasonCodes.push("verification-evidence-only");
  if (node?.isThinWrapper) reasonCodes.push("thin-wrapper-limited");
  if (duplicates.length > 0) reasonCodes.push("overlaps-duplicate-content");
  const pinned = section.userPinned === true || pinnedIds.has(section.id);
  if (pinned) reasonCodes.push("user-pinned");

  const reasonParts: string[] = [];
  if (feature.newlyCovered.length)
    reasonParts.push(`adds ${feature.newlyCovered.join(", ")} coverage`);
  if (dependencyTargetPaths.length)
    reasonParts.push(`leads to ${dependencyTargetPaths.join(", ")}`);
  if (wrapperSourcePaths.length)
    reasonParts.push(
      `implements behaviour linked by ${wrapperSourcePaths.join(", ")}`,
    );
  if (components.scopeRelevance >= 0.75)
    reasonParts.push("matches the stated contribution scope");
  if (node?.isThinWrapper)
    reasonParts.push(
      "is a thin wrapper, so its implementation value is limited",
    );
  if (role === "verification")
    reasonParts.push(
      "is verification evidence and does not count as implementation coverage",
    );
  if (!reasonParts.length) reasonParts.push(`adds ${role} context`);
  reasonParts.push(`estimated ${estimate} tokens`);

  return {
    sectionId: section.id,
    path: section.path,
    role,
    totalScore: Math.round(totalScore * 1_000) / 1_000,
    components,
    coveredFeatureIds: feature.newlyCovered,
    expectedIncrementalCoverage: feature.value,
    duplicateSectionIds: duplicates,
    dependencyTargetPaths,
    reasonCodes,
    reason: `${section.path}: ${reasonParts.join("; ")}.`,
    pinned,
    estimatedTokenCost: estimate,
  };
}

function stableCandidateSort(
  left: RankedCandidate,
  right: RankedCandidate,
): number {
  return (
    right.totalScore - left.totalScore ||
    right.expectedIncrementalCoverage - left.expectedIncrementalCoverage ||
    right.components.implementationDepth -
      left.components.implementationDepth ||
    left.estimatedTokenCost - right.estimatedTokenCost ||
    compareText(left.path, right.path) ||
    compareText(left.sectionId, right.sectionId)
  );
}

function coverageFor(
  projectMap: ProjectMap,
  sections: readonly ScreenedSection[],
  selectedIds: ReadonlySet<string>,
): FeatureCoverage {
  const roleCoverage = (role: EvidenceRole): readonly string[] =>
    [
      ...new Set(
        sections
          .filter(
            (section) =>
              selectedIds.has(section.id) &&
              effectiveEvidenceRole(section) === role,
          )
          .flatMap((section) => section.featureTargets ?? [])
          .filter((featureId) =>
            projectMap.featureAreas.some((area) => area.id === featureId),
          ),
      ),
    ].sort();
  const byRole: Record<EvidenceRole, readonly string[]> = {
    overview: roleCoverage("overview"),
    implementation: roleCoverage("implementation"),
    verification: roleCoverage("verification"),
    configuration: roleCoverage("configuration"),
    unknown: roleCoverage("unknown"),
  };
  const implementationFeatures = new Set(byRole.implementation);
  return {
    byRole,
    missingImplementationFeatures: projectMap.featureAreas
      .filter((area) => !implementationFeatures.has(area.id))
      .map((area) => area.id)
      .sort(),
  };
}

function graphIsCompatible(
  graph: DependencyGraph,
  projectMap: ProjectMap,
): boolean {
  return (
    graph.version === "dependency-graph-v1" &&
    graph.repository.repositoryId === projectMap.repository.repositoryId &&
    graph.repository.commitSha === projectMap.repository.commitSha
  );
}

/** Rank safe, revision-bound candidates with visible marginal score components. */
export function rankCandidates(request: RankCandidatesRequest): RankingResult {
  const validation = validateCandidates(
    request.projectMap,
    request.sections,
    request.context.scope,
  );
  const graph =
    request.graph && graphIsCompatible(request.graph, request.projectMap)
      ? request.graph
      : buildDependencyGraph(request.projectMap, validation.eligible, {
          pinnedSectionIds: request.pinnedSectionIds,
        });
  const diagnostics = new Set(validation.diagnostics);
  if (request.graph && !graphIsCompatible(request.graph, request.projectMap)) {
    diagnostics.add("incompatible-graph-rebuilt");
  }
  if (
    request.context.scope.mode === "selected-areas" &&
    !(
      request.context.scope.paths?.length ||
      request.context.scope.featureIds?.length
    )
  ) {
    diagnostics.add("selected-area-scope-empty");
  }

  const graphSectionIds = new Set(
    graph.nodes.flatMap((node) => node.sectionIds),
  );
  const graphEligible = validation.eligible.filter((section) =>
    graphSectionIds.has(section.id),
  );
  const graphLimitExclusions: ExcludedCandidate[] = validation.eligible
    .filter((section) => !graphSectionIds.has(section.id))
    .map((section) => ({
      sectionId: section.id,
      path: section.path,
      reason: "not-a-candidate",
    }));

  const selectedIds = new Set(request.selectedSectionIds ?? []);
  const pinnedIds = new Set(request.pinnedSectionIds ?? []);
  const duplicates = duplicateGroups(graphEligible);
  const dependencySignals = buildDependencySignals(graph, request.projectMap);
  const rankedCandidates = graphEligible
    .map((section) =>
      scoreCandidate(
        section,
        graphEligible,
        request.projectMap,
        request.context,
        graph,
        dependencySignals,
        selectedIds,
        duplicates,
        pinnedIds,
      ),
    )
    .sort(stableCandidateSort);
  const rankRole = (role: EvidenceRole): readonly RankedCandidate[] =>
    graphEligible
      .filter((section) => effectiveEvidenceRole(section) === role)
      .map((section) =>
        scoreCandidate(
          section,
          graphEligible,
          request.projectMap,
          request.context,
          graph,
          dependencySignals,
          selectedIds,
          duplicates,
          pinnedIds,
          role,
        ),
      )
      .sort(stableCandidateSort);
  const byRole: Record<EvidenceRole, readonly RankedCandidate[]> = {
    overview: rankRole("overview"),
    implementation: rankRole("implementation"),
    verification: rankRole("verification"),
    configuration: rankRole("configuration"),
    unknown: rankRole("unknown"),
  };

  return {
    algorithmVersion: RANKING_ALGORITHM_VERSION,
    graph,
    rankedCandidates,
    byRole,
    excludedCandidates: [...validation.excluded, ...graphLimitExclusions].sort(
      (left, right) =>
        compareText(left.path, right.path) ||
        compareText(left.sectionId, right.sectionId),
    ),
    coverage: coverageFor(request.projectMap, graphEligible, selectedIds),
    diagnostics: [...diagnostics, ...graph.diagnostics].sort(),
  };
}

function validateBudget(budget: SelectionBudget): void {
  if (!Number.isInteger(budget.maxTokens) || budget.maxTokens < 0) {
    throw new RangeError("Selection maxTokens must be a non-negative integer.");
  }
  if (!Number.isInteger(budget.maxFiles) || budget.maxFiles < 0) {
    throw new RangeError("Selection maxFiles must be a non-negative integer.");
  }
}

function exclusionReasonToPinConflict(
  reason: ExcludedCandidate["reason"],
): "unsafe" | "outside-explicit-scope" | "analysis-limit" | null {
  if (
    reason === "unsafe-section" ||
    reason === "unreviewed-section" ||
    reason === "foreign-repository" ||
    reason === "foreign-revision" ||
    reason === "invalid-path"
  ) {
    return "unsafe";
  }
  if (reason === "outside-explicit-scope") return "outside-explicit-scope";
  if (reason === "not-a-candidate") return "analysis-limit";
  return null;
}

/** Greedy budget admission. Pins receive first consideration but cannot bypass scope or safety. */
export function selectEvidenceCandidates(
  request: SelectionRequest,
): SelectionResult {
  validateBudget(request.budget);
  const initial = rankCandidates({
    projectMap: request.projectMap,
    sections: request.sections,
    context: request.context,
    graph: request.graph,
    selectedSectionIds: request.selectedSectionIds,
    pinnedSectionIds: request.pinnedSectionIds,
  });
  const sectionById = new Map(
    request.sections.map((section) => [section.id, section]),
  );
  const rankedById = new Map(
    initial.rankedCandidates.map((candidate) => [
      candidate.sectionId,
      candidate,
    ]),
  );
  const excludedById = new Map(
    initial.excludedCandidates.map((candidate) => [
      candidate.sectionId,
      candidate,
    ]),
  );
  const selectedIds = new Set<string>();
  const selected: RankedCandidate[] = [];
  const pinConflicts: Array<{
    sectionId: string;
    reason:
      | "not-found"
      | "analysis-limit"
      | "unsafe"
      | "outside-explicit-scope"
      | "over-budget"
      | "duplicate-of-selected";
  }> = [];
  const diagnostics = new Set(initial.diagnostics);
  let totalTokens = 0;
  const selectedPaths = new Set<string>();
  const selectedContents = new Set<string>();

  const addSection = (
    sectionId: string,
    isPin: boolean,
    rankingOverride?: RankedCandidate,
  ): boolean => {
    const section = sectionById.get(sectionId);
    const ranked = rankingOverride ?? rankedById.get(sectionId);
    if (!section || !ranked) return false;
    if (selectedIds.has(sectionId)) return true;
    const normalizedContent = normalizeForDuplicateCheck(section.excerpt);
    if (
      normalizedContent.length >= 80 &&
      selectedContents.has(normalizedContent)
    ) {
      if (isPin)
        pinConflicts.push({ sectionId, reason: "duplicate-of-selected" });
      return false;
    }
    const nextFileCount = selectedPaths.has(section.path)
      ? selectedPaths.size
      : selectedPaths.size + 1;
    const nextTokens = totalTokens + ranked.estimatedTokenCost;
    if (
      nextFileCount > request.budget.maxFiles ||
      nextTokens > request.budget.maxTokens
    ) {
      if (isPin) pinConflicts.push({ sectionId, reason: "over-budget" });
      return false;
    }
    selectedIds.add(sectionId);
    selectedPaths.add(section.path);
    if (normalizedContent.length >= 80) selectedContents.add(normalizedContent);
    totalTokens = nextTokens;
    selected.push({ ...ranked, pinned: isPin || ranked.pinned });
    return true;
  };

  for (const sectionId of [...new Set(request.selectedSectionIds ?? [])]) {
    if (!addSection(sectionId, false))
      diagnostics.add("preselected-section-not-admitted");
  }

  for (const sectionId of [...new Set(request.pinnedSectionIds ?? [])]) {
    if (selectedIds.has(sectionId)) continue;
    if (rankedById.has(sectionId)) {
      addSection(sectionId, true);
      continue;
    }
    const excluded = excludedById.get(sectionId);
    if (!sectionById.has(sectionId)) {
      pinConflicts.push({ sectionId, reason: "not-found" });
      continue;
    }
    if (excluded) {
      const reason = exclusionReasonToPinConflict(excluded.reason);
      if (reason) pinConflicts.push({ sectionId, reason });
      else pinConflicts.push({ sectionId, reason: "unsafe" });
    }
  }

  while (selectedIds.size < initial.rankedCandidates.length) {
    const currentRanking = rankCandidates({
      projectMap: request.projectMap,
      sections: request.sections,
      context: request.context,
      graph: initial.graph,
      selectedSectionIds: [...selectedIds],
      pinnedSectionIds: request.pinnedSectionIds,
    });
    const admitted = currentRanking.rankedCandidates.some(
      (candidate) =>
        !selectedIds.has(candidate.sectionId) &&
        addSection(candidate.sectionId, false, candidate),
    );
    if (!admitted) break;
  }

  const finalRanking = rankCandidates({
    projectMap: request.projectMap,
    sections: request.sections,
    context: request.context,
    graph: initial.graph,
    selectedSectionIds: [...selectedIds],
    pinnedSectionIds: request.pinnedSectionIds,
  });
  if (selectedIds.size < initial.rankedCandidates.length)
    diagnostics.add("selection-budget-exhausted-or-candidates-omitted");

  return {
    selected,
    rankedCandidates: finalRanking.rankedCandidates,
    pinConflicts: pinConflicts.sort(
      (left, right) =>
        compareText(left.sectionId, right.sectionId) ||
        compareText(left.reason, right.reason),
    ),
    selectedTokenEstimate: totalTokens,
    selectedFileCount: selectedPaths.size,
    missingImplementationFeatures:
      finalRanking.coverage.missingImplementationFeatures,
    diagnostics: [...diagnostics].sort(),
  };
}
