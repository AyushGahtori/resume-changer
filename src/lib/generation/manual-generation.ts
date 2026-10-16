import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ResumeDataSource } from "../data/loaders";
import { MAX_JD_CHARACTERS } from "../jd-draft";
import {
  renderResumeLatex,
  ResumeRenderError,
  selectSkillsForResume,
} from "../latex/render-resume";
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
    tailoringMode: z.enum(["manual", "guided", "auto"]).default("manual"),
    selectedSkillIds: z.array(StableIdSchema).optional(),
    achievementTextOverrides: z
      .array(
        z
          .object({
            achievementId: StableIdSchema,
            text: z.string().trim().min(1).max(8_000),
          })
          .strict(),
      )
      .max(100)
      .optional(),
  })
  .strict();

export type ManualGenerationRequest = z.input<
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
  tailoringMode: "manual" | "guided" | "auto";
  sourceProvenance: Array<{
    achievementId: string;
    section: "experience" | "projects";
    groupId: string;
    groupTitle: string;
    originalText: string;
    renderedText: string;
  }>;
  selectedSkillIds?: string[];
  renderedSkillIds: string[];
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
  const normalized = ManualGenerationRequestSchema.parse(request);
  if (normalized.selectedSkillIds) {
    const selectedAchievementIds = new Set(normalized.selectedAchievementIds);
    const skillsById = new Map(
      library.skills.map((skill) => [skill.id, skill]),
    );
    for (const skillId of normalized.selectedSkillIds) {
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
    selectedAchievementIds: normalized.selectedAchievementIds,
    selectedSkillIds: normalized.selectedSkillIds,
    jobDescription: normalized.jobDescription,
    achievementTextOverrides: normalized.achievementTextOverrides,
  });
  const requestedSkillIds =
    normalized.selectedSkillIds ??
    library.skills
      .filter((skill) => skill.isListedOnCurrentResume)
      .map((skill) => skill.id);
  const selectedPointIds = new Set(normalized.selectedAchievementIds);
  const selectedPoints = [...library.jobs, ...library.projects]
    .flatMap((group) => group.points)
    .filter((point) => selectedPointIds.has(point.id));
  const skillById = new Map(library.skills.map((skill) => [skill.id, skill]));
  const renderedSkillIds = selectSkillsForResume(
    requestedSkillIds.map((id) => skillById.get(id)!),
    selectedPoints,
    normalized.jobDescription,
  ).map((skill) => skill.id);
  const overrideById = new Map(
    (normalized.achievementTextOverrides ?? []).map((item) => [
      item.achievementId,
      item.text,
    ]),
  );
  const sourceProvenance = [
    ...library.jobs.flatMap((group) =>
      group.points.map((point) => ({
        achievementId: point.id,
        section: "experience" as const,
        groupId: group.id,
        groupTitle: group.title,
        originalText: point.text,
      })),
    ),
    ...library.projects.flatMap((group) =>
      group.points.map((point) => ({
        achievementId: point.id,
        section: "projects" as const,
        groupId: group.id,
        groupTitle: group.name,
        originalText: point.text,
      })),
    ),
  ]
    .filter((point) =>
      normalized.selectedAchievementIds.includes(point.achievementId),
    )
    .map((point) => ({
      ...point,
      renderedText: overrideById.get(point.achievementId) ?? point.originalText,
    }));

  return {
    latex,
    metadata: {
      id: options.id ?? `manual-${randomUUID()}`,
      generatedAt: (options.now ?? new Date()).toISOString(),
      dataSource: normalized.dataSource,
      company: normalized.company,
      roleTitle: normalized.roleTitle,
      jobUrl: normalized.jobUrl,
      selectedAchievementIds: normalized.selectedAchievementIds,
      tailoringMode: normalized.tailoringMode,
      sourceProvenance,
      renderedSkillIds,
      ...(normalized.selectedSkillIds
        ? { selectedSkillIds: normalized.selectedSkillIds }
        : {}),
    },
  };
}
