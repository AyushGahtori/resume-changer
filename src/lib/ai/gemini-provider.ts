import "server-only";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import {
  AchievementSelectionInputSchema,
  AchievementSelectionResultSchema,
  JobAnalysisInputSchema,
  JobAnalysisResultSchema,
  LatexRepairInputSchema,
  LatexRepairResultSchema,
  ResumeDraftInputSchema,
  ResumeDraftResultSchema,
  type AchievementSelectionInput,
  type AchievementSelectionResult,
  type JobAnalysisInput,
  type JobAnalysisResult,
  type LatexRepairInput,
  type LatexRepairResult,
  type ResumeDraftInput,
  type ResumeDraftResult,
} from "./contracts";
import {
  buildAiPrompt,
  supportedTerminologyTargets,
  MAX_PROMPT_CHARACTERS,
} from "./prompt-builder";
import { includesPhrase } from "./requirement-coverage";
import { AiProviderError, type AiProvider } from "./provider";
import type { DiagnosticObserver } from "@/lib/diagnostics/server-trace";

const DEFAULT_MODEL = "gemini-3.6-flash";
const FALLBACK_MODEL = "gemini-2.5-flash-lite";
const REQUEST_TIMEOUT_MS = 30_000;

type GeminiRequest = (request: {
  model: string;
  prompt: string;
  outputSchema: Record<string, unknown>;
}) => Promise<string | undefined>;

type GeminiProviderOptions = {
  apiKey?: string;
  model?: string;
  request?: GeminiRequest;
  onDiagnostic?: DiagnosticObserver;
};

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value =
    (error as { status?: unknown; statusCode?: unknown }).status ??
    (error as { statusCode?: unknown }).statusCode;
  return typeof value === "number" ? value : undefined;
}

function mapRequestError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  const status = errorStatus(error);
  const name = error instanceof Error ? error.name : "";

  if (name === "AbortError" || name === "TimeoutError") {
    return new AiProviderError(
      "Gemini did not respond before the request timed out. Try again.",
      "REQUEST_TIMEOUT",
      true,
      "REQUEST_TIMEOUT",
    );
  }
  if (status === 401 || status === 403) {
    return new AiProviderError(
      "Gemini rejected the API key or its permissions.",
      "AUTHENTICATION_FAILED",
      false,
      `HTTP_${status}`,
    );
  }
  if (status === 429) {
    return new AiProviderError(
      "Gemini's free-tier request limit was reached. Wait and try again.",
      "RATE_LIMITED",
      true,
      "HTTP_429",
    );
  }
  if (status === 400 || status === 422) {
    return new AiProviderError(
      "Gemini could not process the request. Check the prompt and output schema.",
      "INVALID_REQUEST",
      false,
      `HTTP_${status}`,
    );
  }
  if (status !== undefined && status >= 500) {
    return new AiProviderError(
      "Gemini is temporarily unavailable. Try again shortly.",
      "SERVICE_UNAVAILABLE",
      true,
      `HTTP_${status}`,
    );
  }
  return new AiProviderError(
    "The Gemini request failed. Check your connection and try again.",
    "REQUEST_FAILED",
    status === undefined || status >= 500,
    status === undefined ? "NETWORK_OR_UNKNOWN_ERROR" : `HTTP_${status}`,
  );
}

/** Keep cardinality in instructions and application validation, not decoder states. */
export function buildProviderOutputSchema(
  schema: Record<string, unknown>,
  task: Parameters<typeof buildAiPrompt>[0],
  input: Parameters<typeof buildAiPrompt>[1],
): Record<string, unknown> {
  const result = structuredClone(schema);
  const props = result.properties as Record<string, Record<string, unknown>>;
  if (task === "selectAchievements") {
    const selection = input as AchievementSelectionInput;
    props.selections.description = `Choose from the ${selection.achievements.length} supplied achievements, with at most 100 selected sources across the resume.`;
    const requirementCount = new Set([
      ...selection.analysis.requiredQualifications,
      ...selection.analysis.responsibilities,
      ...selection.analysis.preferredQualifications,
    ]).size;
    props.requirementCoverage.description = `Return all ${requirementCount} supplied requirements, one entry per requirement, including those with no evidence.`;
    // Rich coverage is calculated by the shared server engine, not duplicated in AI output.
    const item = props.requirementCoverage.items as Record<string, unknown>;
    const itemProps = item.properties as Record<string, unknown>;
    for (const key of ["status", "evidence", "missingComponents", "reason"])
      delete itemProps[key];
    props.skillRecommendations.description = `Recommend relevant skills only from the ${selection.skills.length} supplied skill records.`;
  }
  if (task === "draftResume") {
    props.achievementText.description = `Represent all ${(input as ResumeDraftInput).achievements.length} selected source achievements exactly once. Related sources may share a synthesized bullet.`;
  }
  // Gemini expands nested length constraints into decoder states and rejects large
  // combinations. Removing these constraints permits complete output; Zod still
  // enforces the full safety bounds after generation. Never shrink the item counts.
  const removeDecoderLengths = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(removeDecoderLengths);
      return;
    }
    const node = value as Record<string, unknown>;
    delete node.maxItems;
    delete node.minItems;
    Object.values(node).forEach(removeDecoderLengths);
  };
  removeDecoderLengths(result);
  return result;
}

function ensureKnownIds(returnedIds: string[], allowedIds: Set<string>): void {
  if (
    new Set(returnedIds).size !== returnedIds.length ||
    returnedIds.some((id) => !allowedIds.has(id))
  ) {
    throw new AiProviderError(
      "Gemini returned achievement IDs that were missing or duplicated in the supplied evidence.",
      "INVALID_RESPONSE",
      false,
      "UNKNOWN_OR_DUPLICATE_ACHIEVEMENT_ID",
    );
  }
}

export function createGeminiProvider(
  options: GeminiProviderOptions = {},
): AiProvider {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  const model = options.model ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  const request: GeminiRequest =
    options.request ??
    (async ({ model: requestedModel, prompt, outputSchema }) => {
      if (!apiKey) {
        throw new AiProviderError(
          "Set GEMINI_API_KEY in .env.local to use the Gemini provider.",
          "MISSING_API_KEY",
        );
      }
      const client = new GoogleGenAI({
        apiKey,
        httpOptions: {
          timeout: REQUEST_TIMEOUT_MS,
          retryOptions: { attempts: 1 },
        },
      });
      const response = await client.models.generateContent({
        model: requestedModel,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: outputSchema,
          maxOutputTokens: 8_192,
        },
      });
      emitDiagnostic({
        timestamp: new Date().toISOString(),
        stage: "gemini.usage",
        message: "Provider usage and completion metadata.",
        data: {
          model: requestedModel,
          usage: response.usageMetadata,
          finishReason: response.candidates?.[0]?.finishReason,
        },
      });
      if (response.candidates?.[0]?.finishReason === "MAX_TOKENS") {
        throw new AiProviderError(
          "Gemini output was incomplete; retry with a smaller evidence batch.",
          "INVALID_RESPONSE",
          true,
          "OUTPUT_TRUNCATED",
        );
      }
      return response.text;
    });

  function emitDiagnostic(
    event: Parameters<NonNullable<typeof options.onDiagnostic>>[0],
  ) {
    try {
      options.onDiagnostic?.(event);
    } catch {
      // Diagnostic collection must never break an AI request.
    }
  }

  async function run<T>(
    task: Parameters<typeof buildAiPrompt>[0],
    input: Parameters<typeof buildAiPrompt>[1],
    schema: { parse(value: unknown): T },
    refinement?: string,
  ): Promise<T> {
    if (!apiKey && !options.request) {
      throw new AiProviderError(
        "Set GEMINI_API_KEY in .env.local to use the Gemini provider.",
        "MISSING_API_KEY",
      );
    }
    const built = buildAiPrompt(task, input);
    const { outputSchema } = built;
    const prompt = refinement
      ? `${built.prompt}\n\nServer correction instructions:\n${refinement}`
      : built.prompt;
    if (prompt.length > MAX_PROMPT_CHARACTERS)
      throw new AiProviderError(
        "The correction context exceeds the request size limit.",
        "INPUT_TOO_LARGE",
      );
    const boundedOutputSchema = buildProviderOutputSchema(
      outputSchema,
      task,
      input,
    );
    const models = model === FALLBACK_MODEL ? [model] : [model, FALLBACK_MODEL];
    let lastError: AiProviderError | undefined;
    for (const [index, requestedModel] of models.entries()) {
      emitDiagnostic({
        timestamp: new Date().toISOString(),
        stage: `gemini.${task}.request`,
        message: "Sending structured prompt to Gemini.",
        data: {
          model: requestedModel,
          fallbackAttempt: index > 0,
          prompt,
          outputSchema: boundedOutputSchema,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
        },
      });
      try {
        const responseText = await request({
          model: requestedModel,
          prompt,
          outputSchema: boundedOutputSchema,
        });
        if (!responseText?.trim()) {
          throw new AiProviderError(
            "Gemini returned an empty response. Try again.",
            "INVALID_RESPONSE",
            true,
            "EMPTY_RESPONSE",
          );
        }

        emitDiagnostic({
          timestamp: new Date().toISOString(),
          stage: `gemini.${task}.response`,
          message: "Received Gemini response body.",
          data: { model: requestedModel, responseText },
        });

        let decoded: unknown;
        try {
          decoded = JSON.parse(responseText);
        } catch {
          throw new AiProviderError(
            "Gemini returned invalid JSON. Try again.",
            "INVALID_RESPONSE",
            true,
            "MALFORMED_JSON",
          );
        }
        try {
          const parsed = schema.parse(decoded);
          emitDiagnostic({
            timestamp: new Date().toISOString(),
            stage: `gemini.${task}.validated`,
            message: "Gemini response passed the task response schema.",
            data: parsed,
          });
          return parsed;
        } catch (error) {
          const issuePaths =
            error instanceof z.ZodError
              ? [
                  ...new Set(
                    error.issues.slice(0, 8).map((issue) => {
                      const path = issue.path
                        .map((part) =>
                          typeof part === "number" ? "[]" : String(part),
                        )
                        .join(".");
                      return `${path || "$"}:${issue.code}`;
                    }),
                  ),
                ].join(",")
              : "unknown-schema-error";
          throw new AiProviderError(
            `Gemini returned a response that did not match the required format (${issuePaths}).`,
            "INVALID_RESPONSE",
            true,
            `OUTPUT_SCHEMA_MISMATCH:${issuePaths}`,
          );
        }
      } catch (error) {
        const providerError =
          error instanceof AiProviderError ? error : mapRequestError(error);
        lastError = providerError;
        const status = errorStatus(error);
        const errorName = error instanceof Error ? error.name : "";
        const recoverable =
          providerError.code === "INVALID_RESPONSE" ||
          status === 400 ||
          status === 404 ||
          (status !== undefined && status >= 500) ||
          errorName === "AbortError" ||
          errorName === "TimeoutError";
        if (index === 0 && models.length > 1 && recoverable) {
          emitDiagnostic({
            timestamp: new Date().toISOString(),
            stage: `gemini.${task}.retry`,
            message: "Primary model failed; retrying with fallback model.",
            data: {
              model: requestedModel,
              fallbackModel: FALLBACK_MODEL,
              code: providerError.code,
              diagnosticCode: providerError.diagnosticCode,
              retryable: providerError.retryable,
              httpStatus: status,
            },
          });
          console.warn("Gemini request retrying with fallback model.", {
            task,
            diagnostic: providerError.diagnosticCode ?? providerError.code,
            fallbackModel: FALLBACK_MODEL,
          });
          continue;
        }
        emitDiagnostic({
          timestamp: new Date().toISOString(),
          stage: `gemini.${task}.error`,
          message: providerError.message,
          data: {
            model: requestedModel,
            code: providerError.code,
            diagnosticCode: providerError.diagnosticCode,
            retryable: providerError.retryable,
            httpStatus: status,
          },
        });
        throw providerError;
      }
    }
    throw (
      lastError ??
      new AiProviderError(
        "Gemini could not complete the request. Try again.",
        "REQUEST_FAILED",
        true,
      )
    );
  }

  return {
    name: "gemini",
    analyzeJobDescription(input: JobAnalysisInput): Promise<JobAnalysisResult> {
      JobAnalysisInputSchema.parse(input);
      return run("analyzeJobDescription", input, JobAnalysisResultSchema);
    },
    async selectAchievements(
      input: AchievementSelectionInput,
    ): Promise<AchievementSelectionResult> {
      AchievementSelectionInputSchema.parse(input);
      const result = await run(
        "selectAchievements",
        input,
        AchievementSelectionResultSchema,
      );
      const achievementById = new Map(
        input.achievements.map((achievement) => [achievement.id, achievement]),
      );
      ensureKnownIds(
        result.selections.map((selection) => selection.achievementId),
        new Set(achievementById.keys()),
      );
      if (
        result.selections.some(
          (selection) =>
            achievementById.get(selection.achievementId)?.section !==
            selection.section,
        )
      ) {
        throw new AiProviderError(
          "Gemini assigned an achievement to the wrong resume section.",
          "INVALID_RESPONSE",
          false,
          "ACHIEVEMENT_SECTION_MISMATCH",
        );
      }
      const selectedIds = new Set(
        result.selections.map((selection) => selection.achievementId),
      );
      const skillById = new Map(input.skills.map((skill) => [skill.id, skill]));
      const seenSkillIds = new Set<string>();
      const skillRecommendations = result.skillRecommendations.flatMap(
        (recommendation) => {
          const skill = skillById.get(recommendation.skillId);
          if (!skill || seenSkillIds.has(skill.id)) return [];

          const supportingAchievementIds = [
            ...new Set(
              recommendation.supportingAchievementIds.filter(
                (id) =>
                  selectedIds.has(id) &&
                  skill.evidenceAchievementIds.includes(id),
              ),
            ),
          ];
          if (supportingAchievementIds.length === 0) return [];

          seenSkillIds.add(skill.id);
          return [{ ...recommendation, supportingAchievementIds }];
        },
      );

      return {
        ...result,
        skillRecommendations,
      };
    },
    async draftResume(input: ResumeDraftInput): Promise<ResumeDraftResult> {
      ResumeDraftInputSchema.parse(input);
      let result = await run("draftResume", input, ResumeDraftResultSchema);
      const allowedIds = new Set(
        input.achievements.map((achievement) => achievement.id),
      );
      const validateIds = (draft: ResumeDraftResult) =>
        ensureKnownIds(
          draft.achievementText.map((item) => item.achievementId),
          allowedIds,
        );
      validateIds(result);
      const missingTargets = (draft: ResumeDraftResult) =>
        supportedTerminologyTargets(input).flatMap((target) => {
          const text = draft.achievementText
            .filter((item) =>
              (item.sourceAchievementIds ?? [item.achievementId]).includes(
                target.achievementId,
              ),
            )
            .map((item) => item.text)
            .join(" ");
          const terms = target.terms.filter(
            (term) => !includesPhrase(text, term),
          );
          return terms.length
            ? [{ achievementId: target.achievementId, terms }]
            : [];
        });
      const missing = missingTargets(result);
      if (missing.length) {
        const refinement = `The previous draft omitted these directly supported JD phrases: ${JSON.stringify(missing)}. Return the complete corrected draft, placing every listed full phrase naturally inside the corresponding source bullet. Preserve all source detail and metrics. Do not substitute only a related implementation name for the requested phrase. This is one correction attempt, not permission to add unsupported claims.`;
        if (
          buildAiPrompt("draftResume", input).prompt.length +
            refinement.length +
            40 <=
          MAX_PROMPT_CHARACTERS
        ) {
          emitDiagnostic({
            timestamp: new Date().toISOString(),
            stage: "gemini.draftResume.quality-correction",
            message: "Correcting omitted supported JD terminology once.",
            data: { missing },
          });
          try {
            const corrected = await run(
              "draftResume",
              input,
              ResumeDraftResultSchema,
              refinement,
            );
            validateIds(corrected);
            const missingCount = (items: ReturnType<typeof missingTargets>) =>
              items.reduce((sum, item) => sum + item.terms.length, 0);
            if (missingCount(missingTargets(corrected)) < missingCount(missing))
              result = corrected;
          } catch (error) {
            if (!(error instanceof AiProviderError)) throw error;
            emitDiagnostic({
              timestamp: new Date().toISOString(),
              stage: "gemini.draftResume.quality-correction-unavailable",
              message:
                "Kept the validated initial draft after the bounded correction failed.",
              data: { code: error.code, diagnosticCode: error.diagnosticCode },
            });
          }
        }
      }
      return result;
    },
    async repairLatexContent(
      input: LatexRepairInput,
    ): Promise<LatexRepairResult> {
      LatexRepairInputSchema.parse(input);
      const result = await run(
        "repairLatexContent",
        input,
        LatexRepairResultSchema,
      );
      ensureKnownIds(
        result.achievementText.map((item) => item.achievementId),
        new Set(
          input.currentContent.achievementText.map(
            (item) => item.achievementId,
          ),
        ),
      );
      return result;
    },
  };
}
