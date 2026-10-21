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
import {
  AchievementWritingInputSchema,
  AchievementWritingResultSchema,
} from "./achievement-writing";

export const DEFAULT_MODEL = "gemini-3.6-flash";
// The free tier applies its daily request cap per model, so every fallback
// here is a different model with its own budget. The aliases track the
// current stable releases, which keeps the chain serving as older models
// age out of the free tier.
export const FALLBACK_MODEL = "gemini-flash-lite-latest";
export const LAST_RESORT_MODEL = "gemini-flash-latest";
// The free tier serves requests on models that are noticeably slower than
// the paid tier, and the latency varies a lot: the same draft request was
// measured at 12 seconds and at over 120 seconds on the same model and the
// same day. The budget is therefore generous, because a request that is cut
// short cannot be retried for the same quota cost. The timeout is sent to
// the server as a deadline, and a request that runs past it comes back as
// HTTP 504 rather than a client-side abort.
export const REQUEST_TIMEOUT_MS = 240_000;
// The model occasionally returns a duplicated or unknown achievement ID. That
// is a recoverable generation mistake, so the same model is asked again a
// bounded number of times before the request moves on to the fallback model.
const MAX_MODEL_ATTEMPTS = 2;
// Gemini reports two different rate limits. A short burst window clears in
// seconds, so waiting it out on the same model is worthwhile. The free-tier
// daily limit does not clear for hours, so that case moves to another model
// instead of blocking the request.
const MAX_RATE_LIMIT_WAIT_MS = 60_000;
const RATE_LIMIT_BACKOFF_MS = 2_000;
const DAILY_QUOTA_DIAGNOSTIC = "HTTP_429_DAILY_QUOTA";
// A transient upstream failure is worth one more attempt on the same model
// before the request gives up on it. A slow free-tier model that times out
// often answers on the second try, and a retry costs one request against
// the daily budget rather than a whole model.
const TRANSIENT_RETRY_BACKOFF_MS = 2_000;
// A request walks up to three models and retries a few times. The per
// request budget is generous because the free tier is slow, so without a
// total budget a full walk could outlast the caller that is waiting for it.
const TOTAL_REQUEST_BUDGET_MS = 600_000;

/**
 * A response that parsed cleanly but broke the evidence-grounding contract,
 * for example by selecting an achievement twice or naming an achievement that
 * was never supplied. These failures are recoverable by regenerating, so they
 * are retried on the same model before the request falls back.
 */
class GroundingViolationError extends AiProviderError {
  constructor(message: string, diagnosticCode: string) {
    super(message, "INVALID_RESPONSE", true, diagnosticCode);
    this.name = "GroundingViolationError";
  }
}

type GeminiRequest = (request: {
  model: string;
  prompt: string;
  outputSchema: Record<string, unknown>;
}) => Promise<string | undefined>;

type GeminiProviderOptions = {
  apiKey?: string;
  model?: string;
  request?: GeminiRequest;
  /**
   * How long a single request may take. The default leaves room for the
   * slow free-tier models; a caller that knows it is on a fast model can
   * shorten it.
   */
  requestTimeoutMs?: number;
  /**
   * Waits out a rate limit that is expected to clear shortly. Injectable so
   * tests never wait in real time.
   */
  sleep?: (milliseconds: number) => Promise<void>;
};

const GEMINI_SCHEMA_KEYS = new Set([
  "$id",
  "$defs",
  "$ref",
  "$anchor",
  "type",
  "format",
  "title",
  "description",
  "enum",
  "items",
  "prefixItems",
  "minimum",
  "maximum",
  "anyOf",
  "oneOf",
  "properties",
  "additionalProperties",
  "required",
  "propertyOrdering",
]);

function sanitizeGeminiSchema(value: unknown, propertyMap = false): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => sanitizeGeminiSchema(item));
    return;
  }
  const schema = value as Record<string, unknown>;
  if (propertyMap) {
    Object.values(schema).forEach((child) => sanitizeGeminiSchema(child));
    return;
  }
  for (const [key, child] of Object.entries(schema)) {
    if (
      !GEMINI_SCHEMA_KEYS.has(key) ||
      key === "minItems" ||
      key === "maxItems"
    ) {
      delete schema[key];
      continue;
    }
    sanitizeGeminiSchema(child, key === "properties" || key === "$defs");
  }
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value =
    (error as { status?: unknown; statusCode?: unknown }).status ??
    (error as { statusCode?: unknown }).statusCode;
  return typeof value === "number" ? value : undefined;
}

/**
 * The upstream rate-limit response describes the limit that was hit: the
 * quota name and how long the caller should wait. The SDK surfaces the raw
 * response body as the error message, so both facts are read from there.
 */
type RateLimitDetails = {
  dailyQuota: boolean;
  retryAfterSeconds?: number;
};

function readRateLimitDetails(message: string): RateLimitDetails {
  const dailyQuota = /GenerateRequestsPerDayPerProjectPerModel/i.test(message);
  try {
    const body = JSON.parse(message) as {
      error?: { details?: Record<string, unknown>[] };
    };
    const details = body.error?.details ?? [];
    let retryAfterSeconds: number | undefined;
    for (const detail of details) {
      if (!String(detail["@type"] ?? "").includes("RetryInfo")) continue;
      const raw = detail.retryDelay;
      const seconds =
        typeof raw === "number"
          ? raw
          : typeof raw === "string"
            ? Number.parseFloat(raw.replace(/s$/, ""))
            : Number.NaN;
      if (Number.isFinite(seconds)) retryAfterSeconds = seconds;
    }
    return { dailyQuota, retryAfterSeconds };
  } catch {
    return { dailyQuota };
  }
}

/**
 * Reads a request budget from the environment. A value that is not a
 * positive number is ignored, so a typo falls back to the default instead
 * of disabling the request budget.
 */
function parseRequestTimeout(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function mapRequestError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  const status = errorStatus(error);
  const name = error instanceof Error ? error.name : "";
  const detail = error instanceof Error ? error.message : "";

  // The SDK reports a client-side timeout as "RequestTimeoutError" and an
  // aborted request as "RequestAbortedError". A native abort or timeout
  // from the runtime is named "AbortError" or "TimeoutError".
  if (
    name === "AbortError" ||
    name === "TimeoutError" ||
    name === "RequestTimeoutError" ||
    name === "RequestAbortedError"
  ) {
    return new AiProviderError(
      "Gemini did not respond before the request timed out. Try again.",
      "REQUEST_TIMEOUT",
      true,
      "REQUEST_TIMEOUT",
    );
  }
  // The request timeout is sent to the upstream as a deadline, so a request
  // that runs past it comes back as HTTP 504 rather than as a client-side
  // abort. It is the same condition and gets the same treatment.
  if (status === 504 && /DEADLINE_EXCEEDED/i.test(detail)) {
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
    // The free tier caps requests per model per day, and that cap does not
    // clear on its own. A shorter burst window does, so the upstream delay
    // decides whether waiting is worthwhile.
    const { dailyQuota, retryAfterSeconds } = readRateLimitDetails(detail);
    return new AiProviderError(
      dailyQuota
        ? "Gemini's free-tier request limit was reached. Wait and try again."
        : "Gemini's request rate was too high. Try again shortly.",
      "RATE_LIMITED",
      true,
      dailyQuota ? DAILY_QUOTA_DIAGNOSTIC : "HTTP_429",
      retryAfterSeconds,
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
    props.skillRecommendations.description +=
      " Use each skill's exact id. Skills may be recommended based on JD relevance even when they have no linked achievement; the supplied skill library represents user-recorded skills. Do not invent skills outside the supplied list.";
    props.summary.description =
      "Summarize selection and important JD alignment details in up to 2,000 characters. Do not omit material context just to make the summary unusually short.";
  }
  if (task === "draftResume") {
    props.achievementText.description = `Represent all ${(input as ResumeDraftInput).achievements.length} selected source achievements exactly once. Related sources may share a synthesized bullet.`;
  }
  // Send only Gemini-supported JSON Schema keywords. Full limits, patterns,
  // and ID membership are validated or normalized after generation by Zod.
  sanitizeGeminiSchema(result);
  return result;
}

function normalizeSelectionSupplements(
  input: AchievementSelectionInput,
  decoded: unknown,
): unknown {
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
    return decoded;

  const result = { ...(decoded as Record<string, unknown>) };

  const selectedIds = new Set(
    Array.isArray(result.selections)
      ? result.selections.flatMap((selection) =>
          selection &&
          typeof selection === "object" &&
          "achievementId" in selection &&
          typeof selection.achievementId === "string"
            ? [selection.achievementId]
            : [],
        )
      : [],
  );
  const canonicalLabel = (value: string) =>
    value
      .trim()
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, " ");

  result.skillRecommendations = Array.isArray(result.skillRecommendations)
    ? result.skillRecommendations
        .flatMap((recommendation) => {
          if (
            !recommendation ||
            typeof recommendation !== "object" ||
            !("skillId" in recommendation) ||
            typeof recommendation.skillId !== "string"
          )
            return [];

          const skill =
            input.skills.find(({ id }) => id === recommendation.skillId) ??
            input.skills.find((item) => {
              const returned = canonicalLabel(recommendation.skillId as string);
              return [item.name, ...item.aliases].some(
                (label) => canonicalLabel(label) === returned,
              );
            });
          if (!skill) return [];

          const rationale =
            "rationale" in recommendation &&
            typeof recommendation.rationale === "string"
              ? recommendation.rationale.trim()
              : "";
          if (!rationale) return [];

          const rawSupportingIds =
            "supportingAchievementIds" in recommendation &&
            Array.isArray(recommendation.supportingAchievementIds)
              ? recommendation.supportingAchievementIds
              : [];
          const supportingAchievementIds = [
            ...new Set(
              rawSupportingIds.filter(
                (id: unknown): id is string =>
                  typeof id === "string" &&
                  selectedIds.has(id) &&
                  skill.evidenceAchievementIds.includes(id),
              ),
            ),
          ];
          return [
            {
              ...recommendation,
              skillId: skill.id,
              rationale,
              supportingAchievementIds,
            },
          ];
        })
        .slice(0, 200)
    : [];

  return result;
}

function ensureKnownIds(returnedIds: string[], allowedIds: Set<string>): void {
  if (
    new Set(returnedIds).size !== returnedIds.length ||
    returnedIds.some((id) => !allowedIds.has(id))
  ) {
    throw new GroundingViolationError(
      "Gemini returned achievement IDs that were missing or duplicated in the supplied evidence.",
      "UNKNOWN_OR_DUPLICATE_ACHIEVEMENT_ID",
    );
  }
}

export function createGeminiProvider(
  options: GeminiProviderOptions = {},
): AiProvider {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  const model = options.model ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  const requestTimeoutMs =
    options.requestTimeoutMs ??
    parseRequestTimeout(process.env.GEMINI_REQUEST_TIMEOUT_MS) ??
    REQUEST_TIMEOUT_MS;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds);
      }));
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
          timeout: requestTimeoutMs,
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

  async function run<T>(
    task: Parameters<typeof buildAiPrompt>[0],
    input: Parameters<typeof buildAiPrompt>[1],
    schema: { parse(value: unknown): T },
    refinement?: string,
    validate?: (result: T) => void,
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
    // The free tier caps requests per model per day, so each fallback has its
    // own budget. A configured model that is already one of the fallbacks
    // still keeps a distinct last-resort model ahead of giving up.
    const models = [...new Set([model, FALLBACK_MODEL, LAST_RESORT_MODEL])];
    const startedAt = Date.now();
    let lastError: AiProviderError | undefined;

    const parseResponse = (
      responseText: string | undefined,
      task: Parameters<typeof buildAiPrompt>[0],
      input: Parameters<typeof buildAiPrompt>[1],
    ): T => {
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
        const normalized =
          task === "selectAchievements"
            ? normalizeSelectionSupplements(
                input as AchievementSelectionInput,
                decoded,
              )
            : decoded;
        return schema.parse(normalized);
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
          "Gemini returned an incomplete or inconsistent response. Try again.",
          "INVALID_RESPONSE",
          true,
          `OUTPUT_SCHEMA_MISMATCH:${issuePaths}`,
        );
      }
    };

    modelLoop: for (const [index, requestedModel] of models.entries()) {
      for (let attempt = 1; attempt <= MAX_MODEL_ATTEMPTS; attempt += 1) {
        try {
          const responseText = await request({
            model: requestedModel,
            prompt,
            outputSchema: boundedOutputSchema,
          });
          const parsed = parseResponse(responseText, task, input);
          // Evidence-grounding checks run after the response parses, and their
          // failures stay distinguishable from schema mismatches so the loop
          // can retry them on the same model.
          try {
            validate?.(parsed);
          } catch (error) {
            if (error instanceof AiProviderError) throw error;
            throw new GroundingViolationError(
              "Gemini returned evidence that did not match the supplied sources.",
              "UNKNOWN_OR_DUPLICATE_ACHIEVEMENT_ID",
            );
          }
          return parsed;
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
          // The total budget bounds the whole walk. Once it is spent the
          // request stops rather than starting another attempt that would
          // outlast the caller waiting for it.
          const budgetSpent = Date.now() - startedAt >= TOTAL_REQUEST_BUDGET_MS;
          // A grounding violation means the model produced a well-formed but
          // unusable answer, so the same model is asked again before the
          // request falls back to a different one.
          const groundingViolation =
            providerError instanceof GroundingViolationError;
          if (
            groundingViolation &&
            attempt < MAX_MODEL_ATTEMPTS &&
            !budgetSpent
          ) {
            console.warn("Gemini request retrying the same model.", {
              task,
              attempt,
              maxAttempts: MAX_MODEL_ATTEMPTS,
              diagnostic: providerError.diagnosticCode ?? providerError.code,
            });
            continue;
          }
          // A timeout or a transient server failure says nothing about the
          // request itself. The same model is asked again first, because a
          // slow free-tier model that timed out often answers on the next
          // try, and moving on would spend another model's daily budget
          // for a failure this model could have recovered from.
          const transient =
            providerError.code === "REQUEST_TIMEOUT" ||
            providerError.code === "SERVICE_UNAVAILABLE";
          if (transient && attempt < MAX_MODEL_ATTEMPTS && !budgetSpent) {
            console.warn("Gemini request retrying the same model.", {
              task,
              attempt,
              maxAttempts: MAX_MODEL_ATTEMPTS,
              model: requestedModel,
              diagnostic: providerError.diagnosticCode ?? providerError.code,
            });
            await sleep(TRANSIENT_RETRY_BACKOFF_MS * attempt);
            continue;
          }
          // A rate limit is never a fault in the request, so the same model
          // is asked again. A short burst window clears on its own; the daily
          // free-tier cap does not, so that case moves to a model with its
          // own budget instead of waiting for hours.
          if (providerError.code === "RATE_LIMITED") {
            const dailyQuota =
              providerError.diagnosticCode === DAILY_QUOTA_DIAGNOSTIC;
            const upstreamDelayMs =
              (providerError.retryAfterSeconds ?? 0) * 1_000;
            const waitMs = upstreamDelayMs || RATE_LIMIT_BACKOFF_MS * attempt;
            if (!dailyQuota && waitMs <= MAX_RATE_LIMIT_WAIT_MS) {
              console.warn("Gemini request waiting out a rate limit.", {
                task,
                attempt,
                model: requestedModel,
                waitMs,
                diagnostic: providerError.diagnosticCode,
              });
              await sleep(waitMs);
              continue;
            }
            if (index < models.length - 1 && !budgetSpent) {
              console.warn("Gemini request moving to another model.", {
                task,
                model: requestedModel,
                nextModel: models[index + 1],
                diagnostic: providerError.diagnosticCode ?? providerError.code,
              });
              continue modelLoop;
            }
            throw providerError;
          }
          if (index < models.length - 1 && recoverable && !budgetSpent) {
            console.warn("Gemini request retrying with fallback model.", {
              task,
              diagnostic: providerError.diagnosticCode ?? providerError.code,
              fallbackModel: models[index + 1],
            });
            continue modelLoop;
          }
          throw providerError;
        }
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
    async writeAchievement(operation, input) {
      AchievementWritingInputSchema.parse(input);
      const task = {
        edit: "achievementEdit",
        merge: "achievementMerge",
        create: "achievementCreate",
      } as const;
      return run(task[operation], input, AchievementWritingResultSchema);
    },
    analyzeJobDescription(input: JobAnalysisInput): Promise<JobAnalysisResult> {
      JobAnalysisInputSchema.parse(input);
      return run("analyzeJobDescription", input, JobAnalysisResultSchema);
    },
    async selectAchievements(
      input: AchievementSelectionInput,
    ): Promise<AchievementSelectionResult> {
      AchievementSelectionInputSchema.parse(input);
      const achievementById = new Map(
        input.achievements.map((achievement) => [achievement.id, achievement]),
      );
      const allowedIds = new Set(achievementById.keys());
      const result = await run(
        "selectAchievements",
        input,
        AchievementSelectionResultSchema,
        undefined,
        (selection) => {
          ensureKnownIds(
            selection.selections.map((item) => item.achievementId),
            allowedIds,
          );
          if (
            selection.selections.some(
              (item) =>
                achievementById.get(item.achievementId)?.section !==
                item.section,
            )
          ) {
            throw new GroundingViolationError(
              "Gemini assigned an achievement to the wrong resume section.",
              "ACHIEVEMENT_SECTION_MISMATCH",
            );
          }
        },
      );
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
      const allowedIds = new Set(
        input.achievements.map((achievement) => achievement.id),
      );
      const validateIds = (draft: ResumeDraftResult) =>
        ensureKnownIds(
          draft.achievementText.map((item) => item.achievementId),
          allowedIds,
        );
      let result = await run(
        "draftResume",
        input,
        ResumeDraftResultSchema,
        undefined,
        validateIds,
      );
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
          try {
            const corrected = await run(
              "draftResume",
              input,
              ResumeDraftResultSchema,
              refinement,
              validateIds,
            );
            const missingCount = (items: ReturnType<typeof missingTargets>) =>
              items.reduce((sum, item) => sum + item.terms.length, 0);
            if (missingCount(missingTargets(corrected)) < missingCount(missing))
              result = corrected;
          } catch (error) {
            if (!(error instanceof AiProviderError)) throw error;
            // The correction request failed, so the draft on hand is still
            // missing a JD phrase the source supports. The draft is kept
            // because it is valid and grounded, and the response builder
            // discloses the omitted phrase in the quality notes. The failure
            // is logged rather than swallowed, so a correction that never
            // lands is visible instead of silent.
            console.warn("Gemini draft correction could not be completed.", {
              task: "draftResume",
              missing,
              diagnostic: error.diagnosticCode ?? error.code,
              retryable: error.retryable,
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
      const allowedIds = new Set(
        input.currentContent.achievementText.map((item) => item.achievementId),
      );
      return run(
        "repairLatexContent",
        input,
        LatexRepairResultSchema,
        undefined,
        (repair) =>
          ensureKnownIds(
            repair.achievementText.map((item) => item.achievementId),
            allowedIds,
          ),
      );
    },
  };
}
