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
      tailoringMode: "manual",
      sourceProvenance: [
        {
          achievementId: firstPoint.id,
          section: "experience",
          groupId: library.jobs[0].id,
          groupTitle: library.jobs[0].title,
          originalText: firstPoint.text,
          renderedText: firstPoint.text,
        },
      ],
      renderedSkillIds: expect.any(Array),
    });
    expect(JSON.stringify(result)).not.toContain(validRequest.jobDescription);
  });

  it("uses approved tailored wording in the deterministic LaTeX output", () => {
    const tailoredText = "Provisioned AWS services using Terraform modules.";
    const result = createManualGeneration(library, {
      ...validRequest,
      achievementTextOverrides: [
        { achievementId: firstPoint.id, text: tailoredText },
      ],
    });

    expect(result.latex).toContain(tailoredText);
    expect(result.latex).not.toContain(firstPoint.text);
  });

  it("records Auto Tailor mode and original-to-rendered source provenance", () => {
    const tailoredText = "Built an API using supported platform evidence.";
    const result = createManualGeneration(library, {
      ...validRequest,
      tailoringMode: "auto",
      achievementTextOverrides: [
        { achievementId: firstPoint.id, text: tailoredText },
      ],
    });

    expect(result.metadata).toMatchObject({
      tailoringMode: "auto",
      sourceProvenance: [
        {
          achievementId: firstPoint.id,
          originalText: firstPoint.text,
          renderedText: tailoredText,
        },
      ],
    });
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

  it("allows a supported library skill to be added with its evidence point", () => {
    const supportingPoint = "achievement-cloud-deployment-platform";
    const result = createManualGeneration(library, {
      ...validRequest,
      selectedAchievementIds: [supportingPoint],
      selectedSkillIds: ["skill-infrastructure-as-code"],
    });

    expect(result.latex).toContain("Infrastructure as Code");
    expect(result.metadata.selectedSkillIds).toEqual([
      "skill-infrastructure-as-code",
    ]);
  });

  it("sends the active JD into two-row skill selection", () => {
    const result = createManualGeneration(library, {
      ...validRequest,
      jobDescription: "Build reliable AWS services using Python.",
      selectedAchievementIds: [
        firstPoint.id,
        "achievement-fieldnotes-geospatial-search",
      ],
      selectedSkillIds: [
        ...library.skills
          .filter((skill) => skill.isListedOnCurrentResume)
          .map((skill) => skill.id),
        "skill-python",
      ],
    });
    const rows = result.latex.match(/\\ResumeSkillGroup\{[^\n]+/g) ?? [];
    expect(rows).toHaveLength(2);
    expect(result.latex).toContain("Amazon Web Services");
    expect(result.latex).toContain("Python");
    expect(result.metadata.renderedSkillIds).toEqual(
      expect.arrayContaining(["skill-aws", "skill-python"]),
    );
  });

  it("rejects an unlisted skill without selected evidence and unknown skills", () => {
    expect(() =>
      createManualGeneration(library, {
        ...validRequest,
        selectedSkillIds: ["skill-infrastructure-as-code"],
      }),
    ).toThrow(/needs a selected supporting achievement/);
    expect(() =>
      createManualGeneration(library, {
        ...validRequest,
        selectedSkillIds: ["skill-not-in-library"],
      }),
    ).toThrow(/Unknown skill ID/);
  });
});
