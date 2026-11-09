"use client";

import { Check, ChevronDown } from "lucide-react";
import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

export type LibrarySelectOption = {
  label: string;
  value: string;
};

type Props = {
  "aria-label": string;
  active?: boolean;
  className?: string;
  disabled?: boolean;
  id?: string;
  onChange: (value: string) => void;
  options: LibrarySelectOption[];
  value: string;
};

const MENU_GAP = 6;
const MENU_VIEWPORT_PADDING = 8;
const MENU_MAX_HEIGHT = 300;

/**
 * Chooses whether the menu opens above or below the trigger.
 * The side with more room wins, and the height stays inside the viewport.
 */
export function libraryMenuPlacement(
  trigger: { top: number; bottom: number },
  viewportHeight: number,
) {
  const spaceBelow = Math.max(
    0,
    viewportHeight - trigger.bottom - MENU_GAP - MENU_VIEWPORT_PADDING,
  );
  const spaceAbove = Math.max(
    0,
    trigger.top - MENU_GAP - MENU_VIEWPORT_PADDING,
  );
  const above = spaceAbove > spaceBelow;
  const available = above ? spaceAbove : spaceBelow;
  return { above, maxHeight: Math.min(MENU_MAX_HEIGHT, available) };
}

/** A theme-aware, keyboard-operable select used by the library workbench. */
export default function LibrarySelect({
  "aria-label": label,
  active = false,
  className,
  disabled = false,
  id: controlId,
  onChange,
  options,
  value,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const id = useId().replaceAll(":", "");
  const listboxId = `library-select-${id}`;
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [placement, setPlacement] = useState<{
    above: boolean;
    maxHeight: number;
  } | null>(null);
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
      ?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, listboxId, open]);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const button: HTMLButtonElement = trigger;

    function update() {
      const rect = button.getBoundingClientRect();
      const next = libraryMenuPlacement(rect, window.innerHeight);
      setPlacement((current) =>
        current &&
        current.above === next.above &&
        current.maxHeight === next.maxHeight
          ? current
          : next,
      );
    }

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

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
      className={className ? `library-select ${className}` : "library-select"}
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
        id={controlId}
        disabled={disabled}
        ref={triggerRef}
        onClick={() => {
          if (disabled) return;
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
        data-placement={
          placement ? (placement.above ? "above" : "below") : undefined
        }
        hidden={!open}
        id={listboxId}
        role="listbox"
        style={
          placement
            ? ({
                maxHeight: placement.maxHeight,
                overflow: "auto",
                ...(placement.above
                  ? { top: "auto", bottom: `calc(100% + ${MENU_GAP}px)` }
                  : { bottom: "auto" }),
              } satisfies CSSProperties)
            : undefined
        }
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
