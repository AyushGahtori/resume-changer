import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnalysisSignalRows } from "../../../src/components/home/analysis-signal-rows";
import { buildAnalysisSignals } from "../../../src/lib/ui/analysis-preview-model";
import { emptyHomeAnalysis, homeAnalysis } from "../../helpers/home-analysis";

describe("JD extraction signals", () => {
  it("omits an empty signal list instead of producing fake rows", () => {
    expect(
      renderToStaticMarkup(createElement(AnalysisSignalRows, { signals: [] })),
    ).toBe("");
  });
  it("pairs successful extraction, neutral information and present inference with text", () => {
    expect(buildAnalysisSignals(homeAnalysis)).toEqual([
      {
        key: "requirements",
        status: "success",
        label: "Extracted: 1 explicit requirement",
      },
      {
        key: "tools",
        status: "info",
        label: "Identified: 2 tools and platforms",
      },
      { key: "terms", status: "info", label: "Identified: 1 ATS term" },
      {
        key: "context",
        status: "attention",
        label: "Review inference: 1 context note",
      },
    ]);
  });
  it("never turns missing categories into a pass or warning", () => {
    const signals = buildAnalysisSignals(emptyHomeAnalysis);
    expect(signals.every((signal) => signal.status === "info")).toBe(true);
    expect(
      signals.every((signal) => signal.label.startsWith("None identified:")),
    ).toBe(true);
  });
  it("uses plural labels and singular tool labels from actual response counts", () => {
    const signals = buildAnalysisSignals({
      ...homeAnalysis,
      requiredQualifications: ["First", "Second"],
      toolsAndPlatforms: ["TypeScript"],
      atsTerms: ["First", "Second"],
      inferredContext: ["First inference", "Second inference"],
    });
    expect(signals.map((signal) => signal.label)).toEqual([
      "Extracted: 2 explicit requirements",
      "Identified: 1 tool or platform",
      "Identified: 2 ATS terms",
      "Review inference: 2 context notes",
    ]);
  });
  it("does not mutate source arrays or infer coverage from unrelated populated categories", () => {
    const analysis = {
      ...emptyHomeAnalysis,
      responsibilities: ["Build APIs"],
      preferredQualifications: ["Python"],
    };
    const before = structuredClone(analysis);
    expect(
      buildAnalysisSignals(analysis).every(
        (signal) => signal.status === "info",
      ),
    ).toBe(true);
    expect(analysis).toEqual(before);
  });
  it("does not turn counts into percentages or matching claims", () => {
    const signals = buildAnalysisSignals({
      ...homeAnalysis,
      atsTerms: Array.from({ length: 78 }, (_, index) => `Term ${index}`),
    });
    expect(signals.find((signal) => signal.key === "terms")?.label).toBe(
      "Identified: 78 ATS terms",
    );
    expect(signals.map((signal) => signal.label).join(" ")).not.toMatch(
      /%|match|coverage|passed/i,
    );
  });
});
