import { describe, expect, it } from "vitest";
import sampleLibrary from "../../../examples/sample-resume-library.json";
import {
  ResumeDraftInputSchema,
  type ResumeDraftResult,
} from "../../../src/lib/ai/contracts";
import {
  AchievementTailoringError,
  buildResumeDraftInput,
  createTailoringResponse,
  TailorAchievementsRequestSchema,
} from "../../../src/lib/ai/tailor-achievements";
import type { ResumeLibrary } from "../../../src/lib/schemas/resume-data";

const library = sampleLibrary as ResumeLibrary;
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
  terminology: [
    { term: "deployment checks", alternatives: ["release validation"] },
  ],
};
const cloudPointId = "achievement-cloud-deployment-platform";
const request = {
  dataSource: "demo" as const,
  jobDescription: "Provision AWS services with Terraform.",
  analysis,
  achievementIds: [cloudPointId],
};

describe("Guided Tailor evidence preparation", () => {
  it("sends only selected enabled evidence with the JD analysis", () => {
    const input = buildResumeDraftInput(library, request);

    expect(input.analysis).toEqual(analysis);
    expect(input.jobDescription).toBe(request.jobDescription);
    expect(input.achievements.map(({ id }) => id)).toEqual([cloudPointId]);
    expect(input.achievements[0].text).toContain(
      "AWS environment provisioning",
    );
    expect(input.achievements[0].supportedSkills).toContain(
      "Infrastructure as Code",
    );
    expect(input).not.toHaveProperty("profile");
    expect(input).not.toHaveProperty("templateContext");
  });

  it("rejects duplicate, unknown, and disabled point IDs", () => {
    expect(
      TailorAchievementsRequestSchema.safeParse({
        ...request,
        achievementIds: [cloudPointId, cloudPointId],
      }).success,
    ).toBe(false);

    expect(() =>
      buildResumeDraftInput(library, {
        ...request,
        achievementIds: ["achievement-unknown"],
      }),
    ).toThrow(AchievementTailoringError);

    const disabledLibrary = structuredClone(library);
    const point = disabledLibrary.jobs
      .flatMap((job) => job.points)
      .find(({ id }) => id === cloudPointId);
    if (!point) throw new Error("Expected synthetic sample achievement.");
    point.enabled = false;
    expect(() => buildResumeDraftInput(disabledLibrary, request)).toThrow(
      /disabled/,
    );
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
      analyzedTerms: expect.arrayContaining(["Infrastructure as Code", "AWS"]),
    });
  });

  it("adds a short analyzed term when linked skill evidence supports it", () => {
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

    expect(response.proposals[0]).toMatchObject({
      proposedText:
        "Provisioned AWS resources with Terraform modules, with experience in Infrastructure as Code.",
      rationale: expect.stringContaining("supported by skills linked"),
      addedTerms: ["Infrastructure as Code"],
    });
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
