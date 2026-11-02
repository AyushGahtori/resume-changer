import type { ImportLayoutProps } from "../../lib/github/contracts";
import styles from "./import-layout.module.css";

function hasSlotContent(value: ImportLayoutProps["rail"] | undefined) {
  return value !== null && value !== undefined && value !== false;
}

export function ImportLayout({
  header,
  progress,
  main,
  rail,
  actions,
  state,
}: ImportLayoutProps) {
  const hasRail = hasSlotContent(rail);
  const hasActions = hasSlotContent(actions);
  const hasSupportingContent = hasRail || hasActions;

  return (
    <div
      className={styles.layout}
      data-testid="github-import-layout"
      data-state={state}
    >
      {hasSlotContent(header) ? (
        <header className={styles.header} data-slot="header">
          {header}
        </header>
      ) : null}

      <div
        className={styles.progress}
        data-slot="progress"
        role="group"
        aria-label="Import progress"
      >
        {progress}
      </div>

      <div
        className={styles.workspace}
        data-has-supporting={hasSupportingContent ? "true" : undefined}
      >
        <section
          className={styles.main}
          data-slot="main"
          aria-label="GitHub import workspace"
        >
          {main}
        </section>

        {hasSupportingContent ? (
          <aside
            className={styles.supporting}
            aria-label="Import summary and actions"
          >
            {hasRail ? (
              <div className={styles.rail} data-slot="rail">
                {rail}
              </div>
            ) : null}

            {hasActions ? (
              <div
                className={styles.actions}
                data-slot="actions"
                role="group"
                aria-label="Import actions"
              >
                {actions}
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
