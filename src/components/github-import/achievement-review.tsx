"use client";

import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderGit2,
  Lightbulb,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./achievement-review.module.css";

export type AchievementSupportStatus =
  "supported" | "needs-context" | "partial" | "unsupported";

export type AchievementReviewDraft = {
  id: string;
  version: number;
  projectId: string;
  text: string;
  reviewedBaseText: string;
  claimIds: string[];
  supportStatus: AchievementSupportStatus;
  selectedForSave: boolean;
  contributionConfirmed: boolean;
  metricResultIds: string[];
  approvalEligible: boolean;
  approvalErrors: string[];
};

export type AchievementEvidence = {
  id: string;
  category: "observed" | "documented" | "user-provided";
  path: string;
  excerpt?: string;
  lineStart?: number;
  lineEnd?: number;
  sourceUrl?: string;
};

export type AchievementMetricSummary = {
  id: string;
  label: string;
  value: string;
  context?: string;
  evidenceStatus?: string;
};

export type AchievementReviewDetails = {
  evidence: AchievementEvidence[];
  userContext: string[];
  inference: string[];
  metrics: AchievementMetricSummary[];
};

export type AchievementReviewProps = {
  drafts: AchievementReviewDraft[];
  selectedIds: string[];
  contributionConfirmations: Record<string, boolean>;
  supportDetails: Record<string, string>;
  detailsByDraftId?: Record<string, AchievementReviewDetails | undefined>;
  onTextChange: (
    draftId: string,
    text: string,
    expectedVersion: number,
  ) => void;
  onSelect: (draftId: string, selected: boolean) => void;
  onConfirmContribution: (draftId: string, confirmed: boolean) => void;
  onReject: (draftId: string) => void;
  onExpandMeasurement: (draftId: string) => void;
  renderMeasurement?: (draft: AchievementReviewDraft) => ReactNode;
};

function safeGithubSourceUrl(sourceUrl?: string) {
  if (!sourceUrl) return undefined;

  try {
    const url = new URL(sourceUrl);
    if (
      url.protocol !== "https:" ||
      !["github.com", "www.github.com"].includes(url.hostname.toLowerCase())
    ) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

function supportLabel(status: AchievementSupportStatus) {
  switch (status) {
    case "supported":
      return "Supported by evidence";
    case "needs-context":
      return "Needs context";
    case "partial":
      return "Partially supported";
    case "unsupported":
      return "Insufficient evidence";
  }
}

function DraftSupport({
  status,
  reason,
}: {
  status: AchievementSupportStatus;
  reason: string;
}) {
  const Icon = status === "supported" ? CheckCircle2 : AlertCircle;

  return (
    <div className={styles.support}>
      <span className={`${styles.supportBadge} ${styles[`support_${status}`]}`}>
        <Icon aria-hidden="true" size={14} strokeWidth={2.4} />
        {supportLabel(status)}
      </span>
      {reason ? <span className={styles.supportReason}>{reason}</span> : null}
    </div>
  );
}

function EvidenceList({ evidence }: { evidence: AchievementEvidence[] }) {
  if (evidence.length === 0) {
    return (
      <p className={styles.emptyDetail}>No source excerpts are attached.</p>
    );
  }

  return (
    <ul className={styles.evidenceList}>
      {evidence.map((item) => {
        const href = safeGithubSourceUrl(item.sourceUrl);
        const lineRange =
          item.lineStart && item.lineEnd
            ? ` · lines ${item.lineStart}–${item.lineEnd}`
            : "";

        return (
          <li className={styles.evidenceItem} key={item.id}>
            <div className={styles.evidenceHeading}>
              <FileText aria-hidden="true" size={15} />
              <span className={styles.evidenceCategory}>
                {item.category === "user-provided"
                  ? "Your context"
                  : item.category === "documented"
                    ? "Documented"
                    : "Observed source"}
              </span>
              {href ? (
                <a href={href} rel="noreferrer" target="_blank">
                  {item.path}
                  {lineRange}
                </a>
              ) : (
                <code>
                  {item.path}
                  {lineRange}
                </code>
              )}
            </div>
            {item.excerpt ? (
              <blockquote className={styles.excerpt}>{item.excerpt}</blockquote>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function DetailBlock({
  title,
  children,
  kind,
}: {
  title: string;
  children: ReactNode;
  kind?: "inference";
}) {
  return (
    <section
      className={`${styles.detailBlock} ${kind === "inference" ? styles.inferenceBlock : ""}`}
    >
      <h4>
        {kind === "inference" ? (
          <Lightbulb aria-hidden="true" size={15} />
        ) : (
          <FolderGit2 aria-hidden="true" size={15} />
        )}
        {title}
      </h4>
      {children}
    </section>
  );
}

function blockedReason(
  draft: AchievementReviewDraft,
  contributionConfirmed: boolean,
  supportReason: string,
) {
  if (!draft.text.trim())
    return "Add achievement text before saving this draft.";
  if (draft.supportStatus === "unsupported") {
    return `This draft cannot be saved yet. ${supportReason || "There is not enough evidence to support it."}`;
  }
  if (!contributionConfirmed) {
    return "Confirm that you contributed to this work before saving it.";
  }
  if (!draft.approvalEligible) {
    return (
      draft.approvalErrors[0] ??
      "Review the remaining evidence details before saving this draft."
    );
  }
  return undefined;
}

/**
 * Controlled review cards for repository-backed achievement drafts.
 * Selection, contribution attestation, and evidence support stay independent.
 */
export function AchievementReview({
  drafts,
  selectedIds,
  contributionConfirmations,
  supportDetails,
  detailsByDraftId = {},
  onTextChange,
  onSelect,
  onConfirmContribution,
  onReject,
  onExpandMeasurement,
  renderMeasurement,
}: AchievementReviewProps) {
  const selectAllRef = useRef<HTMLInputElement>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [measurementIds, setMeasurementIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [localConfirmations, setLocalConfirmations] = useState<
    Record<string, { confirmed: boolean; text: string }>
  >({});
  const selected = new Set(selectedIds);
  const selectedCount = drafts.filter((draft) => selected.has(draft.id)).length;
  const allSelected = drafts.length > 0 && selectedCount === drafts.length;
  const someSelected = selectedCount > 0 && !allSelected;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  if (drafts.length === 0) {
    return (
      <section aria-label="Achievement review" className={styles.empty}>
        <FolderGit2 aria-hidden="true" size={20} />
        <p>No achievement drafts are ready to review yet.</p>
      </section>
    );
  }

  function selectAll(checked: boolean) {
    for (const draft of drafts) onSelect(draft.id, checked);
  }

  function toggleExpanded(draftId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(draftId)) next.delete(draftId);
      else next.add(draftId);
      return next;
    });
  }

  function toggleMeasurement(draftId: string) {
    const expanded = !measurementIds.has(draftId);
    setMeasurementIds((current) => {
      const next = new Set(current);
      if (expanded) next.add(draftId);
      else next.delete(draftId);
      return next;
    });
    if (expanded) onExpandMeasurement(draftId);
  }

  function isContributionConfirmed(draft: AchievementReviewDraft) {
    const local = localConfirmations[draft.id];
    if (local) return local.text === draft.text && local.confirmed;
    return contributionConfirmations[draft.id] === true;
  }

  const eligibleSelectedCount = drafts.filter((draft) => {
    const confirmed = isContributionConfirmed(draft);
    return (
      selected.has(draft.id) &&
      draft.text.trim().length > 0 &&
      confirmed &&
      draft.supportStatus !== "unsupported" &&
      draft.approvalEligible
    );
  }).length;

  return (
    <section aria-label="Achievement review" className={styles.workspace}>
      <div className={styles.selectionBar}>
        <label className={styles.selectAll}>
          <input
            checked={allSelected}
            onChange={(event) => selectAll(event.target.checked)}
            ref={selectAllRef}
            type="checkbox"
          />
          <span>Select all drafts</span>
        </label>
        <p aria-live="polite" className={styles.selectionCount} role="status">
          <strong>{selectedCount} selected</strong>
          <span aria-hidden="true">·</span>
          <span>{eligibleSelectedCount} eligible to save</span>
        </p>
      </div>

      <div className={styles.cards}>
        {drafts.map((draft, index) => {
          const isSelected = selected.has(draft.id);
          const isExpanded = expandedIds.has(draft.id);
          const measurementExpanded = measurementIds.has(draft.id);
          const confirmed = isContributionConfirmed(draft);
          const supportReason =
            supportDetails[draft.id] ?? draft.approvalErrors[0] ?? "";
          const blockedMessage = blockedReason(draft, confirmed, supportReason);
          const details = detailsByDraftId[draft.id] ?? {
            evidence: [],
            userContext: [],
            inference: [],
            metrics: [],
          };
          const sectionId = `achievement-review-${draft.id}-${index}`;

          return (
            <article
              aria-label={`Achievement draft ${index + 1}`}
              className={`${styles.card} ${isSelected ? styles.selected : ""}`}
              data-selected={isSelected ? "true" : "false"}
              key={draft.id}
            >
              <div className={styles.cardTop}>
                <label className={styles.selectDraft}>
                  <input
                    aria-label={`Select draft ${index + 1} for save`}
                    checked={isSelected}
                    onChange={(event) =>
                      onSelect(draft.id, event.target.checked)
                    }
                    type="checkbox"
                  />
                </label>
                <span aria-hidden="true" className={styles.projectIcon}>
                  <FolderGit2 size={18} strokeWidth={2} />
                </span>
                <div className={styles.draftHeading}>
                  <span className={styles.draftEyebrow}>Achievement draft</span>
                  <span className={styles.versionLabel}>
                    Version {draft.version}
                  </span>
                </div>
                <DraftSupport
                  status={draft.supportStatus}
                  reason={supportReason}
                />
              </div>

              <label className={styles.editorLabel}>
                <span className={styles.visuallyHidden}>Achievement text</span>
                <textarea
                  aria-label={`Achievement text for draft ${index + 1}`}
                  className={styles.editor}
                  onChange={(event) => {
                    const text = event.target.value;
                    setLocalConfirmations((current) => ({
                      ...current,
                      [draft.id]: { confirmed: false, text },
                    }));
                    onTextChange(draft.id, text, draft.version);
                    onConfirmContribution(draft.id, false);
                  }}
                  rows={Math.max(
                    3,
                    draft.text
                      .split("\n")
                      .reduce(
                        (count, line) =>
                          count + Math.max(1, Math.ceil(line.length / 42)),
                        0,
                      ),
                  )}
                  value={draft.text}
                />
              </label>

              <div className={styles.reviewActions}>
                <div className={styles.contribution}>
                  <p className={styles.contributionStatus}>
                    <span
                      aria-hidden="true"
                      className={
                        confirmed ? styles.confirmedDot : styles.unconfirmedDot
                      }
                    />
                    {confirmed
                      ? "You confirmed your contribution"
                      : "Your contribution is not confirmed"}
                  </p>
                  <button
                    aria-pressed={confirmed}
                    className={styles.confirmButton}
                    onClick={() => {
                      const next = !confirmed;
                      setLocalConfirmations((current) => ({
                        ...current,
                        [draft.id]: { confirmed: next, text: draft.text },
                      }));
                      onConfirmContribution(draft.id, next);
                    }}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className={confirmed ? styles.switchOn : styles.switchOff}
                    />
                    {confirmed
                      ? "Contribution confirmed"
                      : "Confirm my contribution"}
                  </button>
                </div>

                <button
                  aria-controls={`${sectionId}-details`}
                  aria-expanded={isExpanded}
                  className={styles.disclosureButton}
                  onClick={() => toggleExpanded(draft.id)}
                  type="button"
                >
                  {isExpanded
                    ? "Hide evidence and context"
                    : `Review evidence and context (${details.evidence.length})`}
                  {isExpanded ? (
                    <ChevronDown aria-hidden="true" size={16} />
                  ) : (
                    <ChevronRight aria-hidden="true" size={16} />
                  )}
                </button>
                <button
                  aria-controls={`${sectionId}-measurement`}
                  aria-expanded={measurementExpanded}
                  className={styles.measurementButton}
                  onClick={() => toggleMeasurement(draft.id)}
                  type="button"
                >
                  <Plus aria-hidden="true" size={16} />
                  {measurementExpanded
                    ? "Close measurement"
                    : "Add a measurement"}
                </button>
                <button
                  aria-label={`Reject draft ${index + 1}`}
                  className={styles.rejectButton}
                  onClick={() => onReject(draft.id)}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={15} />
                  Reject draft
                </button>
              </div>

              {isSelected && blockedMessage ? (
                <p className={styles.eligibilityNote} role="status">
                  <AlertCircle aria-hidden="true" size={15} />
                  {blockedMessage}
                </p>
              ) : null}

              {isExpanded ? (
                <div className={styles.details} id={`${sectionId}-details`}>
                  <DetailBlock
                    title={`Observed and documented evidence (${details.evidence.length})`}
                  >
                    <EvidenceList evidence={details.evidence} />
                  </DetailBlock>

                  {details.userContext.length > 0 ? (
                    <DetailBlock title="Your context">
                      <ul className={styles.textList}>
                        {details.userContext.map((item, itemIndex) => (
                          <li key={`${draft.id}-context-${itemIndex}`}>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </DetailBlock>
                  ) : null}

                  {details.inference.length > 0 ? (
                    <DetailBlock kind="inference" title="Inference to review">
                      <ul className={styles.textList}>
                        {details.inference.map((item, itemIndex) => (
                          <li key={`${draft.id}-inference-${itemIndex}`}>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </DetailBlock>
                  ) : null}

                  {details.metrics.length > 0 ? (
                    <DetailBlock title="Measurement context">
                      <ul className={styles.metricList}>
                        {details.metrics.map((metric) => (
                          <li key={metric.id}>
                            <strong>
                              {metric.label}: {metric.value}
                            </strong>
                            {metric.evidenceStatus ? (
                              <span className={styles.metricStatus}>
                                {metric.evidenceStatus}
                              </span>
                            ) : null}
                            {metric.context ? <p>{metric.context}</p> : null}
                          </li>
                        ))}
                      </ul>
                    </DetailBlock>
                  ) : null}

                  {draft.approvalErrors.length > 0 ? (
                    <DetailBlock title="Needs review before saving">
                      <ul className={styles.textList}>
                        {draft.approvalErrors.map((error, errorIndex) => (
                          <li key={`${draft.id}-error-${errorIndex}`}>
                            {error}
                          </li>
                        ))}
                      </ul>
                    </DetailBlock>
                  ) : null}
                </div>
              ) : null}

              {measurementExpanded ? (
                <div
                  className={styles.measurementSlot}
                  id={`${sectionId}-measurement`}
                >
                  {renderMeasurement?.(draft) ?? (
                    <p>
                      Measurement questions will appear here when available.
                    </p>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
