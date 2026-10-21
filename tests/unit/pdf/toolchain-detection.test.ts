import { describe, expect, it } from "vitest";
import {
  describeMissingToolchain,
  detectPdfToolchain,
  requirePdfToolchain,
} from "../../helpers/pdf-toolchain";

/**
 * The PDF integration tests need Tectonic and pdfinfo together. A machine
 * that only has one of them cannot run the studio layout tests, and the
 * failure must be reported as a missing tool rather than as a broken test.
 */
describe("PDF toolchain detection", () => {
  it("reports both binaries as missing when neither is installed", () => {
    const toolchain = detectPdfToolchain();
    expect(toolchain.tectonic).toBeTruthy();
    expect(toolchain.pdfInfo).toBeTruthy();
    expect(toolchain.missing.length).toBeGreaterThan(0);
    expect(toolchain.available).toBe(false);
  });

  it("describes every missing binary in the skip and failure messages", () => {
    const toolchain = {
      tectonic: "tectonic",
      pdfInfo: "pdfinfo",
      available: false,
      missing: ["Tectonic", "pdfinfo"],
    };

    expect(describeMissingToolchain(toolchain)).toContain("Tectonic");
    expect(describeMissingToolchain(toolchain)).toContain("pdfinfo");
    expect(() => requirePdfToolchain(toolchain)).toThrow(/Tectonic/);
    expect(() => requirePdfToolchain(toolchain)).toThrow(/pdfinfo/);
  });

  it("does not fail when the toolchain is complete", () => {
    const toolchain = {
      tectonic: "tectonic",
      pdfInfo: "pdfinfo",
      available: true,
      missing: [],
    };

    expect(() => requirePdfToolchain(toolchain)).not.toThrow();
    expect(describeMissingToolchain(toolchain)).toBe(
      "The real PDF toolchain is available.",
    );
  });

  it("prefers the configured binary paths over the fallback names", () => {
    const previousTectonic = process.env.TECTONIC_BINARY;
    const previousPdfInfo = process.env.PDFINFO_BINARY;
    process.env.TECTONIC_BINARY = "/custom/tectonic";
    process.env.PDFINFO_BINARY = "/custom/pdfinfo";
    try {
      const toolchain = detectPdfToolchain();
      expect(toolchain.tectonic).toBe("/custom/tectonic");
      expect(toolchain.pdfInfo).toBe("/custom/pdfinfo");
    } finally {
      if (previousTectonic === undefined) delete process.env.TECTONIC_BINARY;
      else process.env.TECTONIC_BINARY = previousTectonic;
      if (previousPdfInfo === undefined) delete process.env.PDFINFO_BINARY;
      else process.env.PDFINFO_BINARY = previousPdfInfo;
    }
  });
});
