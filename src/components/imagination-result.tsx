"use client";

import {
  AlertCircle,
  Check,
  Clipboard,
  LoaderCircle,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import React, {
  useEffect,
  useId,
  useRef,
  useState,
  type RefObject,
} from "react";
import styles from "./imagination-result.module.css";

export type ImaginationResultStatus = "empty" | "loading" | "error" | "ready";

export interface ImaginationResultProps {
  status: ImaginationResultStatus;
  text: string;
  measuredLines?: number | null;
  targetLines?: number;
  layoutWarning?: string | null;
  errorMessage?: string | null;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  onTextChange: (text: string) => void;
  onUseSuggestion: (text: string) => void;
  onRegenerate: () => void;
}

function actualMeasuredLineCount(value: number | null | undefined) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

export default function ImaginationResult({
  status,
  text,
  measuredLines,
  targetLines,
  layoutWarning,
  errorMessage,
  composerRef,
  onTextChange,
  onUseSuggestion,
  onRegenerate,
}: ImaginationResultProps) {
  const headingId = useId();
  const textId = useId();
  const [copyFeedback, setCopyFeedback] = useState("");
  const [editedAfterGeneration, setEditedAfterGeneration] = useState(false);
  const previousStatus = useRef(status);

  useEffect(() => {
    if (status === "loading" && previousStatus.current !== "loading") {
      setEditedAfterGeneration(false);
      setCopyFeedback("");
    }
    previousStatus.current = status;
  }, [status]);

  const hasText = text.trim().length > 0;
  const showText = hasText && status !== "empty";
  const measuredCount =
    showText && !editedAfterGeneration
      ? actualMeasuredLineCount(measuredLines)
      : null;
  const targetMissed =
    measuredCount !== null &&
    targetLines !== undefined &&
    measuredCount > targetLines;
  const warning =
    (editedAfterGeneration
      ? "Wording changed after generation. Final fit will be checked on Apply."
      : layoutWarning?.trim()) ||
    (targetMissed
      ? "The measured version is above the selected line target. Refine it before applying."
      : measuredCount === null && showText
        ? "Estimated until compiled. Final fit will be checked on Apply."
        : "");

  async function copySuggestion() {
    if (!hasText || status === "loading") return;
    setCopyFeedback("");
    try {
      const clipboard = navigator.clipboard;
      if (typeof clipboard?.writeText !== "function") {
        throw new Error("Clipboard unavailable");
      }
      await clipboard.writeText(text);
      setCopyFeedback("Copied to clipboard.");
    } catch {
      setCopyFeedback(
        "Clipboard unavailable. Select the suggestion and copy it manually.",
      );
    }
  }

  function useSuggestion() {
    if (!hasText || status === "loading") return;
    onUseSuggestion(text);
    composerRef.current?.focus();
  }

  return (
    <section
      className={styles.result}
      aria-labelledby={headingId}
      aria-busy={status === "loading"}
    >
      <div className={styles.heading}>
        <Sparkles className={styles.headingIcon} aria-hidden="true" size={18} />
        <h2 id={headingId}>Imagined version</h2>
        {measuredCount !== null && (
          <span
            className={styles.measuredBadge}
            aria-label={
              "Measured by LaTeX: " +
              measuredCount +
              (measuredCount === 1 ? " line" : " lines")
            }
          >
            <Check aria-hidden="true" size={14} />
            {measuredCount} {measuredCount === 1 ? "line" : "lines"}
          </span>
        )}
      </div>

      {status === "empty" && (
        <p className={styles.stateMessage}>
          Your imagined version will appear here after generation.
        </p>
      )}

      {status === "loading" && (
        <p className={styles.loadingMessage} role="status" aria-live="polite">
          <LoaderCircle
            className={styles.spinner}
            aria-hidden="true"
            size={16}
          />
          Creating a suggestion from the current draft and context…
        </p>
      )}

      {status === "error" && (
        <p className={styles.errorMessage} role="alert">
          <AlertCircle aria-hidden="true" size={16} />
          {errorMessage?.trim() ||
            "Imagination could not create a suggestion. Try again."}
        </p>
      )}

      {showText && (
        <>
          <label className={styles.editorLabel} htmlFor={textId}>
            <span>Suggestion text</span>
            <textarea
              id={textId}
              className={styles.editor}
              rows={4}
              maxLength={8000}
              value={text}
              readOnly={status === "loading"}
              onChange={(event) => {
                setEditedAfterGeneration(true);
                setCopyFeedback("");
                onTextChange(event.currentTarget.value);
              }}
            />
          </label>

          {warning && (
            <p className={styles.warning} role="status" aria-live="polite">
              {warning}
            </p>
          )}

          <div className={styles.actions}>
            <button
              className={styles.useButton}
              type="button"
              disabled={status === "loading"}
              onClick={useSuggestion}
            >
              <Check aria-hidden="true" size={16} />
              Use suggestion in editor
            </button>
            <button
              className={styles.actionButton}
              type="button"
              disabled={status === "loading"}
              onClick={onRegenerate}
            >
              <RefreshCw aria-hidden="true" size={15} />
              Regenerate
            </button>
            <button
              className={styles.actionButton}
              type="button"
              disabled={status === "loading"}
              onClick={copySuggestion}
            >
              <Clipboard aria-hidden="true" size={15} />
              Copy
            </button>
          </div>

          {copyFeedback && (
            <p className={styles.copyFeedback} role="status" aria-live="polite">
              {copyFeedback}
            </p>
          )}
        </>
      )}

      {status === "error" && !hasText && (
        <div className={styles.actions}>
          <button
            className={styles.actionButton}
            type="button"
            onClick={onRegenerate}
          >
            <RefreshCw aria-hidden="true" size={15} />
            Regenerate
          </button>
        </div>
      )}
    </section>
  );
}
