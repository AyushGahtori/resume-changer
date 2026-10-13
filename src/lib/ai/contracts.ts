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
  })
  .strict();

export const AchievementEvidenceSchema = z
  .object({
    id: StableIdSchema,
    text,
    tags: z.array(shortText).max(50),
    skillIds: z.array(StableIdSchema).max(100),
  })
  .strict();

export const AchievementSelectionInputSchema = z
  .object({
    jobDescription: z.string().trim().min(1).max(30_000),
    achievements: z.array(AchievementEvidenceSchema).min(1).max(500),
  })
  .strict();

export const AchievementSelectionResultSchema = z
  .object({
    selections: z
      .array(
        z
          .object({
            achievementId: StableIdSchema,
            rationale: shortText,
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export const ResumeDraftInputSchema = z
  .object({
    jobDescription: z.string().trim().min(1).max(30_000),
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
          })
          .strict(),
      )
      .max(100),
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
export type AchievementSelectionInput = z.infer<
  typeof AchievementSelectionInputSchema
>;
export type AchievementSelectionResult = z.infer<
  typeof AchievementSelectionResultSchema
>;
export type ResumeDraftInput = z.infer<typeof ResumeDraftInputSchema>;
export type ResumeDraftResult = z.infer<typeof ResumeDraftResultSchema>;
export type LatexRepairInput = z.infer<typeof LatexRepairInputSchema>;
export type LatexRepairResult = z.infer<typeof LatexRepairResultSchema>;
