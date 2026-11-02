"use client";

import React, { useId } from "react";
import {
  deriveRunStatus,
  type RunStatusInput,
  type RunStatusView,
} from "../../../lib/github/context-run-status/status";
import styles from "./run-status.module.css";

function StatusContent({
  status,
  headingId,
  compact,
}: {
  status: RunStatusView;
  headingId: string;
  compact: boolean;
}) {
  return (
    <div
      className={compact ? styles.compactContent : styles.content}
      data-tone={status.tone}
    >
      <span className={styles.marker} aria-hidden="true" />
      <div className={styles.copy}>
        <h2 id={headingId}>{status.title}</h2>
        <p>{status.summary}</p>
        {(status.categoryLabel || status.stageLabel) && (
          <dl className={styles.metadata}>
            {status.categoryLabel && (
              <div>
                <dt>Failure category</dt>
                <dd>{status.categoryLabel}</dd>
              </div>
            )}
            {status.stageLabel && (
              <div>
                <dt>Last recorded step</dt>
                <dd>{status.stageLabel}</dd>
              </div>
            )}
          </dl>
        )}
        {status.outcomeUnknown && (
          <p className={styles.noRetry}>
            No automatic paid retry will run. Check the current run before
            approving another analysis.
          </p>
        )}
      </div>
    </div>
  );
}

export function RunStatusPanel({ snapshot }: { snapshot: RunStatusInput }) {
  const headingId = useId();
  const status = deriveRunStatus(snapshot);

  return (
    <section
      className={styles.panel}
      data-phase={status.phase}
      aria-labelledby={headingId}
      aria-live="polite"
      aria-atomic="true"
    >
      <StatusContent status={status} headingId={headingId} compact={false} />
    </section>
  );
}

export function RunStatusSidebar({ snapshot }: { snapshot: RunStatusInput }) {
  const headingId = useId();
  const status = deriveRunStatus(snapshot);

  return (
    <aside
      className={styles.sidebar}
      data-phase={status.phase}
      aria-labelledby={headingId}
      aria-live="polite"
      aria-atomic="true"
    >
      <StatusContent status={status} headingId={headingId} compact />
    </aside>
  );
}
