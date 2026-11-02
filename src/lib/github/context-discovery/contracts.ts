export interface RepositoryIdentity {
  repositoryId: number;
  owner: string;
  name: string;
  commitSha: string;
}

export type DiscoveryEligibility = "automatic" | "manual-only" | "excluded";

export interface DiscoveryFile {
  path: string;
  blobSha: string | null;
  mode: string;
  sizeBytes: number | null;
  eligibility: DiscoveryEligibility;
  safetyFlags: readonly string[];
  selected?: boolean;
}

export interface DiscoveryPackageBoundary {
  path: string;
  kind: "declared" | "conventional" | "selected-scope";
  manifestPaths: readonly string[];
  projectTypes: readonly string[];
  entrypointPaths: readonly string[];
}

export interface DiscoveryInventory {
  snapshotId: string;
  repositoryId: number;
  commitSha: string;
  packagePath?: string;
  files: readonly DiscoveryFile[];
  packages: readonly DiscoveryPackageBoundary[];
  projectTypes: readonly string[];
  partial?: boolean;
  unvisitedScope?: readonly string[];
}

export type BoundedReadFailure =
  | "not-found"
  | "unsafe"
  | "unreadable"
  | "over-budget"
  | "cancelled"
  | "revision-mismatch";

export type BoundedReadResult =
  | {
      ok: true;
      text: string;
      bytesRead: number;
      blobSha: string;
      truncated: boolean;
    }
  | { ok: false; reason: BoundedReadFailure };

export interface BoundedReaderPort {
  read(input: {
    repository: RepositoryIdentity;
    path: string;
    blobSha: string;
    maxBytes: number;
  }): Promise<BoundedReadResult>;
}

export interface ProjectDiscoveryInput {
  repository: RepositoryIdentity;
  inventory: DiscoveryInventory;
  reader: BoundedReaderPort;
}

export type ProjectMapIssueCode =
  | "missing-root-readme"
  | "missing-package-readme"
  | "read-failed"
  | "duplicate-overview"
  | "unsafe-config"
  | "unsupported-config"
  | "config-truncated"
  | "unresolved-extends"
  | "workspace-pattern-unresolved"
  | "inventory-partial"
  | "package-limit"
  | "read-limit"
  | "overview-truncated";

export interface ProjectMapIssue {
  code: ProjectMapIssueCode;
  path: string | null;
  message: string;
}

export interface DiscoveryExclusion {
  path: string;
  reason:
    | "unsafe-path"
    | "unsupported-file-mode"
    | "symlink"
    | "submodule"
    | "inventory-excluded"
    | "manual-only"
    | "unsafe-flag"
    | "generated-or-vendored"
    | "non-text-overview"
    | "unsupported-config-format"
    | "outside-selected-package"
    | "not-selected-overview";
}

export interface OverviewCandidate {
  path: string;
  role: "root-readme" | "package-readme" | "architecture";
  packagePath: string;
  status: "candidate" | "duplicate" | "unavailable";
  duplicateOf?: string;
  contentStatus: "planning" | "descriptive" | "unknown";
  truncated: boolean;
  sectionHints: Array<{ heading: string; line: number }>;
  blobSha: string;
}

export interface PackageMapEntry {
  path: string;
  kind: "declared" | "conventional" | "selected-scope" | "manifest-inferred";
  manifestPaths: string[];
  packageName: string | null;
  description: string | null;
  projectTypes: string[];
  entrypointPaths: string[];
  workspacePatterns: string[];
  features: CapabilitySuggestion["capability"][];
}

export interface ConfigurationCandidate {
  path: string;
  kind:
    | "typescript"
    | "javascript"
    | "python"
    | "go"
    | "rust"
    | "java"
    | "workspace"
    | "other";
  status: "parsed" | "static-only" | "unreadable" | "unsupported";
}

export interface AliasMapping {
  pattern: string;
  targetPattern: string;
  targetIndex: number;
  configPath: string;
  provenance: "tsconfig-jsonc" | "jsconfig-jsonc";
}

export interface EntrypointCandidate {
  path: string;
  packagePath: string;
  confidence: "medium" | "low";
  reason: "manifest-entry" | "conventional-entry" | "inventory-entry";
}

export interface CapabilitySuggestion {
  capability:
    | "web-application"
    | "api-service"
    | "machine-learning"
    | "mobile-application"
    | "cli-tool";
  confidence: "medium" | "low";
  evidence: Array<{
    path: string;
    signal: string;
    source: "manifest" | "implementation-path" | "planning-document";
  }>;
  evidenceStatus: "suggested" | "planned";
}

export interface FrameworkSuggestion {
  name: string;
  sourcePath: string;
  confidence: "medium" | "low";
  evidenceStatus: "suggested";
}

export interface ProjectMap {
  version: "project-map-v1";
  repository: RepositoryIdentity;
  counts: {
    totalInventoryFiles: number;
    eligibleFiles: number;
    selectedEvidenceFiles: number;
    overviewCandidates: number;
    configurations: number;
  };
  usage: {
    readAttempts: number;
    readBytes: number;
  };
  inventory: {
    partial: boolean;
    unvisitedScope: string[];
    projectTypes: string[];
    fallbackMode: "classified" | "language-agnostic";
  };
  packages: PackageMapEntry[];
  workspace: {
    declarationPaths: string[];
    patterns: string[];
    members: string[];
  };
  overviewCandidates: OverviewCandidate[];
  configurations: ConfigurationCandidate[];
  aliases: AliasMapping[];
  entrypoints: EntrypointCandidate[];
  frameworks: FrameworkSuggestion[];
  capabilities: CapabilitySuggestion[];
  exclusions: DiscoveryExclusion[];
  issues: ProjectMapIssue[];
  limits: {
    maxInventoryFiles: number;
    maxReadBytesPerFile: number;
    maxReadAttempts: number;
  };
}

export type ProjectMapResult =
  | { ok: true; value: ProjectMap }
  | {
      ok: false;
      error: "invalid-input" | "inventory-mismatch" | "inventory-over-limit";
      message: string;
    };
