"use client";

import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CircleCheck,
  Clock3,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import type { ImportNotificationsProps } from "@/lib/github/contracts";
import type {
  ImportNotificationItem,
  ImportProgressItem,
  ImportStatusLoadState,
} from "./import-status-provider";
import styles from "./import-notifications.module.css";

type Props = Omit<ImportNotificationsProps, "items"> & {
  items: ImportNotificationItem[];
  runningImports?: ImportProgressItem[];
  projectNames?: Readonly<Record<string, string>>;
  loadState?: ImportStatusLoadState;
  errorMessage?: string | null;
  actionError?: string | null;
  onRetry?: () => void;
};

function projectName(
  projectId: string,
  names?: Readonly<Record<string, string>>,
) {
  return names?.[projectId]?.trim() || "Project";
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function itemTitle(type: ImportNotificationItem["type"]) {
  switch (type) {
    case "ready":
      return "Project analysis finished — review achievements";
    case "needs-input":
      return "More information needed to continue";
    case "failed":
      return "Project analysis needs attention";
    case "expired":
      return "The review window has expired";
  }
}

function itemDescription(type: ImportNotificationItem["type"]) {
  switch (type) {
    case "ready":
      return "Draft achievements are ready for your review. They have not been saved.";
    case "needs-input":
      return "This import needs more information before it can continue.";
    case "failed":
      return "The analysis did not finish. Review the import to retry or adjust its scope.";
    case "expired":
      return "The staged result expired. Restart the import to inspect the current repository state.";
  }
}

function actionLabel(type: ImportNotificationItem["type"]) {
  switch (type) {
    case "ready":
      return "Review";
    case "needs-input":
      return "Resume import";
    case "failed":
      return "Review and retry";
    case "expired":
      return "Start again";
  }
}

function actionHref(item: ImportNotificationItem) {
  if (item.type === "expired") {
    return `/library/github/new?projectId=${encodeURIComponent(item.projectId)}&restart=1`;
  }
  if (
    item.destination &&
    /^\/library\/github\/[a-z0-9-]+$/.test(item.destination)
  ) {
    return item.destination;
  }
  return `/library/github/${encodeURIComponent(item.importId)}`;
}

function runningTitle(lifecycle: ImportProgressItem["lifecycle"]) {
  if (lifecycle === "queued") return "Waiting for project analysis";
  if (lifecycle === "preparing") return "Preparing project evidence";
  return "Project analysis in progress";
}

export function ImportNotifications({
  items,
  unreadCount,
  runningImports = [],
  projectNames,
  loadState = "ready",
  errorMessage,
  actionError,
  onRead,
  onDismiss,
  onReview,
  onRetry,
}: Props) {
  const visibleItems = items.filter((item) => item.dismissedAt === null);
  const hasActivity = visibleItems.length > 0 || runningImports.length > 0;

  return (
    <section
      aria-label="GitHub project imports"
      className={styles.root}
      data-testid="github-import-notifications"
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>PROJECT ACTIVITY</p>
          <h2 className={styles.heading}>GitHub imports</h2>
        </div>
        {unreadCount > 0 ? (
          <span className={styles.unreadCount}>{unreadCount} unread</span>
        ) : null}
      </header>

      {errorMessage || loadState === "error" ? (
        <div className={styles.loadError} role="alert">
          <AlertCircle aria-hidden="true" size={18} />
          <p>{errorMessage ?? "We could not load GitHub import activity."}</p>
          {onRetry ? (
            <button
              className={styles.retryButton}
              onClick={onRetry}
              type="button"
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : null}

      {loadState === "unavailable" && !hasActivity ? (
        <p className={styles.notice} role="status">
          GitHub import activity is unavailable right now.
        </p>
      ) : null}

      {loadState === "loading" && !hasActivity ? (
        <p className={styles.notice} role="status">
          Checking for project imports…
        </p>
      ) : null}

      {actionError ? (
        <p className={styles.actionError} role="alert">
          {actionError}
        </p>
      ) : null}

      {runningImports.map((item) => (
        <article
          className={`${styles.item} ${styles.runningItem}`}
          data-import-id={item.importId}
          key={`running:${item.importId}`}
        >
          <span className={`${styles.icon} ${styles.iconRunning}`}>
            <LoaderCircle
              aria-hidden="true"
              className={styles.spin}
              size={19}
            />
          </span>
          <div className={styles.itemBody}>
            <h3>{runningTitle(item.lifecycle)}</h3>
            <p className={styles.itemMeta}>
              <span>{projectName(item.projectId, projectNames)}</span>
              <time dateTime={item.updatedAt}>
                {formatTimestamp(item.updatedAt)}
              </time>
            </p>
            <p className={styles.itemDescription}>
              You can keep working. We’ll leave the review here when it’s ready.
            </p>
            <Link
              className={styles.actionLink}
              href={`/library/github/${encodeURIComponent(item.importId)}`}
            >
              View progress <ArrowRight aria-hidden="true" size={16} />
            </Link>
          </div>
        </article>
      ))}

      {visibleItems.map((item) => {
        const isUnread = item.readAt === null;
        const Icon =
          item.type === "ready"
            ? CircleCheck
            : item.type === "expired"
              ? Clock3
              : AlertCircle;

        return (
          <article
            className={`${styles.item} ${isUnread ? styles.unreadItem : ""}`}
            data-notification-id={item.id}
            data-unread={isUnread ? "true" : "false"}
            key={item.id}
          >
            <span
              className={`${styles.icon} ${item.type === "ready" ? styles.iconReady : item.type === "expired" ? styles.iconExpired : styles.iconAttention}`}
            >
              <Icon aria-hidden="true" size={19} />
            </span>
            <div className={styles.itemBody}>
              <div className={styles.itemTitleRow}>
                <h3>{itemTitle(item.type)}</h3>
                {isUnread ? (
                  <span className={styles.unreadLabel}>Unread</span>
                ) : null}
              </div>
              <p className={styles.itemMeta}>
                <span>{projectName(item.projectId, projectNames)}</span>
                <time dateTime={item.createdAt}>
                  {formatTimestamp(item.createdAt)}
                </time>
              </p>
              <p className={styles.itemDescription}>
                {itemDescription(item.type)}
              </p>
              <div className={styles.actions}>
                <Link
                  className={styles.actionLink}
                  href={actionHref(item)}
                  onClick={() => onReview(item.id)}
                >
                  {item.type === "expired" ? (
                    <RotateCcw aria-hidden="true" size={15} />
                  ) : null}
                  {actionLabel(item.type)}
                  <ArrowRight aria-hidden="true" size={16} />
                </Link>
                {isUnread ? (
                  <button
                    className={styles.quietButton}
                    onClick={() => onRead(item.id)}
                    type="button"
                  >
                    Mark as read
                  </button>
                ) : (
                  <span className={styles.readLabel}>
                    <Check aria-hidden="true" size={15} /> Read
                  </span>
                )}
                {onDismiss ? (
                  <button
                    className={styles.quietButton}
                    onClick={() => onDismiss(item.id)}
                    type="button"
                  >
                    Dismiss
                  </button>
                ) : null}
              </div>
            </div>
          </article>
        );
      })}

      {loadState === "ready" && !hasActivity ? (
        <p className={styles.emptyState}>
          No GitHub imports yet. Attach a repository to an existing project to
          get started.
        </p>
      ) : null}
    </section>
  );
}

export default ImportNotifications;
