import { z } from "zod";

import {
  RepositoryPathSchema,
  RepositoryScopeSchema,
} from "@/lib/github/contracts";

const IdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const VersionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const IdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/);

const ContributionContextSchema = z
  .object({
    role: z.string().trim().min(1).max(200),
    statement: z.string().trim().min(1).max(4_000),
    paths: z.array(RepositoryPathSchema).max(100).default([]),
    commitIds: z
      .array(z.string().regex(/^[a-f0-9]{7,40}$/i))
      .max(100)
      .default([]),
    pullRequestNumbers: z
      .array(z.number().int().positive())
      .max(100)
      .default([]),
  })
  .strict();

const ContributionEditSchema = ContributionContextSchema.partial().strict();

const LegacyCreateImportInputSchema = z
  .object({
    projectId: IdSchema,
    repositoryUrl: z
      .string()
      .trim()
      .url()
      .max(2_048)
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            url.protocol === "https:" &&
            url.hostname.toLowerCase() === "github.com" &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash &&
            /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname) &&
            !url.pathname.includes("..")
          );
        } catch {
          return false;
        }
      }),
    ref: z.string().trim().min(1).max(255).optional(),
    dataSource: z.enum(["personal", "demo"]),
    contribution: ContributionContextSchema,
  })
  .strict();

export const InspectInputSchema = z
  .object({
    expectedVersion: VersionSchema,
    packagePath: RepositoryPathSchema.optional(),
    selectedPrNumbers: z
      .array(z.number().int().positive())
      .max(100)
      .default([]),
    contribution: ContributionContextSchema.optional(),
  })
  .strict();

const LegacySelectionInputSchema = z
  .object({
    expectedVersion: VersionSchema,
    fileIds: z
      .array(IdSchema)
      .max(16)
      .refine((items) => new Set(items).size === items.length),
    pinnedFileIds: z
      .array(IdSchema)
      .max(16)
      .refine((items) => new Set(items).size === items.length),
    context: ContributionEditSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.pinnedFileIds.some((id) => !value.fileIds.includes(id))) {
      context.addIssue({
        code: "custom",
        path: ["pinnedFileIds"],
        message: "Pinned files must also be selected.",
      });
    }
  });

const LegacyExtractInputSchema = z
  .object({
    expectedVersion: VersionSchema,
    selectionVersion: VersionSchema,
    selectionHash: z.string().regex(/^[a-f0-9]{64}$/i),
    providerConsent: z.literal(true),
    idempotencyKey: IdempotencyKeySchema,
  })
  .strict();

export const DraftUpdateInputSchema = z
  .object({
    expectedVersion: VersionSchema,
    text: z.string().trim().min(1).max(10_000).optional(),
    selectedForSave: z.boolean().optional(),
    contributionConfirmed: z.boolean().optional(),
    confirmedMetricResultIds: z.array(IdSchema).max(8).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.text !== undefined ||
      value.selectedForSave !== undefined ||
      value.contributionConfirmed !== undefined ||
      value.confirmedMetricResultIds !== undefined,
    { message: "Provide at least one reviewed draft change." },
  );

export const MeasurementAnswerInputSchema = z
  .object({
    expectedVersion: VersionSchema,
    answer: z.record(z.string(), z.unknown()),
  })
  .strict();

export const MeasurementTaskInputSchema = z
  .object({
    expectedVersion: VersionSchema,
    task: z.record(z.string(), z.unknown()),
  })
  .strict();

const ApprovalDraftSchema = z
  .object({
    draftId: IdSchema,
    expectedVersion: VersionSchema,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  })
  .strict();

const ApprovalMetricSchema = z
  .object({
    resultId: IdSchema,
    expectedVersion: VersionSchema,
    confirmationHash: z.string().regex(/^[a-f0-9]{64}$/i),
  })
  .strict();

const LegacyApproveInputSchema = z
  .object({
    drafts: z.array(ApprovalDraftSchema).min(1).max(20),
    metrics: z.array(ApprovalMetricSchema).max(40).default([]),
    idempotencyKey: IdempotencyKeySchema,
  })
  .strict()
  .superRefine((value, context) => {
    const draftIds = value.drafts.map((draft) => draft.draftId);
    if (new Set(draftIds).size !== draftIds.length) {
      context.addIssue({
        code: "custom",
        path: ["drafts"],
        message: "Each draft can only be approved once per request.",
      });
    }
    const metricIds = value.metrics.map((metric) => metric.resultId);
    if (new Set(metricIds).size !== metricIds.length) {
      context.addIssue({
        code: "custom",
        path: ["metrics"],
        message: "Each measurement can only be confirmed once per request.",
      });
    }
  });

const LegacyCancelInputSchema = z
  .object({
    expectedVersion: VersionSchema,
    expectedRunId: IdSchema,
  })
  .strict();

export const DiscardInputSchema = z
  .object({
    expectedVersion: VersionSchema,
    confirmDiscard: z.literal(true),
  })
  .strict();

export const CreateImportInputSchema = z.union([
  z
    .object({
      source: z.enum(["personal", "demo"]),
      destinationProjectId: IdSchema,
      scope: RepositoryScopeSchema,
    })
    .strict()
    .transform((i) => ({
      projectId: i.destinationProjectId,
      repositoryUrl: i.scope.canonicalUrl,
      dataSource: i.source,
      ref: i.scope.commitSha,
      contribution: {
        role: "Repository contributor",
        statement: i.scope.contributionStatement,
        paths: i.scope.selectedPaths,
        commitIds: [],
        pullRequestNumbers: i.scope.selectedPullRequestNumbers,
      },
      scope: i.scope,
    })),
  LegacyCreateImportInputSchema.transform((i) => ({
    ...i,
    scope: undefined as z.infer<typeof RepositoryScopeSchema> | undefined,
  })),
]);
export const SelectionInputSchema = z.union([
  z
    .object({
      expectedVersion: VersionSchema,
      scope: RepositoryScopeSchema,
      pinnedFileIds: z.array(IdSchema).max(12),
      removedFileIds: z.array(IdSchema).max(2000).optional(),
      destinationProjectId: IdSchema.optional(),
    })
    .strict()
    .transform((i) => ({ ...i, fileIds: [] as string[], context: undefined })),
  LegacySelectionInputSchema.transform((i) => ({
    ...i,
    scope: undefined as z.infer<typeof RepositoryScopeSchema> | undefined,
    removedFileIds: undefined as string[] | undefined,
    destinationProjectId: undefined as string | undefined,
  })),
]);
export const ExtractInputSchema = z.union([
  z
    .object({
      expectedVersion: VersionSchema,
      selectionHash: z.string().regex(/^[a-f0-9]{64}$/i),
      consentReference: IdSchema,
      providerConsent: z.literal(true),
      idempotencyKey: IdempotencyKeySchema,
    })
    .strict()
    .transform((i) => ({
      ...i,
      selectionVersion: undefined as number | undefined,
    })),
  LegacyExtractInputSchema.transform((i) => ({
    ...i,
    consentReference: undefined as string | undefined,
  })),
]);
export const ApproveInputSchema = z.union([
  z
    .object({
      expectedVersion: VersionSchema,
      selectedDraftIds: z.array(IdSchema).min(1).max(8),
      idempotencyKey: IdempotencyKeySchema,
    })
    .strict()
    .transform((i) => ({
      ...i,
      drafts: [] as z.infer<typeof ApprovalDraftSchema>[],
      metrics: [] as z.infer<typeof ApprovalMetricSchema>[],
    })),
  LegacyApproveInputSchema.transform((i) => ({
    ...i,
    expectedVersion: undefined as number | undefined,
    selectedDraftIds: undefined as string[] | undefined,
  })),
]);
export const CancelInputSchema = z.union([
  z
    .object({ runId: IdSchema })
    .strict()
    .transform((i) => ({
      expectedRunId: i.runId,
      expectedVersion: undefined as number | undefined,
    })),
  LegacyCancelInputSchema,
]);

export const RouteIdSchema = IdSchema;

export type CreateImportInput = z.infer<typeof CreateImportInputSchema>;
export type InspectInput = z.infer<typeof InspectInputSchema>;
export type SelectionInput = z.infer<typeof SelectionInputSchema>;
export type ExtractInput = z.infer<typeof ExtractInputSchema>;
export type DraftUpdateInput = z.infer<typeof DraftUpdateInputSchema>;
export type MeasurementAnswerInput = z.infer<
  typeof MeasurementAnswerInputSchema
>;
export type MeasurementTaskInput = z.infer<typeof MeasurementTaskInputSchema>;
export type ApproveInput = z.infer<typeof ApproveInputSchema>;
export type CancelInput = z.infer<typeof CancelInputSchema>;
export type DiscardInput = z.infer<typeof DiscardInputSchema>;
