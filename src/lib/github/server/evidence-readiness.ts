/** Coverage gaps limit claims; missing method/attribution and unknown requirements block analysis. */
const coverageGaps = new Set([
  "purpose",
  "corroboration",
  "measurement-context",
]);
export type EvidenceReadiness = "complete" | "partial" | "needs-context";

export function evidenceReadiness(input: {
  missingDimensions: readonly string[];
  selectedCount: number;
  pinConflicts?: number;
  partial?: boolean;
}): EvidenceReadiness {
  if (
    !input.selectedCount ||
    input.pinConflicts ||
    input.missingDimensions.some((d) => !coverageGaps.has(d))
  )
    return "needs-context";
  return input.missingDimensions.length || input.partial
    ? "partial"
    : "complete";
}

export function mergeEvidenceReadiness(
  ...values: EvidenceReadiness[]
): EvidenceReadiness {
  return values.includes("needs-context")
    ? "needs-context"
    : values.includes("partial")
      ? "partial"
      : "complete";
}

export function evidenceRecoveryNotes(dimensions: readonly string[]): string[] {
  return [...new Set(dimensions)].map((d) => {
    switch (d) {
      case "corroboration":
        return "No test evidence was included. Drafts will be limited to the selected implementation evidence.";
      case "method":
        return "The selected evidence does not show an implementation. Select a safe implementation file before analysis.";
      case "attribution":
        return "Describe your own contribution before analysis. Repository access does not establish authorship.";
      case "purpose":
        return "Project purpose is not documented in the selected evidence. Claims must stay within the available context.";
      case "measurement-context":
        return "No measurement evidence was included. Do not infer measured outcomes.";
      default:
        return "Required contribution context is missing. Review the scope before analysis.";
    }
  });
}
