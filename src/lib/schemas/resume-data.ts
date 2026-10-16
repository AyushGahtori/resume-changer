import { z } from "zod";

const nonEmptyText = z.string().trim().min(1, "Must not be empty.");

export const StableIdSchema = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use a stable lowercase ID with hyphens.",
  );

export const YearMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM, for example 2026-09.");

const sourceTypeSchema = z.enum([
  "resume",
  "linkedin",
  "user-notes",
  "project-document",
  "direct-user",
]);

export const AchievementSourceSchema = z
  .object({
    type: sourceTypeSchema,
    label: nonEmptyText.optional(),
    reference: nonEmptyText.optional(),
  })
  .strict();

export const MetricSchema = z
  .object({
    id: StableIdSchema,
    label: nonEmptyText,
    value: nonEmptyText,
    unit: nonEmptyText.optional(),
    context: nonEmptyText.optional(),
    evidence: nonEmptyText,
  })
  .strict();

export const AchievementPointSchema = z
  .object({
    id: StableIdSchema,
    text: nonEmptyText,
    tags: z.array(nonEmptyText),
    skillIds: z.array(StableIdSchema),
    metrics: z.array(MetricSchema),
    source: AchievementSourceSchema,
    enabled: z.boolean(),
    initiativeId: StableIdSchema.optional(),
    context: nonEmptyText.optional(),
  })
  .strict()
  .superRefine((point, context) => {
    if (new Set(point.skillIds).size !== point.skillIds.length) {
      context.addIssue({
        code: "custom",
        path: ["skillIds"],
        message: "A skill can be linked only once per achievement point.",
      });
    }
  });

export const EducationSchema = z
  .object({
    id: StableIdSchema,
    institutions: z.array(nonEmptyText).min(1, "Add at least one institution."),
    degree: nonEmptyText,
    fieldOfStudy: nonEmptyText,
    programName: nonEmptyText.optional(),
    description: nonEmptyText.optional(),
    startDate: YearMonthSchema.optional(),
    endDate: YearMonthSchema.nullable().optional(),
  })
  .strict()
  .superRefine((education, context) => {
    if (
      education.startDate &&
      education.endDate &&
      education.endDate < education.startDate
    ) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "End date must be the same as or later than start date.",
      });
    }
    if (
      new Set(education.institutions).size !== education.institutions.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["institutions"],
        message: "Institutions must not be duplicated.",
      });
    }
  });

export const ProfileSchema = z
  .object({
    id: StableIdSchema,
    fullName: nonEmptyText,
    headline: nonEmptyText.optional(),
    email: z.email().optional(),
    phone: nonEmptyText.optional(),
    location: nonEmptyText.optional(),
    links: z.array(
      z
        .object({
          label: nonEmptyText,
          url: z.url(),
        })
        .strict(),
    ),
    summary: nonEmptyText.optional(),
    education: z.array(EducationSchema),
  })
  .strict();

export const JobSchema = z
  .object({
    id: StableIdSchema,
    company: nonEmptyText,
    title: nonEmptyText,
    employmentType: z.enum([
      "full-time",
      "part-time",
      "contract",
      "internship",
      "freelance",
      "other",
    ]),
    location: nonEmptyText.optional(),
    startDate: YearMonthSchema,
    endDate: YearMonthSchema.nullable(),
    description: nonEmptyText.optional(),
    points: z.array(AchievementPointSchema),
  })
  .strict()
  .superRefine((job, context) => {
    if (job.endDate !== null && job.endDate < job.startDate) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "End date must be the same as or later than start date.",
      });
    }
  });

export const ProjectSchema = z
  .object({
    id: StableIdSchema,
    name: nonEmptyText,
    role: nonEmptyText.optional(),
    url: z.url().optional(),
    description: nonEmptyText.optional(),
    startDate: YearMonthSchema.optional(),
    endDate: YearMonthSchema.nullable().optional(),
    points: z.array(AchievementPointSchema),
  })
  .strict()
  .superRefine((project, context) => {
    if (
      project.startDate &&
      project.endDate &&
      project.endDate < project.startDate
    ) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "End date must be the same as or later than start date.",
      });
    }
  });

export const SkillSchema = z
  .object({
    id: StableIdSchema,
    name: nonEmptyText,
    category: nonEmptyText.optional(),
    aliases: z.array(nonEmptyText),
    sources: z.array(sourceTypeSchema).min(1, "Add at least one skill source."),
    isListedOnCurrentResume: z.boolean(),
    evidenceAchievementIds: z.array(StableIdSchema),
  })
  .strict();

export const CredentialSchema = z
  .object({
    id: StableIdSchema,
    kind: z.enum(["license", "certificate"]),
    name: nonEmptyText,
    issuer: nonEmptyText,
    issuedDate: z.iso.date().optional(),
    expiresDate: z.iso.date().optional(),
    credentialId: nonEmptyText.optional(),
    url: z.url().optional(),
  })
  .strict()
  .superRefine((credential, context) => {
    if (
      credential.issuedDate &&
      credential.expiresDate &&
      credential.expiresDate < credential.issuedDate
    ) {
      context.addIssue({
        code: "custom",
        path: ["expiresDate"],
        message: "Expiration date must not be earlier than issue date.",
      });
    }
  });

export const ResumeSectionTypeSchema = z.enum([
  "experience",
  "projects",
  "education",
  "skills",
  "credentials",
]);

export const ResumePreferencesSchema = z
  .object({
    sectionOrder: z.array(ResumeSectionTypeSchema).min(1),
    maxPages: z.literal(1),
  })
  .strict()
  .superRefine((preferences, context) => {
    if (
      new Set(preferences.sectionOrder).size !== preferences.sectionOrder.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["sectionOrder"],
        message: "A resume section can appear only once in the section order.",
      });
    }
  });

export const ResumeLibrarySchema = z
  .object({
    schemaVersion: z.literal(1),
    profile: ProfileSchema,
    jobs: z.array(JobSchema),
    projects: z.array(ProjectSchema),
    skills: z.array(SkillSchema),
    credentials: z.array(CredentialSchema),
    preferences: ResumePreferencesSchema,
  })
  .strict()
  .superRefine((library, context) => {
    const metricIds = [
      ...library.jobs.flatMap((job) =>
        job.points.flatMap((point) => point.metrics.map((metric) => metric.id)),
      ),
      ...library.projects.flatMap((project) =>
        project.points.flatMap((point) =>
          point.metrics.map((metric) => metric.id),
        ),
      ),
    ];
    const entityIds = [
      library.profile.id,
      ...library.profile.education.map((item) => item.id),
      ...library.jobs.map((job) => job.id),
      ...library.jobs.flatMap((job) => job.points.map((point) => point.id)),
      ...library.projects.map((project) => project.id),
      ...library.projects.flatMap((project) =>
        project.points.map((point) => point.id),
      ),
      ...library.skills.map((skill) => skill.id),
      ...library.credentials.map((credential) => credential.id),
      ...metricIds,
    ];
    const skillIds = new Set(library.skills.map((skill) => skill.id));
    const achievementIds = new Set([
      ...library.jobs.flatMap((job) => job.points.map((point) => point.id)),
      ...library.projects.flatMap((project) =>
        project.points.map((point) => point.id),
      ),
    ]);

    if (new Set(entityIds).size !== entityIds.length) {
      context.addIssue({
        code: "custom",
        path: [],
        message:
          "Every profile, education, job, project, skill, credential, achievement, and metric ID must be unique.",
      });
    }

    library.jobs.forEach((job, jobIndex) => {
      job.points.forEach((point, pointIndex) => {
        point.skillIds.forEach((skillId, skillIndex) => {
          if (!skillIds.has(skillId)) {
            context.addIssue({
              code: "custom",
              path: [
                "jobs",
                jobIndex,
                "points",
                pointIndex,
                "skillIds",
                skillIndex,
              ],
              message: `Unknown skill ID: ${skillId}.`,
            });
          }
        });
      });
    });

    library.projects.forEach((project, projectIndex) => {
      project.points.forEach((point, pointIndex) => {
        point.skillIds.forEach((skillId, skillIndex) => {
          if (!skillIds.has(skillId)) {
            context.addIssue({
              code: "custom",
              path: [
                "projects",
                projectIndex,
                "points",
                pointIndex,
                "skillIds",
                skillIndex,
              ],
              message: `Unknown skill ID: ${skillId}.`,
            });
          }
        });
      });
    });

    library.skills.forEach((skill, skillIndex) => {
      skill.evidenceAchievementIds.forEach((achievementId, evidenceIndex) => {
        if (!achievementIds.has(achievementId)) {
          context.addIssue({
            code: "custom",
            path: [
              "skills",
              skillIndex,
              "evidenceAchievementIds",
              evidenceIndex,
            ],
            message: `Unknown achievement ID: ${achievementId}.`,
          });
        }
      });
    });
  });

export const GeneratedBulletSchema = z
  .object({
    id: StableIdSchema,
    text: nonEmptyText,
    section: z.enum(["experience", "projects"]),
    sourceAchievementIds: z.array(StableIdSchema).min(1),
  })
  .strict();

export const GenerationHistoryEntrySchema = z
  .object({
    id: StableIdSchema,
    createdAt: z.iso.datetime(),
    company: nonEmptyText.optional(),
    role: nonEmptyText,
    selectedAchievementIds: z.array(StableIdSchema),
    generatedBullets: z.array(GeneratedBulletSchema),
    provider: nonEmptyText,
    status: z.enum(["drafted", "compiled", "failed"]),
    texPath: nonEmptyText.optional(),
    pdfPath: nonEmptyText.optional(),
    repairAttemptCount: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((entry, context) => {
    if (
      new Set(entry.selectedAchievementIds).size !==
      entry.selectedAchievementIds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["selectedAchievementIds"],
        message: "An achievement can be selected only once per generation.",
      });
    }
    entry.generatedBullets.forEach((bullet, index) => {
      bullet.sourceAchievementIds.forEach((sourceId, sourceIndex) => {
        if (!entry.selectedAchievementIds.includes(sourceId)) {
          context.addIssue({
            code: "custom",
            path: [
              "generatedBullets",
              index,
              "sourceAchievementIds",
              sourceIndex,
            ],
            message:
              "Generated bullet sources must be included in selectedAchievementIds.",
          });
        }
      });
    });
  });

export const GenerationHistorySchema = z
  .object({
    schemaVersion: z.literal(1),
    entries: z.array(GenerationHistoryEntrySchema),
  })
  .strict()
  .superRefine((history, context) => {
    const ids = history.entries.map((entry) => entry.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["entries"],
        message: "Generation history entry IDs must be unique.",
      });
    }
  });

export type AchievementPoint = z.infer<typeof AchievementPointSchema>;
export type AchievementSource = z.infer<typeof AchievementSourceSchema>;
export type Credential = z.infer<typeof CredentialSchema>;
export type Education = z.infer<typeof EducationSchema>;
export type GeneratedBullet = z.infer<typeof GeneratedBulletSchema>;
export type GenerationHistory = z.infer<typeof GenerationHistorySchema>;
export type GenerationHistoryEntry = z.infer<
  typeof GenerationHistoryEntrySchema
>;
export type Job = z.infer<typeof JobSchema>;
export type Metric = z.infer<typeof MetricSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type ResumeLibrary = z.infer<typeof ResumeLibrarySchema>;
export type ResumePreferences = z.infer<typeof ResumePreferencesSchema>;
export type ResumeSectionType = z.infer<typeof ResumeSectionTypeSchema>;
export type Skill = z.infer<typeof SkillSchema>;
