import "server-only";
import { AiProviderError } from "./provider";
import { createGeminiProvider, parseRequestTimeout } from "./gemini-provider";
import { mockAiProvider } from "./mock-provider";
import type { AiProvider } from "./provider";

export type AiProviderEnvironment = {
  AI_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_REQUEST_TIMEOUT_MS?: string;
};

export function createAiProvider(
  environment: AiProviderEnvironment = {
    AI_PROVIDER: process.env.AI_PROVIDER,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    GEMINI_REQUEST_TIMEOUT_MS: process.env.GEMINI_REQUEST_TIMEOUT_MS,
  },
): AiProvider {
  const selectedProvider = environment.AI_PROVIDER ?? "gemini";
  if (selectedProvider === "mock") return mockAiProvider;
  if (selectedProvider !== "gemini") {
    throw new AiProviderError(
      `Unsupported AI_PROVIDER value: ${selectedProvider}. Use "gemini" or "mock".`,
      "REQUEST_FAILED",
    );
  }
  if (!environment.GEMINI_API_KEY?.trim()) {
    throw new AiProviderError(
      "Set GEMINI_API_KEY in .env.local or choose AI_PROVIDER=mock.",
      "MISSING_API_KEY",
    );
  }
  return createGeminiProvider({
    apiKey: environment.GEMINI_API_KEY,
    model: environment.GEMINI_MODEL,
    requestTimeoutMs: parseRequestTimeout(
      environment.GEMINI_REQUEST_TIMEOUT_MS,
    ),
  });
}
