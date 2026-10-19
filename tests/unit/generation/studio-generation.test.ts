import { describe, expect, it } from "vitest";
import { renderStudioGeneration } from "../../../src/lib/generation/studio-generation";
import {
  studioApplyInput,
  studioLibrary,
  studioMeasurements,
} from "../../helpers/studio-fixtures";
describe("deterministic studio rendering", () => {
  it("applies skills without achievement selection and keeps every requested skill", () => {
    const document = {
      ...studioApplyInput.document,
      bullets: [],
      skillIds: ["skill-python", "skill-react"],
      sectionOrder: ["skills" as const],
    };
    const result = renderStudioGeneration(
      studioLibrary,
      { ...studioApplyInput, document },
      studioMeasurements,
    );
    expect(result.latex).toContain("Python");
    expect(result.latex).toContain("React");
    expect(result.metadata.renderedSkillIds.sort()).toEqual(
      document.skillIds.sort(),
    );
    expect(result.metadata.generatedBullets).toEqual([]);
  });
  it("renders manual points without mutating the library", () => {
    const original = JSON.stringify(studioLibrary);
    const bullet = {
      id: "studio-user-point",
      groupId: studioLibrary.jobs[0].id,
      text: "User-authored verified contribution.",
      originalText: "User-authored verified contribution.",
      sourceAchievementIds: [],
      skillIds: [],
    };
    const result = renderStudioGeneration(
      studioLibrary,
      {
        ...studioApplyInput,
        document: { ...studioApplyInput.document, bullets: [bullet] },
      },
      studioMeasurements,
    );
    expect(result.latex).toContain(bullet.text);
    expect(result.metadata.studioDocument?.bullets).toEqual([bullet]);
    expect(JSON.stringify(studioLibrary)).toBe(original);
  });
  it("retains excluded content in the draft but reports only rendered sections", () => {
    const document = {
      ...studioApplyInput.document,
      sectionOrder: ["education" as const],
    };
    const result = renderStudioGeneration(
      studioLibrary,
      { ...studioApplyInput, document },
      { ...studioMeasurements, widths: {} },
    );
    expect(result.metadata.generatedBullets).toEqual([]);
    expect(result.metadata.renderedSkillIds).toEqual([]);
    expect(result.metadata.studioDocument?.bullets).toEqual(document.bullets);
    expect(result.metadata.studioDocument?.skillIds).toEqual(document.skillIds);
  });
  it("rejects false attribution and overflowing skills", () => {
    const document = structuredClone(studioApplyInput.document);
    document.bullets[0].groupId = studioLibrary.projects[0].id;
    expect(() =>
      renderStudioGeneration(
        studioLibrary,
        { ...studioApplyInput, document },
        studioMeasurements,
      ),
    ).toThrow(/different company/);
    const overflow = {
      ...studioMeasurements,
      widths: Object.fromEntries(
        studioApplyInput.document.skillIds.map((id) => [id, 600]),
      ),
    };
    expect(() =>
      renderStudioGeneration(studioLibrary, studioApplyInput, overflow),
    ).toThrow(/cannot fit/);
  });
});
