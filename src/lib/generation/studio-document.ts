import { z } from "zod";
import {
  ResumeSectionTypeSchema,
  StableIdSchema,
  type ResumeLibrary,
} from "../schemas/resume-data";
import type { ManualGenerationResult } from "./manual-generation";

export const StudioBulletSchema = z
  .object({
    id: StableIdSchema,
    groupId: StableIdSchema,
    text: z.string().trim().min(1).max(8000),
    originalText: z.string().max(8000),
    sourceAchievementIds: z.array(StableIdSchema).max(100),
    skillIds: z.array(StableIdSchema).max(200),
    inferredTerms: z.array(z.string()).optional(),
  })
  .strict();

export const StudioDocumentSchema = z
  .object({
    version: z.literal(1),
    bullets: z.array(StudioBulletSchema).max(100),
    skillIds: z.array(StableIdSchema).max(200),
    sectionOrder: z.array(ResumeSectionTypeSchema).min(1).max(5),
    summary: z.string().max(1500),
  })
  .strict()
  .superRefine((document, context) => {
    for (const [key, ids] of [
      ["bullets", document.bullets.map((bullet) => bullet.id)],
      ["skillIds", document.skillIds],
      ["sectionOrder", document.sectionOrder],
    ] as const) {
      if (new Set(ids).size !== ids.length)
        context.addIssue({
          code: "custom",
          path: [key],
          message: "Duplicate entries are not allowed.",
        });
    }
    for (const [index, bullet] of document.bullets.entries()) {
      if (
        new Set(bullet.sourceAchievementIds).size !==
        bullet.sourceAchievementIds.length
      )
        context.addIssue({
          code: "custom",
          path: ["bullets", index],
          message: "A source may be linked only once.",
        });
    }
  });

export type StudioDocument = z.infer<typeof StudioDocumentSchema>;
export type StudioBullet = z.infer<typeof StudioBulletSchema>;
export type StudioGroup = {
  id: string;
  title: string;
  subtitle: string;
  section: "experience" | "projects";
};

export function studioGroups(library: ResumeLibrary): StudioGroup[] {
  return [
    ...library.jobs.map((job) => ({
      id: job.id,
      title: job.title,
      subtitle: job.company,
      section: "experience" as const,
    })),
    ...library.projects.map((project) => ({
      id: project.id,
      title: project.name,
      subtitle: project.role ?? "",
      section: "projects" as const,
    })),
  ];
}

export function documentFromGeneration(
  generation: ManualGenerationResult,
  library: ResumeLibrary,
): StudioDocument {
  const restored = StudioDocumentSchema.safeParse(
    generation.metadata.studioDocument,
  );
  if (restored.success) return restored.data;
  const points = new Map(
    [...library.jobs, ...library.projects].flatMap((group) =>
      group.points.map(
        (point) => [point.id, { ...point, groupId: group.id }] as const,
      ),
    ),
  );
  return {
    version: 1,
    bullets: (generation.metadata.generatedBullets?.length
      ? generation.metadata.generatedBullets
      : generation.metadata.selectedAchievementIds.map((id) => ({
          achievementId: id,
          sourceAchievementIds: [id],
          text:
            generation.metadata.sourceProvenance?.find(
              (point) => point.achievementId === id,
            )?.renderedText ??
            points.get(id)?.text ??
            "",
          inferredTerms: undefined,
        }))
    ).flatMap((bullet) => {
      const source =
        points.get(bullet.achievementId) ??
        points.get(bullet.sourceAchievementIds[0]);
      if (!source) return [];
      return [
        {
          id: bullet.achievementId,
          groupId: source.groupId,
          text: bullet.text,
          originalText: source.text,
          sourceAchievementIds: bullet.sourceAchievementIds,
          skillIds: [
            ...new Set(
              bullet.sourceAchievementIds.flatMap(
                (id) => points.get(id)?.skillIds ?? [],
              ),
            ),
          ],
          inferredTerms: bullet.inferredTerms,
        },
      ];
    }),
    skillIds: [...generation.metadata.renderedSkillIds],
    sectionOrder: [
      ...(generation.metadata.sectionOrder ?? library.preferences.sectionOrder),
    ],
    summary: generation.metadata.resumeSummary ?? library.profile.summary ?? "",
  };
}

export function draftChangeCount(
  current: StudioDocument,
  draft: StudioDocument,
): number {
  const before = new Map(current.bullets.map((bullet) => [bullet.id, bullet]));
  let changes = draft.bullets.filter(
    (bullet, index) =>
      JSON.stringify(bullet) !== JSON.stringify(before.get(bullet.id)) ||
      current.bullets[index]?.id !== bullet.id,
  ).length;
  changes += current.bullets.filter(
    (bullet) => !draft.bullets.some((item) => item.id === bullet.id),
  ).length;
  const skillChanges =
    current.skillIds.filter((id) => !draft.skillIds.includes(id)).length +
    draft.skillIds.filter((id) => !current.skillIds.includes(id)).length;
  changes +=
    skillChanges ||
    (JSON.stringify(current.skillIds) !== JSON.stringify(draft.skillIds)
      ? 1
      : 0);
  changes +=
    JSON.stringify(current.sectionOrder) === JSON.stringify(draft.sectionOrder)
      ? 0
      : 1;
  changes += current.summary === draft.summary ? 0 : 1;
  return changes;
}

export function validateMerge(
  document: StudioDocument,
  ids: string[],
): string | null {
  const bullets = ids.map((id) =>
    document.bullets.find((bullet) => bullet.id === id),
  );
  if (new Set(ids).size !== ids.length || bullets.some((bullet) => !bullet))
    return "Choose distinct achievements that are still in the draft.";
  if (ids.length < 2 || ids.length > 3)
    return "Connect two or three achievements to merge.";
  if (new Set(bullets.map((bullet) => bullet!.groupId)).size !== 1)
    return "Merge points from the same company or project to preserve their attribution.";
  const sourceCount = new Set(
    bullets.flatMap((bullet) =>
      bullet!.sourceAchievementIds.length
        ? bullet!.sourceAchievementIds
        : [bullet!.id],
    ),
  ).size;
  if (sourceCount > 3)
    return "A merge can contain at most three original achievements.";
  return null;
}

export function mergeDraftBullets(
  document: StudioDocument,
  ids: string[],
  text: string,
  id: string,
): StudioDocument {
  const error = validateMerge(document, ids);
  if (error) throw new Error(error);
  const sources = document.bullets.filter((bullet) => ids.includes(bullet.id));
  const merged: StudioBullet = {
    id,
    groupId: sources[0].groupId,
    text,
    originalText: sources.map((bullet) => bullet.text).join("\n"),
    sourceAchievementIds: [
      ...new Set(sources.flatMap((bullet) => bullet.sourceAchievementIds)),
    ],
    skillIds: [...new Set(sources.flatMap((bullet) => bullet.skillIds))],
  };
  const first = document.bullets.findIndex((bullet) => ids.includes(bullet.id));
  return {
    ...document,
    bullets: document.bullets.flatMap((bullet, index) =>
      index === first ? [merged] : ids.includes(bullet.id) ? [] : [bullet],
    ),
  };
}
