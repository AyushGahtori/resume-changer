"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { LIBRARY_ACTIONS } from "@/lib/ui/library-actions";
import { metricOpportunities } from "@/lib/ai/metric-opportunities";
import type {
  AchievementPoint,
  AchievementSource,
  Metric,
  Skill,
} from "@/lib/schemas/resume-data";

export type ParentOption = {
  id: string;
  label: string;
  type: "job" | "project";
};
type Props = {
  initialPoint?: AchievementPoint;
  /** Render the editor within its achievement card instead of as a new card. */
  inline?: boolean;
  parents: ParentOption[];
  skills: Skill[];
  onCancel: () => void;
  onSaved: () => void;
  /**
   * Moves focus to the first field when the editor opens. Only the new
   * entry flow uses it, so a keyboard user lands on the identifier field
   * instead of somewhere above the form.
   */
  focusFirstField?: boolean;
};

type MetricDraft = Metric;

const sourceTypes: AchievementSource["type"][] = [
  "resume",
  "linkedin",
  "user-notes",
  "project-document",
  "direct-user",
];

function optional(value: string) {
  const trimmed = value.trim();
  return trimmed || undefined;
}

export default function AchievementPointEditor({
  initialPoint,
  inline = false,
  parents,
  skills,
  onCancel,
  onSaved,
  focusFirstField = false,
}: Props) {
  const isEditing = Boolean(initialPoint);
  const idFieldRef = useRef<HTMLInputElement>(null);
  const textFieldRef = useRef<HTMLTextAreaElement>(null);
  const [pointId, setPointId] = useState(initialPoint?.id ?? "");
  const [parentKey, setParentKey] = useState(
    parents[0] ? `${parents[0].type}:${parents[0].id}` : "",
  );
  const [text, setText] = useState(initialPoint?.text ?? "");
  const [tags, setTags] = useState(initialPoint?.tags.join(", ") ?? "");
  const [skillIds, setSkillIds] = useState(initialPoint?.skillIds ?? []);
  const [enabled, setEnabled] = useState(initialPoint?.enabled ?? true);
  const [sourceType, setSourceType] = useState<AchievementSource["type"]>(
    initialPoint?.source.type ?? "direct-user",
  );
  const [sourceLabel, setSourceLabel] = useState(
    initialPoint?.source.label ?? "",
  );
  const [sourceReference, setSourceReference] = useState(
    initialPoint?.source.reference ?? "",
  );
  const [metrics, setMetrics] = useState<MetricDraft[]>(
    initialPoint?.metrics ?? [],
  );
  const opportunities = metricOpportunities({
    text,
    context: initialPoint?.context,
    metrics,
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const closeAction = LIBRARY_ACTIONS["close-editor"];
  const addMetricAction = LIBRARY_ACTIONS["add-metric"];
  const removeMetricAction = LIBRARY_ACTIONS["remove-metric"];
  const CloseIcon = closeAction.icon;
  const AddMetricIcon = addMetricAction.icon;
  const RemoveMetricIcon = removeMetricAction.icon;

  useEffect(() => {
    const field = isEditing
      ? textFieldRef.current
      : focusFirstField
        ? idFieldRef.current
        : null;
    field?.focus();
  }, [focusFirstField, isEditing]);

  function toggleSkill(id: string) {
    setSkillIds((current) =>
      current.includes(id)
        ? current.filter((skillId) => skillId !== id)
        : [...current, id],
    );
  }

  function updateMetric(index: number, key: keyof MetricDraft, value: string) {
    setMetrics((current) =>
      current.map((metric, metricIndex) =>
        metricIndex === index ? { ...metric, [key]: value } : metric,
      ),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");

    const source: AchievementSource = {
      type: sourceType,
      ...(optional(sourceLabel) ? { label: optional(sourceLabel) } : {}),
      ...(optional(sourceReference)
        ? { reference: optional(sourceReference) }
        : {}),
    };
    const point = {
      id: pointId.trim(),
      text: text.trim(),
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      skillIds,
      metrics: metrics.map((metric) => ({
        id: metric.id.trim(),
        label: metric.label.trim(),
        value: metric.value.trim(),
        evidence: metric.evidence.trim(),
        ...(metric.unit?.trim() ? { unit: metric.unit.trim() } : {}),
        ...(metric.context?.trim() ? { context: metric.context.trim() } : {}),
      })),
      source,
      enabled,
    };

    try {
      const parent = parents.find(
        (option) => `${option.type}:${option.id}` === parentKey,
      );
      const response = await fetch(
        isEditing
          ? `/api/library/points/${encodeURIComponent(pointId)}`
          : "/api/library/points",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isEditing
              ? { changes: { ...point, id: undefined } }
              : { parentType: parent?.type, parentId: parent?.id, point },
          ),
        },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "The achievement could not be saved.");
        return;
      }
      onSaved();
    } catch {
      setError("Could not reach the local save service. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className={inline ? "point-editor is-inline" : "point-editor"}
      onSubmit={submit}
    >
      <div className="point-editor-heading">
        <div>
          <p className="eyebrow">
            {isEditing ? "UPDATE LIBRARY" : "NEW ENTRY"}
          </p>
          <h2>{isEditing ? "Edit achievement" : "Add achievement"}</h2>
        </div>
        <button
          aria-label={closeAction.label}
          className="icon-button"
          onClick={onCancel}
          title={closeAction.label}
          type="button"
        >
          <CloseIcon
            aria-hidden="true"
            size={closeAction.iconSize}
            strokeWidth={2}
          />
        </button>
      </div>

      {!isEditing && (
        <div className="editor-grid">
          <label className="editor-field">
            <span>Achievement ID</span>
            <input
              autoComplete="off"
              onChange={(event) => setPointId(event.target.value)}
              placeholder="achievement-example"
              ref={idFieldRef}
              required
              value={pointId}
            />
          </label>
          <label className="editor-field">
            <span>Job or project</span>
            <select
              onChange={(event) => setParentKey(event.target.value)}
              required
              value={parentKey}
            >
              {parents.map((parent) => (
                <option
                  key={`${parent.type}:${parent.id}`}
                  value={`${parent.type}:${parent.id}`}
                >
                  {parent.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <label className="editor-field">
        <span>Achievement text</span>
        <textarea
          onChange={(event) => setText(event.target.value)}
          ref={textFieldRef}
          required
          rows={4}
          value={text}
        />
      </label>

      <div className="editor-grid">
        <label className="editor-field">
          <span>Tags, separated by commas</span>
          <input
            onChange={(event) => setTags(event.target.value)}
            placeholder="backend, reliability"
            value={tags}
          />
        </label>
        <label className="editor-field">
          <span>Provenance type</span>
          <select
            onChange={(event) =>
              setSourceType(event.target.value as AchievementSource["type"])
            }
            value={sourceType}
          >
            {sourceTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className="editor-field">
          <span>Source label</span>
          <input
            onChange={(event) => setSourceLabel(event.target.value)}
            value={sourceLabel}
          />
        </label>
        <label className="editor-field">
          <span>Source reference</span>
          <input
            onChange={(event) => setSourceReference(event.target.value)}
            value={sourceReference}
          />
        </label>
      </div>

      <label className="editor-field editor-skills">
        <span>Linked skills</span>
        <select
          multiple
          onChange={(event) =>
            setSkillIds(
              Array.from(
                event.currentTarget.selectedOptions,
                (option) => option.value,
              ),
            )
          }
          size={Math.min(6, Math.max(3, skills.length))}
          value={skillIds}
        >
          {skills.map((skill) => (
            <option key={skill.id} value={skill.id}>
              {skill.name}
            </option>
          ))}
        </select>
      </label>

      <section className="metric-editor" aria-label="Achievement metrics">
        <div className="metric-editor-heading">
          <h3>Metrics</h3>
          <button
            className="ui-button ui-button--tertiary ui-button--compact"
            onClick={() =>
              setMetrics((current) => [
                ...current,
                {
                  id: `metric-${crypto.randomUUID().slice(0, 8)}`,
                  label: "",
                  value: "",
                  evidence: "",
                },
              ])
            }
            type="button"
          >
            <AddMetricIcon
              aria-hidden="true"
              size={addMetricAction.iconSize}
              strokeWidth={2}
            />
            {addMetricAction.label}
          </button>
        </div>
        {opportunities.length > 0 && (
          <div className="metric-opportunities">
            <p>Possible measurements to check in your records:</p>
            <ul>
              {opportunities.map((opportunity) => (
                <li key={opportunity.id}>
                  <span>{opportunity.question}</span>{" "}
                  <button
                    className="ui-button ui-button--tertiary ui-button--compact"
                    onClick={() =>
                      setMetrics((current) => [
                        ...current,
                        {
                          id: `metric-${crypto.randomUUID().slice(0, 8)}`,
                          label: opportunity.label,
                          value: "",
                          evidence: "",
                          context: "",
                        },
                      ])
                    }
                    type="button"
                  >
                    Add verified metric
                  </button>
                  <small>{opportunity.evidenceHint}</small>
                </li>
              ))}
            </ul>
          </div>
        )}
        {metrics.map((metric, index) => (
          <fieldset className="metric-fields" key={metric.id}>
            <legend>Metric {index + 1}</legend>
            <label className="editor-field">
              <span>Metric ID</span>
              <input readOnly value={metric.id} />
            </label>
            <label className="editor-field">
              <span>Label</span>
              <input
                onChange={(event) =>
                  updateMetric(index, "label", event.target.value)
                }
                required
                value={metric.label}
              />
            </label>
            <label className="editor-field">
              <span>Value</span>
              <input
                onChange={(event) =>
                  updateMetric(index, "value", event.target.value)
                }
                required
                value={metric.value}
              />
            </label>
            <label className="editor-field">
              <span>Unit</span>
              <input
                onChange={(event) =>
                  updateMetric(index, "unit", event.target.value)
                }
                value={metric.unit ?? ""}
              />
            </label>
            <label className="editor-field">
              <span>Context (baseline, timeframe, and outcome)</span>
              <input
                onChange={(event) =>
                  updateMetric(index, "context", event.target.value)
                }
                value={metric.context ?? ""}
              />
            </label>
            <label className="editor-field metric-evidence">
              <span>Evidence</span>
              <textarea
                onChange={(event) =>
                  updateMetric(index, "evidence", event.target.value)
                }
                required
                rows={2}
                value={metric.evidence}
              />
            </label>
            <button
              className="ui-button ui-button--tertiary ui-button--compact metric-remove"
              onClick={() =>
                setMetrics((current) =>
                  current.filter((_, metricIndex) => metricIndex !== index),
                )
              }
              type="button"
            >
              <RemoveMetricIcon
                aria-hidden="true"
                size={removeMetricAction.iconSize}
                strokeWidth={2}
              />
              {removeMetricAction.label}
            </button>
          </fieldset>
        ))}
      </section>

      <label className="editor-enabled">
        <input
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          type="checkbox"
        />
        <span>Use this point in resume selection</span>
      </label>

      {error && (
        <p className="editor-error" role="alert">
          {error}
        </p>
      )}
      <div className="editor-actions">
        <button
          className="ui-button ui-button--secondary"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="ui-button ui-button--primary"
          disabled={saving}
          type="submit"
        >
          {saving ? "Saving…" : "Save achievement"}
        </button>
      </div>
    </form>
  );
}
