import {
  SCREENSHOT_LIMITS,
  type DecodedImageMetadata,
  type ScreenshotAttachmentInput,
  type ScreenshotConsentInput,
  type ScreenshotIdentity,
  type ScreenshotRequestEnvelope,
  type ScreenshotResult,
  type ValidatedScreenshot,
  type ValidatedScreenshotRequest,
} from "./contracts";
import { decodeBase64, sha256Hex } from "./crypto";
import { verifyScreenshotConsent } from "./consent";
import { sniffImageHeader } from "./formats";

export type ServerImageDecoder = {
  /** Must fully decode the bytes and reject corrupt/unsupported image streams. */
  decode(
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<DecodedImageMetadata>;
};

function fail<T>(
  code:
    | "invalid-input"
    | "invalid-image"
    | "animated-image"
    | "limit-exceeded"
    | "consent-mismatch"
    | "unavailable"
    | "unsupported-image",
  message: string,
): ScreenshotResult<T> {
  return { ok: false, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEnvelope(value: unknown): ScreenshotRequestEnvelope | null {
  if (
    !isRecord(value) ||
    value.version !== "context-screenshots-v1" ||
    typeof value.capsule !== "string" ||
    typeof value.consentHash !== "string" ||
    !Array.isArray(value.screenshots) ||
    value.screenshots.length > SCREENSHOT_LIMITS.maxCount
  )
    return null;

  const screenshots: ScreenshotAttachmentInput[] = [];
  for (const candidate of value.screenshots) {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      typeof candidate.mediaType !== "string" ||
      typeof candidate.sha256 !== "string" ||
      typeof candidate.dataBase64 !== "string" ||
      typeof candidate.width !== "number" ||
      typeof candidate.height !== "number" ||
      typeof candidate.byteLength !== "number"
    )
      return null;
    screenshots.push(candidate as ScreenshotAttachmentInput);
  }
  return value as unknown as ScreenshotRequestEnvelope;
}

function sameIdentity(
  actual: ScreenshotIdentity,
  expected: ScreenshotIdentity,
): boolean {
  return (
    actual.id === expected.id &&
    actual.mediaType === expected.mediaType &&
    actual.width === expected.width &&
    actual.height === expected.height &&
    actual.byteLength === expected.byteLength &&
    actual.sha256.toLowerCase() === expected.sha256.toLowerCase()
  );
}

/**
 * Call after reading the request through the route's bounded byte reader and
 * decrypting/validating its capsule. No screenshot bytes are persisted here.
 */
export async function validateScreenshotRequest(input: {
  body: string;
  actualBodyBytes: number;
  expectedCapsule: string;
  expectedConsentHash: string;
  expectedConsent: ScreenshotConsentInput;
  decoder?: ServerImageDecoder;
  signal?: AbortSignal;
}): Promise<ScreenshotResult<ValidatedScreenshotRequest>> {
  if (
    !Number.isSafeInteger(input.actualBodyBytes) ||
    input.actualBodyBytes < 1 ||
    input.actualBodyBytes > SCREENSHOT_LIMITS.maxRequestBytes
  )
    return fail(
      "limit-exceeded",
      "The context and image request exceeds the body limit.",
    );
  const encodedBodyBytes = new TextEncoder().encode(input.body).byteLength;
  if (encodedBodyBytes !== input.actualBodyBytes)
    return fail("invalid-input", "The request body encoding is invalid.");

  let raw: unknown;
  try {
    raw = JSON.parse(input.body);
  } catch {
    return fail("invalid-input", "The screenshot request is malformed.");
  }
  const envelope = parseEnvelope(raw);
  if (!envelope)
    return fail("invalid-input", "The screenshot request fields are invalid.");
  if (
    envelope.capsule !== input.expectedCapsule ||
    envelope.consentHash !== input.expectedConsentHash ||
    envelope.capsule.length > SCREENSHOT_LIMITS.maxCapsuleCharacters
  )
    return fail(
      "consent-mismatch",
      "The request does not match the approved context.",
    );

  if (envelope.screenshots.length > 0 && !input.decoder)
    return fail(
      "unavailable",
      "Image decoding is not configured; no screenshot was submitted.",
    );

  const totalBytes = envelope.screenshots.reduce(
    (total, screenshot) =>
      total +
      (typeof screenshot.dataBase64 === "string"
        ? Math.floor((screenshot.dataBase64.length * 3) / 4) -
          (screenshot.dataBase64.endsWith("==")
            ? 2
            : screenshot.dataBase64.endsWith("=")
              ? 1
              : 0)
        : 0),
    0,
  );
  if (totalBytes > SCREENSHOT_LIMITS.targetTotalBytes)
    return fail(
      "limit-exceeded",
      "The screenshot bundle exceeds its compressed byte limit.",
    );

  const identities = input.expectedConsent.screenshots;
  if (identities.length !== envelope.screenshots.length)
    return fail(
      "consent-mismatch",
      "The screenshot list changed after approval.",
    );
  const verifiedConsent = await verifyScreenshotConsent(
    input.expectedConsent,
    envelope.consentHash,
  );
  if (!verifiedConsent.ok) return verifiedConsent;

  const ids = new Set<string>();
  const validated: ValidatedScreenshot[] = [];
  let decodedTotalBytes = 0;
  for (let index = 0; index < envelope.screenshots.length; index += 1) {
    if (input.signal?.aborted)
      return fail("unavailable", "Screenshot validation was cancelled.");
    const candidate = envelope.screenshots[index];
    if (
      !candidate.id ||
      candidate.id.length > 128 ||
      !/^[A-Za-z0-9_-]+$/.test(candidate.id) ||
      ids.has(candidate.id) ||
      !/^[a-f0-9]{64}$/i.test(candidate.sha256) ||
      !Number.isSafeInteger(candidate.width) ||
      !Number.isSafeInteger(candidate.height) ||
      !Number.isSafeInteger(candidate.byteLength) ||
      candidate.width < 1 ||
      candidate.height < 1 ||
      candidate.width > SCREENSHOT_LIMITS.maxDimension ||
      candidate.height > SCREENSHOT_LIMITS.maxDimension ||
      candidate.width * candidate.height >
        SCREENSHOT_LIMITS.maxPixelsPerImage ||
      candidate.byteLength < 1 ||
      candidate.byteLength > SCREENSHOT_LIMITS.targetBytesPerImage
    )
      return fail("invalid-input", "A screenshot identity is invalid.");
    ids.add(candidate.id);

    const bytes = decodeBase64(candidate.dataBase64);
    if (!bytes || bytes.byteLength !== candidate.byteLength)
      return fail("invalid-image", "A screenshot attachment is malformed.");
    decodedTotalBytes += bytes.byteLength;
    if (decodedTotalBytes > SCREENSHOT_LIMITS.targetTotalBytes)
      return fail(
        "limit-exceeded",
        "The screenshot bundle exceeds its compressed byte limit.",
      );
    const hash = await sha256Hex(bytes);
    if (!hash.ok) return hash;
    if (hash.value !== candidate.sha256.toLowerCase())
      return fail("consent-mismatch", "A screenshot changed after approval.");

    let header: DecodedImageMetadata;
    try {
      header = sniffImageHeader(bytes);
    } catch {
      return fail(
        "unsupported-image",
        "Only decoded JPEG, PNG, or WebP screenshots are accepted.",
      );
    }
    if (header.animated)
      return fail("animated-image", "Animated screenshots are not accepted.");
    if (
      header.mediaType !== candidate.mediaType ||
      header.width !== candidate.width ||
      header.height !== candidate.height
    )
      return fail(
        "invalid-image",
        "Screenshot type or dimensions do not match the encoded file.",
      );

    let decoded: DecodedImageMetadata;
    try {
      decoded = await input.decoder!.decode(bytes, input.signal);
    } catch {
      return fail("invalid-image", "A screenshot could not be fully decoded.");
    }
    if (
      decoded.animated ||
      decoded.mediaType !== header.mediaType ||
      decoded.width !== header.width ||
      decoded.height !== header.height
    )
      return fail(
        decoded.animated ? "animated-image" : "invalid-image",
        decoded.animated
          ? "Animated screenshots are not accepted."
          : "The decoded screenshot does not match its verified header.",
      );

    const actualIdentity: ScreenshotIdentity = {
      id: candidate.id,
      mediaType: decoded.mediaType,
      width: decoded.width,
      height: decoded.height,
      byteLength: bytes.byteLength,
      sha256: hash.value,
    };
    if (!sameIdentity(actualIdentity, identities[index]))
      return fail(
        "consent-mismatch",
        "A screenshot identity changed after approval.",
      );

    validated.push({ ...actualIdentity, bytes });
  }

  return {
    ok: true,
    value: {
      version: "context-screenshots-v1",
      capsule: envelope.capsule,
      consentHash: envelope.consentHash,
      screenshots: validated,
      requestBytes: input.actualBodyBytes,
    },
  };
}
