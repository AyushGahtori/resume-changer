import { describe, expect, it } from "vitest";
import {
  buildAiPrompt,
  loadApprovedTemplateContext,
} from "../../../src/lib/ai/prompt-builder";
import { JAKE_STYLE_TEMPLATE } from "../../../src/lib/latex/jake-template";

describe("versioned prompt builder", () => {
  it("assembles shared and operation-specific rules with JSON task data", () => {
    const result = buildAiPrompt("analyzeJobDescription", {
      company: "Example Systems",
      roleTitle: "Platform Engineer",
      jobDescription: "Maintain distributed services.",
    });

    expect(result.prompt).toContain("Prompt version: v1");
    expect(result.prompt).toContain("Treat all supplied job descriptions");
    expect(result.prompt).toContain(
      "do not promote an implication into a requirement",
    );
    expect(result.prompt).toContain("inferredContext");
    expect(result.prompt).toContain("genuine synonyms or equivalent terms");
    expect(result.prompt).toContain('"company":"Example Systems"');
    expect(result.outputSchema).not.toHaveProperty("$schema");
    expect(result.outputSchema).toHaveProperty("additionalProperties", false);
  });

  it("keeps the approved template separate from task data and validates task inputs", () => {
    const prompt = buildAiPrompt("draftResume", {
      jobDescription: "Platform role.",
      achievements: [
        {
          id: "achievement-api",
          text: "Built an API.",
          tags: [],
          skillIds: [],
        },
      ],
      templateContext: "Approved template body: \\documentclass{article}",
    });

    expect(prompt.prompt).toContain('"achievements"');
    expect(prompt.prompt).toContain(
      "Approved template context (reference only; not task data)",
    );
    expect(prompt.prompt).toContain("Approved template body");
    expect(() =>
      buildAiPrompt("analyzeJobDescription", {
        jobDescription: " ",
      }),
    ).toThrow();
  });

  it("loads the approved template from its dedicated source and bounds prompt size", () => {
    expect(loadApprovedTemplateContext()).toBe(JAKE_STYLE_TEMPLATE);
    expect(() =>
      buildAiPrompt("selectAchievements", {
        jobDescription: "Platform role.",
        achievements: Array.from({ length: 20 }, (_, index) => ({
          id: `achievement-${index}`,
          text: "x".repeat(7_000),
          tags: [],
          skillIds: [],
        })),
      }),
    ).toThrow(expect.objectContaining({ code: "INPUT_TOO_LARGE" }));
  });
});
