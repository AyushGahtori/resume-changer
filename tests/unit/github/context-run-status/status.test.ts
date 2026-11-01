import { describe, expect, it } from "vitest";
import {
  attemptMarkerFromCheckpoint,
  deriveRunStatus,
} from "../../../../src/lib/github/context-run-status/status";
import { runStatusSnapshot } from "../../../fixtures/github/context-run-status/snapshots";

describe("truthful GitHub analysis lifecycle", () => {
  it("keeps preparation, approval and submission as separate states", () => {
    expect(
      deriveRunStatus(
        runStatusSnapshot({ lifecycle: "preparing", busy: "preparing" }),
      ).phase,
    ).toBe("preparing");

    const approval = deriveRunStatus(runStatusSnapshot());
    expect(approval.phase).toBe("awaiting-approval");
    expect(approval.canApprove).toBe(true);
    expect(approval.canSave).toBe(false);
    expect(approval.summary).toContain("has not been submitted");

    expect(
      deriveRunStatus(
        runStatusSnapshot({
          lifecycle: "queued",
          jobState: "queued",
          busy: "submitting",
          attempt: { runId: "run-current", marker: "submitting", number: 1 },
        }),
      ).phase,
    ).toBe("submitting");

    expect(
      deriveRunStatus(
        runStatusSnapshot({
          lifecycle: "analyzing",
          jobState: "running",
          busy: "analyzing",
          attempt: {
            runId: "run-current",
            marker: "may-have-been-submitted",
            number: 1,
          },
        }),
      ).phase,
    ).toBe("analyzing");
  });

  it("does not let prepared evidence or stale busy state mask interruption", () => {
    const status = deriveRunStatus(
      runStatusSnapshot({
        lifecycle: "interrupted",
        jobState: "interrupted",
        busy: "analyzing",
        preparedSelection: "available",
        attempt: {
          runId: "run-current",
          marker: "may-have-been-submitted",
          number: 1,
        },
      }),
    );

    expect(status.phase).toBe("interrupted-unknown");
    expect(status.outcomeUnknown).toBe(true);
    expect(status.requiresReconciliation).toBe(true);
    expect(status.canApprove).toBe(false);
    expect(status.summary).toContain("provider may have received");
  });

  it("never calls a prepared bundle awaiting approval when an attempt marker is missing", () => {
    const status = deriveRunStatus(runStatusSnapshot({ attempt: undefined }));

    expect(status.phase).toBe("interrupted-unknown");
    expect(status.summary).not.toContain("Analysis has not been submitted");
  });

  it("distinguishes positive drafts, zero drafts and saved achievements", () => {
    const drafts = deriveRunStatus(
      runStatusSnapshot({
        lifecycle: "ready-to-review",
        result: {
          availability: "available",
          runId: "run-current",
          draftCount: 2,
        },
      }),
    );
    expect(drafts.phase).toBe("ready-with-drafts");
    expect(drafts.canSave).toBe(true);
    expect(drafts.draftCount).toBe(2);

    const noDrafts = deriveRunStatus(
      runStatusSnapshot({
        lifecycle: "ready-to-review",
        result: {
          availability: "available",
          runId: "run-current",
          draftCount: 0,
        },
      }),
    );
    expect(noDrafts.phase).toBe("ready-with-zero-drafts");
    expect(noDrafts.canSave).toBe(false);

    const saved = deriveRunStatus(
      runStatusSnapshot({ lifecycle: "approved", savedCount: 1 }),
    );
    expect(saved.phase).toBe("saved");
    expect(saved.canSave).toBe(false);
  });

  it("does not call an unknown draft count zero", () => {
    const status = deriveRunStatus(
      runStatusSnapshot({
        lifecycle: "ready-to-review",
        result: { availability: "available", runId: "run-current" },
      }),
    );
    expect(status.phase).toBe("interrupted-unknown");
    expect(status.draftCount).toBeUndefined();
  });

  it("does not let a result from an older run mask the current interruption", () => {
    const status = deriveRunStatus(
      runStatusSnapshot({
        lifecycle: "interrupted",
        runId: "run-current",
        attempt: {
          runId: "run-current",
          marker: "may-have-been-submitted",
          number: 2,
        },
        result: {
          availability: "available",
          runId: "run-previous",
          draftCount: 4,
        },
      }),
    );
    expect(status.phase).toBe("interrupted-unknown");
  });

  it("ignores an attempt marker from a different run", () => {
    const status = deriveRunStatus(
      runStatusSnapshot({
        lifecycle: "ready-to-analyze",
        attempt: { runId: "run-previous", marker: "not-submitted" },
      }),
    );
    expect(status.phase).toBe("interrupted-unknown");
    expect(status.summary).not.toContain("has not been submitted");
  });

  it("does not call a stale analyzing lifecycle active without a running job marker", () => {
    const status = deriveRunStatus(
      runStatusSnapshot({
        lifecycle: "analyzing",
        busy: "idle",
        jobState: null,
        attempt: {
          runId: "run-current",
          marker: "may-have-been-submitted",
          number: 1,
        },
      }),
    );
    expect(status.phase).toBe("interrupted-unknown");
    expect(status.summary).toContain("provider may have received");
  });

  it("does not carry a previous run's failure category into the current run", () => {
    const status = deriveRunStatus(
      runStatusSnapshot({
        lifecycle: "interrupted",
        runId: "run-current",
        failure: {
          runId: "run-previous",
          category: "provider-failure",
        },
      }),
    );
    expect(status.phase).toBe("interrupted-unknown");
    expect(status.categoryLabel).toBeUndefined();
    expect(status.summary).toContain("provider may have received");
  });

  it("keeps failed, cancellation and expiry states distinct", () => {
    expect(
      deriveRunStatus(
        runStatusSnapshot({
          lifecycle: "failed",
          failure: { runId: "run-current", category: "provider-failure" },
        }),
      ).phase,
    ).toBe("failed");
    expect(
      deriveRunStatus(
        runStatusSnapshot({ lifecycle: "cancelled", jobState: "cancelled" }),
      ).phase,
    ).toBe("cancelled");
    expect(
      deriveRunStatus(runStatusSnapshot({ lifecycle: "expired" })).phase,
    ).toBe("expired");
  });

  it("requires reconciliation when a failed lifecycle happened during result staging", () => {
    const status = deriveRunStatus(
      runStatusSnapshot({
        lifecycle: "failed",
        jobState: "failed",
        failure: {
          runId: "run-current",
          category: "final-acknowledgement",
          stage: "final-acknowledgement",
        },
      }),
    );
    expect(status.phase).toBe("interrupted-unknown");
    expect(status.requiresReconciliation).toBe(true);
    expect(status.canApprove).toBe(false);
  });

  it("maps only known checkpoint markers and treats missing fields as unknown", () => {
    expect(
      attemptMarkerFromCheckpoint({
        runnerStage: "analysis-started",
        providerState: "in-flight",
      }),
    ).toBe("may-have-been-submitted");
    expect(
      attemptMarkerFromCheckpoint({
        providerState: "completed",
        providerResultRef: "a".repeat(64),
      }),
    ).toBe("result-persisted");
    expect(attemptMarkerFromCheckpoint({ providerState: "not-started" })).toBe(
      "not-submitted",
    );
    expect(attemptMarkerFromCheckpoint({ providerState: "completed" })).toBe(
      "unknown",
    );
    expect(attemptMarkerFromCheckpoint(null)).toBe("unknown");
  });
});
