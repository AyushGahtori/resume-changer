import { describe, expect, it } from "vitest";
import {
  buildPointChips,
  getVisiblePointChips,
  MAX_VISIBLE_POINT_CHIPS,
} from "../../../src/lib/ui/point-chips";
import type { Skill } from "../../../src/lib/schemas/resume-data";

const skills: Skill[] = [
  {
    id: "skill-typescript",
    name: "TypeScript",
    aliases: [],
    sources: ["direct-user"],
    isListedOnCurrentResume: true,
    evidenceAchievementIds: [],
  },
  {
    id: "skill-infrastructure-as-code",
    name: "Infrastructure as Code",
    aliases: [],
    sources: ["direct-user"],
    isListedOnCurrentResume: false,
    evidenceAchievementIds: [],
  },
];

describe("achievement card chips", () => {
  it("keeps tags and linked skills apart and in their original order", () => {
    const chips = buildPointChips(
      { tags: ["backend", "api-design"], skillIds: ["skill-typescript"] },
      skills,
    );

    expect(chips).toEqual([
      {
        id: "tag:backend",
        kind: "tag",
        label: "backend",
        value: "backend",
      },
      {
        id: "tag:api-design",
        kind: "tag",
        label: "api-design",
        value: "api-design",
      },
      {
        id: "skill:skill-typescript",
        kind: "skill",
        label: "TypeScript",
        value: "skill-typescript",
      },
    ]);
  });

  it("shows every tag only once", () => {
    const chips = buildPointChips(
      {
        tags: ["backend", "backend", "api-design", "api-design"],
        skillIds: [],
      },
      skills,
    );

    expect(chips.map((chip) => chip.label)).toEqual(["backend", "api-design"]);
  });

  it("trims the label but keeps the stored tag as the filter value", () => {
    const chips = buildPointChips(
      { tags: [" api-design "], skillIds: [] },
      skills,
    );

    expect(chips[0]).toEqual({
      id: "tag:api-design",
      kind: "tag",
      label: "api-design",
      value: " api-design ",
    });
  });

  it("keeps the exact name of a linked skill", () => {
    const chips = buildPointChips(
      { tags: [], skillIds: ["skill-infrastructure-as-code"] },
      skills,
    );

    expect(chips).toEqual([
      {
        id: "skill:skill-infrastructure-as-code",
        kind: "skill",
        label: "Infrastructure as Code",
        value: "skill-infrastructure-as-code",
      },
    ]);
  });

  it("skips a skill ID that does not resolve instead of inventing a label", () => {
    const chips = buildPointChips(
      { tags: ["backend"], skillIds: ["skill-unknown", "skill-typescript"] },
      skills,
    );

    expect(chips.map((chip) => chip.label)).toEqual(["backend", "TypeScript"]);
  });

  it("keeps a short chip list fully visible", () => {
    const chips = buildPointChips(
      { tags: ["a", "b", "c"], skillIds: ["skill-typescript"] },
      skills,
    );

    expect(getVisiblePointChips(chips, false)).toEqual({
      visible: chips,
      hiddenCount: 0,
    });
  });

  it("hides the overflow behind a count and reveals it when expanded", () => {
    const tags = Array.from(
      { length: MAX_VISIBLE_POINT_CHIPS + 3 },
      (_, index) => `tag-${index}`,
    );
    const chips = buildPointChips({ tags, skillIds: [] }, skills);

    const collapsed = getVisiblePointChips(chips, false);
    expect(collapsed.visible).toHaveLength(MAX_VISIBLE_POINT_CHIPS);
    expect(collapsed.hiddenCount).toBe(3);

    const expanded = getVisiblePointChips(chips, true);
    expect(expanded.visible).toEqual(chips);
    expect(expanded.hiddenCount).toBe(0);
  });
});
