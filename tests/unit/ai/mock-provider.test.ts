import { describe, expect, it } from "vitest";
import { mockAiProvider } from "../../../src/lib/ai/mock-provider";
import {
  JobAnalysisResultSchema,
  AchievementSelectionResultSchema,
  ResumeDraftResultSchema,
} from "../../../src/lib/ai/contracts";

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

const point = {
  id: "achievement-api",
  text: "Built an API.",
  tags: [],
  skillIds: [],
  section: "experience" as const,
  groupId: "job-platform",
  groupTitle: "Platform Engineer",
};

describe("mock AI provider", () => {
  it("is selected by the provider factory", async () => {
    const { createAiProvider } =
      await import("../../../src/lib/ai/provider-factory");

    expect(createAiProvider({ AI_PROVIDER: "mock" })).toBe(mockAiProvider);
    expect(mockAiProvider.name).toBe("mock");
  });

  it("returns a schema-valid analysis that names the requested role", async () => {
    const result = await mockAiProvider.analyzeJobDescription({
      company: "Example Systems",
      roleTitle: "Platform Engineer",
      jobDescription: "Maintain platform services.",
    });

    expect(() => JobAnalysisResultSchema.parse(result)).not.toThrow();
    expect(result.targetTitle).toBe("Platform Engineer");
    expect(result.requiredQualifications).toEqual([]);
  });

  it("falls back to 'Not specified' when no role title is supplied", async () => {
    const result = await mockAiProvider.analyzeJobDescription({
      jobDescription: "Maintain platform services.",
    });

    expect(result.targetTitle).toBe("Not specified");
    expect(result.seniority).toBe("Not specified");
  });

  it("rejects an invalid analysis request", async () => {
    await expect(
      mockAiProvider.analyzeJobDescription({ jobDescription: " " }),
    ).rejects.toThrow();
  });

  it("returns a schema-valid but empty selection", async () => {
    const result = await mockAiProvider.selectAchievements({
      jobDescription: "Platform role.",
      analysis,
      achievements: [point],
      skills: [],
      contentBudgetLines: 20,
    });

    expect(() => AchievementSelectionResultSchema.parse(result)).not.toThrow();
    expect(result.selections).toEqual([]);
    expect(result.confidence).toBe(0);
    expect(result.summary).toContain("mock provider");
  });

  it("rejects a selection request with no achievements", async () => {
    await expect(
      mockAiProvider.selectAchievements({
        jobDescription: "Platform role.",
        analysis,
        achievements: [],
        skills: [],
        contentBudgetLines: 20,
      }),
    ).rejects.toThrow();
  });

  it("returns an empty draft without inventing content", async () => {
    const result = await mockAiProvider.draftResume({
      jobDescription: "Platform role.",
      analysis,
      achievements: [point],
      handoff: {
        job: {
          company: "Example Systems",
          roleTitle: "Platform Engineer",
          jobUrl: "",
          contextId: "a".repeat(64),
        },
        requirements: [],
        selectedAchievements: [
          {
            achievementId: "achievement-api",
            text: "Built an API.",
            section: "experience",
            groupId: "job-platform",
            groupTitle: "Platform Engineer",
            linkedSkills: [],
            supportedRequirementIds: [],
          },
        ],
        suggestedEvidence: [],
        contentBudgetLines: 20,
      },
    });

    expect(() => ResumeDraftResultSchema.parse(result)).not.toThrow();
    expect(result.achievementText).toEqual([]);
  });

  it("returns the supplied content unchanged when repairing LaTeX", async () => {
    const currentContent = {
      summary: "Platform engineer.",
      achievementText: [
        {
          achievementId: "achievement-api",
          text: "Built an API.",
        },
      ],
    };

    const result = await mockAiProvider.repairLatexContent({
      currentContent,
      diagnostics: ["The resume exceeds one page."],
    });

    expect(result).toEqual(currentContent);
  });

  it("rejects a repair request with no diagnostics", async () => {
    await expect(
      mockAiProvider.repairLatexContent({
        currentContent: { summary: "", achievementText: [] },
        diagnostics: [],
      }),
    ).rejects.toThrow();
  });
});
