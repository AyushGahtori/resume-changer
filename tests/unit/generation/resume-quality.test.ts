import { describe, expect, it } from "vitest";
import sampleJson from "../../../examples/sample-resume-library.json";
import type { ResumeLibrary } from "../../../src/lib/schemas/resume-data";
import { buildAchievementSelectionInput } from "../../../src/lib/ai/achievement-selection";
import { enrichSourceText } from "../../../src/lib/ai/draft-quality";
import { createManualGeneration } from "../../../src/lib/generation/manual-generation";
import { assessResumeQuality } from "../../../src/lib/generation/resume-quality";

const library = sampleJson as ResumeLibrary;
const analysis = {
  targetTitle: "Platform Engineer",
  seniority: "Early",
  requiredQualifications: ["AWS"],
  responsibilities: [],
  preferredQualifications: [],
  toolsAndPlatforms: [],
  domainConcepts: [],
  atsTerms: [],
  inferredContext: [],
  terminology: [],
};
const input = buildAchievementSelectionInput({
  library,
  analysis,
  jobDescription: "Build AWS services.",
});
const source = input.achievements[0];
const generation = createManualGeneration(
  library,
  {
    dataSource: "demo",
    company: "Example",
    roleTitle: "Platform Engineer",
    jobUrl: "",
    jobDescription: "Build AWS services.",
    selectedAchievementIds: [source.id],
    achievementTextOverrides: [
      { achievementId: source.id, text: enrichSourceText(source) },
    ],
  },
  { analysis },
);

describe("final resume quality report", () => {
  it("marks machine extraction unavailable rather than calling it a pass", () => {
    const report = assessResumeQuality({
      library,
      input,
      metadata: generation.metadata,
    });
    expect(report.machine[0]).toMatchObject({
      id: "pdf-extraction",
      status: "unavailable",
    });
  });

  it("checks actual extracted identity and role text", () => {
    const report = assessResumeQuality({
      library,
      input,
      metadata: generation.metadata,
      pdfText: `${library.profile.fullName} ${library.jobs[0].title} ${generation.metadata.generatedBullets[0].text}`,
    });
    expect(report.machine.find((item) => item.id === "identity")?.status).toBe(
      library.profile.email ? "review" : "pass",
    );
    expect(report.machine.find((item) => item.id === "roles")?.status).toBe(
      "review",
    );
    expect(report.machine.find((item) => item.id === "dates")?.status).toBe(
      "review",
    );
  });

  it("flags an invented number and an inferred framework in the final bullet", () => {
    const metadata = structuredClone(generation.metadata);
    metadata.generatedBullets[0].text += " Improved throughput by 999%.";
    metadata.generatedBullets[0].inferredTerms = ["TensorFlow"];
    const report = assessResumeQuality({ library, input, metadata });
    expect(
      report.credibility.find((item) => item.id === `claim-${source.id}`)
        ?.status,
    ).toBe("review");
    expect(
      report.credibility.find((item) => item.id === `inference-${source.id}`)
        ?.message,
    ).toContain("Confirm inferred TensorFlow");
  });

  it("warns when the opening accomplishment has no connection to the key requirement", () => {
    const metadata = structuredClone(generation.metadata);
    metadata.generatedBullets[0].text =
      "Organized weekly design meetings for several teams.";
    const report = assessResumeQuality({ library, input, metadata });
    expect(
      report.recruiter.find((item) => item.id === "opening-relevance")?.status,
    ).toBe("review");
  });

  it("checks the actual PDF top third separately from the selected first bullet", () => {
    const metadata = structuredClone(generation.metadata);
    metadata.generatedBullets[0].text =
      "Provisioned AWS services across three environments.";
    const report = assessResumeQuality({
      library,
      input,
      metadata,
      pdfText: `${library.profile.fullName} ${library.profile.email} Experience ${library.jobs[0].title} ${library.jobs[0].company} Jan 2023 Present ${metadata.generatedBullets[0].text}`,
      topThirdText: `${library.profile.fullName} ${library.jobs[0].title}`,
    });
    expect(
      report.recruiter.find((item) => item.id === "opening-relevance")?.status,
    ).toBe("pass");
    expect(
      report.recruiter.find((item) => item.id === "top-third-relevance")
        ?.status,
    ).toBe("review");
    expect(
      report.machine.find((item) => item.id === "section-headings")?.status,
    ).toBe("pass");
    expect(report.machine.find((item) => item.id === "dates")?.status).toBe(
      "pass",
    );
  });

  it("warns when a supported required term is absent from the exported text", () => {
    const metadata = structuredClone(generation.metadata);
    metadata.finalCoverage = [
      {
        requirement: "AWS",
        priority: "required",
        facets: [
          { label: "aws", alternatives: ["AWS"], matchedBy: [source.id] },
        ],
        coveredByAchievementIds: [source.id],
        availableAchievementIds: [source.id],
        status: "supported",
        evidence: [],
        missingComponents: [],
        reason: "Selected source evidence.",
      },
    ];
    const report = assessResumeQuality({
      library,
      input,
      metadata,
      pdfText: `${library.profile.fullName} ${library.profile.email} Experience ${library.jobs[0].title} ${library.jobs[0].company} 2023`,
    });
    expect(
      report.machine.find((item) => item.id === "required-terms")?.status,
    ).toBe("review");
  });
});
