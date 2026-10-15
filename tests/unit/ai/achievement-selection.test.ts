import { describe, expect, it, vi } from "vitest";
import {
  buildAchievementSelectionInput,
  estimateAchievementContentBudget,
  recommendAchievements,
} from "../../../src/lib/ai/achievement-selection";
import type {
  AchievementSelectionInput,
  AchievementSelectionResult,
  JobAnalysisResult,
} from "../../../src/lib/ai/contracts";
import { AiProviderError } from "../../../src/lib/ai/provider";
import sampleLibrary from "../../../examples/sample-resume-library.json";
import type { ResumeLibrary } from "../../../src/lib/schemas/resume-data";

const library = sampleLibrary as ResumeLibrary;
const analysis: JobAnalysisResult = {
  targetTitle: "Platform Engineer",
  seniority: "Entry level",
  requiredQualifications: ["AWS provisioning", "idempotency keys"],
  preferredQualifications: ["Infrastructure as Code"],
  responsibilities: ["Standardize cloud deployments"],
  toolsAndPlatforms: ["AWS", "deployment checks"],
  domainConcepts: ["distributed systems"],
  atsTerms: ["platform engineering"],
  inferredContext: [],
  terminology: [{ term: "infrastructure as code", alternatives: ["IaC"] }],
};

function makeInput(overrides: Partial<AchievementSelectionInput> = {}) {
  return {
    ...buildAchievementSelectionInput({
      library,
      jobDescription: "Build and operate platform infrastructure.",
      analysis,
    }),
    ...overrides,
  };
}

function aiResult(
  input: AchievementSelectionInput,
  ids = input.achievements.map((item) => item.id),
): AchievementSelectionResult {
  return {
    selections: ids.map((id) => {
      const point = input.achievements.find((item) => item.id === id)!;
      return {
        achievementId: id,
        section: point.section,
        confidence: 0.9,
        rationale: "Evidence supports the analyzed role.",
      };
    }),
    requirementCoverage: input.analysis.requiredQualifications.map(
      (requirement) => ({
        requirement,
        coveredByAchievementIds: ids,
      }),
    ),
    skillRecommendations: [],
    confidence: 0.9,
    summary: "The selected evidence matches role requirements.",
  };
}

describe("AI achievement selection service", () => {
  it("sends only enabled job and project evidence with validated skill provenance", () => {
    const input = makeInput();
    const enabledIds = new Set(
      [...library.jobs, ...library.projects].flatMap((group) =>
        group.points.filter((point) => point.enabled).map((point) => point.id),
      ),
    );

    expect(input.achievements.map((point) => point.id)).toEqual(
      expect.arrayContaining([...enabledIds]),
    );
    expect(input.achievements.every((point) => enabledIds.has(point.id))).toBe(
      true,
    );
    expect(
      input.achievements.some((point) => point.section === "projects"),
    ).toBe(true);
    expect(
      input.skills.find((skill) => skill.id === "skill-infrastructure-as-code"),
    ).toMatchObject({
      isListedOnCurrentResume: false,
      evidenceAchievementIds: ["achievement-cloud-deployment-platform"],
    });
  });

  it("does not send disabled achievement IDs as skill evidence", () => {
    const libraryWithDisabledEvidence = structuredClone(library);
    const disabledPointId = "achievement-cloud-deployment-platform";
    const cloudJob = libraryWithDisabledEvidence.jobs.find((job) =>
      job.points.some((point) => point.id === disabledPointId),
    )!;
    cloudJob.points.find((point) => point.id === disabledPointId)!.enabled =
      false;

    const input = buildAchievementSelectionInput({
      library: libraryWithDisabledEvidence,
      jobDescription: "Build and operate platform infrastructure.",
      analysis,
    });

    expect(input.achievements.map((point) => point.id)).not.toContain(
      disabledPointId,
    );
    expect(
      input.skills.find((skill) => skill.id === "skill-infrastructure-as-code")
        ?.evidenceAchievementIds,
    ).not.toContain(disabledPointId);
  });

  it("estimates a smaller point budget when fixed resume content grows", () => {
    const normalBudget = estimateAchievementContentBudget(library);
    const denserLibrary = {
      ...library,
      profile: {
        ...library.profile,
        summary: "A long profile summary. ".repeat(100),
      },
    };

    expect(normalBudget).toBeGreaterThan(0);
    expect(estimateAchievementContentBudget(denserLibrary)).toBeLessThan(
      normalBudget,
    );
  });

  it("trims excessive AI recommendations to the estimated one-page line budget", async () => {
    const input = makeInput({ contentBudgetLines: 9 });
    const allAiSelections = aiResult(input);
    const response = await recommendAchievements({
      input,
      selectWithAi: async () => allAiSelections,
    });

    expect(response.mode).toBe("ai");
    expect(response.recommendations.selections.length).toBeLessThan(
      allAiSelections.selections.length,
    );
    expect(response.budget.usedLines).toBeLessThanOrEqual(9);
  });

  it("fills an under-selected AI response with relevant evidence within budget", async () => {
    const input = makeInput({ contentBudgetLines: 40 });
    const response = await recommendAchievements({
      input,
      selectWithAi: async () =>
        aiResult(input, ["achievement-cloud-deployment-platform"]),
    });
    const selectedIds = response.recommendations.selections.map(
      (item) => item.achievementId,
    );

    expect(selectedIds).toContain("achievement-cloud-deployment-platform");
    expect(selectedIds.length).toBeGreaterThan(1);
    expect(response.budget.usedLines).toBeLessThanOrEqual(40);
  });

  it("does not double-charge section headers when filling an AI response", async () => {
    const base = makeInput();
    const first = {
      ...base.achievements[0],
      id: "achievement-aws-deployment-first",
      text: "Improved AWS deployment reliability.",
    };
    const second = {
      ...first,
      id: "achievement-aws-deployment-second",
      text: "Automated AWS deployment checks.",
    };
    const input = makeInput({
      contentBudgetLines: 8,
      achievements: [first, second],
      analysis: {
        ...analysis,
        requiredQualifications: ["AWS deployment"],
        preferredQualifications: [],
        responsibilities: [],
        toolsAndPlatforms: [],
        domainConcepts: [],
        atsTerms: [],
        terminology: [],
      },
    });
    const response = await recommendAchievements({
      input,
      selectWithAi: async () => aiResult(input, [first.id]),
    });

    expect(
      response.recommendations.selections.map((item) => item.achievementId),
    ).toEqual([first.id, second.id]);
    expect(response.budget.usedLines).toBe(8);
  });

  it("uses direct and meaning-level local matches when the model fails", async () => {
    const input = makeInput({ contentBudgetLines: 40 });
    const response = await recommendAchievements({
      input,
      selectWithAi: async () => {
        throw Object.assign(new Error("upstream unavailable"), {
          code: "SERVICE_UNAVAILABLE",
        });
      },
    });
    const selectedIds = response.recommendations.selections.map(
      (item) => item.achievementId,
    );

    expect(response.mode).toBe("local-fallback");
    expect(response.notice).toContain("local matches");
    expect(selectedIds).toContain("achievement-cloud-deployment-platform");
    expect(selectedIds).toContain("achievement-queueboard-worker-model");
    expect(response.recommendations.requirementCoverage).toContainEqual({
      requirement: "AWS provisioning",
      coveredByAchievementIds: ["achievement-cloud-deployment-platform"],
    });
    expect(response.recommendations.requirementCoverage).toContainEqual({
      requirement: "idempotency keys",
      coveredByAchievementIds: ["achievement-queueboard-worker-model"],
    });
  });

  it("explains retryable provider failures and logs only safe diagnostics", async () => {
    const input = makeInput({ contentBudgetLines: 40 });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const response = await recommendAchievements({
        input,
        selectWithAi: async () => {
          throw new AiProviderError(
            "do not expose this detail",
            "RATE_LIMITED",
            true,
          );
        },
      });

      expect(response.mode).toBe("local-fallback");
      expect(response.notice).toContain("request limit was reached");
      expect(response.notice).not.toContain("do not expose this detail");
      expect(warning).toHaveBeenCalledWith(
        "AI achievement selection failed; using local fallback.",
        {
          code: "RATE_LIMITED",
          diagnostic: "RATE_LIMITED",
          retryable: true,
        },
      );
    } finally {
      warning.mockRestore();
    }
  });

  it("does not claim coverage when the library has no supporting point", async () => {
    const input = makeInput({
      analysis: {
        ...analysis,
        requiredQualifications: ["quantum particle accelerator design"],
        responsibilities: [],
        preferredQualifications: [],
        toolsAndPlatforms: [],
        domainConcepts: [],
        atsTerms: [],
        terminology: [],
      },
    });
    const response = await recommendAchievements({
      input,
      selectWithAi: async () => {
        throw new Error("offline");
      },
    });

    expect(response.recommendations.selections).toEqual([]);
    expect(response.recommendations.requirementCoverage).toEqual([
      {
        requirement: "quantum particle accelerator design",
        coveredByAchievementIds: [],
      },
    ]);
  });

  it("deduplicates model IDs and recommends unlisted skills only with selected evidence", async () => {
    const input = makeInput({ contentBudgetLines: 40 });
    const skillResult = aiResult(input, [
      "achievement-cloud-deployment-platform",
      "achievement-cloud-deployment-platform",
    ]);
    skillResult.skillRecommendations = [
      {
        skillId: "skill-infrastructure-as-code",
        rationale: "The selected point shows this skill.",
        supportingAchievementIds: ["achievement-cloud-deployment-platform"],
      },
    ];
    const response = await recommendAchievements({
      input,
      selectWithAi: async () => skillResult,
    });

    expect(
      response.recommendations.selections.filter(
        (item) =>
          item.achievementId === "achievement-cloud-deployment-platform",
      ),
    ).toHaveLength(1);
    expect(response.recommendations.skillRecommendations).toEqual([
      expect.objectContaining({
        skillId: "skill-infrastructure-as-code",
        supportingAchievementIds: ["achievement-cloud-deployment-platform"],
      }),
    ]);
  });

  it("keeps recommendations across experience and projects when both cover signals", async () => {
    const input = makeInput({ contentBudgetLines: 40 });
    const response = await recommendAchievements({
      input,
      selectWithAi: async () => {
        throw new Error("offline");
      },
    });
    const sections = new Set(
      response.recommendations.selections.map((item) => item.section),
    );

    expect(sections).toEqual(new Set(["experience", "projects"]));
  });

  it("balances two relevant jobs and a project while reporting honest requirement evidence", async () => {
    const base = makeInput();
    const template = base.achievements[0];
    const achievements: AchievementSelectionInput["achievements"] = [
      {
        ...template,
        id: "achievement-ml-api",
        text: "Built distributed machine learning infrastructure with Python services.",
        skillIds: ["skill-python"],
        tags: ["distributed systems"],
        groupId: "job-cloud-one",
        groupTitle: "Platform Engineer",
      },
      {
        ...template,
        id: "achievement-ml-observability",
        text: "Improved distributed machine learning infrastructure reliability.",
        skillIds: [],
        tags: [],
        groupId: "job-cloud-one",
        groupTitle: "Platform Engineer",
      },
      {
        ...template,
        id: "achievement-feature-store",
        text: "Modernized a feature store for faster feature deployment.",
        skillIds: [],
        tags: [],
        groupId: "job-ml-two",
        groupTitle: "ML Engineer",
      },
      {
        ...template,
        id: "achievement-project-queue",
        text: "Built a distributed model-serving queue for machine learning workloads.",
        section: "projects",
        skillIds: [],
        tags: [],
        groupId: "project-model-queue",
        groupTitle: "Model Queue",
      },
    ];
    const fixtureAnalysis: JobAnalysisResult = {
      ...analysis,
      requiredQualifications: [
        "Familiarity or ability to learn Python, Go, or C++",
        "Availability during coordination hours in Pacific Time",
      ],
      responsibilities: [
        "Modernize feature store for faster feature deployment",
        "Build distributed machine learning infrastructure",
      ],
      preferredQualifications: [],
      toolsAndPlatforms: [],
      domainConcepts: [],
      atsTerms: [],
      terminology: [],
    };
    const input = makeInput({
      jobDescription:
        "Example ML platform role with Python and feature store work.",
      analysis: fixtureAnalysis,
      achievements,
      skills: [
        {
          id: "skill-python",
          name: "Python",
          aliases: [],
          isListedOnCurrentResume: true,
          evidenceAchievementIds: ["achievement-ml-api"],
        },
      ],
      contentBudgetLines: 22,
    });
    const response = await recommendAchievements({
      input,
      selectWithAi: async () =>
        aiResult(input, ["achievement-ml-api", "achievement-ml-observability"]),
    });
    const selected = response.recommendations.selections.map(
      (item) => item.achievementId,
    );
    expect(selected).toContain("achievement-ml-api");
    expect(selected).toContain("achievement-feature-store");
    expect(selected).toContain("achievement-project-queue");
    expect(response.budget).toEqual({ availableLines: 22, usedLines: 18 });
    expect(response.requirementEvidence).toContainEqual({
      requirement: "Familiarity or ability to learn Python, Go, or C++",
      availableAchievementIds: ["achievement-ml-api"],
    });
    expect(response.requirementEvidence).toContainEqual({
      requirement: "Availability during coordination hours in Pacific Time",
      availableAchievementIds: [],
    });
    expect(response.recommendations.requirementCoverage).toContainEqual({
      requirement: "Modernize feature store for faster feature deployment",
      coveredByAchievementIds: ["achievement-feature-store"],
    });
  });

  it("keeps a relevant project out when its heading and point do not fit the budget", async () => {
    const base = makeInput();
    const job = {
      ...base.achievements[0],
      id: "achievement-platform-job",
      text: "Built AWS platform infrastructure.",
      section: "experience" as const,
    };
    const project = {
      ...base.achievements[0],
      id: "achievement-platform-project",
      text: "Built AWS platform infrastructure in a separate project.",
      section: "projects" as const,
      groupId: "project-platform",
    };
    const input = makeInput({
      achievements: [job, project],
      contentBudgetLines: 6,
      analysis: {
        ...analysis,
        requiredQualifications: ["AWS platform infrastructure"],
        responsibilities: [],
        preferredQualifications: [],
        toolsAndPlatforms: [],
        domainConcepts: [],
        atsTerms: [],
        terminology: [],
      },
    });
    const response = await recommendAchievements({
      input,
      selectWithAi: async () => aiResult(input, [job.id]),
    });
    expect(response.recommendations.selections).toHaveLength(1);
    expect(response.budget.usedLines).toBeLessThanOrEqual(6);
    expect(response.notice).toContain("page budget");
  });

  it("does not treat a generic feature deployment as feature-store evidence", async () => {
    const base = makeInput();
    const input = makeInput({
      achievements: [
        {
          ...base.achievements[0],
          id: "achievement-feature-deployment",
          text: "Improved feature deployment for a web application.",
          tags: [],
          skillIds: [],
        },
      ],
      skills: [],
      analysis: {
        ...analysis,
        requiredQualifications: ["Modernize feature store"],
        responsibilities: [],
        preferredQualifications: [],
        toolsAndPlatforms: [],
        domainConcepts: [],
        atsTerms: [],
        terminology: [],
      },
    });
    const response = await recommendAchievements({
      input,
      selectWithAi: async () => aiResult(input),
    });
    expect(response.requirementEvidence[0].availableAchievementIds).toEqual([]);
    expect(response.recommendations.requirementCoverage[0]).toEqual({
      requirement: "Modernize feature store",
      coveredByAchievementIds: [],
    });
  });
});
