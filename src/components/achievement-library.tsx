"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Lock } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import AchievementPointEditor from "@/components/achievement-point-editor";
import AchievementImagination from "@/components/achievement-imagination";
import ProfileSummary from "@/components/library/profile-summary";
import SearchWorkbench from "@/components/library/search-workbench";
import {
  LIBRARY_CONTENT_ID,
  LIBRARY_SECTION_IDS,
} from "@/components/library/category-navigation";
import {
  EMPTY_LIBRARY_FILTERS,
  filterAchievementLibrary,
  getLibraryFilterOptions,
  type LibraryFilters,
} from "@/lib/data/achievement-search";
import { LIBRARY_ACTIONS } from "@/lib/ui/library-actions";
import { countLabel } from "@/lib/ui/library-labels";
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
}: {
  point: AchievementPoint;
  library: ResumeLibrary;
  onTag: (tag: string) => void;
  onSkill: (skillId: string) => void;
  onEdit?: () => void;
}) {
  const skillsById = new Map(library.skills.map((skill) => [skill.id, skill]));
  const editAction = LIBRARY_ACTIONS["edit-point"];
  const EditIcon = editAction.icon;
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
              className="ui-button ui-button--tertiary ui-button--compact"
              onClick={onEdit}
              type="button"
            >
              <EditIcon
                aria-hidden="true"
                size={editAction.iconSize}
                strokeWidth={2}
              />
              {editAction.label}
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
}: {
  item: (Job | Project) & { points: AchievementPoint[] };
  kind: "job" | "project";
  library: ResumeLibrary;
  onTag: (tag: string) => void;
  onSkill: (skillId: string) => void;
  onEdit?: (point: AchievementPoint) => void;
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
          library={library}
          onSkill={onSkill}
          onTag={onTag}
          onEdit={onEdit ? () => onEdit(point) : undefined}
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
  const addAction = LIBRARY_ACTIONS["add-achievement"];
  const detailedEntryAction = LIBRARY_ACTIONS["detailed-entry"];
  const AddIcon = addAction.icon;
  const DetailedEntryIcon = detailedEntryAction.icon;
  const editorTriggerRef = useRef<HTMLElement | null>(null);
  const pendingEditorFocusRef = useRef<HTMLElement | null>(null);
  const canvasTriggerRef = useRef<HTMLElement | null>(null);
  const detailedEntryRef = useRef<HTMLButtonElement>(null);
  const addAchievementRef = useRef<HTMLButtonElement>(null);
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
  const jobPointCount = result.jobs.reduce(
    (count, job) => count + job.points.length,
    0,
  );
  const projectPointCount = result.projects.reduce(
    (count, project) => count + project.points.length,
    0,
  );

  function updateFilter<Key extends keyof LibraryFilters>(
    key: Key,
    value: LibraryFilters[Key],
  ) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  /*
   * Capture the action that opened each flow so keyboard focus can return to
   * the same control once the form or canvas has closed.
   */
  function openEditor(next: EditorState, trigger: HTMLElement | null) {
    setSaveMessage("");
    editorTriggerRef.current = trigger;
    setEditor(next);
  }

  function openCanvas(trigger: HTMLElement | null) {
    setSaveMessage("");
    canvasTriggerRef.current = trigger;
    setCreating(true);
  }

  useEffect(() => {
    if (creating) return;
    const trigger = canvasTriggerRef.current;
    canvasTriggerRef.current = null;
    trigger?.focus();
  }, [creating]);

  useEffect(() => {
    if (editor) return;
    const trigger = pendingEditorFocusRef.current;
    pendingEditorFocusRef.current = null;
    trigger?.focus();
  }, [editor]);

  function closeEditor() {
    setEditor(null);
    pendingEditorFocusRef.current = editorTriggerRef.current;
    editorTriggerRef.current = null;
  }

  return (
    <div className="library-page">
      <header className="library-page-header">
        <div className="library-heading">
          <div className="library-heading-copy">
            <p className="eyebrow">YOUR EXPERIENCE</p>
            <h1>Achievement library</h1>
            <p className="page-intro">
              Browse the resume information saved in this workspace.
            </p>
          </div>
          <div className="library-header-controls">
            <div className="library-source-controls">
              <nav
                className="library-source-switch"
                aria-label="Library data source"
              >
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
              </nav>
              {source === "demo" && (
                <span className="library-source-note">
                  <Lock aria-hidden="true" className="library-source-note-icon" />
                  Read-only
                </span>
              )}
            </div>
            {canEdit && (
              <div className="library-edit-toolbar">
                <span className="library-edit-status" role="status">
                  {saveMessage}
                </span>
                <div className="library-edit-actions">
                  <button
                    className="ui-button ui-button--secondary library-action library-action--secondary"
                    disabled={editor !== null}
                    onClick={() =>
                      openEditor({ mode: "create" }, detailedEntryRef.current)
                    }
                    ref={detailedEntryRef}
                    type="button"
                  >
                    <DetailedEntryIcon
                      aria-hidden="true"
                      size={detailedEntryAction.iconSize}
                      strokeWidth={2}
                    />
                    {detailedEntryAction.label}
                  </button>
                  <button
                    className="ui-button ui-button--primary library-action library-action--primary"
                    disabled={creating}
                    onClick={() => openCanvas(addAchievementRef.current)}
                    ref={addAchievementRef}
                    type="button"
                  >
                    <AddIcon
                      aria-hidden="true"
                      size={addAction.iconSize}
                      strokeWidth={2}
                    />
                    {addAction.label}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>
      <ProfileSummary library={library} sourceLabel={sourceLabel} />

      {editor && (
        <AchievementPointEditor
          key={editor.mode === "edit" ? editor.point.id : "new-achievement"}
          focusFirstField={editor.mode === "create"}
          initialPoint={editor.mode === "edit" ? editor.point : undefined}
          onCancel={closeEditor}
          onSaved={() => {
            closeEditor();
            setSaveMessage("Saved to your local library.");
            router.refresh();
          }}
          parents={parentOptions}
          skills={library.skills}
        />
      )}
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

      <SearchWorkbench
        filters={filters}
        hasFilters={hasFilters}
        library={library}
        onFilterChange={updateFilter}
        onReset={() => setFilters(EMPTY_LIBRARY_FILTERS)}
        options={options}
        result={result}
      />

      <div className="library-content" id={LIBRARY_CONTENT_ID}>
        {result.visiblePointCount === 0 && (
          <p className="library-empty" role="status">
            No achievement points match these filters.
          </p>
        )}

        <section
          aria-labelledby={`${LIBRARY_SECTION_IDS.jobs}-heading`}
          className="library-section"
          id={LIBRARY_SECTION_IDS.jobs}
        >
          <div className="library-section-header">
            <h2
              className="library-section-heading"
              id={`${LIBRARY_SECTION_IDS.jobs}-heading`}
            >
              Jobs
            </h2>
            <span className="library-section-count">
              {countLabel(jobPointCount, "achievement", "achievements")}
            </span>
          </div>
          <div className="library-section-body">
            {result.jobs.length ? (
              result.jobs.map((job) => (
                <ExperienceGroup
                  item={job}
                  key={job.id}
                  kind="job"
                  library={library}
                  onSkill={(id) => updateFilter("skillId", id)}
                  onTag={(tag) => updateFilter("tag", tag)}
                  onEdit={
                    canEdit
                      ? (point) =>
                          openEditor(
                            { mode: "edit", point },
                            document.activeElement as HTMLElement | null,
                          )
                      : undefined
                  }
                />
              ))
            ) : (
              <p className="secondary-empty">No jobs match this search.</p>
            )}
          </div>
        </section>

        <section
          aria-labelledby={`${LIBRARY_SECTION_IDS.projects}-heading`}
          className="library-section"
          id={LIBRARY_SECTION_IDS.projects}
        >
          <div className="library-section-header">
            <h2
              className="library-section-heading"
              id={`${LIBRARY_SECTION_IDS.projects}-heading`}
            >
              Projects
            </h2>
            <span className="library-section-count">
              {countLabel(projectPointCount, "achievement", "achievements")}
            </span>
          </div>
          <div className="library-section-body">
            {result.projects.length ? (
              result.projects.map((project) => (
                <ExperienceGroup
                  item={project}
                  key={project.id}
                  kind="project"
                  library={library}
                  onSkill={(id) => updateFilter("skillId", id)}
                  onTag={(tag) => updateFilter("tag", tag)}
                  onEdit={
                    canEdit
                      ? (point) =>
                          openEditor(
                            { mode: "edit", point },
                            document.activeElement as HTMLElement | null,
                          )
                      : undefined
                  }
                />
              ))
            ) : (
              <p className="secondary-empty">No projects match this search.</p>
            )}
          </div>
        </section>

        <section
          aria-labelledby={`${LIBRARY_SECTION_IDS.skills}-heading`}
          className="library-section"
          id={LIBRARY_SECTION_IDS.skills}
        >
          <div className="library-section-header">
            <h2
              className="library-section-heading"
              id={`${LIBRARY_SECTION_IDS.skills}-heading`}
            >
              Skills
            </h2>
            <span className="library-section-count">
              {countLabel(result.skills.length, "skill", "skills")}
            </span>
          </div>
          <div className="library-section-body">
            {result.skills.length ? (
              <details
                className="library-detail"
                open={Boolean(filters.query || filters.skillId)}
              >
                <summary>
                  <span className="library-detail-label is-closed">
                    Show {countLabel(result.skills.length, "skill", "skills")}
                  </span>
                  <span className="library-detail-label is-open">
                    Hide {countLabel(result.skills.length, "skill", "skills")}
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className="library-detail-chevron"
                    size={16}
                  />
                </summary>
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
              </details>
            ) : (
              <p className="secondary-empty">No skills match this search.</p>
            )}
          </div>
        </section>

        <section
          aria-labelledby={`${LIBRARY_SECTION_IDS.credentials}-heading`}
          className="library-section"
          id={LIBRARY_SECTION_IDS.credentials}
        >
          <div className="library-section-header">
            <h2
              className="library-section-heading"
              id={`${LIBRARY_SECTION_IDS.credentials}-heading`}
            >
              Credentials
            </h2>
            <span className="library-section-count">
              {countLabel(
                result.credentials.length,
                "credential",
                "credentials",
              )}
            </span>
          </div>
          <div className="library-section-body">
            {result.credentials.length ? (
              <details className="library-detail" open={Boolean(filters.query)}>
                <summary>
                  <span className="library-detail-label is-closed">
                    Show{" "}
                    {countLabel(
                      result.credentials.length,
                      "credential",
                      "credentials",
                    )}
                  </span>
                  <span className="library-detail-label is-open">
                    Hide{" "}
                    {countLabel(
                      result.credentials.length,
                      "credential",
                      "credentials",
                    )}
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className="library-detail-chevron"
                    size={16}
                  />
                </summary>
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
              </details>
            ) : (
              <p className="secondary-empty">
                No credentials match this search.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
