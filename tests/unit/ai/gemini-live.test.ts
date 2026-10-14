import { describe, expect, it } from "vitest";
import { createGeminiProvider } from "../../../src/lib/ai/gemini-provider";
import { JobAnalysisResultSchema } from "../../../src/lib/ai/contracts";

const liveTestEnabled = process.env.GEMINI_LIVE_TEST === "1";

describe.skipIf(!liveTestEnabled)("Gemini live integration", () => {
  it("returns schema-valid role signals and keeps required and preferred separate", async () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is required for this test.");

    const provider = createGeminiProvider({
      apiKey,
      model: process.env.GEMINI_LIVE_MODEL ?? "gemini-2.5-flash-lite",
    });
    const result = await provider.analyzeJobDescription({
      company: "Example AI",
      roleTitle: "Machine Learning Platform Engineer",
      jobDescription: `Role: Machine Learning Platform Engineer, early career.
Required qualifications: Python programming and distributed systems experience.
Preferred qualifications: familiarity with Kubernetes.
Responsibilities: Build scalable production ML infrastructure and optimize GPU model serving latency.
Tools: Python and Kubernetes.`,
    });
    const validated = JobAnalysisResultSchema.parse(result);

    expect(validated.targetTitle.toLowerCase()).toContain("machine learning");
    expect(validated.seniority.toLowerCase()).toMatch(/early|entry|junior|new/);
    expect(validated.requiredQualifications.join(" ").toLowerCase()).toMatch(
      /python|distributed systems/,
    );
    expect(validated.preferredQualifications.join(" ").toLowerCase()).toContain(
      "kubernetes",
    );
    expect(
      validated.requiredQualifications.join(" ").toLowerCase(),
    ).not.toContain("kubernetes");
    expect(validated.responsibilities.join(" ").toLowerCase()).toMatch(
      /gpu|infrastructure|production/,
    );
    expect(validated.toolsAndPlatforms.join(" ").toLowerCase()).toContain(
      "python",
    );
  }, 60_000);
});
