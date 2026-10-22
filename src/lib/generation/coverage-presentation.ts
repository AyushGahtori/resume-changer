import type { CoverageStatus } from "@/lib/ai/requirement-coverage";

export type CoverageTone = "supported" | "partial" | "uncertain" | "missing";

/**
 * The plain-language state of a single requirement. The labels describe what
 * the evidence actually shows, so a requirement is never presented as a
 * guarantee or as a score.
 */
export const COVERAGE_STATUS_LABELS: Record<CoverageStatus, string> = {
  supported: "Covered",
  partial: "Partial support",
  uncertain: "Needs confirmation",
  "evidence-not-selected": "Not selected",
  "no-evidence-found": "No match found",
};

export function coverageStatusLabel(status: CoverageStatus) {
  return COVERAGE_STATUS_LABELS[status] ?? "No match found";
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

export type CoverageSummary = {
  /** Every requirement the analysis produced. */
  total: number;
  supported: number;
  partial: number;
  uncertain: number;
  notSelected: number;
  noEvidence: number;
  /** The first read: how many analyzed requirements the evidence supports. */
  headline: string;
  /** The remaining states, so the headline is never the only number shown. */
  breakdowns: CoverageTally[];
};

export function summarizeCoverage(
  rows: { status: CoverageStatus }[],
): CoverageSummary {
  const count = (status: CoverageStatus) =>
    rows.filter((row) => row.status === status).length;
  const supported = count("supported");
  const partial = count("partial");
  const uncertain = count("uncertain");
  const notSelected = count("evidence-not-selected");
  const noEvidence = count("no-evidence-found");
  const total = rows.length;
  const breakdowns: CoverageTally[] = (
    [
      { status: "partial", label: "partial", tone: "partial", count: partial },
      {
        status: "uncertain",
        label: "need confirmation",
        tone: "uncertain",
        count: uncertain,
      },
      {
        status: "evidence-not-selected",
        label: "not selected",
        tone: "missing",
        count: notSelected,
      },
      {
        status: "no-evidence-found",
        label: "no match",
        tone: "missing",
        count: noEvidence,
      },
    ] satisfies CoverageTally[]
  ).filter((tally) => tally.count > 0);

  return {
    total,
    supported,
    partial,
    uncertain,
    notSelected,
    noEvidence,
    headline: `${supported} / ${total} supported`,
    breakdowns,
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
  | "absent"
  | "loading"
  | "ready"
  | "error"
  | "empty";

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
