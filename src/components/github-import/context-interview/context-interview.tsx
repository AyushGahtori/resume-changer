"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import "../import-tokens.css";
import {
  countCodePoints,
  currentAnswerFor,
  isInterviewSnapshot,
  limitCodePoints,
  progressLabel,
} from "./contract";
import styles from "./context-interview.module.css";
import type {
  ContextInterviewProps,
  ContextRevisionEvent,
  InterviewAnswer,
  InterviewQuestion,
  InterviewSnapshot,
} from "./types";

type Action =
  | { kind: "submit"; answer: InterviewAnswer }
  | { kind: "back" }
  | { kind: "edit"; nodeId: string }
  | { kind: "review" }
  | { kind: "resume" };

type HistoryMarker = {
  owner: "github-context-interview";
  sessionId: string;
  entryId: string;
  phase: InterviewSnapshot["phase"];
  depth: number;
};

type HistoryEntry = {
  marker: HistoryMarker;
  snapshot: InterviewSnapshot;
};

const HISTORY_KEY = "__githubContextInterview";

function historyMarker(value: unknown): HistoryMarker | null {
  if (!value || typeof value !== "object") return null;
  const marker = (value as Record<string, unknown>)[HISTORY_KEY];
  if (!marker || typeof marker !== "object") return null;
  const candidate = marker as Record<string, unknown>;
  if (
    candidate.owner !== "github-context-interview" ||
    typeof candidate.sessionId !== "string" ||
    typeof candidate.entryId !== "string" ||
    !Number.isInteger(candidate.depth) ||
    !["active", "review", "empty", "expired"].includes(String(candidate.phase))
  ) {
    return null;
  }
  return candidate as HistoryMarker;
}

function withHistoryMarker(state: unknown, marker: HistoryMarker) {
  return {
    ...(state && typeof state === "object"
      ? (state as Record<string, unknown>)
      : {}),
    [HISTORY_KEY]: marker,
  };
}

function selectedAnswerText(
  question: InterviewQuestion,
  optionIds: readonly string[],
  customText: string,
) {
  return [
    ...question.options
      .filter((option) => optionIds.includes(option.id))
      .map((option) => option.label),
    ...(optionIds.includes(question.customOption.id)
      ? [`${question.customOption.label}: ${customText.trim()}`]
      : customText.trim()
        ? [`Additional detail: ${customText.trim()}`]
        : []),
  ];
}

function safeErrorMessage() {
  return "We couldn't update the interview. Your answer is still on this page. Retry when you're ready.";
}

function plannedRouteCount(snapshot: InterviewSnapshot) {
  if (snapshot.phase === "active") {
    return snapshot.provisionalPlannedQuestionCount?.count ?? null;
  }
  if (snapshot.phase === "review") return snapshot.applicableQuestionCount;
  return null;
}

function announcementLabel(snapshot: InterviewSnapshot) {
  if (snapshot.phase === "review") {
    const remaining = Math.max(
      0,
      (snapshot.applicableQuestionCount ?? snapshot.answers.length) -
        snapshot.answers.length,
    );
    return `Interview review. ${snapshot.answers.length} applicable questions completed; ${remaining} remaining.`;
  }
  if (snapshot.phase === "empty") {
    return "No relevant questions remain. Review the context collected so far.";
  }
  return progressLabel(snapshot);
}

export function ContextInterview({
  port,
  onContextRevisionChange,
  attachments,
  className,
}: ContextInterviewProps) {
  const [snapshot, setSnapshot] = useState<InterviewSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [retryAction, setRetryAction] = useState<Action | null>(null);
  const [retryPushHistory, setRetryPushHistory] = useState(true);
  const [notice, setNotice] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [optionIds, setOptionIds] = useState<string[]>([]);
  const [customDraft, setCustomDraft] = useState("");
  const [focusRequest, setFocusRequest] = useState(0);
  const [localRevision, setLocalRevision] = useState(0);
  const snapshotRef = useRef<InterviewSnapshot | null>(null);
  const revisionCallbackRef = useRef(onContextRevisionChange);
  const notesDraftRef = useRef("");
  const revisionRef = useRef(0);
  const busyRef = useRef(false);
  const questionDraftIdRef = useRef<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const historyRef = useRef<{
    sessionId: string;
    entries: HistoryEntry[];
    cursor: number;
  } | null>(null);

  useEffect(() => {
    revisionCallbackRef.current = onContextRevisionChange;
  }, [onContextRevisionChange]);

  const publishRevision = useCallback(
    (
      reason: ContextRevisionEvent["reason"],
      prunedAnswerIds: string[] = [],
    ) => {
      const next = Math.max(
        revisionRef.current + 1,
        (snapshotRef.current?.contextRevision ?? 0) + 1,
      );
      revisionRef.current = next;
      setLocalRevision(next);
      revisionCallbackRef.current?.({
        revision: next,
        reason,
        prunedAnswerIds,
      });
    },
    [],
  );

  const acceptSnapshot = useCallback(
    (
      candidate: unknown,
      focus = false,
      reason: ContextRevisionEvent["reason"] = "answer",
    ) => {
      if (!isInterviewSnapshot(candidate)) {
        throw new Error("Invalid interview response");
      }

      const next = candidate;
      const previous = snapshotRef.current;
      snapshotRef.current = next;
      revisionRef.current = Math.max(revisionRef.current, next.contextRevision);
      setLocalRevision(revisionRef.current);
      setSnapshot(next);
      notesDraftRef.current = next.notes;
      setNotesDraft(next.notes);
      const oldRouteCount = previous ? plannedRouteCount(previous) : null;
      const nextRouteCount = plannedRouteCount(next);
      const routeChanged = Boolean(
        previous?.phase === "active" &&
        (next.phase === "active" || next.phase === "review") &&
        oldRouteCount !== null &&
        nextRouteCount !== null &&
        oldRouteCount !== nextRouteCount,
      );
      const routeNotice = routeChanged
        ? `The applicable interview route changed from ${oldRouteCount} to ${nextRouteCount} questions.`
        : "";
      if (focus) {
        const spokenNotice = next.notice || routeNotice;
        setNotice(spokenNotice);
        setAnnouncement(
          [announcementLabel(next), spokenNotice].filter(Boolean).join(". "),
        );
        setFocusRequest((value) => value + 1);
      } else if (next.notice) {
        setNotice(next.notice);
      }

      if (
        previous &&
        next.contextRevision > previous.contextRevision &&
        next.phase !== "expired"
      ) {
        publishRevision(reason, [...(next.prunedAnswerIds ?? [])]);
      }
      return next;
    },
    [publishRevision],
  );

  const initializeHistory = useCallback((initial: InterviewSnapshot) => {
    if (typeof window === "undefined") return;
    if (historyRef.current) return;
    const sessionId = `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const marker: HistoryMarker = {
      owner: "github-context-interview",
      sessionId,
      entryId: `${sessionId}-0`,
      phase: initial.phase,
      depth: 0,
    };
    historyRef.current = {
      sessionId,
      entries: [{ marker, snapshot: initial }],
      cursor: 0,
    };
    window.history.pushState(
      withHistoryMarker(window.history.state, marker),
      "",
      window.location.href,
    );
  }, []);

  const pushHistoryEntry = useCallback((next: InterviewSnapshot) => {
    if (typeof window === "undefined") return;
    const history = historyRef.current;
    if (!history) return;
    const depth = history.cursor + 1;
    const marker: HistoryMarker = {
      owner: "github-context-interview",
      sessionId: history.sessionId,
      entryId: `${history.sessionId}-${depth}-${Date.now()}`,
      phase: next.phase,
      depth,
    };
    history.entries = history.entries.slice(0, history.cursor + 1);
    history.entries.push({ marker, snapshot: next });
    history.cursor = depth;
    window.history.pushState(
      withHistoryMarker(window.history.state, marker),
      "",
      window.location.href,
    );
  }, []);

  const performAction = useCallback(
    async (
      action: Action,
      options: { pushHistory?: boolean; recoverOnRetry?: boolean } = {},
    ) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setActionError(false);
      setRetryAction(null);
      setLoadError(false);

      try {
        let current = snapshotRef.current;
        if (!current) throw new Error("Interview is not loaded");

        if (
          action.kind !== "resume" &&
          notesDraftRef.current !== current.notes
        ) {
          current = acceptSnapshot(
            await port.updateNotes(notesDraftRef.current),
            false,
            "notes",
          );
        }

        if (options.recoverOnRetry && action.kind === "submit") {
          const recovered = await port.getSnapshot();
          if (!isInterviewSnapshot(recovered)) {
            throw new Error("Invalid interview response");
          }
          const submitted = recovered.answers.find(
            (answer) => answer.nodeId === action.answer.nodeId,
          );
          const optionIdsMatch =
            submitted?.optionIds.length === action.answer.optionIds.length &&
            [...(submitted?.optionIds ?? [])].sort().join("\u0000") ===
              [...action.answer.optionIds].sort().join("\u0000");
          const customAnswerMatch =
            (submitted?.customAnswer ?? null) ===
            (action.answer.customAnswer?.trim() || null);
          const alreadyApplied =
            Boolean(
              submitted &&
              submitted.skipped === (action.answer.optionIds.length === 0),
            ) &&
            optionIdsMatch &&
            customAnswerMatch &&
            (recovered.phase !== "active" ||
              recovered.currentQuestion?.id !== action.answer.nodeId);
          if (alreadyApplied) {
            const accepted = acceptSnapshot(recovered, true);
            setActionError(false);
            setRetryAction(null);
            setRetryPushHistory(true);
            setNotice(accepted.notice ?? "");
            if (options.pushHistory !== false) pushHistoryEntry(accepted);
            return;
          }
        }

        let response: InterviewSnapshot;
        switch (action.kind) {
          case "submit":
            response = await port.submitAnswer(action.answer);
            break;
          case "back":
            response = await port.goBack();
            break;
          case "edit":
            response = await port.editAnswer(action.nodeId);
            break;
          case "review":
            response = await port.beginReview();
            break;
          case "resume":
            response = await port.resume({
              ...current,
              notes: notesDraftRef.current,
            });
            break;
        }

        const accepted = acceptSnapshot(response, true);
        setActionError(false);
        setRetryAction(null);
        setRetryPushHistory(true);
        if (accepted.phase === "empty") {
          setNotice(
            "No relevant follow-up questions remain. You can review the context collected so far.",
          );
        }
        if (options.pushHistory !== false) pushHistoryEntry(accepted);
      } catch {
        setActionError(true);
        setRetryAction(action);
        setRetryPushHistory(options.pushHistory !== false);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [acceptSnapshot, port, pushHistoryEntry],
  );

  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const initial = acceptSnapshot(await port.getSnapshot(), false);
      initializeHistory(initial);
      if (initial.phase === "empty") {
        setNotice(
          "No relevant follow-up questions remain. You can review the context collected so far.",
        );
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [acceptSnapshot, initializeHistory, port]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  const currentQuestion = snapshot?.currentQuestion ?? null;
  useEffect(() => {
    const questionId = currentQuestion?.id ?? null;
    if (!questionId || questionDraftIdRef.current === questionId) return;
    questionDraftIdRef.current = questionId;
    const answer = snapshot ? currentAnswerFor(snapshot, questionId) : null;
    setOptionIds(answer ? [...answer.optionIds] : []);
    setCustomDraft(answer?.customAnswer ?? "");
  }, [currentQuestion?.id, snapshot]);

  useEffect(() => {
    if (focusRequest === 0) return;
    const frame = window.requestAnimationFrame(() => {
      if (snapshotRef.current?.phase === "review") {
        reviewHeadingRef.current?.focus();
      } else {
        headingRef.current?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusRequest]);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const target = historyMarker(event.state);
      const history = historyRef.current;
      if (!target || !history || target.sessionId !== history.sessionId) return;
      const index = history.entries.findIndex(
        (entry) => entry.marker.entryId === target.entryId,
      );
      if (index < 0) return;

      const currentIndex = history.cursor;
      if (busyRef.current) {
        const restoreSteps = currentIndex - index;
        if (restoreSteps !== 0) window.history.go(restoreSteps);
        return;
      }
      history.cursor = index;
      if (index < currentIndex) {
        void performAction(
          target.phase === "review" ? { kind: "review" } : { kind: "back" },
          { pushHistory: false },
        );
      } else if (index > currentIndex) {
        const entry = history.entries[index];
        if (entry) {
          void (async () => {
            if (busyRef.current) return;
            busyRef.current = true;
            setBusy(true);
            try {
              const restored = await port.resume({
                ...entry.snapshot,
                notes: notesDraftRef.current,
              });
              const accepted = acceptSnapshot(restored, true);
              history.entries[index] = { marker: target, snapshot: accepted };
              setActionError(false);
              setRetryAction(null);
            } catch {
              setActionError(true);
              setRetryAction({ kind: "resume" });
              setRetryPushHistory(false);
            } finally {
              busyRef.current = false;
              setBusy(false);
            }
          })();
        }
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [acceptSnapshot, performAction, port]);

  const question = currentQuestion;
  const customSelected = Boolean(
    question && optionIds.includes(question.customOption.id),
  );
  const purposeQuestion = Boolean(
    question?.informationTargets.includes("project-purpose"),
  );
  const selectedCount = optionIds.length;
  const questionError = useMemo(() => {
    if (!question || selectedCount === 0) return "";
    if (question.selectionMode === "single" && selectedCount > 1) {
      return "Choose one answer to continue.";
    }
    if (customSelected && !customDraft.trim()) {
      return "Add a short answer for “Something else”, or choose Not sure / Skip.";
    }
    return "";
  }, [customDraft, customSelected, question, selectedCount]);

  function changeOption(optionId: string) {
    if (!question || busy) return;
    if (actionError) {
      setActionError(false);
      setRetryAction(null);
    }
    const next =
      question.selectionMode === "single"
        ? [optionId]
        : optionIds.includes(optionId)
          ? optionIds.filter((id) => id !== optionId)
          : [...optionIds, optionId];
    if (next.join("\u0000") === optionIds.join("\u0000")) return;
    setOptionIds(next);
    setNotice("");
    publishRevision("answer");
  }

  function changeCustomAnswer(event: ChangeEvent<HTMLTextAreaElement>) {
    const next = limitCodePoints(event.currentTarget.value);
    if (next === customDraft) return;
    if (actionError) {
      setActionError(false);
      setRetryAction(null);
    }
    setCustomDraft(next);
    publishRevision("answer");
  }

  function changeNotes(event: ChangeEvent<HTMLTextAreaElement>) {
    const next = limitCodePoints(event.currentTarget.value);
    if (next === notesDraftRef.current) return;
    if (actionError) {
      setActionError(false);
      setRetryAction(null);
    }
    notesDraftRef.current = next;
    setNotesDraft(next);
    publishRevision("notes");
  }

  function submitCurrentAnswer() {
    if (!question || !snapshot || busy || questionError) return;
    if (optionIds.length === 0) {
      setNotice("Choose an answer, or choose Not sure / Skip to continue.");
      return;
    }
    const answer: InterviewAnswer = {
      nodeId: question.id,
      optionIds,
      ...(customDraft.trim() ? { customAnswer: customDraft.trim() } : {}),
      catalogVersion: snapshot.catalogVersion,
    };
    setNotice("");
    void performAction({ kind: "submit", answer });
  }

  function skipCurrentQuestion() {
    if (!question || !snapshot || busy) return;
    const answer: InterviewAnswer = {
      nodeId: question.id,
      optionIds: [],
      catalogVersion: snapshot.catalogVersion,
    };
    publishRevision("answer");
    setNotice("");
    void performAction({ kind: "submit", answer });
  }

  function goBack() {
    if (!snapshot?.canGoBack || busy) return;
    const history = historyRef.current;
    const marker = historyMarker(window.history.state);
    if (
      history &&
      marker?.sessionId === history.sessionId &&
      history.cursor > 0
    ) {
      window.history.back();
      return;
    }
    void performAction({ kind: "back" });
  }

  function retry() {
    if (busy) return;
    if (retryAction) {
      void performAction(retryAction, {
        pushHistory: retryPushHistory,
        recoverOnRetry: retryAction.kind === "submit",
      });
    } else if (snapshot?.phase === "expired") {
      void performAction({ kind: "resume" });
    } else {
      void loadSnapshot();
    }
  }

  const contextRevision = Math.max(
    localRevision,
    snapshot?.contextRevision ?? 0,
  );
  const wrapperClassName = [styles.root, className].filter(Boolean).join(" ");

  if (loading) {
    return (
      <section
        className={wrapperClassName}
        data-github-import=""
        aria-busy="true"
        aria-live="polite"
      >
        <p className={styles.loading} role="status">
          Loading your project interview…
        </p>
      </section>
    );
  }

  if (loadError || !snapshot) {
    return (
      <section
        className={wrapperClassName}
        data-github-import=""
        aria-labelledby="interview-error-title"
      >
        <div className={styles.stateCard}>
          <p className={styles.eyebrow}>PROJECT CONTEXT</p>
          <h2 id="interview-error-title">We couldn’t load the interview</h2>
          <p>
            If you already entered answers in this tab, they remain available
            through the interview session. Retry to reconnect.
          </p>
          <button type="button" onClick={retry} disabled={busy}>
            Retry interview
          </button>
        </div>
      </section>
    );
  }

  if (snapshot.phase === "expired") {
    return (
      <section
        className={wrapperClassName}
        data-github-import=""
        aria-labelledby="interview-expired-title"
      >
        <div className={styles.stateCard}>
          <p className={styles.eyebrow}>PROJECT CONTEXT</p>
          <h2 id="interview-expired-title">This interview session expired</h2>
          <p>
            The answers shown here are still in this tab. Retry the session to
            continue without entering them again.
          </p>
          {snapshot.answers.length ? (
            <ul className={styles.retainedAnswers}>
              {snapshot.answers.map((answer) => (
                <li key={answer.nodeId}>
                  <strong>{answer.prompt}</strong>
                  <span>
                    {answer.skipped
                      ? "Not sure / skipped"
                      : answer.optionLabels.join(", ") || answer.customAnswer}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className={styles.expiredNotes}>
            <label htmlFor="context-expired-notes">
              Anything else about your project or contribution?
            </label>
            <textarea
              id="context-expired-notes"
              value={notesDraft}
              onChange={changeNotes}
              rows={5}
              maxLength={1_000}
              disabled={busy}
              aria-describedby="context-expired-notes-count"
            />
            <span id="context-expired-notes-count" className={styles.notesHelp}>
              {countCodePoints(notesDraft)} / 500 code points. Notes remain in
              this tab and will be included when you retry.
            </span>
          </div>
          <button type="button" onClick={retry} disabled={busy}>
            Retry session
          </button>
          {actionError ? (
            <p className={styles.error} role="alert">
              {safeErrorMessage()}
            </p>
          ) : null}
        </div>
      </section>
    );
  }

  const skippedCount = snapshot.answers.filter(
    (answer) => answer.skipped,
  ).length;
  const completedCount = snapshot.answers.length;
  const remainingCount = Math.max(
    0,
    (snapshot.applicableQuestionCount ?? completedCount) - completedCount,
  );

  return (
    <section
      className={wrapperClassName}
      data-github-import=""
      data-context-revision={contextRevision}
      aria-busy={busy}
    >
      <header className={styles.header}>
        <p className={styles.eyebrow}>PROJECT CONTEXT</p>
        <h1>Tell us about the project you worked on</h1>
        <p>
          A few focused questions help keep project purpose, your contribution,
          and repository evidence clear.
        </p>
      </header>

      <div className={styles.columns}>
        <main className={styles.interviewColumn}>
          {snapshot.phase === "active" && question ? (
            <article
              className={styles.questionCard}
              aria-labelledby="context-question-title"
            >
              <div className={styles.questionMeta}>
                <span className={styles.stepLabel}>Adaptive interview</span>
                <span
                  className={styles.questionLimit}
                  data-testid="context-progress-label"
                  key={snapshot.currentQuestionNumber}
                >
                  {progressLabel(snapshot)}
                </span>
              </div>
              <p
                className={styles.progressAnnouncement}
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {announcement}
              </p>
              <div
                className={styles.questionContent}
                data-testid="context-question-content"
                key={question.id}
              >
                <h2
                  id="context-question-title"
                  ref={headingRef}
                  tabIndex={-1}
                  className={styles.questionTitle}
                >
                  {question.prompt}
                </h2>
                {question.description ? (
                  <p
                    id={`context-question-description-${question.id}`}
                    className={styles.questionDescription}
                  >
                    {question.description}
                  </p>
                ) : null}

                <fieldset
                  className={styles.options}
                  disabled={busy}
                  aria-describedby={
                    question.description
                      ? `context-question-description-${question.id}`
                      : undefined
                  }
                >
                  <legend>
                    {question.selectionMode === "multiple"
                      ? "Choose all that apply"
                      : "Choose one answer"}
                  </legend>
                  {question.options.map((option) => {
                    const inputId = `context-option-${question.id}-${option.id}`;
                    const checked = optionIds.includes(option.id);
                    return (
                      <label
                        key={option.id}
                        htmlFor={inputId}
                        className={styles.option}
                        data-selected={checked || undefined}
                      >
                        <input
                          id={inputId}
                          name={`context-question-${question.id}`}
                          type={
                            question.selectionMode === "multiple"
                              ? "checkbox"
                              : "radio"
                          }
                          value={option.id}
                          checked={checked}
                          onChange={() => changeOption(option.id)}
                        />
                        <span className={styles.optionCopy}>
                          <span className={styles.optionLabel}>
                            {option.label}
                          </span>
                          {option.description ? (
                            <span className={styles.optionDescription}>
                              {option.description}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                  {(() => {
                    const option = question.customOption;
                    const inputId = `context-option-${question.id}-${option.id}`;
                    const checked = optionIds.includes(option.id);
                    return (
                      <label
                        htmlFor={inputId}
                        className={styles.option}
                        data-selected={checked || undefined}
                        data-custom="true"
                      >
                        <input
                          id={inputId}
                          name={`context-question-${question.id}`}
                          type={
                            question.selectionMode === "multiple"
                              ? "checkbox"
                              : "radio"
                          }
                          value={option.id}
                          checked={checked}
                          onChange={() => changeOption(option.id)}
                        />
                        <span className={styles.optionCopy}>
                          <span className={styles.optionLabel}>
                            {option.label}
                          </span>
                          {option.description ? (
                            <span className={styles.optionDescription}>
                              {option.description}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })()}
                </fieldset>

                {customSelected || purposeQuestion ? (
                  <div className={styles.customAnswer}>
                    <label htmlFor="context-custom-answer">
                      {customSelected
                        ? "Your answer"
                        : "Clarify what the project is for (optional)"}
                    </label>
                    <textarea
                      id="context-custom-answer"
                      value={customDraft}
                      onChange={changeCustomAnswer}
                      rows={3}
                      maxLength={1_000}
                      disabled={busy}
                      aria-describedby="context-custom-count context-custom-hint"
                    />
                    <div className={styles.textareaFooter}>
                      <span id="context-custom-hint">
                        {customSelected
                          ? "Keep it brief. Your answer can add to the choices above."
                          : "This is separate from who owned or contributed to the project."}
                      </span>
                      <span id="context-custom-count">
                        {countCodePoints(customDraft)} / 500 code points
                      </span>
                    </div>
                  </div>
                ) : null}

                {questionError ? (
                  <p className={styles.validation} role="alert">
                    {questionError}
                  </p>
                ) : null}
                {notice ? (
                  <p
                    className={styles.notice}
                    role={snapshot.notice ? undefined : "status"}
                  >
                    {notice}
                  </p>
                ) : null}
                {actionError ? (
                  <div className={styles.errorBlock} role="alert">
                    <p>{safeErrorMessage()}</p>
                    <button type="button" onClick={retry} disabled={busy}>
                      Retry without losing this answer
                    </button>
                  </div>
                ) : null}
                {busy ? (
                  <p
                    className={styles.busyStatus}
                    role="status"
                    aria-live="polite"
                  >
                    Updating your interview…
                  </p>
                ) : null}
              </div>

              <div className={styles.questionActions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={goBack}
                  disabled={busy || !snapshot.canGoBack}
                >
                  Back
                </button>
                <button
                  type="button"
                  className={styles.skipButton}
                  onClick={skipCurrentQuestion}
                  disabled={busy}
                >
                  Not sure / Skip
                </button>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={submitCurrentAnswer}
                  disabled={
                    busy || selectedCount === 0 || Boolean(questionError)
                  }
                >
                  Continue
                </button>
              </div>
            </article>
          ) : null}

          {snapshot.phase === "empty" ? (
            <article
              className={styles.stateCard}
              aria-labelledby="context-empty-title"
            >
              <p
                className={styles.progressAnnouncement}
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {announcement}
              </p>
              <p className={styles.eyebrow}>INTERVIEW COMPLETE</p>
              <h2 id="context-empty-title">No more relevant questions</h2>
              <p>
                No applicable follow-up questions remain. You can review the
                context collected so far without adding unrelated questions.
              </p>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => void performAction({ kind: "review" })}
                disabled={busy}
              >
                Review answers
              </button>
              {actionError ? (
                <p className={styles.error} role="alert">
                  {safeErrorMessage()}
                </p>
              ) : null}
            </article>
          ) : null}

          {snapshot.phase === "review" ? (
            <article
              className={styles.reviewCard}
              aria-labelledby="context-review-title"
            >
              <p
                className={styles.progressAnnouncement}
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {announcement}
              </p>
              <p className={styles.eyebrow}>REVIEW YOUR CONTEXT</p>
              <h2
                id="context-review-title"
                ref={reviewHeadingRef}
                tabIndex={-1}
              >
                Check your answers
              </h2>
              <p className={styles.reviewCounts}>
                {completedCount} applicable question
                {completedCount === 1 ? "" : "s"} completed · {remainingCount}{" "}
                remaining
                {skippedCount ? ` · ${skippedCount} skipped` : ""}
              </p>
              <p className={styles.reviewHint}>
                These answers describe the project and your contribution. They
                do not prove authorship or measured outcomes.
              </p>
              {notice ? <p className={styles.notice}>{notice}</p> : null}
              <ol className={styles.answerList}>
                {snapshot.answers.map((answer) => (
                  <li key={answer.nodeId} className={styles.answerItem}>
                    <div className={styles.answerCopy}>
                      <h3>{answer.prompt}</h3>
                      {answer.skipped ? (
                        <p>Not sure / skipped</p>
                      ) : (
                        <>
                          <p>
                            {answer.optionLabels.join(", ") ||
                              "No structured choice"}
                          </p>
                          {answer.customAnswer ? (
                            <p className={styles.answerDetail}>
                              Additional context: {answer.customAnswer}
                            </p>
                          ) : null}
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      className={styles.editButton}
                      onClick={() =>
                        void performAction({
                          kind: "edit",
                          nodeId: answer.nodeId,
                        })
                      }
                      disabled={busy}
                    >
                      Edit answer
                    </button>
                  </li>
                ))}
              </ol>
              {actionError ? (
                <div className={styles.errorBlock} role="alert">
                  <p>{safeErrorMessage()}</p>
                  <button type="button" onClick={retry} disabled={busy}>
                    Retry without losing this answer
                  </button>
                </div>
              ) : null}
              <div className={styles.reviewActions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={goBack}
                  disabled={busy || !snapshot.canGoBack}
                >
                  Back to interview
                </button>
              </div>
            </article>
          ) : null}
        </main>

        <aside
          className={styles.supportingColumn}
          aria-label="Additional project context"
        >
          <section
            className={styles.notesCard}
            aria-labelledby="context-notes-title"
          >
            <div className={styles.notesHeader}>
              <div>
                <p className={styles.eyebrow}>YOUR NOTES</p>
                <h2 id="context-notes-title">
                  Anything else about your project or contribution?
                </h2>
              </div>
              <span className={styles.notesCount}>
                {countCodePoints(notesDraft)} / 500 code points
              </span>
            </div>
            <label className={styles.srOnly} htmlFor="context-notes">
              Anything else about your project or contribution?
            </label>
            <textarea
              id="context-notes"
              value={notesDraft}
              onChange={changeNotes}
              rows={7}
              maxLength={1_000}
              disabled={busy}
              aria-describedby="context-notes-help"
            />
            <p id="context-notes-help" className={styles.notesHelp}>
              Optional. Keep project purpose and your own contribution distinct.
              Notes stay in this tab and are not saved to browser storage.
            </p>
          </section>

          <section
            className={styles.workflowCard}
            aria-label="What happens after the interview"
          >
            <p className={styles.eyebrow}>AFTER THIS INTERVIEW</p>
            <p>
              Evidence preparation is a separate step. Any AI analysis happens
              only after you review the prepared evidence and approve it.
            </p>
          </section>
        </aside>
        {attachments ? (
          <section
            className={styles.attachments}
            aria-label="Optional project screenshots"
          >
            {attachments}
          </section>
        ) : null}
      </div>
      {actionError && snapshot.phase === "empty" ? (
        <p className={styles.error} role="alert">
          {safeErrorMessage()}
        </p>
      ) : null}
    </section>
  );
}
