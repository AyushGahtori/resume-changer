import { describe, expect, it } from "vitest";
import {
  describeCompiledPdf,
  formatPageCount,
  formatPageFill,
  readPageCount,
} from "../../../src/lib/generation/preview-metadata";

describe("compile response facts", () => {
  it("reads the page count the compile response reported", () => {
    expect(readPageCount("1")).toBe(1);
    expect(readPageCount("3")).toBe(3);
  });

  it("treats a missing or unusable page count as unknown", () => {
    expect(readPageCount(null)).toBeNull();
    expect(readPageCount("")).toBeNull();
    expect(readPageCount("many")).toBeNull();
    expect(readPageCount("0")).toBeNull();
    expect(readPageCount("1.5")).toBeNull();
  });

  it("names the page count in plain language", () => {
    expect(formatPageCount(1)).toBe("1 page");
    expect(formatPageCount(2)).toBe("2 pages");
    expect(formatPageCount(null)).toBe("");
    expect(formatPageCount(0)).toBe("");
  });

  it("rounds the measured page fill and drops an unusable value", () => {
    expect(formatPageFill(0.94)).toBe("94% page fill");
    expect(formatPageFill(0)).toBe("");
    expect(formatPageFill(null)).toBe("");
    expect(formatPageFill(Number.NaN)).toBe("");
  });
});

describe("compiled PDF status", () => {
  it("states the page count the response provided", () => {
    expect(describeCompiledPdf({ pageCount: 1 })).toBe("PDF ready · 1 page.");
  });

  it("adds the page fill only when the layout analysis provided it", () => {
    expect(
      describeCompiledPdf({ pageCount: 1, utilization: 0.94 }),
    ).toBe("PDF ready · 1 page · 94% page fill.");
    expect(describeCompiledPdf({ pageCount: 1 })).toBe("PDF ready · 1 page.");
  });

  it("never invents a page count", () => {
    expect(describeCompiledPdf({})).toBe("PDF ready.");
    expect(describeCompiledPdf({ pageCount: null, utilization: 0.5 })).toBe(
      "PDF ready · 50% page fill.",
    );
  });
});
