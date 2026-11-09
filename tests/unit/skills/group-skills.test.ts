import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Skill } from "../../../src/lib/schemas/resume-data";
import {
  duplicateLexiconNames,
  groupSkills,
  skillNameSimilarity,
} from "../../../src/lib/skills/group-skills";

function skill(name: string, extras: Partial<Skill> = {}): Skill {
  return {
    id: `skill-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    aliases: [],
    sources: ["direct-user"],
    isListedOnCurrentResume: false,
    evidenceAchievementIds: [],
    ...extras,
  };
}

function labels(names: string[], extras: Partial<Skill> = {}) {
  return groupSkills(names.map((name) => skill(name, extras))).map((group) => ({
    label: group.label,
    skills: group.skills.map((item) => item.name),
  }));
}

describe("skill grouping", () => {
  it("keeps the shipped lexicon free of duplicate names", () => {
    expect(duplicateLexiconNames()).toEqual([]);
  });

  it("puts related machine-learning tools on one row and data tools on another", () => {
    expect(
      labels([
        "TensorFlow",
        "NumPy",
        "pandas",
        "scikit-learn",
        "LightGBM",
        "XGBoost",
        "OpenCV",
      ]),
    ).toEqual([
      {
        label: "Machine learning",
        skills: ["TensorFlow", "scikit-learn", "LightGBM", "XGBoost", "OpenCV"],
      },
      { label: "Data science", skills: ["NumPy", "pandas"] },
    ]);
  });

  it("keeps Java and JavaScript as separate chips in the language group", () => {
    expect(skillNameSimilarity("Java", "JavaScript")).toBe(0);
    expect(labels(["Java", "JavaScript", "TypeScript"])).toEqual([
      {
        label: "Programming languages",
        skills: ["Java", "JavaScript", "TypeScript"],
      },
    ]);
  });

  it("sends a known name to its family even when the saved category disagrees", () => {
    const groups = groupSkills([
      skill("Python", { category: "Data science" }),
      skill("pandas"),
    ]);
    expect(groups).toEqual([
      expect.objectContaining({
        label: "Data science",
        skills: [expect.objectContaining({ name: "pandas" })],
      }),
      expect.objectContaining({
        label: "Programming languages",
        skills: [expect.objectContaining({ name: "Python" })],
      }),
    ]);
  });

  it("groups an unfamiliar pair by shared words and leaves a loner in Other", () => {
    expect(skillNameSimilarity("SAP FI", "SAP MM")).toBeGreaterThanOrEqual(
      0.62,
    );
    expect(skillNameSimilarity("SAP FI", "TensorFlow")).toBeLessThan(0.62);
    const groups = groupSkills([
      skill("SAP FI"),
      skill("Underwater basket weaving"),
      skill("SAP MM"),
    ]);
    expect(groups).toEqual([
      expect.objectContaining({
        label: "SAP",
        skills: [
          expect.objectContaining({ name: "SAP FI" }),
          expect.objectContaining({ name: "SAP MM" }),
        ],
      }),
      expect.objectContaining({
        label: "Other skills",
        skills: [
          expect.objectContaining({ name: "Underwater basket weaving" }),
        ],
      }),
    ]);
  });

  it("uses a saved category when the name is not already known", () => {
    const groups = groupSkills([
      skill("On-call rotation", { category: "Reliability" }),
      skill("Incident review", { category: "Reliability" }),
    ]);
    expect(groups).toEqual([
      expect.objectContaining({
        label: "Reliability",
        skills: [
          expect.objectContaining({ name: "On-call rotation" }),
          expect.objectContaining({ name: "Incident review" }),
        ],
      }),
    ]);
  });

  it("places unlisted professional names in the family they belong to", () => {
    expect(
      labels([
        "SvelteKit",
        "Redux Toolkit",
        "AWS CDK",
        "PyTorch Lightning",
        "PostgreSQL administration",
        "Postgress",
        "Wireframing",
        "Web design",
        "Guitar",
        "Chess",
        "Cooking",
      ]),
    ).toEqual([
      {
        label: "Machine learning",
        skills: ["PyTorch Lightning"],
      },
      {
        label: "Frontend",
        skills: ["SvelteKit", "Redux Toolkit"],
      },
      {
        label: "Databases",
        skills: ["PostgreSQL administration", "Postgress"],
      },
      {
        label: "Cloud",
        skills: ["AWS CDK"],
      },
      {
        label: "Design",
        skills: ["Wireframing", "Web design"],
      },
      {
        label: "Other skills",
        skills: ["Guitar", "Chess", "Cooking"],
      },
    ]);
  });

  it("joins a new spelling of a known skill to that family", () => {
    expect(labels(["PyTorch Lightning", "Keras"])).toEqual([
      {
        label: "Machine learning",
        skills: ["PyTorch Lightning", "Keras"],
      },
    ]);
  });

  it("returns no groups for an empty library", () => {
    expect(groupSkills([])).toEqual([]);
  });

  it("groups the demo library by family and keeps authored categories", async () => {
    const library = JSON.parse(
      await readFile(
        join(process.cwd(), "examples", "sample-resume-library.json"),
        "utf8",
      ),
    ) as { skills: Skill[] };
    const groups = groupSkills(library.skills);
    expect(groups.map((group) => group.label)).toEqual([
      "Programming languages",
      "Frontend",
      "APIs and integrations",
      "Cloud",
      "DevOps",
      "Developer tools",
      "Architecture",
      "Collaboration",
      "Engineering Practices",
      "Reliability",
    ]);
    expect(
      groups.reduce((count, group) => count + group.skills.length, 0),
    ).toBe(library.skills.length);
  });
});
