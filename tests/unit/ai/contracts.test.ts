import { describe, expect, it } from "vitest";
import {
  AchievementSelectionResultSchema,
  AutoTailorResponseSchema,
  CoverageStatusSchema,
  JobAnalysisInputSchema,
  JobAnalysisResultSchema,
  LatexRepairInputSchema,
  ResumeDraftHandoffSchema,
  ResumeDraftJobRequestSchema,
  TailorAchievementsResponseSchema,
} from "../../../src/lib/ai/contracts";
import { createResumeDraftHandoff } from "../../helpers/resume-draft-handoff";

const analysis = {
  targetTitle: "Platform Engineer",
  seniority: "Entry level",
  requiredQualifications: ["Python"],
  preferredQualifications: [],
  responsibilities: ["Maintain platform services"],
  toolsAndPlatforms: ["Python"],
  domainConcepts: [],
  atsTerms: [],
  inferredContext: [],
  terminology: [],
};

describe("JobAnalysisInputSchema", () => {
  it("requires a job description and rejects unknown fields", () => {
    expect(
      JobAnalysisInputSchema.safeParse({ jobDescription: "Platform role." })
        .success,
    ).toBe(true);
    expect(
      JobAnalysisInputSchema.safeParse({ jobDescription: "  " }).success,
    ).toBe(false);
    expect(
      JobAnalysisInputSchema.safeParse({
        jobDescription: "Platform role.",
        unsupported: true,
      }).success,
    ).toBe(false);
  });

  it("bounds the job description length", () => {
    expect(
      JobAnalysisInputSchema.safeParse({
        jobDescription: "x".repeat(30_001),
      }).success,
    ).toBe(false);
  });
});

describe("JobAnalysisResultSchema", () => {
  it("accepts a complete analysis", () => {
    expect(JobAnalysisResultSchema.safeParse(analysis).success).toBe(true);
  });

  it("rejects an analysis that is missing a required field", () => {
    const { targetTitle: _targetTitle, ...withoutTitle } = analysis;

    expect(JobAnalysisResultSchema.safeParse(withoutTitle).success).toBe(false);
  });

  it("rejects an unknown field so the model cannot smuggle content", () => {
    expect(
      JobAnalysisResultSchema.safeParse({ ...analysis, extra: "value" })
        .success,
    ).toBe(false);
  });
});

describe("CoverageStatusSchema", () => {
  it("allows only the defined coverage states", () => {
    for (const status of [
      "supported",
      "partial",
      "uncertain",
      "evidence-not-selected",
      "no-evidence-found",
    ]) {
      expect(CoverageStatusSchema.safeParse(status).success).toBe(true);
    }
    expect(CoverageStatusSchema.safeParse("unknown").success).toBe(false);
  });
});

describe("AchievementSelectionResultSchema", () => {
  it("accepts a selection with bounded confidence", () => {
    const result = {
      selections: [
        {
          achievementId: "achievement-api",
          section: "experience",
          confidence: 0.9,
          rationale: "Direct API experience.",
        },
      ],
      requirementCoverage: [],
      skillRecommendations: [],
      confidence: 0.9,
      summary: "The selected point supports the role.",
    };

    expect(AchievementSelectionResultSchema.safeParse(result).success).toBe(
      true,
    );
  });

  it("rejects a confidence value outside zero to one", () => {
    const result = {
      selections: [],
      requirementCoverage: [],
      skillRecommendations: [],
      confidence: 1.4,
      summary: "Confidence is out of range.",
    };

    expect(AchievementSelectionResultSchema.safeParse(result).success).toBe(
      false,
    );
  });

  it("rejects an empty summary so the model must explain itself", () => {
    const result = {
      selections: [],
      requirementCoverage: [],
      skillRecommendations: [],
      confidence: 0.5,
      summary: "   ",
    };

    expect(AchievementSelectionResultSchema.safeParse(result).success).toBe(
      false,
    );
  });

  it("rejects a selection that names an unknown section", () => {
    const result = {
      selections: [
        {
          achievementId: "achievement-api",
          section: "unknown",
          confidence: 0.9,
          rationale: "Direct API experience.",
        },
      ],
      requirementCoverage: [],
      skillRecommendations: [],
      confidence: 0.9,
      summary: "The selected point supports the role.",
    };

    expect(AchievementSelectionResultSchema.safeParse(result).success).toBe(
      false,
    );
  });
});

describe("ResumeDraftJobRequestSchema", () => {
  it("requires a hexadecimal context identifier", () => {
    const base = {
      company: "Example Systems",
      roleTitle: "Platform Engineer",
      jobUrl: "",
      contextId: "a".repeat(64),
    };

    expect(ResumeDraftJobRequestSchema.safeParse(base).success).toBe(true);
    expect(
      ResumeDraftJobRequestSchema.safeParse({ ...base, contextId: "abc" })
        .success,
    ).toBe(false);
  });

  it("rejects unknown fields", () => {
    const base = {
      company: "Example Systems",
      roleTitle: "Platform Engineer",
      jobUrl: "",
      contextId: "a".repeat(64),
    };

    expect(
      ResumeDraftJobRequestSchema.safeParse({ ...base, extra: true }).success,
    ).toBe(false);
  });
});

describe("ResumeDraftHandoffSchema", () => {
  it("accepts a handoff that ties sources to the active job", () => {
    const handoff = createResumeDraftHandoff({
      achievementId: "achievement-api",
      text: "Built an API.",
    });

    expect(ResumeDraftHandoffSchema.safeParse(handoff).success).toBe(true);
  });

  it("requires at least one selected achievement", () => {
    const handoff = {
      ...createResumeDraftHandoff({
        achievementId: "achievement-api",
        text: "Built an API.",
      }),
      selectedAchievements: [],
    };

    expect(ResumeDraftHandoffSchema.safeParse(handoff).success).toBe(false);
  });

  it("rejects a handoff whose job context is not a stable identifier", () => {
    const handoff = createResumeDraftHandoff({
      achievementId: "achievement-api",
      text: "Built an API.",
    });
    handoff.job.contextId = "not-a-hash";

    expect(ResumeDraftHandoffSchema.safeParse(handoff).success).toBe(false);
  });
});

describe("TailorAchievementsResponseSchema", () => {
  const base = {
    proposals: [
      {
        achievementId: "achievement-api",
        originalText: "Built an API.",
        proposedText: "Engineered a REST API for billing.",
        rationale: "Reflects the JD's REST API requirement.",
        addedTerms: ["REST API"],
        sourceAchievementIds: ["achievement-api"],
      },
    ],
    summary: "One proposal.",
    analyzedTerms: ["REST API"],
    mode: "ai" as const,
    handoff: createResumeDraftHandoff({
      achievementId: "achievement-api",
      text: "Built an API.",
    }),
  };

  it("accepts a valid tailoring response", () => {
    expect(TailorAchievementsResponseSchema.safeParse(base).success).toBe(true);
  });

  it("requires at least one proposal", () => {
    expect(
      TailorAchievementsResponseSchema.safeParse({ ...base, proposals: [] })
        .success,
    ).toBe(false);
  });

  it("rejects an unknown drafting mode", () => {
    expect(
      TailorAchievementsResponseSchema.safeParse({
        ...base,
        mode: "unverified",
      }).success,
    ).toBe(false);
  });

  it("rejects a proposal with no rationale", () => {
    const [proposal, ...rest] = base.proposals;
    expect(
      TailorAchievementsResponseSchema.safeParse({
        ...base,
        proposals: [{ ...proposal, rationale: "" }, ...rest],
      }).success,
    ).toBe(false);
  });

  it("rejects a response that omits the handoff", () => {
    const { handoff: _handoff, ...withoutHandoff } = base;
    expect(
      TailorAchievementsResponseSchema.safeParse(withoutHandoff).success,
    ).toBe(false);
  });
});

describe("AutoTailorResponseSchema", () => {
  it("accepts a response that carries a selection and its tailoring", () => {
    const response = {
      recommendation: {
        recommendations: {
          selections: [],
          requirementCoverage: [],
          skillRecommendations: [],
          confidence: 0.5,
          summary: "A selection.",
        },
        mode: "ai" as const,
        budget: { availableLines: 24, usedLines: 8 },
      },
      tailoring: {
        proposals: [
          {
            achievementId: "achievement-api",
            originalText: "Built an API.",
            proposedText: "Engineered a REST API for billing.",
            rationale: "Reflects the JD requirement.",
            addedTerms: [],
          },
        ],
        summary: "One proposal.",
        analyzedTerms: [],
        mode: "ai" as const,
        handoff: createResumeDraftHandoff({
          achievementId: "achievement-api",
          text: "Built an API.",
        }),
      },
      selectedSkillIds: ["skill-python"],
      draftingMode: "ai" as const,
    };

    expect(AutoTailorResponseSchema.safeParse(response).success).toBe(true);
  });

  it("rejects a response with no selected skills field", () => {
    expect(
      AutoTailorResponseSchema.safeParse({
        recommendation: { recommendations: {}, mode: "ai", budget: {} },
        tailoring: {},
        draftingMode: "ai",
      }).success,
    ).toBe(false);
  });
});

describe("LatexRepairInputSchema", () => {
  it("requires at least one diagnostic", () => {
    const currentContent = {
      summary: "Repair the wording.",
      achievementText: [],
    };

    expect(
      LatexRepairInputSchema.safeParse({
        currentContent,
        diagnostics: ["The resume exceeds one page."],
      }).success,
    ).toBe(true);
    expect(
      LatexRepairInputSchema.safeParse({ currentContent, diagnostics: [] })
        .success,
    ).toBe(false);
  });

  it("rejects a negative overflow word count", () => {
    const currentContent = {
      summary: "Repair the wording.",
      achievementText: [],
    };

    expect(
      LatexRepairInputSchema.safeParse({
        currentContent,
        diagnostics: ["The resume exceeds one page."],
        overflowWordCount: -1,
      }).success,
    ).toBe(false);
  });
});
