"use client";

import { useEffect, useRef } from "react";

export function ChoiceDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-choice-cancel]")?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="saved-jobs"
      aria-labelledby="choice-dialog-title"
      style={{ width: "min(28rem, calc(100vw - 2rem))" }}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <div className="saved-jobs-heading">
        <h2 id="choice-dialog-title">{title}</h2>
        <p>{message}</p>
      </div>
      <div className="form-actions">
        <button
          className="home-action-button home-action-button--ghost"
          data-choice-cancel=""
          onClick={onCancel}
          type="button"
        >
          {cancelLabel}
        </button>
        <button
          className="home-action-button home-action-button--primary"
          onClick={onConfirm}
          type="button"
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
