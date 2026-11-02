import {
  SCREENSHOT_LIMITS,
  type ProcessedScreenshot,
  type ScreenshotConsentInput,
  type ScreenshotIdentity,
  type ScreenshotResult,
} from "./contracts";
import { sha256Hex } from "./crypto";
import { isScreenshotMediaType } from "./formats";

const CONSENT_VERSION = "context-screenshots-v1";

function codePointLength(value: string): number {
  return [...value].length;
}

export function screenshotIdentity(
  screenshot: ProcessedScreenshot,
): ScreenshotIdentity {
  return {
    id: screenshot.id,
    mediaType: screenshot.mediaType,
    width: screenshot.width,
    height: screenshot.height,
    byteLength: screenshot.byteLength,
    sha256: screenshot.sha256,
  };
}

export async function createScreenshotConsentHash(
  input: ScreenshotConsentInput,
): Promise<ScreenshotResult<string>> {
  if (
    !input ||
    typeof input.preparedSourceHash !== "string" ||
    !input.preparedSourceHash ||
    typeof input.projectContextHash !== "string" ||
    !input.projectContextHash ||
    typeof input.notes !== "string" ||
    codePointLength(input.notes) > 500 ||
    !Array.isArray(input.screenshots) ||
    input.screenshots.length > SCREENSHOT_LIMITS.maxCount
  ) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        message: "The approved project context or screenshot list is invalid.",
      },
    };
  }

  const ids = new Set<string>();
  let totalImageBytes = 0;
  for (const image of input.screenshots) {
    if (
      !image.id ||
      image.id.length > 128 ||
      !/^[A-Za-z0-9_-]+$/.test(image.id) ||
      ids.has(image.id) ||
      !isScreenshotMediaType(image.mediaType) ||
      !/^[a-f0-9]{64}$/i.test(image.sha256) ||
      !Number.isSafeInteger(image.width) ||
      !Number.isSafeInteger(image.height) ||
      !Number.isSafeInteger(image.byteLength) ||
      image.width < 1 ||
      image.height < 1 ||
      image.width > SCREENSHOT_LIMITS.maxDimension ||
      image.height > SCREENSHOT_LIMITS.maxDimension ||
      image.width * image.height > SCREENSHOT_LIMITS.maxPixelsPerImage ||
      image.byteLength < 1 ||
      image.byteLength > SCREENSHOT_LIMITS.targetBytesPerImage
    ) {
      return {
        ok: false,
        error: {
          code: "invalid-input",
          message: "A screenshot identity is invalid or duplicated.",
        },
      };
    }
    ids.add(image.id);
    totalImageBytes += image.byteLength;
    if (totalImageBytes > SCREENSHOT_LIMITS.targetTotalBytes)
      return {
        ok: false,
        error: {
          code: "limit-exceeded",
          message:
            "The approved screenshot bundle exceeds its total size limit.",
        },
      };
  }

  const ordered = input.screenshots.map((image) => ({
    id: image.id,
    mediaType: image.mediaType,
    width: image.width,
    height: image.height,
    byteLength: image.byteLength,
    sha256: image.sha256.toLowerCase(),
  }));
  const canonical = JSON.stringify({
    version: CONSENT_VERSION,
    preparedSourceHash: input.preparedSourceHash,
    projectContextHash: input.projectContextHash,
    notes: input.notes,
    screenshots: ordered,
  });
  const hashed = await sha256Hex(new TextEncoder().encode(canonical));
  return hashed.ok
    ? hashed
    : {
        ok: false,
        error: {
          code: "unavailable",
          message: "The exact approved screenshot bundle could not be hashed.",
        },
      };
}

export async function verifyScreenshotConsent(
  input: ScreenshotConsentInput,
  approvedHash: string,
): Promise<ScreenshotResult<true>> {
  if (!/^[a-f0-9]{64}$/i.test(approvedHash))
    return {
      ok: false,
      error: {
        code: "consent-mismatch",
        message: "Approval does not match the current project context.",
      },
    };
  const current = await createScreenshotConsentHash(input);
  if (!current.ok) return current;
  return current.value === approvedHash.toLowerCase()
    ? { ok: true, value: true }
    : {
        ok: false,
        error: {
          code: "consent-mismatch",
          message:
            "The source, answers, notes, or screenshots changed after approval.",
        },
      };
}
