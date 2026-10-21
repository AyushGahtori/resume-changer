import { describe, expect, it, vi } from "vitest";
import {
  AchievementSelectionInputSchema,
  JobAnalysisResultSchema,
} from "../../../src/lib/ai/contracts";
import {
  createGeminiProvider,
  DEFAULT_MODEL,
  FALLBACK_MODEL,
  REQUEST_TIMEOUT_MS,
} from "../../../src/lib/ai/gemini-provider";
import { createAiProvider } from "../../../src/lib/ai/provider-factory";
import { AiProviderError } from "../../../src/lib/ai/provider";
import { createTailoringResponse } from "../../../src/lib/ai/tailor-achievements";
import { createResumeDraftHandoff } from "../../helpers/resume-draft-handoff";

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
  it("keeps the request budget above the measured free-tier latency", () => {
    // A measured structured-output request on a Gemini free-tier flash-lite
    // model takes 20 to 60 seconds, and the timeout is sent upstream as a
    // deadline, so a budget below that range kills the request before the
    // model can answer. Sixty seconds is the floor; the budget leaves room
    // for the slowest measured response.
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });

  it("sends modular prompt context and validates structured JSON output", async () => {
    const request = vi.fn(
      async (value: {
        prompt: string;
        model: string;
        outputSchema: Record<string, unknown>;
      }) => {
        expect(value.prompt).toContain("Prompt version: v2-evidence-quality");
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
    expect(request.mock.calls[0][0].model).toBe(DEFAULT_MODEL);
    expect(request.mock.calls[0][0].outputSchema).toMatchObject({
      type: "object",
      properties: {
        requiredQualifications: { type: "array" },
        terminology: {
          type: "array",
          items: {
            properties: {
              alternatives: { type: "array" },
            },
          },
        },
      },
    });
    expect(JSON.stringify(request.mock.calls[0][0].outputSchema)).not.toMatch(
      /"(?:maxItems|minItems)"/,
    );
    expect(
      JobAnalysisResultSchema.safeParse({
        ...analysis,
        requiredQualifications: Array.from({ length: 101 }, () => "Python"),
      }).success,
    ).toBe(false);
  });

  it("retries with the fallback model and returns validated analysis without exposing credentials", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("Unavailable"), { status: 503 }),
      )
      .mockResolvedValueOnce(JSON.stringify(analysis));
    const provider = createGeminiProvider({
      apiKey: "do-not-log-this-key",
      request,
    });

    await expect(
      provider.analyzeJobDescription({
        roleTitle: "Platform Engineer",
        jobDescription: "Maintain distributed services.",
      }),
    ).resolves.toEqual(analysis);

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0]).toMatchObject({
      model: "gemini-3.6-flash",
    });
    expect(request.mock.calls[1][0]).toMatchObject({
      model: FALLBACK_MODEL,
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
        handoff: createResumeDraftHandoff({
          achievementId: point.id,
          text: point.text,
          groupId: point.groupId,
          groupTitle: point.groupTitle,
        }),
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

  it("makes one targeted correction for a missing supported JD phrase", async () => {
    const input = {
      jobDescription: "Apply Infrastructure as Code.",
      analysis: { ...analysis, atsTerms: ["Infrastructure as Code"] },
      achievements: [{ ...point, supportedSkills: ["Infrastructure as Code"] }],
      handoff: createResumeDraftHandoff({
        achievementId: point.id,
        text: point.text,
      }),
    };
    const initial = {
      summary: "Draft",
      achievementText: [{ achievementId: point.id, text: "Built an API." }],
    };
    const corrected = {
      summary: "Draft",
      achievementText: [
        {
          achievementId: point.id,
          text: "Built an API using Infrastructure as Code.",
        },
      ],
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(initial))
      .mockResolvedValueOnce(JSON.stringify(corrected));
    const provider = createGeminiProvider({
      apiKey: "test-key",
      model: "gemini-2.5-flash-lite",
      request,
    });
    expect(await provider.draftResume(input)).toEqual(corrected);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0].prompt).toContain(
      "Server correction instructions:",
    );
    expect(request.mock.calls[1][0].prompt).toContain("Infrastructure as Code");
  });

  it("bounds quality correction and keeps the initial draft after a repeated omission", async () => {
    const input = {
      jobDescription: "Apply Infrastructure as Code.",
      analysis: { ...analysis, atsTerms: ["Infrastructure as Code"] },
      achievements: [{ ...point, supportedSkills: ["Infrastructure as Code"] }],
      handoff: createResumeDraftHandoff({
        achievementId: point.id,
        text: point.text,
      }),
    };
    const initial = {
      summary: "Draft",
      achievementText: [{ achievementId: point.id, text: "Built an API." }],
    };
    const request = vi.fn().mockResolvedValue(JSON.stringify(initial));
    const provider = createGeminiProvider({
      apiKey: "test-key",
      model: "gemini-2.5-flash-lite",
      request,
    });

    // The correction attempt is bounded, and a correction that does not
    // improve on the original leaves the original draft in place.
    expect(await provider.draftResume(input)).toEqual(initial);
    expect(request.mock.calls.length).toBeGreaterThan(1);
  });

  it("keeps a valid draft when the correction fails and discloses the omission", async () => {
    const input = {
      jobDescription: "Apply Infrastructure as Code.",
      analysis: { ...analysis, atsTerms: ["Infrastructure as Code"] },
      achievements: [{ ...point, supportedSkills: ["Infrastructure as Code"] }],
      handoff: createResumeDraftHandoff({
        achievementId: point.id,
        text: point.text,
      }),
    };
    const initial = {
      summary: "Draft",
      achievementText: [{ achievementId: point.id, text: "Built an API." }],
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(initial))
      .mockRejectedValue(Object.assign(new Error("quota"), { status: 429 }));
    const provider = createGeminiProvider({
      apiKey: "test-key",
      model: "gemini-2.5-flash-lite",
      request,
      sleep: async () => {},
    });

    // A rate limit during the correction must not discard a draft that is
    // otherwise valid and grounded. The omitted phrase is disclosed in the
    // response quality notes instead, so the omission is visible to the
    // person reviewing the wording.
    const result = await provider.draftResume(input);
    expect(result).toEqual(initial);

    const response = createTailoringResponse({ input, result });
    expect(response.proposals[0].qualityNotes?.join(" ")).toContain(
      "Infrastructure as Code",
    );
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
      [
        // The request deadline is sent to the upstream, so a request that
        // runs past it comes back as HTTP 504 rather than as an abort.
        Object.assign(
          new Error(
            JSON.stringify({
              error: {
                code: 504,
                message: "Deadline exceeded before operation could complete.",
                status: "DEADLINE_EXCEEDED",
              },
            }),
          ),
          { status: 504 },
        ),
        "REQUEST_TIMEOUT",
      ],
    ] as const;
    for (const [error, expectedCode] of failures) {
      const provider = createGeminiProvider({
        apiKey: "test-key",
        request: async () => {
          throw error;
        },
        sleep: async () => {},
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

  it("falls back to Gemini 2.5 Flash-Lite when the configured model is unavailable", async () => {
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
    expect(models).toEqual([DEFAULT_MODEL, FALLBACK_MODEL]);
  });

  it("retries malformed structured output with Gemini Flash-Lite", async () => {
    const models: string[] = [];
    const provider = createGeminiProvider({
      apiKey: "test-key",
      model: "gemini-3.6-flash",
      request: async ({ model }) => {
        models.push(model);
        return model === "gemini-3.6-flash"
          ? JSON.stringify({ targetTitle: 4 })
          : JSON.stringify(analysis);
      },
    });

    await expect(
      provider.analyzeJobDescription({ jobDescription: "Platform role." }),
    ).resolves.toEqual(analysis);
    expect(models).toEqual([DEFAULT_MODEL, FALLBACK_MODEL]);
  });

  it("waits out a short rate limit and retries the same model", async () => {
    const models: string[] = [];
    const waits: number[] = [];
    const request = vi.fn(async ({ model }: { model: string }) => {
      models.push(model);
      if (models.length === 1) {
        throw Object.assign(new Error("too many requests"), { status: 429 });
      }
      return JSON.stringify(analysis);
    });
    const provider = createGeminiProvider({
      apiKey: "test-key",
      model: "gemini-3.6-flash",
      request,
      sleep: async (milliseconds: number) => {
        waits.push(milliseconds);
      },
    });

    await expect(
      provider.analyzeJobDescription({ jobDescription: "Platform role." }),
    ).resolves.toEqual(analysis);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0].model).toBe(DEFAULT_MODEL);
    expect(request.mock.calls[1][0].model).toBe("gemini-3.6-flash");
    expect(waits.length).toBe(1);
  });

  it("moves to another model when the daily free-tier quota is exhausted", async () => {
    const models: string[] = [];
    const provider = createGeminiProvider({
      apiKey: "test-key",
      model: "gemini-3.6-flash",
      request: async ({ model }) => {
        models.push(model);
        if (model === "gemini-3.6-flash") {
          throw Object.assign(new Error("daily quota"), {
            status: 429,
            message: JSON.stringify({
              error: {
                details: [
                  {
                    "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                    violations: [
                      {
                        quotaId:
                          "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
                        quotaValue: "20",
                      },
                    ],
                  },
                  {
                    "@type": "type.googleapis.com/google.rpc.RetryInfo",
                    retryDelay: "65000s",
                  },
                ],
              },
            }),
          });
        }
        return JSON.stringify(analysis);
      },
      sleep: async () => {
        throw new Error("the daily quota must not be waited out");
      },
    });

    await expect(
      provider.analyzeJobDescription({ jobDescription: "Platform role." }),
    ).resolves.toEqual(analysis);
    expect(models[0]).toBe("gemini-3.6-flash");
    expect(models[1]).not.toBe("gemini-3.6-flash");
  });

  it("reports the upstream retry delay for a rate limit", async () => {
    const provider = createGeminiProvider({
      apiKey: "test-key",
      model: "gemini-3.6-flash",
      request: async () => {
        throw Object.assign(new Error("too many requests"), {
          status: 429,
          message: JSON.stringify({
            error: {
              details: [
                {
                  "@type": "type.googleapis.com/google.rpc.RetryInfo",
                  retryDelay: "29s",
                },
              ],
            },
          }),
        });
      },
      sleep: async () => {},
    });

    await expect(
      provider.analyzeJobDescription({ jobDescription: "Platform role." }),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
      retryAfterSeconds: 29,
    });
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
      diagnosticCode: "NETWORK_OR_UNKNOWN_ERROR",
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

  it("rejects duplicate achievement IDs and incorrect section allocation", async () => {
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

  it("retries the same model when a selection duplicates an achievement ID", async () => {
    const duplicated = {
      ...selectionResult,
      selections: [
        selectionResult.selections[0],
        selectionResult.selections[0],
      ],
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(duplicated))
      .mockResolvedValueOnce(JSON.stringify(selectionResult));
    const provider = createGeminiProvider({
      apiKey: "test-key",
      model: "gemini-2.5-flash-lite",
      request,
    });

    await expect(
      provider.selectAchievements(selectionInput),
    ).resolves.toMatchObject({
      selections: [
        expect.objectContaining({ achievementId: "achievement-api" }),
      ],
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0].model).toBe("gemini-2.5-flash-lite");
    expect(request.mock.calls[1][0].model).toBe("gemini-2.5-flash-lite");
  });

  it("retries the same model when a selection uses the wrong resume section", async () => {
    const wrongSection = {
      ...selectionResult,
      selections: [{ ...selectionResult.selections[0], section: "projects" }],
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(wrongSection))
      .mockResolvedValueOnce(JSON.stringify(selectionResult));
    const provider = createGeminiProvider({
      apiKey: "test-key",
      model: "gemini-2.5-flash-lite",
      request,
    });

    await expect(
      provider.selectAchievements(selectionInput),
    ).resolves.toMatchObject({
      selections: [
        expect.objectContaining({ achievementId: "achievement-api" }),
      ],
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("bounds retries for a selection that never grounds and then fails", async () => {
    const duplicated = {
      ...selectionResult,
      selections: [
        selectionResult.selections[0],
        selectionResult.selections[0],
      ],
    };
    const request = vi.fn().mockResolvedValue(JSON.stringify(duplicated));
    const provider = createGeminiProvider({
      apiKey: "test-key",
      model: "gemini-2.5-flash-lite",
      request,
    });

    await expect(
      provider.selectAchievements(selectionInput),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    // Each model in the chain gets a bounded number of attempts, so the
    // request cannot retry forever.
    expect(request.mock.calls.length).toBeGreaterThan(2);
    expect(request.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("falls back to the second model when a selection never grounds", async () => {
    const duplicated = {
      ...selectionResult,
      selections: [
        selectionResult.selections[0],
        selectionResult.selections[0],
      ],
    };
    const models: string[] = [];
    const provider = createGeminiProvider({
      apiKey: "test-key",
      model: "gemini-3.6-flash",
      request: async ({ model }) => {
        models.push(model);
        return model === "gemini-3.6-flash"
          ? JSON.stringify(duplicated)
          : JSON.stringify(selectionResult);
      },
    });

    await expect(
      provider.selectAchievements(selectionInput),
    ).resolves.toMatchObject({
      selections: [
        expect.objectContaining({ achievementId: "achievement-api" }),
      ],
    });
    expect(models).toContain(FALLBACK_MODEL);
  });

  it("drops unsupported optional skill suggestions without losing valid points", async () => {
    const provider = createGeminiProvider({
      apiKey: "test-key",
      request: async () =>
        JSON.stringify({
          ...selectionResult,
          skillRecommendations: [
            {
              skillId: "skill-terraform",
              rationale: "The selected point supports Terraform.",
              supportingAchievementIds: [
                "achievement-api",
                "achievement-other",
              ],
            },
            {
              skillId: "skill-unknown",
              rationale: "Unknown skills should not invalidate point matches.",
              supportingAchievementIds: ["achievement-api"],
            },
          ],
        }),
    });
    const result = await provider.selectAchievements({
      ...selectionInput,
      skills: [
        {
          id: "skill-terraform",
          name: "Terraform",
          aliases: [],
          isListedOnCurrentResume: false,
          evidenceAchievementIds: ["achievement-api"],
        },
      ],
    });

    expect(result.selections).toEqual(selectionResult.selections);
    expect(result.skillRecommendations).toEqual([
      expect.objectContaining({
        skillId: "skill-terraform",
        supportingAchievementIds: ["achievement-api"],
      }),
    ]);
  });

  it("keeps a JD-relevant skill without achievement evidence and preserves an informative summary", async () => {
    const provider = createGeminiProvider({
      apiKey: "test-key",
      request: async () =>
        JSON.stringify({
          ...selectionResult,
          skillRecommendations: [
            {
              skillId: "Terraform",
              rationale:
                "The skill is relevant to the JD even without a linked point.",
              supportingAchievementIds: [],
            },
          ],
          summary: "A detailed summary. ".repeat(40),
        }),
    });
    const result = await provider.selectAchievements({
      ...selectionInput,
      skills: [
        {
          id: "skill-terraform",
          name: "Terraform",
          aliases: [],
          isListedOnCurrentResume: false,
          evidenceAchievementIds: ["achievement-api"],
        },
      ],
    });

    expect(result.summary).toBe("A detailed summary. ".repeat(40).trim());
    expect(result.skillRecommendations[0].rationale).toContain(
      "relevant to the JD even without a linked point",
    );
    expect(result.skillRecommendations).toEqual([
      expect.objectContaining({
        skillId: "skill-terraform",
        supportingAchievementIds: [],
      }),
    ]);
    expect(result.selections).toEqual(selectionResult.selections);
  });

  it("keeps schema details out of the user-facing error while retaining a diagnostic code", async () => {
    const provider = createGeminiProvider({
      apiKey: "test-key",
      model: "gemini-2.5-flash-lite",
      request: async () =>
        JSON.stringify({ ...analysis, requiredQualifications: "not an array" }),
    });

    await expect(
      provider.analyzeJobDescription({ jobDescription: "Platform role." }),
    ).rejects.toMatchObject({
      message:
        "Gemini returned an incomplete or inconsistent response. Try again.",
      diagnosticCode: expect.stringContaining("requiredQualifications"),
    });
  });
});
