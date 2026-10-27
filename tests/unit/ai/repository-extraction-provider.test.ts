import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { createGeminiProvider } from "../../../src/lib/ai/gemini-provider-core";
import { repositoryExtractionOutputSchema } from "../../../src/lib/ai/repository-extraction";

describe("worker-safe repository extraction provider", () => {
  it("requests one schema-constrained response and returns actual provider metadata", async () => {
    const request = vi.fn(
      async (_input: {
        model: string;
        prompt: string;
        outputSchema: Record<string, unknown>;
        signal?: AbortSignal;
        maxOutputTokens?: number;
        allowTruncated?: boolean;
      }) => ({
        text: JSON.stringify({
          projectSummary: "A concise summary.",
          claims: [],
          drafts: [],
          questionSuggestions: [],
          limitations: [],
        }),
        model: "gemini-exact-response-model",
        finishReason: "STOP",
        usage: {
          promptTokens: 210,
          cachedTokens: 40,
          outputTokens: 58,
          reasoningTokens: 12,
          totalTokens: 280,
        },
      }),
    );
    const provider = createGeminiProvider({
      apiKey: "test-key",
      model: "configured-model",
      request,
    });
    const controller = new AbortController();
    const outputSchema = repositoryExtractionOutputSchema();

    const response = await provider.extractRepositoryAchievements({
      prompt: "fixed extraction prompt",
      outputSchema,
      signal: controller.signal,
      maxOutputTokens: 6_144,
    });

    expect(response).toMatchObject({
      model: "gemini-exact-response-model",
      finishReason: "STOP",
      usage: {
        promptTokens: 210,
        cachedTokens: 40,
        outputTokens: 58,
        reasoningTokens: 12,
        totalTokens: 280,
      },
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toMatchObject({
      model: "configured-model",
      prompt: "fixed extraction prompt",
      signal: controller.signal,
      maxOutputTokens: 6_144,
      allowTruncated: true,
    });
    expect(request.mock.calls[0][0].outputSchema).toMatchObject({
      type: "object",
      required: [
        "projectSummary",
        "claims",
        "drafts",
        "questionSuggestions",
        "limitations",
      ],
    });
    expect(JSON.stringify(request.mock.calls[0][0].outputSchema)).not.toMatch(
      /"(?:maxItems|minItems)"/,
    );
  });

  it("returns truncation metadata to the extractor without invoking a model fallback", async () => {
    const request = vi.fn(
      async (_input: {
        model: string;
        prompt: string;
        outputSchema: Record<string, unknown>;
        signal?: AbortSignal;
        maxOutputTokens?: number;
        allowTruncated?: boolean;
      }) => ({
        text: "{",
        model: "gemini-exact-response-model",
        finishReason: "MAX_TOKENS",
        usage: {
          promptTokens: 5_000,
          cachedTokens: null,
          outputTokens: 6_144,
          reasoningTokens: null,
          totalTokens: null,
        },
      }),
    );
    const provider = createGeminiProvider({ apiKey: "test-key", request });

    const response = await provider.extractRepositoryAchievements({
      prompt: "bounded prompt",
      outputSchema: repositoryExtractionOutputSchema(),
    });

    expect(response.finishReason).toBe("MAX_TOKENS");
    expect(response.usage.totalTokens).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("imports the provider factory in a plain Node process without the Next server-only sentinel", () => {
    const script = [
      'import { createAiProvider } from "./src/lib/ai/provider-factory-core.ts";',
      'const provider = createAiProvider({ AI_PROVIDER: "mock" });',
      'if (provider.name !== "mock" || typeof provider.extractRepositoryAchievements !== "function") process.exit(2);',
    ].join(" ");
    const child = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    expect(child.status, `${child.stdout}\n${child.stderr}`).toBe(0);
    expect(child.stderr).not.toContain("server-only");
  }, 60_000);
});
