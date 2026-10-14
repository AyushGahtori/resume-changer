import { describe, expect, it } from "vitest";
import { createGeminiProvider } from "../../../src/lib/ai/gemini-provider";

const liveTestEnabled = process.env.GEMINI_LIVE_TEST === "1";

describe.skipIf(!liveTestEnabled)("Gemini live integration", () => {
  it("analyzes a job description into the Task 13 contract", async () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is required for this test.");

    const provider = createGeminiProvider({
      apiKey,
      model: process.env.GEMINI_LIVE_MODEL ?? process.env.GEMINI_MODEL,
    });
    const result = await provider.analyzeJobDescription({
      company: "Example AI",
      roleTitle: "Machine Learning Platform Engineer",
      jobDescription:
        "Build and maintain scalable infrastructure for production machine learning models. Develop distributed systems, optimize GPU model serving for latency and cost, and build Python tools that improve ML engineer productivity. Required: Python and distributed systems experience.",
    });

    expect(result.targetTitle.toLowerCase()).toContain("machine learning");
    expect(result.requiredQualifications.length).toBeGreaterThan(0);
    expect(result.responsibilities.length).toBeGreaterThan(0);
    expect(result.toolsAndPlatforms.join(" ").toLowerCase()).toContain(
      "python",
    );
  }, 60_000);
});
