import { describe, expect, it } from "vitest";
import { createGeminiProvider } from "../../../src/lib/ai/gemini-provider";
import {
  JobAnalysisResultSchema,
  ResumeDraftResultSchema,
} from "../../../src/lib/ai/contracts";

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
    const result = await provider.draftResume({
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
          section: "experience",
          groupId: "job-platform",
          groupTitle: "Platform Engineer",
          groupSubtitle: "Example Systems",
        },
      ],
    });
    const validated = ResumeDraftResultSchema.parse(result);
    const proposal = validated.achievementText[0];

    expect(validated.achievementText).toHaveLength(1);
    expect(proposal.achievementId).toBe("achievement-live-terraform");
    expect(proposal.text.toLowerCase()).toContain("infrastructure as code");
    expect(proposal.text.toLowerCase()).toContain("terraform");
    expect(proposal.text).not.toContain("\\documentclass");
  }, 60_000);
});
