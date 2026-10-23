"use client";

import {
  ArrowRight,
  ChartNoAxesColumn,
  Eye,
  FileText,
  LoaderCircle,
  RefreshCw,
  Scissors,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import React from "react";
import type { CSSProperties, FormEvent } from "react";

export type ImaginationWritingMode =
  | "make-shorter"
  | "more-technical"
  | "improve-clarity"
  | "emphasize-engineering-impact"
  | "improve-action-verbs"
  | "reduce-repetition";

export type ImaginationTargetLineCount = 1 | 2 | 3 | 4;

export type ImaginationTargetLineFeedback =
  | { status: "estimated" }
  | { status: "measured"; lineCount: number }
  | { status: "unavailable" };

export const MAX_IMAGINATION_INSTRUCTION_LENGTH = 500;
export const DEFAULT_IMAGINATION_INSTRUCTION =
  "Create a concise, factual achievement from only the connected context.";

const TARGET_LINE_COUNTS = [1, 2, 3, 4] as const;

type WritingPreset = {
  mode: ImaginationWritingMode;
  label: string;
  Icon: LucideIcon;
};

export const IMAGINATION_WRITING_PRESETS = [
  { mode: "make-shorter", label: "Make shorter", Icon: Scissors },
  { mode: "more-technical", label: "More technical", Icon: Wrench },
  { mode: "improve-clarity", label: "Improve clarity", Icon: Eye },
  {
    mode: "emphasize-engineering-impact",
    label: "Emphasize engineering impact",
    Icon: ChartNoAxesColumn,
  },
  {
    mode: "improve-action-verbs",
    label: "Improve action verbs",
    Icon: ArrowRight,
  },
  { mode: "reduce-repetition", label: "Reduce repetition", Icon: RefreshCw },
] as const satisfies readonly WritingPreset[];

export type ImaginationWritingControlsProps = {
  selectedMode: ImaginationWritingMode | null;
  onModeChange: (mode: ImaginationWritingMode) => void;
  instruction: string;
  onInstructionChange: (instruction: string) => void;
  targetLines: ImaginationTargetLineCount;
  onTargetLinesChange: (targetLines: ImaginationTargetLineCount) => void;
  targetLineFeedback?: ImaginationTargetLineFeedback;
  canSubmit: boolean;
  isLoading: boolean;
  onSubmit: () => void;
  onCancel: () => void;
};

function describeTargetLineFeedback(
  feedback: ImaginationTargetLineFeedback,
): string {
  if (feedback.status === "estimated") return "Estimated until compiled";
  if (feedback.status === "unavailable") return "Line count unavailable";

  if (!Number.isInteger(feedback.lineCount) || feedback.lineCount < 1) {
    return "Line count unavailable";
  }

  return (
    "Measured: " +
    feedback.lineCount +
    (feedback.lineCount === 1 ? " line" : " lines")
  );
}

export default function ImaginationWritingControls({
  selectedMode,
  onModeChange,
  instruction,
  onInstructionChange,
  targetLines,
  onTargetLinesChange,
  targetLineFeedback = { status: "estimated" },
  canSubmit,
  isLoading,
  onSubmit,
  onCancel,
}: ImaginationWritingControlsProps) {
  const instructionTooLong =
    instruction.length > MAX_IMAGINATION_INSTRUCTION_LENGTH;
  const submitDisabled =
    !canSubmit || isLoading || !instruction.trim() || instructionTooLong;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitDisabled) return;
    onSubmit();
  }

  const panelStyle: CSSProperties = {
    display: "grid",
    gap: "var(--space-16)",
    minWidth: 0,
    padding: "var(--space-16)",
    border: "1px solid var(--line)",
    borderRadius: "var(--radius-card)",
    background: "var(--surface)",
    color: "var(--ink)",
  };

  const submitButtonStyle: CSSProperties = submitDisabled
    ? {
        borderColor: "var(--line)",
        background: "var(--surface-soft)",
        color: "var(--quiet)",
      }
    : {
        borderColor: "var(--imagination)",
        background: "var(--imagination)",
        color: "var(--color-text-inverse)",
      };

  return (
    <section
      aria-label="Writing controls"
      className="imagination-writing-controls"
      style={panelStyle}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-8)",
        }}
      >
        <Sparkles
          aria-hidden="true"
          size={18}
          style={{ color: "var(--imagination)" }}
        />
        <h2
          style={{
            margin: 0,
            color: "var(--ink)",
            fontSize: "var(--type-card-heading-size)",
            lineHeight: "var(--type-card-heading-line-height)",
            fontWeight: 600,
          }}
        >
          Writing controls
        </h2>
      </header>

      <div
        aria-label="Writing mode"
        className="studio-quick-actions"
        role="group"
      >
        {IMAGINATION_WRITING_PRESETS.map(({ mode, label, Icon }) => {
          const selected = selectedMode === mode;
          return (
            <button
              aria-pressed={selected}
              className="imagination-writing-preset"
              disabled={isLoading}
              key={mode}
              onClick={() => onModeChange(mode)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-4)",
                ...(selected
                  ? {
                      borderColor: "var(--imagination)",
                      background: "var(--imagination-soft)",
                      color: "var(--imagination-hover)",
                    }
                  : {}),
              }}
              type="button"
            >
              <Icon aria-hidden="true" size={14} />
              {label}
            </button>
          );
        })}
      </div>

      <hr
        aria-hidden="true"
        style={{
          width: "100%",
          margin: "calc(var(--space-16) * -1) 0 0",
          border: 0,
          borderTop: "1px solid var(--line)",
        }}
      />

      <form
        aria-busy={isLoading}
        onSubmit={handleSubmit}
        style={{ display: "grid", gap: "var(--space-8)", minWidth: 0 }}
      >
        <label className="studio-field">
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-8)",
            }}
          >
            <FileText
              aria-hidden="true"
              size={16}
              style={{ color: "var(--imagination)" }}
            />
            Your instruction
          </span>
          <textarea
            aria-invalid={instructionTooLong || undefined}
            disabled={isLoading}
            maxLength={MAX_IMAGINATION_INSTRUCTION_LENGTH}
            onChange={(event) =>
              onInstructionChange(
                event.currentTarget.value.slice(
                  0,
                  MAX_IMAGINATION_INSTRUCTION_LENGTH,
                ),
              )
            }
            rows={3}
            value={instruction}
          />
        </label>

        <div
          aria-live="polite"
          aria-atomic="true"
          aria-label={
            instruction.length +
            " of " +
            MAX_IMAGINATION_INSTRUCTION_LENGTH +
            " characters"
          }
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginTop: "calc(var(--space-8) * -1)",
            color: instructionTooLong ? "var(--danger)" : "var(--quiet)",
            fontSize: "var(--type-label-size)",
            lineHeight: "var(--type-label-line-height)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {instruction.length}/{MAX_IMAGINATION_INSTRUCTION_LENGTH}
        </div>

        <div className="imagination-request-actions">
          <label>
            <span>Target</span>
            <select
              aria-label="Target line count"
              disabled={isLoading}
              onChange={(event) => {
                const next = Number(event.currentTarget.value);
                if (
                  TARGET_LINE_COUNTS.includes(
                    next as ImaginationTargetLineCount,
                  )
                ) {
                  onTargetLinesChange(next as ImaginationTargetLineCount);
                }
              }}
              value={targetLines}
            >
              {TARGET_LINE_COUNTS.map((lines) => (
                <option key={lines} value={lines}>
                  {lines} {lines === 1 ? "line" : "lines"}
                </option>
              ))}
            </select>
          </label>

          <span role="status" aria-live="polite">
            {describeTargetLineFeedback(targetLineFeedback)}
          </span>

          <button
            aria-busy={isLoading}
            className="studio-ai-button imagination-writing-submit"
            disabled={submitDisabled}
            style={submitButtonStyle}
            type="submit"
          >
            {isLoading ? (
              <>
                <LoaderCircle aria-hidden="true" size={16} />
                Imagining…
              </>
            ) : (
              <>
                <Sparkles aria-hidden="true" size={16} />
                Ask Imagination
              </>
            )}
          </button>

          {isLoading && (
            <button
              aria-label="Cancel request"
              className="imagination-writing-cancel"
              onClick={onCancel}
              type="button"
            >
              <X aria-hidden="true" size={14} />
              Cancel request
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
