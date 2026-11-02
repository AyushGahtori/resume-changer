export type EvidenceView = "selected" | "eligible" | "all" | "excluded";

export type EvidenceCategory =
  "overview" | "implementation" | "verification" | "other";

export type EvidenceRole =
  "overview" | "implementation" | "verification" | "other";

export type EvidenceAllocationRole = Exclude<EvidenceRole, "other">;

export type ContentScreeningFinding =
  "secret-content" | "unsafe-content" | "instruction-like-content" | "other";

export type ExclusionReason =
  | { code: "unsupported-binary" }
  | { code: "excessive-text-size"; sizeBytes: number; limitBytes: number }
  | { code: "credential-like-filename"; ruleId?: string }
  | { code: "unsafe-path"; ruleId?: string }
  | { code: "symlink" }
  | { code: "submodule" }
  | { code: "content-screening"; finding: ContentScreeningFinding }
  | { code: "other"; label: string };

export interface SourceExcerptPreview {
  commitSha: string;
  blobSha: string;
  startLine: number;
  endLine: number;
  excerptSha256: string;
  text: string;
}

interface EvidenceEntryBase {
  id: string;
  path: string;
  category: EvidenceCategory;
  role: EvidenceRole;
  sizeBytes: number | null;
  selectionReasons: string[];
  sourceBlobSha?: string;
}

export type EvidenceInventoryEntry =
  | (EvidenceEntryBase & {
      state: "selected";
      stale?: boolean;
      staleReason?: string;
      preview?: SourceExcerptPreview;
    })
  | (EvidenceEntryBase & { state: "eligible" })
  | (EvidenceEntryBase & {
      state: "excluded";
      exclusion: ExclusionReason;
    });

export interface EvidenceInventoryStatus {
  completeness: "complete" | "partial";
  note?: string;
}

export interface EvidenceAllocation {
  role: EvidenceAllocationRole;
  selectedTokens: number;
  targetTokens: number;
  selectedFiles: number;
}

export interface EvidenceReplacement {
  incomingId: string;
  replacingId: string;
}

export interface ContextEvidenceUiProps {
  entries: EvidenceInventoryEntry[];
  inventoryCount: number;
  inventoryStatus: EvidenceInventoryStatus;
  maxSelectedFiles: number;
  allocations: EvidenceAllocation[];
  missingFeatures: string[];
  staleSelectionMessage?: string;
  pageSize?: number;
  onAdd(entryId: string): void;
  onRemove(entryId: string): void;
  onReplace?(replacement: EvidenceReplacement): void;
}
