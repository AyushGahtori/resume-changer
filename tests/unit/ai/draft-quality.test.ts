import { describe, expect, it } from "vitest";
import {
  buildEvidenceSummary,
  canSynthesize,
  formatMetric,
  misattributedMetrics,
  preserveMetrics,
} from "../../../src/lib/ai/draft-quality";
import type {
  AchievementEvidence,
  JobAnalysisResult,
} from "../../../src/lib/ai/contracts";

const analysis: JobAnalysisResult = {
  targetTitle: "ML Engineer",
  seniority: "Early career",
  requiredQualifications: ["Python"],
  preferredQualifications: [],
  responsibilities: [],
  toolsAndPlatforms: ["Python", "Docker"],
  domainConcepts: [],
  atsTerms: [],
  inferredContext: [],
  terminology: [],
};

function evidence(
  overrides: Partial<AchievementEvidence> = {},
): AchievementEvidence {
  return {
    id: "achievement-api",
    text: "Engineered Python REST APIs for the billing platform.",
    tags: ["api"],
    skillIds: ["skill-python"],
    section: "experience",
    groupId: "job-platform",
    groupTitle: "Platform Engineer",
    ...overrides,
  };
}

const latencyMetric = {
  id: "metric-latency",
  label: "API latency reduction",
  value: "42",
  unit: "%",
  context: "p99 latency",
  evidence: "Fictional load test shows p99 latency fell by 42%.",
};

describe("formatMetric", () => {
  it("describes a reduction with the correct direction", () => {
    expect(formatMetric(latencyMetric)).toBe("42% lower api latency");
  });

  it("describes an improvement with the correct direction", () => {
    expect(
      formatMetric({
        id: "metric-resource",
        label: "Resource utilization improvement",
        value: "19",
        unit: "%",
        evidence: "Fictional benchmark.",
      }),
    ).toBe("19% better resource utilization");
  });

  it("describes an increase with the correct direction", () => {
    expect(
      formatMetric({
        id: "metric-throughput",
        label: "Throughput increase",
        value: "28",
        unit: "%",
        evidence: "Fictional benchmark.",
      }),
    ).toBe("28% higher throughput");
  });

  it("keeps a percentage sign for a share metric", () => {
    expect(
      formatMetric({
        id: "metric-share",
        label: "Share of traffic",
        value: "35",
        unit: "%",
        evidence: "Fictional measurement.",
      }),
    ).toBe("35% of traffic");
  });

  it("falls back to a labelled value for an unrecognised metric", () => {
    expect(
      formatMetric({
        id: "metric-custom",
        label: "Deployments per week",
        value: "12",
        evidence: "Fictional measurement.",
      }),
    ).toBe("deployments per week of 12");
  });
});

describe("misattributedMetrics", () => {
  it("reports a metric whose value appears without its supporting context", () => {
    const source = evidence({ metrics: [latencyMetric] });

    // The number 42% is present, but nothing in the wording refers to latency.
    const found = misattributedMetrics("Cut infrastructure costs by 42%.", [
      source,
    ]);

    expect(found.map((metric) => metric.id)).toEqual(["metric-latency"]);
  });

  it("reports nothing when the metric is stated with its context and unit", () => {
    const source = evidence({ metrics: [latencyMetric] });

    const found = misattributedMetrics(
      "Cut API latency reduction by 42% for billing.",
      [source],
    );

    expect(found).toEqual([]);
  });

  it("ignores metrics from sources that were not supplied", () => {
    const found = misattributedMetrics("Cut API latency by 42%.", []);

    expect(found).toEqual([]);
  });
});

describe("preserveMetrics", () => {
  it("restores a metric that the drafted wording dropped", () => {
    const source = evidence({ metrics: [latencyMetric] });

    const result = preserveMetrics("Engineered Python REST APIs.", [source]);

    expect(result.text).toContain("42% lower api latency");
    expect(result.restoredMetricIds).toEqual(["metric-latency"]);
  });

  it("leaves wording that already carries the metric unchanged", () => {
    const source = evidence({ metrics: [latencyMetric] });
    const text = "Cut API latency by 42% for the billing platform.";

    const result = preserveMetrics(text, [source]);

    expect(result.text).toBe(text);
    expect(result.restoredMetricIds).toEqual([]);
  });

  it("reports every restored metric identifier", () => {
    const source = evidence({
      metrics: [
        latencyMetric,
        {
          id: "metric-uptime",
          label: "Service uptime",
          value: "99.9",
          unit: "%",
          evidence: "Fictional measurement.",
        },
      ],
    });

    const result = preserveMetrics("Engineered Python REST APIs.", [source]);

    expect(result.restoredMetricIds).toEqual([
      "metric-latency",
      "metric-uptime",
    ]);
  });
});

describe("canSynthesize", () => {
  it("allows a single source to be rewritten on its own", () => {
    expect(canSynthesize([evidence()])).toBe(true);
  });

  it("allows two points from the same group to be merged", () => {
    expect(
      canSynthesize([
        evidence({ id: "achievement-one" }),
        evidence({ id: "achievement-two" }),
      ]),
    ).toBe(true);
  });

  it("refuses to merge points from different groups", () => {
    expect(
      canSynthesize([
        evidence({ id: "achievement-one", groupId: "job-platform" }),
        evidence({ id: "achievement-two", groupId: "job-other" }),
      ]),
    ).toBe(false);
  });

  it("refuses to merge points from different sections", () => {
    expect(
      canSynthesize([
        evidence({ id: "achievement-one", section: "experience" }),
        evidence({ id: "achievement-two", section: "projects" }),
      ]),
    ).toBe(false);
  });

  it("allows points that share an initiative identifier", () => {
    expect(
      canSynthesize([
        evidence({ id: "achievement-one", initiativeId: "initiative-billing" }),
        evidence({ id: "achievement-two", initiativeId: "initiative-billing" }),
      ]),
    ).toBe(true);
  });

  it("refuses to merge points that name different initiatives", () => {
    expect(
      canSynthesize([
        evidence({ id: "achievement-one", initiativeId: "initiative-billing" }),
        evidence({ id: "achievement-two", initiativeId: "initiative-search" }),
      ]),
    ).toBe(false);
  });

  it("refuses to merge when only one point names an initiative", () => {
    expect(
      canSynthesize([
        evidence({ id: "achievement-one", initiativeId: "initiative-billing" }),
        evidence({ id: "achievement-two" }),
      ]),
    ).toBe(false);
  });

  it("allows points that share enough distinctive wording", () => {
    expect(
      canSynthesize([
        evidence({
          id: "achievement-one",
          text: "Migrated the billing pipeline to the orchestrated cluster runtime.",
        }),
        evidence({
          id: "achievement-two",
          text: "Instrumented the billing pipeline across the orchestrated cluster runtime.",
        }),
      ]),
    ).toBe(true);
  });

  it("refuses to merge points that share only generic wording", () => {
    expect(
      canSynthesize([
        evidence({
          id: "achievement-one",
          text: "Built the billing platform for retail subscribers.",
        }),
        evidence({
          id: "achievement-two",
          text: "Designed the search experience for internal analysts.",
        }),
      ]),
    ).toBe(false);
  });
});

describe("buildEvidenceSummary", () => {
  it("leads with the role and the matching skills", () => {
    const summary = buildEvidenceSummary({
      analysis,
      achievements: [evidence()],
      skills: [
        {
          id: "skill-python",
          name: "Python",
          aliases: [],
          isListedOnCurrentResume: true,
          evidenceAchievementIds: ["achievement-api"],
        },
      ],
      profile: {
        headline: "Platform Engineer",
        education: [],
        credentials: [],
      },
    });

    expect(summary).toContain("Platform Engineer");
    expect(summary).toContain("Python");
  });

  it("reports a supported metric with its source group", () => {
    const summary = buildEvidenceSummary({
      analysis,
      achievements: [evidence({ metrics: [latencyMetric] })],
      skills: [],
      profile: {
        headline: "Platform Engineer",
        education: [],
        credentials: [],
      },
    });

    expect(summary).toContain("42% lower api latency");
  });

  it("omits a skill that is not listed on the current resume", () => {
    const summary = buildEvidenceSummary({
      analysis,
      achievements: [evidence()],
      skills: [
        {
          id: "skill-python",
          name: "Python",
          aliases: [],
          isListedOnCurrentResume: false,
          evidenceAchievementIds: ["achievement-api"],
        },
      ],
      profile: {
        headline: "Platform Engineer",
        education: [],
        credentials: [],
      },
    });

    expect(summary).not.toContain("skills in Python");
  });

  it("falls back to the longest achievement when no metric is available", () => {
    const summary = buildEvidenceSummary({
      analysis,
      achievements: [
        evidence({ id: "achievement-short", text: "Short." }),
        evidence({
          id: "achievement-long",
          text: "Engineered Python REST APIs and billing webhooks for the platform.",
        }),
      ],
      skills: [],
      profile: {
        headline: "Platform Engineer",
        education: [],
        credentials: [],
      },
    });

    expect(summary).toContain(
      "Engineered Python REST APIs and billing webhooks for the platform.",
    );
  });

  it("falls back to the experience group title when there is no headline", () => {
    const summary = buildEvidenceSummary({
      analysis,
      achievements: [
        evidence({ groupTitle: "Billing Platform", groupSubtitle: undefined }),
      ],
      skills: [
        {
          id: "skill-python",
          name: "Python",
          aliases: [],
          isListedOnCurrentResume: true,
          evidenceAchievementIds: ["achievement-api"],
        },
      ],
    });

    expect(summary).toContain("Billing Platform with skills in Python");
  });

  it("describes a contributor with neither headline nor experience evidence", () => {
    const summary = buildEvidenceSummary({
      analysis,
      achievements: [
        evidence({ section: "projects", groupTitle: "Billing Platform" }),
      ],
      skills: [
        {
          id: "skill-python",
          name: "Python",
          aliases: [],
          isListedOnCurrentResume: true,
          evidenceAchievementIds: ["achievement-api"],
        },
      ],
    });

    expect(summary).toContain("Project contributor with skills in Python");
  });
});
