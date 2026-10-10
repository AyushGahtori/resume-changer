import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  GenerationHistoryEntrySchema,
  ResumeLibrarySchema,
} from "../../../src/lib/schemas/resume-data";

function validLibrary(): z.input<typeof ResumeLibrarySchema> {
  return {
    schemaVersion: 1,
    profile: {
      id: "profile-ayush",
      fullName: "Demo Candidate",
      headline: "Software Engineer",
      email: "candidate@example.com",
      links: [{ label: "LinkedIn", url: "https://example.com/profile" }],
      education: [
        {
          id: "education-ai-bachelors",
          institutions: [
            "University of Milan",
            "University of Milano-Bicocca",
            "University of Pavia",
          ],
          degree: "Bachelor's degree",
          fieldOfStudy: "Artificial Intelligence",
          programName: "Joint research-based bachelor's program",
          description:
            "Research-based program jointly held by three universities in artificial intelligence.",
          startDate: "2026-09",
          endDate: null,
        },
      ],
    },
    jobs: [
      {
        id: "job-example-company",
        company: "Example Company",
        title: "Software Engineer",
        employmentType: "full-time",
        startDate: "2024-01",
        endDate: null,
        points: [
          {
            id: "achievement-api-reliability",
            text: "Built a resilient API for a demo service.",
            tags: ["backend", "reliability"],
            skillIds: ["skill-typescript"],
            metrics: [
              {
                id: "metric-demo-uptime",
                label: "Uptime",
                value: "99.9",
                unit: "%",
                evidence: "Example source record states 99.9% uptime.",
              },
            ],
            source: { type: "user-notes", label: "Synthetic test fixture" },
            enabled: true,
          },
        ],
      },
    ],
    projects: [
      {
        id: "project-resume-tool",
        name: "Resume Tool",
        role: "Developer",
        points: [
          {
            id: "achievement-rendering-pipeline",
            text: "Created a deterministic document rendering pipeline.",
            tags: ["automation"],
            skillIds: ["skill-typescript"],
            metrics: [],
            source: {
              type: "project-document",
              label: "Synthetic test fixture",
            },
            enabled: true,
          },
        ],
      },
    ],
    skills: [
      {
        id: "skill-typescript",
        name: "TypeScript",
        category: "Programming Languages",
        aliases: ["TS"],
        sources: ["resume", "user-notes"],
        isListedOnCurrentResume: false,
        evidenceAchievementIds: ["achievement-api-reliability"],
      },
    ],
    credentials: [
      {
        id: "certificate-example-cloud",
        kind: "certificate",
        name: "Example Cloud Certificate",
        issuer: "Example Institute",
        issuedDate: "2025-01-10",
      },
    ],
    preferences: {
      sectionOrder: [
        "experience",
        "projects",
        "skills",
        "education",
        "credentials",
      ],
      maxPages: 1,
    },
  };
}

describe("ResumeLibrarySchema", () => {
  it("accepts a complete library with a multi-university degree and source-backed skill", () => {
    expect(ResumeLibrarySchema.safeParse(validLibrary()).success).toBe(true);
  });

  it("rejects a missing required profile field", () => {
    const library = validLibrary();
    delete (library.profile as Partial<typeof library.profile>).fullName;

    expect(ResumeLibrarySchema.safeParse(library).success).toBe(false);
  });

  it("rejects invalid month values and reversed job dates", () => {
    const invalidMonth = validLibrary();
    invalidMonth.jobs[0].startDate = "2026-13";
    expect(ResumeLibrarySchema.safeParse(invalidMonth).success).toBe(false);

    const reversedRange = validLibrary();
    reversedRange.jobs[0].startDate = "2025-06";
    reversedRange.jobs[0].endDate = "2025-05";
    expect(ResumeLibrarySchema.safeParse(reversedRange).success).toBe(false);
  });

  it("rejects blank achievement text", () => {
    const library = validLibrary();
    library.jobs[0].points[0].text = "   ";

    expect(ResumeLibrarySchema.safeParse(library).success).toBe(false);
  });

  it("rejects duplicate IDs across entity types", () => {
    const library = validLibrary();
    library.projects[0].id = library.jobs[0].id;

    const result = ResumeLibrarySchema.safeParse(library);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("must be unique");
    }
  });

  it("rejects achievement references to unknown skills", () => {
    const library = validLibrary();
    library.jobs[0].points[0].skillIds = ["skill-missing"];

    expect(ResumeLibrarySchema.safeParse(library).success).toBe(false);
  });

  it("rejects skill evidence that does not point to a known achievement", () => {
    const library = validLibrary();
    library.skills[0].evidenceAchievementIds = ["achievement-missing"];

    expect(ResumeLibrarySchema.safeParse(library).success).toBe(false);
  });

  it("rejects unknown resume section types", () => {
    const library = validLibrary();
    library.preferences.sectionOrder = ["experience", "awards"] as never;

    expect(ResumeLibrarySchema.safeParse(library).success).toBe(false);
  });

  it("requires evidence for each stored metric", () => {
    const library = validLibrary();
    delete (library.jobs[0].points[0].metrics[0] as { evidence?: string })
      .evidence;

    expect(ResumeLibrarySchema.safeParse(library).success).toBe(false);
  });

  it("allows skills absent from the current resume when they have source evidence", () => {
    const library = validLibrary();
    library.skills[0].isListedOnCurrentResume = false;

    expect(ResumeLibrarySchema.safeParse(library).success).toBe(true);
  });
});

describe("GenerationHistoryEntrySchema", () => {
  const validEntry = {
    id: "generation-example-role",
    createdAt: "2026-10-10T10:00:00.000Z",
    role: "Backend Engineer",
    selectedAchievementIds: ["achievement-api-reliability"],
    generatedBullets: [
      {
        id: "generated-api-bullet",
        text: "Built a resilient API for a demo service.",
        section: "experience",
        sourceAchievementIds: ["achievement-api-reliability"],
      },
    ],
    provider: "mock",
    status: "drafted",
    repairAttemptCount: 0,
  };

  it("accepts generated bullets with selected source IDs", () => {
    expect(GenerationHistoryEntrySchema.safeParse(validEntry).success).toBe(
      true,
    );
  });

  it("rejects generated bullets that cite unselected source IDs", () => {
    const entry = structuredClone(validEntry);
    entry.generatedBullets[0].sourceAchievementIds = ["achievement-unselected"];

    expect(GenerationHistoryEntrySchema.safeParse(entry).success).toBe(false);
  });
});
