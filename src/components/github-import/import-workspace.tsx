"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import "./import-tokens.css";
import type {
  AchievementReviewProps,
  AnalysisStatusProps,
  EvidencePanelProps,
  ImportLayoutProps,
  ImportStep,
  ImportTrustRailProps,
  MeasurementFieldsProps,
  ProjectOption,
  RepositorySetupProps,
} from "../../lib/github/contracts";
import { AchievementReview } from "./achievement-review";
import { AnalysisStatus } from "./analysis-status";
import { EvidencePanel } from "./evidence-panel";
import { ImportLayout } from "./import-layout";
import { MeasurementFields } from "./measurement-fields";
import { RepositorySetup } from "./repository-setup";
import { ImportTrustRail } from "./trust-rail";
import styles from "./import-workspace.module.css";
import { useImportWorkspace } from "./use-import-workspace";
import { stageLabel, stepForImportState } from "./workspace-state";

export type ImportWorkspacePageProps = {
  source: "personal" | "demo";
  importId: string | null;
  routeState: ImportStep;
  initialState: import("../../lib/github/contracts").ImportReviewState | null;
  projects: ProjectOption[];
  initialProjectId?: string;
  installationUrl?: string;
};

function errorText(error: { message: string } | null) {
  return error?.message ?? "";
}

export function ImportWorkspace(props: ImportWorkspacePageProps) {
  const workspace = useImportWorkspace(props);
  const review = workspace.review;
  const step = workspace.forceSetup
    ? "setup"
    : review
      ? stepForImportState(review)
      : props.routeState;
  const stage = review
    ? stageLabel(review.import.lifecycle)
    : workspace.importId
      ? "Loading saved import status"
      : "Set up a repository import";
  const activeRunId = review?.import.activeRunId ?? null;
  const prepared = review?.prepared ?? null;
  const drafts = workspace.currentDrafts;
  const inspectedCandidate = review?.candidates.find(
    (candidate) => candidate.id === workspace.inspectedFileId,
  );
  const stagedSelectedFileIds = new Set(
    prepared?.selectedFileIds ??
      workspace.candidates
        .filter((candidate) => candidate.selected)
        .map((candidate) => candidate.id),
  );
  for (const fileId of workspace.pendingRemovedFileIds) {
    stagedSelectedFileIds.delete(fileId);
  }
  for (const fileId of workspace.pendingPinnedFileIds) {
    stagedSelectedFileIds.add(fileId);
  }
  const visibleError = workspace.actionError ?? workspace.connectionError;

  const setupProps: ComponentProps<typeof RepositorySetup> = {
    installationUrl:
      props.source === "personal" ? props.installationUrl : undefined,
    repositoryRevision: workspace.repositoryScope
      ? {
          ref: workspace.repositoryScope.ref,
          sha: workspace.repositoryScope.commitSha,
        }
      : null,
    pullRequestState: workspace.pullRequestState,
    pullRequestStatusMessage: workspace.pullRequestStatusMessage,
    repositories: workspace.repositories,
    selectedRepositoryId: workspace.selectedRepositoryId,
    projects: workspace.projects,
    selectedProjectId: workspace.selectedProjectId,
    connectionState: workspace.connectionState,
    connectionPresentationState: workspace.connectionPresentationState,
    connectionStatusMessage: workspace.connectionMessage || null,
    isRefreshingRepositories: workspace.isRefreshingRepositories,
    onRefreshRepositories: workspace.loadRepositories,
    role: workspace.role,
    pullRequests: workspace.pullRequests,
    selectedPullRequestNumbers: workspace.selectedPullRequests,
    ready: Boolean(
      workspace.source === "personal" &&
      workspace.connectionState === "connected" &&
      !workspace.isRefreshingRepositories &&
      workspace.repositories.some(
        (repository) =>
          repository.repositoryId === workspace.selectedRepositoryId,
      ) &&
      workspace.repositoryScope &&
      workspace.selectedProjectId &&
      workspace.role.trim() &&
      !workspace.extras.error,
    ),
    error: workspace.connectionError,
    onConnect: () => void workspace.connect(),
    onRepositoryChange: (id) => void workspace.chooseRepository(id),
    onDestinationChange: (id) => {
      workspace.setSelectedProjectId(id);
      workspace.setConsentAccepted(false);
    },
    onRoleChange: workspace.setRole,
    onPrSelectionChange: (numbers) =>
      workspace.setPullRequestText(numbers.join(", ")),
  };

  const evidenceProps: EvidencePanelProps = {
    candidates: workspace.candidates,
    selectedIds: [...stagedSelectedFileIds],
    pinnedIds: workspace.pendingPinnedFileIds,
    excerpts: prepared?.evidence ?? [],
    limitations: prepared?.limitations ?? [],
    budget: prepared?.budget ?? {
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
    onPin: workspace.pinCandidate,
    onRemove: workspace.removeCandidate,
    onInspect: workspace.setInspectedFileId,
  };

  const achievementProps: ComponentProps<typeof AchievementReview> = {
    drafts,
    selectedIds: drafts
      .filter((draft) => draft.selectedForSave)
      .map((draft) => draft.id),
    contributionConfirmations: Object.fromEntries(
      drafts.map((draft) => [draft.id, draft.contributionConfirmed]),
    ),
    supportDetails: Object.fromEntries(
      drafts.map((d) => [d.id, d.approvalErrors.join(" ")]),
    ),
    detailsByDraftId: Object.fromEntries(
      drafts.map((d) => {
        const claims = (review?.result?.claims ?? []).filter((c) =>
          d.claimIds.includes(c.id),
        );
        const ids = new Set(claims.flatMap((c) => c.evidenceIds));
        return [
          d.id,
          {
            evidence: (prepared?.evidence ?? [])
              .filter((e) => ids.has(e.id) && e.classification !== "inferred")
              .map((e) => ({
                id: e.id,
                category:
                  e.classification === "observed"
                    ? ("observed" as const)
                    : e.classification === "user-provided"
                      ? ("user-provided" as const)
                      : ("documented" as const),
                path: e.path,
                excerpt: e.excerpt,
                ...(e.pointer.kind === "lines"
                  ? {
                      lineStart: e.pointer.startLine,
                      lineEnd: e.pointer.endLine,
                    }
                  : {}),
                sourceUrl: `${review!.import.scope.canonicalUrl}/blob/${e.commitSha}/${e.path.split("/").map(encodeURIComponent).join("/")}`,
              })),
            userContext: [review?.import.scope.contributionStatement ?? ""],
            inference: claims
              .filter((c) => c.classification === "inferred")
              .map((c) => c.text),
            metrics: [],
          },
        ];
      }),
    ),
    renderMeasurement: (draft) => {
      const questions = (review?.questions ?? []).filter(
        (q) => q.draftId === draft.id,
      );
      const preview = workspace.metricDraftPreviews[draft.id];
      return (
        <div>
          <MeasurementFields
            {...measurementProps}
            initiallyExpanded
            questions={questions}
          />
          {preview ? (
            <div className={styles.consent}>
              <p>Review the exact measurement wording before using it.</p>
              <blockquote>{preview.text}</blockquote>
              <button
                type="button"
                onClick={() =>
                  workspace.editDraft(draft, {
                    text: preview.text,
                    confirmedMetricResultIds: [preview.resultId],
                  })
                }
              >
                Use this measurement in the achievement
              </button>
            </div>
          ) : null}
        </div>
      );
    },
    onTextChange: (id, text) => {
      const draft = drafts.find((item) => item.id === id);
      if (draft) workspace.editDraft(draft, { text });
    },
    onSelect: (id, selected) => {
      const draft = drafts.find((item) => item.id === id);
      if (draft) workspace.editDraft(draft, { selectedForSave: selected });
    },
    onConfirmContribution: (id, confirmed) => {
      const draft = drafts.find((item) => item.id === id);
      if (draft)
        workspace.editDraft(draft, { contributionConfirmed: confirmed });
    },
    onReject: (id) => {
      const draft = drafts.find((item) => item.id === id);
      if (draft) workspace.editDraft(draft, { selectedForSave: false });
    },
    onExpandMeasurement: (id) => workspace.setExpandedDraftId(id),
  };

  const measurementProps: MeasurementFieldsProps = {
    questions: review?.questions ?? [],
    answers: workspace.answers,
    validation: {},
    previews: workspace.measurementResults,
    onAnswer: (id, answer) => workspace.answerQuestion(id, answer),
    onSkip: (id, version) => workspace.skipQuestion(id, version, "skip"),
    onDefer: (id, version) => workspace.skipQuestion(id, version, "defer"),
  };

  const trustProps: ImportTrustRailProps = {
    safetySummary: [
      "Only the prepared selection is eligible for analysis.",
      "Drafts are saved only after you select and confirm them.",
      "Measurement answers are processed locally without generation.",
    ],
    runIdentity: {
      importId: review?.import.id ?? "pending-import",
      runId: prepared?.runId ?? activeRunId,
      revision: review?.import.scope.commitSha ?? "",
    },
    budget: prepared?.budget ?? evidenceProps.budget,
    cost: {
      estimate: null,
      currency: null,
      uncertainty: "No cost estimate is available.",
    },
    eligibleCount: workspace.eligibleIds.length,
    selectedCount: drafts.filter((d) => d.selectedForSave).length,
    runDetails: {
      repository: review
        ? `${review.import.scope.owner}/${review.import.scope.name}`
        : null,
      inspectedAt: prepared?.snapshot?.observedAt ?? null,
      excerpts: prepared?.evidence.length ?? null,
      pullRequests:
        review?.import.scope.selectedPullRequestNumbers.length ?? null,
      model: review?.result?.model ?? null,
      savedIds: workspace.savedIds,
    },
    saveState: workspace.saveState,
    errors: [workspace.actionError, workspace.connectionError].filter(
      (error): error is NonNullable<typeof error> => Boolean(error),
    ),
    onSave: () => void workspace.approve(),
    onDiscard: () => workspace.discard(),
    onBack: workspace.goBack,
  };

  const analysisProps: AnalysisStatusProps = {
    busy: workspace.busy !== "idle",
    state:
      workspace.busy === "preparing"
        ? "preparing"
        : workspace.busy === "analyzing"
          ? "analyzing"
          : (review?.import.lifecycle ?? "created"),
    stage:
      workspace.busy === "preparing"
        ? "Preparing repository evidence"
        : workspace.busy === "analyzing"
          ? "Analyzing the approved evidence"
          : stage,
    createdAt: review?.import.createdAt ?? new Date(0).toISOString(),
    updatedAt: review?.import.updatedAt ?? new Date(0).toISOString(),
    cancellationAvailable: Boolean(
      workspace.busy === "preparing" ||
      workspace.busy === "analyzing" ||
      (activeRunId &&
        ["queued", "analyzing"].includes(review?.import.lifecycle ?? "")),
    ),
    retryAvailable: ["failed", "interrupted", "cancelled"].includes(
      review?.import.lifecycle ?? "",
    ),
    resumeAvailable: review?.import.lifecycle === "needs-input",
    error: workspace.actionError,
    onCancel: () => void workspace.cancel(),
    onRetry: () => void workspace.updateSelectionAndPrepare(),
    onResumeSetup: () => {
      workspace.setConsentAccepted(false);
      workspace.setForceSetup(true);
    },
  };

  const main = (
    <div className={styles.main}>
      <p role="note">
        Unsaved GitHub evidence stays in this tab. Reloading or closing it
        starts over. Evidence expires after 20 minutes without an import action.
      </p>
      {workspace.busy === "preparing" || workspace.busy === "analyzing" ? (
        <button type="button" onClick={() => void workspace.cancel()}>
          Cancel current request
        </button>
      ) : null}
      {workspace.importId && !workspace.loading && !review ? (
        <Link href="/library/github/new">Start a new import</Link>
      ) : null}
      {workspace.source === "demo" && (
        <aside className={styles.banner} role="status">
          Demo imports are read-only. Switch to your personal library to connect
          GitHub and stage evidence.
        </aside>
      )}
      {workspace.loading ? (
        <p role="status">Loading the saved import…</p>
      ) : null}
      {workspace.selectionIsDirty ? (
        <div className={styles.banner} role="status">
          <p>
            The selection has changed. Prepare the updated evidence before
            analyzing.
          </p>
          <button
            type="button"
            disabled={workspace.busy !== "idle" || !!workspace.extras.error}
            onClick={() => void workspace.updateSelectionAndPrepare()}
          >
            Prepare updated evidence
          </button>
        </div>
      ) : null}
      {visibleError &&
      !prepared &&
      (workspace.actionError || step !== "setup") ? (
        <p className={styles.error} role="alert">
          {errorText(visibleError)}
        </p>
      ) : null}
      {inspectedCandidate ? (
        <p className={styles.note} role="status">
          Inspecting {inspectedCandidate.path}. The server verified this
          candidate against the current repository snapshot.
        </p>
      ) : null}

      {step === "setup" ? (
        <section
          className={styles.section}
          aria-labelledby="github-setup-heading"
        >
          <h2 id="github-setup-heading">Set up repository evidence</h2>
          <RepositorySetup {...setupProps} />
          <details className={styles.advanced}>
            <summary>Optional pull requests and file paths</summary>
            <p>
              Enter pull request numbers or relative paths. The server checks
              access and file safety when it prepares the selection.
            </p>
            <label>
              Pull request numbers
              <input
                aria-label="Pull request numbers"
                value={workspace.pullRequestText}
                onChange={(event) =>
                  workspace.setPullRequestText(event.currentTarget.value)
                }
                inputMode="numeric"
                placeholder="e.g. 12, 18"
                disabled={workspace.source !== "personal"}
              />
            </label>
            <label>
              Repository paths, one per line
              <textarea
                aria-label="Manual repository paths"
                value={workspace.manualPathText}
                onChange={(event) =>
                  workspace.setManualPathText(event.currentTarget.value)
                }
                placeholder="src/service.ts"
                rows={3}
                disabled={workspace.source !== "personal"}
              />
            </label>
            {workspace.extras.error ? (
              <p className={styles.error} role="alert">
                {workspace.extras.error}
              </p>
            ) : null}
          </details>
          <button
            type="button"
            className={styles.primary}
            disabled={
              workspace.source !== "personal" ||
              workspace.busy !== "idle" ||
              !setupProps.ready ||
              workspace.loading
            }
            onClick={() =>
              void (workspace.importId
                ? workspace.updateSelectionAndPrepare()
                : workspace.createAndPrepare())
            }
          >
            {workspace.busy === "preparing"
              ? "Preparing evidence…"
              : workspace.importId
                ? "Update selection and prepare"
                : "Prepare selected evidence"}
          </button>
        </section>
      ) : null}

      {step === "analysis" ? (
        <section
          className={styles.section}
          aria-labelledby="github-analysis-heading"
        >
          <h2 id="github-analysis-heading">Review the staged selection</h2>
          {review ? <AnalysisStatus {...analysisProps} /> : null}
          {prepared ? <EvidencePanel {...evidenceProps} /> : null}
          {["ready-to-analyze", "partial"].includes(
            review?.import.lifecycle ?? "",
          ) && !review?.result ? (
            <div className={styles.consent}>
              <p>
                {prepared?.providerDisclosure ??
                  "The exact prepared evidence will be shared with the configured analysis provider."}
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={workspace.consentAccepted}
                  onChange={(event) =>
                    workspace.setConsentAccepted(event.currentTarget.checked)
                  }
                />
                I reviewed this selection and explicitly approve one analysis
                run.
              </label>
              <button
                type="button"
                className={styles.primary}
                disabled={!workspace.canAnalyze}
                onClick={() => void workspace.analyze()}
              >
                {workspace.busy === "analyzing"
                  ? "Submitting analysis…"
                  : "Analyze this selection"}
              </button>
            </div>
          ) : null}
          {review?.import.lifecycle === "ready-to-analyze" ||
          review?.import.lifecycle === "ready-to-review" ||
          review?.import.lifecycle === "partial" ? (
            <details className={styles.advanced}>
              <summary>Change the repository selection</summary>
              <p>
                Changes are staged first. Analyze will run only after you review
                and approve the updated bundle.
              </p>
              <p>
                {workspace.pendingPinnedFileIds.length} pinned file
                {workspace.pendingPinnedFileIds.length === 1 ? "" : "s"} ·{" "}
                {workspace.pendingRemovedFileIds.length} removed file
                {workspace.pendingRemovedFileIds.length === 1 ? "" : "s"} staged
              </p>
              <label>
                Role or contribution context
                <textarea
                  value={workspace.role}
                  onChange={(event) =>
                    workspace.setRole(event.currentTarget.value)
                  }
                  rows={3}
                />
              </label>
              <label>
                Pull request numbers
                <input
                  value={workspace.pullRequestText}
                  onChange={(event) =>
                    workspace.setPullRequestText(event.currentTarget.value)
                  }
                  inputMode="numeric"
                />
              </label>
              <label>
                Repository paths, one per line
                <textarea
                  value={workspace.manualPathText}
                  onChange={(event) =>
                    workspace.setManualPathText(event.currentTarget.value)
                  }
                  rows={3}
                />
              </label>
              {workspace.extras.error ? (
                <p className={styles.error} role="alert">
                  {workspace.extras.error}
                </p>
              ) : null}
              <button
                type="button"
                disabled={
                  workspace.busy !== "idle" || Boolean(workspace.extras.error)
                }
                onClick={() => void workspace.updateSelectionAndPrepare()}
              >
                Update selection and prepare a new run
              </button>
            </details>
          ) : null}
        </section>
      ) : null}

      {step === "review" ? (
        <section
          className={styles.section}
          aria-labelledby="github-review-heading"
        >
          <h2 id="github-review-heading">Review achievements</h2>
          {review?.expired ? (
            <p className={styles.error} role="alert">
              This staged result has expired. Its saved drafts remain available
              only if the service returns them.
            </p>
          ) : null}
          {prepared ? <EvidencePanel {...evidenceProps} /> : null}
          <AchievementReview {...achievementProps} />

          <details className={styles.advanced}>
            <summary>Change repository selection</summary>
            <p>
              Changes are staged first. The previous run remains available for
              comparison.
            </p>
            <p>
              {workspace.pendingPinnedFileIds.length} pinned file
              {workspace.pendingPinnedFileIds.length === 1 ? "" : "s"} ·{" "}
              {workspace.pendingRemovedFileIds.length} removed file
              {workspace.pendingRemovedFileIds.length === 1 ? "" : "s"} staged
            </p>
            <label>
              Role or contribution context
              <textarea
                value={workspace.role}
                onChange={(event) =>
                  workspace.setRole(event.currentTarget.value)
                }
                rows={3}
              />
            </label>
            <label>
              Pull request numbers
              <input
                value={workspace.pullRequestText}
                onChange={(event) =>
                  workspace.setPullRequestText(event.currentTarget.value)
                }
                inputMode="numeric"
              />
            </label>
            <label>
              Repository paths, one per line
              <textarea
                value={workspace.manualPathText}
                onChange={(event) =>
                  workspace.setManualPathText(event.currentTarget.value)
                }
                rows={3}
              />
            </label>
            {workspace.extras.error ? (
              <p className={styles.error} role="alert">
                {workspace.extras.error}
              </p>
            ) : null}
            <button
              type="button"
              disabled={
                workspace.busy !== "idle" || Boolean(workspace.extras.error)
              }
              onClick={() => void workspace.updateSelectionAndPrepare()}
            >
              Update selection and prepare a new run
            </button>
          </details>
          {workspace.expandedDraftId ? (
            <p className={styles.note}>
              Measurement details for the selected draft are shown with its
              questions above.
            </p>
          ) : null}
          {workspace.previousDrafts.length ? (
            <details className={styles.advanced}>
              <summary>Previous run drafts kept for comparison</summary>
              {workspace.previousDrafts.map((draft) => (
                <p key={draft.id}>
                  <strong>{draft.id}</strong> · {draft.text}
                </p>
              ))}
            </details>
          ) : null}
          {review?.import.reviewHistory.length ? (
            <details className={styles.advanced}>
              <summary>Saved edits from earlier runs</summary>
              {review.import.reviewHistory
                .flatMap((entry) => entry.draftEdits)
                .map((edit) => (
                  <p key={edit.draftId + edit.updatedAt}>
                    <strong>{edit.draftId}</strong> · {edit.text}
                  </p>
                ))}
            </details>
          ) : null}
          {review?.priorReviews.length ? (
            <details className={styles.advanced}>
              <summary>Earlier run comparison</summary>
              {review.priorReviews.map((prior) => (
                <article key={prior.runId}>
                  <h3>Selection {prior.selectionVersion}</h3>
                  <p>
                    {prior.prepared?.evidence.length ?? 0} evidence excerpts ·{" "}
                    {prior.draftEdits.length} saved draft edits
                  </p>
                  {prior.draftEdits.map((edit) => (
                    <p key={edit.draftId}>
                      <strong>{edit.draftId}</strong> · {edit.text}
                    </p>
                  ))}
                  {prior.result?.drafts.map((draft) => (
                    <p key={draft.id}>
                      <strong>{draft.id}</strong> · {draft.text}
                    </p>
                  ))}
                </article>
              ))}
            </details>
          ) : null}
          {workspace.savedIds.length ? (
            <p className={styles.success} role="status">
              Saved {workspace.savedIds.length} achievement
              {workspace.savedIds.length === 1 ? "" : "s"}. Returned IDs:{" "}
              {workspace.savedIds.join(", ")}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );

  const layoutProps: ImportLayoutProps = {
    header:
      step === "setup" ? null : (
        <>
          <p className={styles.eyebrow}>GITHUB IMPORT</p>
          <h1>
            {review?.import.scope.name ?? "Import repository achievements"}
          </h1>
        </>
      ),
    progress: (
      <ol className={styles.progress}>
        <li aria-current={step === "setup" ? "step" : undefined}>Set up</li>
        <li aria-current={step === "analysis" ? "step" : undefined}>Analyze</li>
        <li aria-current={step === "review" ? "step" : undefined}>
          Review and save
        </li>
      </ol>
    ),
    main,
    rail: prepared ? <ImportTrustRail {...trustProps} /> : undefined,
    actions: undefined,
    state: step,
  };

  return (
    <div
      data-github-import=""
      className={styles.page}
      data-testid="github-import-workspace"
      data-step={step}
      data-stale={workspace.isStale}
    >
      <div className={styles.layoutSlot}>
        <ImportLayout {...layoutProps} />
      </div>
      <footer className={styles.footer}>
        <Link
          href={
            workspace.source === "demo" ? "/library?source=demo" : "/library"
          }
        >
          Achievement Library
        </Link>
      </footer>
    </div>
  );
}
