import { describe, expect, it } from "vitest";
import sampleLibrary from "../../../examples/sample-resume-library.json";
import type { ResumeLibrary } from "../../../src/lib/schemas/resume-data";
import {
  buildAchievementEvidence,
  buildProfileEvidence,
  buildSkillEvidence,
  evidenceText,
} from "../../../src/lib/ai/evidence";
import {
  getCoverageRequirements,
  includesPhrase,
  normalizeEvidence,
  requirementComponents,
  semanticMatchScore,
} from "../../../src/lib/ai/requirement-coverage";

const library = sampleLibrary as ResumeLibrary;

describe("normalizeEvidence", () => {
  it("lowercases and strips punctuation while keeping meaningful symbols", () => {
    expect(normalizeEvidence("C++, Node.js, and REST APIs")).toBe(
      "c++ node js and rest apis",
    );
  });

  it("removes thousands separators so numbers compare consistently", () => {
    expect(normalizeEvidence("1,250 requests")).toBe("1250 requests");
    // A decimal point is not part of the comparable alphabet, so it separates
    // the digits rather than joining them.
    expect(normalizeEvidence("1,250.5 requests")).toBe("1250 5 requests");
  });

  it("splits combining marks out of accented words", () => {
    expect(normalizeEvidence("développé")).toBe("de veloppe");
  });

  it("collapses surrounding whitespace", () => {
    expect(normalizeEvidence("  spaced   out  ")).toBe("spaced out");
  });
});

describe("includesPhrase", () => {
  it("matches a whole phrase inside a sentence", () => {
    expect(includesPhrase("Built Python APIs for billing", "python")).toBe(
      true,
    );
    expect(includesPhrase("Built Python APIs for billing", "docker")).toBe(
      false,
    );
  });

  it("does not match a partial word", () => {
    expect(includesPhrase("JavaScript everywhere", "java")).toBe(false);
  });

  it("matches across punctuation and casing differences", () => {
    expect(includesPhrase("Deployed on AWS.", "aws")).toBe(true);
  });
});

describe("requirementComponents", () => {
  it("recognises a concept from its known aliases", () => {
    expect(
      requirementComponents("Experience with Amazon Web Services"),
    ).toContain("aws");
    expect(requirementComponents("Familiarity with Golang")).toContain("go");
  });

  it("collects every concept a requirement mentions", () => {
    const components = requirementComponents(
      "Build REST APIs with Python and Docker",
    );
    expect(components).toContain("python");
    expect(components).toContain("docker");
    expect(components).toContain("REST APIs");
  });

  it("does not manufacture 'supervised' from 'unsupervised'", () => {
    const components = requirementComponents(
      "Unsupervised learning experience",
    );
    expect(components).toContain("unsupervised learning");
    expect(components).not.toContain("supervised learning");
  });

  it("treats 'supervised learning' as supervised when the words are both present", () => {
    const components = requirementComponents("Supervised learning experience");
    expect(components).toContain("supervised learning");
  });

  it("recognises a soft-skill concept by its known alias", () => {
    expect(requirementComponents("Strong stakeholder communication")).toContain(
      "communication",
    );
  });

  it("returns no components for a requirement with no known concept", () => {
    expect(
      requirementComponents("Strong stakeholder relationship management"),
    ).toEqual([]);
  });
});

describe("semanticMatchScore", () => {
  it("returns 1 for an exact phrase match", () => {
    expect(semanticMatchScore("Experience with AWS", "AWS")).toBe(1);
  });

  it("scores a partial concept match below 1", () => {
    // Only "docker" is a known concept in the requirement, so one of the two
    // recognised components is covered.
    const score = semanticMatchScore(
      "Built Docker deployment pipelines",
      "Experience with Docker and Python",
    );
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 when the evidence does not cover the requirement", () => {
    expect(
      semanticMatchScore("Built billing features", "Kubernetes operators"),
    ).toBe(0);
  });

  it("falls back to token overlap for requirements with no known concept", () => {
    expect(
      semanticMatchScore(
        "Wrote documentation for the deployment runbook",
        "documentation",
      ),
    ).toBeGreaterThan(0);
  });
});

describe("getCoverageRequirements", () => {
  it("combines required, responsibility, and preferred requirements without duplicates", () => {
    const analysis = {
      targetTitle: "Platform Engineer",
      seniority: "Entry level",
      requiredQualifications: ["Python", "Docker"],
      responsibilities: ["Deploy services", "Python"],
      preferredQualifications: ["Docker", "Kubernetes"],
      toolsAndPlatforms: [],
      domainConcepts: [],
      atsTerms: [],
      inferredContext: [],
      terminology: [],
    };

    expect(getCoverageRequirements(analysis)).toEqual([
      "Python",
      "Docker",
      "Deploy services",
      "Kubernetes",
    ]);
  });
});

describe("buildSkillEvidence", () => {
  it("keeps only evidence that points at an enabled achievement", () => {
    const skills = buildSkillEvidence(library);
    const enabled = new Set(
      [...library.jobs, ...library.projects]
        .flatMap((group) => group.points.filter((point) => point.enabled))
        .map((point) => point.id),
    );

    for (const skill of skills) {
      for (const id of skill.evidenceAchievementIds) {
        expect(enabled.has(id)).toBe(true);
      }
    }
  });

  it("derives evidence from the points that link the skill", () => {
    const skills = buildSkillEvidence(library);
    const aws = skills.find((skill) => skill.id === "skill-aws");

    expect(aws?.evidenceAchievementIds).toContain(
      "achievement-service-capacity-design",
    );
    expect(aws?.evidenceAchievementIds).toContain(
      "achievement-cloud-deployment-platform",
    );
  });

  it("preserves the declared resume listing and aliases", () => {
    const skills = buildSkillEvidence(library);
    const skill = skills.find((item) => item.id === "skill-aws");

    expect(skill).toMatchObject({
      name: expect.any(String),
      isListedOnCurrentResume: expect.any(Boolean),
    });
    expect(Array.isArray(skill?.aliases)).toBe(true);
  });
});

describe("buildProfileEvidence", () => {
  it("exposes the profile facts used to ground a summary", () => {
    const profile = buildProfileEvidence(library);

    expect(profile.headline).toBe(library.profile.headline);
    expect(profile.summary).toBe(library.profile.summary);
    expect(profile.education).toEqual(library.profile.education);
    expect(profile.credentials).toEqual(library.credentials);
  });
});

describe("buildAchievementEvidence", () => {
  it("returns only enabled points from jobs and projects", () => {
    const disabled = structuredClone(library);
    disabled.jobs[0].points[0].enabled = false;

    const evidence = buildAchievementEvidence(disabled);

    expect(
      evidence.some(
        (item) => item.id === "achievement-service-capacity-design",
      ),
    ).toBe(false);
    expect(evidence.length).toBeGreaterThan(0);
  });

  it("keeps the source group for every point", () => {
    const evidence = buildAchievementEvidence(library);
    const point = evidence.find(
      (item) => item.id === "achievement-service-capacity-design",
    );

    expect(point).toMatchObject({
      section: "experience",
      groupId: "job-example-cloud-labs",
      groupTitle: library.jobs[0].title,
      groupSubtitle: library.jobs[0].company,
    });
  });

  it("links a point to the skills that cite it as evidence", () => {
    const evidence = buildAchievementEvidence(library);
    const point = evidence.find(
      (item) => item.id === "achievement-service-capacity-design",
    );

    expect(point?.skillIds).toContain("skill-system-design");
    expect(point?.supportedSkills).toContain("AWS");
  });

  it("does not infer a framework when no compatible method is recorded", () => {
    const evidence = buildAchievementEvidence(library);
    const point = evidence.find(
      (item) => item.id === "achievement-service-capacity-design",
    );

    expect(point?.inferredSkills).toEqual([]);
  });

  it("offers a disclosed framework inference for a compatible neural-network method", () => {
    const withMl = structuredClone(library);
    withMl.skills.push({
      id: "skill-tensorflow",
      name: "TensorFlow",
      aliases: ["TF"],
      sources: ["user-notes"],
      isListedOnCurrentResume: true,
      evidenceAchievementIds: [],
    });
    withMl.jobs[0].points[0].text =
      "Trained a convolutional neural network classifier on the billing dataset.";

    const evidence = buildAchievementEvidence(withMl);
    const point = evidence.find(
      (item) => item.id === "achievement-service-capacity-design",
    );

    expect(point?.inferredSkills).toEqual([
      expect.objectContaining({ name: "TensorFlow" }),
    ]);
    expect(point?.inferredSkills?.[0].reason).toContain(
      "not directly recorded",
    );
  });
});

describe("evidenceText", () => {
  it("joins the text, context, tags, skills, and metrics of a point", () => {
    const evidence = buildAchievementEvidence(library);
    const point = evidence.find(
      (item) => item.id === "achievement-service-capacity-design",
    )!;
    const text = evidenceText(point);

    expect(text).toContain(point.text);
    expect(text).toContain(point.context!);
    expect(text).toContain(point.tags[0]);
    expect(text).toContain(point.supportedSkills![0]);
  });

  it("includes the metric label and value", () => {
    const evidence = buildAchievementEvidence(library);
    const point = evidence.find(
      (item) => item.id === "achievement-service-capacity-design",
    )!;
    const metric = point.metrics?.[0];

    expect(metric).toBeTruthy();
    expect(evidenceText(point)).toContain(metric!.label);
    expect(evidenceText(point)).toContain(metric!.value);
  });
});
