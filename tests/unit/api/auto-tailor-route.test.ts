import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createProvider,
  selectAchievements,
  draftResume,
  repairLatexContent,
  loadResumeLibrary,
  fitResume,
} = vi.hoisted(() => ({
  createProvider: vi.fn(),
  fitResume: vi.fn(),
  selectAchievements: vi.fn(),
  draftResume: vi.fn(),
  repairLatexContent: vi.fn(),
  loadResumeLibrary: vi.fn(),
}));

vi.mock("@/lib/generation/fit-resume", () => ({ fitResumeToPage: fitResume }));

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
import type { LatexRepairInput, LatexRepairResult } from "@/lib/ai/contracts";
import type { ResumeLibrary } from "@/lib/schemas/resume-data";

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
      repairLatexContent,
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
    repairLatexContent.mockReset();
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
    expect(payload).not.toHaveProperty("runId");
    expect(payload).not.toHaveProperty("diagnostics");
    expect(draftResume).toHaveBeenCalledTimes(1);
    const draftInput = draftResume.mock.calls[0][0] as {
      achievements: Array<{ id: string }>;
      handoff: { job: { contextId: string } };
    };
    expect(draftInput.achievements.map(({ id }) => id)).toContain(selectedId);
    expect(draftInput.handoff.job.contextId).toBe(body.job.contextId);
    expect(loadResumeLibrary).toHaveBeenCalledWith({ source: "demo" });
  });

  it("does not use local matching until the user explicitly consents", async () => {
    selectAchievements.mockRejectedValue(
      new AiProviderError("Gemini quota exhausted.", "RATE_LIMITED", true),
    );
    const request = await requestBody();
    const declined = await post(request);
    expect(declined.status).toBe(503);
    await expect(declined.json()).resolves.toMatchObject({
      code: "RATE_LIMITED",
      fallbackAvailable: true,
      fallbackType: "local-matching-or-original-wording",
    });

    const response = await post({ ...request, allowLocalFallback: true });

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
          proposal.proposedText.includes(
            proposal.originalText.replace(/\.$/, ""),
          ),
      ),
    ).toBe(true);
    expect(draftResume).not.toHaveBeenCalled();
  });

  it("returns a measured PDF and final metadata in one Auto Tailor request without logging binary bytes", async () => {
    fitResume.mockResolvedValue({
      pdf: Buffer.from("%PDF-final"),
      generation: {
        latex: "verified latex",
        metadata: {
          id: "final-generation",
          selectedAchievementIds: [selectedId],
          renderedSkillIds: [],
          generatedAt: "2026-10-16T12:00:00Z",
          fitting: { status: "filled", attempts: 2, decisions: [] },
        },
      },
    });
    const response = await post(await requestBody({ generatePdf: true }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(Buffer.from(payload.compiled.pdfBase64, "base64").toString()).toBe(
      "%PDF-final",
    );
    expect(payload.compiled.metadata.fitting.status).toBe("filled");
    expect(fitResume.mock.calls[0][0].request.summaryOverride).toBeTruthy();
    expect(payload).not.toHaveProperty("diagnostics");
    expect(
      fitResume.mock.calls[0][0].request.achievementTextOverrides[0]
        .sourceAchievementIds,
    ).toBeTruthy();
  });

  it("passes measured overflow to Gemini and validates the repair against selected evidence", async () => {
    const library = sampleLibrary as ResumeLibrary;
    const point = library.jobs
      .flatMap((job) => job.points)
      .find((item) => item.id === selectedId)!;
    repairLatexContent.mockResolvedValue({
      summary: "Kept the selected wording while checking the layout.",
      achievementText: [
        {
          achievementId: selectedId,
          sourceAchievementIds: [selectedId],
          text: point.text,
        },
      ],
    });
    fitResume.mockImplementationOnce(
      async (args: {
        repairContent?: (input: LatexRepairInput) => Promise<LatexRepairResult>;
      }) => {
        const result = await args.repairContent!({
          currentContent: {
            summary: "Selected wording.",
            achievementText: [
              {
                achievementId: selectedId,
                sourceAchievementIds: [selectedId],
                text: point.text,
              },
            ],
          },
          diagnostics: ["The resume exceeds one page by eight words."],
          firstPageText: "Measured page-one resume text.",
          overflowText: "The words that flowed onto page two.",
          overflowWordCount: 8,
        });
        expect(result.achievementText).toEqual([
          expect.objectContaining({
            achievementId: selectedId,
            sourceAchievementIds: [selectedId],
            text: point.text,
          }),
        ]);
        return {
          pdf: Buffer.from("%PDF-final"),
          generation: {
            latex: "verified latex",
            metadata: {
              id: "final-generation",
              selectedAchievementIds: [selectedId],
              renderedSkillIds: [],
              generatedAt: "2026-10-16T12:00:00Z",
            },
          },
        };
      },
    );

    const response = await post(await requestBody({ generatePdf: true }));

    expect(response.status).toBe(200);
    expect(repairLatexContent).toHaveBeenCalledWith(
      expect.objectContaining({
        firstPageText: "Measured page-one resume text.",
        overflowText: "The words that flowed onto page two.",
        overflowWordCount: 8,
      }),
    );
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
