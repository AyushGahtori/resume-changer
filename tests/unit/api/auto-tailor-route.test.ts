import { beforeEach, describe, expect, it, vi } from "vitest";

const { createProvider, selectAchievements, draftResume, loadResumeLibrary } =
  vi.hoisted(() => ({
    createProvider: vi.fn(),
    selectAchievements: vi.fn(),
    draftResume: vi.fn(),
    loadResumeLibrary: vi.fn(),
  }));

vi.mock("@/lib/ai/provider-factory", () => ({
  createAiProvider: () => createProvider(),
}));

vi.mock("@/lib/data/loaders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data/loaders")>();
  return { ...actual, loadResumeLibrary };
});

import sampleLibrary from "../../../examples/sample-resume-library.json";
import { POST } from "@/app/api/ai/auto-tailor/route";
import { createJobContextId } from "@/lib/ai/job-context";
import { AiProviderError } from "@/lib/ai/provider";

const analysis = {
  targetTitle: "Cloud Platform Engineer",
  seniority: "Early career",
  requiredQualifications: ["AWS provisioning"],
  preferredQualifications: [],
  responsibilities: ["Standardize deployment workflows"],
  toolsAndPlatforms: ["AWS", "Terraform"],
  domainConcepts: ["Cloud infrastructure"],
  atsTerms: ["Infrastructure as Code"],
  inferredContext: [],
  terminology: [],
};
const jobBase = {
  company: "Example Cloud",
  roleTitle: "Cloud Platform Engineer",
  jobUrl: "",
};
const selectedId = "achievement-cloud-deployment-platform";

async function requestBody(overrides: Record<string, unknown> = {}) {
  const body = {
    dataSource: "demo",
    jobDescription: "Provision AWS services with Terraform.",
    analysis,
    ...overrides,
  };
  return {
    ...body,
    job: {
      ...jobBase,
      contextId: await createJobContextId({
        ...jobBase,
        jobDescription: body.jobDescription as string,
        analysis,
      }),
    },
  };
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/ai/auto-tailor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/ai/auto-tailor", () => {
  beforeEach(() => {
    createProvider.mockReset().mockImplementation(() => ({
      selectAchievements,
      draftResume,
    }));
    selectAchievements.mockReset().mockResolvedValue({
      selections: [
        {
          achievementId: selectedId,
          section: "experience",
          confidence: 0.94,
          rationale: "Direct evidence of AWS provisioning and deployment work.",
        },
      ],
      requirementCoverage: [
        {
          requirement: "AWS provisioning",
          coveredByAchievementIds: [selectedId],
        },
      ],
      skillRecommendations: [],
      confidence: 0.94,
      summary: "Selected source evidence for the active platform role.",
    });
    draftResume
      .mockReset()
      .mockImplementation(
        async (input: {
          achievements: Array<{ id: string; text: string }>;
        }) => ({
          summary: "The source evidence is tailored to the active role.",
          achievementText: input.achievements.map((item) => ({
            achievementId: item.id,
            text: item.text,
            rationale: "The original evidence supports this wording.",
          })),
        }),
      );
    loadResumeLibrary.mockReset().mockResolvedValue(sampleLibrary);
  });

  it("hands the AI-selected evidence directly to the drafter with matching job context", async () => {
    const body = await requestBody();
    const response = await post(body);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      recommendation: {
        mode: "ai",
        recommendations: {
          selections: expect.arrayContaining([
            expect.objectContaining({ achievementId: selectedId }),
          ]),
        },
      },
      draftingMode: "ai",
      tailoring: {
        mode: "ai",
        handoff: {
          job: { contextId: body.job.contextId },
          selectedAchievements: expect.arrayContaining([
            expect.objectContaining({ achievementId: selectedId }),
          ]),
        },
      },
    });
    expect(draftResume).toHaveBeenCalledTimes(1);
    const draftInput = draftResume.mock.calls[0][0] as {
      achievements: Array<{ id: string }>;
      handoff: { job: { contextId: string } };
    };
    expect(draftInput.achievements.map(({ id }) => id)).toContain(selectedId);
    expect(draftInput.handoff.job.contextId).toBe(body.job.contextId);
    expect(loadResumeLibrary).toHaveBeenCalledWith({ source: "demo" });
  });

  it("uses locally selected evidence and preserves original wording when the AI quota is exhausted", async () => {
    selectAchievements.mockRejectedValue(
      new AiProviderError("Gemini quota exhausted.", "RATE_LIMITED", true),
    );
    const response = await post(await requestBody());

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.recommendation.mode).toBe("local-fallback");
    expect(payload.draftingMode).toBe("originals-fallback");
    expect(payload.tailoring.notice).toContain(
      "selected source wording unchanged",
    );
    expect(payload.tailoring.proposals.length).toBeGreaterThan(0);
    expect(
      payload.tailoring.proposals.every(
        (proposal: { originalText: string; proposedText: string }) =>
          proposal.originalText === proposal.proposedText,
      ),
    ).toBe(true);
    expect(draftResume).not.toHaveBeenCalled();
  });

  it("rejects stale job context before loading private or demo resume data", async () => {
    const body = await requestBody({
      jobDescription: "A different job description.",
    });
    body.job.contextId = "0".repeat(64);

    const response = await post(body);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "STALE_CONTEXT",
    });
    expect(loadResumeLibrary).not.toHaveBeenCalled();
    expect(selectAchievements).not.toHaveBeenCalled();
  });
});
