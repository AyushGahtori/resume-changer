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
import { buildAiPrompt } from "./prompt-builder";
import { AiProviderError, type AiProvider } from "./provider";

const DEFAULT_MODEL = "gemini-3.6-flash";
const FALLBACK_MODEL = "gemini-2.5-flash-lite";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_GENERATED_ARRAY_ITEMS = 20;
const MAX_NESTED_ARRAY_ITEMS = 4;
const MAX_ARRAYS_WITH_NESTED_VALUES = 6;

type GeminiRequest = (request: {
  model: string;
  prompt: string;
  outputSchema: Record<string, unknown>;
}) => Promise<string | undefined>;

type GeminiProviderOptions = {
  apiKey?: string;
  model?: string;
  request?: GeminiRequest;
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

function containsArray(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsArray);
  if (!value || typeof value !== "object") return false;

  const schema = value as Record<string, unknown>;
  if (schema.type === "array") return true;
  return Object.values(schema).some(containsArray);
}

function boundSchemaArrays(value: unknown, nesting = 0): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => boundSchemaArrays(item, nesting));
  }
  if (!value || typeof value !== "object") return value;

  const isArray = (value as Record<string, unknown>).type === "array";
  const childNesting = nesting + Number(isArray);
  const schema = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      boundSchemaArrays(child, childNesting),
    ]),
  );
  if (schema.type === "array" && typeof schema.maxItems === "number") {
    const maxItems =
      nesting > 0
        ? MAX_NESTED_ARRAY_ITEMS
        : containsArray(schema.items)
          ? MAX_ARRAYS_WITH_NESTED_VALUES
          : MAX_GENERATED_ARRAY_ITEMS;
    schema.maxItems = Math.min(schema.maxItems, maxItems);
  }
  return schema;
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
          maxOutputTokens: 4_096,
        },
      });
      return response.text;
    });

  async function run<T>(
    task: Parameters<typeof buildAiPrompt>[0],
    input: Parameters<typeof buildAiPrompt>[1],
    schema: { parse(value: unknown): T },
  ): Promise<T> {
    if (!apiKey && !options.request) {
      throw new AiProviderError(
        "Set GEMINI_API_KEY in .env.local to use the Gemini provider.",
        "MISSING_API_KEY",
      );
    }
    const { prompt, outputSchema } = buildAiPrompt(task, input);
    const boundedOutputSchema = boundSchemaArrays(outputSchema) as Record<
      string,
      unknown
    >;
    const models = model === FALLBACK_MODEL ? [model] : [model, FALLBACK_MODEL];
    let lastError: AiProviderError | undefined;
    for (const [index, requestedModel] of models.entries()) {
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
          return schema.parse(decoded);
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
            "Gemini returned a response that did not match the required format.",
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
          console.warn("Gemini request retrying with fallback model.", {
            task,
            diagnostic: providerError.diagnosticCode ?? providerError.code,
            fallbackModel: FALLBACK_MODEL,
          });
          continue;
        }
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
      const result = await run("draftResume", input, ResumeDraftResultSchema);
      ensureKnownIds(
        result.achievementText.map((item) => item.achievementId),
        new Set(input.achievements.map((achievement) => achievement.id)),
      );
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
