import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type {
  ExecutionContext,
  MeasurementDefinition,
} from "../../../../src/lib/github/contracts";
import { createReportParser } from "../../../../src/lib/github/server/reports";

const revision = "a".repeat(40);

const latencyDefinition: MeasurementDefinition = {
  id: "web-api-p95",
  version: 1,
  capability: "web-api",
  task: "request latency",
  quantity: "p95 API latency",
  unit: "ms",
  statistic: "p95",
  direction: "lower-is-better",
  allowedRange: { min: 0.001, max: 86_400_000 },
  requiredContext: ["workload", "environment"],
  calculatorId: null,
  rendererId: "duration-absolute-v1",
  recipeId: null,
};

const evaluationDefinition: MeasurementDefinition = {
  ...latencyDefinition,
  id: "ml-accuracy",
  capability: "machine-learning",
  task: "classification",
  quantity: "classification accuracy",
  unit: "fraction",
  statistic: "single-evaluation",
  direction: "higher-is-better",
  allowedRange: { min: 0, max: 1 },
  requiredContext: ["dataset", "datasetVersion", "evaluationSplit"],
  rendererId: "score-absolute-v1",
};

const budget = {
  checkSelection: vi.fn((_input: { files: number; lines: number }) => ({
    ok: true as const,
    value: { allowed: true as boolean, reason: null as string | null },
  })),
  reserve: vi.fn(),
  commitUsage: vi.fn(),
  remaining: vi.fn(),
  snapshot: vi.fn(),
};

function makeContext(text: string, overrides: Record<string, unknown> = {}) {
  const blobBytes = Buffer.from(text, "utf8");
  const blobSha = createHash("sha1")
    .update(Buffer.from(`blob ${blobBytes.byteLength}\0`))
    .update(blobBytes)
    .digest("hex");
  const { reportSource: sourceOverrides, ...contextOverrides } = overrides;
  const context = {
    personalRoot: "/tmp/test-root",
    access: {
      sessionId: "session-1",
      authorizationNamespace: "user-1",
      accountId: "account-1",
      grantedRepositoryIds: ["123"],
    },
    signal: new AbortController().signal,
    now: () => new Date("2026-10-26T10:00:00.000Z"),
    runId: "import-run-1",
    deadline: "2026-10-26T10:02:00.000Z",
    budget,
    reportSource: {
      fileId: "selected-report",
      snapshotId: "snapshot-1",
      commitSha: revision,
      path: "reports/metrics.json",
      blobSha,
      expectedProtocol: "load-profile-v1",
      ...(sourceOverrides as Record<string, unknown> | undefined),
    },
    ...contextOverrides,
  } as unknown as ExecutionContext;
  return context;
}

function jsonReport(rows: unknown[], overrides: Record<string, unknown> = {}) {
  const text = JSON.stringify({ schemaVersion: 1, results: rows });
  return {
    text,
    context: makeContext(text, overrides),
  };
}

function latencyRow(overrides: Record<string, unknown> = {}) {
  return {
    metricId: latencyDefinition.id,
    value: 250,
    unit: "ms",
    statistic: "p95",
    revision,
    reportKind: "benchmark",
    protocol: "load-profile-v1",
    workload: "checkout API, 50 concurrent users",
    environment: "staging, 2 vCPU",
    runId: "benchmark-2026-10-26-01",
    ...overrides,
  };
}

function createParser(...definitions: MeasurementDefinition[]) {
  return createReportParser({ definitions });
}

describe("GitHub measurement report parser", () => {
  it("parses a bounded benchmark JSON row with the pinned run and exact field pointers", () => {
    const parser = createParser(latencyDefinition);
    const report = jsonReport([latencyRow()]);

    const result = parser.parseMeasurementReport({
      definitionId: latencyDefinition.id,
      source: report.text,
      context: report.context,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates).toHaveLength(1);
    expect(result.value.candidates[0]).toMatchObject({
      mode: "report",
      originalValues: [250],
      originalUnits: ["ms"],
      definitionId: latencyDefinition.id,
      statistic: "p95",
      context: {
        workload: "checkout API, 50 concurrent users",
        environment: "staging, 2 vCPU",
        revision,
        runId: "benchmark-2026-10-26-01",
      },
    });
    expect(result.value.sourcePointers[0]).toMatchObject({
      snapshotId: "snapshot-1",
      commitSha: revision,
      path: "reports/metrics.json",
      pointer: {
        kind: "report-fields",
        fields: expect.arrayContaining([
          "/results/0/value",
          "/results/0/metricId",
          "/results/0/revision",
        ]),
      },
      excerpt: JSON.stringify(latencyRow()),
    });
    expect(result.value.sourcePointers[0].excerptSha256).toHaveLength(64);
    expect(result.value.unsupported).toEqual([]);
  });

  it("parses the documented CSV subset and retains row and column pointers", () => {
    const parser = createParser(latencyDefinition);
    const text = [
      "schemaVersion,metricId,value,unit,statistic,revision,reportKind,protocol,workload,environment,runId",
      `1,${latencyDefinition.id},250,ms,p95,${revision},benchmark,load-profile-v1,\"checkout API, 50 users\",staging,ci-9`,
    ].join("\n");
    const context = makeContext(text, {
      reportSource: { path: "reports/metrics.csv" },
    });

    const result = parser.parseMeasurementReport({
      definitionId: latencyDefinition.id,
      source: text,
      context,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates[0]?.context.workload).toBe(
      "checkout API, 50 users",
    );
    expect(result.value.sourcePointers[0]?.pointer).toEqual({
      kind: "report-fields",
      fields: expect.arrayContaining([
        "csv:row/2/column/value",
        "csv:row/2/column/revision",
      ]),
    });
    expect(result.value.sourcePointers[0]?.excerpt).toContain(
      '"checkout API, 50 users"',
    );
  });

  it("keeps training evaluation labeled as training and does not claim held-out results", () => {
    const parser = createParser(evaluationDefinition);
    const report = jsonReport(
      [
        {
          metricId: evaluationDefinition.id,
          value: 0.92,
          unit: "fraction",
          statistic: "single-evaluation",
          revision,
          reportKind: "evaluation",
          dataset: "support tickets",
          datasetVersion: "2026-04",
          split: "training",
          protocol: "stratified-v2",
        },
      ],
      {
        reportSource: {
          path: "reports/evaluation.json",
          expectedProtocol: undefined,
        },
      },
    );

    const result = parser.parseMeasurementReport({
      definitionId: evaluationDefinition.id,
      source: report.text,
      context: report.context,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates).toHaveLength(1);
    expect(result.value.candidates[0]?.context.evaluationSplit).toBe(
      "training",
    );
    expect(result.value.candidates[0]?.context).not.toHaveProperty(
      "heldOutPerformance",
    );

    const heldOut = jsonReport(
      [
        {
          metricId: evaluationDefinition.id,
          value: 0.88,
          unit: "fraction",
          statistic: "single-evaluation",
          revision,
          reportKind: "evaluation",
          dataset: "support tickets",
          datasetVersion: "2026-04",
          split: "held-out",
          protocol: "stratified-v2",
        },
      ],
      {
        reportSource: {
          path: "reports/evaluation.json",
          expectedProtocol: undefined,
        },
      },
    );
    const heldOutResult = parser.parseMeasurementReport({
      definitionId: evaluationDefinition.id,
      source: heldOut.text,
      context: heldOut.context,
    });
    expect(heldOutResult.ok).toBe(true);
    if (heldOutResult.ok) {
      expect(heldOutResult.value.candidates[0]?.context.evaluationSplit).toBe(
        "held-out",
      );
    }
  });

  it("returns needs-context for an accuracy row without an evaluation split", () => {
    const parser = createParser(evaluationDefinition);
    const report = jsonReport(
      [
        {
          metricId: evaluationDefinition.id,
          value: 0.92,
          unit: "fraction",
          statistic: "single-evaluation",
          revision,
          reportKind: "evaluation",
          dataset: "support tickets",
          datasetVersion: "2026-04",
        },
      ],
      {
        reportSource: {
          path: "reports/evaluation.json",
          expectedProtocol: undefined,
        },
      },
    );
    const result = parser.parseMeasurementReport({
      definitionId: evaluationDefinition.id,
      source: report.text,
      context: report.context,
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "needs-context",
        message: expect.stringContaining("evaluationSplit"),
      },
    });
  });

  it("does not infer a metric from a generic score field or an unknown metric name", () => {
    const parser = createParser(latencyDefinition);
    const report = jsonReport([latencyRow({ metricId: "score" })]);
    const result = parser.parseMeasurementReport({
      definitionId: latencyDefinition.id,
      source: report.text,
      context: report.context,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates).toEqual([]);
    expect(result.value.unsupported[0]).toContain("metricId does not match");
    expect(result.value.sourcePointers[0]?.pointer).toMatchObject({
      kind: "report-fields",
    });
  });

  it("returns an absolute report candidate without inventing a missing baseline", () => {
    const parser = createParser(latencyDefinition);
    const report = jsonReport([latencyRow()]);
    const result = parser.parseMeasurementReport({
      definitionId: latencyDefinition.id,
      source: report.text,
      context: report.context,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates[0]?.originalValues).toEqual([250]);
    expect(result.value.candidates[0]?.context).not.toHaveProperty("baseline");
    expect(result.value.candidates[0]?.context).not.toHaveProperty(
      "improvement",
    );
  });

  it("keeps unsupported extensions inspectable and requires coverage scope, tool, and denominator", () => {
    const coverageDefinition: MeasurementDefinition = {
      ...latencyDefinition,
      id: "coverage-percent",
      quantity: "line coverage",
      unit: "%",
      statistic: "reported",
      requiredContext: [],
      allowedRange: { min: 0, max: 100 },
    };
    const coverageParser = createParser(coverageDefinition);
    const row = {
      metricId: coverageDefinition.id,
      value: 84,
      unit: "%",
      statistic: "reported",
      revision,
      reportKind: "coverage",
      protocol: "load-profile-v1",
      toolName: "coverage-tool 2.1",
      scope: "src/ over 800 statements",
      denominator: "800",
    };
    const supported = jsonReport([row]);
    const parsed = coverageParser.parseMeasurementReport({
      definitionId: coverageDefinition.id,
      source: supported.text,
      context: supported.context,
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.candidates[0]?.context).toMatchObject({
        denominator: "800",
        toolName: "coverage-tool 2.1",
        scope: "src/ over 800 statements",
      });
    }

    const missingDenominator = jsonReport([{ ...row, denominator: undefined }]);
    const needsContext = coverageParser.parseMeasurementReport({
      definitionId: coverageDefinition.id,
      source: missingDenominator.text,
      context: missingDenominator.context,
    });
    expect(needsContext).toMatchObject({
      ok: false,
      error: {
        code: "needs-context",
        message: expect.stringContaining("denominator"),
      },
    });

    const unsupportedExtension = jsonReport([latencyRow()], {
      reportSource: { path: "README.md" },
    });
    const unsupported = createParser(latencyDefinition).parseMeasurementReport({
      definitionId: latencyDefinition.id,
      source: unsupportedExtension.text,
      context: unsupportedExtension.context,
    });
    expect(unsupported).toMatchObject({
      ok: true,
      value: {
        candidates: [],
        unsupported: [expect.stringContaining(".json and .csv")],
      },
    });
  });

  it("rejects a mismatched pinned revision without returning a candidate", () => {
    const parser = createParser(latencyDefinition);
    const report = jsonReport([latencyRow({ revision: "b".repeat(40) })]);
    const result = parser.parseMeasurementReport({
      definitionId: latencyDefinition.id,
      source: report.text,
      context: report.context,
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "needs-context",
        message: expect.stringContaining("pinned repository snapshot"),
      },
    });

    const protocolMismatch = jsonReport([latencyRow()], {
      reportSource: { expectedProtocol: "different-protocol-v1" },
    });
    const protocolResult = parser.parseMeasurementReport({
      definitionId: latencyDefinition.id,
      source: protocolMismatch.text,
      context: protocolMismatch.context,
    });
    expect(protocolResult).toMatchObject({
      ok: false,
      error: {
        code: "needs-context",
        message: expect.stringContaining("protocol does not match"),
      },
    });
  });

  it("keeps an incompatible unit inspectable but unsupported", () => {
    const parser = createParser(latencyDefinition);
    const report = jsonReport([latencyRow({ unit: "seconds" })]);
    const result = parser.parseMeasurementReport({
      definitionId: latencyDefinition.id,
      source: report.text,
      context: report.context,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates).toEqual([]);
    expect(result.value.unsupported[0]).toContain("unit does not match");
    expect(result.value.sourcePointers).toHaveLength(1);

    const wrongStatistic = jsonReport([latencyRow({ statistic: "mean" })]);
    const statisticResult = parser.parseMeasurementReport({
      definitionId: latencyDefinition.id,
      source: wrongStatistic.text,
      context: wrongStatistic.context,
    });
    expect(statisticResult).toMatchObject({
      ok: true,
      value: {
        candidates: [],
        unsupported: [expect.stringContaining("statistic does not match")],
      },
    });
  });

  it("rejects malformed JSON, duplicate keys, unknown columns, and malformed CSV", () => {
    const parser = createParser(latencyDefinition);
    const cases = [
      '{"schemaVersion":1,"results":[}',
      `{"schemaVersion":1,"results":[{"metricId":"${latencyDefinition.id}","metricId":"${latencyDefinition.id}"}]}`,
      "schemaVersion,metricId,value,unit,statistic,revision,reportKind,score\n1,web-api-p95,1,ms,p95," +
        revision +
        ",benchmark,0.9",
      'schemaVersion,metricId,value,unit,statistic,revision,reportKind\n1,web-api-p95,"250,ms,p95,' +
        revision +
        ",benchmark",
    ];
    for (const text of cases) {
      const result = parser.parseMeasurementReport({
        definitionId: latencyDefinition.id,
        source: text,
        context: makeContext(text),
      });
      expect(result).toMatchObject({
        ok: false,
        error: { code: "invalid-evidence" },
      });
    }
  });

  it("rejects formula-like values and non-finite numbers", () => {
    const parser = createParser(latencyDefinition);
    for (const value of ["=1+1", "Infinity", "NaN", "1e999"]) {
      const report = jsonReport([latencyRow({ value })]);
      const result = parser.parseMeasurementReport({
        definitionId: latencyDefinition.id,
        source: report.text,
        context: report.context,
      });
      expect(result).toMatchObject({
        ok: false,
        error: { code: "invalid-evidence" },
      });
    }

    const csv = [
      "schemaVersion,metricId,value,unit,statistic,revision,reportKind,protocol,workload,environment,runId",
      `1,${latencyDefinition.id},=1+1,ms,p95,${revision},benchmark,load-profile-v1,checkout,staging,ci-10`,
    ].join("\n");
    const csvResult = parser.parseMeasurementReport({
      definitionId: latencyDefinition.id,
      source: csv,
      context: makeContext(csv, {
        reportSource: { path: "reports/metrics.csv" },
      }),
    });
    expect(csvResult).toMatchObject({
      ok: false,
      error: { code: "invalid-evidence" },
    });
  });

  it("enforces report size and shared file/line budget before parsing", () => {
    const parser = createParser(latencyDefinition);
    const oversized = "x".repeat(64 * 1024 + 1);
    const oversizedResult = parser.parseMeasurementReport({
      definitionId: latencyDefinition.id,
      source: oversized,
      context: makeContext(oversized),
    });
    expect(oversizedResult).toMatchObject({
      ok: false,
      error: { code: "limit-exceeded" },
    });

    budget.checkSelection.mockReturnValueOnce({
      ok: true,
      value: { allowed: false, reason: "line cap" },
    });
    const report = jsonReport([latencyRow()]);
    const budgetResult = parser.parseMeasurementReport({
      definitionId: latencyDefinition.id,
      source: report.text,
      context: report.context,
    });
    expect(budgetResult).toMatchObject({
      ok: false,
      error: { code: "limit-exceeded", message: "line cap" },
    });
    expect(budget.checkSelection).toHaveBeenCalledWith({
      files: 1,
      lines: expect.any(Number),
    });
  });

  it("rejects reports that exceed the row and column caps", () => {
    const parser = createParser(latencyDefinition);
    const tooManyRows = JSON.stringify({
      schemaVersion: 1,
      results: Array.from({ length: 101 }, () => latencyRow()),
    });
    const rowResult = parser.parseMeasurementReport({
      definitionId: latencyDefinition.id,
      source: tooManyRows,
      context: makeContext(tooManyRows),
    });
    expect(rowResult).toMatchObject({
      ok: false,
      error: { code: "limit-exceeded" },
    });

    const tooManyColumns = [
      [
        "schemaVersion",
        ...Array.from({ length: 32 }, (_, index) => `field${index}`),
      ].join(","),
      ["1", ...Array.from({ length: 32 }, () => "value")].join(","),
    ].join("\n");
    const columnResult = parser.parseMeasurementReport({
      definitionId: latencyDefinition.id,
      source: tooManyColumns,
      context: makeContext(tooManyColumns, {
        reportSource: { path: "reports/metrics.csv" },
      }),
    });
    expect(columnResult).toMatchObject({
      ok: false,
      error: { code: "limit-exceeded" },
    });
  });

  it("rejects a missing or stale source pointer before producing evidence", () => {
    const parser = createParser(latencyDefinition);
    const report = jsonReport([latencyRow()]);
    const missingSource = parser.parseMeasurementReport({
      definitionId: latencyDefinition.id,
      source: report.text,
      context: {
        ...report.context,
        reportSource: undefined,
      } as ExecutionContext,
    });
    expect(missingSource).toMatchObject({
      ok: false,
      error: { code: "invalid-evidence" },
    });

    const staleHash = parser.parseMeasurementReport({
      definitionId: latencyDefinition.id,
      source: report.text,
      context: {
        ...report.context,
        reportSource: {
          fileId: "selected-report",
          snapshotId: "snapshot-1",
          commitSha: revision,
          path: "reports/metrics.json",
          blobSha: "0".repeat(40),
        },
      } as ExecutionContext,
    });
    expect(staleHash).toMatchObject({
      ok: false,
      error: { code: "invalid-evidence" },
    });
  });

  it("uses only injected definitions and performs no external fetches", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const parser = createParser(latencyDefinition);
    const report = jsonReport([latencyRow()]);
    const unknown = parser.parseMeasurementReport({
      definitionId: "unregistered-metric",
      source: report.text,
      context: report.context,
    });
    const parsed = parser.parseMeasurementReport({
      definitionId: latencyDefinition.id,
      source: report.text,
      context: report.context,
    });
    expect(unknown).toMatchObject({
      ok: true,
      value: { candidates: [], unsupported: [expect.any(String)] },
    });
    expect(parsed.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
