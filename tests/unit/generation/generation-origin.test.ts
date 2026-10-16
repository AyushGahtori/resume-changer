import { describe, expect, it } from "vitest";
import { getGenerationOriginNotice } from "../../../src/lib/generation/generation-origin";

describe("resume generation origin notice", () => {
  it("identifies manual resume assembly as internal and without AI rewriting", () => {
    expect(getGenerationOriginNotice("manual")).toBe(
      "Generated internally by Resume Changer from your selected evidence. AI did not rewrite the content.",
    );
  });

  it("explains that the internal fallback kept source wording when AI is unavailable", () => {
    expect(getGenerationOriginNotice("auto", "originals-fallback")).toBe(
      "Generated internally by Resume Changer from your source evidence. AI was unavailable, so the original wording was kept.",
    );
  });

  it("distinguishes internal assembly from AI-assisted wording", () => {
    expect(getGenerationOriginNotice("guided", "ai")).toBe(
      "Generated internally by Resume Changer using AI-assisted wording.",
    );
  });
});
