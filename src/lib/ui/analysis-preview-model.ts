import type { JobAnalysisResult } from "../ai/contracts";

export type AnalysisSignal = {
  key: "requirements" | "tools" | "terms" | "context";
  status: "success" | "attention" | "info";
  label: string;
};

/** These signals describe extraction, never resume coverage or ATS scoring. */
export function buildAnalysisSignals(
  analysis: JobAnalysisResult,
): AnalysisSignal[] {
  const requirements = analysis.requiredQualifications.length;
  const tools = analysis.toolsAndPlatforms.length;
  const terms = analysis.atsTerms.length;
  const context = analysis.inferredContext.length;
  return [
    {
      key: "requirements",
      status: requirements > 0 ? "success" : "info",
      label:
        requirements > 0
          ? `Extracted: ${requirements} explicit requirement${requirements === 1 ? "" : "s"}`
          : "None identified: explicit requirements",
    },
    {
      key: "tools",
      status: "info",
      label:
        tools > 0
          ? `Identified: ${tools} ${tools === 1 ? "tool or platform" : "tools and platforms"}`
          : "None identified: tools and platforms",
    },
    {
      key: "terms",
      status: "info",
      label:
        terms > 0
          ? `Identified: ${terms} ATS term${terms === 1 ? "" : "s"}`
          : "None identified: ATS terms",
    },
    {
      key: "context",
      status: context > 0 ? "attention" : "info",
      label:
        context > 0
          ? `Review inference: ${context} context note${context === 1 ? "" : "s"}`
          : "None identified: inferred context",
    },
  ];
}
