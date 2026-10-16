import { describe, expect, it } from "vitest";
import sampleLibrary from "../../../examples/sample-resume-library.json";
import {
  buildAchievementSelectionInput,
  recommendAchievements,
} from "../../../src/lib/ai/achievement-selection";
import { createGeminiProvider } from "../../../src/lib/ai/gemini-provider";
import {
  AchievementSelectionResultSchema,
  JobAnalysisResultSchema,
  ResumeDraftResultSchema,
  type ResumeDraftInput,
} from "../../../src/lib/ai/contracts";
import type { ResumeLibrary } from "../../../src/lib/schemas/resume-data";
import { createTailoringResponse } from "../../../src/lib/ai/tailor-achievements";
import { createResumeDraftHandoff } from "../../helpers/resume-draft-handoff";

const liveTestEnabled = process.env.GEMINI_LIVE_TEST === "1";

describe.skipIf(!liveTestEnabled)("Gemini live integration", () => {
  it("returns schema-valid role signals and keeps required and preferred separate", async () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is required for this test.");

    const provider = createGeminiProvider({
      apiKey,
      model: process.env.GEMINI_LIVE_MODEL ?? "gemini-2.5-flash-lite",
    });
    const result = await provider.analyzeJobDescription({
      company: "Example AI",
      roleTitle: "Machine Learning Platform Engineer",
      jobDescription: `Role: Machine Learning Platform Engineer, early career.
Required qualifications: Python programming and distributed systems experience.
Preferred qualifications: familiarity with Kubernetes.
Responsibilities: Build scalable production ML infrastructure and optimize GPU model serving latency.
Tools: Python and Kubernetes.`,
    });
    const validated = JobAnalysisResultSchema.parse(result);

    expect(validated.targetTitle.toLowerCase()).toContain("machine learning");
    expect(validated.seniority.toLowerCase()).toMatch(/early|entry|junior|new/);
    expect(validated.requiredQualifications.join(" ").toLowerCase()).toMatch(
      /python|distributed systems/,
    );
    expect(validated.preferredQualifications.join(" ").toLowerCase()).toContain(
      "kubernetes",
    );
    expect(
      validated.requiredQualifications.join(" ").toLowerCase(),
    ).not.toContain("kubernetes");
    expect(validated.responsibilities.join(" ").toLowerCase()).toMatch(
      /gpu|infrastructure|production/,
    );
    expect(validated.toolsAndPlatforms.join(" ").toLowerCase()).toContain(
      "python",
    );
  }, 60_000);

  it("drafts a selected achievement using supported JD terminology", async () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is required for this test.");

    const provider = createGeminiProvider({
      apiKey,
      model: process.env.GEMINI_LIVE_MODEL ?? "gemini-2.5-flash-lite",
    });
    const draftInput: ResumeDraftInput = {
      jobDescription:
        "Standardize AWS provisioning and deployment workflows. Use Infrastructure as Code; Terraform experience is relevant.",
      analysis: {
        targetTitle: "Cloud Platform Engineer",
        seniority: "Early career",
        requiredQualifications: ["AWS provisioning"],
        preferredQualifications: ["Terraform experience"],
        responsibilities: ["Standardize deployment workflows"],
        toolsAndPlatforms: ["AWS", "Terraform"],
        domainConcepts: ["Cloud infrastructure"],
        atsTerms: ["Infrastructure as Code"],
        inferredContext: [],
        terminology: [
          { term: "Infrastructure as Code", alternatives: ["IaC"] },
        ],
      },
      achievements: [
        {
          id: "achievement-live-terraform",
          text: "Standardized AWS provisioning with Terraform modules and deployment checks for three internal services.",
          tags: ["cloud", "deployment"],
          skillIds: ["skill-terraform"],
          supportedSkills: ["Infrastructure as Code", "IaC", "Terraform"],
          metrics: [
            {
              id: "metric-live-deployment-time",
              label: "Deployment time reduction",
              value: "25",
              unit: "%",
              evidence: "Fictional benchmark for this smoke test.",
            },
          ],
          section: "experience",
          groupId: "job-platform",
          groupTitle: "Platform Engineer",
          groupSubtitle: "Example Systems",
        },
      ],
      handoff: createResumeDraftHandoff({
        achievementId: "achievement-live-terraform",
        text: "Standardized AWS provisioning with Terraform modules and deployment checks for three internal services.",
        groupId: "job-platform",
        groupTitle: "Platform Engineer",
        linkedSkills: ["Infrastructure as Code", "IaC", "Terraform"],
      }),
    };
    const result = ResumeDraftResultSchema.parse(
      await provider.draftResume(draftInput),
    );
    const proposal = createTailoringResponse({
      input: draftInput,
      result,
    }).proposals[0];

    expect(result.achievementText).toHaveLength(1);
    expect(proposal.achievementId).toBe("achievement-live-terraform");
    expect(proposal.proposedText.toLowerCase()).toContain(
      "infrastructure as code",
    );
    expect(proposal.proposedText.toLowerCase()).toContain("terraform");
    expect(proposal.proposedText).toContain("25%");
    expect(result.resumeSummary).toBeTruthy();
    expect(proposal.proposedText).not.toContain("\\documentclass");
  }, 60_000);

  it("selects grounded points and returns all 22 requirements for a synthetic JD", async () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is required for this test.");

    const provider = createGeminiProvider({
      apiKey,
      model: process.env.GEMINI_LIVE_MODEL ?? "gemini-2.5-flash-lite",
    });
    const input = buildAchievementSelectionInput({
      library: sampleLibrary as ResumeLibrary,
      jobDescription:
        "Build and operate scalable cloud infrastructure using AWS, Terraform, Python, and distributed systems.",
      analysis: {
        targetTitle: "Cloud Platform Engineer",
        seniority: "Early career",
        requiredQualifications: [
          "AWS",
          "distributed systems",
          "Python",
          "REST API design",
          "Docker",
          "Git",
          "CI/CD",
          "Infrastructure as Code",
          "Observability",
          "TypeScript",
          "technical documentation",
          "background jobs",
          "idempotency",
          "bounded retries",
          "service dashboards",
          "release readiness",
          "schema validation",
          "accessible workflows",
        ],
        preferredQualifications: ["Terraform", "Kubernetes"],
        responsibilities: [
          "Build and operate scalable cloud infrastructure",
          "Automate release checks",
        ],
        toolsAndPlatforms: ["AWS", "Terraform", "Python"],
        domainConcepts: ["distributed systems", "cloud infrastructure"],
        atsTerms: ["AWS", "Terraform", "Python", "distributed systems"],
        inferredContext: [],
        terminology: [
          { term: "cloud infrastructure", alternatives: ["cloud platform"] },
        ],
      },
    });
    const recommendation = await recommendAchievements({
      input,
      selectWithAi: () => provider.selectAchievements(input),
    });
    expect(recommendation.mode).toBe("ai");
    const result = AchievementSelectionResultSchema.parse(
      recommendation.recommendations,
    );
    const allowedIds = new Set(input.achievements.map(({ id }) => id));
    const requirements = [
      ...input.analysis.requiredQualifications,
      ...input.analysis.responsibilities,
      ...input.analysis.preferredQualifications,
    ];
    expect(
      result.requirementCoverage.map((row) => row.requirement).sort(),
    ).toEqual(requirements.sort());

    expect(result.selections.length).toBeGreaterThan(0);
    expect(
      result.selections.every(({ achievementId }) =>
        allowedIds.has(achievementId),
      ),
    ).toBe(true);
    expect(
      result.selections.map(({ achievementId }) => achievementId),
    ).toContain("achievement-cloud-deployment-platform");
    expect(result.requirementCoverage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ requirement: "AWS" }),
        expect.objectContaining({ requirement: "distributed systems" }),
      ]),
    );
  }, 60_000);
});
