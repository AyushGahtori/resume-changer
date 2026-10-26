import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getApplicableDefinitions,
  METRIC_CATALOG,
  type MeasurementContext,
} from "../../../../src/lib/github/measurement-catalog";
import {
  deriveMeasurementResult,
  renderMetricClause,
  validateMeasurementAnswer,
  type MeasurementAnswerInput,
  type MeasurementObservationInput,
} from "../../../../src/lib/github/measurements";
import {
  getMeasurementRecipe,
  MEASUREMENT_RECIPES,
} from "../../../../src/lib/github/measurement-recipes";

const webContext: MeasurementContext = {
  taskType: "web-publishing",
  startEvent: "submit click",
  endEvent: "confirmation visible",
  workload: "1 MiB image upload",
  environment: "Chrome 130, office Wi-Fi",
};

const mlContext: MeasurementContext = {
  taskType: "classification",
  dataset: "support tickets",
  datasetVersion: "2026-04",
  evaluationSplit: "held-out",
};

function observation(
  overrides: Partial<MeasurementObservationInput> = {},
): MeasurementObservationInput {
  return {
    value: 400,
    unit: "ms",
    statistic: "p95",
    averagingMode: "none",
    context: { ...webContext },
    ...overrides,
  };
}

function comparisonAnswer(
  definitionId: string,
  baseline: MeasurementObservationInput,
  comparison: MeasurementObservationInput,
  status: "measured" | "user-attested" | "documented" = "measured",
): MeasurementAnswerInput {
  return {
    definitionId,
    mode: "comparison",
    status,
    baseline,
    comparison,
    evidence: { sourceDescription: "Benchmark report run 24" },
  };
}

describe("GitHub measurement catalog", () => {
  it("returns versioned definitions for the selected capability and task", () => {
    const selected = getApplicableDefinitions({
      capabilityId: "machine-learning",
      taskType: "classification",
    });

    expect(selected.catalogVersion).toBe("1.0.0");
    expect(selected.definitions.map(({ id }) => id)).toEqual([
      "ml.classification.accuracy",
      "ml.classification.macro-f1",
      "ml.classification.roc-auc.binary",
    ]);
    expect(
      selected.definitions.every(({ version }) => version === "1.0.0"),
    ).toBe(true);
    expect(selected.fallback.id).toBe("custom.v1");
  });

  it("provides a custom fallback for unsupported task types", () => {
    const selected = getApplicableDefinitions({
      capabilityId: "quantum-gardening",
      taskType: "mysterious-task",
    });

    expect(selected.definitions).toEqual([]);
    expect(selected.fallback.explanation).toContain(
      "No automatic comparison formula",
    );
  });

  it("accepts a custom absolute value for manual review without calculating or wording an achievement", () => {
    const result = deriveMeasurementResult({
      definitionId: "custom.v1",
      mode: "absolute",
      status: "user-attested",
      customMetric: {
        label: "records reviewed per shift",
        value: 125,
        unit: "records",
        contextDescription: "One 8-hour shift with the same queue policy.",
      },
      evidence: { sourceDescription: "User measured the shift log." },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("custom-review");
    expect(result.value.derived).toEqual([]);
    const rendered = renderMetricClause(result.value);
    expect(rendered.kind).toBe("review-note");
    if (rendered.kind === "review-note") {
      expect(rendered.clause).toContain("manual review");
      expect(rendered.clause).toContain(
        "No automatic conversion, comparison formula, or achievement wording",
      );
      expect("metricDraft" in rendered).toBe(false);
    }
  });

  it("keeps trusted recipes as guidance data linked to the catalog", () => {
    const referencedRecipeIds = new Set(
      METRIC_CATALOG.flatMap(({ recipeIds }) => recipeIds),
    );
    expect(
      [...referencedRecipeIds].every((id) => getMeasurementRecipe(id)),
    ).toBe(true);
    expect(MEASUREMENT_RECIPES.length).toBeGreaterThanOrEqual(4);
    expect(
      MEASUREMENT_RECIPES.flatMap(({ steps }) => steps).join(" "),
    ).not.toMatch(/run automatically|execute this script/i);
  });
});

describe("measurement validation and derivation", () => {
  it("normalizes units while retaining entered values and renders conservative API-independent wording", () => {
    const baseline = observation({ value: 0.4, unit: "s" });
    const comparison = observation({ value: 250, unit: "ms" });
    const result = deriveMeasurementResult(
      comparisonAnswer("web.publish-latency.p95", baseline, comparison),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("measurement");
    expect(
      result.value.originalObservations.map(({ value, unit }) => [value, unit]),
    ).toEqual([
      [0.4, "s"],
      [250, "ms"],
    ]);
    expect(
      result.value.normalizedObservations.map(({ value, unit }) => [
        value,
        unit,
      ]),
    ).toEqual([
      [400, "ms"],
      [250, "ms"],
    ]);
    expect(result.value.derived).toContainEqual(
      expect.objectContaining({
        formulaId: "latency-reduction-percent",
        value: 37.5,
        unit: "%",
      }),
    );
    expect(result.value.formulaVersion).toBe("1.0.0");
    expect(result.value.roundingPolicyVersion).toBe("1.0.0");
    const rendered = renderMetricClause(result.value);
    expect(rendered.kind).toBe("metric-candidate");
    if (rendered.kind !== "metric-candidate") return;
    expect(rendered.clause).toContain("decreased by 37.5%");
    expect(rendered.clause).toContain("submit click to confirmation visible");
    expect(rendered.metricDraft.evidence).toContain(
      "latency-reduction-percent@1.0.0",
    );
    expect(rendered.metricDraft.evidence).toContain("0.4 s → 250 ms");
  });

  it("keeps percentage change separate from percentage-point change", () => {
    const baseline = observation({
      value: 70,
      unit: "%",
      statistic: "single-evaluation",
      averagingMode: "macro",
      context: { ...mlContext },
    });
    const comparison = observation({
      value: 0.84,
      unit: "fraction",
      statistic: "single-evaluation",
      averagingMode: "macro",
      context: { ...mlContext },
    });
    const result = deriveMeasurementResult(
      comparisonAnswer("ml.classification.macro-f1", baseline, comparison),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.derived).toEqual([
      expect.objectContaining({
        formulaId: "percentage-point-difference",
        value: 14,
        unit: "percentage points",
      }),
    ]);
    const rendered = renderMetricClause(result.value);
    expect(rendered.kind).toBe("metric-candidate");
    if (rendered.kind !== "metric-candidate") return;
    expect(rendered.clause).toContain("increased by 14 percentage points");
    expect(rendered.clause).toContain("70% to 84%");
    expect(rendered.metricDraft.unit).toBe("percentage points");
    expect(rendered.metricDraft.unit).not.toBe("%");
    expect(rendered.metricDraft.context).toContain("macro aggregation");
  });

  it("calculates throughput gain as a percentage using the allowlisted formula", () => {
    const context: MeasurementContext = {
      taskType: "web-api",
      endpoint: "/v1/search",
      workload: "100 concurrent clients",
      environment: "staging cluster",
      observationWindow: "60 seconds",
    };
    const baseline = observation({
      value: 100,
      unit: "requests/s",
      statistic: "rate-over-window",
      averagingMode: "mean",
      context: { ...context },
    });
    const comparison = observation({
      value: 125,
      unit: "req/s",
      statistic: "rate-over-window",
      averagingMode: "mean",
      context: { ...context },
    });
    const result = deriveMeasurementResult(
      comparisonAnswer("web.api-throughput.rate", baseline, comparison),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.derived).toEqual([
      expect.objectContaining({
        formulaId: "throughput-gain-percent",
        value: 25,
        unit: "%",
      }),
    ]);
    const rendered = renderMetricClause(result.value);
    expect(rendered.kind).toBe("metric-candidate");
    if (rendered.kind === "metric-candidate") {
      expect(rendered.clause).toContain("increased by 25%");
      expect(rendered.metricDraft.unit).toBe("%");
    }
  });

  it("measures a repeatable automation runtime case with explicit sample context", () => {
    const context: MeasurementContext = {
      taskType: "automation",
      taskDescription: "convert and validate a CSV batch",
      workload: "10,000 records",
      environment: "4-core Linux runner",
      observationPeriod: "2026-09 weekly run",
      sampleCount: 20,
    };
    const baseline = observation({
      value: 120,
      unit: "s",
      statistic: "mean",
      averagingMode: "mean",
      context: { ...context },
    });
    const comparison = observation({
      value: 90,
      unit: "s",
      statistic: "mean",
      averagingMode: "mean",
      context: { ...context },
    });
    const result = deriveMeasurementResult(
      comparisonAnswer("automation.task-runtime", baseline, comparison),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.derived).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          formulaId: "runtime-reduction-percent",
          value: 25,
          unit: "%",
        }),
        expect.objectContaining({
          formulaId: "speedup-factor",
          value: 1.33333333,
          unit: "×",
        }),
      ]),
    );
    const rendered = renderMetricClause(result.value);
    expect(rendered.kind).toBe("metric-candidate");
    if (rendered.kind === "metric-candidate") {
      expect(rendered.clause).toContain("decreased by 25%");
      expect(rendered.clause).toContain("20 samples");
      expect(rendered.clause).toContain("10,000 records");
    }
  });

  it("rejects zero denominators for percentage and speedup formulas", () => {
    const result = validateMeasurementAnswer(
      comparisonAnswer(
        "web.api-throughput.rate",
        observation({
          value: 0,
          unit: "requests/s",
          statistic: "rate-over-window",
          averagingMode: "mean",
          context: {
            taskType: "web-api",
            endpoint: "/v1/search",
            workload: "100 concurrent clients",
            environment: "staging cluster",
            observationWindow: "60 seconds",
          },
        }),
        observation({
          value: 10,
          unit: "requests/s",
          statistic: "rate-over-window",
          averagingMode: "mean",
          context: {
            taskType: "web-api",
            endpoint: "/v1/search",
            workload: "100 concurrent clients",
            environment: "staging cluster",
            observationWindow: "60 seconds",
          },
        }),
      ),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "zero-baseline",
        field: "baseline.value",
      }),
    );
  });

  it("rejects incompatible units and p50 versus p95 comparisons", () => {
    const incompatibleUnit = validateMeasurementAnswer(
      comparisonAnswer(
        "web.publish-latency.p95",
        observation(),
        observation({ value: 2, unit: "kg" }),
      ),
    );
    const incompatibleStatistic = validateMeasurementAnswer(
      comparisonAnswer(
        "web.publish-latency.p95",
        observation(),
        observation({ statistic: "p50" }),
      ),
    );

    expect(incompatibleUnit.ok).toBe(false);
    if (!incompatibleUnit.ok) {
      expect(
        incompatibleUnit.errors.some(
          ({ code }) =>
            code === "invalid-unit" || code === "incompatible-units",
        ),
      ).toBe(true);
    }
    expect(incompatibleStatistic.ok).toBe(false);
    if (!incompatibleStatistic.ok) {
      expect(
        incompatibleStatistic.errors.some(
          ({ code }) =>
            code === "invalid-statistic" || code === "incompatible-context",
        ),
      ).toBe(true);
    }
  });

  it("normalizes regression errors only across units of the target dimension", () => {
    const context: MeasurementContext = {
      taskType: "regression",
      dataset: "house prices",
      datasetVersion: "v3",
      evaluationSplit: "test",
      targetUnit: "m",
    };
    const baseline = observation({
      value: 100,
      unit: "cm",
      statistic: "mean",
      averagingMode: "mean",
      context: { ...context },
    });
    const comparison = observation({
      value: 0.5,
      unit: "m",
      statistic: "mean",
      averagingMode: "mean",
      context: { ...context },
    });
    const valid = deriveMeasurementResult(
      comparisonAnswer("ml.regression.mae", baseline, comparison),
    );
    const invalid = validateMeasurementAnswer({
      definitionId: "ml.regression.mae",
      mode: "absolute",
      status: "user-attested",
      observation: { ...baseline, value: 4, unit: "seconds" },
      evidence: { sourceDescription: "Measured against the labeled data set." },
    });

    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(
        valid.value.normalizedObservations.map(({ value, unit }) => [
          value,
          unit,
        ]),
      ).toEqual([
        [1, "m"],
        [0.5, "m"],
      ]);
      expect(valid.value.derived[0]).toMatchObject({
        formulaId: "error-reduction-percent",
        value: 50,
      });
    }
    expect(invalid.ok).toBe(false);
    if (!invalid.ok)
      expect(invalid.errors.some(({ code }) => code === "invalid-unit")).toBe(
        true,
      );
  });

  it("requires a named score definition and states the evaluation split", () => {
    const ambiguous = validateMeasurementAnswer({
      mode: "absolute",
      status: "measured",
      observation: {
        value: 0.92,
        unit: "fraction",
        statistic: "single-evaluation",
        averagingMode: "sample-weighted",
        context: { ...mlContext },
      },
      evidence: { sourceDescription: "Evaluation report" },
    });
    const accuracy = deriveMeasurementResult({
      definitionId: "ml.classification.accuracy",
      mode: "absolute",
      status: "measured",
      observation: {
        value: 0.92,
        unit: "fraction",
        statistic: "single-evaluation",
        averagingMode: "sample-weighted",
        context: { ...mlContext, evaluationSplit: "training" },
      },
      evidence: { sourceDescription: "Evaluation report at revision abc123" },
    });

    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok)
      expect(ambiguous.errors[0].code).toBe("unsupported-definition");
    expect(accuracy.ok).toBe(true);
    if (!accuracy.ok) return;
    expect(accuracy.value.limitations).toContain(
      "Training evaluation does not establish held-out performance.",
    );
    const rendered = renderMetricClause(accuracy.value);
    expect(rendered.kind).toBe("metric-candidate");
    if (rendered.kind === "metric-candidate") {
      expect(rendered.clause).toContain("92%");
      expect(rendered.clause).toContain("training split");
      expect(rendered.clause).not.toContain("held-out performance");
      expect(rendered.metricDraft.unit).toBe("%");
    }

    const auc = deriveMeasurementResult({
      definitionId: "ml.classification.roc-auc.binary",
      mode: "absolute",
      status: "measured",
      observation: {
        value: 0.92,
        unit: "fraction",
        statistic: "single-evaluation",
        averagingMode: "binary-positive-class",
        context: { ...mlContext, positiveClass: "urgent" },
      },
      evidence: { sourceDescription: "Held-out binary evaluation report." },
    });
    expect(auc.ok).toBe(true);
    if (auc.ok) {
      const aucClause = renderMetricClause(auc.value);
      expect(aucClause.kind).toBe("metric-candidate");
      if (aucClause.kind === "metric-candidate") {
        expect(aucClause.clause).toContain("positive class urgent");
      }
    }
  });

  it("rejects task mismatches, out-of-range values, and missing context", () => {
    const taskMismatch = validateMeasurementAnswer({
      definitionId: "ml.classification.accuracy",
      mode: "absolute",
      status: "measured",
      observation: {
        value: 0.8,
        unit: "fraction",
        statistic: "single-evaluation",
        averagingMode: "sample-weighted",
        context: { ...mlContext, taskType: "regression" },
      },
      evidence: { sourceDescription: "Report" },
    });
    const outOfRange = validateMeasurementAnswer({
      definitionId: "ml.classification.accuracy",
      mode: "absolute",
      status: "measured",
      observation: {
        value: 101,
        unit: "%",
        statistic: "single-evaluation",
        averagingMode: "sample-weighted",
        context: { ...mlContext },
      },
      evidence: { sourceDescription: "Report" },
    });
    const missingContext = validateMeasurementAnswer({
      definitionId: "ml.classification.macro-f1",
      mode: "absolute",
      status: "user-attested",
      observation: {
        value: 0.8,
        unit: "fraction",
        statistic: "single-evaluation",
        averagingMode: "macro",
        context: { taskType: "classification", dataset: "support tickets" },
      },
      evidence: { sourceDescription: "Measured locally." },
    });

    expect(taskMismatch.ok).toBe(false);
    if (!taskMismatch.ok)
      expect(
        taskMismatch.errors.some(({ code }) => code === "task-mismatch"),
      ).toBe(true);
    expect(outOfRange.ok).toBe(false);
    if (!outOfRange.ok)
      expect(
        outOfRange.errors.some(({ code }) => code === "invalid-range"),
      ).toBe(true);
    expect(missingContext.ok).toBe(false);
    if (!missingContext.ok)
      expect(
        missingContext.errors.some(({ code }) => code === "missing-context"),
      ).toBe(true);
  });

  it("rejects comparisons across different datasets and environments", () => {
    const baseline = observation({
      value: 70,
      unit: "%",
      statistic: "single-evaluation",
      averagingMode: "macro",
      context: { ...mlContext },
    });
    const comparison = observation({
      value: 84,
      unit: "%",
      statistic: "single-evaluation",
      averagingMode: "macro",
      context: {
        ...mlContext,
        dataset: "new support tickets",
        environment: "different GPU",
      },
    });
    const result = validateMeasurementAnswer(
      comparisonAnswer("ml.classification.macro-f1", baseline, comparison),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const incompatibleFields = result.errors
        .filter(({ code }) => code === "incompatible-context")
        .map(({ field }) => field);
      expect(incompatibleFields).toContain("comparison.context.dataset");
    }

    const apiContext: MeasurementContext = {
      taskType: "web-api",
      endpoint: "/v1/search",
      workload: "100 concurrent clients",
      environment: "staging cluster A",
    };
    const environmentMismatch = validateMeasurementAnswer(
      comparisonAnswer(
        "web.api-latency.p95",
        observation({ value: 400, context: { ...apiContext } }),
        observation({
          value: 250,
          context: { ...apiContext, environment: "staging cluster B" },
        }),
      ),
    );
    expect(environmentMismatch.ok).toBe(false);
    if (!environmentMismatch.ok) {
      expect(environmentMismatch.errors.map(({ field }) => field)).toContain(
        "comparison.context.environment",
      );
    }
  });

  it("rounds rendered changes explicitly and describes worsening results honestly", () => {
    const result = deriveMeasurementResult(
      comparisonAnswer(
        "web.publish-latency.p95",
        observation({ value: 400 }),
        observation({ value: 501 }),
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.derived[0]).toMatchObject({ value: -25.25, unit: "%" });
    const rendered = renderMetricClause(result.value);
    expect(rendered.kind).toBe("metric-candidate");
    if (rendered.kind === "metric-candidate") {
      expect(rendered.clause).toContain("increased by 25.3%");
      expect(rendered.metricDraft.value).toBe("-25.3");
    }
  });

  it.each([
    { mode: "target", status: "target", label: "Future target" },
    { mode: "estimate", status: "estimate", label: "Estimate only" },
  ] as const)(
    "keeps $status values out of achievement metrics",
    ({ mode, status, label }) => {
      const result = deriveMeasurementResult({
        definitionId: "web.publish-latency.p95",
        mode,
        status,
        observation: observation({ value: 250 }),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.kind).toBe(status);
      expect(result.value.derived).toEqual([]);
      const rendered = renderMetricClause(result.value);
      expect(rendered.kind).toBe("review-note");
      if (rendered.kind === "review-note") {
        expect(rendered.clause).toContain(label);
        expect(rendered.clause).toContain("not a measured result");
        expect("metricDraft" in rendered).toBe(false);
      }
    },
  );

  it("treats a qualitative skip as a successful completion with no numeric clause", () => {
    const result = deriveMeasurementResult({
      mode: "skip",
      status: "no-result",
    });

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        kind: "qualitative",
        evidenceStatus: "no-result",
        derived: [],
      }),
    });
    if (result.ok) {
      expect(renderMetricClause(result.value)).toEqual({
        kind: "qualitative",
        clause: null,
        evidenceStatus: "no-result",
      });
    }
  });

  it("keeps documented claims as unverified review notes", () => {
    const result = deriveMeasurementResult({
      definitionId: "web.api-latency.p95",
      mode: "absolute",
      status: "documented",
      observation: observation({
        value: 250,
        context: {
          taskType: "web-api",
          endpoint: "/v1/search",
          workload: "1 KiB response",
          environment: "staging service",
        },
      }),
      evidence: { sourceDescription: "README performance statement" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rendered = renderMetricClause(result.value);
    expect(rendered.kind).toBe("review-note");
    if (rendered.kind === "review-note") {
      expect(rendered.clause).toContain("unverified");
      expect(rendered.clause).toContain("not an independently measured result");
      expect("metricDraft" in rendered).toBe(false);
    }
  });

  it("does not import or call provider, network, or store modules", () => {
    const sourceFiles = [
      new URL(
        "../../../../src/lib/github/measurement-catalog.ts",
        import.meta.url,
      ),
      new URL(
        "../../../../src/lib/github/measurement-recipes.ts",
        import.meta.url,
      ),
      new URL("../../../../src/lib/github/measurements.ts", import.meta.url),
    ];

    for (const file of sourceFiles) {
      const source = readFileSync(file, "utf8");
      const imports = [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map(
        (match) => match[1],
      );
      const allowedImports = file.pathname.endsWith("/measurements.ts")
        ? ["./measurement-catalog"]
        : [];
      expect(imports).toEqual(allowedImports);
      expect(source).not.toMatch(/\bfetch\s*\(|\bimport\s*\(/);
    }
  });
});
