import { describe, expect, it, vi } from "vitest";
import { AiProviderError } from "../../../src/lib/ai/provider";
import {
  LIVE_AI_RETRY_DELAY_MS,
  withLiveAiRetry,
} from "../../helpers/live-ai-retry";

describe("live AI outage retry", () => {
  it("does not repeat a successful request", async () => {
    const request = vi.fn().mockResolvedValue({ real: true });
    const sleep = vi.fn();
    await expect(withLiveAiRetry(request, sleep)).resolves.toEqual({
      real: true,
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
  it.each(["SERVICE_UNAVAILABLE", "REQUEST_TIMEOUT"] as const)(
    "retries %s once after a delay and returns the real response",
    async (code) => {
      const request = vi
        .fn()
        .mockRejectedValueOnce(new AiProviderError("outage", code, true))
        .mockResolvedValueOnce({ real: true });
      const sleep = vi.fn().mockResolvedValue(undefined);
      await expect(withLiveAiRetry(request, sleep)).resolves.toEqual({
        real: true,
      });
      expect(request).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledExactlyOnceWith(LIVE_AI_RETRY_DELAY_MS);
    },
  );
  it("fails when the upstream stays unavailable", async () => {
    const error = new AiProviderError("outage", "SERVICE_UNAVAILABLE", true);
    const request = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(withLiveAiRetry(request, sleep)).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
  it.each([
    new Error("assertion failed"),
    new AiProviderError(
      "daily quota",
      "RATE_LIMITED",
      true,
      "HTTP_429_DAILY_QUOTA",
    ),
    new AiProviderError("invalid result", "INVALID_RESPONSE", true),
    new AiProviderError("invalid key", "AUTHENTICATION_FAILED"),
    new AiProviderError("permanent failure", "SERVICE_UNAVAILABLE", false),
  ])("does not retry a non-transient error: %s", async (error) => {
    const request = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn();
    await expect(withLiveAiRetry(request, sleep)).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
