import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ResumeDataSource } from "../data/loaders";
import { MAX_JD_CHARACTERS } from "../jd-draft";
import { renderResumeLatex, ResumeRenderError } from "../latex/render-resume";
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
    selectedSkillIds: z.array(StableIdSchema).optional(),
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
  selectedSkillIds?: string[];
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
  if (request.selectedSkillIds) {
    const selectedAchievementIds = new Set(request.selectedAchievementIds);
    const skillsById = new Map(
      library.skills.map((skill) => [skill.id, skill]),
    );
    for (const skillId of request.selectedSkillIds) {
      const skill = skillsById.get(skillId);
      if (!skill) throw new ResumeRenderError(`Unknown skill ID: ${skillId}.`);
      if (
        !skill.isListedOnCurrentResume &&
        !skill.evidenceAchievementIds.some((id) =>
          selectedAchievementIds.has(id),
        )
      ) {
        throw new ResumeRenderError(
          `Skill "${skill.name}" needs a selected supporting achievement point.`,
        );
      }
    }
  }

  const latex = renderResumeLatex({
    library,
    selectedAchievementIds: request.selectedAchievementIds,
    selectedSkillIds: request.selectedSkillIds,
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
      ...(request.selectedSkillIds
        ? { selectedSkillIds: request.selectedSkillIds }
        : {}),
    },
  };
}
