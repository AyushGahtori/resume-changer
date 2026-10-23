import type { AchievementPoint, Skill } from "@/lib/schemas/resume-data";

/**
 * A chip on an achievement card.
 *
 * `kind` keeps the two chip families apart: a tag is a free-text label the
 * user typed, a linked skill points at a skill record in the library.
 */
export type PointChip = {
  /** Stable React key. */
  id: string;
  kind: "tag" | "skill";
  /** The exact label shown on the chip. */
  label: string;
  /** The filter value the chip applies. */
  value: string;
};

/**
 * How many chips stay visible before the row collapses behind a `+N`
 * disclosure. The disclosure is mandatory: a chip that is hidden without a
 * way to reveal it would drop information the reader needs.
 */
export const MAX_VISIBLE_POINT_CHIPS = 6;

type PointChipSource = Pick<AchievementPoint, "tags" | "skillIds">;

/**
 * Builds the chip list of one achievement point.
 *
 * Tags are kept in their original order and de-duplicated, because the
 * schema does not forbid the same tag twice. The chip shows the trimmed tag
 * and keeps the stored string as its filter value, so clicking a chip
 * always matches the data it came from. Linked skills keep the exact name of
 * the skill record, so the card never shows an invented label.
 *
 * A skill ID that does not resolve is skipped. The library schema rejects
 * unknown skill IDs, so this only happens for data that never passed
 * validation; showing the raw ID would be worse than showing nothing.
 */
export function buildPointChips(
  point: PointChipSource,
  skills: Skill[],
): PointChip[] {
  const skillsById = new Map(skills.map((skill) => [skill.id, skill]));
  const chips: PointChip[] = [];
  const seenTags = new Set<string>();
  const seenSkillIds = new Set<string>();

  for (const rawTag of point.tags) {
    const tag = rawTag.trim();
    if (!tag || seenTags.has(tag)) continue;
    seenTags.add(tag);
    chips.push({ id: `tag:${tag}`, kind: "tag", label: tag, value: rawTag });
  }

  for (const skillId of point.skillIds) {
    if (seenSkillIds.has(skillId)) continue;
    seenSkillIds.add(skillId);
    const skill = skillsById.get(skillId);
    if (!skill) continue;
    chips.push({
      id: `skill:${skill.id}`,
      kind: "skill",
      label: skill.name,
      value: skill.id,
    });
  }

  return chips;
}

/**
 * Splits the chip list into the visible chips and the number of chips that
 * stay hidden behind the `+N` disclosure.
 */
export function getVisiblePointChips(
  chips: PointChip[],
  expanded: boolean,
  pinnedIds: ReadonlySet<string> = new Set(),
): { visible: PointChip[]; hiddenCount: number } {
  if (expanded || chips.length <= MAX_VISIBLE_POINT_CHIPS) {
    return { visible: chips, hiddenCount: 0 };
  }

  const visibleIds = new Set(
    chips.slice(0, MAX_VISIBLE_POINT_CHIPS).map((chip) => chip.id),
  );
  for (const chip of chips) {
    if (pinnedIds.has(chip.id)) visibleIds.add(chip.id);
  }
  const visible = chips.filter((chip) => visibleIds.has(chip.id));
  return { visible, hiddenCount: chips.length - visible.length };
}
