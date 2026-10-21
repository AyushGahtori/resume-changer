import { describe, expect, it } from "vitest";
import { isJdUrlExtractionAvailable } from "../../src/lib/jd-url-extraction-availability";

describe("JD URL extraction availability", () => {
  it("is unavailable because no approved extraction service exists", () => {
    expect(isJdUrlExtractionAvailable()).toBe(false);
  });
});
