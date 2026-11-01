import { describe, expect, it, vi } from "vitest";
import {
  createScreenshotConsentHash,
  screenshotIdentity,
} from "../../../../src/lib/github/context-screenshots/consent";
import {
  encodeBase64,
  sha256Hex,
} from "../../../../src/lib/github/context-screenshots/crypto";
import { sniffImageHeader } from "../../../../src/lib/github/context-screenshots/formats";
import { validateScreenshotRequest } from "../../../../src/lib/github/context-screenshots/server-validation";
import type { ProcessedScreenshot } from "../../../../src/lib/github/context-screenshots/contracts";
import { pngFixture } from "../../../../tests/fixtures/github/context-screenshots/images";

function toOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function makeRequest(bytes = pngFixture(), mediaType = "image/png") {
  const header = sniffImageHeader(bytes);
  const hash = await sha256Hex(bytes);
  if (!hash.ok) throw new Error(hash.error.message);
  const image: ProcessedScreenshot = {
    id: "tab-image-1",
    fileName: "fictional-dashboard.png",
    mediaType: header.mediaType,
    width: header.width,
    height: header.height,
    byteLength: bytes.byteLength,
    sha256: hash.value,
    blob: new Blob([toOwnedArrayBuffer(bytes)], { type: header.mediaType }),
  };
  const expectedConsent = {
    preparedSourceHash: "prepared-source-hash",
    projectContextHash: "project-context-hash",
    notes: "A fictional dashboard sample.",
    screenshots: [screenshotIdentity(image)],
  };
  const consent = await createScreenshotConsentHash(expectedConsent);
  if (!consent.ok) throw new Error(consent.error.message);
  const body = JSON.stringify({
    version: "context-screenshots-v1",
    capsule: "encrypted-capsule-without-image-bytes",
    consentHash: consent.value,
    screenshots: [
      {
        ...screenshotIdentity(image),
        mediaType,
        dataBase64: encodeBase64(bytes),
      },
    ],
  });
  return {
    body,
    expectedConsent,
    expectedConsentHash: consent.value,
    decoder: {
      decode: vi.fn(async (data: Uint8Array) => sniffImageHeader(data)),
    },
    image,
  };
}

describe("server screenshot validation", () => {
  it("checks actual bytes, hash, decoded type, dimensions, consent and body size", async () => {
    const input = await makeRequest();
    const actualBodyBytes = new TextEncoder().encode(input.body).byteLength;
    const result = await validateScreenshotRequest({
      body: input.body,
      actualBodyBytes,
      expectedCapsule: "encrypted-capsule-without-image-bytes",
      expectedConsentHash: input.expectedConsentHash,
      expectedConsent: input.expectedConsent,
      decoder: input.decoder,
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        screenshots: [
          {
            id: "tab-image-1",
            mediaType: "image/png",
            width: 32,
            height: 16,
          },
        ],
        requestBytes: actualBodyBytes,
      },
    });
    expect(input.decoder.decode).toHaveBeenCalledTimes(1);
    if (result.ok)
      expect(result.value.screenshots[0].bytes).toEqual(
        new Uint8Array(await input.image.blob.arrayBuffer()),
      );
  });

  it("rejects a MIME spoof before invoking the decoder", async () => {
    const input = await makeRequest(undefined, "image/jpeg");
    const result = await validateScreenshotRequest({
      body: input.body,
      actualBodyBytes: new TextEncoder().encode(input.body).byteLength,
      expectedCapsule: "encrypted-capsule-without-image-bytes",
      expectedConsentHash: input.expectedConsentHash,
      expectedConsent: input.expectedConsent,
      decoder: input.decoder,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid-image" },
    });
    expect(input.decoder.decode).not.toHaveBeenCalled();
  });

  it("rejects animation and invalid decoded streams", async () => {
    const animated = await makeRequest(pngFixture({ animated: true }));
    const animatedResult = await validateScreenshotRequest({
      body: animated.body,
      actualBodyBytes: new TextEncoder().encode(animated.body).byteLength,
      expectedCapsule: "encrypted-capsule-without-image-bytes",
      expectedConsentHash: animated.expectedConsentHash,
      expectedConsent: animated.expectedConsent,
      decoder: animated.decoder,
    });
    expect(animatedResult).toMatchObject({
      ok: false,
      error: { code: "animated-image" },
    });
    expect(animated.decoder.decode).not.toHaveBeenCalled();

    const corrupt = await makeRequest();
    corrupt.decoder.decode.mockRejectedValueOnce(
      new Error("private codec details"),
    );
    const corruptResult = await validateScreenshotRequest({
      body: corrupt.body,
      actualBodyBytes: new TextEncoder().encode(corrupt.body).byteLength,
      expectedCapsule: "encrypted-capsule-without-image-bytes",
      expectedConsentHash: corrupt.expectedConsentHash,
      expectedConsent: corrupt.expectedConsent,
      decoder: corrupt.decoder,
    });
    expect(corruptResult).toMatchObject({
      ok: false,
      error: { code: "invalid-image" },
    });
    expect(JSON.stringify(corruptResult)).not.toContain(
      "private codec details",
    );
  });

  it("fails closed without a full server decoder and enforces the actual body limit", async () => {
    const input = await makeRequest();
    const bodyBytes = new TextEncoder().encode(input.body).byteLength;
    const missingDecoder = await validateScreenshotRequest({
      body: input.body,
      actualBodyBytes: bodyBytes,
      expectedCapsule: "encrypted-capsule-without-image-bytes",
      expectedConsentHash: input.expectedConsentHash,
      expectedConsent: input.expectedConsent,
    });
    expect(missingDecoder).toMatchObject({
      ok: false,
      error: { code: "unavailable" },
    });

    const oversizedBody = await validateScreenshotRequest({
      body: input.body,
      actualBodyBytes: 4_100_001,
      expectedCapsule: "encrypted-capsule-without-image-bytes",
      expectedConsentHash: input.expectedConsentHash,
      expectedConsent: input.expectedConsent,
      decoder: input.decoder,
    });
    expect(oversizedBody).toMatchObject({
      ok: false,
      error: { code: "limit-exceeded" },
    });
  });

  it("rejects a changed capsule or screenshot identity even when the request is well-formed", async () => {
    const input = await makeRequest();
    const changedCapsule = await validateScreenshotRequest({
      body: input.body,
      actualBodyBytes: new TextEncoder().encode(input.body).byteLength,
      expectedCapsule: "different-capsule",
      expectedConsentHash: input.expectedConsentHash,
      expectedConsent: input.expectedConsent,
      decoder: input.decoder,
    });
    expect(changedCapsule).toMatchObject({
      ok: false,
      error: { code: "consent-mismatch" },
    });
  });
});
