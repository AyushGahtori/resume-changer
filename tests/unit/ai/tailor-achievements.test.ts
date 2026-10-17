import { describe, expect, it } from "vitest";
import sampleLibrary from "../../../examples/sample-resume-library.json";
import {
  ResumeDraftInputSchema,
  type ResumeDraftResult,
  type JobAnalysisResult,
} from "../../../src/lib/ai/contracts";
import {
  AchievementTailoringError,
  buildResumeDraftInput,
  createTailoringResponse,
  TailorAchievementsRequestSchema,
} from "../../../src/lib/ai/tailor-achievements";
import { createJobContextId } from "../../../src/lib/ai/job-context";
import type { ResumeLibrary } from "../../../src/lib/schemas/resume-data";

const library = sampleLibrary as ResumeLibrary;
const analysis: JobAnalysisResult = {
  targetTitle: "Cloud Platform Engineer",
  seniority: "Early career",
  requiredQualifications: ["AWS provisioning"],
  preferredQualifications: [],
  responsibilities: ["Standardize deployment workflows"],
  toolsAndPlatforms: ["Terraform"],
  domainConcepts: ["Cloud infrastructure"],
  atsTerms: ["Infrastructure as Code"],
  inferredContext: [],
  terminology: [
    { term: "deployment checks", alternatives: ["release validation"] },
  ],
};
const cloudPointId = "achievement-cloud-deployment-platform";
const baseRequest = {
  dataSource: "demo" as const,
  jobDescription: "Provision AWS services with Terraform.",
  analysis,
  achievementIds: [cloudPointId],
};
const job = {
  company: "Example Cloud Labs",
  roleTitle: "Platform Engineer",
  jobUrl: "",
};

async function createRequest(overrides: Partial<typeof baseRequest> = {}) {
  const value = { ...baseRequest, ...overrides };
  return {
    ...value,
    job: {
      ...job,
      contextId: await createJobContextId({
        ...job,
        jobDescription: value.jobDescription,
        analysis: value.analysis,
      }),
    },
  };
}

describe("Guided Tailor evidence preparation", () => {
  it("retains every parent requirement when the analysis exceeds one hundred items", async () => {
    const expanded = {
      ...analysis,
      requiredQualifications: Array.from(
        { length: 100 },
        (_, index) => `Required AWS capability ${index}`,
      ),
      responsibilities: Array.from(
        { length: 100 },
        (_, index) => `Operate AWS service ${index}`,
      ),
      preferredQualifications: Array.from(
        { length: 100 },
        (_, index) => `Preferred AWS capability ${index}`,
      ),
    };
    const input = await buildResumeDraftInput(
      library,
      await createRequest({ analysis: expanded }),
    );
    expect(
      input.handoff.requirements.filter(
        (requirement) => requirement.category !== "context",
      ),
    ).toHaveLength(300);
    expect(input.handoff.requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "Preferred AWS capability 99" }),
      ]),
    );
  }, 20_000);
  it("sends the active job, structured handoff, and selected enabled evidence", async () => {
    const request = await createRequest();
    const input = await buildResumeDraftInput(library, request);

    expect(input.analysis).toEqual(analysis);
    expect(input.jobDescription).toBe(request.jobDescription);
    expect(input.achievements.map(({ id }) => id)).toEqual([cloudPointId]);
    expect(input.achievements[0].text).toContain(
      "AWS environment provisioning",
    );
    expect(input.achievements[0].supportedSkills).toContain(
      "Infrastructure as Code",
    );
    expect(input.handoff.job.contextId).toBe(request.job.contextId);
    expect(input.handoff.selectedAchievements[0]).toMatchObject({
      achievementId: cloudPointId,
      section: "experience",
      groupId: "job-example-cloud-labs",
      linkedSkills: expect.arrayContaining(["Infrastructure as Code"]),
    });
    expect(input.handoff.requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "AWS provisioning",
          status: "supported",
          selectedAchievementIds: [cloudPointId],
        }),
      ]),
    );
    expect(input).not.toHaveProperty("profile.email");
    expect(input).not.toHaveProperty("templateContext");
  });

  it("distinguishes supported, uncertain, unselected, and missing evidence", async () => {
    const request = await createRequest();
    const expandedAnalysis = {
      ...analysis,
      requiredQualifications: [
        "AWS provisioning",
        "AWS environment platform",
        "release readiness checks",
        "quantum computing operations",
      ],
    };
    const expandedRequest = {
      ...request,
      analysis: expandedAnalysis,
      job: {
        ...request.job,
        contextId: await createJobContextId({
          ...job,
          jobDescription: request.jobDescription,
          analysis: expandedAnalysis,
        }),
      },
    };
    const input = await buildResumeDraftInput(library, expandedRequest);

    expect(input.handoff.requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "AWS provisioning",
          status: "supported",
        }),
        expect.objectContaining({
          text: "AWS environment platform",
          status: "partial",
        }),
        expect.objectContaining({
          text: "release readiness checks",
          status: "evidence-not-selected",
          availableAchievementIds: ["achievement-release-check-automation"],
        }),
        expect.objectContaining({
          text: "quantum computing operations",
          status: "no-evidence-found",
        }),
      ]),
    );
    expect(input.handoff.suggestedEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          achievementId: "achievement-release-check-automation",
          supportedRequirementIds: expect.arrayContaining([
            expect.stringMatching(/^requirement-required-/),
          ]),
        }),
      ]),
    );
    expect(input.handoff.contentBudgetLines).toBeGreaterThan(0);
  });

  it("rejects duplicate, unknown, disabled, and stale-context selections", async () => {
    const request = await createRequest();
    expect(
      TailorAchievementsRequestSchema.safeParse({
        ...request,
        achievementIds: [cloudPointId, cloudPointId],
      }).success,
    ).toBe(false);

    await expect(
      buildResumeDraftInput(
        library,
        await createRequest({ achievementIds: ["achievement-unknown"] }),
      ),
    ).rejects.toThrow(AchievementTailoringError);

    const disabledLibrary = structuredClone(library);
    const point = disabledLibrary.jobs
      .flatMap((job) => job.points)
      .find(({ id }) => id === cloudPointId);
    if (!point) throw new Error("Expected synthetic sample achievement.");
    point.enabled = false;
    await expect(
      buildResumeDraftInput(disabledLibrary, request),
    ).rejects.toThrow(/disabled/);
    await expect(
      buildResumeDraftInput(library, {
        ...request,
        job: { ...request.job, contextId: "0".repeat(64) },
      }),
    ).rejects.toThrow(/changed/);
  });
});

describe("Guided Tailor response validation", () => {
  const sourceText = "Provisioned AWS resources with Terraform modules.";
  const input = ResumeDraftInputSchema.parse({
    jobDescription: "Provision AWS resources with Terraform.",
    analysis: {
      ...analysis,
      atsTerms: ["Infrastructure as Code", "AWS"],
    },
    achievements: [
      {
        id: "achievement-terraform",
        text: sourceText,
        tags: ["cloud"],
        skillIds: ["skill-terraform"],
        supportedSkills: ["Infrastructure as Code", "IaC"],
        section: "experience",
        groupId: "job-platform",
        groupTitle: "Platform Engineer",
      },
    ],
    handoff: {
      job: {
        company: "Example Cloud Labs",
        roleTitle: "Platform Engineer",
        jobUrl: "",
        contextId: "a".repeat(64),
      },
      requirements: [
        {
          id: "requirement-required-1",
          category: "required",
          text: "AWS provisioning",
          status: "supported",
          availableAchievementIds: ["achievement-terraform"],
          selectedAchievementIds: ["achievement-terraform"],
          reason:
            "Selected source evidence directly supports this requirement.",
        },
      ],
      selectedAchievements: [
        {
          achievementId: "achievement-terraform",
          text: sourceText,
          section: "experience",
          groupId: "job-platform",
          groupTitle: "Platform Engineer",
          linkedSkills: ["Infrastructure as Code", "IaC"],
          supportedRequirementIds: ["requirement-required-1"],
          selectionConfidence: 0.9,
        },
      ],
      suggestedEvidence: [],
      contentBudgetLines: 40,
    },
  });

  it("reports exact source text, rationale, and newly reflected analyzed JD terms", () => {
    const result: ResumeDraftResult = {
      summary: "The revised point makes the infrastructure practice clearer.",
      achievementText: [
        {
          achievementId: "achievement-terraform",
          text: "Provisioned AWS resources with Terraform modules using Infrastructure as Code practices.",
          rationale: "Terraform modules provide direct evidence for this term.",
        },
      ],
    };

    expect(createTailoringResponse({ input, result })).toMatchObject({
      summary: result.summary,
      proposals: [
        {
          achievementId: "achievement-terraform",
          originalText: sourceText,
          proposedText: result.achievementText[0].text,
          rationale: result.achievementText[0].rationale,
          addedTerms: ["Infrastructure as Code"],
        },
      ],
      mode: "ai",
      analyzedTerms: expect.arrayContaining(["Infrastructure as Code", "AWS"]),
    });
    expect(
      createTailoringResponse({ input, result }).handoff.selectedAchievements[0]
        .achievementId,
    ).toBe("achievement-terraform");
  });

  it("does not append a supported term the model did not phrase naturally", () => {
    const response = createTailoringResponse({
      input,
      result: {
        summary: "The point is aligned to the role.",
        achievementText: [
          {
            achievementId: "achievement-terraform",
            text: "Provisioned AWS resources with Terraform modules.",
          },
        ],
      },
    });

    expect(response.proposals[0].proposedText).toBe(
      "Provisioned AWS resources with Terraform modules.",
    );
    expect(response.proposals[0].addedTerms).toEqual([]);
  });

  it("rejects added JD terms that source text and linked skills do not support", () => {
    const unsupportedInput = ResumeDraftInputSchema.parse({
      ...input,
      analysis: { ...input.analysis, atsTerms: ["Go"] },
    });
    expect(() =>
      createTailoringResponse({
        input: unsupportedInput,
        result: {
          summary: "Draft",
          achievementText: [
            {
              achievementId: "achievement-terraform",
              text: "Provisioned AWS resources with Terraform modules and Go.",
            },
          ],
        },
      }),
    ).toThrow(/unsupported job terms/);
  });

  it("rejects duplicate, missing, or unknown achievement responses", () => {
    const proposal = {
      achievementId: "achievement-terraform",
      text: "Provisioned AWS resources with Terraform modules.",
    };

    expect(() =>
      createTailoringResponse({
        input,
        result: { summary: "Draft", achievementText: [proposal, proposal] },
      }),
    ).toThrow(/unknown or duplicate/);
    expect(() =>
      createTailoringResponse({
        input,
        result: { summary: "Draft", achievementText: [] },
      }),
    ).toThrow(/every selected achievement/);
    expect(() =>
      createTailoringResponse({
        input,
        result: {
          summary: "Draft",
          achievementText: [
            { ...proposal, achievementId: "achievement-unselected" },
          ],
        },
      }),
    ).toThrow(/unknown or duplicate/);
  });

  it("rejects a new numeric claim that was not present in the source point", () => {
    expect(() =>
      createTailoringResponse({
        input,
        result: {
          summary: "Draft",
          achievementText: [
            {
              achievementId: "achievement-terraform",
              text: "Provisioned 25 AWS resources with Terraform modules.",
            },
          ],
        },
      }),
    ).toThrow(/unsupported number/);
  });

  it("accepts equivalent number-word and digit formatting", () => {
    const numberedInput = ResumeDraftInputSchema.parse({
      ...input,
      achievements: [
        {
          ...input.achievements[0],
          text: "Provisioned three AWS environments with Terraform modules.",
        },
      ],
    });

    expect(() =>
      createTailoringResponse({
        input: numberedInput,
        result: {
          summary: "Preserves the source metric.",
          achievementText: [
            {
              achievementId: "achievement-terraform",
              text: "Provisioned 3 AWS environments with Terraform modules.",
            },
          ],
        },
      }),
    ).not.toThrow();
  });
});
