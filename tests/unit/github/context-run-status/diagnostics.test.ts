import { describe, expect, it } from "vitest";
import {
  MAX_DIAGNOSTIC_ELAPSED_MS,
  classifyRunFailure,
  createRunDiagnosticSession,
  type RunDiagnosticEvent,
} from "../../../../src/lib/github/context-run-status/diagnostics";

describe("content-free run diagnostics", () => {
  it.each([
    ["provider-response", "upstream-error", false, false, "provider-failure"],
    [
      "result-validation",
      "invalid-evidence",
      false,
      false,
      "validation-failure",
    ],
    ["budget-admission", "limit-exceeded", false, false, "budget-admission"],
    ["result-staging", "io-error", false, false, "result-staging"],
    ["result-staging", "limit-exceeded", false, false, "result-staging"],
    [
      "final-acknowledgement",
      "io-error",
      false,
      false,
      "final-acknowledgement",
    ],
    ["authorization", "forbidden", false, false, "authorization"],
    ["provider-response", "interrupted", false, true, "deadline"],
    ["provider-response", "cancelled", true, false, "cancellation"],
  ] as const)(
    "classifies %s without retaining exception text",
    (stage, errorCode, aborted, deadlineExceeded, expected) => {
      expect(
        classifyRunFailure({
          stage,
          errorCode,
          aborted,
          deadlineExceeded,
        }),
      ).toBe(expected);
    },
  );

  it("records hashed correlation references, safe stages, allowlisted codes and numeric status", () => {
    const events: RunDiagnosticEvent[] = [];
    let now = 10_500;
    const session = createRunDiagnosticSession({
      operationId: "operation_123",
      runId: "run_456",
      attempt: 1,
      startedAtMs: 10_000,
      now: () => now,
      write: (event) => events.push(event),
    });

    session.stage("provider-response");
    now = 10_720;
    session.failure({
      errorCode: "upstream-error",
      upstreamStatus: "HTTP_503",
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      event: "stage",
      stage: "provider-response",
      attempt: 1,
      elapsedMs: 500,
    });
    expect(events[1]).toMatchObject({
      event: "failure",
      stage: "provider-response",
      category: "provider-failure",
      errorCode: "upstream-error",
      upstreamStatus: 503,
      elapsedMs: 720,
    });
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("operation_123");
    expect(serialized).not.toContain("run_456");
    expect(serialized).not.toContain("HTTP_503");
  });

  it("drops unsafe labels, error codes, statuses and invalid attempts", () => {
    const events: RunDiagnosticEvent[] = [];
    const session = createRunDiagnosticSession({
      operationId: "operation_safe",
      runId: "run_safe",
      attempt: 3,
      startedAtMs: 0,
      now: () => 100,
      write: (event) => events.push(event),
    });
    session.stage("private-source.ts" as never);
    session.failure({
      stage: "private-source.ts",
      errorCode: "private-secret-error",
      upstreamStatus: 999,
    });

    expect(events).toEqual([]);

    const validAttempt = createRunDiagnosticSession({
      operationId: "operation_safe",
      runId: "run_safe",
      attempt: 1,
      startedAtMs: 0,
      now: () => 100,
      write: (event) => events.push(event),
    });
    validAttempt.stage("provider-response");
    validAttempt.failure({
      stage: "private-source.ts",
      errorCode: "private-secret-error",
      upstreamStatus: 999,
    });

    expect(events.at(-1)).toMatchObject({
      event: "failure",
      stage: "provider-response",
      category: "provider-failure",
    });
    expect(events.at(-1)).not.toHaveProperty("errorCode");
    expect(events.at(-1)).not.toHaveProperty("upstreamStatus");
    expect(JSON.stringify(events)).not.toContain("private");
  });

  it("bounds elapsed time and does not allow a diagnostics sink to change run behavior", () => {
    const events: RunDiagnosticEvent[] = [];
    const session = createRunDiagnosticSession({
      operationId: "operation_123",
      runId: "run_456",
      attempt: 2,
      startedAtMs: 0,
      now: () => MAX_DIAGNOSTIC_ELAPSED_MS + 10_000,
      write: (event) => events.push(event),
    });

    session.stage("result-staging");
    expect(events[0]).toMatchObject({
      elapsedMs: MAX_DIAGNOSTIC_ELAPSED_MS,
      elapsedCapped: true,
    });

    const sinkFails = createRunDiagnosticSession({
      operationId: "operation_123",
      runId: "run_456",
      attempt: 2,
      startedAtMs: 0,
      now: () => MAX_DIAGNOSTIC_ELAPSED_MS + 10_000,
      write: () => {
        throw new Error("private-source-error");
      },
    });

    expect(() => {
      sinkFails.stage("result-staging");
      sinkFails.failure({ errorCode: "io-error" });
    }).not.toThrow();
  });

  it("uses null elapsed time when the injected clock is invalid", () => {
    const events: RunDiagnosticEvent[] = [];
    const session = createRunDiagnosticSession({
      operationId: "operation_123",
      runId: "run_456",
      attempt: 1,
      startedAtMs: Number.NaN,
      now: () => Number.POSITIVE_INFINITY,
      write: (event) => events.push(event),
    });
    session.failure({ stage: "deadline", deadlineExceeded: true });

    expect(events[0]).toMatchObject({ elapsedMs: null, elapsedCapped: false });
  });
});
