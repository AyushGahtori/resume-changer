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

const sourceTypeV1Schema = z.enum([
  "resume",
  "linkedin",
  "user-notes",
  "project-document",
  "direct-user",
]);

const sourceTypeSchema = z.enum([
  "resume",
  "linkedin",
  "user-notes",
  "project-document",
  "direct-user",
  "github-repository",
]);

export const AchievementSourceV1Schema = z
  .object({
    type: sourceTypeV1Schema,
    label: nonEmptyText.optional(),
    reference: nonEmptyText.optional(),
  })
  .strict();

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

const FullGitShaSchema = z
  .string()
  .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i, "Use a full Git object SHA.");

const GithubRepoPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\\") &&
      !/[\u0000-\u001f\u007f]/.test(path) &&
      path
        .split("/")
        .every((part) => part !== "" && part !== "." && part !== ".."),
    "Use a safe repository-relative path.",
  );

const GithubRefSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (ref) =>
      ref !== "@" &&
      !ref.startsWith("/") &&
      !ref.endsWith("/") &&
      !ref.endsWith(".") &&
      !ref.includes("//") &&
      !ref.includes("..") &&
      !ref.includes("@{") &&
      !/[\u0000-\u0020\u007f~^:?*\\[]/.test(ref) &&
      ref
        .split("/")
        .every((part) => !part.startsWith(".") && !part.endsWith(".lock")),
    "Use a valid Git reference.",
  );

const utcDateTimeSchema = z.iso
  .datetime()
  .refine((value) => value.endsWith("Z"), "Use a UTC timestamp ending in Z.");

const uniqueStrings = (values: string[]) =>
  new Set(values).size === values.length;

export const GithubSnapshotBudgetSchema = z
  .object({
    filesFetched: z.number().int().min(0).max(20),
    maxFetchedFileBytes: z.number().int().min(0).max(65_536),
    decodedBytes: z
      .number()
      .int()
      .min(0)
      .max(512 * 1024),
    upstreamBytes: z.number().int().min(0).max(12_582_912),
    httpAttempts: z.number().int().min(0).max(32),
    selectedFiles: z.number().int().min(0).max(16),
    selectedCharacters: z.number().int().min(0).max(80_000),
    maxSelectedFileCharacters: z.number().int().min(0).max(12_000),
    maxRequestLines: z.number().int().min(0).max(1_500),
    maxRequestFileLines: z.number().int().min(0).max(200),
    uniqueLines: z.number().int().min(0).max(2_000),
    transmittedLines: z.number().int().min(0).max(3_000),
    maxRequestInputTokens: z.number().int().min(0).max(24_000),
    reportedInputTokens: z.number().int().min(0).max(36_000).nullable(),
    estimatedInputTokens: z.number().int().min(0).max(36_000).nullable(),
  })
  .strict();

export const GithubRepositorySnapshotSchema = z
  .object({
    id: StableIdSchema,
    repositoryId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    commitSha: FullGitShaSchema,
    treeSha: FullGitShaSchema,
    inspectedAt: utcDateTimeSchema,
    scopePaths: z.array(GithubRepoPathSchema).max(16),
    pullRequestNumbers: z.array(z.number().int().positive()).max(100),
    selectorVersion: nonEmptyText.max(100),
    schemaVersion: z.number().int().positive(),
    budgetsUsed: GithubSnapshotBudgetSchema,
    complete: z.boolean(),
    limitations: z.array(nonEmptyText.max(500)).max(30),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (!uniqueStrings(snapshot.scopePaths)) {
      context.addIssue({
        code: "custom",
        path: ["scopePaths"],
        message: "Snapshot scope paths must be unique.",
      });
    }
    if (!uniqueStrings(snapshot.pullRequestNumbers.map(String))) {
      context.addIssue({
        code: "custom",
        path: ["pullRequestNumbers"],
        message: "Pull request numbers must be unique.",
      });
    }
  });

export const GithubRepositoryAttachmentSchema = z
  .object({
    id: StableIdSchema,
    projectId: StableIdSchema,
    repositoryId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    owner: z.string().regex(/^[A-Za-z0-9-]{1,39}$/),
    name: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
    url: z.url().max(500),
    visibility: z.enum(["public", "private"]),
    selectedRef: GithubRefSchema,
    latestSnapshotId: StableIdSchema.optional(),
    snapshots: z.array(GithubRepositorySnapshotSchema).max(100).default([]),
  })
  .strict()
  .superRefine((attachment, context) => {
    let parsedUrl: URL | undefined;
    try {
      parsedUrl = new URL(attachment.url);
    } catch {
      // `z.url()` reports malformed URL values before this refinement matters.
    }
    if (
      !parsedUrl ||
      parsedUrl.protocol !== "https:" ||
      parsedUrl.hostname !== "github.com" ||
      parsedUrl.username !== "" ||
      parsedUrl.password !== "" ||
      parsedUrl.port !== "" ||
      parsedUrl.search ||
      parsedUrl.hash ||
      parsedUrl.pathname.replace(/\/$/, "").toLowerCase() !==
        `/${attachment.owner}/${attachment.name}`.toLowerCase()
    ) {
      context.addIssue({
        code: "custom",
        path: ["url"],
        message:
          "Repository URL must be the canonical HTTPS GitHub repository URL.",
      });
    }
    if (
      attachment.latestSnapshotId &&
      !attachment.snapshots.some(
        (snapshot) => snapshot.id === attachment.latestSnapshotId,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["latestSnapshotId"],
        message:
          "Latest snapshot must reference a snapshot on this attachment.",
      });
    }
    attachment.snapshots.forEach((snapshot, index) => {
      if (snapshot.repositoryId !== attachment.repositoryId) {
        context.addIssue({
          code: "custom",
          path: ["snapshots", index, "repositoryId"],
          message: "Snapshot repository ID must match its attachment.",
        });
      }
    });
  });

export const GithubContributionAttestationSchema = z
  .object({
    id: StableIdSchema,
    role: nonEmptyText.max(200),
    statement: nonEmptyText.max(2_000),
    selectedPaths: z.array(GithubRepoPathSchema).max(16),
    selectedCommitShas: z.array(FullGitShaSchema).max(50),
    identitySource: z.enum(["self-declared", "github-authenticated"]),
    githubHandle: z
      .string()
      .regex(/^[A-Za-z0-9-]{1,39}$/)
      .optional(),
    confirmed: z.literal(true),
    confirmedAt: utcDateTimeSchema,
    version: z.number().int().positive(),
  })
  .strict()
  .superRefine((attestation, context) => {
    if (
      attestation.identitySource === "github-authenticated" &&
      !attestation.githubHandle
    ) {
      context.addIssue({
        code: "custom",
        path: ["githubHandle"],
        message:
          "An authenticated identity source must include its GitHub handle.",
      });
    }
    if (!uniqueStrings(attestation.selectedPaths)) {
      context.addIssue({
        code: "custom",
        path: ["selectedPaths"],
        message: "Selected contribution paths must be unique.",
      });
    }
    if (!uniqueStrings(attestation.selectedCommitShas)) {
      context.addIssue({
        code: "custom",
        path: ["selectedCommitShas"],
        message: "Selected contribution commits must be unique.",
      });
    }
  });

export const GithubEvidenceItemSchema = z
  .object({
    id: StableIdSchema,
    snapshotId: StableIdSchema,
    commitSha: FullGitShaSchema,
    path: GithubRepoPathSchema,
    blobSha: FullGitShaSchema,
    kind: z.enum(["file-excerpt", "report-field"]),
    lineStart: z.number().int().min(1).max(1_000_000).optional(),
    lineEnd: z.number().int().min(1).max(1_000_000).optional(),
    fieldPointer: nonEmptyText.max(300).optional(),
    excerpt: z
      .string()
      .min(1)
      .max(12_000)
      .refine(
        (value) => value.trim().length > 0,
        "Evidence excerpt cannot be blank.",
      )
      .optional(),
    excerptHash: z.string().regex(/^[a-f0-9]{64}$/i),
    category: z.enum([
      "implementation",
      "test",
      "configuration",
      "documentation",
      "report",
      "other",
    ]),
    classification: z.enum([
      "observed",
      "documented",
      "user-provided",
      "inferred",
    ]),
  })
  .strict()
  .superRefine((evidence, context) => {
    const hasStart = evidence.lineStart !== undefined;
    const hasEnd = evidence.lineEnd !== undefined;
    const hasPointer = evidence.fieldPointer !== undefined;
    if (
      evidence.kind === "file-excerpt" &&
      (!hasStart || !hasEnd || hasPointer)
    ) {
      context.addIssue({
        code: "custom",
        path: ["lineStart"],
        message:
          "File excerpts require a complete line range and no field pointer.",
      });
    }
    if (
      evidence.kind === "report-field" &&
      (!hasPointer || hasStart || hasEnd)
    ) {
      context.addIssue({
        code: "custom",
        path: ["fieldPointer"],
        message: "Report evidence requires a field pointer and no line range.",
      });
    }
    if (
      evidence.lineStart !== undefined &&
      evidence.lineEnd !== undefined &&
      evidence.lineEnd < evidence.lineStart
    ) {
      context.addIssue({
        code: "custom",
        path: ["lineEnd"],
        message:
          "Evidence line end must be the same as or later than line start.",
      });
    }
    if (
      evidence.lineStart !== undefined &&
      evidence.lineEnd !== undefined &&
      evidence.lineEnd - evidence.lineStart + 1 > 200
    ) {
      context.addIssue({
        code: "custom",
        path: ["lineEnd"],
        message: "A source excerpt cannot exceed 200 lines.",
      });
    }
  });

export const GithubContributionClaimSchema = z
  .object({
    id: StableIdSchema,
    text: nonEmptyText.max(4_000),
    evidenceIds: z.array(StableIdSchema).max(64),
    contributionId: StableIdSchema.optional(),
    classification: z.enum([
      "observed",
      "documented",
      "user-provided",
      "inferred",
    ]),
    scope: nonEmptyText.max(500).optional(),
    limitations: z.array(nonEmptyText.max(500)).max(20),
  })
  .strict()
  .superRefine((claim, context) => {
    if (claim.evidenceIds.length === 0 && !claim.contributionId) {
      context.addIssue({
        code: "custom",
        path: ["evidenceIds"],
        message:
          "A claim must reference evidence or the contribution statement.",
      });
    }
    if (!uniqueStrings(claim.evidenceIds)) {
      context.addIssue({
        code: "custom",
        path: ["evidenceIds"],
        message: "Claim evidence references must be unique.",
      });
    }
  });

export const GithubConfirmedMetricEvidenceSchema = z
  .object({
    metricId: StableIdSchema,
    evidenceIds: z.array(StableIdSchema).max(64),
    status: z.enum(["measured", "user-attested"]),
    context: nonEmptyText.max(1_000).optional(),
    confirmed: z.literal(true),
    confirmedAt: utcDateTimeSchema,
    confirmationVersion: z.number().int().positive(),
  })
  .strict()
  .superRefine((metricEvidence, context) => {
    if (
      metricEvidence.evidenceIds.length === 0 &&
      (metricEvidence.status === "measured" || !metricEvidence.context?.trim())
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidenceIds"],
        message:
          "Measured metrics require source evidence; user-attested metrics require a measurement description.",
      });
    }
    if (!uniqueStrings(metricEvidence.evidenceIds)) {
      context.addIssue({
        code: "custom",
        path: ["evidenceIds"],
        message: "Metric evidence references must be unique.",
      });
    }
  });

export const GithubAchievementEvidenceSchema = z
  .object({
    repositoryAttachmentId: StableIdSchema,
    snapshotId: StableIdSchema,
    contribution: GithubContributionAttestationSchema,
    claims: z.array(GithubContributionClaimSchema).min(1).max(40),
    evidence: z.array(GithubEvidenceItemSchema).min(1).max(100),
    confirmedMetrics: z.array(GithubConfirmedMetricEvidenceSchema).max(100),
  })
  .strict()
  .superRefine((githubEvidence, context) => {
    const ids = [
      ...githubEvidence.claims.map((claim) => claim.id),
      ...githubEvidence.evidence.map((item) => item.id),
    ];
    if (!uniqueStrings(ids)) {
      context.addIssue({
        code: "custom",
        path: ["claims"],
        message: "Claim and evidence IDs must be unique within an achievement.",
      });
    }
    const metricIds = githubEvidence.confirmedMetrics.map(
      (item) => item.metricId,
    );
    if (!uniqueStrings(metricIds)) {
      context.addIssue({
        code: "custom",
        path: ["confirmedMetrics"],
        message:
          "A metric can have only one confirmation record per achievement.",
      });
    }
  });

export const GithubImportApprovalSchema = z
  .object({
    id: StableIdSchema,
    importId: StableIdSchema,
    projectId: StableIdSchema,
    draftId: StableIdSchema,
    draftVersion: z.number().int().positive(),
    draftTextHash: z.string().regex(/^[a-f0-9]{64}$/i),
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/i),
    idempotencyKey: nonEmptyText.max(256),
    approvedAt: utcDateTimeSchema,
    approvedAchievements: z
      .array(
        z
          .object({
            achievementId: StableIdSchema,
            text: nonEmptyText.max(4_000),
            metricIds: z.array(StableIdSchema).max(100),
          })
          .strict()
          .superRefine((achievement, context) => {
            if (!uniqueStrings(achievement.metricIds)) {
              context.addIssue({
                code: "custom",
                path: ["metricIds"],
                message: "Approved metric IDs must be unique.",
              });
            }
          }),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((approval, context) => {
    if (
      !uniqueStrings(
        approval.approvedAchievements.map(
          (achievement) => achievement.achievementId,
        ),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["approvedAchievements"],
        message: "An approval cannot list an achievement more than once.",
      });
    }
  });

export const AchievementPointV1Schema = z
  .object({
    id: StableIdSchema,
    text: nonEmptyText,
    tags: z.array(nonEmptyText),
    skillIds: z.array(StableIdSchema),
    metrics: z.array(MetricSchema),
    source: AchievementSourceV1Schema,
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

export const AchievementPointV2Schema = z
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
    githubEvidence: GithubAchievementEvidenceSchema.nullable().default(null),
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
    if (point.source.type === "github-repository" && !point.githubEvidence) {
      context.addIssue({
        code: "custom",
        path: ["githubEvidence"],
        message: "GitHub achievements require source-backed provenance.",
      });
    }
    if (point.source.type !== "github-repository" && point.githubEvidence) {
      context.addIssue({
        code: "custom",
        path: ["githubEvidence"],
        message: "GitHub provenance requires a GitHub repository source.",
      });
    }
  });

/** Point shape used by writer inputs and uniform library consumers. */
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
    githubEvidence: GithubAchievementEvidenceSchema.nullable().optional(),
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
    if (point.source.type === "github-repository" && !point.githubEvidence) {
      context.addIssue({
        code: "custom",
        path: ["githubEvidence"],
        message: "GitHub achievements require source-backed provenance.",
      });
    }
    if (point.source.type !== "github-repository" && point.githubEvidence) {
      context.addIssue({
        code: "custom",
        path: ["githubEvidence"],
        message: "GitHub provenance requires a GitHub repository source.",
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
    points: z.array(AchievementPointV1Schema),
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

export const JobV2Schema = z
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
    points: z.array(AchievementPointV2Schema),
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
    job.points.forEach((point, pointIndex) => {
      if (point.source.type === "github-repository") {
        context.addIssue({
          code: "custom",
          path: ["points", pointIndex, "source", "type"],
          message:
            "GitHub achievements must belong to a project with a repository attachment.",
        });
      }
    });
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
    points: z.array(AchievementPointV1Schema),
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

export const ProjectV2Schema = z
  .object({
    id: StableIdSchema,
    name: nonEmptyText,
    role: nonEmptyText.optional(),
    url: z.url().optional(),
    description: nonEmptyText.optional(),
    startDate: YearMonthSchema.optional(),
    endDate: YearMonthSchema.nullable().optional(),
    repositoryAttachments: z
      .array(GithubRepositoryAttachmentSchema)
      .max(100)
      .default([]),
    points: z.array(AchievementPointV2Schema),
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
    const repositoryIds = project.repositoryAttachments.map(
      (attachment) => attachment.repositoryId,
    );
    if (new Set(repositoryIds).size !== repositoryIds.length) {
      context.addIssue({
        code: "custom",
        path: ["repositoryAttachments"],
        message: "A project can attach each GitHub repository only once.",
      });
    }
  });

export const SkillV1Schema = z
  .object({
    id: StableIdSchema,
    name: nonEmptyText,
    category: nonEmptyText.optional(),
    aliases: z.array(nonEmptyText),
    sources: z
      .array(sourceTypeV1Schema)
      .min(1, "Add at least one skill source."),
    isListedOnCurrentResume: z.boolean(),
    evidenceAchievementIds: z.array(StableIdSchema),
  })
  .strict();

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

export const ResumeLibraryV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    profile: ProfileSchema,
    jobs: z.array(JobSchema),
    projects: z.array(ProjectSchema),
    skills: z.array(SkillV1Schema),
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

export const ResumeLibraryV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    profile: ProfileSchema,
    jobs: z.array(JobV2Schema),
    projects: z.array(ProjectV2Schema),
    skills: z.array(SkillSchema),
    credentials: z.array(CredentialSchema),
    preferences: ResumePreferencesSchema,
    githubImportApprovals: z
      .array(GithubImportApprovalSchema)
      .max(5_000)
      .default([]),
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
    const attachmentIds = library.projects.flatMap((project) =>
      project.repositoryAttachments.flatMap((attachment) => [
        attachment.id,
        ...attachment.snapshots.map((snapshot) => snapshot.id),
      ]),
    );
    const provenanceIds = library.projects.flatMap((project) =>
      project.points.flatMap((point) => {
        if (!point.githubEvidence) return [];
        return [
          point.githubEvidence.contribution.id,
          ...point.githubEvidence.claims.map((claim) => claim.id),
          ...point.githubEvidence.evidence.map((evidence) => evidence.id),
        ];
      }),
    );
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
      ...attachmentIds,
      ...provenanceIds,
      ...library.githubImportApprovals.map((approval) => approval.id),
    ];
    if (new Set(entityIds).size !== entityIds.length) {
      context.addIssue({
        code: "custom",
        path: [],
        message:
          "Every profile, education, job, project, skill, credential, achievement, metric, repository, snapshot, provenance, and approval ID must be unique.",
      });
    }

    const skillIds = new Set(library.skills.map((skill) => skill.id));
    const achievementIds = new Set([
      ...library.jobs.flatMap((job) => job.points.map((point) => point.id)),
      ...library.projects.flatMap((project) =>
        project.points.map((point) => point.id),
      ),
    ]);
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

    library.projects.forEach((project, projectIndex) => {
      project.repositoryAttachments.forEach((attachment, attachmentIndex) => {
        if (attachment.projectId !== project.id) {
          context.addIssue({
            code: "custom",
            path: [
              "projects",
              projectIndex,
              "repositoryAttachments",
              attachmentIndex,
              "projectId",
            ],
            message:
              "Repository attachment must belong to its containing project.",
          });
        }
      });

      project.points.forEach((point, pointIndex) => {
        const provenance = point.githubEvidence;
        if (!provenance) return;
        const provenancePath = [
          "projects",
          projectIndex,
          "points",
          pointIndex,
          "githubEvidence",
        ];
        const attachment = project.repositoryAttachments.find(
          (item) => item.id === provenance.repositoryAttachmentId,
        );
        if (!attachment) {
          context.addIssue({
            code: "custom",
            path: [...provenancePath, "repositoryAttachmentId"],
            message:
              "GitHub provenance must reference an attachment on this project.",
          });
        }
        const snapshot = attachment?.snapshots.find(
          (item) => item.id === provenance.snapshotId,
        );
        if (!snapshot) {
          context.addIssue({
            code: "custom",
            path: [...provenancePath, "snapshotId"],
            message:
              "GitHub provenance must reference a snapshot on its attachment.",
          });
        }

        const evidenceIds = new Set(provenance.evidence.map((item) => item.id));
        provenance.evidence.forEach((item, evidenceIndex) => {
          if (item.snapshotId !== provenance.snapshotId) {
            context.addIssue({
              code: "custom",
              path: [
                ...provenancePath,
                "evidence",
                evidenceIndex,
                "snapshotId",
              ],
              message: "Evidence must belong to the achievement's snapshot.",
            });
          }
          if (snapshot && item.commitSha !== snapshot.commitSha) {
            context.addIssue({
              code: "custom",
              path: [...provenancePath, "evidence", evidenceIndex, "commitSha"],
              message: "Evidence commit SHA must match its immutable snapshot.",
            });
          }
          if (snapshot && !snapshot.scopePaths.includes(item.path)) {
            context.addIssue({
              code: "custom",
              path: [...provenancePath, "evidence", evidenceIndex, "path"],
              message: "Evidence path must be included in its snapshot scope.",
            });
          }
        });

        provenance.claims.forEach((claim, claimIndex) => {
          claim.evidenceIds.forEach((evidenceId, evidenceIndex) => {
            if (!evidenceIds.has(evidenceId)) {
              context.addIssue({
                code: "custom",
                path: [
                  ...provenancePath,
                  "claims",
                  claimIndex,
                  "evidenceIds",
                  evidenceIndex,
                ],
                message: `Unknown evidence ID: ${evidenceId}.`,
              });
            }
          });
          if (
            claim.contributionId &&
            claim.contributionId !== provenance.contribution.id
          ) {
            context.addIssue({
              code: "custom",
              path: [...provenancePath, "claims", claimIndex, "contributionId"],
              message:
                "Claim contribution reference must match its attestation.",
            });
          }
        });

        const pointMetricIds = new Set(
          point.metrics.map((metric) => metric.id),
        );
        const confirmedMetricIds = new Set(
          provenance.confirmedMetrics.map((item) => item.metricId),
        );
        provenance.confirmedMetrics.forEach((metricEvidence, metricIndex) => {
          if (!pointMetricIds.has(metricEvidence.metricId)) {
            context.addIssue({
              code: "custom",
              path: [
                ...provenancePath,
                "confirmedMetrics",
                metricIndex,
                "metricId",
              ],
              message: `Unknown metric ID: ${metricEvidence.metricId}.`,
            });
          }
          metricEvidence.evidenceIds.forEach((evidenceId, evidenceIndex) => {
            if (!evidenceIds.has(evidenceId)) {
              context.addIssue({
                code: "custom",
                path: [
                  ...provenancePath,
                  "confirmedMetrics",
                  metricIndex,
                  "evidenceIds",
                  evidenceIndex,
                ],
                message: `Unknown metric evidence ID: ${evidenceId}.`,
              });
            }
          });
          if (
            metricEvidence.status === "measured" &&
            !metricEvidence.evidenceIds.some((evidenceId) =>
              provenance.evidence.some(
                (item) =>
                  item.id === evidenceId && item.classification === "observed",
              ),
            )
          ) {
            context.addIssue({
              code: "custom",
              path: [
                ...provenancePath,
                "confirmedMetrics",
                metricIndex,
                "evidenceIds",
              ],
              message: "Measured metrics require observed evidence.",
            });
          }
        });
        point.metrics.forEach((metric, metricIndex) => {
          if (!confirmedMetricIds.has(metric.id)) {
            context.addIssue({
              code: "custom",
              path: [...provenancePath, "confirmedMetrics"],
              message: `Metric ${metric.id} requires confirmed GitHub evidence.`,
            });
          }
          if (metricIndex >= 100) {
            context.addIssue({
              code: "custom",
              path: ["projects", projectIndex, "points", pointIndex, "metrics"],
              message:
                "GitHub achievements cannot contain more than 100 metrics.",
            });
          }
        });
      });
    });

    const projectById = new Map(
      library.projects.map((project) => [project.id, project]),
    );
    const approvalKeys = library.githubImportApprovals.map(
      (approval) => approval.idempotencyKey,
    );
    if (!uniqueStrings(approvalKeys)) {
      context.addIssue({
        code: "custom",
        path: ["githubImportApprovals"],
        message: "GitHub import approval idempotency keys must be unique.",
      });
    }
    library.githubImportApprovals.forEach((approval, approvalIndex) => {
      const project = projectById.get(approval.projectId);
      if (!project) {
        context.addIssue({
          code: "custom",
          path: ["githubImportApprovals", approvalIndex, "projectId"],
          message: `Unknown approval project ID: ${approval.projectId}.`,
        });
        return;
      }
      const approvedPoints = new Map(
        project.points
          .filter((point) => point.source.type === "github-repository")
          .map((point) => [point.id, point]),
      );
      approval.approvedAchievements.forEach((approved, index) => {
        const point = approvedPoints.get(approved.achievementId);
        if (!point) {
          context.addIssue({
            code: "custom",
            path: [
              "githubImportApprovals",
              approvalIndex,
              "approvedAchievements",
              index,
              "achievementId",
            ],
            message: `Unknown approved GitHub achievement ID: ${approved.achievementId}.`,
          });
          return;
        }
        if (approved.text !== point.text) {
          context.addIssue({
            code: "custom",
            path: [
              "githubImportApprovals",
              approvalIndex,
              "approvedAchievements",
              index,
              "text",
            ],
            message: "Approved text must match the saved achievement exactly.",
          });
        }
        const pointMetricIds = point.metrics.map((metric) => metric.id);
        if (
          approved.metricIds.length !== pointMetricIds.length ||
          pointMetricIds.some(
            (metricId) => !approved.metricIds.includes(metricId),
          )
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "githubImportApprovals",
              approvalIndex,
              "approvedAchievements",
              index,
              "metricIds",
            ],
            message:
              "Approved metric IDs must match the saved achievement exactly.",
          });
        }
      });
    });
    const approvedAchievementIds = new Set(
      library.githubImportApprovals.flatMap((approval) =>
        approval.approvedAchievements.map(
          (achievement) => achievement.achievementId,
        ),
      ),
    );
    library.projects.forEach((project, projectIndex) => {
      project.points.forEach((point, pointIndex) => {
        if (
          point.source.type === "github-repository" &&
          !approvedAchievementIds.has(point.id)
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "projects",
              projectIndex,
              "points",
              pointIndex,
              "source",
              "type",
            ],
            message: "GitHub achievements require a durable approval record.",
          });
        }
      });
    });
  });

/**
 * Source boundary for strict v1 and v2 files. Loaders normalize either input
 * to NormalizedResumeLibrary without persisting the migration.
 */
export const ResumeLibraryInputSchema = z.discriminatedUnion("schemaVersion", [
  ResumeLibraryV1Schema,
  ResumeLibraryV2Schema,
]);

/** Strict runtime validator with a uniform application-facing output type. */
export const ResumeLibrarySchema: z.ZodType<ResumeLibrary, ResumeLibrary> =
  ResumeLibraryInputSchema as unknown as z.ZodType<
    ResumeLibrary,
    ResumeLibrary
  >;

/**
 * Canonical schema version 2 output. Loaders normalize supported source files
 * to this shape; new writer transactions and worker consumers should use it.
 */
export type NormalizedResumeLibrary = z.infer<typeof ResumeLibraryV2Schema>;
export type ResumeLibraryInput = z.infer<typeof ResumeLibraryInputSchema>;

export const GeneratedBulletSchema = z
  .object({
    id: StableIdSchema,
    text: nonEmptyText,
    section: z.enum(["experience", "projects"]),
    sourceAchievementIds: z.array(StableIdSchema).min(1),
  })
  .strict();

export const GenerationHistoryEntryFieldsSchema = z
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
  .strict();

export const GenerationHistoryEntrySchema =
  GenerationHistoryEntryFieldsSchema.superRefine((entry, context) => {
    if (
      entry.texPath &&
      !new RegExp(`^data/generations/${entry.id}-[a-f0-9]{12}\\.tex$`).test(
        entry.texPath,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["texPath"],
        message: "LaTeX references must point to a generation artifact.",
      });
    }
    if (
      entry.pdfPath &&
      !new RegExp(`^data/generations/${entry.id}-[a-f0-9]{12}\\.pdf$`).test(
        entry.pdfPath,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["pdfPath"],
        message: "PDF references must point to a generation artifact.",
      });
    }
    if (entry.status === "compiled" && !entry.pdfPath) {
      context.addIssue({
        code: "custom",
        path: ["pdfPath"],
        message: "Compiled generations must reference their PDF artifact.",
      });
    }
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

type JobV1Output = z.infer<typeof JobSchema>;
type ProjectV1Output = z.infer<typeof ProjectSchema>;

/** Uniform application shape for writer inputs and points from either version. */
export type AchievementPoint = z.infer<typeof AchievementPointSchema>;
export type AchievementPointV1 = z.infer<typeof AchievementPointV1Schema>;
export type AchievementPointV2 = z.infer<typeof AchievementPointV2Schema>;
export type AchievementSource = z.infer<typeof AchievementSourceSchema>;
export type GithubAchievementEvidence = z.infer<
  typeof GithubAchievementEvidenceSchema
>;
export type GithubImportApproval = z.infer<typeof GithubImportApprovalSchema>;
export type GithubRepositoryAttachment = z.infer<
  typeof GithubRepositoryAttachmentSchema
>;
export type GithubRepositorySnapshot = z.infer<
  typeof GithubRepositorySnapshotSchema
>;
export type Credential = z.infer<typeof CredentialSchema>;
export type Education = z.infer<typeof EducationSchema>;
export type GeneratedBullet = z.infer<typeof GeneratedBulletSchema>;
export type GenerationHistory = z.infer<typeof GenerationHistorySchema>;
export type GenerationHistoryEntry = z.infer<
  typeof GenerationHistoryEntrySchema
>;
export type Job = Omit<JobV1Output, "points"> & { points: AchievementPoint[] };
export type JobV2 = z.infer<typeof JobV2Schema>;
export type Metric = z.infer<typeof MetricSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type Project = Omit<ProjectV1Output, "points"> & {
  points: AchievementPoint[];
  repositoryAttachments?: GithubRepositoryAttachment[];
};
export type ProjectV2 = z.infer<typeof ProjectV2Schema>;
/** Uniform application shape; new readers should prefer NormalizedResumeLibrary. */
export type ResumeLibrary = {
  schemaVersion: 1 | 2;
  profile: Profile;
  jobs: Job[];
  projects: Project[];
  skills: Skill[];
  credentials: Credential[];
  preferences: ResumePreferences;
  githubImportApprovals?: GithubImportApproval[];
};
export type ResumeLibraryV1 = z.infer<typeof ResumeLibraryV1Schema>;
export type ResumeLibraryV2 = NormalizedResumeLibrary;
export type ResumePreferences = z.infer<typeof ResumePreferencesSchema>;
export type ResumeSectionType = z.infer<typeof ResumeSectionTypeSchema>;
export type Skill = z.infer<typeof SkillSchema>;
