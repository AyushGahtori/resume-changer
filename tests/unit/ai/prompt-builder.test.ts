import { describe, expect, it } from "vitest";
import {
  buildAiPrompt,
  MAX_PROMPT_CHARACTERS,
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

    expect(result.prompt).toContain("Prompt version: v3-resume-advice");
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

  it("repairs page overflow using rendered context without permitting style or evidence changes", () => {
    const prompt = buildAiPrompt("repairLatexContent", {
      currentContent: {
        summary: "Repair the selected resume wording.",
        resumeSummary: "Platform engineer experienced with AWS.",
        achievementText: [
          {
            achievementId: "achievement-cloud-deployment",
            sourceAchievementIds: ["achievement-cloud-deployment"],
            text: "Provisioned cloud resources with Terraform modules.",
          },
        ],
      },
      diagnostics: ["The resume exceeds one page by eight words."],
      firstPageText: "Content measured on page one.",
      overflowText: "Content that flowed onto page two.",
      overflowWordCount: 8,
    });

    expect(prompt.prompt).toContain("preserve all supported facts");
    expect(prompt.prompt).toContain("source-to-bullet assignments");
    expect(prompt.prompt).toContain("Do not remove a point");
    expect(prompt.prompt).toContain("font family or size");
    expect(prompt.prompt).toContain('"overflowWordCount":8');
    expect(prompt.prompt).toContain(
      '"firstPageText":"Content measured on page one."',
    );
    expect(prompt.prompt).toContain(
      '"overflowText":"Content that flowed onto page two."',
    );
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

  it("attaches resume advice only to the tasks that write or select evidence", () => {
    const writing = buildAiPrompt("draftResume", {
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
    }).prompt;
    const editing = buildAiPrompt("achievementEdit", {
      sources: [
        {
          id: "point-a",
          text: "Built an API.",
          factualConstraints: [],
        },
      ],
      skills: [],
      draftText: "",
      instruction: "Clarify the supported work.",
      destination: "Platform Engineer",
    }).prompt;
    const selection = buildAiPrompt("selectAchievements", {
      jobDescription: "Provision AWS infrastructure.",
      analysis: jobAnalysis,
      achievements: [
        {
          id: "achievement-cloud-deployment",
          text: "Standardized AWS provisioning.",
          tags: [],
          skillIds: [],
          section: "experience",
          groupId: "job-platform",
          groupTitle: "Platform Engineer",
        },
      ],
      skills: [],
      contentBudgetLines: 18,
    }).prompt;
    const analysis = buildAiPrompt("analyzeJobDescription", {
      company: "Example Systems",
      roleTitle: "Platform Engineer",
      jobDescription: "Maintain distributed services.",
    }).prompt;
    const repair = buildAiPrompt("repairLatexContent", {
      currentContent: {
        summary: "Repair the selected resume wording.",
        resumeSummary: "Platform engineer experienced with AWS.",
        achievementText: [
          {
            achievementId: "achievement-cloud-deployment",
            sourceAchievementIds: ["achievement-cloud-deployment"],
            text: "Provisioned cloud resources with Terraform modules.",
          },
        ],
      },
      diagnostics: ["The resume exceeds one page by eight words."],
    }).prompt;
    const precedence =
      "Style never authorizes a new number, tool, employer, or date, and never authorizes dropping a supplied metric.";

    expect(writing).toContain("Resume writing rules:");
    expect(writing).toContain(precedence);
    expect(writing).toContain("Bullet shape:");
    expect(writing).toContain("Do not brag");
    expect(writing).toContain(
      "The summary must describe the same work as the selected roles.",
    );
    expect(writing.indexOf("Resume writing rules:")).toBeLessThan(
      writing.indexOf("Task instructions:"),
    );
    expect(editing).toContain("Resume writing rules:");
    expect(editing).toContain(precedence);
    for (const task of ["achievementMerge", "achievementCreate"] as const) {
      const prompt = buildAiPrompt(task, {
        sources: [
          {
            id: "point-a",
            text: "Built an API.",
            factualConstraints: [],
          },
        ],
        skills: [],
        draftText: "",
        instruction: "Clarify the supported work.",
        destination: "Platform Engineer",
      }).prompt;
      expect(prompt).toContain("Resume writing rules:");
      expect(prompt).not.toContain("Resume selection rules:");
    }
    expect(selection).toContain("Resume selection rules:");
    expect(selection).toContain("school or course project");
    expect(selection).not.toContain("Bullet shape:");
    expect(analysis).not.toContain("Resume writing rules:");
    expect(analysis).not.toContain("Resume selection rules:");
    expect(repair).not.toContain("Resume writing rules:");
    expect(repair).not.toContain("Resume selection rules:");
  });

  it("loads the approved template from its dedicated source and bounds prompt size", () => {
    expect(loadApprovedTemplateContext()).toBe(JAKE_STYLE_TEMPLATE);
    expect(MAX_PROMPT_CHARACTERS).toBe(360_000);
    expect(() =>
      buildAiPrompt("selectAchievements", {
        jobDescription: "Platform role.",
        analysis: jobAnalysis,
        achievements: Array.from({ length: 52 }, (_, index) => ({
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
    expect(() =>
      buildAiPrompt("selectAchievements", {
        jobDescription: "Platform role.",
        analysis: jobAnalysis,
        achievements: Array.from({ length: 40 }, (_, index) => ({
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
    ).not.toThrow();
  });
});
