import { describe, expect, it } from "vitest";
import {
  describeSectionInclusion,
  resolveSkillReviewState,
  REVIEW_SECTIONS,
  sectionToggleLabel,
  skillReviewStateBadge,
  skillReviewStateDescription,
} from "../../../src/lib/generation/review-inclusion";
import { StudioDocumentSchema } from "../../../src/lib/generation/studio-document";

describe("section inclusion controls", () => {
  it("names every reviewable section with a stable label", () => {
    expect(REVIEW_SECTIONS).toEqual([
      "projects",
      "education",
      "credentials",
      "skills",
    ]);
    expect(sectionToggleLabel("projects")).toBe("Include Projects section");
    expect(sectionToggleLabel("credentials")).toBe("Include credentials");
    expect(sectionToggleLabel("skills")).toBe("Include skills");
    expect(sectionToggleLabel("education")).toBe("Include education");
  });

  it("counts the included sections out of the reviewable total", () => {
    expect(describeSectionInclusion(4, 4)).toBe("4 of 4 sections included");
    expect(describeSectionInclusion(0, 4)).toBe("0 of 4 sections included");
  });

  it("cannot produce a document without a section", () => {
    const parsed = StudioDocumentSchema.safeParse({
      version: 1,
      bullets: [],
      skillIds: [],
      sectionOrder: [],
      summary: "",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("skill inclusion states", () => {
  it("separates a draft change from an unchanged skill", () => {
    expect(
      resolveSkillReviewState({
        selected: true,
        inCurrentResume: true,
        fits: true,
        unsupported: false,
      }),
    ).toBe("in-current-resume");
    expect(
      resolveSkillReviewState({
        selected: true,
        inCurrentResume: false,
        fits: true,
        unsupported: false,
      }),
    ).toBe("added-to-draft");
    expect(
      resolveSkillReviewState({
        selected: false,
        inCurrentResume: true,
        fits: true,
        unsupported: false,
      }),
    ).toBe("removed-from-draft");
  });

  it("reports an available skill without a badge", () => {
    const state = resolveSkillReviewState({
      selected: false,
      inCurrentResume: false,
      fits: true,
      unsupported: false,
    });
    expect(state).toBe("available");
    expect(skillReviewStateBadge(state)).toBe("");
    expect(skillReviewStateDescription(state)).toBe("");
  });

  it("explains a skill that cannot be measured or cannot fit", () => {
    expect(
      resolveSkillReviewState({
        selected: false,
        inCurrentResume: false,
        fits: false,
        unsupported: true,
      }),
    ).toBe("not-measured");
    expect(
      resolveSkillReviewState({
        selected: false,
        inCurrentResume: false,
        fits: false,
        unsupported: false,
      }),
    ).toBe("does-not-fit");
    expect(
      skillReviewStateDescription("not-measured"),
    ).toBe("Could not be measured with the resume font.");
    expect(skillReviewStateDescription("does-not-fit")).toBe(
      "Does not fit in the two skill lines.",
    );
  });

  it("keeps the recommendation in the description, not in the name", () => {
    expect(skillReviewStateDescription("available", true)).toBe(
      "Recommended for this job.",
    );
    expect(
      skillReviewStateDescription("added-to-draft", true),
    ).toBe("Added in this draft. Recommended for this job.");
  });
});
