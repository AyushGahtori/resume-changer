import { describe, expect, it } from "vitest";
import sample from "../../../examples/sample-resume-library.json";
import type { ResumeLibrary } from "../../../src/lib/schemas/resume-data";
import {
  buildAchievementEvidence,
  buildSkillEvidence,
} from "../../../src/lib/ai/evidence";
import {
  assessRequirementCoverage,
  semanticMatchScore,
} from "../../../src/lib/ai/requirement-coverage";
import {
  buildAchievementSelectionInput,
  recommendAchievements,
} from "../../../src/lib/ai/achievement-selection";
import { buildProviderOutputSchema } from "../../../src/lib/ai/gemini-provider";
import { buildAiPrompt } from "../../../src/lib/ai/prompt-builder";
import {
  createTailoringResponse,
  createOriginalsFallbackResponse,
} from "../../../src/lib/ai/tailor-achievements";
import {
  enrichSourceText,
  metricIsPresent,
  preserveSubstance,
} from "../../../src/lib/ai/draft-quality";
import { createResumeDraftHandoff } from "../../helpers/resume-draft-handoff";
import type {
  AchievementSelectionInput,
  ResumeDraftInput,
} from "../../../src/lib/ai/contracts";

const analysis = {
  targetTitle: "ML Engineer",
  seniority: "Early career",
  requiredQualifications: [
    "Python",
    "Experience with PyTorch or TensorFlow.",
    "Familiarity with Git, Docker, REST APIs, and basic cloud deployment.",
  ],
  preferredQualifications: [
    "Experience with NLP, transformer architectures, or large language models.",
  ],
  responsibilities: [],
  toolsAndPlatforms: ["Python", "TensorFlow", "Docker"],
  domainConcepts: [],
  atsTerms: [],
  inferredContext: [],
  terminology: [],
};
const metric = {
  id: "metric-resource",
  label: "Resource utilization improvement",
  value: "19",
  unit: "%",
  evidence: "Fictional benchmark shows resource utilization improved by 19%.",
};
const source = {
  id: "achievement-model",
  text: "Engineered Python REST APIs and Docker deployment for a CNN classifier, improving resource utilization.",
  tags: ["cloud deployment"],
  skillIds: [],
  supportedSkills: ["Python", "REST APIs", "Docker"],
  section: "experience" as const,
  groupId: "job-model",
  groupTitle: "ML Engineer",
  groupSubtitle: "Example Labs",
  initiativeId: "initiative-classifier",
  metrics: [metric],
};
const skills = [
  {
    id: "skill-tensorflow",
    name: "TensorFlow",
    aliases: [],
    isListedOnCurrentResume: true,
    evidenceAchievementIds: [],
  },
  {
    id: "skill-git",
    name: "Git",
    aliases: [],
    isListedOnCurrentResume: true,
    evidenceAchievementIds: [],
  },
];
function selectionInput(): AchievementSelectionInput {
  return {
    jobDescription: "Build ML systems.",
    analysis,
    achievements: [source],
    skills,
    contentBudgetLines: 60,
  };
}
function draftInput(): ResumeDraftInput {
  const input = selectionInput();
  return {
    jobDescription: input.jobDescription,
    analysis: input.analysis,
    skills: input.skills,
    achievements: [source],
    handoff: createResumeDraftHandoff({
      achievementId: source.id,
      text: source.text,
      groupId: source.groupId,
      groupTitle: source.groupTitle,
    }),
  };
}

describe("complete evidence and coverage quality", () => {
  it("retains metrics and both directions of skill links without contacts", () => {
    const library = structuredClone(sample) as ResumeLibrary;
    const point = library.jobs[0].points[0];
    point.metrics = [metric];
    library.skills[0].evidenceAchievementIds = [point.id];
    point.skillIds = [];
    const input = buildAchievementSelectionInput({
      library,
      analysis,
      jobDescription: "Build systems.",
    });
    expect(input.achievements.find((p) => p.id === point.id)?.metrics).toEqual([
      metric,
    ]);
    expect(
      input.achievements.find((p) => p.id === point.id)?.supportedSkills,
    ).toContain(library.skills[0].name);
    expect(input.profile).not.toHaveProperty("email");
    expect(
      buildSkillEvidence(library).find((s) => s.id === library.skills[0].id)
        ?.evidenceAchievementIds,
    ).toContain(point.id);
  });

  it("discloses a compatible declared-framework inference but does not infer from generic ML", () => {
    const library = structuredClone(sample) as ResumeLibrary;
    library.skills.push({ ...skills[0], sources: ["direct-user"] });
    library.jobs[0].points[0].text =
      "Built a CNN classifier with an Adam optimizer.";
    expect(buildAchievementEvidence(library)[0].inferredSkills).toEqual([
      expect.objectContaining({ name: "TensorFlow" }),
    ]);
    library.jobs[0].points[0].text = "Worked on machine learning.";
    expect(buildAchievementEvidence(library)[0].inferredSkills).toEqual([]);
  });

  it("allows one substantive achievement to support multiple requirements and ranks job evidence first", () => {
    const rows = assessRequirementCoverage(selectionInput(), [source.id]);
    expect(rows.find((r) => r.requirement === "Python")?.status).toBe(
      "supported",
    );
    expect(
      rows.find((r) => r.requirement.includes("Git, Docker"))?.status,
    ).toBe("supported");
    expect(
      rows.find((r) => r.requirement.includes("TensorFlow"))?.evidence[0].kind,
    ).toBe("skill");
    const input = selectionInput();
    input.achievements.push({
      ...source,
      id: "achievement-project",
      section: "projects",
      groupId: "project-classifier",
    });
    expect(
      assessRequirementCoverage(input, [source.id, "achievement-project"])[0]
        .evidence[0].kind,
    ).toBe("job");
  });

  it("distinguishes AND, OR, absent frameworks, partial qualifications and in-progress degrees", () => {
    const input = selectionInput();
    input.analysis = {
      ...analysis,
      requiredQualifications: [
        "Proficiency in Python, NumPy, Pandas, and scikit-learn.",
        "Experience with PyTorch or TensorFlow.",
        "Bachelor's degree in Artificial Intelligence.",
        "Develop deep learning models using PyTorch or TensorFlow.",
      ],
      preferredQualifications: [],
    };
    input.profile = {
      education: [
        {
          id: "education-current",
          institutions: ["Example University"],
          degree: "Bachelor's degree",
          fieldOfStudy: "Artificial Intelligence",
          startDate: "2026-09",
          endDate: null,
        },
      ],
      credentials: [],
    };
    const rows = assessRequirementCoverage(input, [source.id]);
    expect(rows.map((r) => r.status)).toEqual([
      "partial",
      "supported",
      "partial",
      "partial",
    ]);
    expect(rows[0].missingComponents).toContain("numpy");
    expect(rows[3].status).not.toBe("supported");
    expect(semanticMatchScore("container workloads", "AI")).toBe(0);
    expect(
      semanticMatchScore("Developed a Golang service.", "Python, Go, or C++"),
    ).toBe(1);
    expect(
      semanticMatchScore(
        "Integrated LLM workflows.",
        analysis.preferredQualifications[0],
      ),
    ).toBe(1);
  });

  it("handles elliptical conjunctions and does not combine unrelated ML and AWS into model deployment", () => {
    const input = selectionInput();
    input.analysis = {
      ...analysis,
      requiredQualifications: [
        "Understanding of supervised and unsupervised learning algorithms.",
        "Experience deploying ML models using AWS, Azure, or Google Cloud.",
      ],
      preferredQualifications: [],
    };
    input.achievements = [
      { ...source, text: "Optimized recommendations with LightGBM." },
      {
        ...source,
        id: "achievement-hosting",
        groupId: "job-other",
        text: "Configured AWS EC2 backend routing and deployment.",
      },
    ];
    const rows = assessRequirementCoverage(
      input,
      input.achievements.map((p) => p.id),
    );
    expect(rows[0].status).toBe("partial");
    expect(rows[0].missingComponents).toContain("unsupervised learning");
    expect(rows[1].status).toBe("partial");
  });

  it("does not report omitted final skills or source-only tags as rendered coverage", () => {
    const input = selectionInput();
    const rows = assessRequirementCoverage(input, [source.id], {
      renderedSkillIds: [],
      renderedTexts: new Map([[source.id, "Engineered a service."]]),
    });
    expect(rows.find((r) => r.requirement.includes("TensorFlow"))?.status).toBe(
      "evidence-not-selected",
    );
    expect(rows.find((r) => r.requirement === "Python")?.status).not.toBe(
      "supported",
    );
  });

  it("keeps a mixed direct/inferred framework match uncertain rather than confirmed", () => {
    const input = selectionInput();
    input.analysis = {
      ...analysis,
      requiredQualifications: [
        "Develop deep learning models using PyTorch or TensorFlow.",
      ],
      preferredQualifications: [],
    };
    input.skills = [];
    input.achievements = [
      { ...source, text: "Developed a CNN classifier using TensorFlow." },
      {
        ...source,
        id: "achievement-cnn-method",
        text: "Developed a CNN classifier for image classification.",
      },
    ];
    const rows = assessRequirementCoverage(
      input,
      input.achievements.map((point) => point.id),
      {
        inferredTermsById: new Map([[source.id, ["TensorFlow"]]]),
      },
    );
    expect(rows[0].status).toBe("uncertain");
    expect(rows[0].reason).toContain("disclosed framework inference");
  });

  it("preserves capacity for all 22 requirements and more than twenty requested drafts", () => {
    const input = selectionInput();
    input.analysis = {
      ...analysis,
      requiredQualifications: Array.from(
        { length: 22 },
        (_, i) => `Python task ${i}`,
      ),
      preferredQualifications: [],
      responsibilities: [],
    };
    const prompt = buildAiPrompt("selectAchievements", input);
    const schema = buildProviderOutputSchema(
      prompt.outputSchema,
      "selectAchievements",
      input,
    );
    expect(
      (schema.properties as Record<string, { description: string }>)
        .requirementCoverage.description,
    ).toContain("all 22 supplied requirements");
    expect(JSON.stringify(schema)).not.toMatch(/"(?:maxItems|minItems)"/);
    expect(JSON.stringify(prompt.outputSchema)).toContain('"maxItems":300');
    expect(assessRequirementCoverage(input, [source.id])).toHaveLength(22);
    const draft = draftInput();
    draft.achievements = Array.from({ length: 25 }, (_, i) => ({
      ...source,
      id: `achievement-${i}`,
    }));
    const output = buildProviderOutputSchema(
      buildAiPrompt("draftResume", draft).outputSchema,
      "draftResume",
      draft,
    );
    expect(
      (output.properties as Record<string, { description: string }>)
        .achievementText.description,
    ).toContain("all 25 selected source achievements");
    expect(JSON.stringify(output)).not.toMatch(/"(?:maxItems|minItems)"/);
  });

  it("sizes provider coverage for all three complete analysis categories", () => {
    const input = selectionInput();
    input.analysis = {
      ...analysis,
      requiredQualifications: Array.from(
        { length: 100 },
        (_, index) => `Required Python ${index}`,
      ),
      responsibilities: Array.from(
        { length: 100 },
        (_, index) => `Operate Python ${index}`,
      ),
      preferredQualifications: Array.from(
        { length: 100 },
        (_, index) => `Preferred Python ${index}`,
      ),
    };
    const output = buildProviderOutputSchema(
      buildAiPrompt("selectAchievements", input).outputSchema,
      "selectAchievements",
      input,
    );
    expect(
      (output.properties as Record<string, { description: string }>)
        .requirementCoverage.description,
    ).toContain("all 300 supplied requirements");
    expect(assessRequirementCoverage(input, [source.id])).toHaveLength(300);
  });

  it("has no per-role bullet cap and charges longer content more space", async () => {
    const input = selectionInput();
    input.achievements = Array.from({ length: 7 }, (_, i) => ({
      ...source,
      id: `achievement-${i}`,
      metrics: [],
      text: `Developed distinct Python service ${i} with REST APIs for reliable cloud deployment and operational checks.`,
    }));
    const response = await recommendAchievements({
      input,
      selectWithAi: async () => {
        throw new Error("offline");
      },
    });
    expect(response.recommendations.selections).toHaveLength(7);
    const single = { ...input, achievements: [input.achievements[0]] };
    const short = await recommendAchievements({
      input: single,
      selectWithAi: async () => {
        throw new Error("offline");
      },
    });
    single.achievements[0] = {
      ...single.achievements[0],
      text: `${single.achievements[0].text} ${"Specific source-backed implementation details. ".repeat(7)}`,
    };
    const long = await recommendAchievements({
      input: single,
      selectWithAi: async () => {
        throw new Error("offline");
      },
    });
    expect(long.budget.usedLines).toBeGreaterThan(short.budget.usedLines);
  });

  it("reserves substantial evidence for both relevant roles before taking a fifth from one", async () => {
    const input = selectionInput();
    input.contentBudgetLines = 18;
    input.achievements = ["job-one", "job-two"].flatMap((groupId) =>
      Array.from({ length: 6 }, (_, index) => ({
        ...source,
        groupId,
        id: `achievement-${groupId}-${index}`,
        metrics: [],
        text: `Developed distinct AWS service ${index} with Python REST APIs for reliable cloud execution and deployment checks.`,
      })),
    );
    const result = await recommendAchievements({
      input,
      selectWithAi: async () => ({
        selections: input.achievements.map((point) => ({
          achievementId: point.id,
          section: point.section,
          confidence: point.groupId === "job-one" ? 0.99 : 0.1,
          rationale: "Relevant source evidence.",
        })),
        requirementCoverage: [],
        skillRecommendations: [],
        confidence: 0.9,
        summary: "Selected relevant source evidence.",
      }),
    });
    for (const group of ["job-one", "job-two"]) {
      expect(
        result.recommendations.selections.filter(
          (selected) =>
            input.achievements.find(
              (point) => point.id === selected.achievementId,
            )?.groupId === group,
        ).length,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("achievement-led rewriting and validation", () => {
  it("accepts equivalent thousands formatting while retaining named products", () => {
    const input = draftInput();
    input.achievements[0] = {
      ...source,
      text: "Built ExampleVoice in Python to handle 10K+ calls per day.",
      metrics: [
        {
          ...metric,
          id: "metric-calls",
          label: "Calls handled",
          value: "10K+",
          unit: "calls per day",
        },
      ],
    };
    const result = createTailoringResponse({
      input,
      result: {
        summary: "Draft",
        achievementText: [
          {
            achievementId: source.id,
            text: "Built ExampleVoice in Python to handle 10,000 calls per day.",
          },
        ],
      },
    });
    expect(result.proposals[0].proposedText).toContain("ExampleVoice");
    expect(result.proposals[0].proposedText).toContain("10,000");
    expect(
      preserveSubstance("Built a Python calling platform.", input.achievements)
        .restored,
    ).toBe(true);
  });
  it("restores metrics that the model never included in plain wording", () => {
    const input = draftInput();
    const result = createTailoringResponse({
      input,
      result: {
        summary: "Aligned evidence.",
        achievementText: [{ achievementId: source.id, text: source.text }],
      },
    });
    expect(result.proposals[0].proposedText).toContain("19%");
    expect(result.proposals[0].retainedMetricIds).toContain(metric.id);
    expect(result.resumeSummary).toContain("19%");
    expect(enrichSourceText(source)).toContain("19%");
    expect(metricIsPresent(result.proposals[0].proposedText, metric)).toBe(
      true,
    );
  });

  it("accepts a disclosed compatible framework inference and preserves substantive methods", () => {
    const input = draftInput();
    input.achievements[0] = {
      ...source,
      inferredSkills: [
        {
          name: "TensorFlow",
          reason: "Declared skill and compatible CNN method.",
        },
      ],
    };
    const response = createTailoringResponse({
      input,
      result: {
        summary: "Draft",
        achievementText: [
          {
            achievementId: source.id,
            text: `${source.text.replace(/\.$/, "")} using TensorFlow.`,
          },
        ],
      },
    });
    expect(response.proposals[0].inferredTerms).toEqual(["TensorFlow"]);
    expect(response.qualityNotes?.join(" ")).toContain(
      "Inferred framework usage",
    );
    expect(preserveSubstance("Built ML.", [source]).restored).toBe(true);
  });

  it("combines related sources with complete provenance and rejects unrelated employers", () => {
    const input = draftInput();
    const second = {
      ...source,
      id: "achievement-deployment",
      text: "Deployed the CNN classifier with Python REST APIs and Docker for real-time inference.",
      metrics: [],
    };
    input.achievements.push(second);
    const result = {
      summary: "Draft",
      achievementText: [
        {
          achievementId: source.id,
          sourceAchievementIds: [source.id, second.id],
          text: `${source.text} ${second.text}`,
        },
      ],
    };
    expect(
      createTailoringResponse({ input, result }).proposals[0]
        .sourceAchievementIds,
    ).toEqual([source.id, second.id]);
    input.achievements[1] = { ...second, groupId: "job-other" };
    expect(() => createTailoringResponse({ input, result })).toThrow(
      /same source group/,
    );
  });

  it("rejects changing a metric outcome and repairs a bad item without discarding good evidence", () => {
    const input = draftInput();
    const result = {
      summary: "Draft",
      achievementText: [
        { achievementId: source.id, text: "Reduced container crashes by 19%." },
      ],
    };
    expect(() => createTailoringResponse({ input, result })).toThrow(
      /unsupported number/,
    );
    const repaired = createTailoringResponse({
      input,
      result,
      repairInvalid: true,
    });
    expect(repaired.proposals[0].proposedText).toContain(
      "19% better resource utilization",
    );
    expect(repaired.proposals[0].proposedText).not.toContain("crashes by 19%");
  });

  it("discloses directly supported JD phrases still missing after drafting", () => {
    const input = draftInput();
    input.analysis.atsTerms = ["TensorFlow"];
    input.achievements[0] = { ...source, supportedSkills: ["TensorFlow"] };
    const result = createTailoringResponse({
      input,
      result: {
        summary: "Draft",
        achievementText: [{ achievementId: source.id, text: source.text }],
      },
    });
    expect(result.qualityNotes?.join(" ")).toContain(
      "Supported JD phrases still absent after drafting: TensorFlow",
    );
  });

  it("replaces unsupported summary claims and enriches provider-failure originals with recorded metrics", () => {
    const input = draftInput();
    const result = createTailoringResponse({
      input,
      result: {
        summary: "Draft",
        resumeSummary:
          "Trained models for 99 years and increased accuracy 999%.",
        achievementText: [{ achievementId: source.id, text: source.text }],
      },
    });
    expect(result.resumeSummary).not.toContain("999%");
    expect(result.qualityNotes?.join(" ")).toContain("unsupported summary");
    expect(
      createOriginalsFallbackResponse({ input, notice: "Offline" }).proposals[0]
        .proposedText,
    ).toContain("19%");
  });
});
