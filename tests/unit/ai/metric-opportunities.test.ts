import { describe, expect, it } from "vitest";
import { metricOpportunities } from "../../../src/lib/ai/metric-opportunities";

describe("metric opportunities", () => {
  it("asks for verifiable model and scale measurements without making up values", () => {
    const prompts = metricOpportunities({
      text: "Trained a CNN classifier for a large image dataset.",
      metrics: [],
    });
    expect(prompts.map((item) => item.label)).toContain("Model quality");
    expect(prompts.map((item) => item.label)).toContain("Scale or reach");
    expect(JSON.stringify(prompts)).not.toMatch(/\b\d+%/);
    expect(prompts[0].evidenceHint).toContain("baseline");
  });

  it("does not repeat an already recorded kind of metric", () => {
    const prompts = metricOpportunities({
      text: "Trained a model on a dataset.",
      metrics: [
        {
          id: "metric-quality",
          label: "Model quality",
          value: "0.86",
          evidence: "Fictional evaluation report.",
        },
      ],
    });
    expect(prompts.map((item) => item.label)).not.toContain("Model quality");
  });
});
