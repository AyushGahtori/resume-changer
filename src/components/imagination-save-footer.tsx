"use client";

import * as React from "react";
import { Save } from "lucide-react";
import type { AchievementWritingOperation } from "@/lib/ai/achievement-writing";
import type { ResumeDataSource } from "@/lib/data/loaders";
import LibrarySelect from "@/components/library/library-select";
import {
  getImaginationSaveDestinations,
  imaginationSaveCopy,
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
  disabledReason?: string;
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
  disabledReason = "",
  onSaveToChange,
  onCancel,
  onSave,
}: Props) {
  const jobOrProjectRequired =
    operation === "create" && source === "personal" && !hasLibraryDestination;
  const destinations = jobOrProjectRequired
    ? []
    : getImaginationSaveDestinations(
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
  const unavailableCopy = !hasDestination
    ? jobOrProjectRequired
      ? imaginationSaveCopy.jobRequired
      : imaginationSaveCopy.sourceUnavailable
    : "";
  const saveIncludesResume =
    operation !== "create" ||
    selectedDestination === "resume" ||
    selectedDestination === "both";
  const saveHint =
    !saveDisabled || isSaving
      ? ""
      : isBusy
        ? imaginationSaveCopy.saveBusy
        : unavailableCopy
          ? ""
          : disabledReason
            ? disabledReason
            : operation === "create" && !selectedDestination
              ? imaginationSaveCopy.saveNeedsDestination
              : !canSave
                ? imaginationSaveCopy.saveNeedsText
                : "";
  const destinationOptions = [
    ...(selectedDestination
      ? []
      : [{ value: "", label: "Select a destination" }]),
    ...destinations.map((destination) => ({
      value: destination,
      label: destinationLabels[destination],
    })),
  ];

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
        {saveHint && (
          <p className={styles.helper} id="imagination-save-hint" role="status">
            {saveHint}
          </p>
        )}
      </div>
      {operation === "create" &&
        (destinations.length ? (
          <div className={styles.destination}>
            <span>Save to</span>
            <LibrarySelect
              aria-label="Save achievement to"
              className={styles.destinationSelect}
              disabled={isSaving}
              onChange={(value) => {
                if (
                  value === "resume" ||
                  value === "library" ||
                  value === "both"
                )
                  onSaveToChange(value);
              }}
              options={destinationOptions}
              value={selectedDestination}
            />
          </div>
        ) : (
          <p className={styles.unavailable} role="status">
            {unavailableCopy}
          </p>
        ))}
      {saveIncludesResume && (
        <p className={styles.pdfNote}>{imaginationSaveCopy.pdfNote}</p>
      )}
      <div className={styles.actions}>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="studio-primary"
          type="button"
          disabled={saveDisabled}
          aria-busy={isSaving}
          aria-describedby={saveHint ? "imagination-save-hint" : undefined}
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
