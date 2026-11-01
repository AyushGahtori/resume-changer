import type { FileCandidate } from "../../../lib/github/contracts";
import type {
  EvidenceCategory,
  EvidenceInventoryEntry,
  EvidenceRole,
  ExclusionReason,
  SourceExcerptPreview,
} from "./types";

/**
 * Structured metadata supplied by inventory and content-screening boundaries.
 * Safety reasons must come from these records, never from path guessing in UI.
 */
export interface EvidenceAdapterMetadata {
  safetyFlags?: readonly string[];
  exclusion?: ExclusionReason;
  screeningFinding?:
    "secret-content" | "unsafe-content" | "instruction-like-content" | "other";
  sourceBlobSha?: string;
  selectedExcerpt?: SourceExcerptPreview;
  stale?: boolean;
  staleReason?: string;
}

const ROLE_BY_CATEGORY: Record<FileCandidate["category"], EvidenceRole> = {
  purpose: "overview",
  manifest: "overview",
  implementation: "implementation",
  test: "verification",
  report: "verification",
  documentation: "overview",
  other: "implementation",
};

function categoryFor(candidate: FileCandidate): EvidenceCategory {
  if (
    candidate.category === "purpose" ||
    candidate.category === "documentation"
  ) {
    return "overview";
  }
  if (candidate.category === "test" || candidate.category === "report") {
    return "verification";
  }
  if (candidate.category === "other") return "other";
  return "implementation";
}

function exclusionFromMetadata(
  candidate: FileCandidate,
  metadata: EvidenceAdapterMetadata,
): ExclusionReason | null {
  if (metadata.exclusion) return metadata.exclusion;

  const flags = new Set(metadata.safetyFlags ?? []);
  if (flags.has("symlink") || candidate.mode === "120000") {
    return { code: "symlink" };
  }
  if (flags.has("submodule") || candidate.mode === "160000") {
    return { code: "submodule" };
  }
  if (flags.has("binary-candidate")) return { code: "unsupported-binary" };
  if (flags.has("oversized")) {
    return {
      code: "excessive-text-size",
      sizeBytes: candidate.byteSize,
      limitBytes: 64 * 1024,
    };
  }
  if (flags.has("secret-candidate")) {
    return {
      code: "credential-like-filename",
      ruleId: "inventory-filename-rule",
    };
  }
  if (flags.has("unsafe-path")) {
    return { code: "unsafe-path", ruleId: "inventory-path-check" };
  }
  if (metadata.screeningFinding) {
    return { code: "content-screening", finding: metadata.screeningFinding };
  }
  if (candidate.reasonCodes.includes("secret-bearing-config-pattern")) {
    return { code: "credential-like-filename", ruleId: "legacy-filename-rule" };
  }
  if (candidate.safety !== "safe" || !candidate.eligible) {
    return {
      code: "other",
      label:
        candidate.safety === "needs-review"
          ? "This path needs a repository safety review before it can be added."
          : "This file is unavailable for the current evidence selection.",
    };
  }
  return null;
}

export function adaptFileCandidate(
  candidate: FileCandidate,
  metadata: EvidenceAdapterMetadata = {},
): EvidenceInventoryEntry {
  const common = {
    id: candidate.id,
    path: candidate.path,
    category: categoryFor(candidate),
    role: ROLE_BY_CATEGORY[candidate.category],
    sizeBytes: candidate.byteSize,
    selectionReasons: candidate.reasonCodes,
    ...(metadata.sourceBlobSha
      ? { sourceBlobSha: metadata.sourceBlobSha }
      : {}),
  };

  const exclusion = exclusionFromMetadata(candidate, metadata);
  if (
    (candidate.selected || candidate.pinned) &&
    candidate.safety === "safe" &&
    candidate.eligible &&
    exclusion === null
  ) {
    return {
      ...common,
      state: "selected",
      ...(metadata.stale ? { stale: true } : {}),
      ...(metadata.staleReason ? { staleReason: metadata.staleReason } : {}),
      ...(metadata.selectedExcerpt
        ? { preview: metadata.selectedExcerpt }
        : {}),
    };
  }

  if (exclusion) return { ...common, state: "excluded", exclusion };
  return { ...common, state: "eligible" };
}
