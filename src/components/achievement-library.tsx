"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Award,
  Box,
  Briefcase,
  BriefcaseBusiness,
  ChevronDown,
  ChartNoAxesColumn,
  FolderKanban,
  Lock,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import AchievementPointEditor from "@/components/achievement-point-editor";
import AchievementImagination from "@/components/achievement-imagination";
import AchievementCard from "@/components/library/achievement-card";
import ProfileSummary from "@/components/library/profile-summary";
import LibrarySectionHeader from "@/components/library/library-section-header";
import SearchWorkbench from "@/components/library/search-workbench";
import {
  LIBRARY_CONTENT_ID,
  LIBRARY_SECTION_IDS,
} from "@/components/library/category-navigation";
import {
  DEFAULT_LIBRARY_SORT,
  EMPTY_LIBRARY_FILTERS,
  filterAchievementLibrary,
  getLibraryFilterOptions,
  sortFilteredLibrary,
  type LibrarySort,
  type LibraryFilters,
} from "@/lib/data/achievement-search";
import {
  formatExperienceRange,
  type ExperienceRange,
} from "@/lib/data/experience-dates";
import { LIBRARY_ACTIONS } from "@/lib/ui/library-actions";
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

type GroupKind = "job" | "project";

function groupKey(kind: GroupKind, id: string) {
  return kind + "-" + id;
}

function RangeText({ range }: { range: ExperienceRange }) {
  if (range.start && range.end) {
    return (
      <>
        <time dateTime={range.start.value}>{range.start.label}</time>
        {" – "}
        <time dateTime={range.end.value}>{range.end.label}</time>
      </>
    );
  }
  if (range.start && range.present) {
    return (
      <>
        <time dateTime={range.start.value}>{range.start.label}</time>
        {" – Present"}
      </>
    );
  }
  if (range.start) {
    return <time dateTime={range.start.value}>{range.start.label}</time>;
  }
  if (range.end) {
    return <time dateTime={range.end.value}>{range.end.label}</time>;
  }
  return <>Present</>;
}
function ExperienceGroup({
  item,
  kind,
  library,
  collapsed,
  onTag,
  onSkill,
  onEdit,
  onToggle,
  activeTag,
  activeSkillId,
}: {
  item: (Job | Project) & { points: AchievementPoint[] };
  kind: GroupKind;
  library: ResumeLibrary;
  collapsed: boolean;
  onTag: (tag: string) => void;
  onSkill: (skillId: string) => void;
  onEdit?: (point: AchievementPoint) => void;
  onToggle: (key: string) => void;
  activeTag: string;
  activeSkillId: string;
}) {
  const isJob = kind === "job";
  const job = isJob ? (item as Job) : null;
  const project = isJob ? null : (item as Project);
  const title = job?.title ?? project?.name ?? "";
  const organization = job?.company ?? project?.role;
  const range = formatExperienceRange(
    job ? job.startDate : project?.startDate,
    job ? job.endDate : project?.endDate,
  );
  const key = groupKey(kind, item.id);
  const panelId = "library-group-panel-" + key;
  const titleId = "library-group-title-" + key;
  const expanded = !collapsed;
  const GroupIcon = isJob ? Briefcase : FolderKanban;

  return (
    <section
      className="experience-group"
      aria-label={(isJob ? "Job: " : "Project: ") + title}
    >
      <h3 aria-labelledby={titleId} className="experience-heading">
        <button
          aria-controls={panelId}
          aria-expanded={expanded}
          className="experience-toggle"
          onClick={() => onToggle(key)}
          type="button"
        >
          <span
            aria-hidden="true"
            className={"experience-icon-tile is-" + kind}
          >
            <GroupIcon size={18} />
          </span>
          <span className="experience-heading-text">
            <span className="experience-kind">{isJob ? "JOB" : "PROJECT"}</span>
            <span className="experience-title" id={titleId}>
              {title}
            </span>
            {organization && (
              <span className="experience-subtitle">{organization}</span>
            )}
          </span>
          <span className="experience-count">
            {item.points.length} achievement
            {item.points.length === 1 ? "" : "s"}
          </span>
          {range && (
            <span className="experience-dates">
              <RangeText range={range} />
            </span>
          )}
          <ChevronDown
            aria-hidden="true"
            className="experience-chevron"
            size={16}
          />
        </button>
      </h3>
      <div className="experience-panel" hidden={!expanded} id={panelId}>
        {item.points.map((point) => (
          <AchievementCard
            key={point.id}
            activeSkillId={activeSkillId}
            activeTag={activeTag}
            kind={kind}
            onEdit={onEdit ? () => onEdit(point) : undefined}
            onSkill={onSkill}
            onTag={onTag}
            point={point}
            skills={library.skills}
          />
        ))}
      </div>
    </section>
  );
}
export default function AchievementLibrary({ library, source }: Props) {
  const router = useRouter();
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_LIBRARY_FILTERS);
  const [sort, setSort] = useState<LibrarySort>(DEFAULT_LIBRARY_SORT);
  const [editor, setEditor] = useState<EditorState>(null);
  const [creating, setCreating] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const addAction = LIBRARY_ACTIONS["add-achievement"];
  const detailedEntryAction = LIBRARY_ACTIONS["detailed-entry"];
  const AddIcon = addAction.icon;
  const DetailedEntryIcon = detailedEntryAction.icon;
  const editorTriggerRef = useRef<HTMLElement | null>(null);
  const pendingEditorFocusRef = useRef<HTMLElement | null>(null);
  const canvasTriggerRef = useRef<HTMLElement | null>(null);
  const detailedEntryRef = useRef<HTMLButtonElement>(null);
  const addAchievementRef = useRef<HTMLButtonElement>(null);
  const filtered = useMemo(
    () => filterAchievementLibrary(library, filters),
    [filters, library],
  );
  const result = useMemo(
    () => sortFilteredLibrary(filtered, sort),
    [filtered, sort],
  );
  const options = useMemo(() => getLibraryFilterOptions(library), [library]);
  const hasFilters = Object.entries(filters).some(([key, value]) =>
    key === "status" ? value !== "all" : value !== "",
  );
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

  function toggleGroup(key: string) {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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
                  <Lock
                    aria-hidden="true"
                    className="library-source-note-icon"
                  />
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
      <ProfileSummary library={library} source={source} />

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
        sort={sort}
        onSortChange={setSort}
      />

      <div className="library-content" id={LIBRARY_CONTENT_ID}>
        {result.visiblePointCount === 0 && (
          <p className="library-empty" role="status">
            No achievement points match these filters.
          </p>
        )}

        <div className="library-sections">
          {result.jobs.length > 0 && (
            <section
              aria-labelledby="library-section-jobs"
              className="library-section"
              id={LIBRARY_SECTION_IDS.jobs}
            >
              <div className="library-section-header">
                <LibrarySectionHeader
                  count={result.jobs.length}
                  icon={<BriefcaseBusiness size={18} />}
                  title="Jobs"
                  titleId="library-section-jobs"
                  tone="jobs"
                />
              </div>
              <div className="library-section-body">
                {result.jobs.map((job) => (
                  <ExperienceGroup
                    activeSkillId={filters.skillId}
                    activeTag={filters.tag}
                    collapsed={collapsedGroups.has(groupKey("job", job.id))}
                    item={job}
                    key={job.id}
                    kind="job"
                    library={library}
                    onSkill={(id) => updateFilter("skillId", id)}
                    onTag={(tag) => updateFilter("tag", tag)}
                    onToggle={toggleGroup}
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
                ))}
              </div>
            </section>
          )}

          {result.projects.length > 0 && (
            <section
              aria-labelledby="library-section-projects"
              className="library-section"
              id={LIBRARY_SECTION_IDS.projects}
            >
              <div className="library-section-header">
                <LibrarySectionHeader
                  count={result.projects.length}
                  icon={<Box size={18} />}
                  title="Projects"
                  titleId="library-section-projects"
                  tone="projects"
                />
              </div>
              <div className="library-section-body">
                {result.projects.map((project) => (
                  <ExperienceGroup
                    activeSkillId={filters.skillId}
                    activeTag={filters.tag}
                    collapsed={collapsedGroups.has(
                      groupKey("project", project.id),
                    )}
                    item={project}
                    key={project.id}
                    kind="project"
                    library={library}
                    onSkill={(id) => updateFilter("skillId", id)}
                    onTag={(tag) => updateFilter("tag", tag)}
                    onToggle={toggleGroup}
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
                ))}
              </div>
            </section>
          )}

          <div className="library-secondary">
            <details
              className="library-detail library-section"
              id={LIBRARY_SECTION_IDS.skills}
              open={Boolean(filters.query || filters.skillId)}
            >
              <summary className="library-section-header">
                <LibrarySectionHeader
                  count={result.skills.length}
                  icon={<ChartNoAxesColumn size={18} />}
                  title="Skills"
                  titleId="library-section-skills"
                  tone="skills"
                />
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

            <details
              className="library-detail library-section"
              id={LIBRARY_SECTION_IDS.credentials}
              open={Boolean(filters.query)}
            >
              <summary className="library-section-header">
                <LibrarySectionHeader
                  count={result.credentials.length}
                  icon={<Award size={18} />}
                  title="Credentials"
                  titleId="library-section-credentials"
                  tone="credentials"
                />
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
                <p className="secondary-empty">
                  No credentials match this search.
                </p>
              )}
            </details>
          </div>
        </div>
      </div>
    </div>
  );
}
