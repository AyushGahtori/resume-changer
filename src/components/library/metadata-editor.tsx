"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { apiFetch } from "@/lib/cloud/api-fetch";
import type { Job, Profile, Project } from "@/lib/schemas/resume-data";

type Editor =
  | { kind: "profile"; profile: Profile }
  | { kind: "job"; job?: Job }
  | { kind: "project"; project?: Project }
  | { kind: "skills" };

const EMPLOYMENT_TYPES = [
  ["full-time", "Full-time"],
  ["part-time", "Part-time"],
  ["contract", "Contract"],
  ["internship", "Internship"],
  ["freelance", "Freelance"],
  ["other", "Other"],
] as const;

function createId(prefix: string) {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${prefix}-${suffix}`;
}

function skillId(name: string) {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "skill";
  return `skill-${slug}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

async function readResult(response: Response) {
  const result = (await response.json().catch(() => null)) as {
    error?: string;
    issues?: { message: string }[];
    changed?: boolean;
  } | null;
  if (!response.ok) {
    const details = result?.issues?.map((issue) => issue.message).join(" ");
    throw new Error(
      details || result?.error || "The library could not be saved.",
    );
  }
  return result;
}

export default function LibraryMetadataEditor({
  editor,
  onCancel,
  onSaved,
}: {
  editor: Editor;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  if (editor.kind === "profile") {
    return (
      <ProfileForm
        profile={editor.profile}
        onCancel={onCancel}
        onSaved={onSaved}
      />
    );
  }
  if (editor.kind === "skills") {
    return <SkillsForm onCancel={onCancel} onSaved={onSaved} />;
  }
  if (editor.kind === "job") {
    return <JobForm job={editor.job} onCancel={onCancel} onSaved={onSaved} />;
  }
  return (
    <ProjectForm
      project={editor.project}
      onCancel={onCancel}
      onSaved={onSaved}
    />
  );
}

function useInitialFocus<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

function useClose(dirty: boolean, pending: boolean, onCancel: () => void) {
  return () => {
    if (pending) return;
    if (
      dirty &&
      !window.confirm("Leave this editor? Unsaved changes will be discarded.")
    ) {
      return;
    }
    onCancel();
  };
}

function ProfileForm({
  profile,
  onCancel,
  onSaved,
}: {
  profile: Profile;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const initial = {
    fullName: profile.fullName,
    headline: profile.headline ?? "",
    email: profile.email ?? "",
    phone: profile.phone ?? "",
    location: profile.location ?? "",
    links: profile.links.map((link) => link.url),
  };
  const [form, setForm] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const firstFieldRef = useInitialFocus<HTMLInputElement>();
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const close = useClose(dirty, pending, onCancel);

  async function save() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const result = await readResult(
        await apiFetch("/api/library/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            changes: {
              fullName: form.fullName,
              headline: form.headline,
              email: form.email,
              phone: form.phone,
              location: form.location,
              links: form.links.map((url) => ({ url })),
            },
          }),
        }),
      );
      onSaved(
        result?.changed ? "Saved profile." : "No profile changes to save.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The profile could not be saved.",
      );
      setPending(false);
    }
  }

  return (
    <form
      className="point-editor library-metadata-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="point-editor-heading">
        <h2>Edit profile</h2>
      </div>
      <label className="editor-field">
        <span>Name</span>
        <input
          name="fullName"
          ref={firstFieldRef}
          onChange={(event) =>
            setForm((current) => ({ ...current, fullName: event.target.value }))
          }
          value={form.fullName}
        />
      </label>
      <label className="editor-field">
        <span>Headline</span>
        <input
          name="headline"
          onChange={(event) =>
            setForm((current) => ({ ...current, headline: event.target.value }))
          }
          value={form.headline}
        />
      </label>
      <label className="editor-field">
        <span>Resume contact email</span>
        <input
          autoComplete="email"
          name="email"
          onChange={(event) =>
            setForm((current) => ({ ...current, email: event.target.value }))
          }
          value={form.email}
        />
      </label>
      <label className="editor-field">
        <span>Phone</span>
        <input
          autoComplete="tel"
          name="phone"
          onChange={(event) =>
            setForm((current) => ({ ...current, phone: event.target.value }))
          }
          value={form.phone}
        />
      </label>
      <label className="editor-field">
        <span>Location</span>
        <input
          name="location"
          onChange={(event) =>
            setForm((current) => ({ ...current, location: event.target.value }))
          }
          value={form.location}
        />
      </label>
      <fieldset className="library-metadata-links">
        <legend>Links</legend>
        {form.links.map((url, index) => (
          <label className="editor-field" key={index}>
            <span>Link URL</span>
            <input
              name={`link-${index}`}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  links: current.links.map((item, itemIndex) =>
                    itemIndex === index ? event.target.value : item,
                  ),
                }))
              }
              value={url}
            />
          </label>
        ))}
        <button
          className="ui-button ui-button--tertiary"
          onClick={() =>
            setForm((current) => ({
              ...current,
              links: [...current.links, ""],
            }))
          }
          type="button"
        >
          Add link
        </button>
      </fieldset>
      {error ? (
        <p className="editor-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="editor-actions">
        <button
          className="ui-button ui-button--secondary"
          disabled={pending}
          onClick={close}
          type="button"
        >
          Cancel
        </button>
        <button
          className="ui-button ui-button--primary"
          disabled={pending}
          type="submit"
        >
          {pending ? "Saving…" : "Save profile"}
        </button>
      </div>
    </form>
  );
}

function JobForm({
  job,
  onCancel,
  onSaved,
}: {
  job?: Job;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const [recordId] = useState(() => job?.id ?? createId("job"));
  const initial = {
    company: job?.company ?? "",
    title: job?.title ?? "",
    employmentType: job?.employmentType ?? "",
    location: job?.location ?? "",
    startDate: job?.startDate ?? "",
    endDate: job?.endDate ?? "",
    current: job?.endDate === null,
    description: job?.description ?? "",
  };
  const [form, setForm] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const firstFieldRef = useInitialFocus<HTMLInputElement>();
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const close = useClose(dirty, pending, onCancel);
  const heading = job ? "Edit job" : "Add job";

  async function save() {
    if (pending) return;
    if (
      form.startDate &&
      !form.current &&
      form.endDate &&
      form.endDate < form.startDate
    ) {
      setError("End date must be the same as or later than start date.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const result = await readResult(
        await apiFetch(`/api/library/jobs/${recordId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            changes: {
              company: form.company,
              title: form.title,
              employmentType: form.employmentType,
              location: form.location,
              startDate: form.startDate,
              endDate: form.current ? null : form.endDate,
              description: form.description,
            },
          }),
        }),
      );
      onSaved(
        result?.changed
          ? job
            ? "Saved job."
            : "Saved job."
          : "No job changes to save.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The job could not be saved.",
      );
      setPending(false);
    }
  }

  return (
    <form
      className="point-editor library-metadata-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="point-editor-heading">
        <h2>{heading}</h2>
      </div>
      <label className="editor-field">
        <span>Company</span>
        <input
          name="company"
          ref={firstFieldRef}
          onChange={(event) =>
            setForm((current) => ({ ...current, company: event.target.value }))
          }
          value={form.company}
        />
      </label>
      <label className="editor-field">
        <span>Title</span>
        <input
          name="title"
          onChange={(event) =>
            setForm((current) => ({ ...current, title: event.target.value }))
          }
          value={form.title}
        />
      </label>
      <label className="editor-field">
        <span>Employment type</span>
        <select
          name="employmentType"
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              employmentType: event.target.value,
            }))
          }
          value={form.employmentType}
        >
          <option value=""> </option>
          {EMPLOYMENT_TYPES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="editor-field">
        <span>Location</span>
        <input
          name="location"
          onChange={(event) =>
            setForm((current) => ({ ...current, location: event.target.value }))
          }
          value={form.location}
        />
      </label>
      <label className="editor-field">
        <span>Start month</span>
        <input
          name="startDate"
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              startDate: event.target.value,
            }))
          }
          type="month"
          value={form.startDate}
        />
      </label>
      <label className="editor-field">
        <span>End month</span>
        <input
          disabled={form.current}
          name="endDate"
          onChange={(event) =>
            setForm((current) => ({ ...current, endDate: event.target.value }))
          }
          type="month"
          value={form.current ? "" : form.endDate}
        />
      </label>
      <label className="editor-field">
        <span>Current role</span>
        <input
          checked={form.current}
          name="current"
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              current: event.target.checked,
              endDate: event.target.checked ? "" : current.endDate,
            }))
          }
          type="checkbox"
        />
      </label>
      <label className="editor-field">
        <span>Description</span>
        <textarea
          name="description"
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              description: event.target.value,
            }))
          }
          rows={3}
          value={form.description}
        />
      </label>
      {error ? (
        <p className="editor-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="editor-actions">
        <button
          className="ui-button ui-button--secondary"
          disabled={pending}
          onClick={close}
          type="button"
        >
          Cancel
        </button>
        <button
          className="ui-button ui-button--primary"
          disabled={pending}
          name="save-job"
          type="submit"
        >
          {pending ? "Saving…" : "Save job"}
        </button>
      </div>
    </form>
  );
}

function ProjectForm({
  project,
  onCancel,
  onSaved,
}: {
  project?: Project;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const [recordId] = useState(() => project?.id ?? createId("project"));
  const initial = {
    name: project?.name ?? "",
    role: project?.role ?? "",
    url: project?.url ?? "",
    description: project?.description ?? "",
    startDate: project?.startDate ?? "",
    endDate: project?.endDate ?? "",
    ongoing: project?.endDate === null,
  };
  const [form, setForm] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const firstFieldRef = useInitialFocus<HTMLInputElement>();
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const close = useClose(dirty, pending, onCancel);

  async function save() {
    if (pending) return;
    if (
      form.startDate &&
      !form.ongoing &&
      form.endDate &&
      form.endDate < form.startDate
    ) {
      setError("End date must be the same as or later than start date.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const result = await readResult(
        await apiFetch(`/api/library/projects/${recordId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            changes: {
              name: form.name,
              role: form.role,
              url: form.url,
              description: form.description,
              startDate: form.startDate,
              endDate: form.ongoing ? null : form.endDate,
            },
          }),
        }),
      );
      onSaved(
        result?.changed ? "Saved project." : "No project changes to save.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The project could not be saved.",
      );
      setPending(false);
    }
  }

  return (
    <form
      className="point-editor library-metadata-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="point-editor-heading">
        <h2>{project ? "Edit project" : "Add project"}</h2>
      </div>
      <label className="editor-field">
        <span>Name</span>
        <input
          name="name"
          ref={firstFieldRef}
          onChange={(event) =>
            setForm((current) => ({ ...current, name: event.target.value }))
          }
          value={form.name}
        />
      </label>
      <label className="editor-field">
        <span>Role</span>
        <input
          name="role"
          onChange={(event) =>
            setForm((current) => ({ ...current, role: event.target.value }))
          }
          value={form.role}
        />
      </label>
      <label className="editor-field">
        <span>URL</span>
        <input
          name="url"
          onChange={(event) =>
            setForm((current) => ({ ...current, url: event.target.value }))
          }
          value={form.url}
        />
      </label>
      <label className="editor-field">
        <span>Description</span>
        <textarea
          name="description"
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              description: event.target.value,
            }))
          }
          rows={3}
          value={form.description}
        />
      </label>
      <label className="editor-field">
        <span>Start month</span>
        <input
          name="startDate"
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              startDate: event.target.value,
            }))
          }
          type="month"
          value={form.startDate}
        />
      </label>
      <label className="editor-field">
        <span>End month</span>
        <input
          disabled={form.ongoing}
          name="endDate"
          onChange={(event) =>
            setForm((current) => ({ ...current, endDate: event.target.value }))
          }
          type="month"
          value={form.ongoing ? "" : form.endDate}
        />
      </label>
      <label className="editor-field">
        <span>Ongoing project</span>
        <input
          checked={form.ongoing}
          name="ongoing"
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              ongoing: event.target.checked,
              endDate: event.target.checked ? "" : current.endDate,
            }))
          }
          type="checkbox"
        />
      </label>
      {error ? (
        <p className="editor-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="editor-actions">
        <button
          className="ui-button ui-button--secondary"
          disabled={pending}
          onClick={close}
          type="button"
        >
          Cancel
        </button>
        <button
          className="ui-button ui-button--primary"
          disabled={pending}
          type="submit"
        >
          {pending ? "Saving…" : "Save project"}
        </button>
      </div>
    </form>
  );
}

function SkillsForm({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const [names, setNames] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const firstFieldRef = useInitialFocus<HTMLTextAreaElement>();
  const close = useClose(names.trim().length > 0, pending, onCancel);

  async function save() {
    if (pending) return;
    setPending(true);
    setError("");
    const items = names
      .split(/[\n,]/)
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => ({ id: skillId(name), name }));
    try {
      const result = await readResult(
        await apiFetch("/api/library/skills", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        }),
      );
      onSaved(result?.changed ? "Saved skills." : "No skill changes to save.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The skills could not be saved.",
      );
      setPending(false);
    }
  }

  return (
    <form
      className="point-editor library-metadata-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="point-editor-heading">
        <h2>Add skills</h2>
      </div>
      <label className="editor-field">
        <span>Skill names</span>
        <textarea
          ref={firstFieldRef}
          name="skills"
          onChange={(event) => setNames(event.target.value)}
          placeholder="Comma or line separated"
          rows={4}
          value={names}
        />
      </label>
      {error ? (
        <p className="editor-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="editor-actions">
        <button
          className="ui-button ui-button--secondary"
          disabled={pending}
          onClick={close}
          type="button"
        >
          Cancel
        </button>
        <button
          className="ui-button ui-button--primary"
          disabled={pending}
          type="submit"
        >
          {pending ? "Saving…" : "Save skills"}
        </button>
      </div>
    </form>
  );
}
