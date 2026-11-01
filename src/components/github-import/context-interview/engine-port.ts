import {
  DEFAULT_QUESTION_CATALOG as catalog,
  createInterviewState,
  nextQuestion,
  applyAnswer,
  goBack,
  setExtraNotes,
  reviewContext,
  type ProjectContext,
  type InterviewState,
} from "../../../lib/github/context-interview";
import type { ContextInterviewPort, InterviewSnapshot } from "./types";

/** Real catalog adapter. All state belongs to this tab; no fixture or provider calls. */
export function createEngineInterviewPort(
  onChange: (context: ProjectContext, complete: boolean) => void,
  initialContext?: ProjectContext,
): ContextInterviewPort {
  let state = initialContext
    ? {
        ...createInterviewState({
          notes: initialContext.notes?.value ?? "",
          repositorySuggestions: initialContext.repositorySuggestions,
        }),
        answers: initialContext.answers,
        presentedNodeIds: initialContext.answerHistory,
      }
    : createInterviewState();
  let revision = 0;
  let reviewing = false;
  function snapshot(): InterviewSnapshot {
    const next = nextQuestion(catalog, state);
    state = next.state;
    const question =
      next.status === "question" && !reviewing ? next.question : null;
    const complete = next.status === "complete";
    const context = reviewContext(catalog, state);
    onChange(context, complete);
    return {
      catalogVersion: catalog.version,
      phase: question ? "active" : "review",
      currentQuestion: question
        ? {
            id: question.id,
            prompt: question.prompt,
            description: question.reason,
            selectionMode: question.selectionMode,
            informationTargets: question.informationTargets,
            options: question.options
              .filter((o) => o.kind === "choice")
              .map((o) => ({ id: o.id, label: o.label })),
            customOption: { id: "custom", label: question.options[4].label },
          }
        : null,
      currentQuestionNumber: question
        ? state.presentedNodeIds.indexOf(question.id) + 1
        : null,
      canGoBack: question
        ? state.presentedNodeIds.indexOf(question.id) > 0
        : state.presentedNodeIds.length > 0,
      provisionalPlannedQuestionCount: null,
      answers: state.answers.map((answer) => {
        const node = catalog.nodes.find((n) => n.id === answer.nodeId)!;
        return {
          nodeId: answer.nodeId,
          prompt: node.prompt,
          optionIds: answer.optionIds,
          optionLabels: answer.optionIds.map(
            (id) => node.options.find((o) => o.id === id)?.label ?? id,
          ),
          customAnswer: answer.customAnswer ?? null,
          skipped: answer.skipped,
        };
      }),
      notes: state.notes,
      contextRevision: revision,
      applicableQuestionCount: complete ? state.answers.length : null,
      notice: null,
    };
  }
  return {
    async getSnapshot() {
      return snapshot();
    },
    async submitAnswer(answer) {
      reviewing = false;
      state = applyAnswer(catalog, state, {
        ...answer,
        skipped: answer.optionIds.length === 0,
      });
      revision++;
      return snapshot();
    },
    async updateNotes(notes) {
      state = setExtraNotes(state, notes);
      revision++;
      return snapshot();
    },
    async goBack() {
      reviewing = false;
      state = goBack(catalog, state);
      return snapshot();
    },
    async editAnswer(nodeId) {
      if (!state.presentedNodeIds.includes(nodeId))
        throw new Error("Unknown question");
      reviewing = false;
      state = { ...state, currentNodeId: nodeId };
      return snapshot();
    },
    async beginReview() {
      reviewing = true;
      return snapshot();
    },
    async resume(saved) {
      reviewing = saved.phase === "review";
      state = {
        ...createInterviewState({ notes: saved.notes }),
        answers: saved.answers.map((a) => ({
          nodeId: a.nodeId,
          optionIds: [...a.optionIds],
          skipped: a.skipped,
          catalogVersion: catalog.version,
          ...(a.customAnswer ? { customAnswer: a.customAnswer } : {}),
        })),
        presentedNodeIds: [
          ...new Set([
            ...saved.answers.map((a) => a.nodeId),
            ...(saved.currentQuestion ? [saved.currentQuestion.id] : []),
          ]),
        ],
        currentNodeId: saved.currentQuestion?.id ?? null,
      } satisfies InterviewState;
      revision = Math.max(revision, saved.contextRevision);
      return snapshot();
    },
  };
}
