import { z } from "zod";
import { StableIdSchema } from "../schemas/resume-data";

const text = z.string().trim().min(1).max(8_000);
const shortText = z.string().trim().min(1).max(500);
const terms = z.array(shortText).max(100);

export const JobAnalysisInputSchema = z
  .object({
    company: z.string().trim().max(160).optional(),
    roleTitle: z.string().trim().max(160).optional(),
    jobDescription: z.string().trim().min(1).max(30_000),
  })
  .strict();

export const JobAnalysisResultSchema = z
  .object({
    targetTitle: shortText,
    seniority: shortText,
    requiredQualifications: terms,
    preferredQualifications: terms,
    responsibilities: terms,
    toolsAndPlatforms: terms,
    domainConcepts: terms,
    atsTerms: terms,
    inferredContext: terms,
    terminology: z
      .array(
        z
          .object({
            term: shortText,
            alternatives: z.array(shortText).max(10),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export const AchievementEvidenceSchema = z
  .object({
    id: StableIdSchema,
    text,
    tags: z.array(shortText).max(50),
    skillIds: z.array(StableIdSchema).max(100),
    supportedSkills: z.array(shortText).max(100).optional(),
    section: z.enum(["experience", "projects"]),
    groupId: StableIdSchema,
    groupTitle: shortText,
    groupSubtitle: shortText.optional(),
  })
  .strict();

export const SkillEvidenceSchema = z
  .object({
    id: StableIdSchema,
    name: shortText,
    aliases: z.array(shortText).max(50),
    isListedOnCurrentResume: z.boolean(),
    evidenceAchievementIds: z.array(StableIdSchema).max(500),
  })
  .strict();

export const AchievementSelectionInputSchema = z
  .object({
    jobDescription: z.string().trim().min(1).max(30_000),
    analysis: JobAnalysisResultSchema,
    achievements: z.array(AchievementEvidenceSchema).min(1).max(500),
    skills: z.array(SkillEvidenceSchema).max(500),
    contentBudgetLines: z.number().int().min(0).max(60),
  })
  .strict();

export const AchievementSelectionItemSchema = z
  .object({
    achievementId: StableIdSchema,
    section: z.enum(["experience", "projects"]),
    confidence: z.number().min(0).max(1),
    rationale: shortText,
  })
  .strict();

export const RequirementCoverageSchema = z
  .object({
    requirement: shortText,
    coveredByAchievementIds: z.array(StableIdSchema).max(100),
  })
  .strict();

export const SkillRecommendationSchema = z
  .object({
    skillId: StableIdSchema,
    rationale: shortText,
    supportingAchievementIds: z.array(StableIdSchema).min(1).max(100),
  })
  .strict();

export const AchievementSelectionResultSchema = z
  .object({
    selections: z.array(AchievementSelectionItemSchema).max(100),
    requirementCoverage: z.array(RequirementCoverageSchema).max(100),
    skillRecommendations: z.array(SkillRecommendationSchema).max(200),
    confidence: z.number().min(0).max(1),
    summary: shortText,
  })
  .strict();

export const AchievementSelectionResponseSchema = z
  .object({
    recommendations: AchievementSelectionResultSchema,
    mode: z.enum(["ai", "local-fallback"]),
    requirementEvidence: z
      .array(
        z
          .object({
            requirement: shortText,
            availableAchievementIds: z.array(StableIdSchema).max(500),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    budget: z
      .object({
        availableLines: z.number().int().min(0).max(60),
        usedLines: z.number().int().min(0).max(60),
      })
      .strict(),
    notice: shortText.optional(),
  })
  .strict();

export const ResumeDraftInputSchema = z
  .object({
    jobDescription: z.string().trim().min(1).max(30_000),
    analysis: JobAnalysisResultSchema,
    achievements: z.array(AchievementEvidenceSchema).min(1).max(100),
    templateContext: z.string().max(30_000).optional(),
  })
  .strict();

export const ResumeDraftResultSchema = z
  .object({
    summary: z.string().trim().max(1_500),
    achievementText: z
      .array(
        z
          .object({
            achievementId: StableIdSchema,
            text,
            rationale: shortText.optional(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export const TailoredAchievementProposalSchema = z
  .object({
    achievementId: StableIdSchema,
    originalText: z.string().trim().min(1).max(8_000),
    proposedText: z.string().trim().min(1).max(8_000),
    rationale: shortText,
    addedTerms: terms,
  })
  .strict();

export const TailorAchievementsResponseSchema = z
  .object({
    proposals: z.array(TailoredAchievementProposalSchema).min(1).max(100),
    summary: z.string().trim().min(1).max(1_500),
    analyzedTerms: terms,
  })
  .strict();

export const LatexRepairInputSchema = z
  .object({
    currentContent: ResumeDraftResultSchema,
    diagnostics: z.array(shortText).min(1).max(50),
    templateContext: z.string().max(30_000).optional(),
  })
  .strict();

export const LatexRepairResultSchema = ResumeDraftResultSchema;

export type JobAnalysisInput = z.infer<typeof JobAnalysisInputSchema>;
export type JobAnalysisResult = z.infer<typeof JobAnalysisResultSchema>;
export type AchievementEvidence = z.infer<typeof AchievementEvidenceSchema>;
export type SkillEvidence = z.infer<typeof SkillEvidenceSchema>;
export type AchievementSelectionInput = z.infer<
  typeof AchievementSelectionInputSchema
>;
export type AchievementSelectionResult = z.infer<
  typeof AchievementSelectionResultSchema
>;
export type AchievementSelectionResponse = z.infer<
  typeof AchievementSelectionResponseSchema
>;
export type ResumeDraftInput = z.infer<typeof ResumeDraftInputSchema>;
export type ResumeDraftResult = z.infer<typeof ResumeDraftResultSchema>;
export type TailorAchievementsResponse = z.infer<
  typeof TailorAchievementsResponseSchema
>;
export type LatexRepairInput = z.infer<typeof LatexRepairInputSchema>;
export type LatexRepairResult = z.infer<typeof LatexRepairResultSchema>;
