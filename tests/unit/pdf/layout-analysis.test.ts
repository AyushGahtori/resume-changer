import { describe, expect, it } from "vitest";
import {
  analyzePdfLayout,
  layoutFromPageTextBoxes,
  layoutFromTextBoxes,
} from "../../../src/lib/pdf/layout-analysis";

function createSinglePagePdf(text: string): Uint8Array {
  const escapedText = text
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
  const stream = `BT /F1 12 Tf 72 720 Td (${escapedText}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (const [index, body] of objects.entries()) {
    offsets.push(new TextEncoder().encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }

  const xrefOffset = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}

describe("PDF content measurements", () => {
  it("measures visible text, usable height and actual bottom gap", () => {
    const layout = layoutFromTextBoxes(
      [
        { text: "Example resume", x: 40, y: 748, width: 120, height: 10 },
        {
          text: "Substantial achievement",
          x: 40,
          y: 70,
          width: 180,
          height: 10,
        },
      ],
      612,
      792,
    );
    expect(layout.visibleWordCount).toBe(4);
    expect(layout.utilization).toBeGreaterThan(0.94);
    expect(layout.utilization).toBeLessThan(0.97);
    expect(layout.clipped).toBe(false);
    expect(layout.bottomGap).toBeCloseTo(35.6);
  });
  it("detects underfill, horizontal clipping, multi-page output and image-only documents", () => {
    expect(
      layoutFromTextBoxes(
        [{ text: "Short", x: 40, y: 450, width: 50, height: 10 }],
        612,
        792,
      ).utilization,
    ).toBeLessThan(0.5);
    expect(
      layoutFromTextBoxes(
        [{ text: "Wide", x: 5, y: 450, width: 600, height: 10 }],
        612,
        792,
        2,
      ),
    ).toMatchObject({ pageCount: 2, clipped: true });
    expect(() => layoutFromTextBoxes([], 612, 792)).toThrow(/no readable text/);
  });

  it("separates first-page content from overflow text and counts only overflow words", () => {
    const result = layoutFromPageTextBoxes(
      [
        [{ text: "First page content", x: 40, y: 700, width: 150, height: 12 }],
        [
          {
            text: "Words left for page two",
            x: 40,
            y: 700,
            width: 180,
            height: 12,
          },
        ],
      ],
      612,
      792,
    );

    expect(result).toMatchObject({
      layout: { pageCount: 2, visibleWordCount: 3 },
      firstPageText: "First page content",
      overflowText: "Words left for page two",
      overflowWordCount: 5,
      text: "First page content Words left for page two",
    });
  });

  it("loads PDF.js and extracts text without a local TeX toolchain", async () => {
    const analysis = await analyzePdfLayout(
      createSinglePagePdf("PDF parser smoke test"),
    );

    expect(analysis.layout.pageCount).toBe(1);
    expect(analysis.layout.visibleWordCount).toBe(4);
    expect(analysis.text).toContain("PDF parser smoke test");
  });
});
