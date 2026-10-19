import { describe, expect, it } from "vitest";
import {
  categorizeSkill,
  groupSkillsForReview,
} from "../../../src/lib/generation/review-draft";
import { studioLibrary } from "../../helpers/studio-fixtures";
describe("skill taxonomy", () => {
  it("groups each declared skill once", () => {
    const groups = groupSkillsForReview(studioLibrary.skills);
    expect(
      groups.flatMap((group) => group.skills.map((skill) => skill.id)).sort(),
    ).toEqual(studioLibrary.skills.map((skill) => skill.id).sort());
    expect(
      categorizeSkill(
        studioLibrary.skills.find((skill) => skill.name === "Python")!,
      ),
    ).toBe("Programming Languages");
    expect(
      categorizeSkill(
        studioLibrary.skills.find((skill) => skill.name === "React")!,
      ),
    ).toBe("Frontend Development");
    expect(
      categorizeSkill({
        ...studioLibrary.skills[0],
        name: "TensorFlow",
        category: "Machine Learning",
      }),
    ).toBe("Machine Learning and AI");
  });
  it("handles unfamiliar and empty skill libraries", () => {
    expect(groupSkillsForReview([])).toEqual([]);
    expect(
      categorizeSkill({
        ...studioLibrary.skills[0],
        name: "Mentoring",
        category: "Collaboration",
      }),
    ).toBe("Other Skills");
  });
});
