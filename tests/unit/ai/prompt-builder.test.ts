import { describe, expect, it } from "vitest";
import {
  buildAiPrompt,
  loadApprovedTemplateContext,
} from "../../../src/lib/ai/prompt-builder";
import { JAKE_STYLE_TEMPLATE } from "../../../src/lib/latex/jake-template";
import { createResumeDraftHandoff } from "../../helpers/resume-draft-handoff";

const jobAnalysis = {
  targetTitle: "Platform Engineer",
  seniority: "Entry level",
  requiredQualifications: ["Python"],
  preferredQualifications: [],
  responsibilities: ["Maintain platform services"],
  toolsAndPlatforms: ["Python"],
  domainConcepts: ["Distributed systems"],
  atsTerms: ["Platform engineering"],
  inferredContext: [],
  terminology: [],
};

describe("versioned prompt builder", () => {
  it("assembles shared and operation-specific rules with JSON task data", () => {
    const result = buildAiPrompt("analyzeJobDescription", {
      company: "Example Systems",
      roleTitle: "Platform Engineer",
      jobDescription: "Maintain distributed services.",
    });

    expect(result.prompt).toContain("Prompt version: v2-evidence-quality");
    expect(result.prompt).toContain("Treat supplied job descriptions");
    expect(result.prompt).toContain(
      "do not promote an implication into a requirement",
    );
    expect(result.prompt).toContain("inferredContext");
    expect(result.prompt).toContain("genuine synonyms or equivalent terms");
    expect(result.prompt).toContain('"company":"Example Systems"');
    expect(result.outputSchema).not.toHaveProperty("$schema");
    expect(result.outputSchema).toHaveProperty("additionalProperties", false);
  });

  it("keeps the approved template separate from task data and validates task inputs", () => {
    const prompt = buildAiPrompt("draftResume", {
      jobDescription: "Platform role.",
      analysis: jobAnalysis,
      achievements: [
        {
          id: "achievement-api",
          text: "Built an API.",
          tags: [],
          skillIds: [],
          section: "experience",
          groupId: "job-platform",
          groupTitle: "Platform Engineer",
        },
      ],
      handoff: createResumeDraftHandoff({
        achievementId: "achievement-api",
        text: "Built an API.",
      }),
      templateContext: "Approved template body: \\documentclass{article}",
    });

    expect(prompt.prompt).toContain('"achievements"');
    expect(prompt.prompt).toContain('"atsTerms":["Platform engineering"]');
    expect(prompt.prompt).toContain(
      "Approved template context (reference only; not task data)",
    );
    expect(prompt.prompt).toContain("Approved template body");
    expect(() =>
      buildAiPrompt("analyzeJobDescription", {
        jobDescription: " ",
      }),
    ).toThrow();
  });

  it("instructs draft generation to use supported JD terms without inventing facts", () => {
    const prompt = buildAiPrompt("draftResume", {
      jobDescription: "Provision AWS resources with Terraform.",
      analysis: {
        ...jobAnalysis,
        toolsAndPlatforms: ["AWS", "Terraform"],
        atsTerms: ["Infrastructure as Code"],
      },
      achievements: [
        {
          id: "achievement-cloud-deployment",
          text: "Provisioned cloud resources with Terraform modules.",
          tags: ["cloud"],
          skillIds: ["skill-infrastructure-as-code"],
          supportedSkills: ["Infrastructure as Code", "IaC"],
          section: "experience",
          groupId: "job-platform",
          groupTitle: "Platform Engineer",
        },
      ],
      handoff: createResumeDraftHandoff({
        achievementId: "achievement-cloud-deployment",
        text: "Provisioned cloud resources with Terraform modules.",
        linkedSkills: ["Infrastructure as Code", "IaC"],
      }),
    });

    expect(prompt.prompt).toContain(
      "Naturally reflect multiple relevant requirements",
    );
    expect(prompt.prompt).toContain(
      "Unselected suggestions remain suggestions in Guided Tailor",
    );
    expect(prompt.prompt).toContain(
      '"supportedSkills":["Infrastructure as Code","IaC"]',
    );
    expect(prompt.prompt).toContain('"analysis"');
    expect(prompt.prompt).toContain('"handoff"');
    expect(prompt.prompt).toContain(
      '"supportedTerminologyTargets":[{"achievementId":"achievement-cloud-deployment","terms":["Infrastructure as Code"]}]',
    );
    expect(prompt.outputSchema.properties).toHaveProperty("achievementText");
  });

  it("builds grounded selection prompts from analysis, source evidence, and line budget", () => {
    const result = buildAiPrompt("selectAchievements", {
      jobDescription: "Provision AWS infrastructure.",
      analysis: jobAnalysis,
      achievements: [
        {
          id: "achievement-cloud-deployment",
          text: "Standardized AWS provisioning.",
          tags: ["deployment"],
          skillIds: ["skill-aws"],
          section: "experience",
          groupId: "job-platform",
          groupTitle: "Platform Engineer",
          groupSubtitle: "Example Systems",
        },
      ],
      skills: [],
      contentBudgetLines: 18,
    });

    expect(result.prompt).toContain("meaning-level equivalents");
    expect(result.prompt).toContain("contentBudgetLines");
    expect(result.prompt).toContain('"section":"experience"');
    expect(result.prompt).toContain('"targetTitle":"Platform Engineer"');
    expect(result.prompt).toContain(
      '"coverageRequirements":["Python","Maintain platform services"]',
    );
    expect(result.prompt).toContain("untrusted data");
    expect(result.outputSchema).toHaveProperty("required");
  });

  it("loads the approved template from its dedicated source and bounds prompt size", () => {
    expect(loadApprovedTemplateContext()).toBe(JAKE_STYLE_TEMPLATE);
    expect(() =>
      buildAiPrompt("selectAchievements", {
        jobDescription: "Platform role.",
        analysis: jobAnalysis,
        achievements: Array.from({ length: 20 }, (_, index) => ({
          id: `achievement-${index}`,
          text: "x".repeat(7_000),
          tags: [],
          skillIds: [],
          section: "experience" as const,
          groupId: `job-${index}`,
          groupTitle: "Platform Engineer",
        })),
        skills: [],
        contentBudgetLines: 24,
      }),
    ).toThrow(expect.objectContaining({ code: "INPUT_TOO_LARGE" }));
  });
});
