import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ResumeDataSource } from "../data/loaders";
import { MAX_JD_CHARACTERS } from "../jd-draft";
import { renderResumeLatex } from "../latex/render-resume";
import { StableIdSchema } from "../schemas/resume-data";
import type { ResumeLibrary } from "../schemas/resume-data";

function isHttpUrl(value: string) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export const ManualGenerationRequestSchema = z
  .object({
    dataSource: z.enum(["personal", "demo"]).default("personal"),
    company: z.string().trim().max(160),
    roleTitle: z.string().trim().max(160),
    jobUrl: z.string().trim().max(2048).refine(isHttpUrl, {
      message: "Job link must use HTTP or HTTPS.",
    }),
    jobDescription: z
      .string()
      .trim()
      .min(1, "Enter a job description before generating.")
      .max(MAX_JD_CHARACTERS),
    selectedAchievementIds: z.array(StableIdSchema).min(1),
  })
  .strict();

export type ManualGenerationRequest = z.infer<
  typeof ManualGenerationRequestSchema
>;

export type ManualGenerationMetadata = {
  id: string;
  generatedAt: string;
  dataSource: ResumeDataSource;
  company: string;
  roleTitle: string;
  jobUrl: string;
  selectedAchievementIds: string[];
};

export type ManualGenerationResult = {
  latex: string;
  metadata: ManualGenerationMetadata;
};

export function createManualGeneration(
  library: ResumeLibrary,
  request: ManualGenerationRequest,
  options: { id?: string; now?: Date } = {},
): ManualGenerationResult {
  const latex = renderResumeLatex({
    library,
    selectedAchievementIds: request.selectedAchievementIds,
  });

  return {
    latex,
    metadata: {
      id: options.id ?? `manual-${randomUUID()}`,
      generatedAt: (options.now ?? new Date()).toISOString(),
      dataSource: request.dataSource,
      company: request.company,
      roleTitle: request.roleTitle,
      jobUrl: request.jobUrl,
      selectedAchievementIds: request.selectedAchievementIds,
    },
  };
}
