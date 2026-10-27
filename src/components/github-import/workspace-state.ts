import { z } from "zod";
import type {
  Draft,
  ImportLifecycle,
  ImportReviewState,
  ImportStep,
} from "../../lib/github/contracts";

export type DraftOverride = {
  text: string;
  selectedForSave: boolean;
  contributionConfirmed: boolean;
  baseVersion: number;
  dirty: boolean;
  conflict: boolean;
  confirmedMetricResultIds?: string[];
};

export type DraftOverrides = Record<string, DraftOverride>;

export function stepForImportState(
  state: ImportReviewState | null,
): ImportStep {
  if (!state) return "setup";

  const lifecycle = state.import.lifecycle;
  const hasDrafts = Boolean(state.result?.drafts.length);

  if (
    lifecycle === "ready-to-review" ||
    (lifecycle === "partial" && hasDrafts) ||
    lifecycle === "approved" ||
    (lifecycle === "expired" && hasDrafts) ||
    (lifecycle === "needs-input" && hasDrafts) ||
    (hasDrafts &&
      (lifecycle === "failed" ||
        lifecycle === "interrupted" ||
        lifecycle === "cancelled"))
  ) {
    return "review";
  }

  if (
    lifecycle === "partial" ||
    lifecycle === "ready-to-analyze" ||
    lifecycle === "preparing" ||
    lifecycle === "queued" ||
    lifecycle === "analyzing" ||
    lifecycle === "failed" ||
    lifecycle === "interrupted" ||
    lifecycle === "cancelled" ||
    lifecycle === "needs-input" ||
    lifecycle === "expired"
  ) {
    return "analysis";
  }

  return "setup";
}

export function isPreparedSelectionCurrent(
  state: ImportReviewState | null,
): boolean {
  if (!state?.prepared) return false;

  const { import: record, prepared } = state;
  return (
    !state.expired &&
    prepared.importId === record.id &&
    prepared.version === record.selectionVersion &&
    prepared.selectionHash === record.selectionHash &&
    record.selectionHash !== null
  );
}

export function canAnalyzeSelection(
  state: ImportReviewState | null,
  source: "personal" | "demo",
): boolean {
  if (source !== "personal" || !state) return false;
  if (
    !["ready-to-analyze", "partial"].includes(state.import.lifecycle) ||
    state.result ||
    state.prepared?.completeness === "needs-context"
  )
    return false;
  if (!isPreparedSelectionCurrent(state)) return false;

  const consent = state.import.consent;
  if (
    consent &&
    consent.selectionVersion === state.import.selectionVersion &&
    consent.selectionHash === state.import.selectionHash
  ) {
    return false;
  }

  return true;
}

export function getWorkspaceDrafts(
  state: ImportReviewState | null,
  overrides: DraftOverrides,
): Draft[] {
  const drafts = state?.result?.drafts ?? [];
  return drafts.map((draft) => {
    const override = overrides[draft.id];
    if (!override) return draft;

    return {
      ...draft,
      text: override.text,
      selectedForSave: override.selectedForSave,
      contributionConfirmed: override.contributionConfirmed,
    };
  });
}

/**
 * Keep local edits while a server refresh is in flight. A conflicting remote
 * version is surfaced instead of replacing the user's text.
 */
export function reconcileDraftOverrides(
  incoming: ImportReviewState,
  current: DraftOverrides,
): DraftOverrides {
  const incomingDrafts = new Map(
    (incoming.result?.drafts ?? []).map((draft) => [draft.id, draft]),
  );
  const next: DraftOverrides = {};

  for (const [draftId, override] of Object.entries(current)) {
    if (!override.dirty) continue;
    const serverDraft = incomingDrafts.get(draftId);
    if (!serverDraft) {
      next[draftId] = override;
      continue;
    }

    const matchesServer =
      serverDraft.text === override.text &&
      serverDraft.selectedForSave === override.selectedForSave &&
      serverDraft.contributionConfirmed === override.contributionConfirmed;
    if (matchesServer) continue;

    next[draftId] = {
      ...override,
      conflict:
        override.conflict ||
        (serverDraft.version !== override.baseVersion && override.dirty),
    };
  }

  return next;
}

export function selectedEligibleDraftIds(
  state: ImportReviewState | null,
  overrides: DraftOverrides,
): string[] {
  if (!state || state.expired) return [];

  const serverEligible = new Set(state.canSaveDraftIds);
  return getWorkspaceDrafts(state, overrides)
    .filter((draft) => {
      const override = overrides[draft.id];
      return (
        serverEligible.has(draft.id) &&
        draft.approvalEligible &&
        draft.selectedForSave &&
        draft.contributionConfirmed &&
        !override?.dirty &&
        !override?.conflict
      );
    })
    .map((draft) => draft.id);
}

export function stageLabel(lifecycle: ImportLifecycle): string {
  switch (lifecycle) {
    case "created":
      return "Ready to prepare repository evidence";
    case "preparing":
      return "Preparing repository evidence";
    case "ready-to-analyze":
      return "Evidence is ready for your review";
    case "queued":
      return "Waiting for the analysis worker";
    case "analyzing":
      return "Analyzing the approved evidence";
    case "ready-to-review":
      return "Drafts are ready for your review";
    case "needs-input":
      return "Your input is needed to continue";
    case "partial":
      return "Partial analysis is ready for review";
    case "failed":
      return "Analysis could not finish";
    case "cancelled":
      return "Analysis was cancelled";
    case "interrupted":
      return "Analysis stopped before it finished";
    case "expired":
      return "The staged result has expired";
    case "approved":
      return "Selected achievements were saved";
  }
}

export function makeConsentReference(
  createId: () => string = () => globalThis.crypto.randomUUID(),
): string {
  return createId();
}

/** Local readiness enables the save request; the server still validates every persisted version. */
export function readyToSubmitDraftIds(
  state: ImportReviewState | null,
  overrides: DraftOverrides,
): string[] {
  if (!state || state.expired || state.import.lifecycle === "approved")
    return [];
  const claims = new Set(state.result?.claims.map((c) => c.id));
  return getWorkspaceDrafts(state, overrides)
    .filter(
      (d) =>
        d.selectedForSave &&
        d.contributionConfirmed &&
        d.text.trim() &&
        ["supported", "partial"].includes(d.supportStatus) &&
        d.claimIds.length > 0 &&
        d.claimIds.every((id) => claims.has(id)) &&
        !overrides[d.id]?.conflict &&
        d.metricResultIds.every((id) =>
          (
            overrides[d.id]?.confirmedMetricResultIds ??
            state.import.draftEdits.find((e) => e.draftId === d.id)
              ?.confirmedMetricResultIds ??
            []
          ).includes(id),
        ),
    )
    .map((d) => d.id);
}

const OverridesSchema = z
  .record(
    z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    z
      .object({
        text: z.string().max(8000),
        selectedForSave: z.boolean(),
        contributionConfirmed: z.boolean(),
        baseVersion: z.number().int().positive(),
        dirty: z.boolean(),
        conflict: z.boolean(),
        confirmedMetricResultIds: z.array(z.string()).max(24).optional(),
      })
      .strict(),
  )
  .refine((value) => Object.keys(value).length <= 8);
export function readDraftOverrides(text: string | null): DraftOverrides {
  if (!text || text.length > 70000) return {};
  try {
    const parsed = OverridesSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}
