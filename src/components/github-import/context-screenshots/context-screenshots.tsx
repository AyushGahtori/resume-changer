"use client";

/* eslint-disable @next/next/no-img-element -- previews use local compressed object URLs. */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  SCREENSHOT_LIMITS,
  type ProcessedScreenshot,
  type ScreenshotResult,
} from "../../../lib/github/context-screenshots/contracts";
import { processScreenshotFile } from "../../../lib/github/context-screenshots/compression";
import styles from "./context-screenshots.module.css";

type ScreenshotProcessor = (
  file: File,
  signal: AbortSignal,
) => Promise<ScreenshotResult<ProcessedScreenshot>>;

export type ContextScreenshotsProps = {
  images: readonly ProcessedScreenshot[];
  onChange: (images: ProcessedScreenshot[]) => void;
  onConsentInvalidated?: () => void;
  processor?: ScreenshotProcessor;
  disabled?: boolean;
};

function formatBytes(value: number): string {
  return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(0)} KiB`;
}

export function ContextScreenshots({
  images,
  onChange,
  onConsentInvalidated,
  processor = processScreenshotFile,
  disabled = false,
}: ContextScreenshotsProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const activeControllerRef = useRef<AbortController | null>(null);
  const imagesRef = useRef(images);
  const replaceIdRef = useRef<string | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const image of images)
      next[image.id] = URL.createObjectURL(image.blob);
    setPreviewUrls(next);
    return () => {
      for (const url of Object.values(next)) URL.revokeObjectURL(url);
    };
  }, [images]);

  useEffect(
    () => () => {
      activeControllerRef.current?.abort();
      activeControllerRef.current = null;
    },
    [],
  );

  const openPicker = useCallback(
    (replaceId: string | null = null) => {
      if (disabled || pendingName) return;
      replaceIdRef.current = replaceId;
      if (inputRef.current) {
        inputRef.current.value = "";
        inputRef.current.click();
      }
    },
    [disabled, pendingName],
  );

  const handleFiles = useCallback(
    async (files: readonly File[], replaceId: string | null = null) => {
      if (disabled || files.length === 0 || activeControllerRef.current) return;
      const current = [...imagesRef.current];
      const replacementIndex = replaceId
        ? current.findIndex((image) => image.id === replaceId)
        : -1;
      const availableSlots =
        SCREENSHOT_LIMITS.maxCount -
        current.length +
        (replacementIndex >= 0 ? 1 : 0);
      if (availableSlots <= 0) {
        setError("You can add up to five screenshots.");
        setMessage(null);
        return;
      }
      const accepted = [...files].slice(0, availableSlots);
      const errors: string[] =
        accepted.length < files.length
          ? [
              "Only five screenshots can be included. Extra files were not added.",
            ]
          : [];
      setError(null);

      const controller = new AbortController();
      activeControllerRef.current = controller;
      setMessage(null);
      for (let index = 0; index < accepted.length; index += 1) {
        const file = accepted[index];
        setPendingName(
          accepted.length > 1
            ? `Processing ${index + 1} of ${accepted.length}: ${file.name}`
            : `Processing ${file.name}`,
        );
        let result: ScreenshotResult<ProcessedScreenshot>;
        try {
          result = await processor(file, controller.signal);
        } catch {
          errors.push(
            "The screenshot could not be processed. Choose another image or try again.",
          );
          continue;
        }
        if (controller.signal.aborted) break;
        if (!result.ok) {
          errors.push(result.error.message);
          continue;
        }

        const processed = {
          ...result.value,
          fileName: file.name.slice(0, 120),
        };
        const base = [...imagesRef.current];
        const targetIndex =
          index === 0 && replacementIndex >= 0
            ? base.findIndex((image) => image.id === replaceId)
            : -1;
        const next = [...base];
        if (targetIndex >= 0) next.splice(targetIndex, 1, processed);
        else next.push(processed);
        const totalBytes = next.reduce(
          (sum, image) => sum + image.byteLength,
          0,
        );
        if (totalBytes > SCREENSHOT_LIMITS.targetTotalBytes) {
          errors.push(
            "This screenshot would exceed 750 KiB total. Remove another image or choose a smaller crop.",
          );
          continue;
        }
        imagesRef.current = next;
        setExpandedId(null);
        onConsentInvalidated?.();
        onChange(next);
        setMessage(
          "Screenshot is ready for review. It will only be sent with your approved analysis.",
        );
      }
      if (activeControllerRef.current === controller)
        activeControllerRef.current = null;
      setPendingName(null);
      setError(errors.length > 0 ? [...new Set(errors)].join(" ") : null);
      if (controller.signal.aborted)
        setMessage("Screenshot processing was cancelled.");
    },
    [disabled, onChange, onConsentInvalidated, processor],
  );

  const onInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const selected = Array.from(event.currentTarget.files ?? []);
      const replaceId = replaceIdRef.current;
      replaceIdRef.current = null;
      void handleFiles(selected, replaceId);
      event.currentTarget.value = "";
    },
    [handleFiles],
  );

  const removeImage = useCallback(
    (id: string) => {
      if (disabled || pendingName) return;
      const next = imagesRef.current.filter((image) => image.id !== id);
      if (next.length === imagesRef.current.length) return;
      imagesRef.current = next;
      setExpandedId((current) => (current === id ? null : current));
      setError(null);
      setMessage(
        "Screenshot removed. Review the updated bundle before approving it.",
      );
      onConsentInvalidated?.();
      onChange(next);
    },
    [disabled, onChange, onConsentInvalidated, pendingName],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      if (disabled || pendingName) return;
      void handleFiles(Array.from(event.dataTransfer.files));
    },
    [disabled, handleFiles, pendingName],
  );

  const totalBytes = images.reduce((sum, image) => sum + image.byteLength, 0);

  return (
    <section
      className={styles.panel}
      aria-labelledby="context-screenshots-title"
    >
      <div className={styles.headingRow}>
        <div>
          <h2 id="context-screenshots-title" className={styles.title}>
            Optional screenshots
          </h2>
          <p className={styles.description}>
            Add up to five images of your interface. Images are re-encoded and
            may be downscaled to fit; inspect the preview and remove them if
            labels are unclear. Repository images are not collected.
          </p>
        </div>
        <span className={styles.count}>
          {images.length}/{SCREENSHOT_LIMITS.maxCount}
        </span>
      </div>

      <div
        className={`${styles.dropZone} ${dragging ? styles.dropZoneActive : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDragging(false);
        }}
        onDrop={onDrop}
        aria-disabled={disabled || undefined}
      >
        <div className={styles.dropCopy}>
          <strong>Show what the interface looks like</strong>
          <span>JPEG, PNG, or WebP · up to 8 MiB each before processing</span>
        </div>
        <button
          type="button"
          className={styles.addButton}
          onClick={() => openPicker()}
          disabled={
            disabled ||
            Boolean(pendingName) ||
            images.length >= SCREENSHOT_LIMITS.maxCount
          }
        >
          Add screenshots
        </button>
        <input
          ref={inputRef}
          className={styles.fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={onInputChange}
          aria-label="Choose JPEG, PNG, or WebP screenshots"
        />
      </div>

      {pendingName ? (
        <div className={styles.processing} role="status" aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <span>{pendingName}</span>
          <button
            type="button"
            className={styles.textButton}
            onClick={() => activeControllerRef.current?.abort()}
          >
            Cancel
          </button>
        </div>
      ) : null}

      {images.length > 0 ? (
        <>
          <div className={styles.imageGrid}>
            {images.map((image, index) => (
              <article
                className={`${styles.imageCard} ${expandedId === image.id ? styles.imageCardExpanded : ""}`}
                key={image.id}
              >
                <div className={styles.imageTopline}>
                  <span className={styles.imageNumber}>
                    Screenshot {index + 1}
                  </span>
                  <span className={styles.sizeBadge}>
                    {formatBytes(image.byteLength)}
                  </span>
                </div>
                <div className={styles.thumbnailFrame}>
                  {previewUrls[image.id] ? (
                    <img
                      src={previewUrls[image.id]}
                      alt={`Preview of ${image.fileName}`}
                      className={styles.thumbnail}
                    />
                  ) : (
                    <div className={styles.previewLoading} aria-hidden="true" />
                  )}
                </div>
                <p className={styles.fileName} title={image.fileName}>
                  {image.fileName}
                </p>
                <p className={styles.imageMetadata}>
                  {image.width} × {image.height} ·{" "}
                  {image.mediaType.replace("image/", "").toUpperCase()}
                </p>
                <div
                  id={`screenshot-preview-${image.id}`}
                  className={styles.largePreview}
                  hidden={expandedId !== image.id || !previewUrls[image.id]}
                >
                  {previewUrls[image.id] ? (
                    <img
                      src={previewUrls[image.id]}
                      alt={`Larger preview of ${image.fileName}`}
                    />
                  ) : null}
                  <p>
                    Check that the interface labels remain readable at this
                    size.
                  </p>
                </div>
                <div className={styles.imageActions}>
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() =>
                      setExpandedId((current) =>
                        current === image.id ? null : image.id,
                      )
                    }
                    aria-expanded={expandedId === image.id}
                    aria-controls={`screenshot-preview-${image.id}`}
                  >
                    {expandedId === image.id
                      ? "Hide preview"
                      : "Review preview"}
                  </button>
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => openPicker(image.id)}
                    disabled={disabled || Boolean(pendingName)}
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    className={styles.removeButton}
                    onClick={() => removeImage(image.id)}
                    disabled={disabled || Boolean(pendingName)}
                    aria-label={`Remove ${image.fileName}`}
                  >
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>
          <p className={styles.bundleSummary}>
            Processed bundle: {formatBytes(totalBytes)} of{" "}
            {formatBytes(SCREENSHOT_LIMITS.targetTotalBytes)}. Images stay in
            this tab and are sent only with an approved analysis.
          </p>
        </>
      ) : (
        <p className={styles.emptyState}>
          No screenshots selected. You can continue without images.
        </p>
      )}

      <p className={styles.safetyNote}>
        Screenshots can support interface observations. They cannot prove
        authorship, backend behaviour, deployment, or performance.
      </p>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className={styles.liveMessage} role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
    </section>
  );
}
