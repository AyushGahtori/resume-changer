export const SCREENSHOT_LIMITS = Object.freeze({
  maxCount: 5,
  maxInputBytesPerImage: 8 * 1024 * 1024,
  maxPixelsPerImage: 16_000_000,
  maxDimension: 1_280,
  targetBytesPerImage: 200 * 1024,
  targetTotalBytes: 750 * 1024,
  maxRequestBytes: 4_100_000,
  maxCapsuleCharacters: 3_800_000,
});

export const SCREENSHOT_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type ScreenshotMediaType = (typeof SCREENSHOT_MEDIA_TYPES)[number];

export type ScreenshotErrorCode =
  | "invalid-input"
  | "unsupported-image"
  | "invalid-image"
  | "animated-image"
  | "limit-exceeded"
  | "consent-mismatch"
  | "unavailable"
  | "cancelled";

export type ScreenshotResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: { code: ScreenshotErrorCode; message: string };
    };

/** A processed image held only in the current browser tab. */
export type ProcessedScreenshot = {
  id: string;
  fileName: string;
  mediaType: ScreenshotMediaType;
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
  blob: Blob;
};

export type ScreenshotIdentity = Omit<ProcessedScreenshot, "blob" | "fileName">;

export type ScreenshotConsentInput = {
  preparedSourceHash: string;
  projectContextHash: string;
  notes: string;
  screenshots: readonly ScreenshotIdentity[];
};

export type EncodedScreenshot = ScreenshotIdentity & {
  dataBase64: string;
};

export type ScreenshotRequestEnvelope = {
  version: "context-screenshots-v1";
  capsule: string;
  consentHash: string;
  screenshots: EncodedScreenshot[];
};

export type DecodedImageMetadata = {
  mediaType: ScreenshotMediaType;
  width: number;
  height: number;
  animated: boolean;
};

export type ScreenshotAttachmentInput = {
  id: string;
  mediaType: string;
  sha256: string;
  dataBase64: string;
};

export type ValidatedScreenshot = ScreenshotIdentity & {
  bytes: Uint8Array;
};

export type ValidatedScreenshotRequest = {
  version: "context-screenshots-v1";
  capsule: string;
  consentHash: string;
  screenshots: ValidatedScreenshot[];
  requestBytes: number;
};

export type MultimodalUsage = {
  /** Nullable unless the configured provider explicitly reports image tokens. */
  imageTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
};
