"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export type LibrarySelectOption = {
  label: string;
  value: string;
};

type Props = {
  "aria-label": string;
  active?: boolean;
  onChange: (value: string) => void;
  options: LibrarySelectOption[];
  value: string;
};

/** A theme-aware, keyboard-operable select used by the library workbench. */
export default function LibrarySelect({
  "aria-label": label,
  active = false,
  onChange,
  options,
  value,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const id = useId().replaceAll(":", "");
  const listboxId = `library-select-${id}`;
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const selectedOption = options[selectedIndex];

  useEffect(() => {
    setActiveIndex(selectedIndex);
  }, [selectedIndex]);

  useEffect(() => {
    if (!open) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document
      .getElementById(`${listboxId}-option-${activeIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listboxId, open]);

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setActiveIndex(index);
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      if (!open) {
        setOpen(true);
        setActiveIndex(selectedIndex);
      } else {
        setActiveIndex((index) =>
          Math.min(options.length - 1, Math.max(0, index + direction)),
        );
      }
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(event.key === "Home" ? 0 : options.length - 1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(activeIndex);
      else {
        setOpen(true);
        setActiveIndex(selectedIndex);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }

    if (event.key === "Tab") setOpen(false);
  }

  return (
    <div
      className="library-select"
      data-open={open ? "true" : undefined}
      ref={rootRef}
    >
      <button
        aria-activedescendant={
          open ? `${listboxId}-option-${activeIndex}` : undefined
        }
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        aria-controls={listboxId}
        className="library-select-trigger"
        data-active={active ? "true" : undefined}
        data-value={value}
        onClick={() => {
          if (open) setOpen(false);
          else {
            setActiveIndex(selectedIndex);
            setOpen(true);
          }
        }}
        onKeyDown={handleKeyDown}
        role="combobox"
        type="button"
      >
        <span className="library-select-value">{selectedOption?.label}</span>
        <ChevronDown
          aria-hidden="true"
          className="library-select-chevron"
          size={16}
        />
      </button>
      <div
        aria-label={`Options for ${label}`}
        aria-orientation="vertical"
        className="library-select-menu"
        hidden={!open}
        id={listboxId}
        role="listbox"
      >
        {options.map((option, index) => (
          <div
            aria-selected={option.value === value}
            className="library-select-option"
            data-active={index === activeIndex ? "true" : undefined}
            data-value={option.value}
            id={`${listboxId}-option-${index}`}
            key={`${option.value}:${option.label}`}
            onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                choose(index);
              }
            }}
            onClick={() => choose(index)}
            onPointerMove={() => setActiveIndex(index)}
            role="option"
            tabIndex={-1}
          >
            <span>{option.label}</span>
            {option.value === value ? (
              <Check aria-hidden="true" size={15} strokeWidth={2.5} />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
