import { describe, expect, it } from "vitest";
import {
  formatExperienceRange,
  formatMonth,
} from "../../../src/lib/data/experience-dates";

describe("experience date formatting", () => {
  it("formats a stored year and month as a readable month and year", () => {
    expect(formatMonth("2023-01")).toEqual({
      value: "2023-01",
      label: "Jan 2023",
    });
    expect(formatMonth("2024-12")).toEqual({
      value: "2024-12",
      label: "Dec 2024",
    });
  });

  it("treats an absent or malformed value as no date at all", () => {
    expect(formatMonth(undefined)).toBeNull();
    expect(formatMonth(null)).toBeNull();
    expect(formatMonth("")).toBeNull();
    expect(formatMonth("2023")).toBeNull();
    expect(formatMonth("2023-13")).toBeNull();
    expect(formatMonth("2023-00")).toBeNull();
    expect(formatMonth("23-01")).toBeNull();
    expect(formatMonth("2023/01")).toBeNull();
    expect(formatMonth(202301)).toBeNull();
  });

  it("shows a start and an end month for a finished role", () => {
    const range = formatExperienceRange("2024-02", "2024-08");

    expect(range).toEqual({
      start: { value: "2024-02", label: "Feb 2024" },
      end: { value: "2024-08", label: "Aug 2024" },
      present: false,
    });
  });

  it("shows Present only when the stored end date is null", () => {
    const range = formatExperienceRange("2023-01", null);

    expect(range).toEqual({
      start: { value: "2023-01", label: "Jan 2023" },
      end: null,
      present: true,
    });
  });

  it("never shows Present for an absent end date", () => {
    const absent = formatExperienceRange("2023-01", undefined);

    expect(absent).toEqual({
      start: { value: "2023-01", label: "Jan 2023" },
      end: null,
      present: false,
    });
  });

  it("never shows Present for a malformed end date", () => {
    const malformed = formatExperienceRange("2023-01", "2023-13");

    expect(malformed).toEqual({
      start: { value: "2023-01", label: "Jan 2023" },
      end: null,
      present: false,
    });
  });

  it("omits the range entirely when the source holds no usable date", () => {
    expect(formatExperienceRange(undefined, undefined)).toBeNull();
    expect(formatExperienceRange(null, undefined)).toBeNull();
    expect(formatExperienceRange("", "not-a-date")).toBeNull();
  });

  it("keeps a usable end month when the start date is missing", () => {
    const range = formatExperienceRange(undefined, "2024-08");

    expect(range).toEqual({
      start: null,
      end: { value: "2024-08", label: "Aug 2024" },
      present: false,
    });
  });
});
