import { describe, expect, it } from "vitest";
import sampleJson from "../../../examples/sample-resume-library.json";
import type { ResumeLibrary } from "../../../src/lib/schemas/resume-data";
import { createManualGeneration } from "../../../src/lib/generation/manual-generation";
const sample = sampleJson as ResumeLibrary;
const first = sample.jobs[0].points[0],
  second = sample.jobs[0].points[1];
const request = {
  dataSource: "demo" as const,
  company: "Example",
  roleTitle: "Engineer",
  jobUrl: "",
  jobDescription: "Python AWS Docker REST APIs",
  selectedAchievementIds: [first.id, second.id],
};

describe("rendered resume quality", () => {
  it("uses canonical SQL evidence and required qualifications when ranking skills", () => {
    const library = structuredClone(sample);
    for (const group of [...library.jobs, ...library.projects])
      for (const point of group.points) point.skillIds = [];
    library.skills = ["Ruby", "PostgreSQL", "Python"].map((name, index) => ({
      id: `skill-ranked-${index}`,
      name,
      aliases: [],
      sources: ["direct-user"],
      isListedOnCurrentResume: true,
      evidenceAchievementIds: [],
    }));
    const analysis = {
      targetTitle: "Engineer",
      seniority: "Early",
      requiredQualifications: ["SQL"],
      preferredQualifications: ["Python"],
      responsibilities: [],
      toolsAndPlatforms: ["SQL", "Python"],
      domainConcepts: [],
      atsTerms: [],
      inferredContext: [],
      terminology: [],
    };
    const result = createManualGeneration(
      library,
      { ...request, jobDescription: "SQL required. Python preferred." },
      { analysis },
    );
    expect(result.metadata.renderedSkillIds[0]).toBe("skill-ranked-1");
  });
  it("renders generated summary and a synthesized bullet once while preserving all sources", () => {
    const text =
      "Built the example service and automated its AWS deployment with reusable checks.";
    const result = createManualGeneration(sample, {
      ...request,
      summaryOverride:
        "Delivered reliable cloud services with measurable improvements.",
      achievementTextOverrides: [
        {
          achievementId: first.id,
          sourceAchievementIds: [first.id, second.id],
          text,
        },
      ],
    });
    expect(result.latex).toContain(
      "Delivered reliable cloud services with measurable improvements.",
    );
    expect(result.latex.split(text)).toHaveLength(2);
    expect(result.latex).not.toContain(second.text);
    expect(result.metadata.generatedBullets).toHaveLength(1);
    expect(result.metadata.generatedBullets[0].sourceAchievementIds).toEqual([
      first.id,
      second.id,
    ]);
    expect(result.metadata.sourceProvenance).toHaveLength(2);
    expect(result.metadata.visibleWordCount).toBeGreaterThan(
      text.split(" ").length,
    );
  });
  it("rejects cross-employer synthesis and renders current experience first", () => {
    const other = sample.jobs[1].points[0];
    expect(() =>
      createManualGeneration(sample, {
        ...request,
        selectedAchievementIds: [first.id, other.id],
        achievementTextOverrides: [
          {
            achievementId: first.id,
            sourceAchievementIds: [first.id, other.id],
            text: "Combined.",
          },
        ],
      }),
    ).toThrow(/same group/);
    const reversed = { ...sample, jobs: [...sample.jobs].reverse() };
    const output = createManualGeneration(reversed, {
      ...request,
      selectedAchievementIds: [first.id, other.id],
    });
    expect(
      output.latex.indexOf(`\\ResumeEntry{${sample.jobs[0].title}}`),
    ).toBeLessThan(
      output.latex.indexOf(`\\ResumeEntry{${sample.jobs[1].title}}`),
    );
  });
  it("packs relevant skills across categories into two rows before unrelated languages", () => {
    const library = structuredClone(sample);
    for (const group of [...library.jobs, ...library.projects])
      for (const point of group.points) point.skillIds = [];
    library.skills = [
      "Ruby",
      "PHP",
      "Python",
      "Docker",
      "TensorFlow",
      "REST APIs",
      "NumPy",
      "pandas",
      "scikit-learn",
      "AWS",
      "Git",
    ].map((name, index) => ({
      id: `skill-extra-${index}`,
      name,
      aliases: [],
      category: `Category ${index}`,
      sources: ["direct-user"],
      isListedOnCurrentResume: true,
      evidenceAchievementIds: [],
    }));
    const result = createManualGeneration(library, {
      ...request,
      jobDescription:
        "Python Docker TensorFlow REST APIs NumPy pandas scikit-learn AWS Git",
    });
    const rows = result.latex.match(/\\ResumeSkillGroup\{[^\n]+/g) ?? [];
    expect(rows.length).toBeLessThanOrEqual(2);
    for (const skill of library.skills.slice(2))
      expect(result.metadata.renderedSkillIds).toContain(skill.id);
    expect(rows[0]).toContain("Python");
  });
});
