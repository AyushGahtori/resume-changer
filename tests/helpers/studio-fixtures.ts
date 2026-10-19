import sampleLibrary from "../../examples/sample-resume-library.json";
import { createManualGeneration } from "../../src/lib/generation/manual-generation";
import { documentFromGeneration } from "../../src/lib/generation/studio-document";
import type { ResumeLibrary } from "../../src/lib/schemas/resume-data";
import type { SkillMeasurements } from "../../src/lib/generation/skill-layout";

export const studioLibrary = sampleLibrary as ResumeLibrary;
export const studioGeneration = createManualGeneration(
  studioLibrary,
  {
    dataSource: "demo",
    company: "Example Systems",
    roleTitle: "Platform Engineer",
    jobUrl: "",
    jobDescription: "Build reliable platform services.",
    selectedAchievementIds: studioLibrary.jobs[0].points
      .slice(0, 2)
      .map((point) => point.id),
  },
  { id: "studio-fixture", now: new Date("2026-10-18T12:00:00Z") },
);
export const studioDocument = documentFromGeneration(
  studioGeneration,
  studioLibrary,
);
export const studioMeasurements: SkillMeasurements = {
  widths: Object.fromEntries(
    studioLibrary.skills.map((skill) => [skill.id, 20 + skill.name.length * 2]),
  ),
  labelWidths: [70, 80],
  separatorWidth: 4,
  lineWidth: 532.8,
  source: "latex",
  glyphWidths: { W: 9, i: 2, x: 4, " ": 3 },
};
export const studioApplyInput = {
  dataSource: "demo" as const,
  document: studioDocument,
  context: {
    company: "Example Systems",
    roleTitle: "Platform Engineer",
    jobUrl: "",
    tailoringMode: "manual" as const,
  },
};
