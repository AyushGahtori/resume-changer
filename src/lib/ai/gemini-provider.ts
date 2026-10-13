import "server-only";
import { GoogleGenAI } from "@google/genai";
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
    );
  }
  if (status === 401 || status === 403) {
    return new AiProviderError(
      "Gemini rejected the API key or its permissions.",
      "AUTHENTICATION_FAILED",
    );
  }
  if (status === 429) {
    return new AiProviderError(
      "Gemini's free-tier request limit was reached. Wait and try again.",
      "RATE_LIMITED",
      true,
    );
  }
  if (status !== undefined && status >= 500) {
    return new AiProviderError(
      "Gemini is temporarily unavailable. Try again shortly.",
      "SERVICE_UNAVAILABLE",
      true,
    );
  }
  return new AiProviderError(
    "The Gemini request failed. Check your connection and try again.",
    "REQUEST_FAILED",
    status === undefined || status >= 500,
  );
}

function ensureKnownIds(returnedIds: string[], allowedIds: Set<string>): void {
  if (
    new Set(returnedIds).size !== returnedIds.length ||
    returnedIds.some((id) => !allowedIds.has(id))
  ) {
    throw new AiProviderError(
      "Gemini returned achievement IDs that were missing or duplicated in the supplied evidence.",
      "INVALID_RESPONSE",
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
    let responseText: string | undefined;
    try {
      responseText = await request({ model, prompt, outputSchema });
    } catch (error) {
      throw mapRequestError(error);
    }
    if (!responseText?.trim()) {
      throw new AiProviderError(
        "Gemini returned an empty response. Try again.",
        "INVALID_RESPONSE",
        true,
      );
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(responseText);
      return schema.parse(decoded);
    } catch {
      throw new AiProviderError(
        "Gemini returned a response that did not match the required format.",
        "INVALID_RESPONSE",
        true,
      );
    }
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
      ensureKnownIds(
        result.selections.map((selection) => selection.achievementId),
        new Set(input.achievements.map((achievement) => achievement.id)),
      );
      return result;
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
