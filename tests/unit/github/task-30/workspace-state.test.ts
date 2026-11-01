import { describe, expect, it } from "vitest";
import type {
  Draft,
  ImportReviewState,
} from "../../../../src/lib/github/contracts";
import {
  hasAnalysisStarted,
  analysisBlockReason,
  sameSelectionValue,
  canAnalyzeSelection,
  readDraftOverrides,
  readyToSubmitDraftIds,
  isPreparedSelectionCurrent,
  reconcileDraftOverrides,
  selectedEligibleDraftIds,
  stepForImportState,
  type DraftOverrides,
} from "../../../../src/components/github-import/workspace-state";

const hash = "a".repeat(64);

function reviewState(
  overrides: Partial<ImportReviewState> = {},
): ImportReviewState {
  const draft: Draft = {
    id: "draft-1",
    version: 1,
    projectId: "project-1",
    text: "Improved a data pipeline",
    reviewedBaseText: "Improved a data pipeline",
    claimIds: ["claim-1"],
    supportStatus: "supported",
    selectedForSave: true,
    contributionConfirmed: true,
    metricResultIds: [],
    approvalEligible: true,
    approvalErrors: [],
  };

  return {
    import: {
      id: "import-1",
      version: 4,
      source: "personal",
      destinationProjectId: "project-1",
      authorizationNamespaceHash: hash,
      scope: {} as ImportReviewState["import"]["scope"],
      selectionVersion: 2,
      selectionHash: hash,
      lifecycle: "ready-to-analyze",
      activeRunId: null,
      consent: null,
      preparedSelectionRef: hash,
      resultRef: null,
      draftRefs: [],
      draftEdits: [],
      reviewHistory: [],
      savedIds: [],
      pinnedFileIds: [],
      removedFileIds: [],
      candidateInventoryRef: null,
      resultRunId: null,
      approvalKeyHash: null,
      retentionDeadline: "2026-12-01T00:00:00.000Z",
      createdAt: "2026-10-27T00:00:00.000Z",
      updatedAt: "2026-10-27T00:00:00.000Z",
    },
    prepared: {
      importId: "import-1",
      runId: "run-1",
      version: 2,
      selectionHash: hash,
      scope: {} as ImportReviewState["import"]["scope"],
      selectedFileIds: [],
      evidence: [],
      limitations: [],
      completeness: "complete",
      budget: {
        fetchedFiles: 0,
        fetchedBytes: 0,
        httpAttempts: 0,
        selectedUniqueFiles: 0,
        selectedUniqueLines: 0,
        selectedCharacters: 0,
        transmittedLinesByRequest: [],
        cumulativeTransmittedLines: 0,
        estimatedInputTokens: null,
        reportedInputTokens: null,
        limitReason: null,
      },
      providerDisclosure: "Selected source excerpts will be sent for analysis.",
      consentedAt: null,
    },
    result: {
      summary: "Repository summary",
      claims: [
        {
          id: "claim-1",
          text: "Observed the pipeline implementation.",
          evidenceIds: ["evidence-1"],
          userStatementIds: [],
          classification: "observed",
          confirmedByUser: false,
          confirmationVersion: null,
          limitations: [],
        },
      ],
      drafts: [draft],
      questionSuggestions: [],
      limitations: [],
      model: null,
      finishReason: null,
      usage: {
        promptTokens: null,
        cachedTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        totalTokens: null,
      },
      selectionHash: hash,
    },
    priorReviews: [],
    questions: [],
    measurementResults: [],
    candidates: [],
    canSaveDraftIds: ["draft-1"],
    expired: false,
    ...overrides,
  };
}

describe("Task 30 workspace state", () => {
  it("maps persisted lifecycle states to the single page sections", () => {
    expect(stepForImportState(null)).toBe("setup");
    expect(
      stepForImportState(
        reviewState({
          import: {
            ...reviewState().import,
            lifecycle: "analyzing",
          },
        }),
      ),
    ).toBe("analysis");
    expect(
      stepForImportState(
        reviewState({
          import: {
            ...reviewState().import,
            lifecycle: "ready-to-analyze",
          },
        }),
      ),
    ).toBe("analysis");
    expect(
      stepForImportState(
        reviewState({
          import: {
            ...reviewState().import,
            lifecycle: "ready-to-review",
          },
        }),
      ),
    ).toBe("review");
    expect(
      stepForImportState(
        reviewState({
          import: { ...reviewState().import, lifecycle: "expired" },
        }),
      ),
    ).toBe("review");
    expect(
      stepForImportState(
        reviewState({
          import: { ...reviewState().import, lifecycle: "expired" },
          result: null,
        }),
      ),
    ).toBe("analysis");
  });

  it("requires the exact prepared selection and personal source before analysis", () => {
    const state = reviewState();
    expect(isPreparedSelectionCurrent(state)).toBe(true);
    expect(canAnalyzeSelection({ ...state, result: null }, "personal")).toBe(
      true,
    );
    expect(canAnalyzeSelection(state, "demo")).toBe(false);

    const stale = reviewState({
      import: { ...state.import, selectionHash: "b".repeat(64) },
    });
    expect(isPreparedSelectionCurrent(stale)).toBe(false);
    expect(canAnalyzeSelection(stale, "personal")).toBe(false);
  });

  it("does not replace local text when reconciling a newer server snapshot", () => {
    const state = reviewState();
    const overrides: DraftOverrides = {
      "draft-1": {
        text: "My edited draft",
        selectedForSave: true,
        contributionConfirmed: true,
        baseVersion: 1,
        dirty: true,
        conflict: false,
      },
    };

    const sameVersion = reconcileDraftOverrides(state, overrides);
    expect(sameVersion["draft-1"].text).toBe("My edited draft");
    expect(sameVersion["draft-1"].conflict).toBe(false);

    const newerServer = reviewState({
      result: {
        ...state.result!,
        drafts: [{ ...state.result!.drafts[0], version: 2 }],
      },
    });
    const conflict = reconcileDraftOverrides(newerServer, overrides);
    expect(conflict["draft-1"].text).toBe("My edited draft");
    expect(conflict["draft-1"].conflict).toBe(true);
  });

  it("only returns server-eligible, selected, confirmed, persisted drafts", () => {
    const state = reviewState();
    expect(selectedEligibleDraftIds(state, {})).toEqual(["draft-1"]);

    const dirty: DraftOverrides = {
      "draft-1": {
        text: "Edited but not persisted",
        selectedForSave: true,
        contributionConfirmed: true,
        baseVersion: 1,
        dirty: true,
        conflict: false,
      },
    };
    expect(selectedEligibleDraftIds(state, dirty)).toEqual([]);
    expect(
      selectedEligibleDraftIds({ ...state, canSaveDraftIds: [] }, {}),
    ).toEqual([]);
  });
});

describe("assembled review readiness", () => {
  it("enables the first save after a local contribution confirmation without trusting stale server eligibility", () => {
    const state = reviewState();
    state.import.lifecycle = "ready-to-review";
    state.canSaveDraftIds = [];
    state.result!.drafts[0].approvalEligible = false;
    state.result!.drafts[0].contributionConfirmed = false;
    const overrides: DraftOverrides = {
      "draft-1": {
        text: state.result!.drafts[0].text,
        selectedForSave: true,
        contributionConfirmed: true,
        baseVersion: 1,
        dirty: true,
        conflict: false,
      },
    };
    expect(readyToSubmitDraftIds(state, overrides)).toEqual(["draft-1"]);
    expect(selectedEligibleDraftIds(state, overrides)).toEqual([]);
    overrides["draft-1"].conflict = true;
    expect(readyToSubmitDraftIds(state, overrides)).toEqual([]);
  });
  it("accepts partial prepared bundles but never re-analyzes a completed result", () => {
    const state = reviewState();
    state.import.lifecycle = "partial";
    state.result = null;
    expect(canAnalyzeSelection(state, "personal")).toBe(true);
    state.prepared!.completeness = "needs-context";
    expect(canAnalyzeSelection(state, "personal")).toBe(false);
  });
  it("bounds restored draft data and ignores clean overrides after server-side metric invalidation", () => {
    expect(readDraftOverrides("{invalid")).toEqual({});
    expect(readDraftOverrides("x".repeat(70001))).toEqual({});
    const override = {
      text: "old numeric clause",
      selectedForSave: true,
      contributionConfirmed: true,
      baseVersion: 1,
      dirty: false,
      conflict: false,
    };
    expect(
      reconcileDraftOverrides(reviewState(), { "draft-1": override }),
    ).toEqual({});
    expect(
      readDraftOverrides(
        JSON.stringify({ "draft-1": { ...override, dirty: true } }),
      )["draft-1"].dirty,
    ).toBe(true);
  });
});

it("does not mistake consent left on partial preparation for a completed analysis", () => {
  const state = reviewState();
  state.result = null;
  state.import.lifecycle = "partial";
  state.import.consent = {
    selectionHash: hash,
    selectionVersion: 1,
    reference: "consent-reference",
    consentedAt: "2026-11-01T20:00:00.000Z",
  };
  expect(hasAnalysisStarted(state, false)).toBe(false);
  expect(hasAnalysisStarted(state, true)).toBe(true);
  state.import.lifecycle = "failed";
  expect(hasAnalysisStarted(state, false)).toBe(true);
  const completed = reviewState();
  completed.import.lifecycle = "partial";
  expect(hasAnalysisStarted(completed, false)).toBe(true);
});

describe("analysis action eligibility", () => {
  const ready = () => {
    const state = reviewState();
    state.result = null;
    state.import.lifecycle = "partial";
    return state;
  };
  const input = () => ({
    state: ready(),
    source: "personal" as const,
    connected: true,
    refreshing: false,
    dirty: false,
    approved: true,
    busy: false,
  });
  it("ignores transport key order but detects actual edits including nested facts", () => {
    const original = {
      answers: [{ nodeId: "purpose", optionIds: ["a"], text: "App" }],
      notes: { value: "Solo", source: "user" },
    };
    const transported = {
      notes: { source: "user", value: "Solo" },
      answers: [{ text: "App", optionIds: ["a"], nodeId: "purpose" }],
    };
    expect(JSON.stringify(original)).not.toBe(JSON.stringify(transported));
    expect(sameSelectionValue(original, transported)).toBe(true);
    transported.notes.value = "Team";
    expect(sameSelectionValue(original, transported)).toBe(false);
    expect(sameSelectionValue({ a: undefined }, {})).toBe(true);
    expect(sameSelectionValue(undefined, null)).toBe(false);
    expect(sameSelectionValue(["a", "b"], ["b", "a"])).toBe(false);
  });
  it("enables approved, current partial evidence", () => {
    expect(analysisBlockReason(input())).toBeNull();
    const full = input();
    full.state.import.lifecycle = "ready-to-analyze";
    expect(analysisBlockReason(full)).toBeNull();
  });
  it.each([
    [{ approved: false }, "Approve this exact"],
    [{ dirty: true }, "Prepare updated evidence"],
    [{ busy: true }, "Another import action"],
    [{ connected: false }, "Reconnect GitHub"],
    [{ refreshing: true }, "Checking GitHub"],
    [{ source: "demo" }, "Demo imports"],
    [{ inputError: "Invalid paths" }, "Invalid paths"],
  ])("explains each local blocker: %j", (patch, message) => {
    expect(
      analysisBlockReason({ ...input(), ...patch } as Parameters<
        typeof analysisBlockReason
      >[0]),
    ).toContain(message);
  });
  it("rejects expired, stale, incomplete, completed and already-submitted evidence", () => {
    const expired = input();
    expired.state.expired = true;
    expect(analysisBlockReason(expired)).toContain("expired");
    const stale = input();
    stale.state.prepared!.version++;
    expect(analysisBlockReason(stale)).toContain("out of date");
    const missing = input();
    missing.state.prepared = null;
    expect(analysisBlockReason(missing)).toContain("Prepare repository");
    const incomplete = input();
    incomplete.state.prepared!.completeness = "needs-context";
    expect(analysisBlockReason(incomplete)).toContain("missing context");
    const finished = input();
    finished.state.result = reviewState().result;
    expect(analysisBlockReason(finished)).toContain("already has a result");
    const submitted = input();
    submitted.state.import.consent = {
      reference: "sent",
      selectionHash: submitted.state.import.selectionHash!,
      selectionVersion: submitted.state.import.selectionVersion,
      consentedAt: "2026-11-01T20:00:00.000Z",
    };
    expect(analysisBlockReason(submitted)).toContain("already submitted");
    const running = input();
    running.state.import.lifecycle = "analyzing";
    expect(analysisBlockReason(running)).toContain("current state");
  });
});
