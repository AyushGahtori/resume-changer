import { z } from "zod";
import type { MetricDefinition } from "../github/contracts";

const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const RepositoryMetricCandidateSchema = z
  .object({
    id,
    definitionId: id.nullable(),
    status: z.enum([
      "measured",
      "user-attested",
      "documented",
      "target",
      "estimate",
      "unsupported",
    ]),
    values: z.array(z.number().finite()).max(4),
    units: z.array(z.string().max(40)).max(4),
    sourceEvidenceIds: z.array(id).max(30),
    context: z.record(z.string(), z.string().max(500)),
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.values.length !== candidate.units.length) {
      context.addIssue({
        code: "custom",
        path: ["units"],
        message: "Each candidate value must retain its unit.",
      });
    }
    if (
      ["target", "estimate", "unsupported"].includes(candidate.status) &&
      candidate.values.length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["values"],
        message: "Targets, estimates, and unsupported values are not results.",
      });
    }
  });

export type RepositoryMetricCandidate = z.infer<
  typeof RepositoryMetricCandidateSchema
>;

export const RepositoryExtractionModelInputSchema = z
  .object({
    selectionHash: z.string().regex(/^[a-f0-9]{64}$/i),
    selectionVersion: z.number().int().positive(),
    revision: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i),
    repository: z
      .object({
        owner: z.string().min(1).max(100),
        name: z.string().min(1).max(100),
        packagePath: z.string().max(1_024).nullable(),
        selectedPullRequestNumbers: z
          .array(z.number().int().positive())
          .max(30),
        selectedPaths: z.array(z.string().max(1_024)).max(100),
      })
      .strict(),
    contribution: z.string().trim().min(1).max(2_000),
    identitySource: z.enum(["github-account", "user-provided", "unknown"]),
    evidence: z
      .array(
        z
          .object({
            id,
            path: z.string().min(1).max(1_024),
            pointer: z.discriminatedUnion("kind", [
              z
                .object({
                  kind: z.literal("lines"),
                  startLine: z.number().int().positive(),
                  endLine: z.number().int().positive(),
                })
                .strict(),
              z
                .object({
                  kind: z.literal("report-fields"),
                  fields: z.array(z.string().min(1).max(500)).min(1).max(50),
                })
                .strict(),
            ]),
            excerpt: z.string().max(20_000),
            classification: z.enum([
              "observed",
              "documented",
              "user-provided",
              "inferred",
            ]),
          })
          .strict(),
      )
      .max(300),
    metricCandidates: z.array(RepositoryMetricCandidateSchema).max(8),
    catalog: z
      .array(
        z
          .object({
            id,
            version: z.number().int().positive(),
            capability: z.string().min(1).max(100),
            task: z.string().min(1).max(100),
            quantity: z.string().min(1).max(100),
            unit: z.string().min(1).max(40),
            statistic: z.string().min(1).max(60),
            direction: z.enum([
              "higher-is-better",
              "lower-is-better",
              "neutral",
            ]),
            allowedRange: z
              .object({ min: z.number().finite(), max: z.number().finite() })
              .strict(),
            requiredContext: z.array(z.string().min(1).max(120)).max(30),
            calculatorId: id.nullable(),
            rendererId: id,
            recipeId: id.nullable(),
          })
          .strict(),
      )
      .max(12),
    completeness: z.enum(["complete", "partial", "needs-context"]),
    limitations: z.array(z.string().max(500)).max(100),
  })
  .strict();

export type RepositoryExtractionModelInput = z.infer<
  typeof RepositoryExtractionModelInputSchema
>;

const ExtractedClaimSchema = z
  .object({
    text: z.string().trim().min(1).max(1_000),
    evidenceIds: z.array(id).max(20),
    usesContributionStatement: z.boolean(),
    limitations: z.array(z.string().trim().min(1).max(500)).max(10),
  })
  .strict();

const ExtractedDraftSchema = z
  .object({
    text: z.string().trim().min(1).max(1_000),
    claimIndexes: z.array(z.number().int().nonnegative()).min(1).max(12),
    limitations: z.array(z.string().trim().min(1).max(500)).max(10),
  })
  .strict();

export const RepositoryExtractionModelResultSchema = z
  .object({
    projectSummary: z.string().trim().max(2_000),
    claims: z.array(ExtractedClaimSchema).max(12),
    drafts: z.array(ExtractedDraftSchema).max(5),
    questionSuggestions: z.array(id).max(5),
    limitations: z.array(z.string().trim().min(1).max(500)).max(30),
  })
  .strict();

export type RepositoryExtractionModelResult = z.infer<
  typeof RepositoryExtractionModelResultSchema
>;

export type RepositoryExtractionUsage = {
  promptTokens: number | null;
  cachedTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
};

export type RepositoryExtractionGenerationInput = {
  prompt: string;
  outputSchema: Record<string, unknown>;
  signal?: AbortSignal;
  maxOutputTokens?: number;
};

export type RepositoryExtractionGenerationResult = {
  text: string | null;
  model: string | null;
  finishReason: string | null;
  usage: RepositoryExtractionUsage;
};

export function repositoryExtractionOutputSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(
    RepositoryExtractionModelResultSchema,
  ) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

export function repositoryCatalogIds(catalog: readonly MetricDefinition[]) {
  return new Set(
    catalog.flatMap((definition) =>
      definition.recipeId
        ? [definition.id, definition.recipeId]
        : [definition.id],
    ),
  );
}
