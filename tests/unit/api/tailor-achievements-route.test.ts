import { beforeEach, describe, expect, it, vi } from "vitest";

const { draftResume, loadResumeLibrary } = vi.hoisted(() => ({
  draftResume: vi.fn(),
  loadResumeLibrary: vi.fn(),
}));

vi.mock("@/lib/ai/provider-factory", () => ({
  createAiProvider: () => ({ draftResume }),
}));

vi.mock("@/lib/data/loaders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data/loaders")>();
  return { ...actual, loadResumeLibrary };
});

import sampleLibrary from "../../../examples/sample-resume-library.json";
import { POST } from "@/app/api/ai/tailor-achievements/route";
import { AiProviderError } from "@/lib/ai/provider";
import { createJobContextId } from "@/lib/ai/job-context";

const analysis = {
  targetTitle: "Cloud Platform Engineer",
  seniority: "Early career",
  requiredQualifications: ["AWS provisioning"],
  preferredQualifications: [],
  responsibilities: ["Standardize deployment workflows"],
  toolsAndPlatforms: ["Terraform"],
  domainConcepts: ["Cloud infrastructure"],
  atsTerms: ["Infrastructure as Code"],
  inferredContext: [],
  terminology: [],
};

const achievementId = "achievement-cloud-deployment-platform";
const requestBase = {
  dataSource: "demo",
  jobDescription: "Provision AWS services with Terraform.",
  analysis,
  job: {
    company: "Example Cloud",
    roleTitle: "Cloud Platform Engineer",
    jobUrl: "",
  },
  achievementIds: [achievementId],
};

async function createRequest() {
  const value = requestBase;
  const job = value.job;
  return {
    ...value,
    job: {
      ...job,
      contextId: await createJobContextId({
        ...job,
        jobDescription: value.jobDescription,
        analysis,
      }),
    },
  };
}

function post(body: string) {
  return POST(
    new Request("http://localhost/api/ai/tailor-achievements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }),
  );
}

describe("POST /api/ai/tailor-achievements", () => {
  beforeEach(() => {
    draftResume.mockReset();
    loadResumeLibrary.mockReset().mockResolvedValue(sampleLibrary);
  });

  it("returns reviewable per-point proposals from only selected enabled evidence", async () => {
    const request = await createRequest();
    const original = sampleLibrary.jobs[0].points.find(
      ({ id }) => id === achievementId,
    )?.text;
    draftResume.mockResolvedValue({
      summary:
        "This wording makes the infrastructure-as-code evidence clearer.",
      achievementText: [
        {
          achievementId,
          text: "Standardized AWS environment provisioning and deployment checks for three internal services using Infrastructure as Code.",
          rationale:
            "The source point describes AWS provisioning and deployment checks.",
        },
      ],
    });

    const response = await post(JSON.stringify(request));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.proposals).toEqual([
      expect.objectContaining({
        achievementId,
        originalText: original,
        proposedText: expect.stringContaining("Infrastructure as Code"),
        addedTerms: ["Infrastructure as Code"],
      }),
    ]);
    expect(payload.mode).toBe("ai");
    expect(payload.handoff).toMatchObject({
      job: { contextId: request.job.contextId },
      selectedAchievements: [
        expect.objectContaining({
          achievementId,
          groupTitle: sampleLibrary.jobs[0].title,
        }),
      ],
    });
    expect(payload.analyzedTerms).toContain("AWS provisioning");
    expect(loadResumeLibrary).toHaveBeenCalledWith({ source: "demo" });
    expect(draftResume).toHaveBeenCalledTimes(1);
    expect(draftResume.mock.calls[0][0]).toMatchObject({
      jobDescription: request.jobDescription,
      analysis,
      achievements: [
        expect.objectContaining({
          id: achievementId,
          supportedSkills: expect.arrayContaining(["Infrastructure as Code"]),
        }),
      ],
    });
    expect(draftResume.mock.calls[0][0]).not.toHaveProperty("profile");
    expect(draftResume.mock.calls[0][0]).not.toHaveProperty("templateContext");
  });

  it("rejects malformed requests and unavailable or disabled evidence", async () => {
    expect((await post("{bad json")).status).toBe(400);
    const request = await createRequest();
    const invalid = await post(
      JSON.stringify({
        ...request,
        achievementIds: [achievementId, achievementId],
      }),
    );
    expect(invalid.status).toBe(400);
    expect(draftResume).not.toHaveBeenCalled();

    const unknown = await post(
      JSON.stringify({ ...request, achievementIds: ["achievement-missing"] }),
    );
    expect(unknown.status).toBe(422);

    const disabledLibrary = structuredClone(sampleLibrary);
    const point = disabledLibrary.jobs[0].points.find(
      ({ id }) => id === achievementId,
    );
    if (!point) throw new Error("Expected a sample achievement.");
    point.enabled = false;
    loadResumeLibrary.mockResolvedValueOnce(disabledLibrary);
    const disabled = await post(JSON.stringify(request));
    expect(disabled.status).toBe(422);
    expect(draftResume).not.toHaveBeenCalled();
  });

  it("returns actionable provider errors and rejects incomplete AI results", async () => {
    const request = await createRequest();
    draftResume.mockRejectedValue(
      new AiProviderError(
        "Gemini is temporarily unavailable.",
        "RATE_LIMITED",
        true,
      ),
    );
    const unavailable = await post(JSON.stringify(request));
    expect(unavailable.status).toBe(200);
    await expect(unavailable.json()).resolves.toMatchObject({
      mode: "originals-fallback",
      notice: expect.stringContaining("original wording is preserved"),
      proposals: [
        expect.objectContaining({
          achievementId,
          originalText: expect.any(String),
          proposedText: expect.any(String),
        }),
      ],
    });

    draftResume.mockResolvedValue({
      summary: "Missing proposal",
      achievementText: [],
    });
    const incomplete = await post(JSON.stringify(request));
    expect(incomplete.status).toBe(502);
    await expect(incomplete.json()).resolves.toMatchObject({
      code: "INVALID_AI_OUTPUT",
      retryable: false,
    });
  });
});
