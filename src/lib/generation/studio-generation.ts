import { randomUUID } from "node:crypto";
import { z } from "zod";
import { StudioDocumentSchema, studioGroups } from "./studio-document";
import { placeSkills, type SkillMeasurements } from "./skill-layout";
import { renderResumeLatex, ResumeRenderError } from "../latex/render-resume";
import type { ResumeLibrary, AchievementPoint } from "../schemas/resume-data";
import type { ManualGenerationResult } from "./manual-generation";

export const StudioApplySchema = z
  .object({
    dataSource: z.enum(["personal", "demo"]),
    document: StudioDocumentSchema,
    context: z
      .object({
        company: z.string().trim().max(160),
        roleTitle: z.string().trim().max(160),
        jobUrl: z
          .string()
          .max(2048)
          .refine((value) => !value || /^https?:\/\//i.test(value)),
        tailoringMode: z.enum(["manual", "guided", "auto"]),
      })
      .strict(),
  })
  .strict();

export function renderStudioGeneration(
  library: ResumeLibrary,
  input: z.infer<typeof StudioApplySchema>,
  measurements: SkillMeasurements,
): ManualGenerationResult {
  const { document, context, dataSource } = StudioApplySchema.parse(input);
  const groups = studioGroups(library);
  const points = new Map(
    [...library.jobs, ...library.projects].flatMap((group) =>
      group.points.map(
        (point) => [point.id, { ...point, groupId: group.id }] as const,
      ),
    ),
  );
  const skills = new Set(library.skills.map((skill) => skill.id));
  for (const bullet of document.bullets) {
    if (!groups.some((group) => group.id === bullet.groupId))
      throw new ResumeRenderError(
        "An achievement destination no longer exists. Choose a current job or project.",
      );
    if (
      points.has(bullet.id) &&
      points.get(bullet.id)!.groupId !== bullet.groupId
    )
      throw new ResumeRenderError(
        "An achievement cannot be attributed to a different company or project.",
      );
    if (
      bullet.sourceAchievementIds.some(
        (id) => !points.has(id) || points.get(id)!.groupId !== bullet.groupId,
      )
    )
      throw new ResumeRenderError(
        "Achievement sources must belong to their destination company or project.",
      );
    if (bullet.skillIds.some((id) => !skills.has(id)))
      throw new ResumeRenderError(
        "An achievement references a skill that is no longer in your library.",
      );
  }
  if (document.skillIds.some((id) => !skills.has(id)))
    throw new ResumeRenderError(
      "A selected skill is no longer in your library.",
    );
  const visibleSkills = document.sectionOrder.includes("skills")
    ? document.skillIds
    : [];
  const missingWidth = visibleSkills.find(
    (id) => !Number.isFinite(measurements.widths[id]),
  );
  if (missingWidth)
    throw new ResumeRenderError(
      `${library.skills.find((skill) => skill.id === missingWidth)!.name} could not be measured with the template font. Remove it or revise its name before applying.`,
    );
  const placement = placeSkills(visibleSkills, measurements);
  if (!placement)
    throw new ResumeRenderError(
      "These skills cannot fit in two template rows. Remove a skill before applying. Your current PDF is unchanged.",
    );

  const replacePoints = <T extends { id: string; points: AchievementPoint[] }>(
    collection: T[],
  ): T[] =>
    collection.map((group) => {
      const bullets = document.bullets.filter(
        (bullet) => bullet.groupId === group.id,
      );
      const ids = new Set(bullets.map((bullet) => bullet.id));
      return {
        ...group,
        points: [
          ...group.points.filter((point) => !ids.has(point.id)),
          ...bullets.map((bullet): AchievementPoint => ({
            id: bullet.id,
            text: bullet.text,
            tags: [],
            skillIds: bullet.skillIds,
            metrics: [],
            source: { type: "direct-user", label: "Resume Studio draft" },
            enabled: true,
          })),
        ],
      };
    });
  const workingLibrary: ResumeLibrary = {
    ...library,
    profile: { ...library.profile, summary: document.summary || undefined },
    jobs: replacePoints(library.jobs),
    projects: replacePoints(library.projects),
  };
  const visibleBullets = document.bullets.filter((bullet) =>
    document.sectionOrder.includes(
      groups.find((group) => group.id === bullet.groupId)!.section,
    ),
  );
  const latex = renderResumeLatex({
    // Section exclusion retains its content in the draft without claiming it was rendered.
    library: workingLibrary,
    selectedAchievementIds: visibleBullets.map((bullet) => bullet.id),
    selectedSkillIds: visibleSkills,
    skillRows: placement.rows,
    sectionOrder: document.sectionOrder,
    summaryOverride: document.summary || undefined,
  });
  return {
    latex,
    metadata: {
      id: `studio-${randomUUID()}`,
      generatedAt: new Date().toISOString(),
      dataSource,
      ...context,
      selectedAchievementIds: [
        ...new Set(
          visibleBullets.flatMap((bullet) => bullet.sourceAchievementIds),
        ),
      ],
      sectionOrder: document.sectionOrder,
      sourceProvenance: visibleBullets.flatMap((bullet) =>
        bullet.sourceAchievementIds.map((id) => ({
          achievementId: id,
          section: groups.find((group) => group.id === bullet.groupId)!.section,
          groupId: bullet.groupId,
          groupTitle: groups.find((group) => group.id === bullet.groupId)!
            .title,
          originalText: points.get(id)!.text,
          renderedText: bullet.text,
        })),
      ),
      selectedSkillIds: document.skillIds,
      renderedSkillIds: placement.rows.flat(),
      resumeSummary: document.summary,
      visibleWordCount: 0,
      generatedBullets: visibleBullets.map((bullet) => ({
        achievementId: bullet.id,
        sourceAchievementIds: bullet.sourceAchievementIds,
        text: bullet.text,
        inferredTerms: bullet.inferredTerms,
      })),
      studioDocument: document,
    },
  };
}
