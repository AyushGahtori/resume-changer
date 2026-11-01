import {
  SCREENSHOT_LIMITS,
  type ProcessedScreenshot,
  type ScreenshotRequestEnvelope,
  type ScreenshotResult,
} from "./contracts";
import { encodeBase64, sha256Hex } from "./crypto";
import { screenshotIdentity, verifyScreenshotConsent } from "./consent";

export async function buildScreenshotRequest(input: {
  capsule: string;
  consentHash: string;
  preparedSourceHash: string;
  projectContextHash: string;
  notes: string;
  screenshots: readonly ProcessedScreenshot[];
}): Promise<
  ScreenshotResult<{
    envelope: ScreenshotRequestEnvelope;
    body: string;
    requestBytes: number;
  }>
> {
  if (
    typeof input.capsule !== "string" ||
    input.capsule.length > SCREENSHOT_LIMITS.maxCapsuleCharacters ||
    !Array.isArray(input.screenshots) ||
    input.screenshots.length > SCREENSHOT_LIMITS.maxCount
  ) {
    return {
      ok: false,
      error: {
        code: "limit-exceeded",
        message:
          "The approved context or screenshot count exceeds the request limit.",
      },
    };
  }

  const totalBytes = input.screenshots.reduce(
    (sum, image) => sum + image.byteLength,
    0,
  );
  if (
    input.screenshots.some(
      (image) => image.byteLength > SCREENSHOT_LIMITS.targetBytesPerImage,
    ) ||
    totalBytes > SCREENSHOT_LIMITS.targetTotalBytes
  ) {
    return {
      ok: false,
      error: {
        code: "limit-exceeded",
        message:
          "Remove or reduce screenshots to fit the approved image-size limits.",
      },
    };
  }

  const consent = await verifyScreenshotConsent(
    {
      preparedSourceHash: input.preparedSourceHash,
      projectContextHash: input.projectContextHash,
      notes: input.notes,
      screenshots: input.screenshots.map(screenshotIdentity),
    },
    input.consentHash,
  );
  if (!consent.ok) return consent;

  const attachments: ScreenshotRequestEnvelope["screenshots"] = [];
  for (const image of input.screenshots) {
    const bytes = new Uint8Array(await image.blob.arrayBuffer());
    if (bytes.byteLength !== image.byteLength) {
      return {
        ok: false,
        error: {
          code: "consent-mismatch",
          message: "A screenshot changed after approval.",
        },
      };
    }
    const digest = await sha256Hex(bytes);
    if (!digest.ok) return digest;
    if (digest.value !== image.sha256.toLowerCase()) {
      return {
        ok: false,
        error: {
          code: "consent-mismatch",
          message: "A screenshot changed after approval.",
        },
      };
    }
    attachments.push({
      ...screenshotIdentity(image),
      dataBase64: encodeBase64(bytes),
    });
  }

  const envelope: ScreenshotRequestEnvelope = {
    version: "context-screenshots-v1",
    capsule: input.capsule,
    consentHash: input.consentHash,
    screenshots: attachments,
  };
  const body = JSON.stringify(envelope);
  const requestBytes = new TextEncoder().encode(body).byteLength;
  if (requestBytes > SCREENSHOT_LIMITS.maxRequestBytes) {
    return {
      ok: false,
      error: {
        code: "limit-exceeded",
        message:
          "The approved context and screenshots exceed the request limit. Remove screenshots or prepare a smaller context bundle.",
      },
    };
  }

  return { ok: true, value: { envelope, body, requestBytes } };
}
