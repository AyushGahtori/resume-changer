"use client";
import { useEffect, useRef, type ReactNode } from "react";

export default function StudioDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    const frame = requestAnimationFrame(() =>
      dialog?.querySelector<HTMLElement>("[data-studio-focus]")?.focus(),
    );
    return () => {
      cancelAnimationFrame(frame);
      dialog?.close();
    };
  }, []);
  return (
    <dialog
      className="studio-dialog"
      ref={ref}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="studio-dialog-heading">
        <h2>{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close editor">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
