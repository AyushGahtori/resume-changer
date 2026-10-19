"use client";
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
  const [groupId, setGroupId] = useState(
    destinationGroupId ?? groups[0]?.id ?? "",
  );
  const [text, setText] = useState("");
  const [instruction, setInstruction] = useState(
    operation === "merge"
      ? "Combine these achievements into one concise technical bullet, preserving the facts and metrics."
      : operation === "edit"
        ? "Make this achievement clearer and more concise, preserving the technical facts and metrics."
        : "Create a concise, factual achievement from only the connected context.",
  );
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
  const [saveTo, setSaveTo] = useState<"resume" | "library" | "both">(
    allowResume ? "resume" : "library",
  );
  const controller = useRef<AbortController | null>(null);
  const [savedDraft, setSavedDraft] = useState<ImaginationDraft | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const storageKey = `resume-changer.imagination-draft.v1:${source}:${library.profile.id}`;
  const points = [...library.jobs, ...library.projects].flatMap((group) =>
    group.points
      .filter((point) => point.enabled)
      .map((point) => ({ ...point, groupId: group.id })),
  );
  const contextCount = selectedIds.length + skillIds.length;
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
      setSavedDraft(
        parseImaginationDraft(localStorage.getItem(storageKey), library),
      );
    } catch {
      /* Writing remains available without browser storage. */
    }
    setStorageReady(true);
  }, [operation, storageKey, library]);
  useEffect(() => {
    if (operation !== "create" || !storageReady || savedDraft) return;
    try {
      localStorage.setItem(
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
  ]);

  function invalidateSuggestion() {
    controller.current?.abort();
    setBusy(false);
    setProposed("");
    setMeasuredLines(null);
    setLayoutWarning("");
  }

  function toggleContext(id: string, kind: "achievement" | "skill") {
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
          instruction,
          targetLines,
        }),
      });
      const payload = await response.json();
      if (
        !response.ok ||
        typeof payload.text !== "string" ||
        !payload.text.trim()
      )
        throw new Error(
          payload.error ?? "No suggestion was returned. Try again.",
        );
      if (!abort.signal.aborted) {
        setProposed(payload.text);
        setMeasuredLines(
          typeof payload.measuredLines === "number"
            ? payload.measuredLines
            : null,
        );
        setLayoutWarning(payload.layoutWarning ?? "");
      }
    } catch (failure) {
      if (!abort.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "Imagination is unavailable. Your draft is preserved.",
        );
    } finally {
      if (controller.current === abort) setBusy(false);
    }
  }

  async function accept() {
    const acceptedText = (operation === "create" ? text : proposed).trim();
    if (!acceptedText) {
      setError("Write or accept an achievement before saving.");
      return;
    }
    setSaving(true);
    setError("");
    let id = `studio-${crypto.randomUUID()}`;
    try {
      if (operation === "create" && saveTo !== "resume") {
        if (source !== "personal")
          throw new Error(
            "Switch to your personal library to save an achievement.",
          );
        id = `achievement-${crypto.randomUUID()}`;
        const parentType = library.jobs.some((job) => job.id === groupId)
          ? "job"
          : "project";
        const response = await fetch("/api/library/points", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parentType,
            parentId: groupId,
            point: {
              id,
              text: acceptedText,
              tags: [],
              skillIds,
              metrics: [],
              source: {
                type: "direct-user",
                label: "Reviewed in Imagination Canvas",
                reference: JSON.stringify({
                  sourceAchievementIds: sourceIds,
                  skillIds,
                }),
              },
              enabled: true,
            },
          }),
        });
        const payload = await response.json();
        if (!response.ok)
          throw new Error(
            payload.error ?? "The achievement could not be saved.",
          );
        onLibrarySaved?.();
      }
      if (operation !== "create" || saveTo !== "library" || !allowResume)
        onAccept({
          id,
          text: acceptedText,
          groupId,
          sourceAchievementIds: sourceIds,
          skillIds: [
            ...new Set([
              ...skillIds,
              ...sources.flatMap((point) => point.skillIds),
            ]),
          ],
        });
      if (operation === "create") {
        try {
          localStorage.removeItem(storageKey);
        } catch {
          /* No browser storage available. */
        }
      }
      onClose();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The achievement could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

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
                <p>An unfinished writing draft is saved on this device.</p>
                <button
                  type="button"
                  onClick={() => {
                    setGroupId(savedDraft.groupId);
                    setText(savedDraft.text);
                    setInstruction(savedDraft.instruction);
                    setSelectedIds(savedDraft.selectedIds);
                    setSkillIds(savedDraft.skillIds);
                    setTargetLines(savedDraft.targetLines);
                    setSavedDraft(null);
                  }}
                >
                  Restore writing draft
                </button>
                <button type="button" onClick={() => setSavedDraft(null)}>
                  Start a new achievement
                </button>
              </div>
            )}
            <label className="studio-field">
              <span>Resume destination</span>
              <select
                value={groupId}
                onChange={(event) => {
                  setGroupId(event.target.value);
                  setSelectedIds([]);
                  invalidateSuggestion();
                }}
              >
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.title} · {group.subtitle}
                  </option>
                ))}
              </select>
            </label>
            <label className="studio-field imagination-composer">
              <span>NEW ACHIEVEMENT</span>
              <textarea
                data-studio-focus=""
                aria-label="Achievement text"
                rows={4}
                maxLength={8000}
                placeholder="Write what you built, improved, or accomplished…"
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  invalidateSuggestion();
                }}
              />
            </label>
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
                ✦
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
                <p>Select or drag context here to connect it to your draft.</p>
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
          </>
        ) : (
          <div className="imagination-originals">
            <h3>
              {operation === "merge"
                ? "Source achievements"
                : "Current achievement"}
            </h3>
            {sources.map((point) => (
              <p key={point.id}>{point.text}</p>
            ))}
          </div>
        )}
        <div className="imagination-instruction">
          <div className="studio-quick-actions">
            {quickActions.map((action) => (
              <button
                type="button"
                key={action}
                onClick={() =>
                  setInstruction(
                    `${action}. Preserve the supplied facts, technical details, and metrics.`,
                  )
                }
              >
                {action}
              </button>
            ))}
          </div>
          <label className="studio-field">
            <span>Your instruction</span>
            <textarea
              rows={2}
              maxLength={2000}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
            />
          </label>
          <div className="imagination-request-actions">
            <label>
              Target{" "}
              <select
                aria-label="Target line count"
                value={targetLines}
                onChange={(event) => setTargetLines(Number(event.target.value))}
              >
                {[1, 2, 3, 4].map((lines) => (
                  <option key={lines} value={lines}>
                    {lines} {lines === 1 ? "line" : "lines"}
                  </option>
                ))}
              </select>
            </label>
            <span>Estimated until compiled</span>
            <button
              className="studio-ai-button"
              type="button"
              disabled={busy || !instruction.trim() || !groupId}
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
                onChange={(event) => {
                  setProposed(event.target.value);
                  setMeasuredLines(null);
                  setLayoutWarning(
                    "Wording changed since the line check. Apply will validate the final layout.",
                  );
                }}
              />
            </label>
            {operation === "create" && (
              <button
                type="button"
                onClick={() => {
                  setText(proposed);
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
        <div className="studio-dialog-footer">
          <p className="studio-muted" role="status">
            {measuredLines
              ? `${measuredLines} ${measuredLines === 1 ? "line" : "lines"} confirmed by LaTeX. `
              : ""}
            {layoutWarning || "Review the facts before accepting this draft."}
          </p>
          {operation === "create" && (
            <label>
              Save to{" "}
              <select
                aria-label="Save achievement to"
                value={saveTo}
                onChange={(event) =>
                  setSaveTo(event.target.value as typeof saveTo)
                }
              >
                {allowResume && <option value="resume">Current resume</option>}
                {source === "personal" && (
                  <option value="library">Achievement Library</option>
                )}
                {allowResume && source === "personal" && (
                  <option value="both">Resume and library</option>
                )}
              </select>
            </label>
          )}
          <span className="studio-muted">
            Your PDF updates only after Apply changes.
          </span>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="studio-primary"
            type="button"
            disabled={
              busy ||
              saving ||
              !(operation === "create" ? text.trim() : proposed.trim())
            }
            onClick={accept}
          >
            {saving
              ? "Saving…"
              : operation === "create"
                ? "Save achievement"
                : "Accept draft"}
          </button>
        </div>
      </div>
    </StudioDialog>
  );
}
