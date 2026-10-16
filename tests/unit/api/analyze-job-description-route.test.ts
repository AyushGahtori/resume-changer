import { beforeEach, describe, expect, it, vi } from "vitest";

const { analyzeJobDescription } = vi.hoisted(() => ({
  analyzeJobDescription: vi.fn(),
}));

vi.mock("@/lib/ai/provider-factory", () => ({
  createAiProvider: () => ({ analyzeJobDescription }),
}));

import { POST } from "@/app/api/ai/analyze-job-description/route";
import { AiProviderError } from "@/lib/ai/provider";

const result = {
  targetTitle: "Software Engineer",
  seniority: "Entry level",
  requiredQualifications: ["Computer Science degree"],
  preferredQualifications: ["Go experience"],
  responsibilities: ["Build distributed services"],
  toolsAndPlatforms: ["Go"],
  domainConcepts: ["Machine learning infrastructure"],
  atsTerms: ["GPU serving"],
  inferredContext: ["The role likely supports production systems."],
  terminology: [{ term: "machine learning", alternatives: ["ML"] }],
};

function post(body: string, runId?: string) {
  return POST(
    new Request("http://localhost/api/ai/analyze-job-description", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(runId ? { "X-Resume-Run-Id": runId } : {}),
      },
      body,
    }),
  );
}

describe("POST /api/ai/analyze-job-description", () => {
  beforeEach(() => {
    analyzeJobDescription.mockReset();
  });

  it("validates the JD and returns the provider's structured analysis", async () => {
    analyzeJobDescription.mockResolvedValue(result);
    const response = await post(
      JSON.stringify({
        company: "Example",
        roleTitle: "Software Engineer",
        jobDescription: "Build distributed services.",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ analysis: result });
    expect(analyzeJobDescription).toHaveBeenCalledWith({
      company: "Example",
      roleTitle: "Software Engineer",
      jobDescription: "Build distributed services.",
    });
  });

  it("returns correlated request, validation, and analysis diagnostics when requested by the browser", async () => {
    analyzeJobDescription.mockResolvedValue(result);
    const response = await post(
      JSON.stringify({ jobDescription: "Build distributed services." }),
      "analysis-run-test",
    );
    const body = await response.json();

    expect(body.runId).toBe("analysis-run-test");
    expect(body.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "analysis.request",
          data: { jobDescription: "Build distributed services." },
        }),
        expect.objectContaining({ stage: "analysis.validation" }),
        expect.objectContaining({ stage: "analysis.complete", data: result }),
      ]),
    );
  });

  it("rejects malformed JSON, missing fields, and oversized descriptions before calling AI", async () => {
    const malformed = await post("{bad json");
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({
      code: "INVALID_REQUEST",
    });

    const missing = await post(JSON.stringify({ roleTitle: "Engineer" }));
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toMatchObject({
      error: "Enter a job description of 1 to 30,000 characters.",
      code: "INVALID_REQUEST",
    });

    const oversized = await post(
      JSON.stringify({ jobDescription: "x".repeat(30_001) }),
    );
    expect(oversized.status).toBe(400);
    expect(analyzeJobDescription).not.toHaveBeenCalled();
  });

  it("returns safe retryable provider errors with appropriate status", async () => {
    analyzeJobDescription.mockRejectedValue(
      new AiProviderError("Try again shortly.", "SERVICE_UNAVAILABLE", true),
    );
    const response = await post(
      JSON.stringify({ jobDescription: "Build services." }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Try again shortly.",
      code: "SERVICE_UNAVAILABLE",
      retryable: true,
    });
  });

  it("rejects a provider result that does not satisfy the shared Zod schema", async () => {
    analyzeJobDescription.mockResolvedValue({
      ...result,
      requiredQualifications: "not an array",
    });
    const response = await post(
      JSON.stringify({ jobDescription: "Build services." }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_RESPONSE",
      retryable: true,
    });
  });

  it("hides unexpected provider exceptions", async () => {
    analyzeJobDescription.mockRejectedValue(
      new Error("private upstream detail"),
    );
    const response = await post(
      JSON.stringify({ jobDescription: "Build services." }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Job description analysis failed. Try again.",
      code: "ANALYSIS_FAILED",
      retryable: true,
    });
  });
});
