import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectAchievements, loadResumeLibrary } = vi.hoisted(() => ({
  selectAchievements: vi.fn(),
  loadResumeLibrary: vi.fn(),
}));

vi.mock("@/lib/ai/provider-factory", () => ({
  createAiProvider: () => ({ selectAchievements }),
}));

vi.mock("@/lib/data/loaders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data/loaders")>();
  return { ...actual, loadResumeLibrary };
});

import sampleLibrary from "../../../examples/sample-resume-library.json";
import { POST } from "@/app/api/ai/select-achievements/route";
import { AiProviderError } from "@/lib/ai/provider";

const analysis = {
  targetTitle: "Platform Engineer",
  seniority: "Entry level",
  requiredQualifications: ["AWS provisioning"],
  preferredQualifications: [],
  responsibilities: ["Standardize deployment checks"],
  toolsAndPlatforms: ["AWS"],
  domainConcepts: ["Platform engineering"],
  atsTerms: ["Infrastructure as Code"],
  inferredContext: [],
  terminology: [],
};

const selectedId = "achievement-cloud-deployment-platform";
const recommendation = {
  selections: [
    {
      achievementId: selectedId,
      section: "experience",
      confidence: 0.92,
      rationale: "Shows direct AWS provisioning and deployment work.",
    },
  ],
  requirementCoverage: [
    { requirement: "AWS provisioning", coveredByAchievementIds: [selectedId] },
  ],
  skillRecommendations: [
    {
      skillId: "skill-infrastructure-as-code",
      rationale: "Supported by the deployment point.",
      supportingAchievementIds: [selectedId],
    },
  ],
  confidence: 0.92,
  summary: "One enabled point directly supports the role.",
};

function post(body: string) {
  return POST(
    new Request("http://localhost/api/ai/select-achievements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }),
  );
}

describe("POST /api/ai/select-achievements", () => {
  beforeEach(() => {
    selectAchievements.mockReset();
    loadResumeLibrary.mockReset().mockResolvedValue(sampleLibrary);
  });

  it("loads the selected validated library and returns bounded recommendations", async () => {
    selectAchievements.mockResolvedValue(recommendation);
    const response = await post(
      JSON.stringify({
        dataSource: "demo",
        jobDescription: "Standardize AWS provisioning and deployment checks.",
        analysis,
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.mode).toBe("ai");
    expect(payload.recommendations.selections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          achievementId: selectedId,
          section: "experience",
        }),
      ]),
    );
    expect(payload.recommendations.requirementCoverage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requirement: "AWS provisioning",
          coveredByAchievementIds: [selectedId],
        }),
      ]),
    );
    expect(payload.recommendations.skillRecommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skillId: "skill-infrastructure-as-code",
          supportingAchievementIds: [selectedId],
        }),
      ]),
    );
    expect(loadResumeLibrary).toHaveBeenCalledWith({ source: "demo" });
    const input = selectAchievements.mock.calls[0][0];
    expect(input.analysis).toEqual(analysis);
    expect(
      input.achievements.map((point: { id: string }) => point.id),
    ).toContain(selectedId);
    expect(
      input.achievements.every((point: { id: string }) =>
        [...sampleLibrary.jobs, ...sampleLibrary.projects]
          .flatMap((group) => group.points)
          .some((source) => source.id === point.id && source.enabled),
      ),
    ).toBe(true);
    expect(input).not.toHaveProperty("profile");
  });

  it("returns local evidence recommendations if the AI provider is unavailable", async () => {
    selectAchievements.mockRejectedValue(
      new AiProviderError("Set the API key.", "MISSING_API_KEY"),
    );
    const response = await post(
      JSON.stringify({
        dataSource: "demo",
        jobDescription: "Provision AWS infrastructure.",
        analysis,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      mode: "local-fallback",
      notice: expect.stringContaining("Configure the AI provider"),
      recommendations: {
        selections: expect.arrayContaining([
          expect.objectContaining({ achievementId: selectedId }),
        ]),
      },
    });
  });

  it("rejects malformed requests and empty enabled libraries without calling AI", async () => {
    const invalid = await post(
      JSON.stringify({ dataSource: "demo", jobDescription: "", analysis }),
    );
    expect(invalid.status).toBe(400);

    const disabledLibrary = structuredClone(sampleLibrary);
    for (const group of [
      ...disabledLibrary.jobs,
      ...disabledLibrary.projects,
    ]) {
      group.points.forEach((point) => {
        point.enabled = false;
      });
    }
    loadResumeLibrary.mockResolvedValueOnce(disabledLibrary);
    const empty = await post(
      JSON.stringify({
        dataSource: "demo",
        jobDescription: "Build platform services.",
        analysis,
      }),
    );
    expect(empty.status).toBe(422);
    await expect(empty.json()).resolves.toMatchObject({
      code: "NO_ENABLED_ACHIEVEMENTS",
    });
    expect(selectAchievements).not.toHaveBeenCalled();
  });
});
