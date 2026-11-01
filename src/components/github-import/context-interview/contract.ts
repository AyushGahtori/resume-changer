import {
  CONTEXT_INTERVIEW_MAX_CODE_POINTS,
  CONTEXT_INTERVIEW_MAX_QUESTIONS,
  type InterviewAnswerSummary,
  type InterviewChoice,
  type InterviewQuestion,
  type InterviewSnapshot,
} from "./types";

const ID_LIMIT = 120;
const TEXT_LIMIT = 4_000;

export function countCodePoints(value: string) {
  return Array.from(value).length;
}

export function limitCodePoints(
  value: string,
  limit = CONTEXT_INTERVIEW_MAX_CODE_POINTS,
) {
  return Array.from(value).slice(0, limit).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedText(value: unknown, max = TEXT_LIMIT): value is string {
  return typeof value === "string" && countCodePoints(value) <= max;
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= ID_LIMIT &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
}

function isChoice(value: unknown): value is InterviewChoice {
  return (
    isRecord(value) &&
    isIdentifier(value.id) &&
    isBoundedText(value.label, 500) &&
    value.label.trim().length > 0 &&
    (value.description === undefined || isBoundedText(value.description, 1_000))
  );
}

export function isInterviewQuestion(
  value: unknown,
): value is InterviewQuestion {
  if (!isRecord(value)) return false;
  if (
    !isIdentifier(value.id) ||
    !isBoundedText(value.prompt) ||
    value.prompt.trim().length === 0 ||
    (value.description !== undefined && !isBoundedText(value.description)) ||
    (value.selectionMode !== "single" && value.selectionMode !== "multiple") ||
    !Array.isArray(value.informationTargets) ||
    !value.informationTargets.every(isIdentifier) ||
    !Array.isArray(value.options) ||
    value.options.length !== 4 ||
    !value.options.every(isChoice) ||
    !isChoice(value.customOption)
  ) {
    return false;
  }

  const ids = [
    ...value.options.map((option) => option.id),
    value.customOption.id,
  ];
  return new Set(ids).size === ids.length;
}

function isAnswerSummary(value: unknown): value is InterviewAnswerSummary {
  if (!isRecord(value)) return false;
  return (
    isIdentifier(value.nodeId) &&
    isBoundedText(value.prompt) &&
    Array.isArray(value.optionIds) &&
    value.optionIds.every(isIdentifier) &&
    Array.isArray(value.optionLabels) &&
    value.optionLabels.every((label) => isBoundedText(label, 500)) &&
    value.optionIds.length === value.optionLabels.length &&
    (value.customAnswer === null ||
      (isBoundedText(value.customAnswer, CONTEXT_INTERVIEW_MAX_CODE_POINTS) &&
        value.customAnswer.length > 0)) &&
    typeof value.skipped === "boolean" &&
    (value.skipped ? value.optionIds.length === 0 : value.optionIds.length > 0)
  );
}

/** Validate all untrusted responses before rendering their content. */
export function isInterviewSnapshot(
  value: unknown,
): value is InterviewSnapshot {
  if (!isRecord(value)) return false;
  const phase = value.phase;
  const rawAnswers = value.answers;
  const rawQuestion = value.currentQuestion;
  const questionNumber = value.currentQuestionNumber;
  const applicableCount = value.applicableQuestionCount;

  if (
    !isIdentifier(value.catalogVersion) ||
    !["active", "review", "empty", "expired"].includes(String(phase)) ||
    !Array.isArray(rawAnswers) ||
    rawAnswers.length > CONTEXT_INTERVIEW_MAX_QUESTIONS ||
    !rawAnswers.every(isAnswerSummary) ||
    !isBoundedText(value.notes, CONTEXT_INTERVIEW_MAX_CODE_POINTS) ||
    typeof value.contextRevision !== "number" ||
    !Number.isInteger(value.contextRevision) ||
    value.contextRevision < 0 ||
    typeof value.canGoBack !== "boolean" ||
    (value.notice !== null && !isBoundedText(value.notice, 1_000)) ||
    (value.prunedAnswerIds !== undefined &&
      (!Array.isArray(value.prunedAnswerIds) ||
        !value.prunedAnswerIds.every(isIdentifier)))
  ) {
    return false;
  }

  const answers = rawAnswers as InterviewAnswerSummary[];
  if (new Set(answers.map((answer) => answer.nodeId)).size !== answers.length) {
    return false;
  }

  let currentQuestion: InterviewQuestion | null;
  if (rawQuestion === null) {
    currentQuestion = null;
  } else if (isInterviewQuestion(rawQuestion)) {
    currentQuestion = rawQuestion;
  } else {
    return false;
  }

  if (currentQuestion) {
    const currentAnswer = answers.find(
      (answer) => answer.nodeId === currentQuestion.id,
    );
    const currentOptionIds = new Set([
      ...currentQuestion.options.map((option) => option.id),
      currentQuestion.customOption.id,
    ]);
    if (
      currentAnswer?.optionIds.some(
        (optionId) => !currentOptionIds.has(optionId),
      )
    ) {
      return false;
    }
  }

  const rawPlan = value.provisionalPlannedQuestionCount;
  if (rawPlan !== null) {
    if (
      !isRecord(rawPlan) ||
      rawPlan.provisional !== true ||
      typeof rawPlan.count !== "number" ||
      !Number.isInteger(rawPlan.count) ||
      rawPlan.count < 1 ||
      rawPlan.count > CONTEXT_INTERVIEW_MAX_QUESTIONS
    ) {
      return false;
    }
  }

  if (applicableCount !== null) {
    if (
      typeof applicableCount !== "number" ||
      !Number.isInteger(applicableCount) ||
      applicableCount < 0 ||
      applicableCount > CONTEXT_INTERVIEW_MAX_QUESTIONS
    ) {
      return false;
    }
  }

  if (phase === "active") {
    return (
      currentQuestion !== null &&
      typeof questionNumber === "number" &&
      Number.isInteger(questionNumber) &&
      questionNumber >= 1 &&
      questionNumber <= CONTEXT_INTERVIEW_MAX_QUESTIONS &&
      applicableCount === null
    );
  }

  if (phase === "review") {
    return (
      currentQuestion === null &&
      questionNumber === null &&
      applicableCount !== null &&
      answers.length <= applicableCount
    );
  }

  if (phase === "empty") {
    return (
      currentQuestion === null &&
      questionNumber === null &&
      answers.length === 0
    );
  }

  return (
    questionNumber === null ||
    (typeof questionNumber === "number" &&
      Number.isInteger(questionNumber) &&
      questionNumber >= 1 &&
      questionNumber <= CONTEXT_INTERVIEW_MAX_QUESTIONS)
  );
}

export function currentAnswerFor(snapshot: InterviewSnapshot, nodeId: string) {
  return snapshot.answers.find((answer) => answer.nodeId === nodeId) ?? null;
}

export function progressLabel(snapshot: InterviewSnapshot) {
  const current = snapshot.currentQuestionNumber;
  if (current === null) return "Interview progress";

  const planned = snapshot.provisionalPlannedQuestionCount;
  return planned?.provisional
    ? `Question ${current} · ${planned.count} currently planned`
    : `Question ${current} · up to ${CONTEXT_INTERVIEW_MAX_QUESTIONS}`;
}
