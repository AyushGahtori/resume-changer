import type { ResumeLibrary } from "../schemas/resume-data";
import type { AchievementEvidence, SkillEvidence } from "./contracts";

export function buildSkillEvidence(library: ResumeLibrary): SkillEvidence[] {
  const enabled = new Set(
    [...library.jobs, ...library.projects].flatMap((group) =>
      group.points.filter((p) => p.enabled).map((p) => p.id),
    ),
  );
  return library.skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    aliases: skill.aliases,
    isListedOnCurrentResume: skill.isListedOnCurrentResume,
    evidenceAchievementIds: [
      ...new Set([
        ...skill.evidenceAchievementIds,
        ...[...library.jobs, ...library.projects].flatMap((g) =>
          g.points
            .filter((p) => p.skillIds.includes(skill.id))
            .map((p) => p.id),
        ),
      ]),
    ].filter((id) => enabled.has(id)),
  }));
}

export function buildProfileEvidence(library: ResumeLibrary) {
  return {
    headline: library.profile.headline,
    summary: library.profile.summary,
    education: library.profile.education,
    credentials: library.credentials,
  };
}

export function buildAchievementEvidence(
  library: ResumeLibrary,
): AchievementEvidence[] {
  const skills = buildSkillEvidence(library);
  const build = (
    points: ResumeLibrary["jobs"][number]["points"],
    group: {
      id: string;
      title: string;
      subtitle?: string;
      context?: string;
      section: "experience" | "projects";
    },
  ) =>
    points
      .filter((p) => p.enabled)
      .map((point) => {
        const linked = skills.filter((s) =>
          s.evidenceAchievementIds.includes(point.id),
        );
        const sourceText = [point.text, ...point.tags].join(" ");
        // A declared framework plus a concrete compatible method permits a disclosed
        // inference. It is not evidence that every ML project used that framework.
        const compatible =
          /\b(cnn|convolutional|neural network|deep learning|backpropagation)\b/i.test(
            sourceText,
          );
        const inferredSkills = compatible
          ? skills
              .filter(
                (s) =>
                  /^(tensorflow|pytorch)$/i.test(s.name) &&
                  !linked.some((l) => l.id === s.id),
              )
              .map((s) => ({
                name: s.name,
                reason: `Inferred from the declared ${s.name} skill and a compatible neural-network method; project framework usage is not directly recorded.`,
              }))
          : [];
        return {
          id: point.id,
          text: point.text,
          tags: point.tags,
          skillIds: linked.map((s) => s.id),
          supportedSkills: [
            ...new Set(linked.flatMap((s) => [s.name, ...s.aliases])),
          ],
          inferredSkills,
          metrics: point.metrics,
          source: point.source,
          initiativeId: point.initiativeId,
          context:
            [group.context, point.context].filter(Boolean).join(" ") ||
            undefined,
          section: group.section,
          groupId: group.id,
          groupTitle: group.title,
          groupSubtitle: group.subtitle,
        };
      });
  return [
    ...library.jobs.flatMap((job) =>
      build(job.points, {
        id: job.id,
        title: job.title,
        subtitle: job.company,
        context: job.description,
        section: "experience",
      }),
    ),
    ...library.projects.flatMap((project) =>
      build(project.points, {
        id: project.id,
        title: project.name,
        subtitle: project.role,
        context: project.description,
        section: "projects",
      }),
    ),
  ];
}

export function evidenceText(item: AchievementEvidence) {
  return [
    item.text,
    item.context,
    ...item.tags,
    ...(item.supportedSkills ?? []),
    ...(item.metrics ?? []).map(
      (metric) =>
        `${metric.label} ${metric.value}${metric.unit ?? ""} ${metric.context ?? ""}`,
    ),
  ]
    .filter(Boolean)
    .join(" ");
}
