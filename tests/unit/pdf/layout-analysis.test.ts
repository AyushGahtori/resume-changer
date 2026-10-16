import { describe, expect, it } from "vitest";
import { layoutFromTextBoxes } from "../../../src/lib/pdf/layout-analysis";

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
});
