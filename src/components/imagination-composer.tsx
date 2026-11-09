"use client";

import { Info, Pencil, Sparkles, X } from "lucide-react";
import * as React from "react";
import type { ResumeLibrary } from "@/lib/schemas/resume-data";
import { studioGroups } from "@/lib/generation/studio-document";
import type { ImaginationDraft } from "@/lib/generation/imagination-draft";
import LibrarySelect from "@/components/library/library-select";
import styles from "./imagination-composer.module.css";

export const MAX_ACHIEVEMENT_TEXT_LENGTH = 8_000;

export type ImaginationCreateNotice = "library" | "resume" | "both" | null;

export type ImaginationComposerProps = {
  part?: "all" | "intro" | "editor";
  composerRef?: React.RefObject<HTMLTextAreaElement | null>;
  library: ResumeLibrary;
  destinationGroupId: string;
  connectedAchievementIds: string[];
  onDestinationChange: (
    destinationGroupId: string,
    compatibleAchievementIds: string[],
  ) => void;
  value: string;
  onTextChange: (value: string) => void;
  createNotice: ImaginationCreateNotice;
  onDismissNotice?: () => void;
  restoreDraft: ImaginationDraft | null;
  onRestoreDraft: (draft: ImaginationDraft) => void;
  onDismissRestoreDraft: () => void;
  disconnectedCount?: number;
  onUndoDestination?: () => void;
  restoreConfirming?: boolean;
};

const CREATE_NOTICE_COPY: Record<
  Exclude<ImaginationCreateNotice, null>,
  string
> = {
  library:
    "This creates a new achievement and saves to your Achievement Library. It does not update your PDF yet.",
  resume:
    "This adds the reviewed achievement to your resume draft. Your PDF updates only after you Apply changes.",
  both: "This saves the new achievement to your Achievement Library and adds it to your resume draft. Your PDF updates only after you Apply changes.",
};

export function disconnectedAchievementNotice(count: number): string | null {
  if (count < 1) return null;
  if (count === 1)
    return "1 connected achievement was disconnected because it belongs to another job or project.";
  return (
    count +
    " connected achievements were disconnected because they belong to another job or project."
  );
}

export function reconcileDestinationAchievementIds(
  library: ResumeLibrary,
  destinationGroupId: string,
  selectedAchievementIds: string[],
): string[] {
  const destination = [...library.jobs, ...library.projects].find(
    (group) => group.id === destinationGroupId,
  );
  if (!destination) return [];

  const availableIds = new Set(
    destination.points
      .filter((point) => point.enabled)
      .map((point) => point.id),
  );
  return [...new Set(selectedAchievementIds)].filter((id) =>
    availableIds.has(id),
  );
}

export default function ImaginationComposer({
  part = "all",
  composerRef,
  library,
  destinationGroupId,
  connectedAchievementIds,
  onDestinationChange,
  value,
  onTextChange,
  createNotice,
  onDismissNotice,
  restoreDraft,
  onRestoreDraft,
  onDismissRestoreDraft,
  disconnectedCount = 0,
  onUndoDestination,
  restoreConfirming = false,
}: ImaginationComposerProps) {
  const destinations = studioGroups(library);
  const selectedDestinationId = destinations.some(
    (destination) => destination.id === destinationGroupId,
  )
    ? destinationGroupId
    : "";
  const noticeCopy = createNotice ? CREATE_NOTICE_COPY[createNotice] : null;
  const disconnectCopy = disconnectedAchievementNotice(disconnectedCount);

  function handleDestinationChange(nextDestinationId: string) {
    if (
      !destinations.some((destination) => destination.id === nextDestinationId)
    )
      return;

    onDestinationChange(
      nextDestinationId,
      reconcileDestinationAchievementIds(
        library,
        nextDestinationId,
        connectedAchievementIds,
      ),
    );
  }

  return (
    <section
      className={styles.root + (part === "intro" ? " " + styles.intro : "")}
      aria-labelledby={
        part === "editor"
          ? "imagination-editor-label"
          : "imagination-canvas-title"
      }
    >
      {part !== "editor" && (
        <>
          <header className={styles.header}>
            <div className={styles.titleRow}>
              <Sparkles
                className={styles.titleIcon}
                aria-hidden="true"
                focusable="false"
                size={24}
                strokeWidth={2.2}
              />
              <h1 className={styles.title} id="imagination-canvas-title">
                Imagination Canvas
              </h1>
            </div>
            <p className={styles.subtitle}>
              Turn rough notes and connected evidence into a factual achievement
              statement.
            </p>
          </header>

          {noticeCopy && (
            <aside
              className={styles.notice}
              aria-label="Create mode information"
            >
              {onDismissNotice && (
                <button
                  type="button"
                  className={styles.dismissNotice}
                  onClick={onDismissNotice}
                  aria-label="Dismiss create mode information"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              )}
              <Info
                className={styles.noticeIcon}
                aria-hidden="true"
                focusable="false"
                size={18}
              />
              <div>
                <h2 className={styles.noticeTitle}>Create mode</h2>
                <p className={styles.noticeText}>{noticeCopy}</p>
              </div>
            </aside>
          )}

          <div className={styles.destination}>
            <label
              className={styles.destinationLabel}
              htmlFor="imagination-resume-destination"
            >
              Resume destination
            </label>
            <LibrarySelect
              aria-label="Resume destination"
              className={styles.destinationSelect}
              id="imagination-resume-destination"
              disabled={destinations.length === 0}
              onChange={handleDestinationChange}
              options={
                  destinations.length === 0
                  ? [
                      {
                        value: "",
                        label: "A job or project is required.",
                      },
                    ]
                  : destinations.map((destination) => {
                      const subtitle = destination.subtitle.trim();
                      return {
                        value: destination.id,
                        label: subtitle
                          ? destination.title + " · " + subtitle
                          : destination.title,
                      };
                    })
              }
              value={selectedDestinationId}
            />
            {disconnectCopy && (
              <p className={styles.disconnect} role="status">
                <span>{disconnectCopy}</span>
                {onUndoDestination && (
                  <button
                    className={styles.undo}
                    type="button"
                    onClick={onUndoDestination}
                  >
                    Undo
                  </button>
                )}
              </p>
            )}
          </div>

          {restoreDraft && (
            <section
              className={styles.restore}
              aria-label="Saved unfinished achievement draft"
            >
              <p className={styles.restoreMessage} role="status">
                You left this achievement before saving it. Restore that
                version, or clear it and start again.
              </p>
              <div className={styles.restoreActions}>
                <button
                  className={styles.restoreButton}
                  type="button"
                  onClick={() => onRestoreDraft(restoreDraft)}
                >
                  {restoreConfirming
                    ? "Replace what you typed"
                    : "Restore writing draft"}
                </button>
                <button
                  className={styles.discardButton}
                  type="button"
                  onClick={onDismissRestoreDraft}
                >
                  Start a new achievement
                </button>
              </div>
            </section>
          )}
        </>
      )}
      {part !== "intro" && (
        <section
          className={styles.editor}
          aria-labelledby="imagination-editor-label"
        >
          <div className={styles.editorTopline}>
            <label
              className={styles.editorLabel}
              id="imagination-editor-label"
              htmlFor="imagination-achievement-text"
            >
              <Pencil
                className={styles.editorIcon}
                aria-hidden="true"
                focusable="false"
                size={17}
                strokeWidth={2}
              />
              New achievement
            </label>
          </div>
          <textarea
            className={styles.textarea}
            id="imagination-achievement-text"
            ref={(element) => {
              if (composerRef) composerRef.current = element;
            }}
            rows={4}
            maxLength={MAX_ACHIEVEMENT_TEXT_LENGTH}
            placeholder="Write what you built, improved, or accomplished…"
            value={value}
            onChange={(event) => onTextChange(event.currentTarget.value)}
          />
        </section>
      )}
    </section>
  );
}
