import {
  AchievementSelectionInputSchema,
  JobAnalysisInputSchema,
  LatexRepairInputSchema,
  ResumeDraftInputSchema,
} from "./contracts";
import type { AiProvider } from "./provider";

export const mockAiProvider: AiProvider = {
  name: "mock",
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
    };
  },
  async selectAchievements(input) {
    AchievementSelectionInputSchema.parse(input);
    return { selections: [] };
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
