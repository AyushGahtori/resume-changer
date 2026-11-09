import { describe, expect, it } from "vitest";
import { renderStudioGeneration } from "../../../src/lib/generation/studio-generation";
import { ResumeRenderError } from "../../../src/lib/latex/render-resume";
import {
  studioApplyInput,
  studioLibrary,
  studioMeasurements,
} from "../../helpers/studio-fixtures";

function renderFailure(run: () => void) {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected renderStudioGeneration to throw.");
}
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
  it("renders a sourced draft without mutating the library", () => {
    const original = JSON.stringify(studioLibrary);
    const point = studioLibrary.jobs[0].points[0];
    const bullet = {
      id: point.id,
      groupId: studioLibrary.jobs[0].id,
      text: "User-authored verified contribution.",
      originalText: point.text,
      sourceAchievementIds: [point.id],
      skillIds: point.skillIds,
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
    expect(result.metadata.selectedAchievementIds).toContain(point.id);
    expect(JSON.stringify(studioLibrary)).toBe(original);
  });
  it("rejects a bullet with no library source", () => {
    const original = JSON.stringify(studioLibrary);
    const bullet = {
      id: "studio-user-point",
      groupId: studioLibrary.jobs[0].id,
      text: "User-authored verified contribution.",
      originalText: "User-authored verified contribution.",
      sourceAchievementIds: [],
      skillIds: [],
    };
    const error = renderFailure(() =>
      renderStudioGeneration(
        studioLibrary,
        {
          ...studioApplyInput,
          document: { ...studioApplyInput.document, bullets: [bullet] },
        },
        studioMeasurements,
      ),
    );
    expect(error).toBeInstanceOf(ResumeRenderError);
    expect((error as Error).message).toMatch(/no library source/);
    expect(JSON.stringify(studioLibrary)).toBe(original);
  });
  it("rejects a bullet that cites a disabled library point", () => {
    const library = structuredClone(studioLibrary);
    const point = library.jobs[0].points[0];
    point.enabled = false;
    const bullet = {
      id: point.id,
      groupId: library.jobs[0].id,
      text: point.text,
      originalText: point.text,
      sourceAchievementIds: [point.id],
      skillIds: point.skillIds,
    };
    const error = renderFailure(() =>
      renderStudioGeneration(
        library,
        {
          ...studioApplyInput,
          document: { ...studioApplyInput.document, bullets: [bullet] },
        },
        studioMeasurements,
      ),
    );
    expect(error).toBeInstanceOf(ResumeRenderError);
    expect((error as Error).message).toMatch(/disabled achievement/);
    expect(point.enabled).toBe(false);
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
