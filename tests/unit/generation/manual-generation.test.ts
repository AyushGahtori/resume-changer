import { describe, expect, it } from "vitest";
import sampleLibrary from "../../../examples/sample-resume-library.json";
import {
  createManualGeneration,
  ManualGenerationRequestSchema,
} from "../../../src/lib/generation/manual-generation";
import { ResumeRenderError } from "../../../src/lib/latex/render-resume";
import type { ResumeLibrary } from "../../../src/lib/schemas/resume-data";

const library = sampleLibrary as ResumeLibrary;
const firstPoint = library.jobs[0].points[0];
const validRequest = {
  dataSource: "demo" as const,
  company: "Example Systems",
  roleTitle: "Platform Engineer",
  jobUrl: "https://jobs.example/platform",
  jobDescription: "Build reliable platform services.",
  selectedAchievementIds: [firstPoint.id],
};

describe("manual resume generation", () => {
  it("validates a request and defaults to personal data source", () => {
    const parsed = ManualGenerationRequestSchema.parse({
      ...validRequest,
      dataSource: undefined,
    });

    expect(parsed.dataSource).toBe("personal");
  });

  it("rejects blank or oversized job descriptions and empty selections", () => {
    expect(
      ManualGenerationRequestSchema.safeParse({
        ...validRequest,
        jobDescription: "  ",
      }).success,
    ).toBe(false);
    expect(
      ManualGenerationRequestSchema.safeParse({
        ...validRequest,
        jobDescription: "x".repeat(30_001),
      }).success,
    ).toBe(false);
    expect(
      ManualGenerationRequestSchema.safeParse({
        ...validRequest,
        selectedAchievementIds: [],
      }).success,
    ).toBe(false);
  });

  it("rejects unsafe job links and unexpected request fields", () => {
    expect(
      ManualGenerationRequestSchema.safeParse({
        ...validRequest,
        jobUrl: "javascript:alert(1)",
      }).success,
    ).toBe(false);
    expect(
      ManualGenerationRequestSchema.safeParse({
        ...validRequest,
        debug: true,
      }).success,
    ).toBe(false);
  });

  it("renders selected points and stable metadata without storing the JD", () => {
    const result = createManualGeneration(library, validRequest, {
      id: "manual-test-1",
      now: new Date("2026-10-12T10:30:00.000Z"),
    });

    expect(result.latex).toContain(firstPoint.text);
    expect(result.metadata).toEqual({
      id: "manual-test-1",
      generatedAt: "2026-10-12T10:30:00.000Z",
      dataSource: "demo",
      company: "Example Systems",
      roleTitle: "Platform Engineer",
      jobUrl: "https://jobs.example/platform",
      selectedAchievementIds: [firstPoint.id],
    });
    expect(JSON.stringify(result)).not.toContain(validRequest.jobDescription);
  });

  it("rejects unknown and disabled point IDs through the renderer", () => {
    expect(() =>
      createManualGeneration(library, {
        ...validRequest,
        selectedAchievementIds: ["achievement-not-in-library"],
      }),
    ).toThrow(ResumeRenderError);

    const disabledLibrary = structuredClone(library);
    disabledLibrary.jobs[0].points[0].enabled = false;
    expect(() => createManualGeneration(disabledLibrary, validRequest)).toThrow(
      ResumeRenderError,
    );
  });
});
