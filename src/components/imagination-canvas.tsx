"use client";
import { apiFetch as fetch } from "@/lib/cloud/api-fetch";
import { useWorkspaceStorage } from "./account-session";

import { useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import type { ResumeLibrary } from "@/lib/schemas/resume-data";
import type { ResumeDataSource } from "@/lib/data/loaders";
import type { AchievementWritingMode } from "@/lib/ai/achievement-writing";
import { studioGroups } from "@/lib/generation/studio-document";
import {
  parseImaginationDraft,
  type ImaginationDraft,
} from "@/lib/generation/imagination-draft";
import { buildImaginationLibraryPoint } from "@/lib/generation/imagination-save";
import ImaginationCanvasLayout from "./imagination-canvas-layout";
import ImaginationComposer, {
  type ImaginationComposerProps,
} from "./imagination-composer";
import ImaginationConnectionCanvas, {
  type ConnectionIdentity,
} from "./imagination-connection-canvas";
import ImaginationContextLibraries from "./imagination-context-libraries";
import ImaginationWritingControls, {
  DEFAULT_IMAGINATION_INSTRUCTION,
  type ImaginationTargetLineCount,
} from "./imagination-writing-controls";
import ImaginationResult from "./imagination-result";
import ImaginationSaveFooter from "./imagination-save-footer";
import "./imagination-canvas-motion.css";

export default function ImaginationCanvas({
  library,
  source,
  onClose,
}: {
  library: ResumeLibrary;
  source: ResumeDataSource;
  onClose: () => void;
}) {
  const [groupId, setGroupId] = useState(studioGroups(library)[0]?.id ?? "");
  const getWorkspaceStorage = useWorkspaceStorage();
  const [text, setText] = useState("");
  const [instruction, setInstruction] = useState(
    DEFAULT_IMAGINATION_INSTRUCTION,
  );
  const [writingMode, setWritingMode] = useState<AchievementWritingMode | null>(
    null,
  );
  const [targetLines, setTargetLines] = useState<ImaginationTargetLineCount>(2);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [proposed, setProposed] = useState("");
  const [measuredLines, setMeasuredLines] = useState<number | null>(null);
  const [layoutWarning, setLayoutWarning] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [showCreateNotice, setShowCreateNotice] = useState(true);
  const [savedDraft, setSavedDraft] = useState<ImaginationDraft | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const controller = useRef<AbortController | null>(null);
  const points = [...library.jobs, ...library.projects].flatMap((group) =>
    group.points
      .filter((point) => point.enabled)
      .map((point) => ({ ...point, groupId: group.id })),
  );
  const destinationPoints = points.filter((point) => point.groupId === groupId);
  const selectedSources = destinationPoints
    .filter((point) => selectedIds.includes(point.id))
    .map((point) => ({
      id: point.id,
      text: point.text,
      sourceAchievementIds: [point.id],
    }));
  const storageKey =
    "resume-changer.imagination-draft.v1:" + source + ":" + library.profile.id;

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      composerRef.current?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    try {
      setSavedDraft(
        parseImaginationDraft(
          getWorkspaceStorage().getItem(storageKey),
          library,
        ),
      );
    } catch {
      setStorageError(
        "Browser storage is unavailable. Keep this page open until you save your achievement.",
      );
    }
    setStorageReady(true);
  }, [storageKey, library, getWorkspaceStorage]);
  useEffect(() => {
    if (!storageReady || savedDraft) return;
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
          ...(writingMode ? { writingMode } : {}),
        }),
      );
    } catch {
      setStorageError(
        "Your unfinished draft could not be saved on this device. Keep this page open until you save your achievement.",
      );
    }
  }, [
    storageReady,
    savedDraft,
    storageKey,
    groupId,
    text,
    instruction,
    selectedIds,
    skillIds,
    targetLines,
    writingMode,
    ,
    getWorkspaceStorage,
  ]);

  function invalidateSuggestion() {
    controller.current?.abort();
    setBusy(false);
    setProposed("");
    setMeasuredLines(null);
    setLayoutWarning("");
    setError("");
    setSaveError("");
  }

  function changeSelection(ids: string[], kind: ConnectionIdentity["kind"]) {
    const otherIds = kind === "achievement" ? skillIds : selectedIds;
    const validIds = new Set(
      kind === "achievement"
        ? destinationPoints.map((point) => point.id)
        : library.skills.map((skill) => skill.id),
    );
    const next = [...new Set(ids)]
      .filter((id) => validIds.has(id))
      .slice(0, 10 - otherIds.length);
    invalidateSuggestion();
    (kind === "achievement" ? setSelectedIds : setSkillIds)(next);
  }

  function restore(draft: ImaginationDraft) {
    invalidateSuggestion();
    setGroupId(draft.groupId);
    setText(draft.text);
    setInstruction(draft.instruction);
    setWritingMode(draft.writingMode ?? null);
    setSelectedIds(draft.selectedIds);
    setSkillIds(draft.skillIds);
    setTargetLines(draft.targetLines as ImaginationTargetLineCount);
    setSavedDraft(null);
  }

  async function imagine() {
    if (
      (!text.trim() && !selectedSources.length) ||
      !groupId ||
      !instruction.trim() ||
      instruction.length > 500
    )
      return;
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
          operation: "create",
          destinationGroupId: groupId,
          sources: selectedSources,
          skillIds,
          draftText: text,
          instruction,
          targetLines,
          ...(writingMode ? { writingMode } : {}),
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
          Number.isInteger(payload.measuredLines) && payload.measuredLines > 0
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
          failure instanceof Error
            ? failure.message
            : "Imagination is unavailable. Your draft is preserved.",
        );
    } finally {
      if (controller.current === abort) setBusy(false);
    }
  }

  async function save() {
    if (!text.trim() || !groupId || source !== "personal" || saving || busy)
      return;
    setSaving(true);
    setSaveError("");
    try {
      const response = await fetch("/api/library/points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildImaginationLibraryPoint({
            parentType: library.jobs.some((job) => job.id === groupId)
              ? "job"
              : "project",
            parentId: groupId,
            pointId: "achievement-" + crypto.randomUUID(),
            reviewedText: text,
            skillIds,
            sourceAchievementIds: selectedSources.flatMap(
              (point) => point.sourceAchievementIds,
            ),
          }),
        ),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? "The achievement could not be saved.");
      try {
        getWorkspaceStorage().removeItem(storageKey);
      } catch {
        /* Saving to the library already succeeded. */
      }
      onClose();
    } catch (failure) {
      setSaveError(
        failure instanceof Error
          ? failure.message
          : "The achievement could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  const composerProps: ImaginationComposerProps = {
    library,
    destinationGroupId: groupId,
    connectedAchievementIds: selectedIds,
    value: text,
    onDestinationChange: (id, compatibleIds) => {
      invalidateSuggestion();
      setGroupId(id);
      setSelectedIds(compatibleIds);
    },
    onTextChange: (value) => {
      invalidateSuggestion();
      setText(value);
    },
    createNotice: source === "personal" && showCreateNotice ? "library" : null,
    onDismissNotice: () => setShowCreateNotice(false),
    restoreDraft: savedDraft,
    onRestoreDraft: restore,
    onDismissRestoreDraft: () => setSavedDraft(null),
    composerRef,
  };
  const connectedItems = [
    ...selectedSources.map((point) => ({
      id: point.id,
      kind: "achievement" as const,
      label: point.text,
    })),
    ...library.skills
      .filter((skill) => skillIds.includes(skill.id))
      .map((skill) => ({
        id: skill.id,
        kind: "skill" as const,
        label: skill.name,
      })),
  ];
  return (
    <div className="imagination-canvas-page" aria-busy={saving}>
      {storageError && (
        <p className="studio-error" role="status">
          {storageError}
        </p>
      )}
      <ImaginationCanvasLayout
        title={<ImaginationComposer {...composerProps} part="intro" />}
        composer={<ImaginationComposer {...composerProps} part="editor" />}
        connectionCanvas={
          <ImaginationConnectionCanvas
            items={connectedItems}
            onConnect={({ id, kind }) => {
              const selected = kind === "achievement" ? selectedIds : skillIds;
              if (!selected.includes(id))
                changeSelection([...selected, id], kind);
            }}
            onRemove={({ id, kind }) =>
              changeSelection(
                (kind === "achievement" ? selectedIds : skillIds).filter(
                  (item) => item !== id,
                ),
                kind,
              )
            }
          />
        }
        contextLibraries={
          <ImaginationContextLibraries
            library={library}
            destinationGroupId={groupId}
            selectedAchievementIds={selectedIds}
            selectedSkillIds={skillIds}
            onSelectedAchievementIdsChange={(ids) =>
              changeSelection(ids, "achievement")
            }
            onSelectedSkillIdsChange={(ids) => changeSelection(ids, "skill")}
          />
        }
        writingControls={
          <ImaginationWritingControls
            selectedMode={writingMode}
            onModeChange={(mode) => {
              invalidateSuggestion();
              setWritingMode(mode);
            }}
            instruction={instruction}
            onInstructionChange={(value) => {
              invalidateSuggestion();
              setInstruction(value);
            }}
            targetLines={targetLines}
            onTargetLinesChange={(value) => {
              invalidateSuggestion();
              setTargetLines(value);
            }}
            targetLineFeedback={
              measuredLines
                ? { status: "measured", lineCount: measuredLines }
                : { status: "estimated" }
            }
            canSubmit={
              Boolean(groupId && (text.trim() || selectedSources.length)) &&
              !saving
            }
            isLoading={busy}
            onSubmit={imagine}
            onCancel={() => {
              controller.current?.abort();
              setBusy(false);
            }}
          />
        }
        result={
          <>
            <div className="imagination-result-divider" aria-hidden="true">
              <ArrowDown size={17} />
            </div>
            <ImaginationResult
              status={
                busy
                  ? "loading"
                  : error
                    ? "error"
                    : proposed
                      ? "ready"
                      : "empty"
              }
              text={proposed}
              measuredLines={measuredLines}
              targetLines={targetLines}
              layoutWarning={layoutWarning}
              errorMessage={error}
              composerRef={composerRef}
              onTextChange={(value) => {
                setProposed(value);
                setMeasuredLines(null);
              }}
              onUseSuggestion={(value) => {
                setText(value);
                setSaveError("");
              }}
              onRegenerate={imagine}
            />
          </>
        }
        footer={
          <ImaginationSaveFooter
            operation="create"
            source={source}
            allowResume={false}
            hasLibraryDestination={Boolean(groupId)}
            saveTo={source === "personal" && groupId ? "library" : null}
            canSave={Boolean(text.trim() && groupId)}
            isBusy={busy}
            isSaving={saving}
            error={saveError}
            onSaveToChange={() => {}}
            onCancel={onClose}
            onSave={save}
          />
        }
      />
    </div>
  );
}
