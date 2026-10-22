"use client";

import { FolderOpen, Info, SearchX } from "lucide-react";
import { useId } from "react";

/**
 * The notice that tells a reader the demo library cannot be changed.
 *
 * The demo library is a sample, so the library never offers an edit action on
 * it. The notice says so once, near the top, instead of leaving a reader to
 * work out why the edit action is missing.
 */
export function LibraryReadOnlyNotice() {
  return (
    <p className="library-notice">
      <Info aria-hidden="true" size={15} strokeWidth={2} />
      <span>
        Demo data is read-only. Switch to <strong>My data</strong> to add or
        edit achievements.
      </span>
    </p>
  );
}

type EmptyStateProps = {
  /**
   * Which of the two empty libraries this is.
   *
   * `no-data` is a library with nothing in it. `no-matches` is a full
   * library whose contents are hidden by the current search and filters. They
   * ask for different things, so they are never the same message.
   */
  variant: "no-data" | "no-matches";
  /** The number of achievements the library holds in total. */
  totalPointCount: number;
  /** A personal library can add its first achievement. */
  onAdd?: () => void;
  /** A filtered library can drop its filters again. */
  onReset?: () => void;
};

/**
 * The empty library, told apart by what is missing.
 *
 * The message is a live region, so a reader who narrows the library down to
 * nothing is told why the list went empty rather than only seeing the count
 * change.
 */
export function LibraryEmptyState({
  variant,
  totalPointCount,
  onAdd,
  onReset,
}: EmptyStateProps) {
  const headingId = useId();
  const isNoData = variant === "no-data";

  return (
    <section className="library-state" aria-labelledby={headingId}>
      <span className="library-state-icon" aria-hidden="true">
        {isNoData ? (
          <FolderOpen size={20} strokeWidth={1.75} />
        ) : (
          <SearchX size={20} strokeWidth={1.75} />
        )}
      </span>
      <h3 id={headingId}>
        {isNoData
          ? "No achievements saved yet"
          : "No achievements match these filters"}
      </h3>
      <p className="library-state-message" role="status">
        {isNoData
          ? "This library is empty. Add an achievement to start filling it, or open the demo library to see a full one."
          : `None of the ${totalPointCount} achievements in this library match the current search and filters.`}
      </p>
      {isNoData && onAdd ? (
        <button className="primary-button" onClick={onAdd} type="button">
          Add achievement
        </button>
      ) : null}
      {!isNoData && onReset ? (
        <button
          className="text-action library-state-action"
          onClick={onReset}
          type="button"
        >
          Reset filters
        </button>
      ) : null}
    </section>
  );
}
