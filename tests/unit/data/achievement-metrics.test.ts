import { describe, expect, it } from "vitest";
import { formatMetricValue } from "../../../src/lib/data/achievement-metrics";

describe("metric value formatting", () => {
  it("shows the number on its own when the metric has no unit", () => {
    expect(formatMetricValue({ value: "28" })).toEqual({
      value: "28",
      unit: null,
      prefix: "",
      suffix: "",
      text: "28",
    });
  });

  it("keeps a symbol unit attached to the number", () => {
    expect(formatMetricValue({ value: "28", unit: "%" })).toEqual({
      value: "28",
      unit: "%",
      prefix: "",
      suffix: "%",
      text: "28%",
    });
  });

  it("separates a written unit with a space", () => {
    expect(formatMetricValue({ value: "180", unit: "ms" }).text).toBe("180 ms");
    expect(formatMetricValue({ value: "3", unit: "days" }).text).toBe("3 days");
  });

  it("writes a currency unit in front of the number", () => {
    expect(formatMetricValue({ value: "28", unit: "$" }).text).toBe("$28");
    expect(formatMetricValue({ value: "28", unit: "USD" }).text).toBe("28 USD");
  });

  it("keeps a signed value and a compound unit as they are", () => {
    expect(formatMetricValue({ value: "+28", unit: "%" }).text).toBe("+28%");
    expect(formatMetricValue({ value: "1200", unit: "requests/s" }).text).toBe(
      "1200 requests/s",
    );
  });

  it("trims the padding around the stored text", () => {
    expect(formatMetricValue({ value: " 28 ", unit: " % " }).text).toBe("28%");
  });

  it("keeps a long numeric value exact", () => {
    const value = "1234567";
    expect(formatMetricValue({ value, unit: "requests" }).text).toBe(
      "1234567 requests",
    );
  });
});
