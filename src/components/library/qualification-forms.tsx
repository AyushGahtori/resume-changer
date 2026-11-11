"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { apiFetch } from "@/lib/cloud/api-fetch";
import type { Credential, Education } from "@/lib/schemas/resume-data";

const NETWORK_ERROR = "Could not save this change. Try again.";

type SaveResult =
  { ok: true; result: Record<string, unknown> } | { ok: false; error: string };

async function sendJson(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<SaveResult> {
  try {
    const response = await apiFetch(url, {
      method,
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!response.ok) {
      const error =
        typeof result?.error === "string" && result.error
          ? result.error
          : NETWORK_ERROR;
      return { ok: false, error };
    }
    return { ok: true, result: result ?? {} };
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

function FormError({ id, message }: { id: string; message: string }) {
  if (!message) return null;
  return (
    <p className="editor-error" id={id} role="alert">
      {message}
    </p>
  );
}

function LabeledControl({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="editor-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function skillSummary(createdCount: number, skipped: string[]) {
  const added = `Added ${createdCount} ${createdCount === 1 ? "skill" : "skills"}.`;
  if (skipped.length === 0) return added;
  return `${added} Already in the library: ${skipped.join(", ")}.`;
}

function hasSkillText(value: string) {
  return value.split(/[,\n\r]+/).some((part) => part.trim().length > 0);
}

export function SkillPasteForm({ onSaved }: { onSaved: () => void }) {
  const errorId = useId();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasSkillText(text) || saving) return;
    setSaving(true);
    setError("");
    setSummary("");
    const outcome = await sendJson("/api/library/skills/bulk", "POST", {
      text,
    });
    setSaving(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    const created = outcome.result.created;
    const skipped = outcome.result.skipped;
    if (!Array.isArray(created) || !Array.isArray(skipped)) {
      setError(NETWORK_ERROR);
      return;
    }
    const skippedNames = skipped.filter(
      (name): name is string => typeof name === "string",
    );
    setSummary(skillSummary(created.length, skippedNames));
    setText("");
    onSaved();
  }

  return (
    <form aria-label="Add skills" className="library-entry" onSubmit={submit}>
      <div className="point-editor-heading">
        <div>
          <p className="eyebrow">SKILLS</p>
          <h2>Add skills</h2>
        </div>
      </div>
      <LabeledControl label="Skills">
        <textarea
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            setText(event.target.value);
            setError("");
          }}
          placeholder="Paste skills separated by commas or new lines"
          rows={5}
          value={text}
        />
      </LabeledControl>
      <FormError id={errorId} message={error} />
      {summary ? <p role="status">{summary}</p> : null}
      <div className="editor-actions">
        <button
          className="ui-button ui-button--primary"
          disabled={saving || !hasSkillText(text)}
          type="submit"
        >
          {saving ? "Adding…" : "Add skills"}
        </button>
      </div>
    </form>
  );
}

type EducationFormProps = {
  onSaved: () => void;
  onCancel?: () => void;
} & ({ mode: "create" } | { mode: "edit"; education: Education });

export function EducationForm(props: EducationFormProps) {
  const errorId = useId();
  const existing = props.mode === "edit" ? props.education : undefined;
  const [institution, setInstitution] = useState(
    existing?.institutions[0] ?? "",
  );
  const [degree, setDegree] = useState(existing?.degree ?? "");
  const [fieldOfStudy, setFieldOfStudy] = useState(
    existing?.fieldOfStudy ?? "",
  );
  const [programName, setProgramName] = useState(existing?.programName ?? "");
  const [startDate, setStartDate] = useState(existing?.startDate ?? "");
  const [currentlyStudying, setCurrentlyStudying] = useState(
    existing?.endDate === null,
  );
  const [endDate, setEndDate] = useState(existing?.endDate ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const canSave =
    institution.trim().length > 0 &&
    degree.trim().length > 0 &&
    fieldOfStudy.trim().length > 0 &&
    !saving;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError("");
    const firstInstitution = institution.trim();
    const keptInstitutions =
      props.mode === "edit"
        ? props.education.institutions
            .slice(1)
            .filter((name) => name !== firstInstitution)
        : [];
    const payload = {
      institutions: [firstInstitution, ...keptInstitutions],
      degree: degree.trim(),
      fieldOfStudy: fieldOfStudy.trim(),
      programName: programName.trim() || null,
      description: description.trim() || null,
      startDate: startDate || null,
      currentlyStudying,
      endDate: currentlyStudying ? null : endDate || null,
    };
    const outcome =
      props.mode === "edit"
        ? await sendJson(
            `/api/library/education/${encodeURIComponent(props.education.id)}`,
            "PATCH",
            payload,
          )
        : await sendJson("/api/library/education", "POST", payload);
    setSaving(false);
    if (!outcome.ok || !outcome.result.education) {
      setError(outcome.ok ? NETWORK_ERROR : outcome.error);
      return;
    }
    props.onSaved();
  }

  return (
    <form
      aria-describedby={error ? errorId : undefined}
      aria-label={props.mode === "create" ? "Add a degree" : "Edit degree"}
      className="library-entry"
      onSubmit={submit}
    >
      <div className="point-editor-heading">
        <div>
          <p className="eyebrow">
            {props.mode === "create" ? "NEW EDUCATION" : "UPDATE EDUCATION"}
          </p>
          <h2>
            {props.mode === "create" ? "Add education" : "Edit education"}
          </h2>
        </div>
      </div>
      <div className="editor-grid">
        <LabeledControl label="Institution">
          <input
            onChange={(event) => setInstitution(event.target.value)}
            required
            value={institution}
          />
        </LabeledControl>
        {props.mode === "edit" && props.education.institutions.length > 1 ? (
          <p className="editor-span secondary-empty">
            Also listed: {props.education.institutions.slice(1).join(", ")}
          </p>
        ) : null}
        <LabeledControl label="Degree">
          <input
            onChange={(event) => setDegree(event.target.value)}
            required
            value={degree}
          />
        </LabeledControl>
        <LabeledControl label="Field of study">
          <input
            onChange={(event) => setFieldOfStudy(event.target.value)}
            required
            value={fieldOfStudy}
          />
        </LabeledControl>
        <LabeledControl label="Program (optional)">
          <input
            onChange={(event) => setProgramName(event.target.value)}
            value={programName}
          />
        </LabeledControl>
        <LabeledControl label="Start month (optional)">
          <input
            onChange={(event) => setStartDate(event.target.value)}
            type="month"
            value={startDate}
          />
        </LabeledControl>
      </div>
      <label className="editor-enabled">
        <input
          checked={currentlyStudying}
          onChange={(event) => setCurrentlyStudying(event.target.checked)}
          type="checkbox"
        />
        I currently study here
      </label>
      <div className="editor-grid">
        <LabeledControl label="End month (optional)">
          <input
            disabled={currentlyStudying}
            onChange={(event) => setEndDate(event.target.value)}
            type="month"
            value={currentlyStudying ? "" : (endDate ?? "")}
          />
        </LabeledControl>
        <LabeledControl label="Description (optional)">
          <textarea
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            value={description}
          />
        </LabeledControl>
      </div>
      <FormError id={errorId} message={error} />
      <div className="editor-actions">
        {props.onCancel ? (
          <button
            className="ui-button ui-button--secondary"
            onClick={props.onCancel}
            type="button"
          >
            Cancel
          </button>
        ) : null}
        <button
          className="ui-button ui-button--primary"
          disabled={!canSave}
          type="submit"
        >
          {saving ? "Saving…" : "Save degree"}
        </button>
      </div>
    </form>
  );
}

export function RemoveEducationButton({
  id,
  onRemoved,
}: {
  id: string;
  onRemoved: () => void;
}) {
  const errorId = useId();
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    if (removing) return;
    setRemoving(true);
    setError("");
    const outcome = await sendJson(
      `/api/library/education/${encodeURIComponent(id)}`,
      "DELETE",
    );
    setRemoving(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    onRemoved();
  }

  return (
    <>
      <button
        className="ui-button ui-button--tertiary ui-button--compact"
        disabled={removing}
        onClick={remove}
        type="button"
      >
        {removing ? "Removing…" : "Remove degree"}
      </button>
      <FormError id={errorId} message={error} />
    </>
  );
}

type CredentialFormProps = {
  onSaved: () => void;
  onCancel?: () => void;
} & ({ mode: "create" } | { mode: "edit"; credential: Credential });

export function CredentialForm(props: CredentialFormProps) {
  const errorId = useId();
  const existing = props.mode === "edit" ? props.credential : undefined;
  const [name, setName] = useState(existing?.name ?? "");
  const [issuer, setIssuer] = useState(existing?.issuer ?? "");
  const [kind, setKind] = useState<"license" | "certificate">(
    existing?.kind ?? "certificate",
  );
  const [issuedDate, setIssuedDate] = useState(existing?.issuedDate ?? "");
  const [expiresDate, setExpiresDate] = useState(existing?.expiresDate ?? "");
  const [credentialId, setCredentialId] = useState(
    existing?.credentialId ?? "",
  );
  const [url, setUrl] = useState(existing?.url ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const canSave = name.trim().length > 0 && issuer.trim().length > 0 && !saving;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError("");
    const payload = {
      name: name.trim(),
      issuer: issuer.trim(),
      kind,
      issuedDate: issuedDate || null,
      expiresDate: expiresDate || null,
      credentialId: credentialId.trim() || null,
      url: url.trim() || null,
    };
    const outcome =
      props.mode === "edit"
        ? await sendJson(
            `/api/library/credentials/${encodeURIComponent(props.credential.id)}`,
            "PATCH",
            payload,
          )
        : await sendJson("/api/library/credentials", "POST", payload);
    setSaving(false);
    if (!outcome.ok || !outcome.result.credential) {
      setError(outcome.ok ? NETWORK_ERROR : outcome.error);
      return;
    }
    props.onSaved();
  }

  return (
    <form
      aria-describedby={error ? errorId : undefined}
      aria-label={
        props.mode === "create" ? "Add a credential" : "Edit credential"
      }
      className="library-entry"
      onSubmit={submit}
    >
      <div className="point-editor-heading">
        <div>
          <p className="eyebrow">
            {props.mode === "create" ? "NEW CREDENTIAL" : "UPDATE CREDENTIAL"}
          </p>
          <h2>
            {props.mode === "create" ? "Add a credential" : "Edit credential"}
          </h2>
        </div>
      </div>
      <div className="editor-grid">
        <LabeledControl label="Name">
          <input
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        </LabeledControl>
        <LabeledControl label="Issuer">
          <input
            onChange={(event) => setIssuer(event.target.value)}
            required
            value={issuer}
          />
        </LabeledControl>
        <LabeledControl label="Kind">
          <select
            onChange={(event) => {
              const value = event.target.value;
              if (value === "license" || value === "certificate")
                setKind(value);
            }}
            value={kind}
          >
            <option value="certificate">Certificate</option>
            <option value="license">License</option>
          </select>
        </LabeledControl>
        <LabeledControl label="Issued date (optional)">
          <input
            onChange={(event) => setIssuedDate(event.target.value)}
            type="date"
            value={issuedDate}
          />
        </LabeledControl>
        <LabeledControl label="Expires (optional)">
          <input
            onChange={(event) => setExpiresDate(event.target.value)}
            type="date"
            value={expiresDate}
          />
        </LabeledControl>
        <LabeledControl label="Credential ID (optional)">
          <input
            autoComplete="off"
            onChange={(event) => setCredentialId(event.target.value)}
            value={credentialId}
          />
        </LabeledControl>
        <LabeledControl label="Verification URL (optional)">
          <input
            onChange={(event) => setUrl(event.target.value)}
            type="url"
            value={url}
          />
        </LabeledControl>
      </div>
      <FormError id={errorId} message={error} />
      <div className="editor-actions">
        {props.onCancel ? (
          <button
            className="ui-button ui-button--secondary"
            onClick={props.onCancel}
            type="button"
          >
            Cancel
          </button>
        ) : null}
        <button
          className="ui-button ui-button--primary"
          disabled={!canSave}
          type="submit"
        >
          {saving ? "Saving…" : "Save credential"}
        </button>
      </div>
    </form>
  );
}

export function RemoveCredentialButton({
  id,
  onRemoved,
}: {
  id: string;
  onRemoved: () => void;
}) {
  const errorId = useId();
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    if (removing) return;
    setRemoving(true);
    setError("");
    const outcome = await sendJson(
      `/api/library/credentials/${encodeURIComponent(id)}`,
      "DELETE",
    );
    setRemoving(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    onRemoved();
  }

  return (
    <>
      <button
        className="ui-button ui-button--tertiary ui-button--compact"
        disabled={removing}
        onClick={remove}
        type="button"
      >
        {removing ? "Removing…" : "Remove credential"}
      </button>
      <FormError id={errorId} message={error} />
    </>
  );
}
