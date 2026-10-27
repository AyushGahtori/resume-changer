"use client";

import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  CircleAlert,
  CircleHelp,
  CircleX,
  Code2,
  FileText,
  FlaskConical,
  GitPullRequest,
  Info,
  LoaderCircle,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { useId, type ReactNode } from "react";
import type {
  EvidenceChipProps,
  ImportButtonProps,
  ImportInfoBannerProps,
  ImportStatusPillProps,
} from "../../lib/github/contracts";
import styles from "./import-primitives.module.css";

type ImportButtonComponentProps = Omit<ImportButtonProps, "variant"> & {
  /** Destructive actions use the shared semantic error tokens. */
  variant?: NonNullable<ImportButtonProps["variant"]> | "destructive";
  /** Keeps the button's error state visible without changing its dimensions. */
  error?: boolean;
  ariaLabel?: string;
  icon?: ReactNode;
};

type EvidenceStatus = "supported" | "needs-context" | "inference";

type ImportStatusPillComponentProps = ImportStatusPillProps & {
  /** Evidence status is read-only presentation data, not an editable control. */
  evidenceStatus?: EvidenceStatus;
};

type ButtonVariant = "primary" | "secondary" | "quiet" | "destructive";
type StatusTone = "positive" | "warning" | "danger" | "accent" | "neutral";

const evidenceStatusPresentation: Record<
  EvidenceStatus,
  { tone: StatusTone; icon: typeof CheckCircle2 }
> = {
  supported: { tone: "positive", icon: CheckCircle2 },
  "needs-context": { tone: "warning", icon: CircleAlert },
  inference: { tone: "accent", icon: Sparkles },
};

function getLifecyclePresentation(state: string): {
  tone: StatusTone;
  icon: typeof CheckCircle2;
} {
  if (state === "approved" || state === "ready-to-review") {
    return { tone: "positive", icon: CheckCircle2 };
  }

  if (state === "failed" || state === "cancelled" || state === "expired") {
    return { tone: "danger", icon: CircleX };
  }

  if (state === "needs-input" || state === "partial") {
    return { tone: "warning", icon: AlertTriangle };
  }

  if (state === "preparing" || state === "queued" || state === "analyzing") {
    return { tone: "accent", icon: LoaderCircle };
  }

  if (state === "ready-to-analyze") {
    return { tone: "neutral", icon: CircleHelp };
  }

  return { tone: "neutral", icon: Info };
}

function cx(...classNames: Array<string | undefined | false>) {
  return classNames.filter(Boolean).join(" ");
}

export function ImportButton({
  label,
  disabled = false,
  busy = false,
  variant = "primary",
  onClick,
  error = false,
  ariaLabel,
  icon,
}: ImportButtonComponentProps) {
  const unavailable = disabled || busy;
  const buttonVariant: ButtonVariant = variant;
  const errorDescriptionId = useId();

  return (
    <button
      type="button"
      className={cx(styles.button, styles[buttonVariant])}
      data-github-import=""
      data-variant={buttonVariant}
      data-pending={busy ? "true" : undefined}
      data-error={error ? "true" : undefined}
      data-state={
        busy ? "pending" : disabled ? "disabled" : error ? "error" : "idle"
      }
      aria-label={ariaLabel}
      aria-busy={busy || undefined}
      aria-describedby={error ? errorDescriptionId : undefined}
      disabled={unavailable}
      onClick={() => {
        if (!unavailable) onClick?.();
      }}
    >
      <span className={styles.buttonContent}>
        <span aria-hidden="true" className={styles.buttonIcon}>
          {busy ? (
            <LoaderCircle
              className={styles.spinner}
              size={16}
              strokeWidth={2}
            />
          ) : (
            icon
          )}
        </span>
        <span>{label}</span>
        {error ? (
          <span className={styles.visuallyHidden} id={errorDescriptionId}>
            This action needs attention.
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function ImportStatusPill({
  state,
  label,
  evidenceStatus,
}: ImportStatusPillComponentProps) {
  const presentation = evidenceStatus
    ? evidenceStatusPresentation[evidenceStatus]
    : getLifecyclePresentation(state);
  const Icon = presentation.icon;

  return (
    <span
      className={styles.statusPill}
      data-github-import=""
      data-tone={presentation.tone}
      data-status={evidenceStatus ?? state}
    >
      <Icon
        aria-hidden="true"
        className={styles.statusIcon}
        size={14}
        strokeWidth={2.25}
      />
      <span>{label}</span>
    </span>
  );
}

const bannerPresentation = {
  info: { icon: Info, role: "status" as const },
  success: { icon: CheckCircle2, role: "status" as const },
  warning: { icon: AlertTriangle, role: "alert" as const },
  error: { icon: CircleAlert, role: "alert" as const },
};

export function ImportInfoBanner({
  title,
  description,
  tone = "info",
}: ImportInfoBannerProps) {
  const { icon: Icon, role } = bannerPresentation[tone];

  return (
    <aside
      className={styles.banner}
      data-github-import=""
      data-tone={tone}
      role={role}
      aria-live={role === "alert" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <Icon
        aria-hidden="true"
        className={styles.bannerIcon}
        size={20}
        strokeWidth={2}
      />
      <div className={styles.bannerCopy}>
        <p className={styles.bannerTitle}>{title}</p>
        <p className={styles.bannerDescription}>{description}</p>
      </div>
    </aside>
  );
}

function getEvidenceIcon(category: string) {
  const normalized = category.toLowerCase();

  if (normalized.includes("test")) return FlaskConical;
  if (normalized.includes("doc")) return BookOpen;
  if (normalized.includes("pull") || normalized === "pr") return GitPullRequest;
  if (normalized.includes("context") || normalized.includes("user")) {
    return UserRound;
  }
  if (normalized.includes("report")) return FileText;
  return Code2;
}

export function EvidenceChip({
  label,
  category,
  state = "included",
}: EvidenceChipProps) {
  const Icon = getEvidenceIcon(category);
  const stateLabel =
    state === "pinned" ? "Pinned" : state === "blocked" ? "Excluded" : null;
  const description = [label, category, stateLabel].filter(Boolean).join(" · ");

  return (
    <span
      className={styles.evidenceChip}
      data-github-import=""
      data-state={state}
      data-category={category}
      title={description}
    >
      <Icon
        aria-hidden="true"
        className={styles.evidenceIcon}
        size={14}
        strokeWidth={2}
      />
      <span className={styles.evidenceLabel}>{label}</span>
      {stateLabel ? (
        <span className={styles.evidenceState}>{stateLabel}</span>
      ) : null}
      {state === "blocked" ? (
        <X aria-hidden="true" className={styles.evidenceStateIcon} size={13} />
      ) : null}
    </span>
  );
}
