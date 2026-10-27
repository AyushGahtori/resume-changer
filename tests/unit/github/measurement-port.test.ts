import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  createMeasurementPort,
  measurementDefinitions,
} from "../../../src/lib/github/server/measurement-port";
import { createReportParser } from "../../../src/lib/github/server/reports-core";
import { measurementAnswerHash } from "../../../src/lib/github/server/measurement-service";
import { createRunBudget } from "../../../src/lib/github/server/budget-port";
import { GithubConfirmedMetricEvidenceSchema } from "../../../src/lib/schemas/resume-data";
import type {
  ExecutionContext,
  MeasurementAnswer,
  Result,
} from "../../../src/lib/github/contracts";

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
const port = createMeasurementPort();
const base: Omit<MeasurementAnswer, "answerHash"> = {
  questionId: "question-one",
  version: 1,
  mode: "result",
  definitionId: "metric-web-api-latency-p95",
  originalValues: [1, 0.5],
  originalUnits: ["s", "s"],
  statistic: "p95",
  context: {
    capabilityId: "web-api",
    taskType: "web-api",
    endpoint: "POST /publish",
    workload: "100 concurrent requests",
    environment: "local fixture",
    sourceDescription: "Fictional load test",
  },
  sourceEvidenceIds: [],
  attestation: "user-attested",
};
const answer = (
  input: Omit<MeasurementAnswer, "answerHash">,
): MeasurementAnswer => ({
  ...input,
  answerHash: measurementAnswerHash(input),
});

describe("composed measurement adapters", () => {
  it("normalizes real catalog units, calculates a reduction and rejects a tampered result", () => {
    const result = value(
      port.deriveMeasurementResult({ answer: answer(base) }),
    )!;
    expect(result.normalizedValues).toEqual([1000, 500]);
    expect(result.derivedQuantity).toBe(50);
    expect(value(port.renderMetricClause({ result })).clause).toContain("50%");
    expect(
      port.renderMetricClause({ result: { ...result, derivedQuantity: 75 } }),
    ).toMatchObject({ ok: false, error: { code: "invalid-evidence" } });
    expect(
      value(
        port.deriveMeasurementResult({
          answer: answer({ ...base, mode: "target" }),
        }),
      ),
    ).toBeNull();
  });
  it("feeds a pinned JSON report through the real parser and calculator without provider calls", () => {
    const source = JSON.stringify({
      schemaVersion: 1,
      results: [
        {
          metricId: base.definitionId,
          taskType: "web-api",
          value: 250,
          unit: "ms",
          statistic: "p95",
          endpoint: "POST /publish",
          workload: "100 concurrent requests",
          environment: "local fixture",
          revision: "a".repeat(40),
          reportKind: "benchmark",
          runId: "report-run",
          protocol: "fixture-v1",
        },
      ],
    });
    const now = () => new Date("2026-10-27T12:00:00Z");
    const context: ExecutionContext & { reportSource: unknown } = {
      personalRoot: process.cwd(),
      access: {
        sessionId: "fixture-session",
        authorizationNamespace: "fixture-session",
        accountId: null,
        grantedRepositoryIds: ["42"],
      },
      signal: new AbortController().signal,
      now,
      runId: "report-run",
      deadline: "2026-10-27T12:02:00Z",
      budget: createRunBudget({ now, deadline: "2026-10-27T12:02:00Z" }),
      reportSource: {
        fileId: "report-file",
        snapshotId: "snapshot-one",
        path: "reports/latency.json",
        blobSha: createHash("sha1")
          .update(`blob ${Buffer.byteLength(source)}\0`)
          .update(source)
          .digest("hex"),
        commitSha: "a".repeat(40),
      },
    };
    const parsed = value(
      createReportParser({
        definitions: measurementDefinitions,
      }).parseMeasurementReport({
        definitionId: base.definitionId!,
        source,
        context,
      }),
    );
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.sourcePointers[0]?.classification).toBe("observed");
    const result = value(
      port.deriveMeasurementResult({ answer: parsed.candidates[0]! }),
    )!;
    expect(result.normalizedValues).toEqual([250]);
    expect(value(port.renderMetricClause({ result })).clause).toContain("250");
  });
  it("requires source evidence for measured provenance and a description for a standalone attestation", () => {
    const metric = {
      metricId: "00000000-0000-4000-8000-000000000001",
      evidenceIds: [],
      status: "user-attested",
      context: "Fictional load test observation",
      confirmed: true,
      confirmedAt: "2026-10-27T12:00:00Z",
      confirmationVersion: 1,
    };
    expect(GithubConfirmedMetricEvidenceSchema.safeParse(metric).success).toBe(
      true,
    );
    expect(
      GithubConfirmedMetricEvidenceSchema.safeParse({
        ...metric,
        status: "measured",
      }).success,
    ).toBe(false);
    expect(
      GithubConfirmedMetricEvidenceSchema.safeParse({
        ...metric,
        context: undefined,
      }).success,
    ).toBe(false);
  });
});
