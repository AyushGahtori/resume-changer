"use client";

import { FolderOpen, Info, SearchX } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

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
  /**
   * An empty personal library with no job or project must name that parent
   * before an achievement can belong to it.
   */
  needsParent?: boolean;
  onCreateParent?: (kind: "job" | "project", name: string) => Promise<void>;
  /** A filtered library can drop its filters again. */
  onReset?: () => void;
};

function FirstParentForm({
  onCreateParent,
}: {
  onCreateParent: (kind: "job" | "project", name: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<"job" | "project">("project");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError("");
    try {
      await onCreateParent(kind, trimmed);
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : "Could not reach the local save service. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="library-first-parent"
      id="library-first-parent"
      onSubmit={submit}
    >
      <div className="editor-field">
        <span id="library-first-parent-kind">Job or project</span>
        <div
          aria-labelledby="library-first-parent-kind"
          className="library-edit-actions"
          role="group"
        >
          <button
            aria-pressed={kind === "job"}
            className="ui-button ui-button--secondary"
            onClick={() => setKind("job")}
            type="button"
          >
            Job
          </button>
          <button
            aria-pressed={kind === "project"}
            className="ui-button ui-button--secondary"
            onClick={() => setKind("project")}
            type="button"
          >
            Project
          </button>
        </div>
      </div>
      <label className="editor-field">
        <span>{kind === "job" ? "Job title" : "Project name"}</span>
        <input
          id="library-first-parent-name"
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          required
          value={name}
        />
      </label>
      {error ? (
        <p className="editor-error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        className="primary-button library-state-action"
        disabled={saving || name.trim().length === 0}
        type="submit"
      >
        {saving ? "Saving…" : kind === "job" ? "Add job" : "Add project"}
      </button>
    </form>
  );
}

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
  needsParent = false,
  onCreateParent,
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
          ? needsParent
            ? "This library has no job or project yet. Name one so the first achievement has a place to belong, or open the demo library to see a full one."
            : "This library is empty. Add an achievement to start filling it, or open the demo library to see a full one."
          : `None of the ${totalPointCount} achievements in this library match the current search and filters.`}
      </p>
      {isNoData && needsParent && onCreateParent ? (
        <FirstParentForm onCreateParent={onCreateParent} />
      ) : null}
      {isNoData && !needsParent && onAdd ? (
        <button
          className="primary-button library-state-action"
          onClick={onAdd}
          type="button"
        >
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
