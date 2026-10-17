import { z } from "zod";
import {
  StableIdSchema,
  MetricSchema,
  EducationSchema,
  CredentialSchema,
} from "../schemas/resume-data";

const text = z.string().trim().min(1).max(8_000);
const shortText = z.string().trim().min(1).max(500);
const skillRationale = z.string().trim().min(1).max(1_000);
const selectionSummary = z.string().trim().min(1).max(2_000);
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

export const ProfileEvidenceSchema = z
  .object({
    headline: shortText.optional(),
    summary: text.optional(),
    education: z.array(EducationSchema),
    credentials: z.array(CredentialSchema),
  })
  .strict();

export const CoverageEvidenceSchema = z
  .object({
    kind: z.enum(["job", "project", "skill", "education", "credential"]),
    id: StableIdSchema,
    label: shortText,
    quote: text,
    selected: z.boolean(),
    inferred: z.boolean().optional(),
  })
  .strict();

export const CoverageStatusSchema = z.enum([
  "supported",
  "partial",
  "uncertain",
  "evidence-not-selected",
  "no-evidence-found",
]);

export const AchievementEvidenceSchema = z
  .object({
    id: StableIdSchema,
    text,
    tags: z.array(shortText).max(50),
    skillIds: z.array(StableIdSchema).max(100),
    supportedSkills: z.array(shortText).max(100).optional(),
    metrics: z.array(MetricSchema).optional(),
    source: z
      .object({
        type: shortText,
        label: shortText.optional(),
        reference: shortText.optional(),
      })
      .optional(),
    context: text.optional(),
    initiativeId: StableIdSchema.optional(),
    inferredSkills: z
      .array(z.object({ name: shortText, reason: shortText }).strict())
      .optional(),
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
    contentBudgetLines: z.number().int().min(0).max(100),
    profile: ProfileEvidenceSchema.optional(),
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
    status: CoverageStatusSchema.optional(),
    evidence: z.array(CoverageEvidenceSchema).max(500).optional(),
    missingComponents: terms.optional(),
    reason: shortText.optional(),
  })
  .strict();

export const SkillRecommendationSchema = z
  .object({
    skillId: StableIdSchema,
    rationale: skillRationale,
    supportingAchievementIds: z.array(StableIdSchema).max(100),
  })
  .strict();

export const AchievementSelectionResultSchema = z
  .object({
    selections: z.array(AchievementSelectionItemSchema).max(100),
    requirementCoverage: z.array(RequirementCoverageSchema).max(300),
    skillRecommendations: z.array(SkillRecommendationSchema).max(200),
    confidence: z.number().min(0).max(1),
    summary: selectionSummary,
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
            coveredByAchievementIds: z.array(StableIdSchema).optional(),
            status: CoverageStatusSchema.optional(),
            evidence: z.array(CoverageEvidenceSchema).max(500).optional(),
            missingComponents: terms.optional(),
            reason: shortText.optional(),
          })
          .strict(),
      )
      .max(300)
      .optional(),
    budget: z
      .object({
        availableLines: z.number().int().min(0).max(100),
        usedLines: z.number().int().min(0).max(100),
      })
      .strict(),
    notice: shortText.optional(),
  })
  .strict();

export const ResumeDraftJobSchema = z
  .object({
    company: z.string().trim().max(160),
    roleTitle: z.string().trim().max(160),
    jobUrl: z.string().trim().max(2048),
    contextId: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const ResumeDraftJobRequestSchema = z
  .object({
    company: z.string().trim().max(160),
    roleTitle: z.string().trim().max(160),
    jobUrl: z.string().trim().max(2048),
    contextId: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const ResumeDraftRequirementSchema = z
  .object({
    id: StableIdSchema,
    category: z.enum(["required", "responsibility", "preferred", "context"]),
    text: shortText,
    status: CoverageStatusSchema,
    evidence: z.array(CoverageEvidenceSchema).optional(),
    availableAchievementIds: z.array(StableIdSchema).max(500),
    selectedAchievementIds: z.array(StableIdSchema).max(100),
    reason: shortText,
  })
  .strict();

export const ResumeDraftSourceSchema = z
  .object({
    achievementId: StableIdSchema,
    text,
    section: z.enum(["experience", "projects"]),
    groupId: StableIdSchema,
    groupTitle: shortText,
    groupSubtitle: shortText.optional(),
    linkedSkills: z.array(shortText).max(100),
    metrics: z.array(MetricSchema).optional(),
    context: text.optional(),
    inferredSkills: z
      .array(z.object({ name: shortText, reason: shortText }).strict())
      .optional(),
    supportedRequirementIds: z.array(StableIdSchema).max(2000),
    selectionConfidence: z.number().min(0).max(1).optional(),
  })
  .strict();

export const ResumeDraftHandoffSchema = z
  .object({
    job: ResumeDraftJobSchema,
    requirements: z.array(ResumeDraftRequirementSchema).max(2000),
    selectedAchievements: z.array(ResumeDraftSourceSchema).min(1).max(100),
    suggestedEvidence: z.array(ResumeDraftSourceSchema).max(30),
    contentBudgetLines: z.number().int().min(0).max(100),
  })
  .strict();

export const ResumeDraftInputSchema = z
  .object({
    jobDescription: z.string().trim().min(1).max(30_000),
    analysis: JobAnalysisResultSchema,
    achievements: z.array(AchievementEvidenceSchema).min(1).max(100),
    handoff: ResumeDraftHandoffSchema,
    templateContext: z.string().max(30_000).optional(),
    skills: z.array(SkillEvidenceSchema).optional(),
    profile: ProfileEvidenceSchema.optional(),
  })
  .strict();

export const ResumeDraftResultSchema = z
  .object({
    summary: z.string().trim().max(1_500),
    resumeSummary: z.string().trim().max(1_500).optional(),
    achievementText: z
      .array(
        z
          .object({
            achievementId: StableIdSchema,
            text,
            rationale: shortText.optional(),
            sourceAchievementIds: z
              .array(StableIdSchema)
              .min(1)
              .max(100)
              .optional(),
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
    sourceAchievementIds: z.array(StableIdSchema).optional(),
    inferredTerms: terms.optional(),
    retainedMetricIds: z.array(StableIdSchema).optional(),
    qualityNotes: terms.optional(),
  })
  .strict();

export const TailorAchievementsResponseSchema = z
  .object({
    proposals: z.array(TailoredAchievementProposalSchema).min(1).max(100),
    resumeSummary: z.string().trim().max(1_500).optional(),
    qualityNotes: terms.optional(),
    summary: z.string().trim().min(1).max(1_500),
    analyzedTerms: z.array(shortText).max(2000),
    mode: z.enum(["ai", "originals-fallback"]),
    handoff: ResumeDraftHandoffSchema,
    notice: shortText.optional(),
  })
  .strict();

export const AutoTailorResponseSchema = z
  .object({
    recommendation: AchievementSelectionResponseSchema,
    tailoring: TailorAchievementsResponseSchema,
    selectedSkillIds: z.array(StableIdSchema).max(200),
    draftingMode: z.enum(["ai", "originals-fallback"]),
    compiled: z
      .object({
        latex: z.string().max(150000),
        metadata: z.custom<
          import("../generation/manual-generation").ManualGenerationMetadata
        >((value) =>
          Boolean(
            value &&
            typeof value === "object" &&
            "selectedAchievementIds" in value &&
            "renderedSkillIds" in value &&
            "generatedAt" in value,
          ),
        ),
        pdfBase64: z.string().min(1).max(2000000),
      })
      .strict()
      .optional(),
  })
  .strict();

export const LatexRepairInputSchema = z
  .object({
    currentContent: ResumeDraftResultSchema,
    diagnostics: z.array(shortText).min(1).max(50),
    firstPageText: z.string().max(20_000).optional(),
    overflowText: z.string().max(20_000).optional(),
    overflowWordCount: z.number().int().nonnegative().max(20_000).optional(),
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
export type ResumeDraftHandoff = z.infer<typeof ResumeDraftHandoffSchema>;
export type AutoTailorResponse = z.infer<typeof AutoTailorResponseSchema>;
export type LatexRepairInput = z.infer<typeof LatexRepairInputSchema>;
export type LatexRepairResult = z.infer<typeof LatexRepairResultSchema>;
