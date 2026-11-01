import { describe, expect, it } from "vitest";
import { pngFixture } from "../../../../tests/fixtures/github/context-screenshots/images";
import { SCREENSHOT_LIMITS } from "../../../../src/lib/github/context-screenshots/contracts";
import { sniffImageHeader } from "../../../../src/lib/github/context-screenshots/formats";

describe("screenshot byte sniffing", () => {
  it("reads actual PNG type and dimensions from the encoded header", () => {
    expect(sniffImageHeader(pngFixture({ width: 640, height: 360 }))).toEqual({
      mediaType: "image/png",
      width: 640,
      height: 360,
      animated: false,
    });
  });

  it("detects APNG animation before decode or upload", () => {
    expect(sniffImageHeader(pngFixture({ animated: true })).animated).toBe(
      true,
    );
  });

  it("rejects SVG, GIF, malformed and truncated image bytes", () => {
    for (const bytes of [
      new TextEncoder().encode('<svg onload="alert(1)"/>'),
      new Uint8Array([71, 73, 70, 56, 57, 97]),
      pngFixture().slice(0, 20),
    ]) {
      expect(() => sniffImageHeader(bytes)).toThrow();
    }
  });

  it("does not treat dimensions in a header as permission to decode a pixel bomb", () => {
    const bytes = pngFixture({ width: 5000, height: 4000 });
    const header = sniffImageHeader(bytes);
    expect(header.width * header.height).toBeGreaterThan(
      SCREENSHOT_LIMITS.maxPixelsPerImage,
    );
  });
});
