import { z } from "zod";
import { achievementDrafts } from "../intake/rough-notes";
import { detectSkillCandidates } from "../intake/skill-candidates";
import { StableIdSchema, type Skill } from "../schemas/resume-data";
import { normalizeSkillName } from "../skills/group-skills";
import {
  LibraryWriteError,
  collectEntityIds,
  commitLibraryMutation,
  skillIdForName,
  type WriteOptions,
} from "./writers";

const noteSchema = z.string().trim().min(1).max(4_000);

export const SaveRoughNotesInputSchema = z
  .object({
    parentType: z.enum(["job", "project"]),
    parentId: StableIdSchema,
    notes: z.array(noteSchema).min(1).max(30),
    acceptSkillNames: z
      .array(z.string().trim().min(1).max(80))
      .max(40)
      .default([]),
  })
  .strict();

export type SaveRoughNotesInput = z.infer<typeof SaveRoughNotesInputSchema>;

function skillKey(value: string) {
  return normalizeSkillName(value);
}

function matchesSkill(skill: Skill, key: string) {
  return [skill.name, ...skill.aliases].some(
    (value) => skillKey(value) === key,
  );
}

/**
 * Saves reviewed notes under one job or project and creates only the
 * skill names the user accepted from the notes themselves.
 */
export async function saveRoughNotes(
  input: SaveRoughNotesInput,
  options?: WriteOptions,
) {
  const parsed = SaveRoughNotesInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new LibraryWriteError(
      "invalid-input",
      "Check the notes and try again.",
    );
  }
  const { parentType, parentId, notes, acceptSkillNames } = parsed.data;
  const accepted = new Set(acceptSkillNames.map(skillKey));

  const { value } = await commitLibraryMutation((current) => {
    const parents = parentType === "job" ? current.jobs : current.projects;
    const parent = parents.find((item) => item.id === parentId);
    if (!parent) {
      throw new LibraryWriteError(
        "not-found",
        "The selected job or project was not found.",
      );
    }

    const used = new Set(collectEntityIds(current));
    const seen = new Set(parent.points.map((point) => point.text.trim()));
    const freshNotes: string[] = [];
    let skippedDuplicates = 0;
    for (const note of notes) {
      const text = note.trim();
      if (!text || seen.has(text)) {
        skippedDuplicates += 1;
        continue;
      }
      seen.add(text);
      freshNotes.push(text);
    }
    if (freshNotes.length === 0) {
      return {
        library: current,
        value: { points: [], createdSkills: [] as Skill[], skippedDuplicates },
        persist: false,
      };
    }
    const points = achievementDrafts(freshNotes, used).map((draft) => ({
      ...draft,
      skillIds: [] as string[],
    }));
    for (const point of points) used.add(point.id);

    const candidates = detectSkillCandidates(
      freshNotes,
      current.skills.map((skill) => ({
        name: skill.name,
        aliases: skill.aliases,
      })),
    );
    const skills = current.skills.map((skill) => ({
      ...skill,
      evidenceAchievementIds: [...skill.evidenceAchievementIds],
    }));
    const createdSkills: Skill[] = [];

    for (const candidate of candidates) {
      const key = skillKey(candidate.name);
      if (!accepted.has(key)) continue;
      let skill = skills.find((item) => matchesSkill(item, key));
      if (!skill) {
        const id = skillIdForName(candidate.name, used);
        used.add(id);
        skill = {
          id,
          name: candidate.name,
          aliases: candidate.aliases.filter((alias) => skillKey(alias) !== key),
          sources: ["direct-user"],
          isListedOnCurrentResume: false,
          evidenceAchievementIds: [],
        };
        skills.push(skill);
        createdSkills.push(skill);
      }
      for (const index of candidate.sourceIndexes) {
        const point = points[index];
        if (!point) continue;
        if (!point.skillIds.includes(skill.id)) point.skillIds.push(skill.id);
        if (!skill.evidenceAchievementIds.includes(point.id)) {
          skill.evidenceAchievementIds.push(point.id);
        }
      }
    }

    const jobs =
      parentType === "job"
        ? current.jobs.map((item) =>
            item.id === parentId
              ? { ...item, points: [...item.points, ...points] }
              : item,
          )
        : current.jobs;
    const projects =
      parentType === "project"
        ? current.projects.map((item) =>
            item.id === parentId
              ? { ...item, points: [...item.points, ...points] }
              : item,
          )
        : current.projects;

    return {
      library: {
        ...current,
        jobs,
        projects,
        skills,
      },
      value: { points, createdSkills, skippedDuplicates },
      persist: true,
    };
  }, options);

  return value;
}
