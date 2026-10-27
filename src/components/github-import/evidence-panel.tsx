"use client";

import { useMemo, useState } from "react";
import {
  GITHUB_IMPORT_POLICY,
  type EvidenceItem,
  type EvidencePanelProps,
  type FileCandidate,
} from "../../lib/github/contracts";
import styles from "./evidence-panel.module.css";

const CATEGORY_LABELS: Record<FileCandidate["category"], string> = {
  purpose: "Purpose",
  manifest: "Manifest",
  implementation: "Implementation",
  test: "Tests",
  report: "Reports",
  documentation: "Documentation",
  other: "Other",
};

const CATEGORY_ORDER = Object.keys(
  CATEGORY_LABELS,
) as FileCandidate["category"][];

const REASON_LABELS: Record<string, string> = {
  "selected-pr-path": "Changed in a selected pull request",
  "matches-contribution-scope": "Matches your contribution scope",
  "user-pinned": "Added by you",
  "related-helper": "Supports a selected implementation",
  "related-test": "Corroborates selected implementation",
  "secret-bearing-config-pattern": "Flagged by a secret-like path safety rule",
  purpose: "Provides project purpose context",
  manifest: "Provides declared package context",
  implementation: "Contains implementation evidence",
  test: "Provides test or regression context",
  report: "Provides measurement context",
  documentation: "Provides documentation context",
};

const CLASSIFICATION_LABELS: Record<EvidenceItem["classification"], string> = {
  observed: "Observed in source",
  documented: "Documented",
  "user-provided": "User context",
  inferred: "Inferred",
};

const LIMIT_REASON_LABELS: Record<string, string> = {
  "source-line-or-file-limit":
    "The current selection reached a file or source-line limit. Review safe candidates and narrow the scope if needed.",
  "file-limit":
    "The current selection reached its file limit. Remove a selected file or narrow the scope before adding another.",
  "line-limit":
    "The current selection reached its source-line limit. Narrow the scope before adding more evidence.",
  "character-limit":
    "The current selection reached its excerpt-size limit. Narrow the scope before adding more evidence.",
  "token-limit":
    "The current selection reached its token limit. Narrow the scope before another analysis.",
};

type EvidenceRangeGroup = {
  key: string;
  path: string;
  commitSha: string;
  pointerLabel: string;
  items: EvidenceItem[];
};

function formatCount(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatBytes(value: number) {
  if (value < 1024) return `${formatCount(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function reasonLabels(candidate: FileCandidate) {
  const labels = candidate.reasonCodes
    .map((code) => REASON_LABELS[code])
    .filter((label): label is string => Boolean(label));
  return [...new Set(labels)];
}

function pointerLabel(item: EvidenceItem) {
  if (item.pointer.kind === "lines") {
    return `Lines ${formatCount(item.pointer.startLine)}–${formatCount(item.pointer.endLine)}`;
  }
  return `Report fields: ${item.pointer.fields.join(", ")}`;
}

function pointerKey(item: EvidenceItem) {
  return item.pointer.kind === "lines"
    ? `lines:${item.pointer.startLine}:${item.pointer.endLine}`
    : `fields:${[...item.pointer.fields].sort().join("|")}`;
}

function groupEvidenceByRange(items: EvidenceItem[]): EvidenceRangeGroup[] {
  const groups = new Map<string, EvidenceRangeGroup>();
  for (const item of items) {
    const key = `${item.commitSha}\u0000${item.path}\u0000${pointerKey(item)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(key, {
        key,
        path: item.path,
        commitSha: item.commitSha,
        pointerLabel: pointerLabel(item),
        items: [item],
      });
    }
  }
  return [...groups.values()];
}

function candidateStateMessage(candidate: FileCandidate) {
  if (candidate.safety === "blocked") {
    if (candidate.reasonCodes.includes("secret-bearing-config-pattern")) {
      return "Blocked by the safety rule for secret-like configuration paths. It cannot be added to this selection.";
    }
    return "Blocked by repository safety checks. It cannot be added to this selection.";
  }
  if (candidate.safety === "needs-review") {
    return "This path needs a safety review before it can be added.";
  }
  if (!candidate.eligible) {
    return "This file is safe, but it does not fit the current selection limits. Remove a selected file or narrow the scope, then try again.";
  }
  return null;
}

function friendlyLimitReason(reason: string) {
  return (
    LIMIT_REASON_LABELS[reason] ??
    "An inspection limit was reached. Review the partial scope and narrow it before another analysis."
  );
}

function sourceTextVariants(items: EvidenceItem[]) {
  const variants = new Map<string, EvidenceItem>();
  for (const item of items) {
    const key = `${item.excerptSha256}\u0000${item.excerpt}`;
    if (!variants.has(key)) variants.set(key, item);
  }
  return [...variants.values()];
}

export function EvidencePanel({
  candidates,
  selectedIds,
  pinnedIds,
  excerpts,
  limitations,
  budget,
  onPin,
  onRemove,
  onInspect,
}: EvidencePanelProps) {
  const [query, setQuery] = useState("");
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [selectionEdited, setSelectionEdited] = useState(false);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const pinned = useMemo(() => new Set(pinnedIds), [pinnedIds]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredCandidates = candidates.filter((candidate) => {
    if (!normalizedQuery) return true;
    const text = [
      candidate.path,
      CATEGORY_LABELS[candidate.category],
      ...reasonLabels(candidate),
    ]
      .join(" ")
      .toLocaleLowerCase();
    return text.includes(normalizedQuery);
  });

  const selectedCategoryCounts = new Map<FileCandidate["category"], number>();
  const inventoryCategoryCounts = new Map<FileCandidate["category"], number>();
  for (const candidate of candidates) {
    inventoryCategoryCounts.set(
      candidate.category,
      (inventoryCategoryCounts.get(candidate.category) ?? 0) + 1,
    );
    if (selected.has(candidate.id) || pinned.has(candidate.id)) {
      selectedCategoryCounts.set(
        candidate.category,
        (selectedCategoryCounts.get(candidate.category) ?? 0) + 1,
      );
    }
  }
  const representedCategories = CATEGORY_ORDER.filter(
    (category) => (selectedCategoryCounts.get(category) ?? 0) > 0,
  ).length;
  const selectionCount = new Set([...selected, ...pinned]).size;
  const evidenceGroups = groupEvidenceByRange(excerpts);
  const activeGroups = activeFileId
    ? evidenceGroups.filter(
        (group) =>
          group.path ===
          candidates.find((candidate) => candidate.id === activeFileId)?.path,
      )
    : evidenceGroups;
  const activeCandidate = candidates.find(
    (candidate) => candidate.id === activeFileId,
  );
  const uniqueExcerptCount = evidenceGroups.reduce(
    (count, group) => count + sourceTextVariants(group.items).length,
    0,
  );
  const limitReached = budget.limitReason
    ? friendlyLimitReason(budget.limitReason)
    : null;
  const scopeNotes = [...limitations];
  if (limitReached && !scopeNotes.includes(limitReached)) {
    scopeNotes.push(limitReached);
  }

  function handleSelection(candidate: FileCandidate) {
    const isSelected = selected.has(candidate.id) || pinned.has(candidate.id);
    if (isSelected) {
      onRemove(candidate.id);
      setSelectionEdited(true);
      return;
    }

    if (candidate.safety !== "safe" || !candidate.eligible) return;
    if (
      Math.max(selected.size, budget.selectedUniqueFiles) >=
      GITHUB_IMPORT_POLICY.filesPerRequest
    ) {
      return;
    }
    onPin(candidate.id);
    setSelectionEdited(true);
  }

  function inspect(candidate: FileCandidate) {
    onInspect(candidate.id);
    setActiveFileId(candidate.id);
  }

  return (
    <section className={styles.panel} data-testid="github-evidence-panel">
      <details className={styles.disclosure}>
        <summary className={styles.disclosureSummary}>
          <span className={styles.summaryIcon} aria-hidden="true">
            <svg viewBox="0 0 20 20" focusable="false">
              <path d="M4.25 2.75h7l4.5 4.5v10H4.25z" />
              <path d="M11.25 2.75v4.5h4.5M7 11h6M7 14h6" />
            </svg>
          </span>
          <span className={styles.summaryText}>
            <span className={styles.title}>Files and evidence</span>
            <span className={styles.summaryDescription}>
              Review the selected source and add safe files when useful.
            </span>
          </span>
          <span className={styles.summaryCount}>
            {formatCount(selectionCount)} selected
          </span>
          <span className={styles.disclosureChevron} aria-hidden="true">
            <svg viewBox="0 0 20 20" focusable="false">
              <path d="m5 7.5 5 5 5-5" />
            </svg>
          </span>
        </summary>

        <div className={styles.content}>
          <div className={styles.introRow}>
            <div>
              <h2 className={styles.sectionTitle}>Selected files</h2>
              <p className={styles.helperText}>
                Add only readable files that help explain your contribution. A
                file selection change is staged for a separate analysis.
              </p>
            </div>
            <span className={styles.selectionPill} aria-live="polite">
              {formatCount(selectionCount)} selected · {representedCategories}{" "}
              {representedCategories === 1 ? "category" : "categories"}
            </span>
          </div>

          <div className={styles.scopeSummary}>
            <div>
              <strong>{formatCount(selectionCount)}</strong>
              <span>selected paths</span>
            </div>
            <div>
              <strong>{formatCount(uniqueExcerptCount)}</strong>
              <span>unique source excerpts</span>
            </div>
            <div>
              <strong>{formatCount(budget.selectedUniqueLines)}</strong>
              <span>selected source lines</span>
            </div>
          </div>

          <section
            className={styles.categorySection}
            aria-labelledby="evidence-categories-title"
          >
            <div className={styles.subsectionHeading}>
              <h3 id="evidence-categories-title">Evidence categories</h3>
              <span>Counts reflect this inventory and selection.</span>
            </div>
            {candidates.length === 0 ? (
              <p className={styles.emptyNote}>
                No files are available in this inventory yet.
              </p>
            ) : (
              <ul className={styles.categoryList}>
                {CATEGORY_ORDER.filter((category) =>
                  inventoryCategoryCounts.has(category),
                ).map((category) => (
                  <li className={styles.categoryItem} key={category}>
                    <span className={styles.categoryLabel}>
                      {CATEGORY_LABELS[category]}
                    </span>
                    <span className={styles.categoryCount}>
                      {formatCount(selectedCategoryCounts.get(category) ?? 0)}{" "}
                      selected ·{" "}
                      {formatCount(inventoryCategoryCounts.get(category) ?? 0)}{" "}
                      available
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className={styles.inventoryHeading}>
            <div>
              <h3 className={styles.subsectionTitle}>Repository inventory</h3>
              <p className={styles.helperText}>
                Blocked files stay visible with a reason. Safe files outside the
                current limits stay available to review.
              </p>
            </div>
            <label className={styles.searchLabel}>
              <span>Search files</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="Search path or category"
                aria-label="Search repository files"
              />
            </label>
          </div>

          <ul className={styles.fileList} aria-label="Repository files">
            {filteredCandidates.map((candidate) => {
              const isSelected = selected.has(candidate.id);
              const isPinned = pinned.has(candidate.id);
              const included = isSelected || isPinned;
              const atFileLimit =
                !included &&
                candidate.safety === "safe" &&
                Math.max(selected.size, budget.selectedUniqueFiles) >=
                  GITHUB_IMPORT_POLICY.filesPerRequest;
              const overLimit =
                !included &&
                candidate.safety === "safe" &&
                (!candidate.eligible || atFileLimit);
              const unavailableMessage = atFileLimit
                ? `The current bundle is at the ${GITHUB_IMPORT_POLICY.filesPerRequest}-file request limit. Remove a selected file or narrow the scope before adding this path.`
                : candidateStateMessage(candidate);
              const canRemove = included;
              const canAdd =
                !included &&
                candidate.safety === "safe" &&
                candidate.eligible &&
                !atFileLimit;
              const displayedReasons = reasonLabels(candidate);

              return (
                <li
                  className={`${styles.fileRow} ${overLimit ? styles.fileRowOverLimit : ""}`}
                  key={candidate.id}
                  data-file-id={candidate.id}
                >
                  <div className={styles.fileDetails}>
                    <div className={styles.fileBadges}>
                      <span className={styles.categoryBadge}>
                        {CATEGORY_LABELS[candidate.category]}
                      </span>
                      <span
                        className={`${styles.stateBadge} ${
                          candidate.safety === "blocked"
                            ? styles.stateBlocked
                            : candidate.safety === "needs-review"
                              ? styles.stateReview
                              : isPinned
                                ? styles.statePinned
                                : included
                                  ? styles.stateSelected
                                  : styles.stateAvailable
                        }`}
                      >
                        {candidate.safety === "blocked"
                          ? "Blocked"
                          : candidate.safety === "needs-review"
                            ? "Needs review"
                            : isPinned
                              ? "Pinned by you"
                              : included
                                ? "Selected"
                                : "Safe to review"}
                      </span>
                    </div>
                    <code className={styles.filePath}>{candidate.path}</code>
                    <div className={styles.reasonList}>
                      {displayedReasons.length > 0 ? (
                        displayedReasons.map((reason) => (
                          <span className={styles.reason} key={reason}>
                            {reason}
                          </span>
                        ))
                      ) : (
                        <span className={styles.reason}>
                          Selection reason recorded
                        </span>
                      )}
                    </div>
                    {unavailableMessage ? (
                      <p
                        className={
                          overLimit ? styles.limitMessage : styles.safetyMessage
                        }
                      >
                        {unavailableMessage}
                      </p>
                    ) : null}
                  </div>

                  <div className={styles.fileActions}>
                    <button
                      className={styles.inspectButton}
                      type="button"
                      onClick={() => inspect(candidate)}
                      aria-pressed={activeFileId === candidate.id}
                      aria-label={`Inspect source ${candidate.path}`}
                    >
                      {activeFileId === candidate.id
                        ? "Inspecting"
                        : "Inspect source"}
                    </button>
                    <button
                      className={
                        included ? styles.removeButton : styles.addButton
                      }
                      type="button"
                      onClick={() => handleSelection(candidate)}
                      disabled={!canRemove && !canAdd}
                      aria-describedby={
                        unavailableMessage
                          ? `evidence-reason-${candidate.id}`
                          : undefined
                      }
                      aria-label={
                        canRemove
                          ? `Remove ${candidate.path} from the selected files`
                          : canAdd
                            ? `Add safe file ${candidate.path}`
                            : `Cannot add ${candidate.path}`
                      }
                    >
                      {canRemove
                        ? "Remove"
                        : canAdd
                          ? "Add safe file"
                          : candidate.safety === "blocked"
                            ? "Blocked"
                            : candidate.safety === "needs-review"
                              ? "Needs review"
                              : "At current limit"}
                    </button>
                    {unavailableMessage ? (
                      <span
                        className={styles.visuallyHidden}
                        id={`evidence-reason-${candidate.id}`}
                      >
                        {unavailableMessage}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
            {filteredCandidates.length === 0 ? (
              <li className={styles.emptyNote}>
                {candidates.length === 0
                  ? "No files are available in this inventory yet."
                  : `No files match “${query.trim()}”. Try another path or category.`}
              </li>
            ) : null}
          </ul>

          {selectionEdited ? (
            <p className={styles.stagedNotice} role="status" aria-live="polite">
              Selection change staged. Existing consent and analysis may no
              longer cover this scope; review the updated selection before
              starting a new analysis.
            </p>
          ) : null}

          {activeFileId ? (
            <section
              className={styles.sourceSection}
              aria-labelledby="source-excerpts-title"
            >
              <div className={styles.sourceHeading}>
                <div>
                  <h3 id="source-excerpts-title">Source excerpts</h3>
                  <p className={styles.helperText}>
                    Read-only text from the pinned repository revision.
                  </p>
                </div>
                <button
                  className={styles.inspectButton}
                  type="button"
                  onClick={() => setActiveFileId(null)}
                >
                  Close excerpts
                </button>
              </div>
              {activeGroups.length === 0 ? (
                <p className={styles.emptyNote}>
                  No source excerpt is included for{" "}
                  {activeCandidate?.path ?? "this file"} in the current
                  selection.
                </p>
              ) : (
                <div className={styles.sourceList}>
                  {activeGroups.map((group) => {
                    const classifications = [
                      ...new Set(
                        group.items.map(
                          (item) => CLASSIFICATION_LABELS[item.classification],
                        ),
                      ),
                    ];
                    const categories = [
                      ...new Set(
                        group.items.map(
                          (item) => CATEGORY_LABELS[item.category],
                        ),
                      ),
                    ];
                    const textVariants = sourceTextVariants(group.items);
                    return (
                      <details className={styles.sourceGroup} key={group.key}>
                        <summary className={styles.sourceSummary}>
                          <span className={styles.sourcePath}>
                            {group.path}
                          </span>
                          <span className={styles.sourcePointer}>
                            {group.pointerLabel}
                          </span>
                        </summary>
                        <div className={styles.sourceMetadata}>
                          <span>Revision</span>
                          <code className={styles.revision}>
                            {group.commitSha}
                          </code>
                          <span
                            className={styles.metadataDivider}
                            aria-hidden="true"
                          >
                            ·
                          </span>
                          <span>{classifications.join(" · ")}</span>
                          <span
                            className={styles.metadataDivider}
                            aria-hidden="true"
                          >
                            ·
                          </span>
                          <span>{categories.join(" · ")}</span>
                        </div>
                        {group.items.length > 1 ? (
                          <p className={styles.duplicateNote}>
                            {formatCount(group.items.length)} evidence records
                            share this original source range; identical excerpts
                            are shown once.
                          </p>
                        ) : null}
                        {textVariants.map((item, index) => (
                          <div
                            className={styles.excerptBlock}
                            key={`${item.excerptSha256}-${index}`}
                          >
                            <span className={styles.excerptLabel}>
                              Source excerpt{" "}
                              {textVariants.length > 1 ? index + 1 : ""}
                            </span>
                            <pre
                              aria-label={`Read-only source excerpt from ${group.path}`}
                            >
                              <code>{item.excerpt}</code>
                            </pre>
                          </div>
                        ))}
                      </details>
                    );
                  })}
                </div>
              )}
            </section>
          ) : excerpts.length > 0 ? (
            <section
              className={styles.sourceSection}
              aria-labelledby="source-excerpts-title"
            >
              <div className={styles.sourceHeading}>
                <div>
                  <h3 id="source-excerpts-title">Source excerpts</h3>
                  <p className={styles.helperText}>
                    {formatCount(evidenceGroups.length)} unique source ranges
                    across {formatCount(excerpts.length)} evidence records.
                  </p>
                </div>
              </div>
              <p className={styles.emptyNote}>
                Choose Inspect source on a file to review its excerpt.
              </p>
            </section>
          ) : null}

          {scopeNotes.length > 0 ? (
            <section
              className={styles.scopeNotes}
              aria-labelledby="scope-notes-title"
            >
              <div className={styles.subsectionHeading}>
                <h3 id="scope-notes-title">Partial scope and limitations</h3>
                <span>Review these alongside the selected evidence.</span>
              </div>
              <ul>
                {scopeNotes.map((limitation, index) => (
                  <li key={`${limitation}-${index}`}>{limitation}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <details className={styles.budgetDetails}>
            <summary>Inspection and model usage</summary>
            <dl className={styles.budgetGrid}>
              <div>
                <dt>Files fetched</dt>
                <dd>{formatCount(budget.fetchedFiles)}</dd>
              </div>
              <div>
                <dt>Fetched text</dt>
                <dd>{formatBytes(budget.fetchedBytes)}</dd>
              </div>
              <div>
                <dt>Unique selected files</dt>
                <dd>{formatCount(budget.selectedUniqueFiles)}</dd>
              </div>
              <div>
                <dt>Unique selected lines</dt>
                <dd>{formatCount(budget.selectedUniqueLines)}</dd>
              </div>
              <div>
                <dt>Selected excerpt characters</dt>
                <dd>{formatCount(budget.selectedCharacters)}</dd>
              </div>
              <div>
                <dt>GitHub request attempts</dt>
                <dd>{formatCount(budget.httpAttempts)}</dd>
              </div>
              <div>
                <dt>Estimated model input</dt>
                <dd>
                  {budget.estimatedInputTokens === null
                    ? "Not available"
                    : `${formatCount(budget.estimatedInputTokens)} tokens`}
                </dd>
              </div>
              <div>
                <dt>Provider-reported model input</dt>
                <dd>
                  {budget.reportedInputTokens === null
                    ? "Not reported"
                    : `${formatCount(budget.reportedInputTokens)} tokens`}
                </dd>
              </div>
            </dl>
            {budget.transmittedLinesByRequest.length > 0 ? (
              <p className={styles.transmittedNote}>
                Transmitted source lines by request:{" "}
                {budget.transmittedLinesByRequest.map(formatCount).join(" · ")}.
                Cumulative transmitted lines:{" "}
                {formatCount(budget.cumulativeTransmittedLines)}.
              </p>
            ) : null}
          </details>
        </div>
      </details>
    </section>
  );
}
