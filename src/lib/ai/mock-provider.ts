import {
  AchievementSelectionInputSchema,
  JobAnalysisInputSchema,
  LatexRepairInputSchema,
  ResumeDraftInputSchema,
} from "./contracts";
import type { AiProvider } from "./provider";

export const mockAiProvider: AiProvider = {
  name: "mock",
  async extractRepositoryAchievements(input) {
    if (!input.prompt.trim()) {
      throw new Error("Repository extraction prompt cannot be empty.");
    }
    return {
      text: JSON.stringify({
        projectSummary: "",
        claims: [],
        drafts: [],
        questionSuggestions: [],
        limitations: [
          "The mock provider does not produce repository recommendations.",
        ],
      }),
      model: "mock",
      finishReason: "STOP",
      usage: {
        promptTokens: null,
        cachedTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        totalTokens: null,
      },
    };
  },
  async analyzeJobDescription(input) {
    JobAnalysisInputSchema.parse(input);
    return {
      targetTitle: input.roleTitle || "Not specified",
      seniority: "Not specified",
      requiredQualifications: [],
      preferredQualifications: [],
      responsibilities: [],
      toolsAndPlatforms: [],
      domainConcepts: [],
      atsTerms: [],
      inferredContext: [],
      terminology: [],
    };
  },
  async selectAchievements(input) {
    AchievementSelectionInputSchema.parse(input);
    return {
      selections: [],
      requirementCoverage: [],
      skillRecommendations: [],
      confidence: 0,
      summary: "The mock provider does not produce AI recommendations.",
    };
  },
  async draftResume(input) {
    ResumeDraftInputSchema.parse(input);
    return { summary: "", achievementText: [] };
  },
  async repairLatexContent(input) {
    LatexRepairInputSchema.parse(input);
    return input.currentContent;
  },
};
