import { createHash } from "node:crypto";

export const QUALITY_CONTRACT_VERSION = "github-context-quality-v1" as const;

export type EvidenceRole =
  | "overview"
  | "configuration"
  | "implementation"
  | "wrapper"
  | "verification"
  | "documentation"
  | "supporting";

export interface RepositoryIdentity {
  repositoryId: string;
  owner: string;
  name: string;
  commitSha: string;
}

export interface CandidateSectionHint {
  id: string;
  lineStart: number;
  lineEnd: number;
  role: EvidenceRole;
}

export interface InventoryFile {
  id: string;
  path: string;
  blobSha: string;
  mode: string;
  byteSize: number;
  content: string;
  role: EvidenceRole;
  topicHints: string[];
  dependencyIds: string[];
  safe: boolean;
  sectionHints: CandidateSectionHint[];
  duplicateGroup?: string;
}

export interface InterviewContext {
  projectPurpose: string;
  ownership: "whole-project" | "selected-areas" | "shared" | "unsure";
  contribution: string;
  role?: string;
  selectedPaths: string[];
}

export interface InterviewAnswerFixture {
  nodeId: string;
  optionIds: string[];
  customAnswer?: string;
  provenance: "user-reported" | "accepted-repository-suggestion";
  catalogVersion: "project-context-v1";
}

export interface VisualInputFixture {
  id: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
  source: "user-uploaded";
  scope: "visual-only";
}

export interface RepositoryInput {
  fixtureId: string;
  identity: RepositoryIdentity;
  context: InterviewContext;
  interviewTranscript: readonly InterviewAnswerFixture[];
  visualInputs: readonly VisualInputFixture[];
  inventory: readonly InventoryFile[];
  capabilityHints: readonly string[];
  limits: ReadBudget;
}

export interface ReadBudget {
  maxFiles: number;
  maxLines: number;
  maxTokens: number;
  maxSelectedBytes: number;
  maxReadBytesPerFile: number;
  maxAggregateReadBytes: number;
  maxRequests: number;
}

export interface ProjectMap {
  repositoryId: string;
  commitSha: string;
  packages: Array<{ id: string; rootPath: string; fileIds: string[] }>;
  capabilitySuggestions: Array<{
    id: string;
    sourceFileIds: string[];
    confidence: "low" | "medium" | "high";
  }>;
  overviewCandidateIds: string[];
  entrypointCandidateIds: string[];
  fileRoles: Record<string, EvidenceRole>;
  excludedFileIds: string[];
}

export interface ScreenedSection {
  id: string;
  repositoryId: string;
  commitSha: string;
  fileId: string;
  path: string;
  blobSha: string;
  lineStart: number;
  lineEnd: number;
  contentHash: string;
  excerpt: string;
  role: EvidenceRole;
  topicHints: string[];
  safety: "safe" | "excluded";
  warnings: string[];
  estimatedTokens: number;
  sourceBytes: number;
}

export interface DependencyGraph {
  repositoryId: string;
  commitSha: string;
  nodes: Array<{
    id: string;
    fileId: string;
    path: string;
    role: EvidenceRole;
  }>;
  edges: Array<{ fromFileId: string; toFileId: string; kind: "imports" }>;
  unresolved: Array<{ fromFileId: string; targetId: string }>;
}

export interface RankedCandidate {
  sectionId: string;
  fileId: string;
  score: number;
  components: Record<string, number>;
  featureTargets: string[];
  expectedIncrementalCoverage: string[];
  estimatedTokenCost: number;
  uncertaintyFlags: string[];
  reason: string;
}

export interface EvidenceBundle {
  repositoryId: string;
  commitSha: string;
  selectionId: string;
  sections: ScreenedSection[];
  selectedFileIds: string[];
  coveredFeatureHints: string[];
  limitations: string[];
  budget: {
    selectedTokens: number;
    selectedBytes: number;
    selectedLines: number;
    simulatedRequests: number;
  };
}

export interface QualityAdapter {
  id: string;
  version: string;
  kind: "reference" | "candidate";
  discover(input: RepositoryInput): ProjectMap | Promise<ProjectMap>;
  readSections(input: {
    repository: RepositoryInput;
    projectMap: ProjectMap;
  }): ScreenedSection[] | Promise<ScreenedSection[]>;
  buildGraph(input: {
    repository: RepositoryInput;
    projectMap: ProjectMap;
    sections: readonly ScreenedSection[];
  }): DependencyGraph | Promise<DependencyGraph>;
  rank(input: {
    repository: RepositoryInput;
    projectMap: ProjectMap;
    sections: readonly ScreenedSection[];
    graph: DependencyGraph;
  }): RankedCandidate[] | Promise<RankedCandidate[]>;
  select(input: {
    repository: RepositoryInput;
    projectMap: ProjectMap;
    sections: readonly ScreenedSection[];
    graph: DependencyGraph;
    rankedCandidates: readonly RankedCandidate[];
  }): EvidenceBundle | Promise<EvidenceBundle>;
}

export interface ExpectedEvidence {
  id: string;
  featureId: string;
  fileId: string;
  kind: "overview" | "implementation" | "verification" | "counterevidence";
  exactSnippet: string;
}

export interface ExpectedFeature {
  id: string;
  critical: boolean;
  description: string;
  evidenceIds: string[];
}

export interface ExpectedFeatureMap {
  features: ExpectedFeature[];
  evidence: ExpectedEvidence[];
}

export interface QualityFixture {
  id: string;
  scenario: string;
  identity: RepositoryIdentity;
  context: InterviewContext;
  interviewTranscript: InterviewAnswerFixture[];
  visualInputs: VisualInputFixture[];
  capabilityHints: string[];
  files: InventoryFile[];
  expected: ExpectedFeatureMap;
  limits: ReadBudget;
}

export interface EvaluatedFixture {
  fixtureId: string;
  scenario: string;
  selectedFiles: number;
  selectedLines: number;
  selectedBytes: number;
  selectedTokenEstimate: number;
  featureCoverage: {
    covered: number;
    total: number;
    criticalCovered: number;
    criticalTotal: number;
  };
  coveredFeatureIds: string[];
  missingCriticalFeatureIds: string[];
  overviewPresent: boolean;
  unresolvedDependencies: number;
  wrapperTokens: number;
  testTokens: number;
  duplicateTokens: number;
  provenance: { correct: number; total: number; errors: string[] };
  safeExclusionLeaks: string[];
  downloadedBytes: number;
  simulatedRequests: number;
  maxRetainedTextBytes: number;
  withinTextMemoryCap: boolean;
  elapsedMs: number;
  observedHeapDeltaBytes: number | null;
  conformanceErrors: string[];
}

export interface StrategyReport {
  adapterId: string;
  adapterVersion: string;
  adapterKind: QualityAdapter["kind"];
  fixtures: EvaluatedFixture[];
  totals: {
    fixtureCount: number;
    featureCoverage: { covered: number; total: number; ratio: number | null };
    criticalFeatureCoverage: {
      covered: number;
      total: number;
      ratio: number | null;
    };
    overviewFixtures: { present: number; total: number };
    unresolvedDependencies: number;
    wrapperTokens: number;
    testTokens: number;
    selectedTokens: number;
    wrapperTokenShare: number | null;
    testTokenShare: number | null;
    duplicateTokens: number;
    duplicateTokenShare: number | null;
    provenance: { correct: number; total: number; ratio: number | null };
    safeExclusionLeaks: number;
    downloadedBytes: number;
    simulatedRequests: number;
    maxRetainedTextBytes: number;
    fixturesWithinTextMemoryCap: number;
    totalElapsedMs: number;
    observedHeapDeltaBytes: number | null;
  };
  integrationStatus: "adapter-contract-tested; production-wiring-not-proven";
}

export interface QualityReport {
  contractVersion: typeof QUALITY_CONTRACT_VERSION;
  benchmarkVersion: "1.0.0";
  fixtureIds: string[];
  budget: ReadBudget;
  regressionManifest: {
    revision: string;
    selectedFiles: number;
    selectedLines: number;
    selectedBytes: number;
    testFiles: number;
    testLines: number;
  };
  strategies: StrategyReport[];
  deterministicHash: string;
}

export function estimatedTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function lineCount(text: string): number {
  return text.length === 0 ? 0 : text.split("\n").length;
}
