import { describe, expect, it, vi } from "vitest";
import { SCREENSHOT_LIMITS } from "../../../../src/lib/github/context-screenshots/contracts";
import { processScreenshotFile } from "../../../../src/lib/github/context-screenshots/compression";
import { pngFixture } from "../../../../tests/fixtures/github/context-screenshots/images";

function toOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

describe("browser screenshot processing admission", () => {
  it("rejects originals above 8 MiB before decoding them", async () => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    const file = new File(
      [
        toOwnedArrayBuffer(
          new Uint8Array(SCREENSHOT_LIMITS.maxInputBytesPerImage + 1),
        ),
      ],
      "too-large.png",
      { type: "image/png" },
    );
    const result = await processScreenshotFile(
      file,
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "limit-exceeded" },
    });
    expect(decode).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("rejects malformed and MIME-spoofed bytes before using a decoder", async () => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    const spoof = new File([toOwnedArrayBuffer(pngFixture())], "spoof.png", {
      type: "image/jpeg",
    });
    const result = await processScreenshotFile(
      spoof,
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "unsupported-image" },
    });
    expect(decode).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
