import type {
  AnalysisStatusProps,
  ImportLifecycle,
} from "../../../../src/components/github-import/analysis-status";

export function statusProps(
  state: ImportLifecycle = "queued",
  overrides: Partial<AnalysisStatusProps> = {},
): AnalysisStatusProps {
  return {
    state,
    stage:
      state === "queued"
        ? "Waiting for an available worker"
        : "Reading selected source files",
    createdAt: "2026-10-27T08:30:00.000Z",
    updatedAt: "2026-10-27T08:31:00.000Z",
    cancellationAvailable: state === "queued" || state === "analyzing",
    retryAvailable: false,
    resumeAvailable: false,
    error: null,
    onCancel: () => undefined,
    onRetry: () => undefined,
    onResumeSetup: () => undefined,
    ...overrides,
  };
}
