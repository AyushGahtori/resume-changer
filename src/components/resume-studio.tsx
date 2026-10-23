"use client";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import AchievementImagination from "./achievement-imagination";
import { useRouter } from "next/navigation";
import StudioDialog from "./studio-dialog";
import StudioSkills from "./studio-skills";
import {
  describeSectionInclusion,
  REVIEW_SECTIONS,
  sectionToggleLabel,
} from "@/lib/generation/review-inclusion";
import {
  documentFromGeneration,
  draftChangeCount,
  mergeDraftBullets,
  studioGroups,
  validateMerge,
  StudioDocumentSchema,
  type StudioDocument,
} from "@/lib/generation/studio-document";
import {
  studioHistoryReducer,
  StudioHistorySchema,
  type StudioHistory,
} from "@/lib/generation/studio-history";
import {
  estimateBulletLines,
  type SkillMeasurements,
} from "@/lib/generation/skill-layout";
import type { ManualGenerationResult } from "@/lib/generation/manual-generation";
import type {
  ResumeLibrary,
  AchievementPoint,
} from "@/lib/schemas/resume-data";
import type { ResumeDataSource } from "@/lib/data/loaders";
import type { JobAnalysisResult } from "@/lib/ai/contracts";

type Props = {
  library: ResumeLibrary;
  source: ResumeDataSource;
  generation: ManualGenerationResult;
  hasPdf: boolean;
  isCompiling?: boolean;
  analysis: JobAnalysisResult | null;
  recommendedSkillIds: string[];
  qualityNotes?: string[];
  onApplied: (generation: ManualGenerationResult, pdfBase64: string) => void;
  onSetup: () => void;
};
type Tab =
  | "overview"
  | "achievements"
  | "skills"
  | "projects"
  | "education"
  | "match"
  | "history"
  | "available";
type ImaginationState = {
  operation: "edit" | "merge" | "create";
  ids: string[];
  groupId?: string;
} | null;

type StudioCardMenuProps = {
  achievementId: string;
  canRevert: boolean;
  onConnect: () => void;
  onMove: () => void;
  onViewOriginal: () => void;
  onRevert: () => void;
  onRemove: () => void;
};

/**
 * The achievement list scrolls inside its own panel. Portaling this menu to
 * the document lets it remain visible at the top and bottom edges of that
 * scroll area while its trigger stays attached to the card.
 */
function StudioCardMenu({
  achievementId,
  canRevert,
  onConnect,
  onMove,
  onViewOriginal,
  onRevert,
  onRemove,
}: StudioCardMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusedOnOpen = useRef(false);
  const menuId = "studio-card-actions-" + encodeURIComponent(achievementId);

  useLayoutEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;

      const margin = 8;
      const gap = 4;
      const triggerBox = trigger.getBoundingClientRect();
      const menuBox = menu.getBoundingClientRect();
      const menuHeight = Math.min(
        menuBox.height,
        window.innerHeight - margin * 2,
      );
      const spaceBelow = window.innerHeight - triggerBox.bottom - gap - margin;
      const spaceAbove = triggerBox.top - gap - margin;
      const desiredTop =
        spaceBelow >= menuHeight || spaceBelow >= spaceAbove
          ? triggerBox.bottom + gap
          : triggerBox.top - menuHeight - gap;
      const top = Math.max(
        margin,
        Math.min(desiredTop, window.innerHeight - menuHeight - margin),
      );
      const left = Math.max(
        margin,
        Math.min(
          triggerBox.right - menuBox.width,
          window.innerWidth - menuBox.width - margin,
        ),
      );

      setPosition((current) =>
        current?.top === top && current.left === left ? current : { top, left },
      );
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      focusedOnOpen.current = false;
      setPosition(null);
      return;
    }
    if (!position || focusedOnOpen.current) return;

    menuRef.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
    focusedOnOpen.current = true;
  }, [open, position]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (
        triggerRef.current?.contains(event.target) ||
        menuRef.current?.contains(event.target)
      ) {
        return;
      }
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const runAction = (action: () => void) => {
    triggerRef.current?.focus();
    setOpen(false);
    action();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="studio-card-menu-trigger"
        aria-label={"More actions for " + achievementId}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
      >
        •••
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            id={menuId}
            ref={menuRef}
            className="studio-card-menu-popover"
            role="group"
            aria-label={"Actions for achievement " + achievementId}
            style={{
              top: position?.top ?? 8,
              left: position?.left ?? 8,
              visibility: position ? "visible" : "hidden",
            }}
          >
            <button type="button" onClick={() => runAction(onConnect)}>
              Connect for merge
            </button>
            <button type="button" onClick={() => runAction(onMove)}>
              Move to destination
            </button>
            <button type="button" onClick={() => runAction(onViewOriginal)}>
              View original
            </button>
            <button
              type="button"
              disabled={!canRevert}
              onClick={() => runAction(onRevert)}
            >
              Revert wording
            </button>
            <button type="button" onClick={() => runAction(onRemove)}>
              Remove from resume
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}

export default function ResumeStudio({
  library,
  source,
  generation,
  hasPdf,
  isCompiling = false,
  analysis,
  recommendedSkillIds,
  qualityNotes = [],
  onApplied,
  onSetup,
}: Props) {
  const router = useRouter();
  const [initial] = useState(() => documentFromGeneration(generation, library));
  const [initialLatex] = useState(generation.latex);
  const [baseline, setBaseline] = useState(initial);
  const [baselineLatex, setBaselineLatex] = useState(generation.latex);
  const [history, dispatch] = useReducer(studioHistoryReducer, {
    past: [],
    present: initial,
    future: [],
  });
  const document = history.present;
  const [tab, setTab] = useState<Tab>("achievements");
  const [measurements, setMeasurements] = useState<SkillMeasurements | null>(
    null,
  );
  const [measureError, setMeasureError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [applying, setApplying] = useState(false);
  const [manual, setManual] = useState<{
    id: string;
    text: string;
    groupId: string;
  } | null>(null);
  const [imagination, setImagination] = useState<ImaginationState>(null);
  const [mergeIds, setMergeIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [restore, setRestore] = useState<StudioHistory | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [graph, setGraph] = useState<{ ys: number[]; height: number }>({
    ys: [],
    height: 0,
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const applyController = useRef<AbortController | null>(null);
  const pointerY = useRef(0);
  const groups = useMemo(() => studioGroups(library), [library]);
  const points = useMemo(
    () =>
      [...library.jobs, ...library.projects].flatMap((group) =>
        group.points
          .filter((point) => point.enabled)
          .map((point) => ({ ...point, groupId: group.id })),
      ),
    [library],
  );
  const storageKey = `resume-changer.studio-draft.v1:${source}:${library.profile.id}:${generation.metadata.company}:${generation.metadata.roleTitle}`;
  const changes = draftChangeCount(baseline, document);
  const navigation: [Tab, string, string][] = [
    ["overview", "Overview", "◈"],
    ["achievements", "Achievements", "≋"],
    ["skills", "Skills", "◇"],
    ["projects", "Projects", "▱"],
    ["education", "Education & credentials", "▤"],
    ["match", "Job match", "◎"],
    ["history", "Revision history", "↶"],
    ["available", "Available achievements", "+"],
  ];

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/resume/skills?source=${source}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || payload.source !== "latex" || !payload.widths)
          throw new Error(
            payload.error ?? "Layout measurements are unavailable.",
          );
        if (!controller.signal.aborted) setMeasurements(payload);
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setMeasureError(
            failure instanceof Error
              ? failure.message
              : "Measurements are unavailable. Apply will validate fit.",
          );
      });
    return () => controller.abort();
  }, [source]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      const parsed = StudioHistorySchema.safeParse(saved?.history);
      if (
        saved?.baselineLatex === initialLatex &&
        parsed.success &&
        draftChangeCount(initial, parsed.data.present)
      )
        setRestore(parsed.data);
    } catch {
      /* A damaged saved draft never replaces the valid document. */
    }
    setStorageReady(true);
  }, [initial, initialLatex, storageKey]);

  useEffect(() => {
    if (!storageReady || restore) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          baselineLatex,
          history,
          updatedAt: new Date().toISOString(),
        }),
      );
    } catch {
      setNotice(
        "Browser storage is full or unavailable. Keep this page open to preserve pending edits.",
      );
    }
  }, [storageReady, restore, history, baselineLatex, storageKey]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (changes) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [changes]);
  useEffect(() => () => applyController.current?.abort(), []);

  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (!stack) return;
    const update = () => {
      const bounds = stack.getBoundingClientRect();
      setGraph({
        height: stack.scrollHeight,
        ys: mergeIds.flatMap((id) => {
          const handle = stack.querySelector<HTMLElement>(
            `[data-connect-id="${CSS.escape(id)}"]`,
          );
          const rect = handle?.getBoundingClientRect();
          return rect ? [rect.top + rect.height / 2 - bounds.top] : [];
        }),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stack);
    return () => observer.disconnect();
  }, [document, mergeIds, tab]);

  useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    const tick = () => {
      const viewport = scrollRef.current;
      if (viewport) {
        const bounds = viewport.getBoundingClientRect();
        const upper = Math.max(0, 65 - (pointerY.current - bounds.top));
        const lower = Math.max(0, 65 - (bounds.bottom - pointerY.current));
        viewport.scrollTop += Math.max(
          -16,
          Math.min(16, (lower - upper) * 0.25),
        );
        if (stackRef.current)
          setDragY(
            pointerY.current - stackRef.current.getBoundingClientRect().top,
          );
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging]);

  function change(label: string, next: StudioDocument) {
    const parsed = StudioDocumentSchema.safeParse(next);
    if (!parsed.success) {
      setError("Keep at least one resume section and valid achievement text.");
      return;
    }
    dispatch({ type: "change", document: parsed.data, label });
    setError("");
    setNotice("");
  }
  function connect(id: string) {
    const next = mergeIds.includes(id)
      ? mergeIds.filter((item) => item !== id)
      : [...mergeIds, id];
    const invalid = next.length > 1 ? validateMerge(document, next) : null;
    if (invalid) {
      setError(invalid);
      return;
    }
    setMergeIds(next);
    setError("");
  }
  function addPoint(point: AchievementPoint & { groupId: string }) {
    if (
      document.bullets.some(
        (bullet) =>
          bullet.id === point.id ||
          bullet.sourceAchievementIds.includes(point.id),
      )
    )
      return;
    const next = {
      ...document,
      bullets: [
        ...document.bullets,
        {
          id: point.id,
          groupId: point.groupId,
          text: point.text,
          originalText: point.text,
          sourceAchievementIds: [point.id],
          skillIds: point.skillIds,
        },
      ],
    };
    change("Add existing achievement", next);
    setTab(
      groups.find((group) => group.id === point.groupId)?.section === "projects"
        ? "projects"
        : "achievements",
    );
    const lines = estimateBulletLines(point.text, measurements);
    if (
      lines &&
      generation.metadata.layout &&
      lines * 12 > generation.metadata.layout.bottomGap
    )
      setNotice(
        "This addition may exceed the available page space. Shorten or merge a point before applying; the current PDF stays valid.",
      );
  }
  function move(id: string, direction: -1 | 1) {
    const index = document.bullets.findIndex((bullet) => bullet.id === id);
    const indices = document.bullets.flatMap((bullet, position) =>
      bullet.groupId === document.bullets[index].groupId ? [position] : [],
    );
    const target = indices[indices.indexOf(index) + direction];
    if (target === undefined) return;
    const bullets = [...document.bullets];
    [bullets[index], bullets[target]] = [bullets[target], bullets[index]];
    change("Reorder achievement", { ...document, bullets });
  }
  async function apply() {
    const controller = new AbortController();
    applyController.current = controller;
    setApplying(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/resume/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          dataSource: source,
          document,
          context: {
            company: generation.metadata.company,
            roleTitle: generation.metadata.roleTitle,
            jobUrl: generation.metadata.jobUrl,
            tailoringMode: generation.metadata.tailoringMode,
          },
        }),
      });
      const payload = await response.json();
      if (
        !response.ok ||
        !payload.generation?.latex ||
        typeof payload.pdfBase64 !== "string" ||
        !atob(payload.pdfBase64).startsWith("%PDF-")
      )
        throw new Error(
          payload.error ??
            "The service did not return a verified PDF. Your previous resume is unchanged.",
        );
      if (controller.signal.aborted) return;
      onApplied(payload.generation, payload.pdfBase64);
      setBaseline(document);
      setBaselineLatex(payload.generation.latex);
      setNotice(
        "Changes applied. The one-page PDF and its margins were validated.",
      );
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "The update failed. Your previous PDF and draft are preserved.",
        );
    } finally {
      if (applyController.current === controller) setApplying(false);
    }
  }

  const available = points.filter(
    (point) =>
      !document.bullets.some(
        (bullet) =>
          bullet.id === point.id ||
          bullet.sourceAchievementIds.includes(point.id),
      ) &&
      (!groupFilter || point.groupId === groupFilter) &&
      `${point.text} ${groups.find((group) => group.id === point.groupId)?.title}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const displayGroups = groups.filter((group) =>
    tab === "projects"
      ? group.section === "projects"
      : group.section === "experience",
  );
  const graphMid = graph.ys.length
    ? graph.ys.reduce((sum, y) => sum + y, 0) / graph.ys.length
    : 0;

  return (
    <section
      className="resume-studio"
      aria-label="Generated resume review"
      aria-busy={applying}
    >
      <header className="studio-heading">
        <div>
          <p className="studio-kicker">RESUME STUDIO</p>
          <h2>Make it yours.</h2>
          <p>Refine your story. Keep every change reversible.</p>
        </div>
        <span
          className={`studio-badge${changes ? " is-pending" : ""}${
            isCompiling ? " is-compiling" : ""
          }`}
          aria-busy={isCompiling}
        >
          {isCompiling
            ? "Compiling…"
            : changes
              ? `Draft · ${changes} changes`
              : hasPdf
                ? "PDF ready"
                : "LaTeX ready"}
        </span>
      </header>
      {restore && (
        <div className="studio-restore" role="status">
          <span>An unfinished draft is saved in this browser.</span>
          <button
            type="button"
            onClick={() => {
              dispatch({ type: "restore", history: restore });
              setRestore(null);
            }}
          >
            Restore draft
          </button>
          <button type="button" onClick={() => setRestore(null)}>
            Discard saved draft
          </button>
        </div>
      )}
      <div className="studio-body">
        <nav className="studio-navigation" aria-label="Resume editor">
          {navigation.map(([value, label, icon]) => (
            <button
              type="button"
              key={value}
              aria-pressed={tab === value}
              aria-label={label}
              onClick={() => {
                setTab(value);
                setMergeIds([]);
              }}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
            </button>
          ))}
          <button className="studio-setup-link" type="button" onClick={onSetup}>
            Generation settings ↗
          </button>
        </nav>
        <div className="studio-editor">
          {tab === "overview" && (
            <section>
              <div className="studio-panel-heading">
                <div>
                  <h3>Your resume, at a glance</h3>
                  <p>
                    {generation.metadata.roleTitle || "Your next role"}
                    {generation.metadata.company
                      ? ` · ${generation.metadata.company}`
                      : ""}
                  </p>
                </div>
              </div>
              <div className="studio-overview-stats">
                <div>
                  <strong>{document.bullets.length}</strong>
                  <span>achievements</span>
                </div>
                <div>
                  <strong>{document.skillIds.length}</strong>
                  <span>skills</span>
                </div>
                <div>
                  <strong>
                    {generation.metadata.layout
                      ? `${Math.round(generation.metadata.layout.utilization * 100)}%`
                      : "—"}
                  </strong>
                  <span>current page fill</span>
                </div>
              </div>
              <label className="studio-field">
                <span>Resume summary</span>
                <textarea
                  aria-label="Resume summary"
                  rows={5}
                  maxLength={1500}
                  value={document.summary}
                  onChange={(event) =>
                    change("Edit resume summary", {
                      ...document,
                      summary: event.target.value,
                    })
                  }
                />
              </label>
              <p className="studio-muted">
                Content estimates guide editing. Apply compiles the complete
                draft and checks the page and margins.
              </p>
              <button
                type="button"
                className="studio-ai-button"
                onClick={() => setImagination({ operation: "create", ids: [] })}
              >
                ✦ Add achievement
              </button>
            </section>
          )}
          {(tab === "achievements" || tab === "projects") && (
            <>
              {tab === "projects" &&
                !document.sectionOrder.includes("projects") && (
                  <p className="studio-notice">
                    Projects are hidden in the PDF. Your project drafts are
                    retained; enable Projects in Education &amp; credentials to
                    include them.
                  </p>
                )}
              <div className="studio-panel-heading">
                <div>
                  <h3>
                    {tab === "projects"
                      ? "Project achievements"
                      : "Work experience"}
                  </h3>
                  <p>Edit a point, connect related work, or add evidence.</p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setImagination({
                      operation: "create",
                      ids: [],
                      groupId: displayGroups[0]?.id,
                    })
                  }
                >
                  + Add achievement
                </button>
              </div>
              <div className="studio-merge-toolbar">
                <span>
                  {mergeIds.length
                    ? `${mergeIds.length} connected · up to 3 original sources`
                    : "Connect 2–3 related achievements to merge."}
                </span>
                <button
                  type="button"
                  className="studio-ai-button"
                  disabled={Boolean(validateMerge(document, mergeIds))}
                  onClick={() =>
                    setImagination({ operation: "merge", ids: mergeIds })
                  }
                >
                  Merge with Imagination ✦
                </button>
                <button
                  type="button"
                  disabled={!mergeIds.length}
                  onClick={() => setMergeIds([])}
                >
                  Clear
                </button>
              </div>
              <div
                className="studio-achievement-scroll"
                ref={scrollRef}
                onDragOver={(event) => {
                  if (dragging) {
                    event.preventDefault();
                    pointerY.current = event.clientY;
                  }
                }}
                onDragEnd={() => setDragging(false)}
              >
                <div className="studio-card-stack" ref={stackRef}>
                  {graph.ys.length > 1 && (
                    <>
                      <svg
                        className="studio-merge-svg"
                        aria-hidden="true"
                        width="49"
                        height={graph.height}
                      >
                        {graph.ys.map((y, index) => (
                          <path
                            key={index}
                            d={`M 25 ${y} H 16 Q 8 ${y} 8 ${y + (graphMid > y ? 8 : -8)} V ${graphMid + (graphMid > y ? -8 : 8)} Q 8 ${graphMid} 16 ${graphMid} H 27`}
                          />
                        ))}
                      </svg>
                      <button
                        type="button"
                        draggable
                        className="studio-merge-node"
                        style={{ top: graphMid - 13 }}
                        aria-label="Merge connected achievements; drag to connect a third"
                        onDragStart={(event) => {
                          event.dataTransfer.setData(
                            "application/x-studio-merge",
                            "merge",
                          );
                          pointerY.current = event.clientY;
                          setDragging(true);
                        }}
                        onClick={() =>
                          setImagination({ operation: "merge", ids: mergeIds })
                        }
                      >
                        +
                      </button>
                    </>
                  )}
                  {dragging && graph.ys.length > 0 && (
                    <svg
                      className="studio-merge-svg is-dragging"
                      aria-hidden="true"
                      width="49"
                      height={graph.height}
                    >
                      <path d={`M 25 ${graph.ys[0]} H 5 V ${dragY} H 35`} />
                    </svg>
                  )}
                  {displayGroups.map((group) => (
                    <section
                      key={group.id}
                      className="studio-destination"
                      aria-label={`Destination ${group.title}`}
                      onDragOver={(event) => {
                        if (
                          event.dataTransfer.types.includes(
                            "application/x-studio-achievement",
                          )
                        )
                          event.preventDefault();
                      }}
                      onDrop={(event) => {
                        const id = event.dataTransfer.getData(
                          "application/x-studio-achievement",
                        );
                        if (!id) return;
                        event.preventDefault();
                        const point = points.find((point) => point.id === id);
                        if (point?.groupId === group.id) addPoint(point);
                        else
                          setError(
                            "Add this point to its original company or project to preserve attribution.",
                          );
                      }}
                    >
                      <header>
                        <span className="studio-group-marker" />
                        <div>
                          <h4>{group.title}</h4>
                          <p>{group.subtitle}</p>
                        </div>
                        <button
                          type="button"
                          aria-label={`Add achievement to ${group.title}`}
                          onClick={() =>
                            setImagination({
                              operation: "create",
                              ids: [],
                              groupId: group.id,
                            })
                          }
                        >
                          +
                        </button>
                      </header>
                      {document.bullets
                        .filter((bullet) => bullet.groupId === group.id)
                        .map((bullet) => {
                          const sameGroup = document.bullets.filter(
                            (item) => item.groupId === group.id,
                          );
                          const position = sameGroup.findIndex(
                            (item) => item.id === bullet.id,
                          );
                          const lines = estimateBulletLines(
                            bullet.text,
                            measurements,
                          );
                          return (
                            <article
                              className={`studio-achievement-card${mergeIds.includes(bullet.id) ? " is-connected" : ""}`}
                              key={bullet.id}
                            >
                              <button
                                type="button"
                                className="studio-connect-handle"
                                data-connect-id={bullet.id}
                                draggable
                                aria-pressed={mergeIds.includes(bullet.id)}
                                aria-label={`Connect achievement ${bullet.id} for merging`}
                                title="Drag to connect, or click to select for merging"
                                onClick={() => connect(bullet.id)}
                                onDragStart={(event) => {
                                  event.dataTransfer.setData(
                                    "application/x-studio-merge",
                                    bullet.id,
                                  );
                                  if (!mergeIds.includes(bullet.id))
                                    setMergeIds([bullet.id]);
                                  pointerY.current = event.clientY;
                                  setDragging(true);
                                }}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  const sourceId = event.dataTransfer.getData(
                                    "application/x-studio-merge",
                                  );
                                  const next = [
                                    ...new Set([
                                      ...(sourceId === "merge"
                                        ? mergeIds
                                        : [sourceId]),
                                      bullet.id,
                                    ]),
                                  ].filter(Boolean);
                                  const invalid = validateMerge(document, next);
                                  if (invalid) setError(invalid);
                                  else {
                                    setMergeIds(next);
                                    setError("");
                                  }
                                  setDragging(false);
                                }}
                              >
                                <span />
                              </button>
                              <p>{bullet.text}</p>
                              <div className="studio-card-meta">
                                <span>
                                  {lines
                                    ? `~${lines} rendered ${lines === 1 ? "line" : "lines"}`
                                    : "Fit checked on Apply"}
                                </span>
                                {bullet.sourceAchievementIds.length > 1 && (
                                  <span>
                                    ↳ {bullet.sourceAchievementIds.length}{" "}
                                    sources
                                  </span>
                                )}
                                <span>
                                  {bullet.text !== bullet.originalText
                                    ? "Edited draft"
                                    : "Original wording"}
                                </span>
                              </div>
                              <div className="studio-card-actions">
                                <button
                                  type="button"
                                  aria-label={`Edit achievement ${bullet.id}`}
                                  onClick={() =>
                                    setManual({
                                      id: bullet.id,
                                      text: bullet.text,
                                      groupId: bullet.groupId,
                                    })
                                  }
                                >
                                  Edit manually
                                </button>
                                <button
                                  type="button"
                                  className="studio-ai-text"
                                  aria-label={`Edit achievement ${bullet.id} with AI`}
                                  onClick={() =>
                                    setImagination({
                                      operation: "edit",
                                      ids: [bullet.id],
                                    })
                                  }
                                >
                                  ✦ Imagine
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Move bullet up: ${bullet.id}`}
                                  disabled={position === 0}
                                  onClick={() => move(bullet.id, -1)}
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Move bullet down: ${bullet.id}`}
                                  disabled={position === sameGroup.length - 1}
                                  onClick={() => move(bullet.id, 1)}
                                >
                                  ↓
                                </button>
                                <StudioCardMenu
                                  achievementId={bullet.id}
                                  canRevert={
                                    bullet.text !== bullet.originalText
                                  }
                                  onConnect={() => connect(bullet.id)}
                                  onMove={() =>
                                    setManual({
                                      id: bullet.id,
                                      text: bullet.text,
                                      groupId: bullet.groupId,
                                    })
                                  }
                                  onViewOriginal={() => {
                                    const evidence =
                                      window.document.getElementById(
                                        "studio-evidence-" + bullet.id,
                                      );
                                    if (
                                      evidence instanceof HTMLDetailsElement
                                    ) {
                                      evidence.open = true;
                                      evidence.scrollIntoView({
                                        block: "nearest",
                                      });
                                    }
                                  }}
                                  onRevert={() =>
                                    change("Revert achievement", {
                                      ...document,
                                      bullets: document.bullets.map((item) =>
                                        item.id === bullet.id
                                          ? { ...item, text: item.originalText }
                                          : item,
                                      ),
                                    })
                                  }
                                  onRemove={() => {
                                    change("Remove achievement", {
                                      ...document,
                                      bullets: document.bullets.filter(
                                        (item) => item.id !== bullet.id,
                                      ),
                                    });
                                    setMergeIds(
                                      mergeIds.filter((id) => id !== bullet.id),
                                    );
                                  }}
                                />
                              </div>
                              <details
                                id={"studio-evidence-" + bullet.id}
                                className="studio-evidence"
                              >
                                <summary>
                                  Original &amp; evidence ·{" "}
                                  {bullet.sourceAchievementIds.join(", ") ||
                                    "User-authored draft"}
                                </summary>
                                <p>{bullet.originalText}</p>
                                {bullet.inferredTerms?.length ? (
                                  <p>
                                    Generation inference · review before using:{" "}
                                    {bullet.inferredTerms.join(", ")}
                                  </p>
                                ) : null}
                                {bullet.sourceAchievementIds.map((id) => (
                                  <p key={id}>
                                    <code>{id}</code>{" "}
                                    {
                                      points.find((point) => point.id === id)
                                        ?.text
                                    }
                                  </p>
                                ))}
                                <div className="studio-mini-skills">
                                  {bullet.skillIds.map((id) => (
                                    <span key={id}>
                                      {
                                        library.skills.find(
                                          (skill) => skill.id === id,
                                        )?.name
                                      }
                                    </span>
                                  ))}
                                </div>
                              </details>
                            </article>
                          );
                        })}
                      {!document.bullets.some(
                        (bullet) => bullet.groupId === group.id,
                      ) && (
                        <div className="studio-drop-zone">
                          Drop an achievement from this source here, or add one
                          using the + button.
                        </div>
                      )}
                    </section>
                  ))}
                  {!displayGroups.length && (
                    <p className="studio-empty">
                      Add a job or project to your Achievement Library to create
                      a destination.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
          {tab === "skills" && (
            <>
              {!document.sectionOrder.includes("skills") && (
                <p className="studio-notice">
                  Skills are hidden in the PDF. Your skill choices are retained;
                  enable Skills in Education &amp; credentials to include them.
                </p>
              )}
              <StudioSkills
                library={library}
                selectedIds={document.skillIds}
                currentIds={baseline.skillIds}
                measurements={measurements}
                measureError={measureError}
                recommendedIds={recommendedSkillIds}
                onChange={(ids) =>
                  change("Update skills", { ...document, skillIds: ids })
                }
              />
            </>
          )}
          {tab === "education" && (
            <section>
              <div className="studio-panel-heading">
                <div>
                  <h3>Education &amp; credentials</h3>
                  <p>Choose which sections appear in this resume.</p>
                </div>
              </div>
              <fieldset className="studio-section-toggles">
                <legend>Sections to include</legend>
                <p className="studio-section-toggle-count">
                  {describeSectionInclusion(
                    REVIEW_SECTIONS.filter((section) =>
                      document.sectionOrder.includes(section),
                    ).length,
                    REVIEW_SECTIONS.length,
                  )}
                </p>
                <div className="studio-section-toggle-list">
                  {REVIEW_SECTIONS.map((section) => (
                    <label className="studio-section-toggle" key={section}>
                      <input
                        type="checkbox"
                        checked={document.sectionOrder.includes(section)}
                        onChange={(event) =>
                          change(`Toggle ${section}`, {
                            ...document,
                            sectionOrder: event.target.checked
                              ? [...document.sectionOrder, section]
                              : document.sectionOrder.filter(
                                  (item) => item !== section,
                                ),
                          })
                        }
                      />
                      {sectionToggleLabel(section)}
                    </label>
                  ))}
                </div>
              </fieldset>
              {library.profile.education.map((education) => (
                <article className="studio-record" key={education.id}>
                  <strong>
                    {education.degree} · {education.fieldOfStudy}
                  </strong>
                  <p>{education.institutions.join(" / ")}</p>
                </article>
              ))}
              {library.credentials.map((credential) => (
                <article className="studio-record" key={credential.id}>
                  <strong>{credential.name}</strong>
                  <p>{credential.issuer}</p>
                </article>
              ))}
              <p className="studio-muted">
                Update source education and credential details in your library
                data.
              </p>
            </section>
          )}
          {tab === "match" && (
            <section>
              <div className="studio-panel-heading">
                <div>
                  <h3>Job description match</h3>
                  <p>
                    Use the job analysis as writing context. Missing evidence is
                    never invented.
                  </p>
                </div>
              </div>
              {qualityNotes.length > 0 && (
                <details className="studio-record" open>
                  <summary>Generation review notes</summary>
                  {qualityNotes.map((note) => (
                    <p key={note}>{note}</p>
                  ))}
                </details>
              )}
              {generation.metadata.finalCoverage?.length ? (
                <div className="studio-record">
                  <strong>
                    {
                      generation.metadata.finalCoverage.filter(
                        (item) => item.status === "supported",
                      ).length
                    }{" "}
                    / {generation.metadata.finalCoverage.length} supported
                    {generation.metadata.finalCoverage.some(
                      (item) =>
                        item.status === "partial" ||
                        item.status === "uncertain",
                    )
                      ? ` · ${generation.metadata.finalCoverage.filter((item) => item.status === "partial" || item.status === "uncertain").length} partial`
                      : ""}
                  </strong>
                  <p>
                    Assessed for the last generated resume. Pending edits have
                    not been reassessed.
                  </p>
                  {generation.metadata.finalCoverage.map((item) => (
                    <details key={item.requirement}>
                      <summary>
                        {item.requirement} · {item.status}
                      </summary>
                      <p>{item.reason}</p>
                      {item.missingComponents?.length ? (
                        <p>
                          Missing evidence: {item.missingComponents.join("; ")}
                        </p>
                      ) : null}
                    </details>
                  ))}
                </div>
              ) : null}
              {analysis ? (
                <>
                  {[
                    [
                      "Required qualifications",
                      analysis.requiredQualifications,
                    ],
                    ["Responsibilities", analysis.responsibilities],
                    [
                      "Preferred qualifications",
                      analysis.preferredQualifications,
                    ],
                    ["Tools and platforms", analysis.toolsAndPlatforms],
                    ["Domain concepts", analysis.domainConcepts],
                  ].map(([title, items]) => (
                    <details className="studio-record" key={title as string}>
                      <summary>{title as string}</summary>
                      <ul>
                        {(items as string[]).map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </details>
                  ))}
                </>
              ) : (
                <p className="studio-empty">
                  Analyze this job description on the Job description page to
                  see its requirements here.
                </p>
              )}
            </section>
          )}
          {tab === "available" && (
            <section>
              <div className="studio-panel-heading">
                <div>
                  <h3>Available achievements</h3>
                  <p>Add a point to its original company or project.</p>
                </div>
              </div>
              <label className="studio-field">
                <span>Search available achievements</span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <label className="studio-field">
                <span>Company or project</span>
                <select
                  value={groupFilter}
                  onChange={(event) => setGroupFilter(event.target.value)}
                >
                  <option value="">All sources</option>
                  {groups.map((group) => (
                    <option value={group.id} key={group.id}>
                      {group.title} · {group.subtitle}
                    </option>
                  ))}
                </select>
              </label>
              <div
                className="studio-drop-destinations"
                aria-label="Achievement drop destinations"
              >
                {groups.map((group) => (
                  <div
                    key={group.id}
                    role="region"
                    aria-label={`Drop achievement into ${group.title}`}
                    onDragOver={(event) => {
                      if (
                        event.dataTransfer.types.includes(
                          "application/x-studio-achievement",
                        )
                      )
                        event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const point = points.find(
                        (point) =>
                          point.id ===
                          event.dataTransfer.getData(
                            "application/x-studio-achievement",
                          ),
                      );
                      if (point?.groupId === group.id) addPoint(point);
                      else if (point)
                        setError(
                          "Add this point to its original company or project to preserve attribution.",
                        );
                    }}
                  >
                    <strong>{group.title}</strong>
                    <small>{group.subtitle}</small>
                    <span>Drop an achievement from this source</span>
                  </div>
                ))}
              </div>
              <div className="studio-available-list">
                {available.map((point) => (
                  <article
                    key={point.id}
                    draggable
                    onDragStart={(event) =>
                      event.dataTransfer.setData(
                        "application/x-studio-achievement",
                        point.id,
                      )
                    }
                  >
                    <small>
                      {
                        groups.find((group) => group.id === point.groupId)
                          ?.title
                      }{" "}
                      ·{" "}
                      {
                        groups.find((group) => group.id === point.groupId)
                          ?.subtitle
                      }
                    </small>
                    <p>{point.text}</p>
                    <button type="button" onClick={() => addPoint(point)}>
                      + Add to resume
                    </button>
                  </article>
                ))}
              </div>
              {!available.length && (
                <p className="studio-empty">
                  No unused achievements match this search. Adjust the filters
                  or create a new achievement.
                </p>
              )}
            </section>
          )}
          {tab === "history" && (
            <section>
              <div className="studio-panel-heading">
                <div>
                  <h3>Revision history</h3>
                  <p>Restore a prior draft, then Apply to validate its PDF.</p>
                </div>
              </div>
              {history.past.length ? (
                [...history.past].reverse().map((revision) => (
                  <article className="studio-revision" key={revision.id}>
                    <div>
                      <strong>{revision.label}</strong>
                      <p>
                        {new Date(revision.at).toLocaleString()} ·{" "}
                        {revision.document.bullets.length} points ·{" "}
                        {revision.document.skillIds.length} skills
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        change("Restore revision", revision.document)
                      }
                    >
                      Restore
                    </button>
                  </article>
                ))
              ) : (
                <p className="studio-empty">
                  Your next edit will appear here. The current resume is saved
                  separately from pending changes.
                </p>
              )}
            </section>
          )}
        </div>
      </div>
      {error && (
        <p className="studio-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="studio-notice" role="status">
          {notice}
        </p>
      )}
      <footer className="studio-action-bar">
        <span>
          {applying
            ? "Compiling and validating your draft…"
            : changes
              ? `${changes} pending ${changes === 1 ? "change" : "changes"} · ${hasPdf ? "last PDF valid" : "ready to validate"}`
              : "No pending changes"}
        </span>
        <div>
          <button
            type="button"
            disabled={!history.past.length || applying}
            onClick={() => dispatch({ type: "undo" })}
          >
            Undo
          </button>
          <button
            type="button"
            disabled={!history.future.length || applying}
            onClick={() => dispatch({ type: "redo" })}
          >
            Redo
          </button>
          <button
            type="button"
            disabled={!changes || applying}
            onClick={() => {
              change("Discard changes", baseline);
              setMergeIds([]);
            }}
          >
            Discard
          </button>
          <button
            type="button"
            className="studio-primary"
            disabled={applying || (!changes && hasPdf)}
            onClick={apply}
          >
            {applying ? "Validating…" : "Apply changes →"}
          </button>
        </div>
      </footer>
      {manual && (
        <StudioDialog
          title="Edit achievement manually"
          onClose={() => setManual(null)}
        >
          <div className="imagination-body">
            <label className="studio-field">
              <span>Achievement destination</span>
              <select
                value={manual.groupId}
                disabled={Boolean(
                  document.bullets.find((bullet) => bullet.id === manual.id)
                    ?.sourceAchievementIds.length,
                )}
                onChange={(event) =>
                  setManual({ ...manual, groupId: event.target.value })
                }
              >
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.title} · {group.subtitle}
                  </option>
                ))}
              </select>
            </label>
            {Boolean(
              document.bullets.find((bullet) => bullet.id === manual.id)
                ?.sourceAchievementIds.length,
            ) && (
              <p className="studio-muted">
                Source-backed achievements stay with their original company or
                project. Use the arrow controls to reorder them.
              </p>
            )}
            <label className="studio-field">
              <span>Achievement text</span>
              <textarea
                data-studio-focus=""
                rows={6}
                maxLength={8000}
                value={manual.text}
                onChange={(event) =>
                  setManual({ ...manual, text: event.target.value })
                }
              />
            </label>
            <p className="studio-muted">
              {estimateBulletLines(manual.text, measurements)
                ? `About ${estimateBulletLines(manual.text, measurements)} template lines. `
                : ""}
              Final fit is checked when you apply the draft.
            </p>
            <div className="studio-dialog-footer">
              <button type="button" onClick={() => setManual(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="studio-primary"
                disabled={!manual.text.trim()}
                onClick={() => {
                  change("Edit achievement manually", {
                    ...document,
                    bullets: document.bullets.map((bullet) =>
                      bullet.id === manual.id
                        ? {
                            ...bullet,
                            text: manual.text.trim(),
                            groupId: manual.groupId,
                          }
                        : bullet,
                    ),
                  });
                  setManual(null);
                }}
              >
                Save draft
              </button>
            </div>
          </div>
        </StudioDialog>
      )}
      {imagination && (
        <AchievementImagination
          library={library}
          source={source}
          operation={imagination.operation}
          sources={document.bullets.filter((bullet) =>
            imagination.ids.includes(bullet.id),
          )}
          destinationGroupId={
            imagination.groupId ??
            document.bullets.find((bullet) =>
              imagination.ids.includes(bullet.id),
            )?.groupId
          }
          onClose={() => setImagination(null)}
          onLibrarySaved={() => {
            setNotice("Achievement saved to your library.");
            router.refresh();
          }}
          onAccept={(accepted) => {
            if (imagination.operation === "merge") {
              change(
                "Merge achievements",
                mergeDraftBullets(
                  document,
                  imagination.ids,
                  accepted.text,
                  accepted.id,
                ),
              );
              setMergeIds([]);
            } else if (imagination.operation === "edit")
              change("Accept AI edit", {
                ...document,
                bullets: document.bullets.map((bullet) =>
                  imagination.ids.includes(bullet.id)
                    ? { ...bullet, text: accepted.text }
                    : bullet,
                ),
              });
            else {
              change("Create achievement", {
                ...document,
                bullets: [
                  ...document.bullets,
                  { ...accepted, originalText: accepted.text },
                ],
              });
              setTab(
                groups.find((group) => group.id === accepted.groupId)
                  ?.section === "projects"
                  ? "projects"
                  : "achievements",
              );
            }
          }}
        />
      )}
    </section>
  );
}
