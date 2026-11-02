"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  MeasurementAnswerSchema,
  type ImportQuestion,
  type MeasurementAnswer,
  type MeasurementFieldsProps,
  type MeasurementResult as ContractMeasurementResult,
} from "../../lib/github/contracts";
import {
  METRIC_CATALOG,
  type MeasurementContext,
  type MetricDefinition,
} from "../../lib/github/measurement-catalog";
import { getMeasurementRecipe } from "../../lib/github/measurement-recipes";
import {
  deriveMeasurementResult,
  renderMetricClause,
  validateMeasurementAnswer,
} from "../../lib/github/measurements";
import styles from "./measurement-fields.module.css";

type InterviewMode = "result" | "report" | "target";
type Attestation = "measured" | "user-attested" | "documented" | "target";

interface FormDraft {
  mode: InterviewMode | null;
  definitionId: string;
  value: string;
  unit: string;
  baselineValue: string;
  baselineUnit: string;
  compare: boolean;
  statistic: string;
  averagingMode: string;
  attestation: Attestation;
  context: Record<string, string>;
  sourceDescription: string;
}

interface MetricOption {
  definition: MetricDefinition;
  publicId: string;
  label: string;
}

interface ModeOption {
  mode: "result" | "report" | "help" | "skip" | "target";
  label: string;
}

interface QuestionFieldsProps {
  initiallyExpanded?: boolean;
  question: ImportQuestion;
  answer: MeasurementAnswer | undefined;
  errors: string[];
  serverPreview: ContractMeasurementResult | undefined;
  onAnswer(
    questionId: string,
    answer: MeasurementAnswer,
  ): void | Promise<void | boolean>;
  onSkip(questionId: string, version: number): void | Promise<void | boolean>;
  onDefer(questionId: string, version: number): void | Promise<void | boolean>;
}

const MODE_FALLBACKS: ModeOption[] = [
  { mode: "result", label: "Yes, I have a result" },
  { mode: "report", label: "There is a report to review" },
  { mode: "help", label: "Help me measure it" },
  { mode: "skip", label: "Continue without a number" },
  { mode: "target", label: "Set a future target" },
];

const CONTEXT_LABELS: Record<string, string> = {
  capabilityId: "Project capability",
  taskType: "Task measured",
  startEvent: "Timing starts when",
  endEvent: "Timing ends when",
  endpoint: "Endpoint or operation",
  workload: "Workload or dataset size",
  environment: "Environment and conditions",
  observationWindow: "Observation window",
  dataset: "Dataset",
  datasetVersion: "Dataset version",
  evaluationSplit: "Evaluation split",
  positiveClass: "Positive class",
  targetUnit: "Target unit",
  taskDescription: "Task being measured",
  observationPeriod: "Observation period",
  sampleCount: "Number of observations",
  toolVersion: "Tool or framework version",
  revision: "Code or model revision",
  averagingMode: "Averaging method",
};

const CONTEXT_HELP: Record<string, string> = {
  endpoint: "Keep API timing separate from the full browser experience.",
  startEvent: "Name the exact event where timing begins.",
  endEvent: "Name the exact event where timing ends.",
  workload: "Record request mix, payload size, or other comparable input.",
  environment: "Include device, network, hardware, or runtime conditions.",
  evaluationSplit: "Use a held-out split for a result claimed as evaluation.",
  averagingMode: "Scores such as F1 change meaning with their averaging rule.",
  positiveClass: "ROC-AUC needs the class treated as positive.",
  targetUnit: "Keep a regression error in the target's own unit.",
};

const EVALUATION_SPLITS = [
  "training",
  "validation",
  "test",
  "held-out",
  "cross-validation",
] as const;

function normalizeMetricId(value: string): string {
  return value
    .toLowerCase()
    .replace(/^metric-/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function publicMetricId(definition: MetricDefinition): string {
  return `metric-${normalizeMetricId(definition.id)}`;
}

function findDefinition(value: string | null | undefined) {
  if (!value) return undefined;
  const normalized = normalizeMetricId(value);
  return METRIC_CATALOG.find(
    (definition) => normalizeMetricId(definition.id) === normalized,
  );
}

function metricOptionsFor(question: ImportQuestion): MetricOption[] {
  const questionDefinition = findDefinition(question.definitionId);
  const choices = question.choices
    .map((choice) => {
      const match = /^metric:([^—]+?)\s+—\s+(.+)$/u.exec(choice);
      if (!match) return null;
      const definition = findDefinition(match[1].trim());
      return definition
        ? {
            definition,
            publicId: publicMetricId(definition),
            label: match[2].trim(),
          }
        : null;
    })
    .filter((option): option is MetricOption => option !== null);

  if (questionDefinition) {
    return [
      {
        definition: questionDefinition,
        publicId: publicMetricId(questionDefinition),
        label: questionDefinition.label,
      },
    ];
  }
  if (choices.length > 0) return choices;
  return METRIC_CATALOG.map((definition) => ({
    definition,
    publicId: publicMetricId(definition),
    label: definition.label,
  }));
}

function getModeOptions(question: ImportQuestion): ModeOption[] {
  const options = question.choices
    .filter((choice) => !choice.startsWith("metric:"))
    .map((label): ModeOption | null => {
      const lower = label.toLowerCase();
      if (lower.includes("report")) return { mode: "report", label };
      if (lower.includes("help") || lower.includes("defer"))
        return { mode: "help", label };
      if (lower.includes("skip") || lower.includes("without a number"))
        return { mode: "skip", label };
      if (lower.includes("target")) return { mode: "target", label };
      if (lower.includes("result")) return { mode: "result", label };
      return null;
    })
    .filter((option): option is ModeOption => option !== null);

  return options.length > 0 ? options : MODE_FALLBACKS;
}

function initialDraft(
  question: ImportQuestion,
  answer: MeasurementAnswer | undefined,
): FormDraft {
  const definition = findDefinition(
    answer?.definitionId ?? question.definitionId,
  );
  const values = answer?.originalValues ?? [];
  const units = answer?.originalUnits ?? [];
  const mode = answer?.mode;
  const chosenMode: InterviewMode | null =
    mode === "result" || mode === "report" || mode === "target" ? mode : null;
  const context = { ...(answer?.context ?? {}) };
  if (!context.capabilityId && definition?.capabilityIds.length === 1) {
    context.capabilityId = definition.capabilityIds[0];
  }
  if (!context.taskType && definition?.taskTypes.length === 1) {
    context.taskType = definition.taskTypes[0];
  }
  return {
    mode: chosenMode,
    definitionId: definition ? publicMetricId(definition) : "",
    value:
      values.length > 1
        ? String(values[1])
        : values[0] === undefined
          ? ""
          : String(values[0]),
    unit: units.length > 1 ? units[1] : (units[0] ?? ""),
    baselineValue: values.length > 1 ? String(values[0]) : "",
    baselineUnit: units.length > 1 ? units[0] : (units[0] ?? ""),
    compare: values.length > 1,
    statistic: answer?.statistic ?? definition?.allowedStatistics[0] ?? "",
    averagingMode:
      answer?.context.averagingMode ??
      definition?.allowedAveragingModes[0] ??
      "",
    attestation:
      answer?.attestation === "user-attested"
        ? "user-attested"
        : answer?.attestation === "documented"
          ? "documented"
          : answer?.attestation === "target"
            ? "target"
            : "measured",
    context,
    sourceDescription: context.sourceDescription ?? "",
  };
}

function publicModeAnswer(answer: MeasurementAnswer | undefined) {
  if (!answer) return null;
  if (answer.mode === "result" || answer.mode === "report") return answer.mode;
  if (answer.mode === "target") return "target";
  if (answer.mode === "skip") return "skip";
  if (answer.mode === "defer") return "help";
  return null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

async function hashAnswer(
  payload: Omit<MeasurementAnswer, "answerHash">,
): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Secure local hashing is unavailable in this browser.");
  }
  const bytes = new TextEncoder().encode(JSON.stringify(stableValue(payload)));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function contextForEngine(
  context: Record<string, string>,
  definition: MetricDefinition,
): MeasurementContext {
  const result: Record<string, unknown> = { ...context };
  const sampleCount = result.sampleCount;
  if (typeof sampleCount === "string" && sampleCount.trim() !== "") {
    result.sampleCount = Number(sampleCount);
  }
  if (!result.capabilityId && definition.capabilityIds.length === 1) {
    result.capabilityId = definition.capabilityIds[0];
  }
  if (!result.taskType && definition.taskTypes.length === 1) {
    result.taskType = definition.taskTypes[0];
  }
  return result as MeasurementContext;
}

function engineInput(
  draft: FormDraft,
  definition: MetricDefinition,
): Record<string, unknown> {
  const context = contextForEngine(draft.context, definition);
  const unit = draft.unit || draft.context.targetUnit || "";
  const averagingMode =
    draft.averagingMode || definition.allowedAveragingModes[0] || "none";
  const observation = {
    value: Number(draft.value),
    unit,
    statistic: draft.statistic || definition.allowedStatistics[0] || "",
    averagingMode,
    context,
  };
  const status =
    draft.mode === "target"
      ? "target"
      : draft.mode === "report"
        ? "documented"
        : draft.attestation;

  if (draft.mode === "target") {
    return {
      definitionId: definition.id,
      mode: "target",
      status,
      observation,
      evidence: { sourceDescription: draft.sourceDescription },
    };
  }
  if (draft.compare) {
    return {
      definitionId: definition.id,
      mode: "comparison",
      status,
      baseline: {
        ...observation,
        value: Number(draft.baselineValue),
        unit: draft.baselineUnit || unit,
      },
      comparison: observation,
      evidence: { sourceDescription: draft.sourceDescription },
    };
  }
  return {
    definitionId: definition.id,
    mode: "absolute",
    status,
    observation,
    evidence: { sourceDescription: draft.sourceDescription },
  };
}

function statusLabel(
  status: ContractMeasurementResult["evidenceStatus"],
): string {
  switch (status) {
    case "measured":
      return "Measured result";
    case "user-attested":
      return "User-attested result · not independently verified";
    case "documented":
      return "Documented result · unverified";
    default:
      return "Evidence status needs review";
  }
}

function getFieldError(
  key: string,
  errors: readonly { field: string; message: string }[],
): string | undefined {
  const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return errors.find((error) => {
    const normalizedField = error.field.toLowerCase().replace(/[^a-z0-9]/g, "");
    return (
      normalizedField === normalizedKey ||
      (key === "value" && normalizedField.endsWith("observationvalue")) ||
      (key === "baselineValue" && normalizedField.endsWith("baselinevalue")) ||
      (key === "unit" && normalizedField.endsWith("observationunit")) ||
      (key === "baselineUnit" && normalizedField.endsWith("baselineunit"))
    );
  })?.message;
}

function choiceAllowed(
  question: ImportQuestion,
  mode: ModeOption["mode"],
): boolean {
  return getModeOptions(question).some((option) => option.mode === mode);
}

export function MeasurementFields(props: MeasurementFieldsProps) {
  if (props.questions.length === 0) return null;
  return (
    <div className={styles.list} aria-label="Optional measurements">
      {props.questions.map((question) => (
        <QuestionMeasurement
          key={`${question.id}:${question.version}:${props.answers[question.id]?.answerHash ?? "none"}`}
          initiallyExpanded={props.initiallyExpanded}
          question={question}
          answer={props.answers[question.id]}
          errors={props.validation[question.id] ?? []}
          serverPreview={props.previews[question.id]}
          onAnswer={props.onAnswer}
          onSkip={props.onSkip}
          onDefer={props.onDefer}
        />
      ))}
    </div>
  );
}

function QuestionMeasurement({
  initiallyExpanded,
  question,
  answer,
  errors,
  serverPreview,
  onAnswer,
  onSkip,
  onDefer,
}: QuestionFieldsProps) {
  const metricOptions = useMemo(() => metricOptionsFor(question), [question]);
  const modeOptions = useMemo(() => getModeOptions(question), [question]);
  const [draft, setDraft] = useState(() => initialDraft(question, answer));
  const [selectedChoice, setSelectedChoice] = useState(() =>
    publicModeAnswer(answer),
  );
  const [expanded, setExpanded] = useState(
    () => Boolean(initiallyExpanded) || Boolean(answer) || question.answered,
  );
  const [helpOpen, setHelpOpen] = useState(answer?.mode === "defer");
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitError, setSubmitError] = useState("");

  const selectedMetric =
    metricOptions.find((option) => option.publicId === draft.definitionId) ??
    metricOptions.find(
      (option) =>
        normalizeMetricId(option.publicId) ===
        normalizeMetricId(draft.definitionId),
    );
  const definition = selectedMetric?.definition;
  const currentServerPreview =
    !dirty &&
    question.answered &&
    answer !== undefined &&
    serverPreview !== undefined &&
    answer.version + 1 === question.version &&
    serverPreview.version === answer.version &&
    answer.mode !== "skip" &&
    answer.mode !== "target" &&
    answer.mode !== "defer" &&
    serverPreview.evidenceStatus !== "none";

  const engineCheck = useMemo(() => {
    if (
      !definition ||
      !draft.mode ||
      (draft.mode === "target" && !draft.value)
    ) {
      return { input: null, validation: null, derived: null, clause: null };
    }
    const input = engineInput(draft, definition);
    const validation = validateMeasurementAnswer(input);
    const derived = validation.ok ? deriveMeasurementResult(input) : null;
    const clause =
      derived?.ok === true ? renderMetricClause(derived.value) : null;
    return { input, validation, derived, clause };
  }, [definition, draft]);

  const localErrors =
    engineCheck.validation && !engineCheck.validation.ok
      ? engineCheck.validation.errors
      : [];
  const allLocalErrors = [...localErrors];
  const showLocalErrors = attempted || Object.values(touched).some(Boolean);
  const availableUnitOptions = definition
    ? definition.allowedUnits.filter(
        (unit) => unit !== "same-dimension-as-target",
      )
    : [];
  const recipe = definition?.recipeIds
    .map(getMeasurementRecipe)
    .find((candidate) => candidate !== undefined);
  const selectedMode = draft.mode ?? selectedChoice ?? publicModeAnswer(answer);
  const isSkip = selectedMode === "skip";
  const isHelp = helpOpen || selectedMode === "help";
  const canShowForm =
    draft.mode === "result" ||
    draft.mode === "report" ||
    draft.mode === "target";

  function updateDraft<K extends keyof FormDraft>(key: K, value: FormDraft[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
    setSubmitError("");
  }

  function updateContext(key: string, value: string) {
    setDraft((previous) => ({
      ...previous,
      context: { ...previous.context, [key]: value },
    }));
    setDirty(true);
    setSubmitError("");
  }

  function markTouched(key: string) {
    setTouched((previous) => ({ ...previous, [key]: true }));
  }

  async function enterMode(mode: ModeOption["mode"]) {
    if (saving) return;
    setExpanded(true);
    setSubmitError("");
    if (mode === "skip" || mode === "help") {
      try {
        const request = (mode === "skip" ? onSkip : onDefer)(
          question.id,
          question.version,
        );
        if (request && typeof request.then === "function") {
          setSaving(true);
          if ((await request) === false) {
            setSubmitError(
              "This answer could not be saved. Your previous answer is unchanged; please try again.",
            );
            return;
          }
        }
        setDraft((previous) => ({ ...previous, mode: null }));
        setSelectedChoice(mode);
        setHelpOpen(mode === "help");
        setDirty(false);
      } catch {
        setSubmitError("This answer could not be saved. Please try again.");
      } finally {
        setSaving(false);
      }
      return;
    }
    setHelpOpen(false);
    setSelectedChoice(mode);
    setDraft((previous) => ({ ...previous, mode }));
    setDirty(true);
  }

  function resetModePicker() {
    setDraft((previous) => ({ ...previous, mode: null }));
    setSelectedChoice(null);
    setHelpOpen(false);
    setAttempted(false);
    setDirty(true);
  }

  function answerPayload(): Omit<MeasurementAnswer, "answerHash"> | null {
    if (!definition || !draft.mode) return null;
    const mode = draft.mode;
    const unit = draft.unit || draft.context.targetUnit || "";
    const numericValues =
      draft.compare && mode !== "target"
        ? [Number(draft.baselineValue), Number(draft.value)]
        : [Number(draft.value)];
    const units =
      draft.compare && mode !== "target"
        ? [draft.baselineUnit || unit, unit]
        : [unit];
    const context = {
      ...draft.context,
      ...(draft.averagingMode ? { averagingMode: draft.averagingMode } : {}),
      ...(draft.sourceDescription.trim()
        ? { sourceDescription: draft.sourceDescription.trim() }
        : {}),
    };
    return {
      questionId: question.id,
      version: question.version,
      mode,
      originalValues: numericValues,
      originalUnits: units,
      definitionId: selectedMetric?.publicId ?? null,
      statistic: draft.statistic || definition.allowedStatistics[0] || null,
      context,
      sourceEvidenceIds: answer?.sourceEvidenceIds ?? [],
      attestation:
        mode === "target"
          ? "target"
          : mode === "report"
            ? "documented"
            : draft.attestation === "user-attested"
              ? "user-attested"
              : "measured",
    };
  }

  async function submitMeasurement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttempted(true);
    setSubmitError("");
    const payload = answerPayload();
    if (!payload) {
      setSubmitError("Choose a supported metric before continuing.");
      return;
    }
    const input = engineInput(draft, definition!);
    const validated = validateMeasurementAnswer(input);
    if (!validated.ok) return;

    const parsed = MeasurementAnswerSchema.safeParse({
      ...payload,
      answerHash: "0".repeat(64),
    });
    if (!parsed.success) {
      setSubmitError(
        "Review the highlighted fields and enter a supported result.",
      );
      return;
    }

    setSaving(true);
    try {
      const answerHash = await hashAnswer(payload);
      const accepted = await onAnswer(question.id, { ...payload, answerHash });
      if (accepted === false) {
        setSubmitError(
          "The server could not accept this answer. Your values have been kept.",
        );
        return;
      }
      setDirty(false);
      setTouched({});
      setAttempted(false);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "The measurement could not be prepared for review.",
      );
    } finally {
      setSaving(false);
    }
  }

  function fieldError(key: string) {
    if (!showLocalErrors) return undefined;
    return getFieldError(key, allLocalErrors);
  }

  function renderError(key: string) {
    const message = fieldError(key);
    if (!message) return null;
    const id = `${question.id}-${key}-error`;
    return (
      <span className={styles.fieldError} id={id} role="alert">
        {message}
      </span>
    );
  }

  function renderContextField(key: string) {
    const required =
      key === "capabilityId" ||
      key === "taskType" ||
      Boolean(definition?.requiredContextFields.includes(key as never));
    const label = CONTEXT_LABELS[key] ?? key;
    const help = CONTEXT_HELP[key];
    const value = draft.context[key] ?? "";
    const choices =
      key === "capabilityId"
        ? (definition?.capabilityIds ?? [])
        : key === "taskType"
          ? (definition?.taskTypes ?? [])
          : key === "evaluationSplit"
            ? EVALUATION_SPLITS
            : key === "averagingMode"
              ? (definition?.allowedAveragingModes ?? [])
              : [];
    const isSelect = choices.length > 0;
    const id = `${question.id}-${key}`;
    const error = fieldError(`context.${key}`) ?? fieldError(key);
    const describedBy =
      [help ? `${id}-help` : null, error ? `${id}-error` : null]
        .filter(Boolean)
        .join(" ") || undefined;

    return (
      <div className={styles.field} key={key}>
        <label htmlFor={id}>
          {label}
          {required ? <span className={styles.required}>Required</span> : null}
        </label>
        {isSelect ? (
          <select
            id={id}
            value={value}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            onChange={(event) => updateContext(key, event.currentTarget.value)}
            onBlur={() => markTouched(`context.${key}`)}
          >
            <option value="">Choose {label.toLowerCase()}</option>
            {choices.map((choice) => (
              <option key={choice} value={choice}>
                {choice.replaceAll("-", " ")}
              </option>
            ))}
            {value && !choices.includes(value as never) ? (
              <option value={value}>{value}</option>
            ) : null}
          </select>
        ) : (
          <input
            id={id}
            type={key === "sampleCount" ? "number" : "text"}
            min={key === "sampleCount" ? 1 : undefined}
            step={key === "sampleCount" ? 1 : undefined}
            value={value}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            onChange={(event) => updateContext(key, event.currentTarget.value)}
            onBlur={() => markTouched(`context.${key}`)}
            placeholder={
              key === "environment"
                ? "For example, lab test on Linux"
                : undefined
            }
          />
        )}
        {help ? (
          <span className={styles.helpText} id={`${id}-help`}>
            {help}
          </span>
        ) : null}
        {error ? (
          <span className={styles.fieldError} id={`${id}-error`} role="alert">
            {error}
          </span>
        ) : null}
      </div>
    );
  }

  const titleId = `${question.id}-measurement-title`;
  const serverErrors = errors.filter(Boolean);

  return (
    <section
      className={styles.panel}
      aria-labelledby={titleId}
      data-testid="measurement-fields"
      data-question-id={question.id}
    >
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.eyebrow}>Optional · no number required</p>
          <h3 id={titleId}>Add a measurement</h3>
          <p className={styles.prompt}>{question.prompt}</p>
        </div>
        {expanded ? (
          <button
            className={styles.collapseButton}
            type="button"
            aria-expanded="true"
            onClick={() => setExpanded(false)}
          >
            Close
          </button>
        ) : null}
      </div>

      {submitError ? (
        <p className={styles.submitError} role="alert">
          {submitError}
        </p>
      ) : null}
      {saving ? <p role="status">Saving your answer�</p> : null}
      {!expanded ? (
        <button
          className={styles.expandButton}
          type="button"
          aria-expanded="false"
          data-testid="measurement-expand"
          onClick={() => setExpanded(true)}
        >
          <span aria-hidden="true">＋</span> Add a measurement
        </button>
      ) : (
        <div className={styles.content}>
          {serverErrors.length > 0 ? (
            <div className={styles.serverErrors} role="alert">
              <strong>Review these details</strong>
              <ul>
                {serverErrors.map((message, index) => (
                  <li key={`${message}-${index}`}>{message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {isSkip ? (
            <div
              className={styles.qualitative}
              data-testid="measurement-skip-state"
            >
              <span className={styles.statusIcon} aria-hidden="true">
                ✓
              </span>
              <div>
                <strong>Qualitative point stays complete</strong>
                <p>No number or unfinished template text is needed.</p>
              </div>
              <button
                type="button"
                className={styles.textButton}
                onClick={resetModePicker}
              >
                Change answer
              </button>
            </div>
          ) : isHelp ? (
            <div
              className={styles.helpPanel}
              data-testid="measurement-help-state"
            >
              <div className={styles.helpHeading}>
                <span className={styles.helpIcon} aria-hidden="true">
                  i
                </span>
                <div>
                  <strong>Measurement help saved for later</strong>
                  <p>
                    A guide is informational only. It will not run tests or
                    create a result.
                  </p>
                </div>
              </div>
              {definition ? (
                <RecipeDetails recipe={recipe} />
              ) : (
                <div className={styles.field}>
                  <label htmlFor={`${question.id}-help-metric`}>
                    Choose a metric to see its guide
                  </label>
                  <select
                    id={`${question.id}-help-metric`}
                    value={draft.definitionId}
                    onChange={(event) => {
                      const selectedId = event.currentTarget.value;
                      const selected = metricOptions.find(
                        (option) => option.publicId === selectedId,
                      );
                      setDraft((previous) => ({
                        ...previous,
                        definitionId: selectedId,
                        context: {
                          ...previous.context,
                          capabilityId:
                            previous.context.capabilityId ||
                            selected?.definition.capabilityIds[0] ||
                            "",
                          taskType:
                            previous.context.taskType ||
                            selected?.definition.taskTypes[0] ||
                            "",
                        },
                      }));
                      setDirty(true);
                    }}
                  >
                    <option value="">Choose a supported metric</option>
                    {metricOptions.map((option) => (
                      <option key={option.publicId} value={option.publicId}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span className={styles.helpText}>
                    Choose a metric that matches the work. If none fit, keep the
                    achievement qualitative.
                  </span>
                </div>
              )}
              <button
                type="button"
                className={styles.textButton}
                onClick={resetModePicker}
              >
                Continue without a measurement
              </button>
            </div>
          ) : answer?.mode === "defer" ? (
            <div className={styles.qualitative}>
              <span className={styles.statusIcon} aria-hidden="true">
                i
              </span>
              <div>
                <strong>Measurement deferred</strong>
                <p>
                  You can return to this later. The achievement can still be
                  saved without a number.
                </p>
              </div>
              <button
                type="button"
                className={styles.textButton}
                onClick={resetModePicker}
              >
                Change answer
              </button>
            </div>
          ) : (
            <>
              {!canShowForm ? (
                <fieldset className={styles.modePicker}>
                  <legend>Did you measure a result for this work?</legend>
                  <div className={styles.modeGrid}>
                    {modeOptions.map((option) => (
                      <button
                        key={option.mode}
                        className={styles.modeChoice}
                        type="button"
                        disabled={saving}
                        onClick={() => void enterMode(option.mode)}
                      >
                        <span className={styles.choiceTitle}>
                          {option.label}
                        </span>
                        <span className={styles.choiceDescription}>
                          {option.mode === "result"
                            ? "Enter a result and its context."
                            : option.mode === "report"
                              ? "Record what the report says; it remains unverified."
                              : option.mode === "help"
                                ? "Save a task and view a trusted recipe."
                                : option.mode === "target"
                                  ? "Keep an aspiration separate from achieved results."
                                  : "Keep the qualitative achievement without a number."}
                        </span>
                      </button>
                    ))}
                  </div>
                </fieldset>
              ) : (
                <>
                  <form
                    className={styles.form}
                    onSubmit={submitMeasurement}
                    noValidate
                  >
                    <div className={styles.modeSummary}>
                      <span className={styles.modeBadge}>
                        {draft.mode === "target"
                          ? "Future target"
                          : draft.mode === "report"
                            ? "Documented report"
                            : "Result"}
                      </span>
                      <button
                        type="button"
                        className={styles.textButton}
                        onClick={resetModePicker}
                      >
                        Change answer
                      </button>
                    </div>

                    {metricOptions.length > 1 || !definition ? (
                      <div className={styles.field}>
                        <label htmlFor={`${question.id}-metric`}>
                          Measurement definition
                        </label>
                        <select
                          id={`${question.id}-metric`}
                          value={draft.definitionId}
                          aria-invalid={Boolean(fieldError("definitionId"))}
                          onChange={(event) => {
                            const selectedId = event.currentTarget.value;
                            const option = metricOptions.find(
                              (item) => item.publicId === selectedId,
                            );
                            setDraft((previous) => ({
                              ...previous,
                              definitionId: selectedId,
                              context: {
                                ...previous.context,
                                capabilityId:
                                  previous.context.capabilityId ||
                                  option?.definition.capabilityIds[0] ||
                                  "",
                                taskType:
                                  previous.context.taskType ||
                                  option?.definition.taskTypes[0] ||
                                  "",
                              },
                            }));
                            setDirty(true);
                          }}
                        >
                          <option value="">Choose a metric definition</option>
                          {metricOptions.map((option) => (
                            <option
                              key={option.publicId}
                              value={option.publicId}
                            >
                              {option.label}
                            </option>
                          ))}
                        </select>
                        {definition ? (
                          <span className={styles.helpText}>
                            {definition.explanation}
                          </span>
                        ) : (
                          <span className={styles.helpText}>
                            A score such as 0.92 is ambiguous until its metric
                            is named.
                          </span>
                        )}
                        {renderError("definitionId")}
                      </div>
                    ) : null}

                    {definition ? (
                      <>
                        <div className={styles.metricSummary}>
                          <strong>{definition.label}</strong>
                          <span>{definition.explanation}</span>
                        </div>

                        {draft.mode === "result" ? (
                          <fieldset className={styles.attestation}>
                            <legend>How is this result supported?</legend>
                            <label>
                              <input
                                type="radio"
                                name={`${question.id}-attestation`}
                                value="measured"
                                checked={draft.attestation === "measured"}
                                onChange={() =>
                                  updateDraft("attestation", "measured")
                                }
                              />
                              I measured it in a run
                            </label>
                            <label>
                              <input
                                type="radio"
                                name={`${question.id}-attestation`}
                                value="user-attested"
                                checked={draft.attestation === "user-attested"}
                                onChange={() =>
                                  updateDraft("attestation", "user-attested")
                                }
                              />
                              User-attested; I do not have a report
                            </label>
                          </fieldset>
                        ) : null}

                        <div className={styles.observationBlock}>
                          {draft.compare && draft.mode !== "target" ? (
                            <div className={styles.comparisonHeader}>
                              <div>
                                <h4>Comparable before and after</h4>
                                <p>
                                  Use the same metric, statistic, workload,
                                  dataset, and environment for both values.
                                </p>
                              </div>
                              <button
                                type="button"
                                className={styles.textButton}
                                onClick={() => updateDraft("compare", false)}
                              >
                                Remove comparison
                              </button>
                            </div>
                          ) : null}

                          <div className={styles.valueGrid}>
                            {draft.compare && draft.mode !== "target" ? (
                              <ValueFields
                                questionId={question.id}
                                prefix="baseline"
                                label="Baseline"
                                value={draft.baselineValue}
                                unit={draft.baselineUnit}
                                units={availableUnitOptions}
                                contextualUnit={
                                  definition.unitDimension === "contextual"
                                }
                                targetUnit={draft.context.targetUnit ?? ""}
                                error={
                                  fieldError("baseline.value") ??
                                  fieldError("baselineValue")
                                }
                                onValue={(value) =>
                                  updateDraft("baselineValue", value)
                                }
                                onUnit={(value) =>
                                  updateDraft("baselineUnit", value)
                                }
                                onBlur={() => markTouched("baseline.value")}
                              />
                            ) : null}
                            <ValueFields
                              questionId={question.id}
                              prefix="observation"
                              label={
                                draft.mode === "target"
                                  ? "Target value"
                                  : draft.compare
                                    ? "Comparison value"
                                    : draft.mode === "report"
                                      ? "Reported value"
                                      : "Result value"
                              }
                              value={draft.value}
                              unit={draft.unit}
                              units={availableUnitOptions}
                              contextualUnit={
                                definition.unitDimension === "contextual"
                              }
                              targetUnit={draft.context.targetUnit ?? ""}
                              error={
                                fieldError(
                                  draft.compare
                                    ? "comparison.value"
                                    : "observation.value",
                                ) ?? fieldError("value")
                              }
                              onValue={(value) => updateDraft("value", value)}
                              onUnit={(value) => updateDraft("unit", value)}
                              onBlur={() => markTouched("observation.value")}
                            />
                          </div>

                          <div className={styles.fieldGrid}>
                            <div className={styles.field}>
                              <label htmlFor={`${question.id}-statistic`}>
                                Statistic
                              </label>
                              <select
                                id={`${question.id}-statistic`}
                                value={draft.statistic}
                                aria-invalid={Boolean(fieldError("statistic"))}
                                onChange={(event) =>
                                  updateDraft(
                                    "statistic",
                                    event.currentTarget.value,
                                  )
                                }
                                onBlur={() => markTouched("statistic")}
                              >
                                <option value="">Choose statistic</option>
                                {definition.allowedStatistics.map(
                                  (statistic) => (
                                    <option key={statistic} value={statistic}>
                                      {statisticLabel(statistic)}
                                    </option>
                                  ),
                                )}
                              </select>
                              <span className={styles.helpText}>
                                {definition.quantityKind === "score"
                                  ? "Keep the score definition and averaging rule visible."
                                  : "Keep the same statistic if you compare results."}
                              </span>
                              {renderError("statistic")}
                            </div>
                            {definition.allowedAveragingModes.length > 0 ? (
                              <div className={styles.field}>
                                <label htmlFor={`${question.id}-averaging`}>
                                  Averaging
                                </label>
                                <select
                                  id={`${question.id}-averaging`}
                                  value={draft.averagingMode}
                                  aria-invalid={Boolean(
                                    fieldError("averagingMode"),
                                  )}
                                  onChange={(event) => {
                                    updateDraft(
                                      "averagingMode",
                                      event.currentTarget.value,
                                    );
                                    updateContext(
                                      "averagingMode",
                                      event.currentTarget.value,
                                    );
                                  }}
                                  onBlur={() => markTouched("averagingMode")}
                                >
                                  <option value="">Choose averaging</option>
                                  {definition.allowedAveragingModes.map(
                                    (mode) => (
                                      <option key={mode} value={mode}>
                                        {mode.replaceAll("-", " ")}
                                      </option>
                                    ),
                                  )}
                                </select>
                                <span className={styles.helpText}>
                                  A 0.92 score can describe different metrics
                                  and averaging rules.
                                </span>
                                {renderError("averagingMode")}
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className={styles.contextSection}>
                          <div className={styles.sectionHeading}>
                            <h4>
                              What conditions make this result meaningful?
                            </h4>
                            <p>
                              Original units and context stay attached to the
                              preview.
                            </p>
                          </div>
                          <div className={styles.fieldGrid}>
                            {[
                              "capabilityId",
                              "taskType",
                              ...definition.requiredContextFields.filter(
                                (key) =>
                                  key !== "capabilityId" &&
                                  key !== "taskType" &&
                                  key !== "sampleCount" &&
                                  key !== "targetUnit",
                              ),
                              ...(definition.requiredContextFields.includes(
                                "sampleCount",
                              )
                                ? ["sampleCount"]
                                : []),
                              ...(definition.unitDimension === "contextual"
                                ? ["targetUnit"]
                                : []),
                            ].map((key) => renderContextField(key))}
                          </div>
                          <div className={styles.field}>
                            <label htmlFor={`${question.id}-sourceDescription`}>
                              {draft.mode === "report"
                                ? "Report source"
                                : "How was this measured?"}
                              <span className={styles.required}>Required</span>
                            </label>
                            <textarea
                              id={`${question.id}-sourceDescription`}
                              value={draft.sourceDescription}
                              aria-invalid={Boolean(
                                fieldError("evidence.sourceDescription"),
                              )}
                              onChange={(event) =>
                                updateDraft(
                                  "sourceDescription",
                                  event.currentTarget.value,
                                )
                              }
                              onBlur={() =>
                                markTouched("evidence.sourceDescription")
                              }
                              rows={2}
                              placeholder={
                                draft.mode === "report"
                                  ? "Report name, run, and where it came from"
                                  : "Test run, evaluation report, or measurement method"
                              }
                            />
                            <span className={styles.helpText}>
                              {draft.mode === "report"
                                ? "Documentation is shown as unverified until independently checked."
                                : draft.attestation === "user-attested"
                                  ? "Your statement is labeled as user-attested, not independently verified."
                                  : "Include enough detail to reproduce the scope and conditions."}
                            </span>
                            {renderError("evidence.sourceDescription")}
                          </div>
                        </div>

                        {draft.mode !== "target" && !draft.compare ? (
                          <button
                            type="button"
                            className={styles.secondaryAction}
                            onClick={() => updateDraft("compare", true)}
                          >
                            Add a comparable baseline
                          </button>
                        ) : null}

                        {recipe ? (
                          <details className={styles.recipe}>
                            <summary>View trusted measurement guide</summary>
                            <RecipeDetails recipe={recipe} />
                          </details>
                        ) : null}

                        {showLocalErrors && localErrors.length > 0 ? (
                          <div
                            className={styles.validationSummary}
                            role="alert"
                          >
                            <strong>
                              Some measurement details need attention.
                            </strong>
                            <ul>
                              {localErrors.map((error, index) => (
                                <li key={`${error.field}-${index}`}>
                                  {error.message}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {draft.mode === "target" ? (
                          <div
                            className={styles.targetNotice}
                            data-testid="measurement-target-state"
                          >
                            Future target only · it will never preview as an
                            achieved metric.
                          </div>
                        ) : null}

                        {engineCheck.clause && draft.mode !== "target" ? (
                          <div
                            className={
                              currentServerPreview
                                ? styles.serverPreview
                                : styles.localPreview
                            }
                            data-testid={
                              currentServerPreview
                                ? "measurement-server-preview"
                                : "measurement-local-preview"
                            }
                          >
                            <div className={styles.previewHeader}>
                              <strong>
                                {currentServerPreview
                                  ? "Current reviewed preview"
                                  : "Local preview · pending server review"}
                              </strong>
                              <span>
                                {currentServerPreview && serverPreview
                                  ? statusLabel(serverPreview.evidenceStatus)
                                  : draft.mode === "report"
                                    ? "Documented · unverified"
                                    : draft.attestation === "user-attested"
                                      ? "User-attested · not independently verified"
                                      : "Measured · awaiting server validation"}
                              </span>
                            </div>
                            {engineCheck.clause.kind === "metric-candidate" ||
                            engineCheck.clause.kind === "review-note" ? (
                              <p>{engineCheck.clause.clause}</p>
                            ) : null}
                            {definition && draft.compare ? (
                              <p className={styles.qualifier}>
                                Baseline {draft.baselineValue}{" "}
                                {draft.baselineUnit || draft.unit} and
                                comparison {draft.value} {draft.unit}; same
                                conditions required.
                              </p>
                            ) : null}
                            {currentServerPreview && answer ? (
                              <span className={styles.versionNote}>
                                Server answer version {answer.version}; preview{" "}
                                {serverPreview?.confirmed
                                  ? "confirmed"
                                  : "needs your review"}
                                .
                              </span>
                            ) : (
                              <span className={styles.versionNote}>
                                Editing any value or condition clears this
                                preview until the current answer is reviewed
                                again.
                              </span>
                            )}
                          </div>
                        ) : null}

                        <div className={styles.formActions}>
                          <button
                            className={styles.primaryAction}
                            type="submit"
                            disabled={
                              saving ||
                              (showLocalErrors && localErrors.length > 0)
                            }
                          >
                            {saving
                              ? "Preparing preview…"
                              : draft.mode === "target"
                                ? "Save future target"
                                : "Preview measurement"}
                          </button>
                          <span className={styles.actionNote}>
                            Saves only this answer for review. It does not save
                            an achievement or call AI.
                          </span>
                        </div>
                      </>
                    ) : null}
                  </form>
                </>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function ValueFields({
  questionId,
  prefix,
  label,
  value,
  unit,
  units,
  contextualUnit,
  targetUnit,
  error,
  onValue,
  onUnit,
  onBlur,
}: {
  questionId: string;
  prefix: string;
  label: string;
  value: string;
  unit: string;
  units: readonly string[];
  contextualUnit: boolean;
  targetUnit: string;
  error: string | undefined;
  onValue(value: string): void;
  onUnit(value: string): void;
  onBlur(): void;
}) {
  const valueId = `${questionId}-${prefix}-value`;
  const unitId = `${questionId}-${prefix}-unit`;
  const contextUnitId = `${questionId}-targetUnit`;
  const chosenUnit = unit || targetUnit;
  return (
    <div className={styles.valueGroup}>
      <label htmlFor={valueId}>{label}</label>
      <div className={styles.valueControl}>
        <input
          id={valueId}
          type="number"
          step="any"
          value={value}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${valueId}-error` : undefined}
          onChange={(event) => onValue(event.currentTarget.value)}
          onBlur={onBlur}
          placeholder="Enter the observed value"
        />
        {contextualUnit ? (
          <span
            className={styles.unitReadout}
            aria-label="Unit comes from target unit"
          >
            {chosenUnit || "target unit"}
          </span>
        ) : (
          <select
            id={unitId}
            aria-label={`${label} unit`}
            value={chosenUnit}
            aria-invalid={Boolean(error)}
            onChange={(event) => onUnit(event.currentTarget.value)}
            onBlur={onBlur}
          >
            <option value="">Unit</option>
            {chosenUnit && !units.includes(chosenUnit) ? (
              <option value={chosenUnit}>{chosenUnit} · review unit</option>
            ) : null}
            {units.map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>
        )}
      </div>
      {contextualUnit ? (
        <span className={styles.helpText} id={`${contextUnitId}-help`}>
          The metric uses the same physical unit as the prediction target.
        </span>
      ) : null}
      {error ? (
        <span
          className={styles.fieldError}
          id={`${valueId}-error`}
          role="alert"
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}

function RecipeDetails({
  recipe,
}: {
  recipe: ReturnType<typeof getMeasurementRecipe> | undefined;
}) {
  if (!recipe) {
    return (
      <p className={styles.helpText}>
        No trusted recipe is available for this definition. Continue
        qualitatively if the method is unclear.
      </p>
    );
  }
  return (
    <div className={styles.recipeBody} data-testid="measurement-recipe">
      <strong>{recipe.title}</strong>
      <p>{recipe.summary}</p>
      <ol>
        {recipe.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {recipe.cautions.length > 0 ? (
        <ul className={styles.recipeCautions}>
          {recipe.cautions.map((caution) => (
            <li key={caution}>{caution}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function statisticLabel(value: string) {
  const labels: Record<string, string> = {
    p50: "p50 (median)",
    p95: "p95",
    "single-evaluation": "Single evaluation",
    "rate-over-window": "Rate over a fixed window",
    mean: "Mean",
  };
  return labels[value] ?? value;
}
