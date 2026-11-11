import { describe, expect, it } from "vitest";
import { SavedJobError } from "@/lib/jobs/saved-job-error";
import {
  nextStoredJobCount,
  readStoredJobCount,
} from "@/lib/jobs/saved-job-record";

describe("hosted saved-job capacity", () => {
  it("reads only a non-negative integer counter", () => {
    expect(readStoredJobCount(12)).toBe(12);
    expect(readStoredJobCount(0)).toBe(0);
    expect(readStoredJobCount(undefined)).toBeNull();
    expect(readStoredJobCount(12.5)).toBeNull();
    expect(readStoredJobCount(-1)).toBeNull();
  });

  it("increments on create, keeps the total on update, and decrements on delete", () => {
    expect(nextStoredJobCount(null, 39, "create")).toBe(40);
    expect(nextStoredJobCount(10, 0, "update")).toBe(10);
    expect(nextStoredJobCount(1, 40, "delete")).toBe(0);
    expect(nextStoredJobCount(null, 4, "delete")).toBe(3);
  });

  it("rejects a create once the account already has 40 saved analyses", () => {
    expect(() => nextStoredJobCount(40, 0, "create")).toThrow(SavedJobError);
    expect(() => nextStoredJobCount(null, 40, "create")).toThrow(
      /40 saved analyses/,
    );
    expect(nextStoredJobCount(40, 0, "update")).toBe(40);
  });
});
