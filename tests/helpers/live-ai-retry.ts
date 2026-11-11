import { setTimeout } from "node:timers/promises";
import { AiProviderError } from "../../src/lib/ai/provider";

export const LIVE_AI_RETRY_DELAY_MS = 20_000;

/** Retry only an upstream outage, once. Assertions and quota failures still fail. */
export async function withLiveAiRetry<T>(
  request: () => Promise<T>,
  sleep: (milliseconds: number) => Promise<unknown> = setTimeout,
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (
      !(error instanceof AiProviderError) ||
      !error.retryable ||
      !["SERVICE_UNAVAILABLE", "REQUEST_TIMEOUT"].includes(error.code)
    ) {
      throw error;
    }
    console.warn(`Live Gemini check retrying after ${error.code}.`);
    await sleep(LIVE_AI_RETRY_DELAY_MS);
    return request();
  }
}
