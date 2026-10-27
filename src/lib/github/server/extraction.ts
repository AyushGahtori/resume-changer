import {
  AnalysisResultSchema,
  ContributionClaimSchema,
  DraftSchema,
  GITHUB_IMPORT_POLICY,
  MetricDefinitionSchema,
  PreparedSelectionSchema,
  err,
  ok,
  type AnalysisResult,
  type BudgetSummary,
  type ContributionClaim,
  type DomainError,
  type Draft,
  type ExecutionContext,
  type MetricDefinition,
  type PreparedSelection,
  type Result,
} from "../contracts";
import type {
  RepositoryExtractorFactory,
  RepositoryExtractorPort,
} from "../ports";
import { AiProviderError, type AiProvider } from "../../ai/provider";
import {
  RepositoryExtractionModelInputSchema,
  RepositoryExtractionModelResultSchema,
  RepositoryMetricCandidateSchema,
  repositoryCatalogIds,
  repositoryExtractionOutputSchema,
  type RepositoryExtractionGenerationResult,
  type RepositoryExtractionModelInput,
  type RepositoryExtractionUsage,
  type RepositoryMetricCandidate,
} from "../../ai/repository-extraction";
import { buildRepositoryExtractionPrompt } from "../../ai/prompts/v1/extract-repository-achievements";

const MAX_PROMPT_TOKENS_PER_ATTEMPT = 24_000;
const MAX_TOTAL_INPUT_TOKENS = 36_000;
const MAX_EXTRACTION_ATTEMPTS = GITHUB_IMPORT_POLICY.generationAttempts;
const MAX_OUTPUT_TOKENS = GITHUB_IMPORT_POLICY.generatedTokensPerRequest;
const CONTRIBUTION_STATEMENT_ID = "contribution-statement";
const PENDING_DESTINATION_ID = "pending-destination";

type PortGenerate = Parameters<RepositoryExtractorFactory>[0]["generate"];
type ProviderMetadata = {
  finishReason: string | null;
  usage: RepositoryExtractionUsage;
};
type EnrichedGenerateResult = {
  text: string;
  model: string | null;
  usage: BudgetSummary;
  extractionMetadata?: ProviderMetadata;
};
type GenerateDependencies = {
  generate: PortGenerate;
  now: () => Date;
};
type ProviderDependencies = {
  provider: Pick<AiProvider, "extractRepositoryAchievements">;
  now: () => Date;
};
export type RepositoryExtractionInput = Parameters<
  RepositoryExtractorPort["extract"]
>[0] & {
  /** Parsed by the report service and supplied only when a supported report exists. */
  metricCandidates?: RepositoryMetricCandidate[];
  /** Added by orchestration when available; unresolved drafts cannot be approved. */
  destinationProjectId?: string;
};
export type RepositoryExtractionPort = Omit<
  RepositoryExtractorPort,
  "extract"
> & {
  extract(input: RepositoryExtractionInput): Promise<Result<AnalysisResult>>;
};

function domainError(
  code: DomainError["code"],
  message: string,
  retryable = false,
  retryAfterSeconds?: number,
): DomainError {
  return {
    code,
    message: message.slice(0, 500),
    retryable,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  };
}

function toDomainError(error: unknown, signal: AbortSignal): DomainError {
  if (signal.aborted) {
    return domainError("cancelled", "Repository analysis was cancelled.");
  }
  if (error instanceof AiProviderError) {
    if (error.code === "MISSING_API_KEY")
      return domainError("unavailable", "The AI provider is not configured.");
    if (error.code === "INPUT_TOO_LARGE")
      return domainError(
        "limit-exceeded",
        "The selected evidence exceeds the provider input limit.",
      );
    if (error.code === "RATE_LIMITED")
      return domainError(
        "rate-limited",
        "The AI provider is temporarily rate limited.",
        error.retryable,
        error.retryAfterSeconds,
      );
    if (error.code === "INVALID_RESPONSE")
      return domainError(
        "invalid-evidence",
        "The AI response could not be validated against the selected evidence.",
        error.retryable,
      );
    return domainError(
      "upstream-error",
      "The AI provider could not complete repository analysis.",
      error.retryable,
    );
  }
  if (
    error instanceof Error &&
    ["AbortError", "TimeoutError", "RequestTimeoutError"].includes(error.name)
  ) {
    return domainError(
      "upstream-error",
      "The AI provider request timed out.",
      true,
    );
  }
  return domainError(
    "upstream-error",
    "The AI provider could not complete repository analysis.",
    true,
  );
}

function budgetError(error: unknown): DomainError {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "limit-exceeded")
      return domainError(
        "limit-exceeded",
        "The shared repository analysis budget is exhausted.",
      );
    if (code === "forbidden")
      return domainError(
        "forbidden",
        "The shared budget does not authorize this provider request.",
      );
  }
  return domainError(
    "unavailable",
    "The shared repository analysis budget is unavailable.",
    true,
  );
}

function estimatePromptTokens(prompt: string): number {
  // This is deliberately a conservative local estimate, not provider usage.
  return Math.ceil(prompt.length / 2);
}

function nullableSum(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left + right;
}

function addUsage(
  accumulated: RepositoryExtractionUsage,
  next: RepositoryExtractionUsage,
): RepositoryExtractionUsage {
  return {
    promptTokens: nullableSum(accumulated.promptTokens, next.promptTokens),
    cachedTokens: nullableSum(accumulated.cachedTokens, next.cachedTokens),
    outputTokens: nullableSum(accumulated.outputTokens, next.outputTokens),
    reasoningTokens: nullableSum(
      accumulated.reasoningTokens,
      next.reasoningTokens,
    ),
    totalTokens: nullableSum(accumulated.totalTokens, next.totalTokens),
  };
}

function providerUsageFromPort(
  value: EnrichedGenerateResult,
): ProviderMetadata {
  if (value.extractionMetadata) return value.extractionMetadata;
  return {
    finishReason: null,
    usage: {
      promptTokens: value.usage.reportedInputTokens,
      cachedTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      totalTokens: null,
    },
  };
}

function toTransientBudgetSummary(
  prompt: string,
  response: RepositoryExtractionGenerationResult,
): BudgetSummary {
  return {
    fetchedFiles: 0,
    fetchedBytes: 0,
    httpAttempts: 0,
    selectedUniqueFiles: 0,
    selectedUniqueLines: 0,
    selectedCharacters: 0,
    transmittedLinesByRequest: [],
    cumulativeTransmittedLines: 0,
    estimatedInputTokens: estimatePromptTokens(prompt),
    reportedInputTokens: response.usage.promptTokens,
    limitReason: null,
  };
}

function wrapProvider(
  provider: ProviderDependencies["provider"],
): PortGenerate {
  return async ({ prompt, signal }) => {
    const response = await provider.extractRepositoryAchievements({
      prompt,
      outputSchema: repositoryExtractionOutputSchema(),
      signal,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    const value: EnrichedGenerateResult = {
      text: response.text ?? "",
      model: response.model,
      usage: toTransientBudgetSummary(prompt, response),
      extractionMetadata: {
        finishReason: response.finishReason,
        usage: response.usage,
      },
    };
    return ok(value);
  };
}

function validatePreparedSelection(
  preparedInput: unknown,
  contribution: string,
  context: ExecutionContext,
  now: Date,
): Result<PreparedSelection> {
  const parsed = PreparedSelectionSchema.safeParse(preparedInput);
  if (!parsed.success) {
    return err(
      domainError(
        "invalid-input",
        "The prepared repository selection is invalid.",
      ),
    );
  }
  const prepared = parsed.data;
  if (!prepared.consentedAt) {
    return err(
      domainError(
        "forbidden",
        "Consent is required for this exact repository selection before analysis.",
      ),
    );
  }
  if (prepared.runId !== context.runId) {
    return err(
      domainError(
        "invalid-evidence",
        "The consented selection belongs to a different analysis run.",
      ),
    );
  }
  if (
    Date.parse(prepared.consentedAt) > now.getTime() ||
    Date.parse(context.deadline) <= now.getTime()
  ) {
    return err(
      domainError(
        "limit-exceeded",
        "The consent or analysis deadline is no longer valid.",
      ),
    );
  }
  if (contribution.trim() !== prepared.scope.contributionStatement.trim()) {
    return err(
      domainError(
        "invalid-evidence",
        "Contribution context changed after consent; prepare and consent to the updated selection.",
      ),
    );
  }
  if (
    prepared.selectedFileIds.length > GITHUB_IMPORT_POLICY.filesPerRequest ||
    prepared.budget.selectedUniqueLines >
      GITHUB_IMPORT_POLICY.linesPerRequest ||
    prepared.evidence.reduce((total, item) => total + item.excerpt.length, 0) >
      GITHUB_IMPORT_POLICY.selectedCharactersTotal ||
    prepared.evidence.some(
      (item) =>
        item.excerpt.length > GITHUB_IMPORT_POLICY.selectedCharactersPerFile,
    )
  ) {
    return err(
      domainError(
        "limit-exceeded",
        "The consented evidence exceeds the repository extraction limits.",
      ),
    );
  }
  if (
    prepared.evidence.some(
      (item) => item.commitSha !== prepared.scope.commitSha,
    )
  ) {
    return err(
      domainError(
        "invalid-evidence",
        "Evidence does not belong to the consented repository revision.",
      ),
    );
  }
  if (context.signal.aborted) {
    return err(domainError("cancelled", "Repository analysis was cancelled."));
  }
  return ok(prepared);
}

function buildModelInput(
  prepared: PreparedSelection,
  contribution: string,
  catalogInput: MetricDefinition[],
  candidatesInput: RepositoryMetricCandidate[],
): Result<RepositoryExtractionModelInput> {
  const catalogParsed = MetricDefinitionSchema.array()
    .max(12)
    .safeParse(catalogInput);
  if (!catalogParsed.success) {
    return err(
      domainError("invalid-input", "The measurement catalog is invalid."),
    );
  }
  const catalog = catalogParsed.data;
  const catalogIds = new Set(catalog.map(({ id }) => id));
  if (catalogIds.size !== catalog.length) {
    return err(domainError("invalid-input", "Catalog IDs must be unique."));
  }

  const evidenceById = new Map(
    prepared.evidence.map((item) => [item.id, item]),
  );
  if (evidenceById.size !== prepared.evidence.length) {
    return err(domainError("invalid-evidence", "Evidence IDs must be unique."));
  }
  const parsedCandidates = parseMetricCandidates(candidatesInput);
  if (!parsedCandidates.ok) return parsedCandidates;
  const candidateIds = new Set<string>();
  for (const candidate of parsedCandidates.value) {
    if (
      candidateIds.has(candidate.id) ||
      candidate.sourceEvidenceIds.some((id) => !evidenceById.has(id)) ||
      (candidate.definitionId !== null &&
        !catalogIds.has(candidate.definitionId))
    ) {
      return err(
        domainError(
          "invalid-evidence",
          "A metric candidate refers to evidence or a definition outside this selection.",
        ),
      );
    }
    candidateIds.add(candidate.id);
  }

  const modelInput = {
    selectionHash: prepared.selectionHash,
    selectionVersion: prepared.version,
    revision: prepared.scope.commitSha,
    repository: {
      owner: prepared.scope.owner,
      name: prepared.scope.name,
      packagePath: prepared.scope.packagePath ?? null,
      selectedPullRequestNumbers: prepared.scope.selectedPullRequestNumbers,
      selectedPaths: prepared.scope.selectedPaths,
    },
    contribution: contribution.trim(),
    identitySource: prepared.scope.identitySource,
    evidence: prepared.evidence.map((item) => ({
      id: item.id,
      path: item.path,
      pointer: item.pointer,
      excerpt: item.excerpt,
      classification: item.classification,
    })),
    metricCandidates: parsedCandidates.value,
    catalog,
    completeness: prepared.completeness,
    limitations: prepared.limitations,
  };
  const parsedInput =
    RepositoryExtractionModelInputSchema.safeParse(modelInput);
  if (!parsedInput.success) {
    return err(
      domainError(
        "invalid-input",
        "The repository extraction input is invalid.",
      ),
    );
  }
  return ok(parsedInput.data);
}

function parseMetricCandidates(
  input: unknown,
): Result<RepositoryMetricCandidate[]> {
  const parsed = RepositoryMetricCandidateSchema.array()
    .max(GITHUB_IMPORT_POLICY.metricCandidates)
    .safeParse(input);
  if (!parsed.success) {
    return err(
      domainError(
        "invalid-input",
        "Parsed measurement candidates are invalid.",
      ),
    );
  }
  return ok(parsed.data);
}

function numericClaim(text: string): boolean {
  return /(?:\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand)\b)/iu.test(
    text,
  );
}

const unsafeGeneratedText =
  /(?:https?:\/\/|\bwww\.|```|`|\b(?:gh[pousr]_[a-z0-9]{8,}|github_pat_[a-z0-9_]{12,}|AIza[\w-]{20,})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:npm|pnpm|yarn|git|curl|wget|sudo|powershell)\s+(?:run|install|exec|clone|fetch|push|config)\b)/iu;

function validateModelResult(
  raw: unknown,
  input: RepositoryExtractionModelInput,
): Result<ReturnType<typeof RepositoryExtractionModelResultSchema.parse>> {
  const parsed = RepositoryExtractionModelResultSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues
      .slice(0, 6)
      .map((item) => {
        const path = item.path.map((part) => String(part)).join(".") || "$";
        return `${path}:${item.code}`;
      })
      .join(", ");
    return err(
      domainError(
        "invalid-evidence",
        `The structured extraction did not match its schema (${issue}).`,
      ),
    );
  }

  const knownEvidence = new Set(input.evidence.map(({ id }) => id));
  const knownQuestions = repositoryCatalogIds(input.catalog);
  if (
    numericClaim(parsed.data.projectSummary) ||
    unsafeGeneratedText.test(parsed.data.projectSummary)
  ) {
    return err(
      domainError(
        "invalid-evidence",
        "The project summary contains an unsupported number or unsafe value.",
      ),
    );
  }
  for (const claim of parsed.data.claims) {
    if (
      claim.evidenceIds.some((id) => !knownEvidence.has(id)) ||
      new Set(claim.evidenceIds).size !== claim.evidenceIds.length ||
      (claim.evidenceIds.length === 0 && !claim.usesContributionStatement) ||
      (claim.usesContributionStatement && !input.contribution.trim()) ||
      numericClaim(claim.text) ||
      unsafeGeneratedText.test(claim.text)
    ) {
      return err(
        domainError(
          "invalid-evidence",
          "A claim contains an unsupported reference, number, or unsafe instruction-like value.",
        ),
      );
    }
  }
  for (const draft of parsed.data.drafts) {
    if (
      draft.claimIndexes.some((index) => index >= parsed.data.claims.length) ||
      new Set(draft.claimIndexes).size !== draft.claimIndexes.length ||
      numericClaim(draft.text) ||
      unsafeGeneratedText.test(draft.text)
    ) {
      return err(
        domainError(
          "invalid-evidence",
          "A draft contains an unsupported claim reference, number, or unsafe value.",
        ),
      );
    }
  }
  if (parsed.data.questionSuggestions.some((id) => !knownQuestions.has(id))) {
    return err(
      domainError(
        "invalid-evidence",
        "A measurement suggestion refers to a catalog or recipe that was not supplied.",
      ),
    );
  }
  return ok(parsed.data);
}

function classifyClaim(
  evidenceIds: string[],
  usesContributionStatement: boolean,
  evidenceById: Map<string, RepositoryExtractionModelInput["evidence"][number]>,
): ContributionClaim["classification"] {
  if (usesContributionStatement) return "user-provided";
  const sources = evidenceIds.map((id) => evidenceById.get(id)?.classification);
  if (sources.includes("inferred")) return "inferred";
  if (sources.includes("observed")) return "observed";
  if (sources.length > 0 && sources.every((source) => source === "documented"))
    return "documented";
  return "inferred";
}

function toAnalysisResult(input: {
  parsed: ReturnType<typeof RepositoryExtractionModelResultSchema.parse>;
  modelInput: RepositoryExtractionModelInput;
  prepared: PreparedSelection;
  destinationProjectId?: string;
  model: string | null;
  finishReason: string | null;
  usage: RepositoryExtractionUsage;
}): Result<AnalysisResult> {
  const evidenceById = new Map(
    input.modelInput.evidence.map((item) => [item.id, item]),
  );
  const idPrefix = input.prepared.selectionHash.slice(0, 12).toLowerCase();
  const contributionAvailable = input.modelInput.contribution.trim().length > 0;
  const claims: ContributionClaim[] = input.parsed.claims.map(
    (claim, index) => {
      const userStatementIds =
        claim.usesContributionStatement && contributionAvailable
          ? [CONTRIBUTION_STATEMENT_ID]
          : [];
      return ContributionClaimSchema.parse({
        id: `claim-${idPrefix}-${index + 1}`,
        text: claim.text,
        evidenceIds: claim.evidenceIds,
        userStatementIds,
        classification: classifyClaim(
          claim.evidenceIds,
          claim.usesContributionStatement,
          evidenceById,
        ),
        confirmedByUser: false,
        confirmationVersion: null,
        limitations: [
          ...new Set([
            ...claim.limitations,
            ...(claim.usesContributionStatement
              ? [
                  "Personal contribution is user-provided and still requires confirmation.",
                ]
              : []),
          ]),
        ].slice(0, 30),
      });
    },
  );

  const destinationProjectId =
    input.destinationProjectId?.trim() || PENDING_DESTINATION_ID;
  const unresolvedDestination = !input.destinationProjectId?.trim();
  const supportStatus: Draft["supportStatus"] =
    input.prepared.completeness === "needs-context"
      ? "needs-context"
      : input.prepared.completeness === "partial"
        ? "partial"
        : "supported";
  const drafts: Draft[] = input.parsed.drafts.map((draft, index) => {
    const claimIds = [
      ...new Set(
        draft.claimIndexes.map((claimIndex) => claims[claimIndex]?.id),
      ),
    ].filter((id): id is string => Boolean(id));
    return DraftSchema.parse({
      id: `draft-${idPrefix}-${index + 1}`,
      version: 1,
      projectId: destinationProjectId,
      text: draft.text,
      reviewedBaseText: draft.text,
      claimIds,
      supportStatus,
      selectedForSave: false,
      contributionConfirmed: false,
      metricResultIds: [],
      approvalEligible: false,
      approvalErrors: [
        "Review this candidate and confirm your contribution before saving.",
        ...(unresolvedDestination
          ? ["The import service has not assigned a destination project yet."]
          : []),
      ],
    });
  });

  const limitations = [
    ...input.prepared.limitations,
    ...input.parsed.limitations,
    ...input.parsed.claims.flatMap((claim) => claim.limitations),
    ...input.parsed.drafts.flatMap((draft) => draft.limitations),
  ];
  const result = AnalysisResultSchema.safeParse({
    summary: input.parsed.projectSummary,
    claims,
    drafts,
    questionSuggestions: input.parsed.questionSuggestions,
    limitations: [...new Set(limitations)].slice(0, 100),
    model: input.model,
    finishReason: input.finishReason,
    usage: input.usage,
    selectionHash: input.prepared.selectionHash,
  });
  return result.success
    ? ok(result.data)
    : err(
        domainError(
          "invalid-evidence",
          "The validated analysis result was inconsistent.",
        ),
      );
}

function metadataFromResult(value: EnrichedGenerateResult): ProviderMetadata {
  return providerUsageFromPort(value);
}

function actualUsageTotal(usage: RepositoryExtractionUsage): number | null {
  if (usage.totalTokens !== null) return usage.totalTokens;
  if (
    usage.promptTokens !== null &&
    usage.outputTokens !== null &&
    usage.reasoningTokens !== null
  ) {
    // Cached prompt tokens are already included in promptTokens.
    return usage.promptTokens + usage.outputTokens + usage.reasoningTokens;
  }
  return null;
}

function createExtractor(
  generate: PortGenerate,
  now: () => Date,
): RepositoryExtractionPort {
  return {
    async extract(input) {
      const clock = now();
      if (!(clock instanceof Date) || !Number.isFinite(clock.getTime())) {
        return err(
          domainError("invalid-input", "The extraction clock is invalid."),
        );
      }
      if (!input || typeof input.contribution !== "string") {
        return err(
          domainError("invalid-input", "Contribution context is required."),
        );
      }
      const preparedResult = validatePreparedSelection(
        input.prepared,
        input.contribution,
        input.context,
        clock,
      );
      if (!preparedResult.ok) return preparedResult;
      const prepared = preparedResult.value;
      const catalogInput = input.catalog;
      if (!Array.isArray(catalogInput)) {
        return err(
          domainError("invalid-input", "A measurement catalog is required."),
        );
      }
      const modelInputResult = buildModelInput(
        prepared,
        input.contribution,
        catalogInput,
        input.metricCandidates ?? [],
      );
      if (!modelInputResult.ok) return modelInputResult;
      const modelInput = modelInputResult.value;

      if (prepared.evidence.length === 0) {
        return toAnalysisResult({
          parsed: {
            projectSummary:
              "There is not enough selected source evidence to prepare achievement drafts.",
            claims: [],
            drafts: [],
            questionSuggestions: [],
            limitations: [
              "Select safe source evidence before requesting analysis.",
            ],
          },
          modelInput,
          prepared,
          destinationProjectId: input.destinationProjectId,
          model: null,
          finishReason: null,
          usage: {
            promptTokens: null,
            cachedTokens: null,
            outputTokens: null,
            reasoningTokens: null,
            totalTokens: null,
          },
        });
      }

      const selectionCheck = input.context.budget.checkSelection({
        files: prepared.budget.selectedUniqueFiles,
        lines: prepared.budget.selectedUniqueLines,
      });
      if (!selectionCheck.ok) return err(budgetError(selectionCheck.error));
      if (!selectionCheck.value.allowed) {
        return err(
          domainError(
            "limit-exceeded",
            selectionCheck.value.reason ||
              "The selected evidence exceeds the shared limits.",
          ),
        );
      }

      const catalogIds = repositoryCatalogIds(modelInput.catalog);
      if (catalogIds.size === 0 && modelInput.catalog.length > 0) {
        return err(
          domainError(
            "invalid-input",
            "The measurement catalog IDs are invalid.",
          ),
        );
      }

      let accumulatedUsage: RepositoryExtractionUsage = {
        promptTokens: 0,
        cachedTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
      };
      let model: string | null = null;
      let finishReason: string | null = null;
      let recoveryReason: string | undefined;

      for (let attempt = 0; attempt < MAX_EXTRACTION_ATTEMPTS; attempt += 1) {
        const currentTime = now();
        if (
          input.context.signal.aborted ||
          !Number.isFinite(Date.parse(input.context.deadline)) ||
          Date.parse(input.context.deadline) <= currentTime.getTime()
        ) {
          return err(
            input.context.signal.aborted
              ? domainError("cancelled", "Repository analysis was cancelled.")
              : domainError(
                  "limit-exceeded",
                  "The repository extraction deadline expired.",
                ),
          );
        }

        const prompt = buildRepositoryExtractionPrompt(
          modelInput,
          recoveryReason,
        );
        const outputSchema = repositoryExtractionOutputSchema();
        const estimatedTokens = estimatePromptTokens(
          `${prompt}\n${JSON.stringify(outputSchema)}`,
        );
        if (estimatedTokens > MAX_PROMPT_TOKENS_PER_ATTEMPT) {
          return err(
            domainError(
              "limit-exceeded",
              "The selected evidence is too large for one bounded extraction request.",
            ),
          );
        }
        const remaining = input.context.budget.remaining();
        if (!remaining.ok) return err(budgetError(remaining.error));
        if (
          remaining.value.generationAttempts >= MAX_EXTRACTION_ATTEMPTS ||
          remaining.value.inputTokens + estimatedTokens > MAX_TOTAL_INPUT_TOKENS
        ) {
          return err(
            domainError(
              "limit-exceeded",
              "The shared generation or input-token allowance is exhausted.",
            ),
          );
        }

        const reservation = await input.context.budget.reserve({
          operation:
            attempt === 0
              ? "github-repository-extraction"
              : "github-repository-extraction-recovery",
          amount: estimatedTokens,
          selection: prepared,
        });
        if (!reservation.ok) return err(budgetError(reservation.error));

        let generated: Result<{
          text: string;
          model: string | null;
          usage: BudgetSummary;
          extractionMetadata?: ProviderMetadata;
        }>;
        try {
          generated = (await generate({
            prompt,
            schemaVersion: "repository-extraction-v1",
            signal: input.context.signal,
          })) as Result<{
            text: string;
            model: string | null;
            usage: BudgetSummary;
            extractionMetadata?: ProviderMetadata;
          }>;
        } catch (error) {
          const committed = await input.context.budget.commitUsage({
            reservationId: reservation.value.reservationId,
            actual: null,
          });
          if (!committed.ok) return err(budgetError(committed.error));
          const mapped = toDomainError(error, input.context.signal);
          if (
            attempt + 1 < MAX_EXTRACTION_ATTEMPTS &&
            error instanceof AiProviderError &&
            error.retryable &&
            error.code !== "RATE_LIMITED" &&
            error.code !== "AUTHENTICATION_FAILED"
          ) {
            recoveryReason =
              "The prior provider attempt did not return a usable response. Retry once with the same evidence and deadline.";
            continue;
          }
          return err(mapped);
        }

        if (!generated.ok) {
          const committed = await input.context.budget.commitUsage({
            reservationId: reservation.value.reservationId,
            actual: null,
          });
          if (!committed.ok) return err(budgetError(committed.error));
          return err(generated.error);
        }

        const generatedValue = generated.value as EnrichedGenerateResult;
        const metadata = metadataFromResult(generatedValue);
        const budgetUsage = actualUsageTotal(metadata.usage);
        const committed = await input.context.budget.commitUsage({
          reservationId: reservation.value.reservationId,
          actual: budgetUsage,
          providerUsage: metadata.usage,
        });
        if (!committed.ok) return err(budgetError(committed.error));
        accumulatedUsage = addUsage(accumulatedUsage, metadata.usage);
        model = generatedValue.model;
        finishReason = metadata.finishReason;

        if (finishReason === "MAX_TOKENS") {
          if (attempt + 1 < MAX_EXTRACTION_ATTEMPTS) {
            recoveryReason =
              "The provider truncated the structured response. Return fewer, shorter drafts while preserving evidence references.";
            continue;
          }
          return err(
            domainError(
              "invalid-evidence",
              "The provider response was truncated after the single recovery attempt.",
            ),
          );
        }

        let decoded: unknown;
        try {
          decoded = JSON.parse(generatedValue.text);
        } catch {
          if (attempt + 1 < MAX_EXTRACTION_ATTEMPTS) {
            recoveryReason =
              "The provider response was not valid JSON. Return concise JSON matching the required schema.";
            continue;
          }
          return err(
            domainError(
              "invalid-evidence",
              "The provider returned malformed structured output.",
            ),
          );
        }

        const validated = validateModelResult(decoded, modelInput);
        if (!validated.ok) {
          if (attempt + 1 < MAX_EXTRACTION_ATTEMPTS) {
            recoveryReason = validated.error.message;
            continue;
          }
          return err(validated.error);
        }

        return toAnalysisResult({
          parsed: validated.value,
          modelInput,
          prepared,
          destinationProjectId: input.destinationProjectId,
          model,
          finishReason,
          usage: accumulatedUsage,
        });
      }

      return err(
        domainError(
          "invalid-evidence",
          "Repository extraction did not produce a usable result.",
        ),
      );
    },
  };
}

export function createRepositoryExtractor(
  deps: Parameters<RepositoryExtractorFactory>[0],
): RepositoryExtractionPort;
export function createRepositoryExtractor(
  deps: ProviderDependencies,
): RepositoryExtractionPort;
export function createRepositoryExtractor(
  deps: GenerateDependencies | ProviderDependencies,
): RepositoryExtractionPort {
  return "provider" in deps
    ? createExtractor(wrapProvider(deps.provider), deps.now)
    : createExtractor(deps.generate, deps.now);
}

/** Narrow adapter used by Node worker composition; it has no Next-only imports. */
export function createRepositoryExtractorForWorker(
  provider: Pick<AiProvider, "extractRepositoryAchievements">,
  now: () => Date = () => new Date(),
): RepositoryExtractionPort {
  return createRepositoryExtractor({ provider, now });
}
