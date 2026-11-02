import type { RunStatusInput } from "../../../../src/lib/github/context-run-status/status";

export function runStatusSnapshot(
  overrides: Partial<RunStatusInput> = {},
): RunStatusInput {
  return {
    lifecycle: "ready-to-analyze",
    runId: "run-current",
    busy: "idle",
    preparedSelection: "available",
    attempt: { runId: "run-current", marker: "not-submitted" },
    result: { availability: "missing" },
    ...overrides,
  };
}
