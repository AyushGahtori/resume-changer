import { describe, expect, it, vi } from "vitest";
import { createMultimodalScreenshotAdapter } from "../../../../src/lib/github/context-screenshots/provider";
import { sha256Hex } from "../../../../src/lib/github/context-screenshots/crypto";
import type { ValidatedScreenshotRequest } from "../../../../src/lib/github/context-screenshots/contracts";

async function request(): Promise<ValidatedScreenshotRequest> {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const digest = await sha256Hex(bytes);
  if (!digest.ok) throw new Error(digest.error.message);
  return {
    version: "context-screenshots-v1",
    capsule: "encrypted-capsule",
    consentHash: "approved-hash",
    requestBytes: 1234,
    screenshots: [
      {
        id: "image-1",
        mediaType: "image/png",
        width: 1,
        height: 1,
        byteLength: bytes.byteLength,
        sha256: digest.value,
        bytes,
      },
    ],
  };
}

describe("bounded multimodal provider adapter", () => {
  it("returns an explicit unsupported-image result without invoking a text-only model", async () => {
    const generate = vi.fn();
    const adapter = createMultimodalScreenshotAdapter({
      modelId: "text-only-model",
      supportsImages: false,
      generate,
    });
    const result = await adapter.generate({
      prompt: "Review the approved visual evidence.",
      request: await request(),
      approvedConsentHash: "approved-hash",
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "unsupported-image" },
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("sends only the validated approved bytes and preserves unknown image usage", async () => {
    let sent:
      | Parameters<
          NonNullable<
            Parameters<typeof createMultimodalScreenshotAdapter>[0]["generate"]
          >
        >[0]
      | undefined;
    const adapter = createMultimodalScreenshotAdapter({
      modelId: "vision-model-v1",
      supportsImages: true,
      async generate(input) {
        sent = input;
        return {
          text: "The screenshot shows a fictional dashboard.",
          model: "vision-model-v1",
          usage: { inputTokens: 200, outputTokens: 40 },
        };
      },
    });
    const signal = new AbortController().signal;
    const approved = await request();
    const result = await adapter.generate({
      prompt: "Review the approved visual evidence.",
      request: approved,
      approvedConsentHash: "approved-hash",
      signal,
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        model: "vision-model-v1",
        usage: { imageTokens: null, inputTokens: 200, outputTokens: 40 },
      },
    });
    expect(sent?.signal).toBe(signal);
    expect(sent?.images).toHaveLength(1);
    expect([...sent!.images[0].bytes]).toEqual([1, 2, 3, 4]);
    expect(sent?.images[0].mediaType).toBe("image/png");
  });

  it("rejects stale consent and cancellation before provider work", async () => {
    const generate = vi.fn();
    const adapter = createMultimodalScreenshotAdapter({
      modelId: "vision-model-v1",
      supportsImages: true,
      generate,
    });
    const approved = await request();
    const stale = await adapter.generate({
      prompt: "Review this.",
      request: approved,
      approvedConsentHash: "old-hash",
      signal: new AbortController().signal,
    });
    expect(stale).toMatchObject({
      ok: false,
      error: { code: "consent-mismatch" },
    });

    const controller = new AbortController();
    controller.abort();
    const cancelled = await adapter.generate({
      prompt: "Review this.",
      request: approved,
      approvedConsentHash: "approved-hash",
      signal: controller.signal,
    });
    expect(cancelled).toMatchObject({
      ok: false,
      error: { code: "cancelled" },
    });
    expect(generate).not.toHaveBeenCalled();
  });
});
