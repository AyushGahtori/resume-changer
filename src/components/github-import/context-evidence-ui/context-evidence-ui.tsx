"use client";

import { useDeferredValue, useId, useMemo, useState } from "react";
import "../import-tokens.css";
import styles from "./context-evidence-ui.module.css";
import {
  countEvidenceViews,
  countExclusionReasons,
  EVIDENCE_PAGE_SIZE,
  exclusionMessage,
  EXCLUSION_LABELS,
  filterEvidenceEntries,
  formatBytes,
  getRoleLabel,
  pageEvidenceEntries,
  selectedEntries,
} from "./model";
import type {
  ContextEvidenceUiProps,
  EvidenceAllocationRole,
  EvidenceInventoryEntry,
  EvidenceView,
} from "./types";

const VIEW_ORDER: EvidenceView[] = ["selected", "eligible", "all", "excluded"];
const ROLES: EvidenceAllocationRole[] = [
  "overview",
  "implementation",
  "verification",
];

function formatCount(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatShortHash(value: string) {
  return value.length > 20 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
}

function entryStatusLabel(entry: EvidenceInventoryEntry) {
  if (entry.state === "excluded") return EXCLUSION_LABELS[entry.exclusion.code];
  if (entry.state === "eligible") return "Eligible to add";
  return entry.stale ? "Selected · needs refresh" : "Selected in bundle";
}

function roleAllocationLabel(role: EvidenceAllocationRole) {
  return role === "overview"
    ? "Provides project and package context"
    : role === "implementation"
      ? "Shows how the feature works"
      : "Corroborates behaviour or outcomes";
}

function EvidencePreview({
  entry,
}: {
  entry: Extract<EvidenceInventoryEntry, { state: "selected" }>;
}) {
  const [open, setOpen] = useState(false);
  const preview = entry.preview;
  if (!preview) return null;

  return (
    <div className={styles.previewWrap}>
      <button
        className={styles.previewButton}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Hide excerpt" : "View selected excerpt"}
      </button>
      {open ? (
        <section
          className={styles.preview}
          aria-label={`Selected source excerpt from ${entry.path}`}
          data-testid="evidence-source-preview"
        >
          <div className={styles.previewMetadata}>
            <span>{entry.path}</span>
            <span>
              Lines {formatCount(preview.startLine)}–
              {formatCount(preview.endLine)}
            </span>
          </div>
          <dl className={styles.hashList}>
            <div>
              <dt>Commit</dt>
              <dd>
                <code title={preview.commitSha}>
                  {formatShortHash(preview.commitSha)}
                </code>
              </dd>
            </div>
            <div>
              <dt>Blob</dt>
              <dd>
                <code title={preview.blobSha}>
                  {formatShortHash(preview.blobSha)}
                </code>
              </dd>
            </div>
            <div>
              <dt>Excerpt SHA-256</dt>
              <dd>
                <code title={preview.excerptSha256}>
                  {formatShortHash(preview.excerptSha256)}
                </code>
              </dd>
            </div>
          </dl>
          <pre className={styles.excerpt}>{preview.text}</pre>
        </section>
      ) : null}
    </div>
  );
}

export function ContextEvidenceUi({
  entries,
  inventoryCount,
  inventoryStatus,
  maxSelectedFiles,
  allocations,
  missingFeatures,
  staleSelectionMessage,
  pageSize = EVIDENCE_PAGE_SIZE,
  onAdd,
  onRemove,
  onReplace,
}: ContextEvidenceUiProps) {
  const idPrefix = useId();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<EvidenceView>("selected");
  const [requestedPage, setRequestedPage] = useState(0);
  const [replacementCandidate, setReplacementCandidate] = useState<
    string | null
  >(null);
  const [replacingId, setReplacingId] = useState("");
  const deferredQuery = useDeferredValue(query);
  const viewCounts = useMemo(() => countEvidenceViews(entries), [entries]);
  const selected = useMemo(() => selectedEntries(entries), [entries]);
  const excludedReasonCounts = useMemo(
    () => countExclusionReasons(entries),
    [entries],
  );
  const matchingEntries = useMemo(
    () => filterEvidenceEntries({ entries, view, query: deferredQuery }),
    [deferredQuery, entries, view],
  );
  const page = useMemo(
    () =>
      pageEvidenceEntries({
        entries: matchingEntries,
        page: requestedPage,
        pageSize,
      }),
    [matchingEntries, pageSize, requestedPage],
  );
  const limitReached = selected.length >= maxSelectedFiles;
  const staleCount = selected.filter((entry) => entry.stale).length;
  const staleMessage =
    staleSelectionMessage ??
    (staleCount > 0
      ? `${formatCount(staleCount)} selected ${staleCount === 1 ? "file refers" : "files refer"} to an older prepared bundle. Refresh the evidence and review consent before analysis.`
      : undefined);

  const allocationByRole = new Map(
    allocations.map((allocation) => [allocation.role, allocation]),
  );

  function switchView(nextView: EvidenceView) {
    setView(nextView);
    setRequestedPage(0);
    setReplacementCandidate(null);
  }

  function confirmReplacement() {
    if (!replacementCandidate || !replacingId || !onReplace) return;
    if (!selected.some((entry) => entry.id === replacingId)) return;
    onReplace({ incomingId: replacementCandidate, replacingId });
    setReplacementCandidate(null);
    setReplacingId("");
  }

  return (
    <section
      className={styles.panel}
      data-github-import
      data-testid="github-context-evidence-ui"
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Repository evidence</p>
          <h2>Evidence bundle</h2>
          <p className={styles.headerCopy}>
            Review what is selected, what can be added, and why some files stay
            outside source inspection.
          </p>
        </div>
        <div className={styles.selectedBadge} aria-live="polite">
          <strong>{formatCount(selected.length)}</strong>
          <span>of {formatCount(maxSelectedFiles)} selected</span>
        </div>
      </header>

      {limitReached ? (
        <div
          className={styles.bundleNotice}
          role="status"
          data-testid="evidence-bundle-limit-notice"
        >
          <span className={styles.noticeMark} aria-hidden="true">
            i
          </span>
          <p>{`The current bundle has reached the ${formatCount(maxSelectedFiles)}-file limit. Remove a selected file before adding another.`}</p>
        </div>
      ) : null}

      {inventoryStatus.completeness === "partial" ? (
        <div
          className={styles.partialNotice}
          role="status"
          data-testid="evidence-partial-notice"
        >
          <strong>Inventory is partial.</strong>
          <span>
            {inventoryStatus.note ??
              "Some repository paths were not available to review."}
          </span>
        </div>
      ) : null}

      {staleMessage ? (
        <div
          className={styles.staleNotice}
          role="status"
          data-testid="evidence-stale-notice"
        >
          <strong>Selection needs review.</strong>
          <span>{staleMessage}</span>
        </div>
      ) : null}

      <div className={styles.inventorySummary} aria-label="Inventory counts">
        <div>
          <strong>{formatCount(inventoryCount)}</strong>
          <span>
            {inventoryStatus.completeness === "partial"
              ? "known inventory files"
              : "inventory files"}
          </span>
        </div>
        <div>
          <strong>{formatCount(viewCounts.eligible)}</strong>
          <span>eligible to add</span>
        </div>
        <div>
          <strong>{formatCount(viewCounts.selected)}</strong>
          <span>selected</span>
        </div>
        <div>
          <strong>{formatCount(viewCounts.excluded)}</strong>
          <span>excluded from inspection</span>
        </div>
      </div>

      <section
        className={styles.coverage}
        aria-labelledby={`${idPrefix}-coverage`}
      >
        <div className={styles.sectionHeading}>
          <div>
            <h3 id={`${idPrefix}-coverage`}>Coverage in this bundle</h3>
            <p>
              Allocation comes from the prepared bundle; it is not a quality
              score.
            </p>
          </div>
          <span className={styles.coverageTag}>Selected evidence only</span>
        </div>
        <div className={styles.allocationGrid}>
          {ROLES.map((role) => {
            const allocation = allocationByRole.get(role);
            if (!allocation) return null;
            const percent =
              allocation.targetTokens > 0
                ? Math.max(
                    0,
                    Math.min(
                      100,
                      Math.round(
                        (allocation.selectedTokens / allocation.targetTokens) *
                          100,
                      ),
                    ),
                  )
                : 0;
            return (
              <div className={styles.allocationCard} key={role}>
                <div className={styles.allocationTitle}>
                  <strong>{getRoleLabel(role)}</strong>
                  <span>
                    {formatCount(allocation.selectedFiles)}{" "}
                    {allocation.selectedFiles === 1 ? "file" : "files"}
                  </span>
                </div>
                <p>{roleAllocationLabel(role)}</p>
                <div
                  className={styles.progressTrack}
                  role="progressbar"
                  aria-label={`${getRoleLabel(role)} allocation`}
                  aria-valuemin={0}
                  aria-valuemax={Math.max(1, allocation.targetTokens)}
                  aria-valuenow={Math.min(
                    allocation.selectedTokens,
                    allocation.targetTokens,
                  )}
                  aria-valuetext={`${formatCount(allocation.selectedTokens)} of ${formatCount(allocation.targetTokens)} tokens`}
                >
                  <span style={{ width: `${percent}%` }} />
                </div>
                <small>
                  {formatCount(allocation.selectedTokens)} /{" "}
                  {formatCount(allocation.targetTokens)}
                  {" tokens"}
                </small>
              </div>
            );
          })}
        </div>
        {missingFeatures.length > 0 ? (
          <div className={styles.missingFeatures}>
            <strong>Not represented in this bundle</strong>
            <ul>
              {missingFeatures.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className={styles.coverageComplete}>
            No missing feature areas were reported for this prepared bundle.
          </p>
        )}
      </section>

      <section
        className={styles.inventory}
        aria-labelledby={`${idPrefix}-inventory`}
      >
        <div className={styles.inventoryHeading}>
          <div>
            <h3 id={`${idPrefix}-inventory`}>Repository inventory</h3>
            <p>
              Excluded files can be reviewed as metadata, but their contents
              cannot be opened here.
            </p>
          </div>
          <label className={styles.searchField}>
            <span>Search files</span>
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setRequestedPage(0);
              }}
              placeholder="Path, category, or reason"
              aria-label="Search repository evidence"
            />
          </label>
        </div>

        {excludedReasonCounts.length > 0 ? (
          <div
            className={styles.reasonSummary}
            aria-label="Exclusion reason counts"
          >
            <h4>Why files are excluded</h4>
            <ul>
              {excludedReasonCounts.map((reason) => (
                <li key={reason.code}>
                  <span>{reason.label}</span>
                  <strong>{formatCount(reason.count)}</strong>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className={styles.controlsRow}>
          <div
            className={styles.filters}
            aria-label="Filter repository evidence"
          >
            {VIEW_ORDER.map((nextView) => (
              <button
                className={
                  view === nextView ? styles.filterActive : styles.filter
                }
                type="button"
                aria-pressed={view === nextView}
                key={nextView}
                onClick={() => switchView(nextView)}
              >
                {nextView === "all"
                  ? "All files"
                  : nextView[0].toUpperCase() + nextView.slice(1)}
                <span>{formatCount(viewCounts[nextView])}</span>
              </button>
            ))}
          </div>
          <p className={styles.resultCount} aria-live="polite">
            {matchingEntries.length === 0
              ? "No matching files"
              : `Showing ${formatCount(page.start + 1)}–${formatCount(page.end)} of ${formatCount(matchingEntries.length)}`}
          </p>
        </div>

        {view === "excluded" && excludedReasonCounts.length > 0 ? (
          <p className={styles.excludedHint}>
            Excluded rows show path and screening metadata only. Source previews
            are unavailable for every exclusion reason.
          </p>
        ) : null}

        {page.entries.length > 0 ? (
          <ul
            className={styles.fileList}
            aria-label="Repository evidence files"
          >
            {page.entries.map((entry, index) => {
              const rowToken = `${idPrefix}-${page.start + index}`;
              const addHelpId = `${rowToken}-add-help`;
              const replaceOpen = replacementCandidate === entry.id;
              const canReplace =
                entry.state === "eligible" &&
                limitReached &&
                Boolean(onReplace);
              const canAdd = entry.state === "eligible" && !limitReached;
              const isSelected = entry.state === "selected";
              const disabledAddMessage = `The bundle is at its ${formatCount(maxSelectedFiles)}-file limit. Remove a selected file before adding ${entry.path}.`;

              return (
                <li
                  className={styles.fileRow}
                  data-testid="evidence-file-row"
                  data-state={entry.state}
                  key={entry.id}
                >
                  <div className={styles.fileMain}>
                    <div className={styles.fileBadges}>
                      <span className={styles.categoryBadge}>
                        {entry.category}
                      </span>
                      <span
                        className={
                          entry.state === "excluded"
                            ? styles.excludedBadge
                            : isSelected
                              ? entry.stale
                                ? styles.staleBadge
                                : styles.selectedBadgeSmall
                              : styles.eligibleBadge
                        }
                      >
                        {entryStatusLabel(entry)}
                      </span>
                    </div>
                    <code className={styles.path}>{entry.path}</code>
                    <div className={styles.rowMeta}>
                      <span>{getRoleLabel(entry.role)}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {entry.sizeBytes === null
                          ? "Size unavailable"
                          : formatBytes(entry.sizeBytes)}
                      </span>
                    </div>
                    {entry.state === "excluded" ? (
                      <p className={styles.reasonText}>
                        {exclusionMessage(entry.exclusion)}
                      </p>
                    ) : entry.selectionReasons.length > 0 ? (
                      <p className={styles.selectionReason}>
                        {entry.selectionReasons.join(" · ")}
                      </p>
                    ) : null}
                    {entry.state === "selected" && entry.staleReason ? (
                      <p className={styles.staleReason}>{entry.staleReason}</p>
                    ) : null}
                    {entry.state === "selected" ? (
                      <EvidencePreview entry={entry} />
                    ) : null}
                  </div>

                  <div className={styles.rowActions}>
                    {entry.state === "selected" ? (
                      <button
                        className={styles.removeButton}
                        type="button"
                        onClick={() => onRemove(entry.id)}
                        aria-label={`Remove ${entry.path} from selected evidence`}
                      >
                        Remove
                      </button>
                    ) : entry.state === "eligible" ? (
                      <>
                        <button
                          className={styles.addButton}
                          type="button"
                          onClick={() => onAdd(entry.id)}
                          disabled={!canAdd}
                          aria-describedby={!canAdd ? addHelpId : undefined}
                          aria-label={`Add ${entry.path} to selected evidence`}
                        >
                          Add file
                        </button>
                        {canReplace ? (
                          <button
                            className={styles.replaceButton}
                            type="button"
                            onClick={() => {
                              setReplacementCandidate(entry.id);
                              setReplacingId(selected[0]?.id ?? "");
                            }}
                            aria-expanded={replaceOpen}
                          >
                            Replace…
                          </button>
                        ) : null}
                        {!canAdd ? (
                          <span id={addHelpId} className={styles.srOnly}>
                            {disabledAddMessage}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className={styles.noSource}>Metadata only</span>
                    )}
                  </div>

                  {replaceOpen && onReplace ? (
                    <div className={styles.replacePanel}>
                      <label>
                        <span>Replace selected file</span>
                        <select
                          value={replacingId}
                          onChange={(event) =>
                            setReplacingId(event.currentTarget.value)
                          }
                          aria-label={`Choose selected file to replace with ${entry.path}`}
                        >
                          <option value="" disabled>
                            Choose a selected file
                          </option>
                          {selected.map((selectedEntry) => (
                            <option
                              key={selectedEntry.id}
                              value={selectedEntry.id}
                            >
                              {selectedEntry.path}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className={styles.replaceActions}>
                        <button
                          className={styles.addButton}
                          type="button"
                          onClick={confirmReplacement}
                          disabled={!replacingId}
                        >
                          Replace selected file
                        </button>
                        <button
                          className={styles.cancelButton}
                          type="button"
                          onClick={() => {
                            setReplacementCandidate(null);
                            setReplacingId("");
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className={styles.emptyState}>
            <strong>
              {view === "selected"
                ? "No files are selected yet"
                : query.trim()
                  ? "No files match this search"
                  : view === "eligible"
                    ? "No additional eligible files"
                    : view === "excluded"
                      ? "No excluded files in this inventory"
                      : "No repository files are available"}
            </strong>
            <p>
              {view === "selected"
                ? "Review eligible files to choose exact excerpts for preparation."
                : view === "excluded"
                  ? "The inventory may be empty or all available files may be eligible."
                  : "Try another search or review a different inventory view."}
            </p>
            {view === "selected" && viewCounts.eligible > 0 ? (
              <button
                className={styles.textButton}
                type="button"
                onClick={() => switchView("eligible")}
              >
                Review eligible files
              </button>
            ) : null}
          </div>
        )}

        {page.pageCount > 1 ? (
          <nav
            className={styles.pagination}
            aria-label="Evidence inventory pages"
          >
            <button
              type="button"
              className={styles.pageButton}
              disabled={page.page === 0}
              onClick={() =>
                setRequestedPage((current) => Math.max(0, current - 1))
              }
            >
              Previous
            </button>
            <span>
              Page {formatCount(page.page + 1)} of {formatCount(page.pageCount)}
            </span>
            <button
              type="button"
              className={styles.pageButton}
              disabled={page.page + 1 >= page.pageCount}
              onClick={() =>
                setRequestedPage((current) =>
                  Math.min(page.pageCount - 1, current + 1),
                )
              }
            >
              Next
            </button>
          </nav>
        ) : null}
      </section>
    </section>
  );
}
