import { z } from "zod";

export const PROJECT_CONTEXT_VERSION = "project-context-v1" as const;
export const MAX_INTERVIEW_QUESTIONS = 10;
export const MAX_CUSTOM_ANSWER_CODE_POINTS = 500;
export const MAX_EXTRA_NOTES_CODE_POINTS = 500;
export const MAX_CATALOG_NODES = 100;

export const StableInterviewIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, "Use a stable lowercase ID.");

const codePointString = (maximum: number, allowBlank = false) =>
  z
    .string()
    .refine(
      (value) =>
        Array.from(value).length <= maximum &&
        (allowBlank || value.trim().length > 0),
      "Use " +
        (allowBlank ? "at most " : "1–") +
        maximum +
        " Unicode code points.",
    );

const boundedLabelSchema = codePointString(160);
const boundedValueSchema = codePointString(MAX_CUSTOM_ANSWER_CODE_POINTS);
const shaSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i);

export const OwnershipSchema = z.enum([
  "whole-project",
  "selected-areas",
  "shared",
  "unsure",
]);
export type Ownership = z.infer<typeof OwnershipSchema>;

export const CollaborationSchema = z.enum([
  "solo",
  "team",
  "mixed",
  "prefer-not-to-say",
]);
export type Collaboration = z.infer<typeof CollaborationSchema>;

export const ProjectKindSchema = z.enum([
  "product",
  "developer-tool",
  "backend-service",
  "data-ai-system",
  "other",
]);
export type ProjectKind = z.infer<typeof ProjectKindSchema>;

export const FactFieldSchema = z.enum([
  "primaryKind",
  "projectPurpose",
  "secondaryTags",
  "ownership",
  "collaboration",
  "intendedUsers",
  "confirmedCapabilities",
  "contributedAreas",
  "contributionDetails",
  "outcomeEvidence",
  "limitations",
]);
export type FactField = z.infer<typeof FactFieldSchema>;

export const InformationTargetSchema = z.enum([
  "primary-kind",
  "project-purpose",
  "secondary-tags",
  "ownership",
  "collaboration",
  "intended-users",
  "confirmed-capabilities",
  "contributed-areas",
  "contribution-details",
  "outcome-evidence",
  "limitations",
]);
export type InformationTarget = z.infer<typeof InformationTargetSchema>;

export const FactProvenanceSchema = z.enum([
  "user-reported",
  "repository-inferred",
  "user-confirmed",
]);
export type FactProvenance = z.infer<typeof FactProvenanceSchema>;

export const ContextFactSchema = z
  .object({
    value: boundedValueSchema,
    provenance: FactProvenanceSchema,
    questionId: StableInterviewIdSchema.optional(),
    optionId: StableInterviewIdSchema.optional(),
    repositoryHintId: StableInterviewIdSchema.optional(),
  })
  .strict()
  .superRefine((factValue, ctx) => {
    if (
      factValue.provenance === "user-confirmed" &&
      !factValue.repositoryHintId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["repositoryHintId"],
        message:
          "A user-confirmed repository fact must retain its suggestion ID.",
      });
    }
    if (
      factValue.provenance === "user-reported" &&
      factValue.repositoryHintId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["repositoryHintId"],
        message:
          "A user-reported fact cannot point to a repository suggestion.",
      });
    }
    if (
      factValue.provenance === "repository-inferred" &&
      !factValue.repositoryHintId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["repositoryHintId"],
        message: "An inferred repository fact must retain its suggestion ID.",
      });
    }
  });
export type ContextFact = z.infer<typeof ContextFactSchema>;

export const FactContributionSchema = z
  .object({
    field: FactFieldSchema,
    value: boundedValueSchema,
  })
  .strict();
export type FactContribution = z.infer<typeof FactContributionSchema>;

export const QuestionOptionSchema = z
  .object({
    id: StableInterviewIdSchema,
    label: boundedLabelSchema,
    kind: z.enum(["choice", "custom"]),
    facts: z.array(FactContributionSchema).max(4),
  })
  .strict();
export type QuestionOption = z.infer<typeof QuestionOptionSchema>;

export const ConditionSchema = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("selected-any"),
      nodeId: StableInterviewIdSchema,
      optionIds: z.array(StableInterviewIdSchema).min(1).max(4),
    })
    .strict(),
  z
    .object({
      op: z.literal("skipped"),
      nodeId: StableInterviewIdSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("hint-status"),
      hintId: StableInterviewIdSchema,
      status: z.enum(["accepted", "dismissed"]),
    })
    .strict(),
]);
export type Condition = z.infer<typeof ConditionSchema>;

export const CandidateNextSchema = z
  .object({
    to: StableInterviewIdSchema,
    when: z.array(ConditionSchema).max(8).default([]),
  })
  .strict();
export type CandidateNext = z.infer<typeof CandidateNextSchema>;

export const QuestionNodeSchema = z
  .object({
    id: StableInterviewIdSchema,
    prompt: codePointString(320),
    reason: codePointString(240),
    informationTargets: z.array(InformationTargetSchema).min(1).max(6),
    selectionMode: z.enum(["single", "multiple"]),
    options: z.array(QuestionOptionSchema).length(5),
    customTarget: FactFieldSchema.optional(),
    phase: z.enum(["setup", "branch", "wrap-up", "follow-up"]),
    branchGroup: StableInterviewIdSchema.optional(),
    branchAreaOptionId: StableInterviewIdSchema.optional(),
    priority: z.number().int().min(0).max(100),
    terminal: z.boolean(),
    edges: z.array(CandidateNextSchema).max(20),
  })
  .strict()
  .superRefine((node, ctx) => {
    const ids = new Set<string>();
    node.options.forEach((option, index) => {
      if (ids.has(option.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["options", index, "id"],
          message: "Option IDs must be unique within a question.",
        });
      }
      ids.add(option.id);
      if (index < 4 && option.kind !== "choice") {
        ctx.addIssue({
          code: "custom",
          path: ["options", index, "kind"],
          message: "The first four options must be ordinary choices.",
        });
      }
      if (index === 4 && (option.kind !== "custom" || option.id !== "custom")) {
        ctx.addIssue({
          code: "custom",
          path: ["options", index],
          message: "The final option must be the custom answer option.",
        });
      }
      for (let factIndex = 0; factIndex < option.facts.length; factIndex += 1) {
        const contribution = option.facts[factIndex];
        const supported =
          (contribution.field === "primaryKind" &&
            ProjectKindSchema.safeParse(contribution.value).success) ||
          (contribution.field === "ownership" &&
            OwnershipSchema.safeParse(contribution.value).success) ||
          (contribution.field === "collaboration" &&
            CollaborationSchema.safeParse(contribution.value).success) ||
          !["primaryKind", "ownership", "collaboration"].includes(
            contribution.field,
          );
        if (!supported) {
          ctx.addIssue({
            code: "custom",
            path: ["options", index, "facts", factIndex, "value"],
            message: "This fact field requires a supported stable value.",
          });
        }
      }
    });

    if (!node.customTarget) {
      ctx.addIssue({
        code: "custom",
        path: ["customTarget"],
        message: "Each question must define where its custom answer belongs.",
      });
    }

    if (
      node.phase === "branch" &&
      (!node.branchGroup || !node.branchAreaOptionId)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["branchGroup"],
        message:
          "Branch questions need a group and a controlling project-area option.",
      });
    }
    if (
      node.phase !== "branch" &&
      (node.branchGroup || node.branchAreaOptionId)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["branchGroup"],
        message: "Only branch questions may declare branch metadata.",
      });
    }
    if (node.terminal && node.edges.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["terminal"],
        message: "Terminal questions cannot have outgoing edges.",
      });
    }
    if (!node.terminal && node.edges.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["edges"],
        message: "A non-terminal question must have a next edge.",
      });
    }
  });
export type QuestionNode = z.infer<typeof QuestionNodeSchema>;

export const QuestionCatalogSchema = z
  .object({
    version: z.literal(PROJECT_CONTEXT_VERSION),
    rootId: StableInterviewIdSchema,
    maxQuestions: z.number().int().min(5).max(MAX_INTERVIEW_QUESTIONS),
    maxBranchQuestions: z.number().int().min(0).max(5),
    wrapUpNodeIds: z.array(StableInterviewIdSchema).length(2),
    nodes: z.array(QuestionNodeSchema).min(1).max(MAX_CATALOG_NODES),
  })
  .strict()
  .superRefine((catalog, ctx) => {
    if (catalog.maxBranchQuestions > catalog.maxQuestions) {
      ctx.addIssue({
        code: "custom",
        path: ["maxBranchQuestions"],
        message: "The branch question budget cannot exceed the interview cap.",
      });
    }
  });
export type QuestionCatalog = z.infer<typeof QuestionCatalogSchema>;

export const InterviewAnswerSchema = z
  .object({
    nodeId: StableInterviewIdSchema,
    optionIds: z.array(StableInterviewIdSchema).max(5),
    customAnswer: codePointString(MAX_CUSTOM_ANSWER_CODE_POINTS).optional(),
    skipped: z.boolean().default(false),
    catalogVersion: z.string().min(1).max(64),
  })
  .strict()
  .superRefine((answer, ctx) => {
    if (new Set(answer.optionIds).size !== answer.optionIds.length) {
      ctx.addIssue({
        code: "custom",
        path: ["optionIds"],
        message: "An option can only be selected once.",
      });
    }
    const hasCustom = answer.optionIds.includes("custom");
    if (
      answer.skipped &&
      (answer.optionIds.length > 0 || answer.customAnswer)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["skipped"],
        message: "A skipped answer cannot include a selection or custom text.",
      });
    }
    if (!answer.skipped && answer.optionIds.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["optionIds"],
        message: "Choose an option or explicitly skip the question.",
      });
    }
    const purposeDetail = answer.nodeId === "project.purpose" && !hasCustom;
    if (
      (hasCustom && answer.customAnswer === undefined) ||
      (!hasCustom && answer.customAnswer !== undefined && !purposeDetail)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["customAnswer"],
        message:
          "Custom text is required exactly when the custom option is selected.",
      });
    }
  });
export type InterviewAnswer = z.infer<typeof InterviewAnswerSchema>;

export const RepositorySuggestionSchema = z
  .object({
    id: StableInterviewIdSchema,
    target: z.enum(["project-kind", "capability", "area"]),
    value: boundedValueSchema,
    label: boundedLabelSchema,
    disposition: z.enum(["suggested", "accepted", "dismissed"]),
    provenance: z.literal("repository-inferred"),
    source: z
      .object({
        repositoryId: z.string().trim().min(1).max(64),
        commitSha: shaSchema,
        path: z
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
          )
          .optional(),
      })
      .strict(),
  })
  .strict();
export type RepositorySuggestion = z.infer<typeof RepositorySuggestionSchema>;

export const InterviewStateSchema = z
  .object({
    catalogVersion: z.literal(PROJECT_CONTEXT_VERSION),
    answers: z.array(InterviewAnswerSchema).max(MAX_INTERVIEW_QUESTIONS),
    presentedNodeIds: z
      .array(StableInterviewIdSchema)
      .max(MAX_INTERVIEW_QUESTIONS),
    currentNodeId: StableInterviewIdSchema.nullable(),
    repositorySuggestions: z.array(RepositorySuggestionSchema).max(50),
    notes: codePointString(MAX_EXTRA_NOTES_CODE_POINTS, true),
  })
  .strict()
  .superRefine((state, ctx) => {
    if (
      new Set(state.presentedNodeIds).size !== state.presentedNodeIds.length
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["presentedNodeIds"],
        message: "A question can only be presented once in an interview.",
      });
    }
    const answerIds = state.answers.map((answer) => answer.nodeId);
    if (new Set(answerIds).size !== answerIds.length) {
      ctx.addIssue({
        code: "custom",
        path: ["answers"],
        message: "Only the latest answer for each question may be kept.",
      });
    }
    if (
      new Set(state.repositorySuggestions.map((hint) => hint.id)).size !==
      state.repositorySuggestions.length
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["repositorySuggestions"],
        message: "Repository suggestion IDs must be unique.",
      });
    }
  });
export type InterviewState = z.infer<typeof InterviewStateSchema>;

export const ProjectContextSchema = z
  .object({
    version: z.literal(PROJECT_CONTEXT_VERSION),
    primaryKind: ContextFactSchema.nullable(),
    projectPurpose: ContextFactSchema.nullable(),
    ownership: ContextFactSchema.nullable(),
    collaboration: ContextFactSchema.nullable(),
    secondaryTags: z.array(ContextFactSchema).max(100),
    intendedUsers: z.array(ContextFactSchema).max(100),
    confirmedCapabilities: z.array(ContextFactSchema).max(100),
    contributedAreas: z.array(ContextFactSchema).max(100),
    contributionDetails: z.array(ContextFactSchema).max(100),
    outcomeEvidence: z.array(ContextFactSchema).max(100),
    limitations: z.array(ContextFactSchema).max(100),
    notes: ContextFactSchema.nullable(),
    answers: z.array(InterviewAnswerSchema).max(MAX_INTERVIEW_QUESTIONS),
    answerHistory: z
      .array(StableInterviewIdSchema)
      .max(MAX_INTERVIEW_QUESTIONS),
    repositorySuggestions: z.array(RepositorySuggestionSchema).max(50),
  })
  .strict()
  .superRefine((context, ctx) => {
    if (
      context.primaryKind &&
      !ProjectKindSchema.safeParse(context.primaryKind.value).success
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["primaryKind", "value"],
        message: "The primary project kind must use a supported stable value.",
      });
    }
    if (
      context.ownership &&
      !OwnershipSchema.safeParse(context.ownership.value).success
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["ownership", "value"],
        message: "Ownership must use the project-context contract values.",
      });
    }
    if (
      context.collaboration &&
      !CollaborationSchema.safeParse(context.collaboration.value).success
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["collaboration", "value"],
        message: "Collaboration must use a supported stable value.",
      });
    }

    const answerById = new Map(
      context.answers.map((answer) => [answer.nodeId, answer]),
    );
    if (answerById.size !== context.answers.length) {
      ctx.addIssue({
        code: "custom",
        path: ["answers"],
        message: "Only one answer per question may appear in project context.",
      });
    }
    if (new Set(context.answerHistory).size !== context.answerHistory.length) {
      ctx.addIssue({
        code: "custom",
        path: ["answerHistory"],
        message: "Presented question IDs must be unique.",
      });
    }
    for (let index = 0; index < context.answers.length; index += 1) {
      const answer = context.answers[index];
      if (
        answer.catalogVersion !== context.version ||
        !context.answerHistory.includes(answer.nodeId)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["answers", index],
          message:
            "Every answer must match the context version and answer history.",
        });
      }
    }

    const hints = new Map(
      context.repositorySuggestions.map((hint) => [hint.id, hint]),
    );
    const facts = [
      context.primaryKind,
      context.projectPurpose,
      context.ownership,
      context.collaboration,
      ...context.secondaryTags,
      ...context.intendedUsers,
      ...context.confirmedCapabilities,
      ...context.contributedAreas,
      ...context.contributionDetails,
      ...context.outcomeEvidence,
      ...context.limitations,
      context.notes,
    ].filter((factValue): factValue is z.infer<typeof ContextFactSchema> =>
      Boolean(factValue),
    );
    facts.forEach((factValue, index) => {
      const answer = factValue.questionId
        ? answerById.get(factValue.questionId)
        : undefined;
      if (factValue.questionId && !answer) {
        ctx.addIssue({
          code: "custom",
          path: ["facts", index, "questionId"],
          message: "A fact must reference an answer in this context.",
        });
      }
      if (
        factValue.optionId &&
        (!answer || !answer.optionIds.includes(factValue.optionId))
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["facts", index, "optionId"],
          message: "A fact must reference an option selected in its answer.",
        });
      }
      if (factValue.repositoryHintId) {
        const hint = hints.get(factValue.repositoryHintId);
        if (!hint || hint.disposition !== "accepted") {
          ctx.addIssue({
            code: "custom",
            path: ["facts", index, "repositoryHintId"],
            message: "A confirmed fact must reference an accepted suggestion.",
          });
        }
      }
    });
  });
export type ProjectContext = z.infer<typeof ProjectContextSchema>;

const MigrationMappingSchema = z
  .object({
    from: StableInterviewIdSchema,
    to: StableInterviewIdSchema.nullable(),
  })
  .strict();

export const CatalogMigrationSchema = z
  .object({
    fromVersion: z.string().min(1).max(64),
    toVersion: z.literal(PROJECT_CONTEXT_VERSION),
    nodeMappings: z.array(MigrationMappingSchema).max(MAX_CATALOG_NODES),
    optionMappings: z
      .array(
        z
          .object({
            fromNodeId: StableInterviewIdSchema,
            fromOptionId: StableInterviewIdSchema,
            toNodeId: StableInterviewIdSchema,
            toOptionId: StableInterviewIdSchema.nullable(),
          })
          .strict(),
      )
      .max(MAX_CATALOG_NODES * 5),
  })
  .strict()
  .superRefine((migration, ctx) => {
    const nodeSources = migration.nodeMappings.map((entry) => entry.from);
    if (new Set(nodeSources).size !== nodeSources.length) {
      ctx.addIssue({
        code: "custom",
        path: ["nodeMappings"],
        message: "Each source question may be mapped only once.",
      });
    }
    const optionSources = migration.optionMappings.map(
      (entry) => entry.fromNodeId + ":" + entry.fromOptionId,
    );
    if (new Set(optionSources).size !== optionSources.length) {
      ctx.addIssue({
        code: "custom",
        path: ["optionMappings"],
        message: "Each source option may be mapped only once.",
      });
    }
  });
export type CatalogMigration = z.infer<typeof CatalogMigrationSchema>;

export const MigrationNoticeSchema = z
  .object({
    answerNodeId: StableInterviewIdSchema,
    reason: z.enum(["question-retired", "selection-retired"]),
  })
  .strict();
export type MigrationNotice = z.infer<typeof MigrationNoticeSchema>;
