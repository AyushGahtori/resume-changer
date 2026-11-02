import {
  SCREENSHOT_LIMITS,
  type MultimodalUsage,
  type ScreenshotResult,
  type ValidatedScreenshotRequest,
} from "./contracts";
import { sha256Hex } from "./crypto";

export type MultimodalGenerationResponse = {
  text: string;
  model: string | null;
  usage?: {
    imageTokens?: number | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
  };
};

export type MultimodalModelPort = {
  modelId: string;
  supportsImages: boolean;
  generate(input: {
    prompt: string;
    images: readonly {
      id: string;
      mediaType: string;
      sha256: string;
      bytes: Uint8Array;
    }[];
    signal: AbortSignal;
  }): Promise<MultimodalGenerationResponse>;
};

export type MultimodalExtraction = {
  text: string;
  model: string | null;
  usage: MultimodalUsage;
};

/**
 * The adapter never picks another model. Its caller must pass a validated,
 * consent-bound request and a model whose image capability was verified.
 */
export function createMultimodalScreenshotAdapter(model: MultimodalModelPort) {
  return {
    async generate(input: {
      prompt: string;
      request: ValidatedScreenshotRequest;
      approvedConsentHash: string;
      signal: AbortSignal;
    }): Promise<ScreenshotResult<MultimodalExtraction>> {
      if (input.signal.aborted)
        return {
          ok: false,
          error: {
            code: "cancelled",
            message: "Image analysis was cancelled.",
          },
        };
      if (
        !input.prompt.trim() ||
        input.request.consentHash !== input.approvedConsentHash ||
        input.request.requestBytes > SCREENSHOT_LIMITS.maxRequestBytes ||
        input.request.screenshots.length > SCREENSHOT_LIMITS.maxCount
      )
        return {
          ok: false,
          error: {
            code: "consent-mismatch",
            message: "The submitted images do not match the approved request.",
          },
        };
      if (input.request.screenshots.length > 0 && !model.supportsImages)
        return {
          ok: false,
          error: {
            code: "unsupported-image",
            message:
              "The configured AI model does not support image input. Approve a text-only analysis or choose an image-capable model.",
          },
        };

      let totalBytes = 0;
      const images = [];
      for (const image of input.request.screenshots) {
        if (input.signal.aborted)
          return {
            ok: false,
            error: {
              code: "cancelled",
              message: "Image analysis was cancelled.",
            },
          };
        totalBytes += image.bytes.byteLength;
        const hash = await sha256Hex(image.bytes);
        if (!hash.ok) return hash;
        if (
          image.bytes.byteLength !== image.byteLength ||
          hash.value !== image.sha256.toLowerCase()
        )
          return {
            ok: false,
            error: {
              code: "consent-mismatch",
              message: "A screenshot changed after request validation.",
            },
          };
        images.push({
          id: image.id,
          mediaType: image.mediaType,
          sha256: image.sha256,
          bytes: image.bytes,
        });
      }
      if (totalBytes > SCREENSHOT_LIMITS.targetTotalBytes)
        return {
          ok: false,
          error: {
            code: "limit-exceeded",
            message: "The screenshot bundle exceeds its compressed byte limit.",
          },
        };

      try {
        const response = await model.generate({
          prompt: input.prompt,
          images,
          signal: input.signal,
        });
        const validUsage = (value: number | null | undefined) =>
          typeof value === "number" && Number.isSafeInteger(value) && value >= 0
            ? value
            : null;
        return {
          ok: true,
          value: {
            text: response.text,
            model: response.model ?? model.modelId,
            usage: {
              imageTokens: validUsage(response.usage?.imageTokens),
              inputTokens: validUsage(response.usage?.inputTokens),
              outputTokens: validUsage(response.usage?.outputTokens),
            },
          },
        };
      } catch {
        return input.signal.aborted
          ? {
              ok: false,
              error: {
                code: "cancelled",
                message: "Image analysis was cancelled.",
              },
            }
          : {
              ok: false,
              error: {
                code: "unavailable",
                message:
                  "The configured AI provider could not process the images.",
              },
            };
      }
    },
  };
}
