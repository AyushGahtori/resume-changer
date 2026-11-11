"use client";
import { apiFetch as fetch } from "@/lib/cloud/api-fetch";
import { useWorkspaceStorage } from "./account-session";
import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import StudioDialog from "./studio-dialog";
import { groupSkillsForReview } from "@/lib/generation/review-draft";
import {
  studioGroups,
  type StudioBullet,
} from "@/lib/generation/studio-document";
import type { ResumeLibrary } from "@/lib/schemas/resume-data";
import type { ResumeDataSource } from "@/lib/data/loaders";
import type { AchievementWritingOperation } from "@/lib/ai/achievement-writing";
import {
  parseImaginationDraft,
  type ImaginationDraft,
} from "@/lib/generation/imagination-draft";
import {
  buildImaginationLibraryPoint,
  decideImaginationAcceptance,
  getDefaultImaginationSaveDestination,
  getImaginationSaveDestinations,
  imaginationSaveCopy,
  readImaginationPayload,
  readableImaginationError,
  type ImaginationSaveDestination,
} from "@/lib/generation/imagination-save";
import ImaginationSaveFooter from "./imagination-save-footer";
import { handleCtrlBackspace } from "@/lib/editing/delete-word";
import LibrarySelect from "@/components/library/library-select";
import {
  disconnectedAchievementNotice,
  reconcileDestinationAchievementIds,
} from "./imagination-composer";

export type AcceptedAchievement = {
  id: string;
  text: string;
  groupId: string;
  sourceAchievementIds: string[];
  skillIds: string[];
};
type Props = {
  library: ResumeLibrary;
  source: ResumeDataSource;
  operation: AchievementWritingOperation;
  sources?: StudioBullet[];
  destinationGroupId?: string;
  allowResume?: boolean;
  onClose: () => void;
  onAccept: (achievement: AcceptedAchievement) => void;
  onLibrarySaved?: () => void;
};

export default function AchievementImagination({
  library,
  source,
  operation,
  sources = [],
  destinationGroupId,
  allowResume = true,
  onClose,
  onAccept,
  onLibrarySaved,
}: Props) {
  const groups = studioGroups(library);
  const getWorkspaceStorage = useWorkspaceStorage();
  const [groupId, setGroupId] = useState(
    destinationGroupId ?? groups[0]?.id ?? "",
  );
  const [text, setText] = useState("");
  const suggestedInstruction =
    operation === "merge"
      ? "Combine these achievements into one concise technical bullet, preserving the facts and metrics."
      : operation === "edit"
        ? "Make this achievement clearer and more concise, preserving the technical facts and metrics."
        : "Create a concise, factual achievement from only the connected context.";
  const [instruction, setInstruction] = useState("");
  const [proposed, setProposed] = useState("");
  const [measuredLines, setMeasuredLines] = useState<number | null>(null);
  const [layoutWarning, setLayoutWarning] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [pointSearch, setPointSearch] = useState("");
  const [skillSearch, setSkillSearch] = useState("");
  const [targetLines, setTargetLines] = useState(2);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveTo, setSaveTo] = useState<ImaginationSaveDestination | null>(() =>
    getDefaultImaginationSaveDestination(
      source,
      allowResume,
      groups.length > 0,
    ),
  );
  const [saveError, setSaveError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const draftEdited = useRef(false);
  const [savedDraft, setSavedDraft] = useState<ImaginationDraft | null>(null);
  const [restoreConfirming, setRestoreConfirming] = useState(false);
  const [droppedConnection, setDroppedConnection] = useState<{
    count: number;
    groupId: string;
    selectedIds: string[];
  } | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const storageKey = `resume-changer.imagination-draft.v1:${source}:${library.profile.id}`;
  const points = [...library.jobs, ...library.projects].flatMap((group) =>
    group.points
      .filter((point) => point.enabled)
      .map((point) => ({ ...point, groupId: group.id })),
  );
  const contextCount = selectedIds.length + skillIds.length;
  const hasLibraryDestination = groups.length > 0;
  const saveDestinations = getImaginationSaveDestinations(
    source,
    allowResume,
    hasLibraryDestination,
  );
  const saveDestination =
    saveTo && saveDestinations.includes(saveTo)
      ? saveTo
      : getDefaultImaginationSaveDestination(
          source,
          allowResume,
          hasLibraryDestination,
        );
  const selectedSources =
    operation === "create"
      ? points
          .filter((point) => selectedIds.includes(point.id))
          .map((point) => ({
            id: point.id,
            text: point.text,
            sourceAchievementIds: [point.id],
          }))
      : sources.map((point) => ({
          id: point.id,
          text: point.text,
          sourceAchievementIds: point.sourceAchievementIds,
        }));
  const sourceIds = [
    ...new Set(selectedSources.flatMap((point) => point.sourceAchievementIds)),
  ];

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (operation !== "create") return;
    try {
      const draft = parseImaginationDraft(
        getWorkspaceStorage().getItem(storageKey),
        library,
      );
      if (!draftEdited.current) setSavedDraft(draft);
    } catch {
      /* Writing remains available without browser storage. */
    }
    setStorageReady(true);
  }, [operation, storageKey, library, getWorkspaceStorage]);
  useEffect(() => {
    if (operation !== "create" || !storageReady || savedDraft) return;
    try {
      getWorkspaceStorage().setItem(
        storageKey,
        JSON.stringify({
          groupId,
          text,
          instruction,
          selectedIds,
          skillIds,
          targetLines,
        }),
      );
    } catch {
      /* The author can still save the achievement explicitly. */
    }
  }, [
    operation,
    storageReady,
    savedDraft,
    storageKey,
    groupId,
    text,
    instruction,
    selectedIds,
    skillIds,
    targetLines,
    ,
    getWorkspaceStorage,
  ]);

  function noteEdit() {
    draftEdited.current = true;
    setRestoreConfirming(false);
    setSavedDraft(null);
  }

  function invalidateSuggestion() {
    controller.current?.abort();
    setBusy(false);
    setProposed("");
    setMeasuredLines(null);
    setLayoutWarning("");
  }

  function toggleContext(id: string, kind: "achievement" | "skill") {
    noteEdit();
    invalidateSuggestion();
    const selected = kind === "achievement" ? selectedIds : skillIds;
    const update = kind === "achievement" ? setSelectedIds : setSkillIds;
    if (selected.includes(id)) update(selected.filter((item) => item !== id));
    else if (contextCount < 10) update([...selected, id]);
    else
      setError(
        "Ten context items are connected. Disconnect one before adding another.",
      );
  }

  async function imagine() {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    setProposed("");
    setMeasuredLines(null);
    setLayoutWarning("");
    try {
      const response = await fetch("/api/ai/achievement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          dataSource: source,
          operation,
          destinationGroupId: groupId,
          sources: selectedSources,
          skillIds,
          draftText: operation === "create" ? text : "",
          instruction: instruction.trim() || suggestedInstruction,
          targetLines,
        }),
      });
      const payload = await readImaginationPayload(
        response,
        imaginationSaveCopy.unreadableResponse,
      );
      const suggestionText = payload.text;
      if (
        !response.ok ||
        typeof suggestionText !== "string" ||
        !suggestionText.trim()
      )
        throw new Error(
          typeof payload.error === "string" && payload.error.trim()
            ? payload.error
            : "No suggestion was returned. Try again.",
        );
      if (!abort.signal.aborted) {
        setProposed(suggestionText);
        setMeasuredLines(
          typeof payload.measuredLines === "number"
            ? payload.measuredLines
            : null,
        );
        setLayoutWarning(
          typeof payload.layoutWarning === "string"
            ? payload.layoutWarning
            : "",
        );
      }
    } catch (failure) {
      if (!abort.signal.aborted)
        setError(
          readableImaginationError(
            failure,
            imaginationSaveCopy.unreadableResponse,
          ),
        );
    } finally {
      if (controller.current === abort) setBusy(false);
    }
  }

  async function accept() {
    const decision = decideImaginationAcceptance({
      operation,
      editorText: text,
      proposedText: proposed,
      sourceAchievementIds: sourceIds,
      connectedSkillCount: skillIds.length,
      saveDestination,
      source,
      hasLibraryDestination,
      allowResume,
      groupId,
    });
    if (!decision.ok) {
      setSaveError(decision.error);
      return;
    }
    setSaving(true);
    setSaveError("");
    let id = `studio-${crypto.randomUUID()}`;
    try {
      if (decision.saveToLibrary) {
        if (source !== "personal")
          throw new Error(imaginationSaveCopy.personalLibrarySwitch);
        id = `achievement-${crypto.randomUUID()}`;
        const parentType = library.jobs.some((job) => job.id === groupId)
          ? "job"
          : "project";
        const response = await fetch("/api/library/points", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            buildImaginationLibraryPoint({
              parentType,
              parentId: groupId,
              pointId: id,
              reviewedText: decision.text,
              skillIds,
              sourceAchievementIds: sourceIds,
            }),
          ),
        });
        const payload = await readImaginationPayload(
          response,
          imaginationSaveCopy.unreadableSave,
        );
        if (!response.ok)
          throw new Error(
            typeof payload.error === "string" && payload.error.trim()
              ? payload.error
              : "The achievement could not be saved.",
          );
        onLibrarySaved?.();
      }
      if (decision.resumeSourceIds)
        onAccept({
          id,
          text: decision.text,
          groupId,
          sourceAchievementIds: decision.resumeSourceIds,
          skillIds: [
            ...new Set([
              ...skillIds,
              ...sources.flatMap((point) => point.skillIds),
            ]),
          ],
        });
      if (operation === "create") {
        try {
          getWorkspaceStorage().removeItem(storageKey);
        } catch {
          /* No browser storage available. */
        }
      }
      onClose();
    } catch (failure) {
      setSaveError(
        readableImaginationError(failure, imaginationSaveCopy.unreadableSave),
      );
    } finally {
      setSaving(false);
    }
  }

  const acceptance = decideImaginationAcceptance({
    operation,
    editorText: text,
    proposedText: proposed,
    sourceAchievementIds: sourceIds,
    connectedSkillCount: skillIds.length,
    saveDestination,
    source,
    hasLibraryDestination,
    allowResume,
    groupId,
  });
  const quickActions = [
    "Make shorter",
    "More technical",
    "Improve clarity",
    "Emphasize engineering impact",
    "Improve action verbs",
    "Reduce repetition",
  ];
  return (
    <StudioDialog
      title={
        operation === "create"
          ? "Imagination Canvas"
          : operation === "merge"
            ? "Merge achievements"
            : "Imagine an improvement"
      }
      onClose={onClose}
    >
      <div className="imagination-body">
        {operation === "create" ? (
          <>
            {savedDraft && (
              <div className="studio-restore" role="status">
                <p>
                  You left this achievement before saving it. Restore that
                  version, or clear it and start again.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      text.trim() &&
                      text.trim() !== savedDraft.text.trim() &&
                      !restoreConfirming
                    ) {
                      setRestoreConfirming(true);
                      return;
                    }
                    draftEdited.current = true;
                    setRestoreConfirming(false);
                    setGroupId(savedDraft.groupId);
                    setText(savedDraft.text);
                    setInstruction(savedDraft.instruction);
                    setSelectedIds(savedDraft.selectedIds);
                    setSkillIds(savedDraft.skillIds);
                    setTargetLines(savedDraft.targetLines);
                    setSavedDraft(null);
                  }}
                >
                  {restoreConfirming
                    ? "Replace what you typed"
                    : "Restore writing draft"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    draftEdited.current = true;
                    setRestoreConfirming(false);
                    setSavedDraft(null);
                  }}
                >
                  Start a new achievement
                </button>
              </div>
            )}
            <div className="studio-field">
              <span id="imagination-resume-destination-label">
                Resume destination
              </span>
              <LibrarySelect
                aria-label="Resume destination"
                className="studio-destination-select"
                disabled={groups.length === 0}
                onChange={(next) => {
                  noteEdit();
                  const nextIds = reconcileDestinationAchievementIds(
                    library,
                    next,
                    selectedIds,
                  );
                  const dropped = selectedIds.filter(
                    (id) => !nextIds.includes(id),
                  ).length;
                  setDroppedConnection(
                    dropped > 0
                      ? {
                          count: dropped,
                          groupId,
                          selectedIds: [...selectedIds],
                        }
                      : null,
                  );
                  setGroupId(next);
                  setSelectedIds(nextIds);
                  invalidateSuggestion();
                }}
                options={
                  groups.length === 0
                    ? [{ value: "", label: "A job or project is required." }]
                    : groups.map((group) => ({
                        value: group.id,
                        label: group.subtitle
                          ? `${group.title} · ${group.subtitle}`
                          : group.title,
                      }))
                }
                value={groups.length === 0 ? "" : groupId}
              />
              {droppedConnection && (
                <p className="studio-restore" role="status">
                  {disconnectedAchievementNotice(droppedConnection.count)}{" "}
                  <button
                    type="button"
                    onClick={() => {
                      noteEdit();
                      setGroupId(droppedConnection.groupId);
                      setSelectedIds(droppedConnection.selectedIds);
                      setDroppedConnection(null);
                      invalidateSuggestion();
                    }}
                  >
                    Undo
                  </button>
                </p>
              )}
            </div>
            <div
              className="imagination-context-map"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const value = event.dataTransfer.getData(
                  "application/x-studio-context",
                );
                const [kind, id] = value.split(":");
                if (
                  id &&
                  (kind === "achievement" || kind === "skill") &&
                  !(kind === "achievement" ? selectedIds : skillIds).includes(
                    id,
                  )
                )
                  toggleContext(id, kind);
              }}
            >
              <span className="imagination-root" aria-hidden="true">
                <Sparkles size={15} strokeWidth={2} />
              </span>
              <span>{contextCount} / 10 connected</span>
              <div className="imagination-connected">
                {selectedIds.map((id) => (
                  <button
                    type="button"
                    key={id}
                    onClick={() => toggleContext(id, "achievement")}
                    title={points.find((point) => point.id === id)?.text}
                  >
                    {points.find((point) => point.id === id)?.text.slice(0, 45)}
                    … ×
                  </button>
                ))}
                {skillIds.map((id) => (
                  <button
                    type="button"
                    key={id}
                    onClick={() => toggleContext(id, "skill")}
                  >
                    {library.skills.find((skill) => skill.id === id)?.name} ×
                  </button>
                ))}
              </div>
              {!contextCount && (
                <p>
                  Select points to have Imagination write the achievement. With
                  nothing connected, the text below is what you save.
                </p>
              )}
            </div>
            <div className="imagination-context-libraries">
              <section>
                <h3>Achievements</h3>
                <input
                  aria-label="Search achievement context"
                  type="search"
                  placeholder="Search achievements"
                  value={pointSearch}
                  onChange={(event) => setPointSearch(event.target.value)}
                />
                <div className="imagination-context-list">
                  {points
                    .filter(
                      (point) =>
                        point.groupId === groupId &&
                        point.text
                          .toLowerCase()
                          .includes(pointSearch.toLowerCase()),
                    )
                    .map((point) => (
                      <button
                        className="imagination-context-card"
                        type="button"
                        draggable
                        onDragStart={(event) =>
                          event.dataTransfer.setData(
                            "application/x-studio-context",
                            `achievement:${point.id}`,
                          )
                        }
                        aria-pressed={selectedIds.includes(point.id)}
                        disabled={
                          contextCount >= 10 && !selectedIds.includes(point.id)
                        }
                        key={point.id}
                        onClick={() => toggleContext(point.id, "achievement")}
                      >
                        {point.text}
                      </button>
                    ))}
                </div>
              </section>
              <section>
                <h3>Connected skills</h3>
                <input
                  aria-label="Search skill context"
                  type="search"
                  placeholder="Search declared skills"
                  value={skillSearch}
                  onChange={(event) => setSkillSearch(event.target.value)}
                />
                <div className="imagination-context-list">
                  {groupSkillsForReview(library.skills).map(
                    ({ category, skills }) => {
                      const matching = skills.filter((skill) =>
                        skill.name
                          .toLowerCase()
                          .includes(skillSearch.toLowerCase()),
                      );
                      return matching.length ? (
                        <details key={category} open={Boolean(skillSearch)}>
                          <summary>{category}</summary>
                          <div className="studio-chip-list">
                            {matching.map((skill) => (
                              <button
                                key={skill.id}
                                type="button"
                                draggable
                                onDragStart={(event) =>
                                  event.dataTransfer.setData(
                                    "application/x-studio-context",
                                    `skill:${skill.id}`,
                                  )
                                }
                                aria-pressed={skillIds.includes(skill.id)}
                                disabled={
                                  contextCount >= 10 &&
                                  !skillIds.includes(skill.id)
                                }
                                onClick={() => toggleContext(skill.id, "skill")}
                              >
                                {skill.name}
                              </button>
                            ))}
                          </div>
                        </details>
                      ) : null;
                    },
                  )}
                </div>
              </section>
            </div>
            {contextCount === 0 ? (
              <label className="studio-field imagination-composer">
                <span>Your achievement</span>
                <textarea
                  data-studio-focus=""
                  aria-label="Achievement text"
                  rows={4}
                  maxLength={8000}
                  placeholder="Write the point you want to save…"
                  value={text}
                  onChange={(event) => {
                    noteEdit();
                    setText(event.target.value);
                    setSaveError("");
                    invalidateSuggestion();
                  }}
                  onKeyDown={(event) =>
                    handleCtrlBackspace(event, (next) => {
                      noteEdit();
                      setText(next);
                    })
                  }
                />
                <p>
                  Save this text as the achievement. Connect points above if you
                  want Imagination to write it from those points instead.
                </p>
              </label>
            ) : (
              <p className="imagination-mode-note">
                Imagination writes one achievement from the {contextCount}{" "}
                connected {contextCount === 1 ? "item" : "items"}. It follows
                your instruction and does not keep a separate draft.
              </p>
            )}
          </>
        ) : (
          <div className="imagination-originals">
            <h3>
              {operation === "merge"
                ? "Source achievements"
                : "Current achievement"}
            </h3>
            {sources.length > 1 ? (
              <ol>
                {sources.map((point, index) => (
                  <li key={point.id}>
                    <span>{index + 1}</span>
                    <p>{point.text}</p>
                  </li>
                ))}
              </ol>
            ) : (
              sources.map((point) => <p key={point.id}>{point.text}</p>)
            )}
          </div>
        )}
        <div className="imagination-instruction">
          {(operation !== "create" || contextCount > 0) && (
            <>
              <div className="studio-quick-actions">
                {quickActions.map((action) => (
                  <button
                    type="button"
                    key={action}
                    onClick={() => {
                      noteEdit();
                      setInstruction(
                        `${action}. Preserve the supplied facts, technical details, and metrics.`,
                      );
                    }}
                  >
                    {action}
                  </button>
                ))}
              </div>
              <label className="studio-field">
                <span>Your instruction</span>
                <textarea
                  aria-label="Your instruction"
                  rows={2}
                  maxLength={2000}
                  placeholder={suggestedInstruction}
                  value={instruction}
                  onChange={(event) => {
                    noteEdit();
                    setInstruction(event.target.value);
                  }}
                  onKeyDown={(event) =>
                    handleCtrlBackspace(event, (next) => {
                      noteEdit();
                      setInstruction(next);
                    })
                  }
                />
              </label>
            </>
          )}
          <div className="imagination-request-actions">
            <div
              className="imagination-target"
              role="group"
              aria-label="Target line count"
            >
              <span>Target</span>
              {[1, 2, 3, 4].map((lines) => (
                <button
                  key={lines}
                  type="button"
                  aria-pressed={targetLines === lines}
                  onClick={() => {
                    noteEdit();
                    setTargetLines(lines);
                  }}
                >
                  {lines} {lines === 1 ? "line" : "lines"}
                </button>
              ))}
            </div>
            <span>Estimated until compiled</span>
            <button
              className="studio-ai-button"
              type="button"
              disabled={busy || !groupId}
              aria-describedby={!groupId ? "imagination-ask-hint" : undefined}
              onClick={imagine}
            >
              {busy
                ? "Imagining…"
                : proposed
                  ? "Regenerate"
                  : "✦ Ask Imagination"}
            </button>
            {busy && (
              <button
                type="button"
                onClick={() => {
                  controller.current?.abort();
                  setBusy(false);
                }}
              >
                Cancel request
              </button>
            )}
          </div>
          {!busy && !groupId && (
            <p id="imagination-ask-hint" role="status">
              {imaginationSaveCopy.askNeedsJob}
            </p>
          )}
        </div>
        {busy && (
          <p className="imagination-progress" role="status">
            {operation === "merge"
              ? "Connecting the facts into one coherent point…"
              : operation === "edit"
                ? "Refining your achievement while preserving its facts…"
                : "Shaping a draft from your connected context…"}
          </p>
        )}
        {proposed && (
          <div className="imagination-suggestion">
            <label className="studio-field">
              <span>IMAGINED VERSION · REVIEW BEFORE ACCEPTING</span>
              <textarea
                rows={4}
                maxLength={8000}
                value={proposed}
                onKeyDown={(event) => handleCtrlBackspace(event, setProposed)}
                onChange={(event) => {
                  setProposed(event.target.value);
                  setMeasuredLines(null);
                  setLayoutWarning(
                    "Wording changed since the line check. Apply will validate the final layout.",
                  );
                }}
              />
            </label>
            {operation === "create" && contextCount === 0 && (
              <button
                type="button"
                onClick={() => {
                  setText(proposed);
                  setSaveError("");
                  setProposed("");
                }}
              >
                Use suggestion in editor
              </button>
            )}
          </div>
        )}
        {error && (
          <p className="studio-error" role="alert">
            {error}
          </p>
        )}
        <ImaginationSaveFooter
          operation={operation}
          source={source}
          allowResume={allowResume}
          hasLibraryDestination={hasLibraryDestination}
          saveTo={saveDestination}
          canSave={acceptance.ok}
          disabledReason={acceptance.ok ? "" : acceptance.error}
          isBusy={busy}
          isSaving={saving}
          error={saveError}
          reviewStatus={
            measuredLines
              ? `${measuredLines} ${measuredLines === 1 ? "line" : "lines"} confirmed by LaTeX. ${layoutWarning}`.trim()
              : layoutWarning
          }
          onSaveToChange={(destination) => {
            setSaveTo(destination);
            setSaveError("");
          }}
          onCancel={onClose}
          onSave={accept}
        />
      </div>
    </StudioDialog>
  );
}
