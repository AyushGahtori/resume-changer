import type {
  EvidenceInventoryEntry,
  EvidenceRole,
  EvidenceView,
  ExclusionReason,
} from "./types";

export const EVIDENCE_PAGE_SIZE = 50;
export const MAX_EVIDENCE_PAGE_SIZE = 100;

const EXCLUSION_ORDER: ExclusionReason["code"][] = [
  "unsupported-binary",
  "excessive-text-size",
  "credential-like-filename",
  "unsafe-path",
  "symlink",
  "submodule",
  "content-screening",
  "other",
];

export const EXCLUSION_LABELS: Record<ExclusionReason["code"], string> = {
  "unsupported-binary": "Unsupported binary or image file",
  "excessive-text-size": "Text file exceeds the inspection size limit",
  "credential-like-filename": "Credential-like filename rule",
  "unsafe-path": "Unsafe repository path",
  symlink: "Symbolic link",
  submodule: "Submodule",
  "content-screening": "Content screening",
  other: "Other safety exclusion",
};

export function exclusionMessage(reason: ExclusionReason): string {
  switch (reason.code) {
    case "unsupported-binary":
      return "This file type is not supported for source inspection.";
    case "excessive-text-size":
      return `This text file is ${formatBytes(reason.sizeBytes)}; the inspection limit is ${formatBytes(reason.limitBytes)}.`;
    case "credential-like-filename":
      return "A filename safety rule excluded this path. This does not mean the file contents were read or a credential was found.";
    case "unsafe-path":
      return "The repository path failed a path safety check. Source contents are unavailable.";
    case "symlink":
      return "Symbolic links are excluded from source inspection.";
    case "submodule":
      return "Submodule contents are outside this pinned repository inventory.";
    case "content-screening":
      switch (reason.finding) {
        case "secret-content":
          return "Content screening detected a possible secret. The source is unavailable.";
        case "unsafe-content":
          return "Content screening excluded this source. The source is unavailable.";
        case "instruction-like-content":
          return "Content screening found instruction-like text. The source is unavailable.";
        default:
          return "Content screening excluded this source. The source is unavailable.";
      }
    case "other":
      return reason.label;
  }
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${new Intl.NumberFormat().format(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function selectedEntries(
  entries: EvidenceInventoryEntry[],
): Extract<EvidenceInventoryEntry, { state: "selected" }>[] {
  return entries.filter(
    (entry): entry is Extract<EvidenceInventoryEntry, { state: "selected" }> =>
      entry.state === "selected",
  );
}

export function countEvidenceViews(entries: EvidenceInventoryEntry[]) {
  const selected = entries.filter((entry) => entry.state === "selected").length;
  const eligible = entries.filter((entry) => entry.state === "eligible").length;
  const excluded = entries.filter((entry) => entry.state === "excluded").length;
  return {
    selected,
    eligible,
    excluded,
    all: entries.length,
  } satisfies Record<EvidenceView, number>;
}

export function countExclusionReasons(entries: EvidenceInventoryEntry[]) {
  const counts = new Map<ExclusionReason["code"], number>();
  for (const entry of entries) {
    if (entry.state !== "excluded") continue;
    counts.set(
      entry.exclusion.code,
      (counts.get(entry.exclusion.code) ?? 0) + 1,
    );
  }
  return EXCLUSION_ORDER.filter((code) => counts.has(code)).map((code) => ({
    code,
    label: EXCLUSION_LABELS[code],
    count: counts.get(code) ?? 0,
  }));
}

export function filterEvidenceEntries(args: {
  entries: EvidenceInventoryEntry[];
  view: EvidenceView;
  query: string;
}): EvidenceInventoryEntry[] {
  const normalized = args.query.trim().toLocaleLowerCase();
  return args.entries.filter((entry) => {
    if (args.view === "selected" && entry.state !== "selected") return false;
    if (args.view === "eligible" && entry.state !== "eligible") return false;
    if (args.view === "excluded" && entry.state !== "excluded") return false;
    if (!normalized) return true;

    const searchable = [
      entry.path,
      entry.category,
      entry.role,
      ...entry.selectionReasons,
      ...(entry.state === "excluded"
        ? [
            EXCLUSION_LABELS[entry.exclusion.code],
            exclusionMessage(entry.exclusion),
          ]
        : []),
    ]
      .join(" ")
      .toLocaleLowerCase();
    return searchable.includes(normalized);
  });
}

export function pageEvidenceEntries<T>(args: {
  entries: T[];
  page: number;
  pageSize: number;
}) {
  const pageSize = Math.max(
    1,
    Math.min(MAX_EVIDENCE_PAGE_SIZE, Math.floor(args.pageSize)),
  );
  const pageCount = Math.max(1, Math.ceil(args.entries.length / pageSize));
  const page = Math.max(0, Math.min(pageCount - 1, Math.floor(args.page)));
  const start = page * pageSize;
  return {
    page,
    pageSize,
    pageCount,
    start,
    end: Math.min(start + pageSize, args.entries.length),
    entries: args.entries.slice(start, start + pageSize),
  };
}

export function getRoleLabel(role: EvidenceRole): string {
  switch (role) {
    case "overview":
      return "Overview";
    case "implementation":
      return "Implementation";
    case "verification":
      return "Verification";
    case "other":
      return "Other";
  }
}
