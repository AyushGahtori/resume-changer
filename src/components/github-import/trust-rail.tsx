"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  GITHUB_IMPORT_POLICY,
  type BudgetSummary,
  type ImportTrustRailProps,
} from "../../lib/github/contracts";
import styles from "./trust-rail.module.css";

type IconName =
  | "shield"
  | "summary"
  | "repository"
  | "commit"
  | "file"
  | "pull-request"
  | "model"
  | "help"
  | "check"
  | "trash"
  | "back"
  | "alert"
  | "spinner";

function Icon({ name, className }: { name: IconName; className?: string }) {
  const common = {
    "aria-hidden": true as const,
    className,
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
    viewBox: "0 0 24 24",
  };

  switch (name) {
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 3 19 6v5c0 4.4-2.8 7.9-7 10-4.2-2.1-7-5.6-7-10V6l7-3Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "summary":
      return (
        <svg {...common}>
          <path d="M4 19V9h4v10H4Zm6 0V5h4v14h-4Zm6 0v-7h4v7h-4Z" />
        </svg>
      );
    case "repository":
      return (
        <svg {...common}>
          <path d="M8 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
          <path d="M8 4h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8z" />
          <path d="M8 8h13M8 12h13M8 16h13" />
        </svg>
      );
    case "commit":
      return (
        <svg {...common}>
          <path d="M3 12h5m8 0h5" />
          <circle cx="12" cy="12" r="4" />
        </svg>
      );
    case "file":
      return (
        <svg {...common}>
          <path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
          <path d="M14 3v6h5M9 13h6M9 17h6" />
        </svg>
      );
    case "pull-request":
      return (
        <svg {...common}>
          <circle cx="6" cy="5" r="2" />
          <circle cx="18" cy="19" r="2" />
          <circle cx="18" cy="5" r="2" />
          <path d="M6 7v12m12-2V9a4 4 0 0 0-4-4h-2m0 0 3-3m-3 3 3 3" />
        </svg>
      );
    case "model":
      return (
        <svg {...common}>
          <path d="m12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4L12 3Z" />
          <path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" />
        </svg>
      );
    case "help":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.7 9a2.4 2.4 0 1 1 4.5 1.2c-.7 1.1-2.2 1.3-2.2 3" />
          <path d="M12 16.8h.01" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="m5 12 4 4L19 6" />
        </svg>
      );
    case "trash":
      return (
        <svg {...common}>
          <path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3" />
        </svg>
      );
    case "back":
      return (
        <svg {...common}>
          <path d="m11 5-7 7 7 7M4 12h16" />
        </svg>
      );
    case "alert":
      return (
        <svg {...common}>
          <path d="M12 3 2.8 19h18.4L12 3Z" />
          <path d="M12 9v4m0 3h.01" />
        </svg>
      );
    case "spinner":
      return (
        <svg {...common}>
          <path d="M20 12a8 8 0 1 1-2.3-5.7" />
        </svg>
      );
  }
}

function count(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(count(value));
}

function plural(value: number, one: string, many = `${one}s`): string {
  return count(value) === 1 ? one : many;
}

function formatBytes(bytes: number): string {
  const safeBytes = count(bytes);
  if (safeBytes < 1_000) return `${formatCount(safeBytes)} bytes`;
  if (safeBytes < 1_000_000) {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(safeBytes / 1_000)} KB`;
  }
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(safeBytes / 1_000_000)} MB`;
}

function formatTokens(value: number | null): string {
  return value === null ? "Not reported" : `${formatCount(value)} tokens`;
}

function formatCost(
  estimate: number | null,
  currency: string | null,
): string | null {
  if (estimate === null || !Number.isFinite(estimate) || estimate < 0) {
    return null;
  }

  const currencyCode = currency?.trim().toUpperCase();
  if (currencyCode && /^[A-Z]{3}$/u.test(currencyCode)) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currencyCode,
        maximumFractionDigits: 6,
      }).format(estimate);
    } catch {
      // An unrecognized currency is shown as supplied below without inventing a symbol.
    }
  }

  const amount = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 6,
  }).format(estimate);
  return currencyCode
    ? `${amount} ${currencyCode}`
    : `${amount} · currency not reported`;
}

function getBudgetStatus(budget: BudgetSummary) {
  const limits = [
    [budget.fetchedFiles, GITHUB_IMPORT_POLICY.fetchedBodies],
    [budget.fetchedBytes, GITHUB_IMPORT_POLICY.totalUpstreamBytes],
    [budget.httpAttempts, GITHUB_IMPORT_POLICY.httpAttempts],
    [budget.selectedUniqueFiles, GITHUB_IMPORT_POLICY.distinctFilesPerImport],
    [budget.selectedUniqueLines, GITHUB_IMPORT_POLICY.uniqueLinesPerImport],
    [budget.selectedCharacters, GITHUB_IMPORT_POLICY.selectedCharactersTotal],
    [
      budget.cumulativeTransmittedLines,
      GITHUB_IMPORT_POLICY.transmittedLineOccurrences,
    ],
  ] as const;
  const exceeded = limits.some(([used, maximum]) => count(used) > maximum);
  const nearLimit = limits.some(
    ([used, maximum]) => maximum > 0 && count(used) / maximum >= 0.85,
  );
  const reason = budget.limitReason?.trim() ?? "";

  if (reason || exceeded) {
    return {
      label: "Partial scope",
      detail:
        reason ||
        "The server reported usage beyond a configured limit. Review the partial result before saving.",
      tone: "partial" as const,
    };
  }
  if (nearLimit) {
    return {
      label: "Near a configured limit",
      detail:
        "This run is close to one of its inspection limits. The counts below show what was used.",
      tone: "near" as const,
    };
  }
  return {
    label: "Within configured limits",
    detail:
      "The server-reported inspection counts are within the configured limits.",
    tone: "within" as const,
  };
}

function UnknownValue({ label = "Not reported" }: { label?: string }) {
  return (
    <span className={styles.unknown}>
      <Icon name="help" className={styles.inlineIcon} />
      {label}
    </span>
  );
}

function SummaryRow({
  label,
  value,
  detail,
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className={styles.summaryRow}>
      <dt>{label}</dt>
      <dd>
        <span className={valueClassName}>{value}</span>
        {detail ? <span className={styles.rowDetail}>{detail}</span> : null}
      </dd>
    </div>
  );
}

function BudgetRow({
  label,
  used,
  maximum,
}: {
  label: string;
  used: string;
  maximum: string;
}) {
  return (
    <div className={styles.budgetRow}>
      <dt>{label}</dt>
      <dd>
        <span>{used}</span>
        <span className={styles.budgetMaximum}>of {maximum}</span>
      </dd>
    </div>
  );
}

export function ImportTrustRail({
  runDetails,
  safetySummary,
  runIdentity,
  budget,
  cost,
  eligibleCount: eligibleCountInput,
  selectedCount: selectedCountInput,
  saveState,
  errors,
  onSave,
  onDiscard,
  onBack,
}: ImportTrustRailProps) {
  const eligibleCount = count(eligibleCountInput);
  const selectedCount = count(selectedCountInput);
  const countMismatch = eligibleCount > selectedCount;
  const canSave =
    eligibleCount > 0 &&
    !countMismatch &&
    saveState !== "saving" &&
    saveState !== "saved";
  const budgetStatus = getBudgetStatus(budget);
  const estimatedCost = formatCost(cost.estimate, cost.currency);
  const safeSummary = safetySummary.map((item) => item.trim()).filter(Boolean);

  const [saveRequested, setSaveRequested] = useState(false);
  const [callbackFailure, setCallbackFailure] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [discardRequested, setDiscardRequested] = useState(false);
  const [discardFailure, setDiscardFailure] = useState(false);
  const saveDispatchLocked = useRef(false);
  const discardDispatchLocked = useRef(false);
  const previousSaveState = useRef(saveState);
  const discardTriggerRef = useRef<HTMLButtonElement>(null);
  const confirmDiscardRef = useRef<HTMLButtonElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const wasConfirmingDiscard = useRef(false);

  useEffect(() => {
    if (previousSaveState.current === saveState) return;
    previousSaveState.current = saveState;

    if (saveState === "saving") {
      saveDispatchLocked.current = true;
      setSaveRequested(true);
    } else {
      saveDispatchLocked.current = false;
      setSaveRequested(false);
      setCallbackFailure(false);
    }
  }, [saveState]);

  useEffect(() => {
    if (confirmDiscard) {
      confirmDiscardRef.current?.focus();
    } else if (wasConfirmingDiscard.current) {
      if (discardRequested) backButtonRef.current?.focus();
      else discardTriggerRef.current?.focus();
    }
    wasConfirmingDiscard.current = confirmDiscard;
  }, [confirmDiscard, discardRequested]);

  function handleSave() {
    if (!canSave || saveDispatchLocked.current) return;
    saveDispatchLocked.current = true;
    setSaveRequested(true);
    setCallbackFailure(false);
    try {
      onSave();
    } catch {
      saveDispatchLocked.current = false;
      setSaveRequested(false);
      setCallbackFailure(true);
    }
  }

  async function handleDiscard() {
    if (discardDispatchLocked.current || saveState === "saving") return;
    discardDispatchLocked.current = true;
    setDiscardRequested(true);
    setDiscardFailure(false);
    setConfirmDiscard(false);
    try {
      const accepted = await onDiscard();
      if (accepted === false) throw new Error("Discard was not accepted.");
    } catch {
      discardDispatchLocked.current = false;
      setDiscardRequested(false);
      setDiscardFailure(true);
    }
  }

  let actionStatus = "Only selected, eligible drafts are sent to the library.";
  if (saveState === "saved") {
    actionStatus = `${formatCount(runDetails?.savedIds.length ?? eligibleCount)} ${plural(runDetails?.savedIds.length ?? eligibleCount, "achievement")} saved to Achievement Library.`;
  } else if (saveState === "saving" || saveRequested) {
    actionStatus = "Saving the eligible selections. Please wait.";
  } else if (saveState === "error" || callbackFailure) {
    actionStatus =
      "The save did not complete. Your selections are still available to review.";
  } else if (countMismatch) {
    actionStatus =
      "The eligibility count needs review before these drafts can be saved.";
  } else if (eligibleCount === 0 && selectedCount > 0) {
    actionStatus =
      "No selected drafts are eligible yet. Review each draft for its specific reason.";
  } else if (eligibleCount === 0) {
    actionStatus = "Select an eligible achievement before saving.";
  } else if (eligibleCount < selectedCount) {
    actionStatus =
      "Some selected drafts are not eligible yet. Review each draft for its specific reason.";
  }

  const saveLabel =
    saveState === "saved"
      ? "Saved to Achievement Library"
      : saveState === "saving" || saveRequested
        ? "Saving selected achievements…"
        : `Save selected achievements (${formatCount(eligibleCount)})`;

  return (
    <aside
      className={styles.trustRail}
      aria-label="Import privacy, run summary and save actions"
      data-testid="github-import-trust-rail"
      data-budget-state={budgetStatus.tone}
      data-save-state={saveState}
    >
      <section className={styles.panel} aria-labelledby="trust-privacy-title">
        <div className={styles.sectionHeading}>
          <span className={`${styles.iconBadge} ${styles.privacyBadge}`}>
            <Icon name="shield" className={styles.headingIcon} />
          </span>
          <div>
            <h2 id="trust-privacy-title">Privacy &amp; boundaries</h2>
            <p className={styles.sectionKicker}>What this run included</p>
          </div>
        </div>

        <ul className={styles.safetyList}>
          {safeSummary.length ? (
            safeSummary.map((item, index) => (
              <li key={`${index}-${item}`}>
                <span className={styles.safetyCheck}>
                  <Icon name="check" className={styles.inlineIcon} />
                </span>
                <span>{item}</span>
              </li>
            ))
          ) : (
            <li>
              <span className={styles.safetyCheck}>
                <Icon name="help" className={styles.inlineIcon} />
              </span>
              <span>Run-specific screening details were not reported.</span>
            </li>
          )}
        </ul>

        <p className={styles.privacyNote}>
          Screening describes the prepared analysis bundle. It does not certify
          that excluded repository content was never inspected.
        </p>
      </section>

      <section className={styles.panel} aria-labelledby="trust-summary-title">
        <div className={styles.sectionHeading}>
          <span className={`${styles.iconBadge} ${styles.summaryBadge}`}>
            <Icon name="summary" className={styles.headingIcon} />
          </span>
          <div>
            <h2 id="trust-summary-title">Run summary</h2>
            <p className={styles.sectionKicker}>Server-reported details</p>
          </div>
          <span
            className={`${styles.budgetBadge} ${styles[`budgetBadge_${budgetStatus.tone}`]}`}
            data-testid="trust-budget-status"
          >
            {budgetStatus.label}
          </span>
        </div>

        <dl className={styles.summaryList}>
          <SummaryRow
            label="Repository"
            value={
              runDetails?.repository ?? <UnknownValue label="Not included" />
            }
          />
          <SummaryRow
            label="Snapshot"
            value={
              runIdentity.revision ? (
                <code className={styles.sha}>{runIdentity.revision}</code>
              ) : (
                <UnknownValue />
              )
            }
            detail={runIdentity.revision ? "Pinned revision" : undefined}
          />
          <SummaryRow
            label="Snapshot date"
            value={
              runDetails?.inspectedAt ? (
                new Date(runDetails.inspectedAt).toLocaleString()
              ) : (
                <UnknownValue label="Not reported" />
              )
            }
          />
          <SummaryRow
            label="Files analyzed"
            value={`${formatCount(budget.selectedUniqueFiles)} ${plural(budget.selectedUniqueFiles, "file")}`}
          />
          <SummaryRow
            label="Evidence excerpts"
            value={
              runDetails?.excerpts ?? <UnknownValue label="Not reported" />
            }
            detail={`${formatCount(budget.selectedUniqueLines)} selected source ${plural(budget.selectedUniqueLines, "line")}`}
          />
          <SummaryRow
            label="Pull requests"
            value={
              runDetails?.pullRequests ?? <UnknownValue label="Not reported" />
            }
          />
          <SummaryRow
            label="AI model"
            value={runDetails?.model ?? <UnknownValue label="Not reported" />}
          />
          <SummaryRow
            label="Input usage"
            value={
              <span className={styles.usageValues}>
                <span>
                  Estimate: {formatTokens(budget.estimatedInputTokens)}
                </span>
                <span>
                  Reported: {formatTokens(budget.reportedInputTokens)}
                </span>
              </span>
            }
          />
          <SummaryRow
            label="Estimated cost"
            value={
              estimatedCost ? estimatedCost : <UnknownValue label="Unknown" />
            }
            detail={cost.uncertainty?.trim() || undefined}
            valueClassName={estimatedCost ? styles.costValue : undefined}
          />
        </dl>

        <div className={styles.runIds}>
          <span>
            Import <code>{runIdentity.importId}</code>
          </span>
          <span>
            Run{" "}
            {runIdentity.runId ? (
              <code>{runIdentity.runId}</code>
            ) : (
              <UnknownValue label="Not assigned" />
            )}
          </span>
        </div>

        <details className={styles.budgetDetails}>
          <summary>
            <span>Technical budget details</span>
            <span className={styles.detailsHint}>Optional</span>
          </summary>
          <p className={styles.budgetDetailIntro}>{budgetStatus.detail}</p>
          <dl className={styles.budgetGrid}>
            <BudgetRow
              label="Files inspected"
              used={formatCount(budget.fetchedFiles)}
              maximum={formatCount(GITHUB_IMPORT_POLICY.fetchedBodies)}
            />
            <BudgetRow
              label="Bytes fetched"
              used={formatBytes(budget.fetchedBytes)}
              maximum={formatBytes(GITHUB_IMPORT_POLICY.totalUpstreamBytes)}
            />
            <BudgetRow
              label="GitHub requests"
              used={formatCount(budget.httpAttempts)}
              maximum={formatCount(GITHUB_IMPORT_POLICY.httpAttempts)}
            />
            <BudgetRow
              label="Files selected"
              used={formatCount(budget.selectedUniqueFiles)}
              maximum={formatCount(GITHUB_IMPORT_POLICY.distinctFilesPerImport)}
            />
            <BudgetRow
              label="Unique lines selected"
              used={formatCount(budget.selectedUniqueLines)}
              maximum={formatCount(GITHUB_IMPORT_POLICY.uniqueLinesPerImport)}
            />
            <BudgetRow
              label="Characters selected"
              used={formatCount(budget.selectedCharacters)}
              maximum={formatCount(
                GITHUB_IMPORT_POLICY.selectedCharactersTotal,
              )}
            />
            <BudgetRow
              label="Lines transmitted"
              used={formatCount(budget.cumulativeTransmittedLines)}
              maximum={formatCount(
                GITHUB_IMPORT_POLICY.transmittedLineOccurrences,
              )}
            />
            <BudgetRow
              label="Estimated input tokens"
              used={formatTokens(budget.estimatedInputTokens)}
              maximum={formatCount(GITHUB_IMPORT_POLICY.inputTokensPerImport)}
            />
            <BudgetRow
              label="Reported input tokens"
              used={formatTokens(budget.reportedInputTokens)}
              maximum="—"
            />
          </dl>
          {budget.transmittedLinesByRequest.length ? (
            <p className={styles.requestBreakdown}>
              Lines by request:{" "}
              {budget.transmittedLinesByRequest.map(formatCount).join(" · ")}
            </p>
          ) : null}
          {budgetStatus.tone === "partial" ? (
            <p className={styles.limitReason}>
              <Icon name="alert" className={styles.inlineIcon} />
              {budgetStatus.detail}
            </p>
          ) : null}
        </details>
      </section>

      <section
        className={styles.actionsPanel}
        aria-labelledby="trust-actions-title"
      >
        <div className={styles.actionSummary}>
          <h2 id="trust-actions-title">Review before saving</h2>
          <p>
            <strong>{formatCount(selectedCount)}</strong> selected
            <span aria-hidden="true"> · </span>
            <strong>{formatCount(eligibleCount)}</strong> eligible
          </p>
          {eligibleCount < selectedCount || countMismatch ? (
            <p className={styles.eligibilityNote}>
              Review each draft for its specific eligibility reason.
            </p>
          ) : null}
          <p
            className={styles.actionStatus}
            aria-live="polite"
            data-testid="trust-save-status"
          >
            {actionStatus}
          </p>
        </div>

        {saveState === "error" || callbackFailure ? (
          <div className={styles.errorNotice} role="alert">
            <Icon name="alert" className={styles.inlineIcon} />
            <div>
              <strong>Your selection is still available.</strong>
              <ul>
                {errors.length ? (
                  errors.map((error, index) => (
                    <li key={`${error.code}-${index}`}>{error.message}</li>
                  ))
                ) : (
                  <li>
                    {callbackFailure
                      ? "The save action could not be started. Try again when ready."
                      : "The save could not be completed. Try again when ready."}
                  </li>
                )}
              </ul>
            </div>
          </div>
        ) : null}

        {saveState !== "error" && errors.length ? (
          <div className={styles.limitNotice} role="status">
            <Icon name="alert" className={styles.inlineIcon} />
            <div>
              <strong>Run needs review</strong>
              <ul>
                {errors.map((error, index) => (
                  <li key={`${error.code}-${index}`}>{error.message}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        <div
          className={styles.actionButtons}
          data-testid="trust-action-buttons"
        >
          <button
            className={styles.saveButton}
            type="button"
            onClick={handleSave}
            disabled={!canSave || saveRequested}
            aria-describedby="trust-save-status"
            data-testid="trust-save"
          >
            <Icon
              name={
                saveState === "saved"
                  ? "check"
                  : saveRequested || saveState === "saving"
                    ? "spinner"
                    : "check"
              }
              className={
                saveRequested || saveState === "saving"
                  ? `${styles.buttonIcon} ${styles.spinner}`
                  : styles.buttonIcon
              }
            />
            <span>{saveLabel}</span>
          </button>

          {confirmDiscard ? (
            <div className={styles.discardConfirm}>
              <p id="trust-discard-confirmation">
                Discard the staged drafts from this import? Any achievements
                already saved stay in your Achievement Library.
              </p>
              <div className={styles.confirmButtons}>
                <button
                  type="button"
                  className={styles.keepButton}
                  onClick={() => setConfirmDiscard(false)}
                >
                  Keep drafts
                </button>
                <button
                  type="button"
                  className={styles.confirmDiscardButton}
                  onClick={handleDiscard}
                  disabled={saveState === "saving" || saveRequested}
                  aria-describedby="trust-discard-confirmation"
                  ref={confirmDiscardRef}
                  data-testid="trust-confirm-discard"
                >
                  <Icon name="trash" className={styles.buttonIcon} />
                  Discard staged drafts
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={styles.discardButton}
              onClick={() => {
                setDiscardFailure(false);
                setConfirmDiscard(true);
              }}
              disabled={
                saveState === "saving" || saveRequested || discardRequested
              }
              ref={discardTriggerRef}
              data-testid="trust-discard"
            >
              <Icon name="trash" className={styles.buttonIcon} />
              <span>
                {discardRequested
                  ? "Discard request sent"
                  : "Discard staged drafts"}
              </span>
            </button>
          )}

          {discardFailure ? (
            <p className={styles.discardFailure} role="alert">
              The discard action could not be started. Your saved achievements
              are unchanged.
            </p>
          ) : null}
          {discardRequested ? (
            <p className={styles.actionStatus} aria-live="polite">
              Discard request sent for staged drafts. Saved achievements are not
              affected.
            </p>
          ) : null}

          <button
            type="button"
            className={styles.backButton}
            onClick={onBack}
            data-testid="trust-back"
            ref={backButtonRef}
          >
            <Icon name="back" className={styles.buttonIcon} />
            <span>Back to Achievement Library</span>
          </button>
        </div>
      </section>
    </aside>
  );
}
