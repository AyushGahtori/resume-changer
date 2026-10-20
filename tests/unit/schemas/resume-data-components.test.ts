import { describe, expect, it } from "vitest";
import {
  AchievementPointSchema,
  AchievementSourceSchema,
  CredentialSchema,
  EducationSchema,
  GeneratedBulletSchema,
  GenerationHistoryEntryFieldsSchema,
  GenerationHistoryEntrySchema,
  GenerationHistorySchema,
  JobSchema,
  MetricSchema,
  ProfileSchema,
  ProjectSchema,
  ResumePreferencesSchema,
  ResumeSectionTypeSchema,
  SkillSchema,
  StableIdSchema,
  YearMonthSchema,
} from "../../../src/lib/schemas/resume-data";

describe("StableIdSchema", () => {
  it("accepts a lowercase hyphenated identifier", () => {
    expect(
      StableIdSchema.safeParse("achievement-api-reliability").success,
    ).toBe(true);
    expect(StableIdSchema.safeParse("skill-python3").success).toBe(true);
  });

  it("rejects identifiers that are not lowercase and hyphenated", () => {
    for (const value of [
      "Achievement-Api",
      "achievement_api",
      "-achievement",
      "achievement-",
      "achievement--api",
      "achievement api",
      "",
    ]) {
      expect(StableIdSchema.safeParse(value).success).toBe(false);
    }
  });

  it("explains the expected identifier format", () => {
    const result = StableIdSchema.safeParse("Bad_ID");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(
        "stable lowercase ID with hyphens",
      );
    }
  });
});

describe("YearMonthSchema", () => {
  it("accepts a year and two-digit month", () => {
    expect(YearMonthSchema.safeParse("2026-09").success).toBe(true);
    expect(YearMonthSchema.safeParse("2026-01").success).toBe(true);
    expect(YearMonthSchema.safeParse("2026-12").success).toBe(true);
  });

  it("rejects an invalid or out-of-range month", () => {
    for (const value of [
      "2026-00",
      "2026-13",
      "2026-9",
      "26-09",
      "2026/09",
      "2026-09-01",
    ]) {
      expect(YearMonthSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("AchievementSourceSchema", () => {
  it("accepts a known provenance type with optional references", () => {
    expect(
      AchievementSourceSchema.safeParse({
        type: "user-notes",
        label: "Work notes",
        reference: "notes/2026.md",
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown provenance type", () => {
    expect(AchievementSourceSchema.safeParse({ type: "guess" }).success).toBe(
      false,
    );
  });

  it("rejects an unknown field", () => {
    expect(
      AchievementSourceSchema.safeParse({ type: "resume", extra: true })
        .success,
    ).toBe(false);
  });
});

describe("MetricSchema", () => {
  const metric = {
    id: "metric-uptime",
    label: "Uptime",
    value: "99.9",
    unit: "%",
    evidence: "Source record states 99.9% uptime.",
  };

  it("accepts a metric with its supporting evidence", () => {
    expect(MetricSchema.safeParse(metric).success).toBe(true);
  });

  it("requires evidence for the stored value", () => {
    const { evidence: _evidence, ...withoutEvidence } = metric;
    const result = MetricSchema.safeParse(withoutEvidence);

    expect(result.success).toBe(false);
  });

  it("rejects blank evidence for the stored value", () => {
    const result = MetricSchema.safeParse({ ...metric, evidence: "   " });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Must not be empty.");
    }
  });

  it("accepts a metric with no unit or context", () => {
    const { unit: _unit, ...withoutUnit } = metric;
    expect(MetricSchema.safeParse(withoutUnit).success).toBe(true);
  });
});

describe("AchievementPointSchema", () => {
  const point = {
    id: "achievement-api",
    text: "Built a resilient API.",
    tags: ["backend"],
    skillIds: ["skill-typescript"],
    metrics: [],
    source: { type: "resume" as const },
    enabled: true,
  };

  it("accepts a complete point", () => {
    expect(AchievementPointSchema.safeParse(point).success).toBe(true);
  });

  it("rejects blank achievement text", () => {
    const result = AchievementPointSchema.safeParse({ ...point, text: "   " });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Must not be empty.");
    }
  });

  it("rejects a skill that is linked more than once", () => {
    const result = AchievementPointSchema.safeParse({
      ...point,
      skillIds: ["skill-typescript", "skill-typescript"],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("linked only once");
    }
  });

  it("accepts an optional initiative and context", () => {
    expect(
      AchievementPointSchema.safeParse({
        ...point,
        initiativeId: "initiative-billing",
        context: "Billing platform work.",
      }).success,
    ).toBe(true);
  });
});

describe("EducationSchema", () => {
  const education = {
    id: "education-ai-bachelors",
    institutions: ["University of Milan", "University of Pavia"],
    degree: "Bachelor's degree",
    fieldOfStudy: "Artificial Intelligence",
  };

  it("accepts a joint program with several institutions", () => {
    expect(EducationSchema.safeParse(education).success).toBe(true);
  });

  it("requires at least one institution", () => {
    const result = EducationSchema.safeParse({
      ...education,
      institutions: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "Add at least one institution.",
      );
    }
  });

  it("rejects duplicated institutions", () => {
    const result = EducationSchema.safeParse({
      ...education,
      institutions: ["University of Milan", "University of Milan"],
    });

    expect(result.success).toBe(false);
  });

  it("rejects an end date before the start date", () => {
    const result = EducationSchema.safeParse({
      ...education,
      startDate: "2026-09",
      endDate: "2025-01",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(
        "same as or later than start date",
      );
    }
  });

  it("accepts an education entry still in progress", () => {
    expect(
      EducationSchema.safeParse({
        ...education,
        startDate: "2026-09",
        endDate: null,
      }).success,
    ).toBe(true);
  });
});

describe("ProfileSchema", () => {
  it("accepts a profile with contact details and education", () => {
    expect(
      ProfileSchema.safeParse({
        id: "profile-example",
        fullName: "Demo Candidate",
        email: "candidate@example.com",
        links: [{ label: "Portfolio", url: "https://example.com" }],
        education: [],
      }).success,
    ).toBe(true);
  });

  it("rejects a malformed email address", () => {
    const result = ProfileSchema.safeParse({
      id: "profile-example",
      fullName: "Demo Candidate",
      email: "not-an-email",
      education: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects a link that is not a URL", () => {
    const result = ProfileSchema.safeParse({
      id: "profile-example",
      fullName: "Demo Candidate",
      links: [{ label: "Portfolio", url: "example.com" }],
      education: [],
    });

    expect(result.success).toBe(false);
  });
});

describe("JobSchema", () => {
  const job = {
    id: "job-example-company",
    company: "Example Company",
    title: "Software Engineer",
    employmentType: "full-time" as const,
    startDate: "2024-01",
    endDate: null,
    points: [],
  };

  it("accepts a current role with no end date", () => {
    expect(JobSchema.safeParse(job).success).toBe(true);
  });

  it("rejects an end date before the start date", () => {
    const result = JobSchema.safeParse({
      ...job,
      startDate: "2024-01",
      endDate: "2023-01",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(
        "same as or later than start date",
      );
    }
  });

  it("rejects an unsupported employment type", () => {
    expect(
      JobSchema.safeParse({ ...job, employmentType: "apprentice" }).success,
    ).toBe(false);
  });
});

describe("ProjectSchema", () => {
  const project = {
    id: "project-resume-tool",
    name: "Resume Tool",
    points: [],
  };

  it("accepts a project with no dates or role", () => {
    expect(ProjectSchema.safeParse(project).success).toBe(true);
  });

  it("rejects an end date before the start date", () => {
    const result = ProjectSchema.safeParse({
      ...project,
      startDate: "2024-01",
      endDate: "2023-01",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a URL that is not a valid link", () => {
    expect(
      ProjectSchema.safeParse({ ...project, url: "not-a-url" }).success,
    ).toBe(false);
  });
});

describe("SkillSchema", () => {
  it("accepts a skill with at least one source", () => {
    expect(
      SkillSchema.safeParse({
        id: "skill-typescript",
        name: "TypeScript",
        aliases: ["TS"],
        sources: ["resume", "user-notes"],
        isListedOnCurrentResume: false,
        evidenceAchievementIds: ["achievement-api"],
      }).success,
    ).toBe(true);
  });

  it("requires at least one source for the skill", () => {
    const result = SkillSchema.safeParse({
      id: "skill-typescript",
      name: "TypeScript",
      aliases: [],
      sources: [],
      isListedOnCurrentResume: false,
      evidenceAchievementIds: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "Add at least one skill source.",
      );
    }
  });
});

describe("CredentialSchema", () => {
  const credential = {
    id: "certificate-example-cloud",
    kind: "certificate" as const,
    name: "Example Cloud Certificate",
    issuer: "Example Institute",
  };

  it("accepts a credential with an issue date", () => {
    expect(
      CredentialSchema.safeParse({ ...credential, issuedDate: "2025-01-10" })
        .success,
    ).toBe(true);
  });

  it("rejects an expiry date before the issue date", () => {
    const result = CredentialSchema.safeParse({
      ...credential,
      issuedDate: "2025-01-10",
      expiresDate: "2024-01-10",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(
        "earlier than issue date",
      );
    }
  });

  it("rejects an unsupported credential kind", () => {
    expect(
      CredentialSchema.safeParse({ ...credential, kind: "award" }).success,
    ).toBe(false);
  });
});

describe("ResumeSectionTypeSchema", () => {
  it("accepts the closed set of resume sections", () => {
    for (const section of [
      "experience",
      "projects",
      "education",
      "skills",
      "credentials",
    ]) {
      expect(ResumeSectionTypeSchema.safeParse(section).success).toBe(true);
    }
  });

  it("rejects an unsupported section", () => {
    expect(ResumeSectionTypeSchema.safeParse("summary").success).toBe(false);
  });
});

describe("ResumePreferencesSchema", () => {
  it("accepts a single-page preference", () => {
    expect(
      ResumePreferencesSchema.safeParse({
        sectionOrder: ["experience", "skills"],
        maxPages: 1,
      }).success,
    ).toBe(true);
  });

  it("rejects a preference for more than one page", () => {
    expect(
      ResumePreferencesSchema.safeParse({
        sectionOrder: ["experience"],
        maxPages: 2,
      }).success,
    ).toBe(false);
  });

  it("rejects a section that appears twice in the order", () => {
    const result = ResumePreferencesSchema.safeParse({
      sectionOrder: ["experience", "skills", "experience"],
      maxPages: 1,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("can appear only once");
    }
  });
});

describe("GeneratedBulletSchema", () => {
  it("requires at least one source achievement", () => {
    const result = GeneratedBulletSchema.safeParse({
      id: "generated-bullet-1",
      text: "Improved reliability.",
      section: "experience",
      sourceAchievementIds: [],
    });

    expect(result.success).toBe(false);
  });

  it("accepts a bullet that cites its source", () => {
    expect(
      GeneratedBulletSchema.safeParse({
        id: "generated-bullet-1",
        text: "Improved reliability.",
        section: "experience",
        sourceAchievementIds: ["achievement-api"],
      }).success,
    ).toBe(true);
  });
});

describe("GenerationHistoryEntryFieldsSchema", () => {
  const entry = {
    id: "generation-example-role",
    createdAt: "2026-10-19T12:00:00.000Z",
    role: "Platform Engineer",
    selectedAchievementIds: ["achievement-api"],
    generatedBullets: [
      {
        id: "generated-bullet-1",
        text: "Improved reliability.",
        section: "experience",
        sourceAchievementIds: ["achievement-api"],
      },
    ],
    provider: "gemini",
    status: "drafted" as const,
    repairAttemptCount: 0,
  };

  it("accepts a drafted entry without artifact references", () => {
    expect(GenerationHistoryEntryFieldsSchema.safeParse(entry).success).toBe(
      true,
    );
  });

  it("rejects an unknown field", () => {
    expect(
      GenerationHistoryEntryFieldsSchema.safeParse({
        ...entry,
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  it("rejects an unsupported status", () => {
    expect(
      GenerationHistoryEntryFieldsSchema.safeParse({
        ...entry,
        status: "published",
      }).success,
    ).toBe(false);
  });

  it("rejects a negative repair attempt count", () => {
    expect(
      GenerationHistoryEntryFieldsSchema.safeParse({
        ...entry,
        repairAttemptCount: -1,
      }).success,
    ).toBe(false);
  });

  it("rejects a timestamp that is not ISO 8601", () => {
    expect(
      GenerationHistoryEntryFieldsSchema.safeParse({
        ...entry,
        createdAt: "19 October 2026",
      }).success,
    ).toBe(false);
  });
});

describe("GenerationHistoryEntrySchema", () => {
  const entry = {
    id: "generation-example-role",
    createdAt: "2026-10-19T12:00:00.000Z",
    role: "Platform Engineer",
    selectedAchievementIds: ["achievement-api"],
    generatedBullets: [
      {
        id: "generated-bullet-1",
        text: "Improved reliability.",
        section: "experience",
        sourceAchievementIds: ["achievement-api"],
      },
    ],
    provider: "gemini",
    status: "drafted" as const,
    repairAttemptCount: 0,
  };

  it("accepts a drafted entry without artifact references", () => {
    expect(GenerationHistoryEntrySchema.safeParse(entry).success).toBe(true);
  });

  it("rejects a compiled entry with no PDF reference", () => {
    const result = GenerationHistoryEntrySchema.safeParse({
      ...entry,
      status: "compiled",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(
        "must reference their PDF artifact",
      );
    }
  });

  it("rejects a LaTeX reference outside the generation directory", () => {
    const result = GenerationHistoryEntrySchema.safeParse({
      ...entry,
      texPath: "data/secrets.tex",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(
        "must point to a generation artifact",
      );
    }
  });

  it("accepts artifact references that match the entry", () => {
    const result = GenerationHistoryEntrySchema.safeParse({
      ...entry,
      status: "compiled",
      texPath: "data/generations/generation-example-role-0123456789ab.tex",
      pdfPath: "data/generations/generation-example-role-0123456789ab.pdf",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an achievement that is selected more than once", () => {
    const result = GenerationHistoryEntrySchema.safeParse({
      ...entry,
      selectedAchievementIds: ["achievement-api", "achievement-api"],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("selected only once");
    }
  });

  it("rejects a bullet that cites an achievement that was not selected", () => {
    const result = GenerationHistoryEntrySchema.safeParse({
      ...entry,
      generatedBullets: [
        {
          id: "generated-bullet-1",
          text: "Improved reliability.",
          section: "experience",
          sourceAchievementIds: ["achievement-other"],
        },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(
        "must be included in selectedAchievementIds",
      );
    }
  });
});

describe("GenerationHistorySchema", () => {
  const entry = {
    id: "generation-example-role",
    createdAt: "2026-10-19T12:00:00.000Z",
    role: "Platform Engineer",
    selectedAchievementIds: [],
    generatedBullets: [],
    provider: "gemini",
    status: "drafted" as const,
    repairAttemptCount: 0,
  };

  it("accepts a history with no entries", () => {
    expect(
      GenerationHistorySchema.safeParse({ schemaVersion: 1, entries: [] })
        .success,
    ).toBe(true);
  });

  it("rejects duplicate entry identifiers", () => {
    const result = GenerationHistorySchema.safeParse({
      schemaVersion: 1,
      entries: [entry, entry],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("must be unique");
    }
  });
});
