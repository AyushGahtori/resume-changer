import type { ReactNode } from "react";

export const CONTEXT_INTERVIEW_MAX_QUESTIONS = 10;
export const CONTEXT_INTERVIEW_MAX_CODE_POINTS = 500;

export type InterviewSelectionMode = "single" | "multiple";

export type InterviewChoice = {
  id: string;
  label: string;
  description?: string;
};

export type InterviewQuestion = {
  id: string;
  prompt: string;
  description?: string;
  selectionMode: InterviewSelectionMode;
  informationTargets: readonly string[];
  options: readonly InterviewChoice[];
  customOption: InterviewChoice;
};

export type InterviewAnswer = {
  nodeId: string;
  optionIds: readonly string[];
  customAnswer?: string;
  catalogVersion: string;
};

export type InterviewAnswerSummary = {
  nodeId: string;
  prompt: string;
  optionIds: readonly string[];
  optionLabels: readonly string[];
  customAnswer: string | null;
  skipped: boolean;
};

export type InterviewSnapshot = {
  catalogVersion: string;
  phase: "active" | "review" | "empty" | "expired";
  currentQuestion: InterviewQuestion | null;
  currentQuestionNumber: number | null;
  canGoBack: boolean;
  provisionalPlannedQuestionCount: {
    count: number;
    provisional: true;
  } | null;
  answers: readonly InterviewAnswerSummary[];
  notes: string;
  contextRevision: number;
  applicableQuestionCount: number | null;
  notice: string | null;
  prunedAnswerIds?: readonly string[];
};

/**
 * UI-facing structural port. Task 01 supplies a production adapter later;
 * this component deliberately does not import its catalog or graph engine.
 */
export type ContextInterviewPort = {
  getSnapshot(): Promise<InterviewSnapshot>;
  submitAnswer(answer: InterviewAnswer): Promise<InterviewSnapshot>;
  updateNotes(notes: string): Promise<InterviewSnapshot>;
  goBack(): Promise<InterviewSnapshot>;
  editAnswer(nodeId: string): Promise<InterviewSnapshot>;
  beginReview(): Promise<InterviewSnapshot>;
  resume(snapshot: InterviewSnapshot): Promise<InterviewSnapshot>;
};

export type ContextRevisionReason = "answer" | "notes";

export type ContextRevisionEvent = {
  revision: number;
  reason: ContextRevisionReason;
  prunedAnswerIds: readonly string[];
};

export type ContextInterviewProps = {
  port: ContextInterviewPort;
  onContextRevisionChange?: (event: ContextRevisionEvent) => void;
  /** Optional screenshot UI supplied by the independent screenshot module. */
  attachments?: ReactNode;
  className?: string;
};
