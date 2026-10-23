import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ImaginationContextLibraries, {
  filterAchievementContext,
  type ImaginationContextLibrariesProps,
  filterSkillContextGroups,
  getAchievementContextEmptyMessage,
  getSkillContextEmptyMessage,
  getDestinationAchievementGroups,
  isContextSelectionDisabled,
  shouldExpandSkillCategory,
  toggleContextSelection,
  updateExpandedSkillCategories,
} from "../../../src/components/imagination-context-libraries";
import { groupSkillsForReview } from "../../../src/lib/generation/review-draft";
import type {
  AchievementPoint,
  ResumeLibrary,
  Skill,
} from "../../../src/lib/schemas/resume-data";
import { studioLibrary } from "../../helpers/studio-fixtures";

function achievement(
  id: string,
  text: string,
  enabled = true,
): AchievementPoint {
  return {
    id,
    text,
    tags: [],
    skillIds: [],
    metrics: [],
    source: { type: "direct-user" },
    enabled,
  };
}

const skill = (
  id: string,
  name: string,
  category: string,
  aliases: string[] = [],
): Skill => ({
  id,
  name,
  category,
  aliases,
  sources: ["direct-user"],
  isListedOnCurrentResume: false,
  evidenceAchievementIds: [],
});

const library: ResumeLibrary = {
  ...studioLibrary,
  jobs: [
    {
      ...studioLibrary.jobs[0]!,
      id: "job-platform",
      title: "Platform engineer",
      company: "Northstar Labs",
      points: [
        achievement("achievement-api", "Built a reliable REST API with Nginx."),
        achievement(
          "achievement-disabled",
          "Disabled evidence should stay hidden.",
          false,
        ),
      ],
    },
  ],
  projects: [
    {
      ...studioLibrary.projects[0]!,
      id: "project-telemetry",
      name: "Telemetry pipeline",
      points: [
        achievement(
          "achievement-project",
          "Added observability to project services.",
        ),
      ],
    },
  ],
  skills: [
    skill("skill-python", "Python", "Programming Languages", ["py"]),
    skill("skill-spark", "Apache Spark", "Data Engineering and Analytics", [
      "spark",
    ]),
    skill("skill-react", "React", "Frontend Development"),
  ],
};

function renderLibraries(
  overrides: Partial<ImaginationContextLibrariesProps> = {},
) {
  const props: ImaginationContextLibrariesProps = {
    library,
    destinationGroupId: "job-platform",
    selectedAchievementIds: [],
    selectedSkillIds: [],
    onSelectedAchievementIdsChange: () => {},
    onSelectedSkillIdsChange: () => {},
    ...overrides,
  };

  return renderToStaticMarkup(
    createElement(ImaginationContextLibraries, props),
  );
}

describe("Imagination Canvas context libraries", () => {
  it("groups job and project evidence by destination and excludes disabled points", () => {
    const groups = getDestinationAchievementGroups(library);

    expect(groups.map((group) => [group.id, group.section])).toEqual([
      ["job-platform", "experience"],
      ["project-telemetry", "projects"],
    ]);
    expect(groups[0]?.achievements).toEqual([
      {
        id: "achievement-api",
        groupId: "job-platform",
        text: "Built a reliable REST API with Nginx.",
        destinationTitle: "Platform engineer",
        destinationSection: "experience",
      },
    ]);
    expect(groups[1]?.achievements[0]?.groupId).toBe("project-telemetry");
  });

  it("searches achievement text and skill names or aliases independently", () => {
    const groups = getDestinationAchievementGroups(library);
    const skillGroups = groupSkillsForReview(library.skills);

    expect(
      filterAchievementContext(groups[0]!.achievements, "  nginx "),
    ).toHaveLength(1);
    expect(
      filterAchievementContext(groups[0]!.achievements, "telemetry"),
    ).toEqual([]);
    expect(
      filterSkillContextGroups(skillGroups, "spark").flatMap((group) =>
        group.skills.map((item) => item.id),
      ),
    ).toEqual(["skill-spark"]);
    expect(filterAchievementContext(groups[0]!.achievements, "spark")).toEqual(
      [],
    );
    expect(getAchievementContextEmptyMessage(groups[0], "no match")).toBe(
      "No achievements match your search.",
    );
    expect(getSkillContextEmptyMessage(library.skills.length, "no match")).toBe(
      "No skills match your search.",
    );
  });

  it("keeps skill categories expandable and opens matching categories while searching", () => {
    const groups = groupSkillsForReview(library.skills);
    const firstCategory = groups[0]!.category;

    const markup = renderLibraries();
    expect(markup).toContain("<summary>Programming Languages</summary>");
    expect(markup).toContain("<summary>Frontend Development</summary>");
    expect(markup).toMatch(/<details open=""/);
    expect(
      shouldExpandSkillCategory(firstCategory, "", [], firstCategory),
    ).toBe(true);
    expect(
      shouldExpandSkillCategory(
        "Frontend Development",
        "",
        [firstCategory],
        firstCategory,
      ),
    ).toBe(false);
    expect(
      shouldExpandSkillCategory(
        "Frontend Development",
        "react",
        [],
        firstCategory,
      ),
    ).toBe(true);
    expect(
      updateExpandedSkillCategories(
        [firstCategory],
        "Frontend Development",
        true,
      ),
    ).toEqual([firstCategory, "Frontend Development"]);
    expect(
      updateExpandedSkillCategories(
        [firstCategory, "Frontend Development"],
        "Frontend Development",
        false,
      ),
    ).toEqual([firstCategory]);
  });

  it("shows selected state and leaves selected items removable at capacity", () => {
    const selectedSkills = Array.from(
      { length: 9 },
      (_, index) => "selected-skill-" + index,
    );
    const markup = renderLibraries({
      selectedAchievementIds: ["achievement-api"],
      selectedSkillIds: selectedSkills,
    });

    const selectedAchievement = markup
      .split("</button>")
      .find(
        (button) =>
          button.includes('class="imagination-context-card"') &&
          button.includes("Built a reliable REST API"),
      );

    expect(selectedAchievement).toContain('aria-pressed="true"');
    expect(selectedAchievement).not.toContain("disabled");
    expect(markup).toContain(
      "Ten context items are connected. Disconnect one before adding another.",
    );
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain("disabled");
  });

  it("blocks the eleventh item, allows removal, and prevents duplicates", () => {
    const nineSelected = Array.from(
      { length: 9 },
      (_, index) => "achievement-" + index,
    );
    const next = toggleContextSelection(nineSelected, ["skill-one"], "new-id");

    expect(next).toEqual({
      selectedIds: nineSelected,
      changed: false,
      limitReached: true,
    });
    expect(
      isContextSelectionDisabled("new-id", nineSelected, ["skill-one"]),
    ).toBe(true);
    expect(
      isContextSelectionDisabled("selected", ["selected"], ["skill-one"]),
    ).toBe(false);
    expect(
      toggleContextSelection(["same", "same"], [], "same").selectedIds,
    ).toEqual([]);
    expect(toggleContextSelection(["one"], [], "two").selectedIds).toEqual([
      "one",
      "two",
    ]);
    expect(toggleContextSelection(["one"], ["two"], "two")).toMatchObject({
      changed: false,
      limitReached: false,
    });
  });

  it("shows an explicit empty destination state without inventing evidence", () => {
    const markup = renderLibraries({
      destinationGroupId: "missing-destination",
    });

    expect(markup).toContain(
      "Choose a resume destination to browse achievements.",
    );
    expect(markup).not.toContain("Built a reliable REST API");
  });

  it("returns distinct no-results and no-skills states", () => {
    const groups = getDestinationAchievementGroups(library);

    expect(
      filterAchievementContext(groups[0]!.achievements, "no match"),
    ).toEqual([]);
    expect(
      filterSkillContextGroups(
        groupSkillsForReview(library.skills),
        "no match",
      ),
    ).toEqual([]);

    const noSkillsLibrary = { ...library, skills: [] };
    const markup = renderLibraries({ library: noSkillsLibrary });

    expect(markup).toContain("No skills are available in this library.");
  });
});
