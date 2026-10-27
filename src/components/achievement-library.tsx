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
  FolderGit2,
  Lock,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import AchievementPointEditor from "@/components/achievement-point-editor";
import type { ParentOption } from "@/components/achievement-point-editor";
import AchievementCard from "@/components/library/achievement-card";
import ProfileSummary from "@/components/library/profile-summary";
import LibrarySectionHeader from "@/components/library/library-section-header";
import SearchWorkbench from "@/components/library/search-workbench";
import {
  LibraryEmptyState,
  LibraryReadOnlyNotice,
} from "@/components/library/library-states";
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
import { ImportNotifications } from "./library/import-notifications";
import importNotificationStyles from "./library/import-notifications.module.css";
import { useImportStatus } from "./library/import-status-provider";

type Props = { library: ResumeLibrary; source: ResumeDataSource };
type EditorState =
  { mode: "create" } | { mode: "edit"; point: AchievementPoint } | null;
type EditorHandlers = { onCancel: () => void; onSaved: () => void };
type InlineEditorState = {
  pointId: string;
  parents: ParentOption[];
  handlers: EditorHandlers;
};

const IMAGINATION_RETURN_FOCUS_KEY = "resume-changer.library.return-focus";

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
  editor,
  parents,
  canAttachGitHub,
}: {
  item: (Job | Project) & { points: AchievementPoint[] };
  kind: GroupKind;
  library: ResumeLibrary;
  collapsed: boolean;
  onTag: (tag: string) => void;
  onSkill: (skillId: string) => void;
  onEdit?: (point: AchievementPoint, trigger: HTMLButtonElement) => void;
  onToggle: (key: string) => void;
  activeTag: string;
  activeSkillId: string;
  editor?: InlineEditorState;
  parents: ParentOption[];
  canAttachGitHub: boolean;
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
      {kind === "project" && canAttachGitHub ? (
        <div className={importNotificationStyles.projectAttachRow}>
          <Link
            aria-label={`Attach GitHub to ${title}`}
            className={`ui-button ui-button--secondary library-action library-action--secondary ${importNotificationStyles.projectAttachLink}`}
            href={`/library/github/new?projectId=${encodeURIComponent(item.id)}`}
          >
            <FolderGit2 aria-hidden="true" size={16} />
            Attach GitHub
          </Link>
        </div>
      ) : null}
      <div className="experience-panel" hidden={!expanded} id={panelId}>
        {item.points.map((point) => (
          <AchievementCard
            key={point.id}
            activeSkillId={activeSkillId}
            activeTag={activeTag}
            editor={
              editor?.pointId === point.id
                ? { ...editor.handlers, parents }
                : undefined
            }
            kind={kind}
            onEdit={onEdit ? (trigger) => onEdit(point, trigger) : undefined}
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
  const importStatus = useImportStatus();
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_LIBRARY_FILTERS);
  const [sort, setSort] = useState<LibrarySort>(DEFAULT_LIBRARY_SORT);
  const [editor, setEditor] = useState<EditorState>(null);
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
  const addAchievementRef = useRef<HTMLButtonElement>(null);
  const detailedEntryRef = useRef<HTMLButtonElement>(null);
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
  const projectNames = useMemo(
    () =>
      Object.fromEntries(
        library.projects.map((project) => [project.id, project.name]),
      ),
    [library.projects],
  );
  const hasNoData = result.totalPointCount === 0;
  const hasNoMatches = !hasNoData && result.visiblePointCount === 0;
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

  useEffect(() => {
    if (editor) return;
    const trigger = pendingEditorFocusRef.current;
    pendingEditorFocusRef.current = null;
    trigger?.focus();
  }, [editor]);

  useEffect(() => {
    try {
      if (
        window.sessionStorage.getItem(IMAGINATION_RETURN_FOCUS_KEY) !==
        "add-achievement"
      ) {
        return;
      }
      window.sessionStorage.removeItem(IMAGINATION_RETURN_FOCUS_KEY);
    } catch {
      return;
    }

    window.requestAnimationFrame(() =>
      addAchievementRef.current?.focus({ preventScroll: true }),
    );
  }, []);

  function closeEditor() {
    setEditor(null);
    pendingEditorFocusRef.current = editorTriggerRef.current;
    editorTriggerRef.current = null;
  }

  function saveEditor() {
    closeEditor();
    setSaveMessage("Saved to your local library.");
    router.refresh();
  }

  const inlineEditor: InlineEditorState | undefined =
    editor?.mode === "edit"
      ? {
          pointId: editor.point.id,
          parents: parentOptions,
          handlers: { onCancel: closeEditor, onSaved: saveEditor },
        }
      : undefined;

  return (
    <div className="library-page">
      <header className="library-page-header">
        <div className="library-page-atmosphere" aria-hidden="true">
          <span className="library-bubble library-bubble--warm" />
          <span className="library-bubble library-bubble--cool" />
          <span className="library-bubble library-bubble--ring" />
          <span className="library-bubble library-bubble--small" />
        </div>
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
                    onClick={() => {
                      setSaveMessage("");
                      try {
                        window.sessionStorage.setItem(
                          IMAGINATION_RETURN_FOCUS_KEY,
                          "add-achievement",
                        );
                      } catch {
                        // Navigation still works when session storage is unavailable.
                      }
                      router.push("/library/imagination");
                    }}
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
      {canEdit ? (
        <ImportNotifications
          actionError={importStatus.actionError}
          errorMessage={importStatus.errorMessage}
          items={importStatus.notifications}
          loadState={importStatus.loadState}
          onRead={importStatus.markRead}
          onReview={importStatus.review}
          onRetry={importStatus.refresh}
          projectNames={projectNames}
          runningImports={importStatus.runningImports}
          unreadCount={importStatus.unreadCount}
        />
      ) : null}
      {!canEdit ? <LibraryReadOnlyNotice /> : null}
      <ProfileSummary library={library} source={source} />

      {editor?.mode === "create" && (
        <AchievementPointEditor
          key="new-achievement"
          focusFirstField
          onCancel={closeEditor}
          onSaved={saveEditor}
          parents={parentOptions}
          skills={library.skills}
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
        {hasNoData ? (
          <LibraryEmptyState
            onAdd={
              canEdit
                ? () =>
                    openEditor(
                      { mode: "create" },
                      detailedEntryRef.current ?? document.body,
                    )
                : undefined
            }
            totalPointCount={result.totalPointCount}
            variant="no-data"
          />
        ) : hasNoMatches ? (
          <LibraryEmptyState
            onReset={() => setFilters(EMPTY_LIBRARY_FILTERS)}
            totalPointCount={result.totalPointCount}
            variant="no-matches"
          />
        ) : null}

        <div className="library-sections">
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
              {result.jobs.length > 0 ? (
                result.jobs.map((job) => (
                  <ExperienceGroup
                    activeSkillId={filters.skillId}
                    activeTag={filters.tag}
                    collapsed={collapsedGroups.has(groupKey("job", job.id))}
                    editor={inlineEditor}
                    item={job}
                    key={job.id}
                    kind="job"
                    library={library}
                    parents={parentOptions}
                    canAttachGitHub={false}
                    onSkill={(id) => updateFilter("skillId", id)}
                    onTag={(tag) => updateFilter("tag", tag)}
                    onToggle={toggleGroup}
                    onEdit={
                      canEdit
                        ? (point, trigger) =>
                            openEditor({ mode: "edit", point }, trigger)
                        : undefined
                    }
                  />
                ))
              ) : (
                <p className="secondary-empty">
                  {library.jobs.length === 0
                    ? "No jobs saved in this library."
                    : "No jobs match the current filters."}
                </p>
              )}
            </div>
          </section>

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
              {result.projects.length > 0 ? (
                result.projects.map((project) => (
                  <ExperienceGroup
                    activeSkillId={filters.skillId}
                    activeTag={filters.tag}
                    collapsed={collapsedGroups.has(
                      groupKey("project", project.id),
                    )}
                    editor={inlineEditor}
                    item={project}
                    key={project.id}
                    kind="project"
                    library={library}
                    parents={parentOptions}
                    canAttachGitHub={canEdit}
                    onSkill={(id) => updateFilter("skillId", id)}
                    onTag={(tag) => updateFilter("tag", tag)}
                    onToggle={toggleGroup}
                    onEdit={
                      canEdit
                        ? (point, trigger) =>
                            openEditor({ mode: "edit", point }, trigger)
                        : undefined
                    }
                  />
                ))
              ) : (
                <p className="secondary-empty">
                  {library.projects.length === 0
                    ? "No projects saved in this library."
                    : "No projects match the current filters."}
                </p>
              )}
            </div>
          </section>

          <div
            aria-label="Skills and credentials"
            className="library-secondary"
            role="region"
          >
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
                <p className="secondary-empty">
                  {library.skills.length === 0
                    ? "No skills saved in this library."
                    : "No skills match this search."}
                </p>
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
                  {library.credentials.length === 0
                    ? "No credentials saved in this library."
                    : "No credentials match this search."}
                </p>
              )}
            </details>
          </div>
        </div>
      </div>
    </div>
  );
}
