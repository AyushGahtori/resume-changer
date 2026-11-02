export const RANKING_ALGORITHM_VERSION = "local-ranking-v1";
export const DEPENDENCY_GRAPH_VERSION = "dependency-graph-v1";

export interface RepositoryIdentity {
  repositoryId: string;
  commitSha: string;
}

export type EvidenceRole =
  "overview" | "implementation" | "verification" | "configuration" | "unknown";

export type ProvenanceStatus = "observed" | "documented" | "inferred";

export interface SectionProvenance extends RepositoryIdentity {
  blobSha?: string;
  status: ProvenanceStatus;
}

export interface FeatureArea {
  id: string;
  status: "confirmed" | "suggested";
  sourcePaths?: readonly string[];
}

export interface PackageBoundary {
  /** Repository-relative POSIX path. The empty string denotes the repository root. */
  root: string;
  name?: string;
  entrypoints?: readonly string[];
}

/** A path mapping already validated as data by project discovery. */
export interface ConfiguredAlias {
  pattern: string;
  targetPattern: string;
  /** Repository-relative directory against which targetPattern is resolved. */
  basePath: string;
  packageRoot: string;
  configPath: string;
}

/** Task-local structural project map; deliberately independent of Tasks 04 and 05. */
export interface ProjectMap {
  repository: RepositoryIdentity;
  featureAreas: readonly FeatureArea[];
  packageBoundaries: readonly PackageBoundary[];
  aliases: readonly ConfiguredAlias[];
  /** Paths known to the bounded inventory, including files without a loaded section. */
  knownPaths: readonly string[];
  /** Optional, already parsed language label per path. */
  languageByPath?: Readonly<Record<string, string>>;
}

export type ImportKind = "import" | "re-export" | "dynamic-import" | "require";

export interface StaticImportReference {
  specifier: string;
  kind: ImportKind;
  /** Optional path produced by a language-specific static parser. */
  resolvedPath?: string;
  line?: number;
}

/** A screened excerpt supplied by a bounded reader. It is never fetched by this module. */
export interface ScreenedSection {
  id: string;
  path: string;
  lineStart: number;
  lineEnd: number;
  excerpt: string;
  estimatedTokens?: number;
  role: EvidenceRole;
  featureTargets?: readonly string[];
  provenance: SectionProvenance;
  safety: {
    eligible: boolean;
    screening: "safe" | "unsafe" | "unreviewed";
    reason?: string;
  };
  /** Supplied by a bounded, language-aware parser when available. */
  staticImports?: readonly StaticImportReference[];
  /** Optional inventory hint. It affects ranking only after path and revision checks pass. */
  userPinned?: boolean;
}

export type ResolutionStatus = "resolved" | "external" | "unresolved";

export type UnresolvedReason =
  | "unconfigured-alias"
  | "outside-package"
  | "unsafe-path"
  | "unsupported-root-import"
  | "target-not-in-inventory"
  | "target-not-screened"
  | "unsupported-alias-pattern"
  | "unsupported-language";

export interface DependencyEdge {
  fromPath: string;
  toPath?: string;
  specifier: string;
  kind: ImportKind;
  line?: number;
  status: ResolutionStatus;
  reason?: UnresolvedReason;
  viaAlias?: string;
}

export interface DependencyNode {
  path: string;
  sectionIds: readonly string[];
  packageRoot: string;
  language: string;
  roles: readonly EvidenceRole[];
  featureTargets: readonly string[];
  importCount: number;
  reExportCount: number;
  codeLineCount: number;
  logicSignalCount: number;
  isThinWrapper: boolean;
  wrapperSignals: readonly string[];
}

export interface DependencyGraph {
  version: typeof DEPENDENCY_GRAPH_VERSION;
  repository: RepositoryIdentity;
  nodes: readonly DependencyNode[];
  edges: readonly DependencyEdge[];
  diagnostics: readonly string[];
  limits: GraphLimits;
}

export interface GraphLimits {
  maxSections: number;
  maxSourceCharactersPerSection: number;
  maxReferencesPerSection: number;
  maxEdges: number;
  maxTraversalDepth: number;
}

export interface ContributionScope {
  mode: "whole-project" | "selected-areas" | "shared" | "unsure";
  paths?: readonly string[];
  featureIds?: readonly string[];
  source?: "user-confirmed" | "user-reported" | "repository-suggestion";
  /** When true, selected-area mode excludes candidates outside the named scope. */
  enforceExplicitScope?: boolean;
}

export interface RankingContext {
  scope: ContributionScope;
}

export interface RankingWeights {
  scopeRelevance: number;
  featureGain: number;
  implementationDepth: number;
  dependencyRelevance: number;
  provenanceConfidence: number;
  roleFit: number;
  redundancy: number;
  costEfficiency: number;
}

export interface ScoreComponents {
  scopeRelevance: number;
  featureGain: number;
  implementationDepth: number;
  dependencyRelevance: number;
  provenanceConfidence: number;
  roleFit: number;
  redundancy: number;
  estimatedTokenCost: number;
  costEfficiency: number;
}

export interface RankedCandidate {
  sectionId: string;
  path: string;
  role: EvidenceRole;
  totalScore: number;
  components: ScoreComponents;
  coveredFeatureIds: readonly string[];
  expectedIncrementalCoverage: number;
  duplicateSectionIds: readonly string[];
  dependencyTargetPaths: readonly string[];
  reasonCodes: readonly string[];
  reason: string;
  pinned: boolean;
  estimatedTokenCost: number;
}

export interface ExcludedCandidate {
  sectionId: string;
  path: string;
  reason:
    | "unsafe-section"
    | "unreviewed-section"
    | "foreign-repository"
    | "foreign-revision"
    | "invalid-path"
    | "duplicate-section-id"
    | "outside-explicit-scope"
    | "not-a-candidate";
}

export interface FeatureCoverage {
  byRole: Readonly<Record<EvidenceRole, readonly string[]>>;
  missingImplementationFeatures: readonly string[];
}

export interface RankingResult {
  algorithmVersion: typeof RANKING_ALGORITHM_VERSION;
  graph: DependencyGraph;
  rankedCandidates: readonly RankedCandidate[];
  byRole: Readonly<Record<EvidenceRole, readonly RankedCandidate[]>>;
  excludedCandidates: readonly ExcludedCandidate[];
  coverage: FeatureCoverage;
  diagnostics: readonly string[];
}

export interface SelectionBudget {
  maxTokens: number;
  maxFiles: number;
}

export interface SelectionRequest {
  projectMap: ProjectMap;
  sections: readonly ScreenedSection[];
  context: RankingContext;
  graph?: DependencyGraph;
  pinnedSectionIds?: readonly string[];
  selectedSectionIds?: readonly string[];
  budget: SelectionBudget;
}

export interface PinConflict {
  sectionId: string;
  reason:
    | "not-found"
    | "analysis-limit"
    | "unsafe"
    | "outside-explicit-scope"
    | "over-budget"
    | "duplicate-of-selected";
}

export interface SelectionResult {
  selected: readonly RankedCandidate[];
  rankedCandidates: readonly RankedCandidate[];
  pinConflicts: readonly PinConflict[];
  selectedTokenEstimate: number;
  selectedFileCount: number;
  missingImplementationFeatures: readonly string[];
  diagnostics: readonly string[];
}
