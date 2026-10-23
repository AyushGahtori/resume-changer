"use client";

import { Info, Pencil, Sparkles } from "lucide-react";
import * as React from "react";
import type { ChangeEvent } from "react";
import type { ResumeLibrary } from "@/lib/schemas/resume-data";
import { studioGroups } from "@/lib/generation/studio-document";
import type { ImaginationDraft } from "@/lib/generation/imagination-draft";
import styles from "./imagination-composer.module.css";

export const MAX_ACHIEVEMENT_TEXT_LENGTH = 8_000;

export type ImaginationCreateNotice = "library" | "resume" | "both" | null;

export type ImaginationComposerProps = {
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
  restoreDraft: ImaginationDraft | null;
  onRestoreDraft: (draft: ImaginationDraft) => void;
  onDismissRestoreDraft: () => void;
};

const CREATE_NOTICE_COPY: Record<
  Exclude<ImaginationCreateNotice, null>,
  string
> = {
  library:
    "This creates a new achievement and saves to your Achievement Library. It does not update your PDF yet. Your PDF updates only after you Apply changes.",
  resume:
    "This adds the reviewed achievement to your resume draft. Your PDF updates only after you Apply changes.",
  both: "This saves the new achievement to your Achievement Library and adds it to your resume draft. Your PDF updates only after you Apply changes.",
};

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
  library,
  destinationGroupId,
  connectedAchievementIds,
  onDestinationChange,
  value,
  onTextChange,
  createNotice,
  restoreDraft,
  onRestoreDraft,
  onDismissRestoreDraft,
}: ImaginationComposerProps) {
  let composerElement: HTMLTextAreaElement | null = null;
  const destinations = studioGroups(library);
  const selectedDestinationId = destinations.some(
    (destination) => destination.id === destinationGroupId,
  )
    ? destinationGroupId
    : "";
  const noticeCopy = createNotice ? CREATE_NOTICE_COPY[createNotice] : null;

  function handleDestinationChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextDestinationId = event.currentTarget.value;
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
    <section className={styles.root} aria-labelledby="imagination-canvas-title">
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <Sparkles
            className={styles.titleIcon}
            aria-hidden="true"
            focusable="false"
            size={28}
            strokeWidth={2.1}
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
        <aside className={styles.notice} aria-label="Create mode information">
          <Info
            className={styles.noticeIcon}
            aria-hidden="true"
            focusable="false"
            size={20}
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
        <select
          className={styles.destinationSelect}
          id="imagination-resume-destination"
          value={selectedDestinationId}
          onChange={handleDestinationChange}
          disabled={destinations.length === 0}
        >
          {selectedDestinationId === "" && (
            <option value="" disabled>
              {destinations.length === 0
                ? "No resume destinations available"
                : "Select a resume destination"}
            </option>
          )}
          {destinations.map((destination) => {
            const subtitle = destination.subtitle.trim();
            return (
              <option key={destination.id} value={destination.id}>
                {subtitle
                  ? destination.title + " · " + subtitle
                  : destination.title}
              </option>
            );
          })}
        </select>
      </div>

      {restoreDraft && (
        <section
          className={styles.restore}
          aria-label="Saved unfinished achievement draft"
        >
          <p className={styles.restoreMessage} role="status">
            An unfinished writing draft is saved on this device.
          </p>
          <div className={styles.restoreActions}>
            <button
              className={styles.restoreButton}
              type="button"
              onClick={() => onRestoreDraft(restoreDraft)}
            >
              Restore writing draft
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
          <button
            className={styles.startButton}
            type="button"
            aria-controls="imagination-achievement-text"
            onClick={() => composerElement?.focus()}
          >
            <Sparkles aria-hidden="true" focusable="false" size={15} />
            Start with a draft
          </button>
        </div>
        <textarea
          className={styles.textarea}
          id="imagination-achievement-text"
          ref={(element) => {
            composerElement = element;
          }}
          rows={4}
          maxLength={MAX_ACHIEVEMENT_TEXT_LENGTH}
          placeholder="Write what you built, improved, or accomplished…"
          value={value}
          onChange={(event) => onTextChange(event.currentTarget.value)}
        />
      </section>
    </section>
  );
}
