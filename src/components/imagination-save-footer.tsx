"use client";

import * as React from "react";
import { Save } from "lucide-react";
import type { AchievementWritingOperation } from "@/lib/ai/achievement-writing";
import type { ResumeDataSource } from "@/lib/data/loaders";
import {
  getImaginationSaveDestinations,
  type ImaginationSaveDestination,
} from "@/lib/generation/imagination-save";
import styles from "./imagination-save-footer.module.css";

type Props = {
  operation: AchievementWritingOperation;
  source: ResumeDataSource;
  allowResume: boolean;
  hasLibraryDestination: boolean;
  saveTo: ImaginationSaveDestination | null;
  canSave: boolean;
  isBusy: boolean;
  isSaving: boolean;
  error?: string;
  reviewStatus?: string;
  onSaveToChange: (destination: ImaginationSaveDestination) => void;
  onCancel: () => void;
  onSave: () => void;
};

const destinationLabels: Record<ImaginationSaveDestination, string> = {
  resume: "Current resume",
  library: "Achievement Library",
  both: "Resume and library",
};

export default function ImaginationSaveFooter({
  operation,
  source,
  allowResume,
  hasLibraryDestination,
  saveTo,
  canSave,
  isBusy,
  isSaving,
  error = "",
  reviewStatus = "",
  onSaveToChange,
  onCancel,
  onSave,
}: Props) {
  const destinations = getImaginationSaveDestinations(
    source,
    allowResume,
    hasLibraryDestination,
  );
  const selectedDestination =
    saveTo && destinations.includes(saveTo) ? saveTo : "";
  const hasDestination = operation !== "create" || destinations.length > 0;
  const saveDisabled =
    isBusy ||
    isSaving ||
    !canSave ||
    !hasDestination ||
    (operation === "create" && !selectedDestination);

  return (
    <footer className={styles.footer}>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.review}>
        <p>Review the facts before accepting this draft.</p>
        {reviewStatus && (
          <p className={styles.reviewStatus} role="status">
            {reviewStatus}
          </p>
        )}
      </div>
      {operation === "create" &&
        (destinations.length ? (
          <label className={styles.destination}>
            <span>Save to</span>
            <select
              aria-label="Save achievement to"
              value={selectedDestination}
              disabled={isSaving}
              onChange={(event) =>
                onSaveToChange(event.target.value as ImaginationSaveDestination)
              }
            >
              {!selectedDestination && (
                <option value="" disabled>
                  Select a destination
                </option>
              )}
              {destinations.map((destination) => (
                <option key={destination} value={destination}>
                  {destinationLabels[destination]}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className={styles.unavailable} role="status">
            No save destination is available for this data source.
          </p>
        ))}
      <p className={styles.pdfNote}>
        Your PDF updates only after Apply changes.
      </p>
      <div className={styles.actions}>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="studio-primary"
          type="button"
          disabled={saveDisabled}
          aria-busy={isSaving}
          onClick={onSave}
        >
          {isSaving ? (
            "Saving…"
          ) : (
            <>
              <Save className={styles.icon} aria-hidden="true" />
              {operation === "create" ? "Save achievement" : "Accept draft"}
            </>
          )}
        </button>
      </div>
    </footer>
  );
}
