import {
  sha256,
  type EvidenceBundle,
  type InterviewContext,
} from "./contracts";

export interface SyntheticConsentInput {
  context: InterviewContext;
  selection: EvidenceBundle;
  screenshotHashes: readonly string[];
}

export interface SyntheticApproval {
  contentHash: string;
}

export interface SyntheticDraft {
  id: string;
  selected: boolean;
  contributionConfirmed: boolean;
  text: string;
}

export interface SyntheticProvider {
  generate(input: SyntheticConsentInput): Promise<{ runId: string }>;
}

export class SyntheticConsentHarness {
  readonly providerReceipts = new Map<
    string,
    { contentHash: string; result: { runId: string } }
  >();

  async submit(input: {
    current: SyntheticConsentInput;
    approval?: SyntheticApproval;
    idempotencyKey: string;
    provider: SyntheticProvider;
  }): Promise<{
    status: "needs-consent" | "completed" | "idempotency-conflict";
    result?: { runId: string };
  }> {
    const contentHash = hashConsentInput(input.current);
    if (!input.approval || input.approval.contentHash !== contentHash)
      return { status: "needs-consent" };
    const existing = this.providerReceipts.get(input.idempotencyKey);
    if (existing) {
      if (existing.contentHash !== contentHash)
        return { status: "idempotency-conflict" };
      return { status: "completed", result: existing.result };
    }
    const result = await input.provider.generate(input.current);
    this.providerReceipts.set(input.idempotencyKey, { contentHash, result });
    return { status: "completed", result };
  }
}

export function hashConsentInput(input: SyntheticConsentInput): string {
  return sha256(
    [
      JSON.stringify(input.context),
      input.selection.selectionId,
      ...input.selection.sections.map(({ contentHash }) => contentHash).sort(),
      ...[...input.screenshotHashes].sort(),
    ].join("\n"),
  );
}

export function persistedSyntheticSession(input: {
  context: InterviewContext;
  selection: EvidenceBundle;
  screenshotHashes: readonly string[];
}): Record<string, unknown> {
  return {
    repositoryId: input.selection.repositoryId,
    commitSha: input.selection.commitSha,
    selectionId: input.selection.selectionId,
    sourceFileIds: [...input.selection.selectedFileIds],
    contextHash: sha256(JSON.stringify(input.context)),
    screenshotHashes: [...input.screenshotHashes],
    status: "prepared",
  };
}

export function saveConfirmedDrafts(
  drafts: readonly SyntheticDraft[],
): SyntheticDraft[] {
  return drafts
    .filter((draft) => draft.selected && draft.contributionConfirmed)
    .map((draft) => ({ ...draft }));
}
