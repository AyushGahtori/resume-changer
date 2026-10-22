"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import AchievementPointEditor from "@/components/achievement-point-editor";
import AchievementImagination from "@/components/achievement-imagination";
import {
  EMPTY_LIBRARY_FILTERS,
  filterAchievementLibrary,
  getLibraryFilterOptions,
  type LibraryFilters,
} from "@/lib/data/achievement-search";
import type {
  AchievementPoint,
  Job,
  Project,
  ResumeLibrary,
} from "@/lib/schemas/resume-data";
import type { ResumeDataSource } from "@/lib/data/loaders";

type Props = { library: ResumeLibrary; source: ResumeDataSource };
type EditorState =
  { mode: "create" } | { mode: "edit"; point: AchievementPoint } | null;
type ParentOption = { id: string; label: string; type: "job" | "project" };
type EditorHandlers = { onCancel: () => void; onSaved: () => void };

function dateRange(start?: string, end?: string | null) {
  if (!start) return "";
  const format = (value: string) => {
    const [year, month] = value.split("-");
    return `${month}/${year}`;
  };
  return `${format(start)} – ${end ? format(end) : "Present"}`;
}

function PointRow({
  point,
  library,
  onTag,
  onSkill,
  onEdit,
  editor,
  parents,
}: {
  point: AchievementPoint;
  library: ResumeLibrary;
  onTag: (tag: string) => void;
  onSkill: (skillId: string) => void;
  onEdit?: (point: AchievementPoint, trigger: HTMLButtonElement) => void;
  editor?: { pointId: string; handlers: EditorHandlers };
  parents: ParentOption[];
}) {
  const skillsById = new Map(library.skills.map((skill) => [skill.id, skill]));
  return (
    <article className="library-point">
      <div className="library-point-heading">
        <code>{point.id}</code>
        <div className="point-row-actions">
          <span
            className={`point-status ${point.enabled ? "is-enabled" : "is-disabled"}`}
          >
            {point.enabled ? "Enabled" : "Disabled"}
          </span>
          {onEdit && (
            <button
              className="text-action"
              onClick={(event) => onEdit(point, event.currentTarget)}
              type="button"
            >
              Edit
            </button>
          )}
        </div>
      </div>
      <p className="library-point-text">{point.text}</p>
      <p className="point-provenance">
        Source: <strong>{point.source.type}</strong>
        {point.source.label ? ` · ${point.source.label}` : ""}
        {point.source.reference ? ` · ${point.source.reference}` : ""}
      </p>
      {point.metrics.length > 0 && (
        <ul className="point-metrics" aria-label="Achievement metrics">
          {point.metrics.map((metric) => (
            <li key={metric.id}>
              <strong>
                {metric.label}: {metric.value}
                {metric.unit ? ` ${metric.unit}` : ""}
              </strong>
              <span>{metric.evidence}</span>
              {metric.context && <span>{metric.context}</span>}
            </li>
          ))}
        </ul>
      )}
      {(point.tags.length > 0 || point.skillIds.length > 0) && (
        <div className="point-facets">
          {point.tags.map((tag) => (
            <button
              className="facet-chip"
              key={tag}
              onClick={() => onTag(tag)}
              type="button"
            >
              #{tag}
            </button>
          ))}
          {point.skillIds.map((id) => {
            const skill = skillsById.get(id);
            return skill ? (
              <button
                className="facet-chip is-skill"
                key={id}
                onClick={() => onSkill(id)}
                type="button"
              >
                {skill.name}
              </button>
            ) : null;
          })}
        </div>
      )}
      {editor?.pointId === point.id && (
        <AchievementPointEditor
          initialPoint={point}
          inline
          onCancel={editor.handlers.onCancel}
          onSaved={editor.handlers.onSaved}
          parents={parents}
          skills={library.skills}
        />
      )}
    </article>
  );
}

function ExperienceGroup({
  item,
  kind,
  library,
  onTag,
  onSkill,
  onEdit,
  editor,
  parents,
}: {
  item: (Job | Project) & { points: AchievementPoint[] };
  kind: "job" | "project";
  library: ResumeLibrary;
  onTag: (tag: string) => void;
  onSkill: (skillId: string) => void;
  onEdit?: (point: AchievementPoint, trigger: HTMLButtonElement) => void;
  editor?: { pointId: string; handlers: EditorHandlers };
  parents: ParentOption[];
}) {
  const isJob = kind === "job";
  const job = isJob ? (item as Job) : null;
  const project = isJob ? null : (item as Project);
  const title = job?.title ?? project?.name ?? "";
  const organization = job?.company ?? project?.role;

  return (
    <section
      className="experience-group"
      aria-label={`${isJob ? "Job" : "Project"}: ${title}`}
    >
      <div className="experience-heading">
        <div>
          <p className="experience-kind">{isJob ? "JOB" : "PROJECT"}</p>
          <h3>{title}</h3>
          {organization && (
            <p className="experience-subtitle">{organization}</p>
          )}
        </div>
        <span className="experience-dates">
          {job
            ? dateRange(job.startDate, job.endDate)
            : dateRange(project?.startDate, project?.endDate)}
        </span>
      </div>
      {item.points.map((point) => (
        <PointRow
          key={point.id}
          editor={editor}
          library={library}
          onSkill={onSkill}
          onTag={onTag}
          onEdit={onEdit}
          parents={parents}
          point={point}
        />
      ))}
    </section>
  );
}

export default function AchievementLibrary({ library, source }: Props) {
  const router = useRouter();
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_LIBRARY_FILTERS);
  const [editor, setEditor] = useState<EditorState>(null);
  const [creating, setCreating] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const editorTriggerRef = useRef<HTMLElement | null>(null);
  const canvasTriggerRef = useRef<HTMLElement | null>(null);

  // Closing the editor hands focus back to the control that opened it, so a
  // keyboard user keeps their place in the card they were reading.
  useEffect(() => {
    if (editor) return;
    const trigger = editorTriggerRef.current;
    editorTriggerRef.current = null;
    if (trigger?.isConnected) trigger.focus();
  }, [editor]);

  // The Imagination Canvas is a modal dialog, so it hands focus back to the
  // add control when it closes.
  useEffect(() => {
    if (creating) return;
    const trigger = canvasTriggerRef.current;
    canvasTriggerRef.current = null;
    if (trigger?.isConnected) trigger.focus();
  }, [creating]);
  const result = useMemo(
    () => filterAchievementLibrary(library, filters),
    [filters, library],
  );
  const options = useMemo(() => getLibraryFilterOptions(library), [library]);
  const hasFilters = Object.entries(filters).some(([key, value]) =>
    key === "status" ? value !== "all" : value !== "",
  );
  const sourceLabel =
    source === "demo" ? "Fictional demo data" : "My resume data";
  const canEdit = source === "personal";
  const parentOptions = [
    ...library.jobs.map((job) => ({
      id: job.id,
      label: `${job.title} · ${job.company}`,
      type: "job" as const,
    })),
    ...library.projects.map((project) => ({
      id: project.id,
      label: project.name,
      type: "project" as const,
    })),
  ];

  function updateFilter<Key extends keyof LibraryFilters>(
    key: Key,
    value: LibraryFilters[Key],
  ) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function openEditor(state: EditorState, trigger: HTMLElement) {
    setSaveMessage("");
    editorTriggerRef.current = trigger;
    setEditor(state);
  }

  function closeEditor() {
    setEditor(null);
  }

  function saveEditor() {
    setEditor(null);
    setSaveMessage("Saved to your local library.");
    router.refresh();
  }

  // The editor opens inside the card it belongs to, so the card keeps its
  // context while the point is being changed.
  const editorState =
    editor?.mode === "edit"
      ? {
          pointId: editor.point.id,
          handlers: { onCancel: closeEditor, onSaved: saveEditor },
        }
      : undefined;

  return (
    <div className="library-page">
      <div className="library-heading page-heading-row">
        <div>
          <p className="eyebrow">YOUR EXPERIENCE</p>
          <h1>Achievement library</h1>
          <p className="page-intro">
            Browse the resume information saved in this workspace.
          </p>
        </div>
        <div className="library-source-switch" aria-label="Library data source">
          <Link
            aria-current={source === "personal" ? "page" : undefined}
            href="/library"
          >
            My data
          </Link>
          <Link
            aria-current={source === "demo" ? "page" : undefined}
            href="/library?source=demo"
          >
            Demo data
          </Link>
        </div>
      </div>

      {canEdit && (
        <div className="library-edit-toolbar">
          <span>{saveMessage}</span>
          <button
            type="button"
            onClick={(event) =>
              openEditor({ mode: "create" }, event.currentTarget)
            }
          >
            Detailed entry
          </button>
          <button
            className="primary-button"
            onClick={(event) => {
              setSaveMessage("");
              canvasTriggerRef.current = event.currentTarget;
              setCreating(true);
            }}
            type="button"
          >
            Add achievement
          </button>
        </div>
      )}

      {editor?.mode === "create" && (
        <AchievementPointEditor
          initialPoint={undefined}
          onCancel={closeEditor}
          onSaved={saveEditor}
          parents={parentOptions}
          skills={library.skills}
        />
      )}

      <section className="library-overview" aria-label="Library summary">
        <div className="library-owner">
          <span className="source-indicator">{sourceLabel}</span>
          <h2>{library.profile.fullName}</h2>
          {library.profile.headline && <p>{library.profile.headline}</p>}
        </div>
        <dl className="library-counts">
          <div>
            <dt>Jobs</dt>
            <dd>{library.jobs.length}</dd>
          </div>
          <div>
            <dt>Projects</dt>
            <dd>{library.projects.length}</dd>
          </div>
          <div>
            <dt>Points</dt>
            <dd>{result.totalPointCount}</dd>
          </div>
          <div>
            <dt>Skills</dt>
            <dd>{library.skills.length}</dd>
          </div>
          <div>
            <dt>Credentials</dt>
            <dd>{library.credentials.length}</dd>
          </div>
        </dl>
      </section>

      {creating && (
        <AchievementImagination
          library={library}
          source={source}
          operation="create"
          allowResume={false}
          onClose={() => setCreating(false)}
          onAccept={() => {
            setSaveMessage("Saved to your local library.");
            router.refresh();
          }}
        />
      )}

      <section
        className="library-controls"
        aria-label="Search and filter library"
      >
        <label className="library-search">
          <span>Search library</span>
          <input
            onChange={(event) => updateFilter("query", event.target.value)}
            placeholder="Points, skills, tags, jobs, projects, credentials"
            type="search"
            value={filters.query}
          />
        </label>
        <div className="library-filter-grid">
          <label>
            <span>Job or project</span>
            <select
              onChange={(event) =>
                updateFilter("experienceId", event.target.value)
              }
              value={filters.experienceId}
            >
              <option value="">All experience</option>
              {library.jobs.map((job) => (
                <option key={job.id} value={`job:${job.id}`}>
                  {job.title} · {job.company}
                </option>
              ))}
              {library.projects.map((project) => (
                <option key={project.id} value={`project:${project.id}`}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Point source</span>
            <select
              onChange={(event) =>
                updateFilter("sourceType", event.target.value)
              }
              value={filters.sourceType}
            >
              <option value="">All sources</option>
              {[
                ...new Set(
                  [...library.jobs, ...library.projects].flatMap((item) =>
                    item.points.map((point) => point.source.type),
                  ),
                ),
              ]
                .sort()
                .map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>Point status</span>
            <select
              onChange={(event) =>
                updateFilter(
                  "status",
                  event.target.value as LibraryFilters["status"],
                )
              }
              value={filters.status}
            >
              <option value="all">All statuses</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
          <label>
            <span>Linked skill</span>
            <select
              onChange={(event) => updateFilter("skillId", event.target.value)}
              value={filters.skillId}
            >
              <option value="">All skills</option>
              {options.skills.map((skill) => (
                <option key={skill.id} value={skill.id}>
                  {skill.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Tag</span>
            <select
              onChange={(event) => updateFilter("tag", event.target.value)}
              value={filters.tag}
            >
              <option value="">All tags</option>
              {options.tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="library-filter-summary" aria-live="polite">
          <span>
            {result.visiblePointCount} of {result.totalPointCount} achievement
            points
          </span>
          {hasFilters && (
            <button
              className="text-action"
              onClick={() => setFilters(EMPTY_LIBRARY_FILTERS)}
              type="button"
            >
              Reset filters
            </button>
          )}
        </div>
      </section>

      {result.visiblePointCount === 0 ? (
        <p className="library-empty" role="status">
          No achievement points match these filters.
        </p>
      ) : (
        <div className="library-experiences">
          {result.jobs.map((job) => (
            <ExperienceGroup
              editor={editorState}
              item={job}
              key={job.id}
              kind="job"
              library={library}
              onSkill={(id) => updateFilter("skillId", id)}
              onTag={(tag) => updateFilter("tag", tag)}
              onEdit={
                canEdit
                  ? (point, trigger) =>
                      openEditor({ mode: "edit", point }, trigger)
                  : undefined
              }
              parents={parentOptions}
            />
          ))}
          {result.projects.map((project) => (
            <ExperienceGroup
              editor={editorState}
              item={project}
              key={project.id}
              kind="project"
              library={library}
              onSkill={(id) => updateFilter("skillId", id)}
              onTag={(tag) => updateFilter("tag", tag)}
              onEdit={
                canEdit
                  ? (point, trigger) =>
                      openEditor({ mode: "edit", point }, trigger)
                  : undefined
              }
              parents={parentOptions}
            />
          ))}
        </div>
      )}

      <section
        className="library-secondary"
        aria-label="Skills and credentials"
      >
        <details
          className="library-detail"
          open={Boolean(filters.query || filters.skillId)}
        >
          <summary>
            Skills <span>{result.skills.length}</span>
          </summary>
          {result.skills.length ? (
            <ul className="skill-list">
              {result.skills.map((skill) => (
                <li key={skill.id}>
                  <div>
                    <strong>{skill.name}</strong>
                    {skill.category && <span>{skill.category}</span>}
                  </div>
                  <span
                    className={
                      skill.isListedOnCurrentResume
                        ? "skill-listed"
                        : "skill-unlisted"
                    }
                  >
                    {skill.isListedOnCurrentResume
                      ? "On current resume"
                      : "Library only"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="secondary-empty">No skills match this search.</p>
          )}
        </details>
        <details className="library-detail" open={Boolean(filters.query)}>
          <summary>
            Credentials <span>{result.credentials.length}</span>
          </summary>
          {result.credentials.length ? (
            <ul className="credential-list">
              {result.credentials.map((credential) => (
                <li key={credential.id}>
                  <strong>{credential.name}</strong>
                  <span>
                    {credential.kind} · {credential.issuer}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="secondary-empty">No credentials match this search.</p>
          )}
        </details>
      </section>
    </div>
  );
}
