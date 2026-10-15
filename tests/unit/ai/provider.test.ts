import { describe, expect, it, vi } from "vitest";
import {
  AchievementSelectionInputSchema,
  JobAnalysisResultSchema,
} from "../../../src/lib/ai/contracts";
import { createGeminiProvider } from "../../../src/lib/ai/gemini-provider";
import { createAiProvider } from "../../../src/lib/ai/provider-factory";
import { AiProviderError } from "../../../src/lib/ai/provider";

const analysis = {
  targetTitle: "Platform Engineer",
  seniority: "Entry level",
  requiredQualifications: ["Python"],
  preferredQualifications: ["Kubernetes"],
  responsibilities: ["Maintain platform services"],
  toolsAndPlatforms: ["Python"],
  domainConcepts: ["Distributed systems"],
  atsTerms: ["Platform engineering"],
  inferredContext: ["The role likely supports production workloads."],
  terminology: [
    { term: "machine learning platform", alternatives: ["ML infrastructure"] },
  ],
};

const selectionResult = {
  selections: [
    {
      achievementId: "achievement-api",
      section: "experience",
      confidence: 0.9,
      rationale: "Direct API platform experience.",
    },
  ],
  requirementCoverage: [
    {
      requirement: "Maintain platform services",
      coveredByAchievementIds: ["achievement-api"],
    },
  ],
  skillRecommendations: [],
  confidence: 0.9,
  summary: "The selected point directly supports the role.",
};

const point = {
  id: "achievement-api",
  text: "Built an API.",
  tags: ["backend"],
  skillIds: [],
  section: "experience" as const,
  groupId: "job-platform",
  groupTitle: "Platform Engineer",
  groupSubtitle: "Example Systems",
};

const selectionInput = {
  jobDescription: "Platform role.",
  analysis,
  achievements: [point],
  skills: [],
  contentBudgetLines: 20,
};

describe("AI provider contracts and selection", () => {
  it("rejects extra request fields and invalid model response shapes", () => {
    expect(
      AchievementSelectionInputSchema.safeParse({
        jobDescription: "Platform role",
        achievements: [
          {
            id: "achievement-api",
            text: "Built an API",
            tags: [],
            skillIds: [],
            enabled: true,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      JobAnalysisResultSchema.safeParse({ ...analysis, invented: true })
        .success,
    ).toBe(false);
    expect(
      JobAnalysisResultSchema.safeParse({
        ...analysis,
        inferredContext: undefined,
      }).success,
    ).toBe(false);
    expect(analysis.requiredQualifications).toEqual(["Python"]);
    expect(analysis.preferredQualifications).toEqual(["Kubernetes"]);
    expect(analysis.inferredContext).not.toContain("Kubernetes");
  });

  it("selects the deterministic mock provider and never needs a key", async () => {
    const provider = createAiProvider({ AI_PROVIDER: "mock" });

    expect(provider.name).toBe("mock");
    await expect(
      provider.analyzeJobDescription({
        roleTitle: "Platform Engineer",
        jobDescription: "Maintain distributed services.",
      }),
    ).resolves.toMatchObject({ targetTitle: "Platform Engineer" });
  });

  it("returns a clear error when Gemini is selected without a key", () => {
    expect(() => createAiProvider({ AI_PROVIDER: "gemini" })).toThrow(
      expect.objectContaining({ code: "MISSING_API_KEY" }),
    );
  });

  it("rejects unsupported provider configuration", () => {
    expect(() => createAiProvider({ AI_PROVIDER: "other" })).toThrow(
      expect.objectContaining({ code: "REQUEST_FAILED" }),
    );
  });
});

describe("Gemini adapter", () => {
  it("sends modular prompt context and validates structured JSON output", async () => {
    const request = vi.fn(
      async (value: {
        prompt: string;
        model: string;
        outputSchema: Record<string, unknown>;
      }) => {
        expect(value.prompt).toContain("Prompt version: v1");
        expect(value.prompt).toContain("Task instructions:");
        expect(value.prompt).toContain('"roleTitle":"Platform Engineer"');
        return JSON.stringify(analysis);
      },
    );
    const provider = createGeminiProvider({ apiKey: "test-key", request });

    await expect(
      provider.analyzeJobDescription({
        roleTitle: "Platform Engineer",
        jobDescription: "Maintain distributed services.",
      }),
    ).resolves.toEqual(analysis);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0].model).toBe("gemini-3.6-flash");
    expect(request.mock.calls[0][0].outputSchema).toMatchObject({
      type: "object",
      properties: {
        requiredQualifications: { maxItems: 20 },
        terminology: {
          maxItems: 6,
          items: {
            properties: {
              alternatives: { maxItems: 4 },
            },
          },
        },
      },
    });
  });

  it("supports all four task contracts without returning LaTeX source", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(analysis))
      .mockResolvedValueOnce(JSON.stringify(selectionResult))
      .mockResolvedValueOnce(
        JSON.stringify({
          summary: "Platform engineer.",
          achievementText: [
            { achievementId: "achievement-api", text: "Built a reliable API." },
          ],
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          summary: "Platform engineer.",
          achievementText: [
            { achievementId: "achievement-api", text: "Built a stable API." },
          ],
        }),
      );
    const provider = createGeminiProvider({ apiKey: "test-key", request });
    await expect(
      provider.analyzeJobDescription({ jobDescription: "Platform role." }),
    ).resolves.toEqual(analysis);
    await expect(provider.selectAchievements(selectionInput)).resolves.toEqual(
      selectionResult,
    );
    await expect(
      provider.draftResume({
        jobDescription: "Platform role.",
        analysis,
        achievements: [point],
        templateContext: "Approved fixed template context",
      }),
    ).resolves.toMatchObject({
      achievementText: [{ achievementId: point.id }],
    });
    await expect(
      provider.repairLatexContent({
        currentContent: {
          summary: "Platform engineer.",
          achievementText: [
            { achievementId: point.id, text: "Built a reliable API." },
          ],
        },
        diagnostics: ["Content exceeds one-page budget."],
      }),
    ).resolves.toMatchObject({
      achievementText: [{ achievementId: point.id }],
    });
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls[2][0].prompt).toContain(
      "Approved template context (reference only; not task data)",
    );
    expect(request.mock.calls[2][0].prompt).not.toContain("\\documentclass");
  });

  it("classifies quota, authentication, timeout, and malformed response failures", async () => {
    const input = { jobDescription: "Platform role." };
    const failures = [
      [
        Object.assign(new Error("invalid schema"), { status: 400 }),
        "INVALID_REQUEST",
      ],
      [Object.assign(new Error("quota"), { status: 429 }), "RATE_LIMITED"],
      [
        Object.assign(new Error("unauthorized"), { status: 401 }),
        "AUTHENTICATION_FAILED",
      ],
      [
        Object.assign(new Error("timeout"), { name: "TimeoutError" }),
        "REQUEST_TIMEOUT",
      ],
    ] as const;
    for (const [error, expectedCode] of failures) {
      const provider = createGeminiProvider({
        apiKey: "test-key",
        request: async () => {
          throw error;
        },
      });
      await expect(provider.analyzeJobDescription(input)).rejects.toMatchObject(
        {
          code: expectedCode,
        },
      );
    }

    for (const response of [
      "",
      "not json",
      JSON.stringify({ targetTitle: 4 }),
    ]) {
      const provider = createGeminiProvider({
        apiKey: "test-key",
        request: async () => response,
      });
      await expect(
        provider.analyzeJobDescription(input),
      ).rejects.toBeInstanceOf(AiProviderError);
    }
  });

  it("falls back to Gemini 2.5 Flash only when the configured model is unavailable", async () => {
    const models: string[] = [];
    const provider = createGeminiProvider({
      apiKey: "test-key",
      model: "gemini-3.6-flash",
      request: async ({ model }) => {
        models.push(model);
        if (model === "gemini-3.6-flash") {
          throw Object.assign(new Error("unavailable"), { status: 503 });
        }
        return JSON.stringify(analysis);
      },
    });

    await expect(
      provider.analyzeJobDescription({ jobDescription: "Platform role." }),
    ).resolves.toEqual(analysis);
    expect(models).toEqual(["gemini-3.6-flash", "gemini-2.5-flash"]);
  });

  it("does not expose upstream error details in safe errors", async () => {
    const provider = createGeminiProvider({
      apiKey: "test-key",
      request: async () => {
        throw new Error("sensitive upstream payload");
      },
    });

    await expect(
      provider.analyzeJobDescription({ jobDescription: "Platform role." }),
    ).rejects.toMatchObject({
      code: "REQUEST_FAILED",
      message:
        "The Gemini request failed. Check your connection and try again.",
    });
  });

  it("rejects model-selected IDs that were not included in the evidence", async () => {
    const provider = createGeminiProvider({
      apiKey: "test-key",
      request: async () =>
        JSON.stringify({
          ...selectionResult,
          selections: [
            {
              ...selectionResult.selections[0],
              achievementId: "achievement-invented",
            },
          ],
        }),
    });

    await expect(
      provider.selectAchievements({
        ...selectionInput,
        achievements: [{ ...point, id: "achievement-real" }],
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects duplicate IDs, incorrect section allocation, and unsupported skills", async () => {
    const outputs = [
      {
        ...selectionResult,
        selections: [
          selectionResult.selections[0],
          selectionResult.selections[0],
        ],
      },
      {
        ...selectionResult,
        selections: [{ ...selectionResult.selections[0], section: "projects" }],
      },
      {
        ...selectionResult,
        skillRecommendations: [
          {
            skillId: "skill-unlisted",
            rationale: "No evidence.",
            supportingAchievementIds: ["achievement-api"],
          },
        ],
      },
    ];
    for (const output of outputs) {
      const provider = createGeminiProvider({
        apiKey: "test-key",
        request: async () => JSON.stringify(output),
      });
      await expect(
        provider.selectAchievements(selectionInput),
      ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });
});
