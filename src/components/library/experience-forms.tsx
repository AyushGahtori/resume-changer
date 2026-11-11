"use client";

import { Plus } from "lucide-react";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { apiFetch } from "@/lib/cloud/api-fetch";

const SAVE_ERROR = "Could not save this change. Try again.";

const employmentTypes = [
  ["full-time", "Full-time"],
  ["part-time", "Part-time"],
  ["contract", "Contract"],
  ["internship", "Internship"],
  ["freelance", "Freelance"],
  ["other", "Other"],
] as const;

type EmploymentType = (typeof employmentTypes)[number][0];

export type JobFormValues = {
  id?: string;
  company?: string;
  title?: string;
  employmentType?: EmploymentType;
  location?: string;
  startDate?: string;
  endDate?: string | null;
  description?: string;
  currentlyEmployed?: boolean;
};

export type ProjectFormValues = {
  id?: string;
  name?: string;
  role?: string;
  url?: string;
  description?: string;
  startDate?: string | null;
  endDate?: string | null;
  ongoing?: boolean;
};

type FormProps<T> = {
  mode: "create" | "edit";
  initial?: T;
  onSaved: (changed?: boolean) => void;
  onCancel?: () => void;
};

function isEmploymentType(value: string): value is EmploymentType {
  return employmentTypes.some(([item]) => item === value);
}

async function sendJson(
  url: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
) {
  const response = await apiFetch(url, {
    method,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = (await response.json().catch(() => null)) as {
    error?: string;
    changed?: boolean;
  } | null;
  return { response, result };
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="editor-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function FormError({ id, message }: { id: string; message: string }) {
  if (!message) return null;
  return (
    <p className="editor-error" id={id} role="alert">
      {message}
    </p>
  );
}

function FormActions({
  saving,
  submitLabel,
  onCancel,
}: {
  saving: boolean;
  submitLabel: string;
  onCancel?: () => void;
}) {
  return (
    <div className="editor-actions">
      {onCancel ? (
        <button
          className="ui-button ui-button--secondary"
          disabled={saving}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      ) : null}
      <button
        className="ui-button ui-button--primary"
        disabled={saving}
        type="submit"
      >
        {saving ? "Saving…" : submitLabel}
      </button>
    </div>
  );
}

export function JobForm({
  mode,
  initial,
  onSaved,
  onCancel,
}: FormProps<JobFormValues>) {
  const errorId = useId();
  const recordId = useRef(initial?.id ?? "");
  const [company, setCompany] = useState(initial?.company ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [employmentType, setEmploymentType] = useState<EmploymentType | "">(
    initial?.employmentType ?? "",
  );
  const [location, setLocation] = useState(initial?.location ?? "");
  const [startDate, setStartDate] = useState(initial?.startDate ?? "");
  const [endDate, setEndDate] = useState(
    typeof initial?.endDate === "string" ? initial.endDate : "",
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [currentlyEmployed, setCurrentlyEmployed] = useState(
    initial?.currentlyEmployed === true || initial?.endDate === null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (mode === "edit" && !initial?.id) {
      setError(SAVE_ERROR);
      return;
    }
    setSaving(true);
    setError("");
    recordId.current ||= "job-" + crypto.randomUUID();
    const path = `/api/library/jobs/${encodeURIComponent(recordId.current)}`;
    try {
      const { response, result } = await sendJson(path, "PUT", {
        changes: {
          company,
          title,
          employmentType,
          location,
          startDate,
          endDate: currentlyEmployed ? null : endDate,
          description,
        },
      });
      if (!response.ok) {
        setError(result?.error || SAVE_ERROR);
        return;
      }
      onSaved(result?.changed !== false);
    } catch {
      setError(SAVE_ERROR);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      aria-describedby={error ? errorId : undefined}
      aria-label={mode === "create" ? "Add job" : "Edit job"}
      className="library-entry"
      onSubmit={save}
    >
      <div className="point-editor-heading">
        <div>
          <p className="eyebrow">
            {mode === "create" ? "NEW JOB" : "UPDATE JOB"}
          </p>
          <h2>{mode === "create" ? "Add a job" : "Edit job"}</h2>
        </div>
      </div>
      <div className="editor-grid">
        <Field label="Employer">
          <input
            autoComplete="organization"
            name="company"
            onChange={(event) => setCompany(event.target.value)}
            value={company}
          />
        </Field>
        <Field label="Title">
          <input
            autoComplete="organization-title"
            name="title"
            onChange={(event) => setTitle(event.target.value)}
            value={title}
          />
        </Field>
        <Field label="Employment type">
          <select
            name="employmentType"
            onChange={(event) => {
              if (
                event.target.value === "" ||
                isEmploymentType(event.target.value)
              ) {
                setEmploymentType(event.target.value);
              }
            }}
            value={employmentType}
          >
            <option value="">Not specified</option>
            {employmentTypes.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Location">
          <input
            autoComplete="address-level2"
            name="location"
            onChange={(event) => setLocation(event.target.value)}
            value={location}
          />
        </Field>
        <Field label="Start date">
          <input
            name="startDate"
            onChange={(event) => setStartDate(event.target.value)}
            type="month"
            value={startDate}
          />
        </Field>
        <Field label="End date">
          <input
            disabled={currentlyEmployed}
            name="endDate"
            onChange={(event) => setEndDate(event.target.value)}
            type="month"
            value={endDate}
          />
        </Field>
      </div>
      <label className="editor-enabled">
        <input
          checked={currentlyEmployed}
          name="currentlyEmployed"
          onChange={(event) => setCurrentlyEmployed(event.target.checked)}
          type="checkbox"
        />
        I currently work here
      </label>
      <Field label="Description">
        <textarea
          name="description"
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          value={description}
        />
      </Field>
      <FormError id={errorId} message={error} />
      <FormActions
        onCancel={onCancel}
        saving={saving}
        submitLabel={mode === "create" ? "Save job" : "Save changes"}
      />
    </form>
  );
}

export function ProjectForm({
  mode,
  initial,
  onSaved,
  onCancel,
}: FormProps<ProjectFormValues>) {
  const errorId = useId();
  const recordId = useRef(initial?.id ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [startDate, setStartDate] = useState(
    typeof initial?.startDate === "string" ? initial.startDate : "",
  );
  const [endDate, setEndDate] = useState(
    typeof initial?.endDate === "string" ? initial.endDate : "",
  );
  const [ongoing, setOngoing] = useState(
    initial?.ongoing === true || initial?.endDate === null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (mode === "edit" && !initial?.id) {
      setError(SAVE_ERROR);
      return;
    }
    setSaving(true);
    setError("");
    recordId.current ||= "project-" + crypto.randomUUID();
    const path = `/api/library/projects/${encodeURIComponent(recordId.current)}`;
    try {
      const { response, result } = await sendJson(path, "PUT", {
        changes: {
          name,
          role,
          url,
          description,
          startDate,
          endDate: ongoing ? null : endDate,
        },
      });
      if (!response.ok) {
        setError(result?.error || SAVE_ERROR);
        return;
      }
      onSaved(result?.changed !== false);
    } catch {
      setError(SAVE_ERROR);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      aria-describedby={error ? errorId : undefined}
      aria-label={mode === "create" ? "Add project" : "Edit project"}
      className="library-entry"
      onSubmit={save}
    >
      <div className="point-editor-heading">
        <div>
          <p className="eyebrow">
            {mode === "create" ? "NEW PROJECT" : "UPDATE PROJECT"}
          </p>
          <h2>{mode === "create" ? "Add a project" : "Edit project"}</h2>
        </div>
      </div>
      <div className="editor-grid">
        <Field label="Project name">
          <input
            name="name"
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </Field>
        <Field label="Role">
          <input
            name="role"
            onChange={(event) => setRole(event.target.value)}
            value={role}
          />
        </Field>
        <Field label="URL">
          <input
            inputMode="url"
            name="url"
            onChange={(event) => setUrl(event.target.value)}
            type="url"
            value={url}
          />
        </Field>
        <Field label="Description">
          <textarea
            name="description"
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            value={description}
          />
        </Field>
        <Field label="Start date">
          <input
            name="startDate"
            onChange={(event) => setStartDate(event.target.value)}
            type="month"
            value={startDate}
          />
        </Field>
        <Field label="End date">
          <input
            disabled={ongoing}
            name="endDate"
            onChange={(event) => setEndDate(event.target.value)}
            type="month"
            value={endDate}
          />
        </Field>
      </div>
      <label className="editor-enabled">
        <input
          checked={ongoing}
          name="ongoing"
          onChange={(event) => setOngoing(event.target.checked)}
          type="checkbox"
        />
        This project is ongoing
      </label>
      <FormError id={errorId} message={error} />
      <FormActions
        onCancel={onCancel}
        saving={saving}
        submitLabel={mode === "create" ? "Save project" : "Save changes"}
      />
    </form>
  );
}

export function AddJobButton({
  onSaved,
}: {
  onSaved: (changed?: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        className="ui-button ui-button--secondary"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Plus aria-hidden="true" size={16} strokeWidth={2} />
        Add job
      </button>
    );
  }
  return (
    <JobForm
      mode="create"
      onCancel={() => setOpen(false)}
      onSaved={(changed) => {
        setOpen(false);
        onSaved(changed);
      }}
    />
  );
}

export function AddProjectButton({
  onSaved,
}: {
  onSaved: (changed?: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        className="ui-button ui-button--secondary"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Plus aria-hidden="true" size={16} strokeWidth={2} />
        Add project
      </button>
    );
  }
  return (
    <ProjectForm
      mode="create"
      onCancel={() => setOpen(false)}
      onSaved={(changed) => {
        setOpen(false);
        onSaved(changed);
      }}
    />
  );
}

export function RemoveRecordButton({
  kind,
  id,
  pointCount,
  name,
  onRemoved,
}: {
  kind: "job" | "project";
  id: string;
  pointCount: number;
  name: string;
  onRemoved: () => void;
}) {
  const warningId = useId();
  const errorId = useId();
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const noun = kind === "job" ? "job" : "project";

  async function remove() {
    if (removing) return;
    setRemoving(true);
    setError("");
    try {
      const { response, result } = await sendJson(
        `/api/library/${kind === "job" ? "jobs" : "projects"}/${encodeURIComponent(id)}`,
        "DELETE",
      );
      if (!response.ok) {
        setError(result?.error || SAVE_ERROR);
        return;
      }
      onRemoved();
    } catch {
      setError(SAVE_ERROR);
    } finally {
      setRemoving(false);
    }
  }

  if (!confirming) {
    return (
      <button
        aria-label={`Remove ${name}`}
        className="ui-button ui-button--tertiary ui-button--compact"
        onClick={() => setConfirming(true)}
        type="button"
      >
        Remove
      </button>
    );
  }

  return (
    <div>
      <p id={warningId}>
        {`Removing ${name} also removes its ${pointCount} achievements and cannot be undone.`}
      </p>
      <FormError id={errorId} message={error} />
      <div className="editor-actions">
        <button
          className="ui-button ui-button--secondary"
          disabled={removing}
          onClick={() => {
            setConfirming(false);
            setError("");
          }}
          type="button"
        >
          Cancel
        </button>
        <button
          aria-describedby={warningId}
          className="ui-button ui-button--primary"
          disabled={removing}
          onClick={remove}
          type="button"
        >
          {removing ? "Removing…" : `Remove ${noun}`}
        </button>
      </div>
    </div>
  );
}
