import { describe, expect, it } from "vitest";
import {
  type ProcessedScreenshot,
  SCREENSHOT_LIMITS,
} from "../../../../src/lib/github/context-screenshots/contracts";
import {
  createScreenshotConsentHash,
  screenshotIdentity,
  verifyScreenshotConsent,
} from "../../../../src/lib/github/context-screenshots/consent";
import {
  decodeBase64,
  encodeBase64,
  sha256Hex,
} from "../../../../src/lib/github/context-screenshots/crypto";
import { buildScreenshotRequest } from "../../../../src/lib/github/context-screenshots/request";

function toOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function screenshot(
  id: string,
  bytes: Uint8Array,
): Promise<ProcessedScreenshot> {
  const digest = await sha256Hex(bytes);
  if (!digest.ok) throw new Error(digest.error.message);
  return {
    id,
    fileName: `${id}.webp`,
    mediaType: "image/webp",
    width: 640,
    height: 360,
    byteLength: bytes.byteLength,
    sha256: digest.value,
    blob: new Blob([toOwnedArrayBuffer(bytes)], { type: "image/webp" }),
  };
}

describe("screenshot consent and request admission", () => {
  it("binds approval to source, answers, exact notes and ordered image hashes", async () => {
    const first = await screenshot("screen-1", new Uint8Array([1, 2, 3]));
    const second = await screenshot("screen-2", new Uint8Array([4, 5, 6]));
    const input = {
      preparedSourceHash: "source-a",
      projectContextHash: "context-a",
      notes: "I built the dashboard UI.",
      screenshots: [screenshotIdentity(first)],
    };
    const approved = await createScreenshotConsentHash(input);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    expect(await verifyScreenshotConsent(input, approved.value)).toMatchObject({
      ok: true,
    });
    for (const changed of [
      { ...input, preparedSourceHash: "source-b" },
      { ...input, projectContextHash: "context-b" },
      { ...input, notes: "I implemented the dashboard UI." },
      { ...input, screenshots: [screenshotIdentity(second)] },
    ]) {
      expect(
        await verifyScreenshotConsent(changed, approved.value),
      ).toMatchObject({
        ok: false,
        error: { code: "consent-mismatch" },
      });
    }
  });

  it("uses strict base64 encoding for the JSON attachment envelope", () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
    expect(decodeBase64("not base64!=")).toBeNull();
  });

  it("reports the exact serialized request size for a text-only approved bundle", async () => {
    const context = {
      preparedSourceHash: "source",
      projectContextHash: "context",
      notes: "Only text is included.",
      screenshots: [],
    };
    const consent = await createScreenshotConsentHash(context);
    expect(consent.ok).toBe(true);
    if (!consent.ok) return;
    const result = await buildScreenshotRequest({
      capsule: "approved-κ-context",
      consentHash: consent.value,
      preparedSourceHash: context.preparedSourceHash,
      projectContextHash: context.projectContextHash,
      notes: context.notes,
      screenshots: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.requestBytes).toBe(
      new TextEncoder().encode(result.value.body).byteLength,
    );
    expect(result.value.requestBytes).toBeGreaterThan(result.value.body.length);
  });

  it("measures the exact UTF-8 JSON body and refuses the capsule plus base64 overflow", async () => {
    const inputImageBytes = new Uint8Array(150 * 1024).fill(17);
    const images = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        screenshot(`screen-${index}`, inputImageBytes),
      ),
    );
    const context = {
      preparedSourceHash: "source",
      projectContextHash: "context",
      notes: "",
      screenshots: images.map(screenshotIdentity),
    };
    const consent = await createScreenshotConsentHash(context);
    expect(consent.ok).toBe(true);
    if (!consent.ok) return;

    const result = await buildScreenshotRequest({
      capsule: "x".repeat(SCREENSHOT_LIMITS.maxCapsuleCharacters),
      consentHash: consent.value,
      preparedSourceHash: context.preparedSourceHash,
      projectContextHash: context.projectContextHash,
      notes: context.notes,
      screenshots: images,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "limit-exceeded" },
    });
  });

  it("does not silently send a blob whose bytes changed after approval", async () => {
    const image = await screenshot("screen-1", new Uint8Array([1, 2, 3]));
    const changed = { ...image, blob: new Blob([new Uint8Array([8, 8, 8])]) };
    const context = {
      preparedSourceHash: "source",
      projectContextHash: "context",
      notes: "",
      screenshots: [screenshotIdentity(changed)],
    };
    const consent = await createScreenshotConsentHash(context);
    expect(consent.ok).toBe(true);
    if (!consent.ok) return;

    const result = await buildScreenshotRequest({
      capsule: "approved-capsule",
      consentHash: consent.value,
      preparedSourceHash: context.preparedSourceHash,
      projectContextHash: context.projectContextHash,
      notes: context.notes,
      screenshots: [changed],
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "consent-mismatch" },
    });
  });
});
