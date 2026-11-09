import type { CoverageStatus } from "@/lib/ai/requirement-coverage";

export type CoverageTone = "supported" | "partial" | "uncertain" | "missing";

/**
 * The plain-language state of a single requirement. The labels describe what
 * the evidence actually shows, so a requirement is never presented as a
 * guarantee or as a score.
 */
export const COVERAGE_STATUS_LABELS: Record<CoverageStatus, string> = {
  supported: "Covered",
  partial: "Partial",
  uncertain: "Needs confirmation",
  "evidence-not-selected": "Not selected",
  "no-evidence-found": "Not found",
};

export function coverageStatusLabel(status: CoverageStatus) {
  return COVERAGE_STATUS_LABELS[status] ?? "Not found";
}

export function coverageStatusTone(status: CoverageStatus): CoverageTone {
  switch (status) {
    case "supported":
      return "supported";
    case "partial":
      return "partial";
    case "uncertain":
      return "uncertain";
    default:
      return "missing";
  }
}

export type CoverageTally = {
  status: CoverageStatus;
  label: string;
  tone: CoverageTone;
  count: number;
};

export type CoveragePriority = "required" | "responsibility" | "preferred";

export type CoverageGroupSummary = {
  priority: CoveragePriority;
  label: string;
  supported: number;
  total: number;
  headline: string;
};

export type CoverageSummary = {
  /** Every requirement the analysis produced. */
  total: number;
  /** Supported rows across every priority. Kept so existing readers still have a count. */
  supported: number;
  partial: number;
  uncertain: number;
  notSelected: number;
  noEvidence: number;
  /**
   * Required, responsibilities, and preferred counted apart.
   * Uncategorized rows keep the older combined count.
   */
  headline: string;
  /** The remaining states, so the headline is never the only number shown. */
  breakdowns: CoverageTally[];
  required: CoverageGroupSummary;
  responsibilities: CoverageGroupSummary;
  preferred: CoverageGroupSummary;
};

function coverageGroup(
  rows: { status: CoverageStatus; priority?: CoveragePriority }[],
  priority: CoveragePriority,
  label: string,
): CoverageGroupSummary {
  const matching = rows.filter((row) => row.priority === priority);
  const supported = matching.filter((row) => row.status === "supported").length;
  const total = matching.length;
  return {
    priority,
    label,
    supported,
    total,
    headline: `${supported} of ${total} covered`,
  };
}

export function summarizeCoverage(
  rows: { status: CoverageStatus; priority?: CoveragePriority }[],
): CoverageSummary {
  const count = (status: CoverageStatus) =>
    rows.filter((row) => row.status === status).length;
  const supported = count("supported");
  const partial = count("partial");
  const uncertain = count("uncertain");
  const notSelected = count("evidence-not-selected");
  const noEvidence = count("no-evidence-found");
  const total = rows.length;
  const required = coverageGroup(rows, "required", "Required");
  const responsibilities = coverageGroup(
    rows,
    "responsibility",
    "Responsibilities",
  );
  const preferred = coverageGroup(rows, "preferred", "Preferred");
  const grouped = [required, responsibilities, preferred].filter(
    (group) => group.total > 0,
  );
  const breakdowns: CoverageTally[] = (
    [
      ["partial", partial],
      ["uncertain", uncertain],
      ["evidence-not-selected", notSelected],
      ["no-evidence-found", noEvidence],
    ] as const
  )
    .filter(([, tallyCount]) => tallyCount > 0)
    .map(([status, tallyCount]) => ({
      status,
      label: coverageStatusLabel(status),
      tone: coverageStatusTone(status),
      count: tallyCount,
    }));

  return {
    total,
    supported,
    partial,
    uncertain,
    notSelected,
    noEvidence,
    headline: grouped.length
      ? grouped.map((group) => `${group.label} ${group.headline}`).join(" · ")
      : `${supported} / ${total} supported`,
    breakdowns,
    required,
    responsibilities,
    preferred,
  };
}

/**
 * The denominator of the coverage count, in words. The count is a number of
 * analyzed job requirements, never a percentage, a rank, or a prediction.
 */
export function describeCoverageDenominator(total: number) {
  return total === 1
    ? "1 job requirement analyzed from this job description."
    : `${total} job requirements analyzed from this job description.`;
}

/**
 * The job context the analysis was produced from, so the coverage count can
 * be traced back to the description it compares against.
 */
export function describeCoverageSource(context: {
  targetTitle?: string;
  seniority?: string;
  roleTitle?: string;
  company?: string;
}) {
  const title = context.targetTitle?.trim() || context.roleTitle?.trim();
  const company = context.company?.trim();
  const seniority = context.seniority?.trim();
  if (!title && !company) {
    return "Compared against the saved job description.";
  }
  const parts = [title, seniority, company].filter(Boolean);
  return `Compared against the saved job description for ${parts.join(", ")}.`;
}

export type JobAnalysisState =
  "absent" | "loading" | "ready" | "error" | "empty";

/**
 * The single source of truth for what the builder knows about the job
 * analysis, so the interface never implies an analysis that does not exist.
 */
export function resolveJobAnalysisState(input: {
  draftReady: boolean;
  hasJobDescription: boolean;
  isAnalyzing: boolean;
  hasError: boolean;
  analysis: {
    requiredQualifications: string[];
    responsibilities: string[];
    preferredQualifications: string[];
  } | null;
}): JobAnalysisState {
  if (input.isAnalyzing) return "loading";
  if (input.hasError) return "error";
  if (!input.analysis) {
    return input.hasJobDescription ? "absent" : "absent";
  }
  const requirementCount =
    input.analysis.requiredQualifications.length +
    input.analysis.responsibilities.length +
    input.analysis.preferredQualifications.length;
  return requirementCount > 0 ? "ready" : "empty";
}

export function jobAnalysisStateMessage(state: JobAnalysisState) {
  switch (state) {
    case "loading":
      return "Analyzing the saved job description…";
    case "error":
      return "The last request for this job description failed, so requirement coverage is unavailable. Retry the request.";
    case "empty":
      return "The job analysis did not extract any requirements or responsibilities from this job description.";
    case "absent":
      return "No job analysis is available for this job description yet.";
    default:
      return "";
  }
}
