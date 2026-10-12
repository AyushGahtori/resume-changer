import { describe, expect, it } from "vitest";
import { createResumeFilename } from "../../../src/lib/generation/resume-filename";

describe("resume export filename", () => {
  it("normalizes company and role text into a safe filename", () => {
    expect(createResumeFilename("Café & Co.", "Senior Platform Engineer")).toBe(
      "cafe-co-senior-platform-engineer.tex",
    );
  });

  it("uses a fallback when both labels have no filename characters", () => {
    expect(createResumeFilename("東京", "工程師")).toBe("resume.tex");
  });
});
