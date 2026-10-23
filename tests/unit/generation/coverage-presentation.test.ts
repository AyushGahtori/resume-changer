import { describe, expect, it } from "vitest";
import {
  coverageStatusLabel,
  coverageStatusTone,
  describeCoverageDenominator,
  describeCoverageSource,
  jobAnalysisStateMessage,
  resolveJobAnalysisState,
  summarizeCoverage,
} from "../../../src/lib/generation/coverage-presentation";
import type { CoverageStatus } from "../../../src/lib/ai/requirement-coverage";

function rows(...statuses: CoverageStatus[]) {
  return statuses.map((status) => ({ status }));
}

describe("requirement coverage presentation", () => {
  it("names every coverage state in plain language", () => {
    expect(coverageStatusLabel("supported")).toBe("Covered");
    expect(coverageStatusLabel("partial")).toBe("Partial support");
    expect(coverageStatusLabel("uncertain")).toBe("Needs confirmation");
    expect(coverageStatusLabel("evidence-not-selected")).toBe("Not selected");
    expect(coverageStatusLabel("no-evidence-found")).toBe("No match found");
  });

  it("maps every coverage state to a tone the styles can distinguish", () => {
    expect(coverageStatusTone("supported")).toBe("supported");
    expect(coverageStatusTone("partial")).toBe("partial");
    expect(coverageStatusTone("uncertain")).toBe("uncertain");
    expect(coverageStatusTone("evidence-not-selected")).toBe("missing");
    expect(coverageStatusTone("no-evidence-found")).toBe("missing");
  });

  it("leads with the supported count out of the analyzed requirements", () => {
    const summary = summarizeCoverage(
      rows("supported", "supported", "partial", "no-evidence-found"),
    );

    expect(summary.total).toBe(4);
    expect(summary.supported).toBe(2);
    expect(summary.headline).toBe("2 / 4 supported");
  });

  it("breaks the remaining states down and omits the empty ones", () => {
    const summary = summarizeCoverage(
      rows("supported", "partial", "uncertain", "evidence-not-selected"),
    );

    expect(summary.breakdowns).toEqual([
      { status: "partial", label: "partial", tone: "partial", count: 1 },
      {
        status: "uncertain",
        label: "need confirmation",
        tone: "uncertain",
        count: 1,
      },
      {
        status: "evidence-not-selected",
        label: "not selected",
        tone: "missing",
        count: 1,
      },
    ]);
    expect(
      summary.breakdowns.some((tally) => tally.status === "no-evidence-found"),
    ).toBe(false);
  });

  it("reports an empty analysis without claiming any support", () => {
    const summary = summarizeCoverage([]);

    expect(summary.total).toBe(0);
    expect(summary.supported).toBe(0);
    expect(summary.headline).toBe("0 / 0 supported");
    expect(summary.breakdowns).toEqual([]);
  });

  it("explains the denominator in requirements, never as a score", () => {
    expect(describeCoverageDenominator(1)).toBe(
      "1 job requirement analyzed from this job description.",
    );
    expect(describeCoverageDenominator(3)).toBe(
      "3 job requirements analyzed from this job description.",
    );
  });

  it("names the job context the analysis compares against", () => {
    expect(
      describeCoverageSource({
        targetTitle: "Machine Learning Engineer",
        seniority: "1-3 Years",
        company: "Example Cloud Labs",
      }),
    ).toBe(
      "Compared against the saved job description for Machine Learning Engineer, 1-3 Years, Example Cloud Labs.",
    );
  });

  it("falls back to the saved draft when the analysis has no target title", () => {
    expect(describeCoverageSource({ roleTitle: "Platform Engineer" })).toBe(
      "Compared against the saved job description for Platform Engineer.",
    );
  });

  it("describes an unknown job context without inventing one", () => {
    expect(describeCoverageSource({})).toBe(
      "Compared against the saved job description.",
    );
  });
});

describe("job analysis state", () => {
  const analysis = {
    requiredQualifications: ["AWS provisioning"],
    responsibilities: ["Own service reliability"],
    preferredQualifications: [],
  };

  it("reports a ready analysis only when it produced requirements", () => {
    expect(
      resolveJobAnalysisState({
        draftReady: true,
        hasJobDescription: true,
        isAnalyzing: false,
        hasError: false,
        analysis,
      }),
    ).toBe("ready");
  });

  it("reports an empty analysis separately from a missing one", () => {
    expect(
      resolveJobAnalysisState({
        draftReady: true,
        hasJobDescription: true,
        isAnalyzing: false,
        hasError: false,
        analysis: {
          requiredQualifications: [],
          responsibilities: [],
          preferredQualifications: [],
        },
      }),
    ).toBe("empty");
  });

  it("reports an absent analysis when the job description has not been analyzed", () => {
    expect(
      resolveJobAnalysisState({
        draftReady: true,
        hasJobDescription: true,
        isAnalyzing: false,
        hasError: false,
        analysis: null,
      }),
    ).toBe("absent");
  });

  it("reports the loading and error states explicitly", () => {
    expect(
      resolveJobAnalysisState({
        draftReady: true,
        hasJobDescription: true,
        isAnalyzing: true,
        hasError: false,
        analysis: null,
      }),
    ).toBe("loading");
    expect(
      resolveJobAnalysisState({
        draftReady: true,
        hasJobDescription: true,
        isAnalyzing: false,
        hasError: true,
        analysis: null,
      }),
    ).toBe("error");
  });

  it("gives every unfinished state an honest message", () => {
    expect(jobAnalysisStateMessage("loading")).toBe(
      "Analyzing the saved job description…",
    );
    expect(jobAnalysisStateMessage("error")).toBe(
      "The last request for this job description failed, so requirement coverage is unavailable. Retry the request.",
    );
    expect(jobAnalysisStateMessage("empty")).toBe(
      "The job analysis did not extract any requirements or responsibilities from this job description.",
    );
    expect(jobAnalysisStateMessage("absent")).toBe(
      "No job analysis is available for this job description yet.",
    );
    expect(jobAnalysisStateMessage("ready")).toBe("");
  });
});
