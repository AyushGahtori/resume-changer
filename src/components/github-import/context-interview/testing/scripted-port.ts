import type {
  ContextInterviewPort,
  InterviewAnswer,
  InterviewAnswerSummary,
  InterviewQuestion,
  InterviewSnapshot,
} from "../types";

export type ScriptedRouteLength = 5 | 7 | 10 | "adaptive";

export type ScriptedPortOptions = {
  routeLength?: ScriptedRouteLength;
  delayMs?: number;
  failCalls?: number;
  dropNextAnswerResponse?: boolean;
  initialPhase?: "active" | "empty" | "expired";
};

const catalogVersion = "scripted-context-interview-v1";

const questionSpecs: Record<
  string,
  Omit<InterviewQuestion, "prompt" | "description"> & {
    prompt: string | ((routeKind: "web" | "data" | "other") => string);
    description?: string;
  }
> = {
  "project-purpose": {
    id: "project-purpose",
    prompt: "What is this project for?",
    description:
      "Choose the closest starting point. You can add a short clarification below.",
    selectionMode: "single",
    informationTargets: ["project-purpose", "project-kind"],
    options: [
      { id: "kind-web", label: "A web application or website" },
      { id: "kind-mobile", label: "A mobile application" },
      { id: "kind-data", label: "A data or machine learning system" },
      { id: "kind-tool", label: "A developer or automation tool" },
    ],
    customOption: { id: "custom", label: "Something else" },
  },
  ownership: {
    id: "ownership",
    prompt: "How did you contribute to the project?",
    description:
      "Project ownership is separate from what the project does. Whole-project ownership is a valid answer.",
    selectionMode: "single",
    informationTargets: ["ownership", "contribution-scope"],
    options: [
      { id: "whole-project", label: "I built the whole project from scratch" },
      { id: "selected-areas", label: "I built selected parts of the project" },
      { id: "shared", label: "I worked on it with a team" },
      { id: "unsure", label: "I’m not sure how to describe it" },
    ],
    customOption: { id: "custom", label: "Something else" },
  },
  "contribution-style": {
    id: "contribution-style",
    prompt: "How did you work on it?",
    selectionMode: "single",
    informationTargets: ["contribution-details"],
    options: [
      { id: "solo", label: "I worked on it by myself" },
      { id: "small-team", label: "I worked with a small team" },
      {
        id: "cross-functional",
        label: "I worked across several roles or teams",
      },
      { id: "not-sure", label: "I’m not sure" },
    ],
    customOption: { id: "custom", label: "Something else" },
  },
  capabilities: {
    id: "capabilities",
    prompt: "What can the project do?",
    description: "Choose any capabilities that are part of the project.",
    selectionMode: "multiple",
    informationTargets: ["confirmed-capabilities"],
    options: [
      { id: "user-interface", label: "Show a user interface" },
      { id: "ai", label: "Use AI or machine learning" },
      { id: "data", label: "Store or process data" },
      { id: "integrations", label: "Connect to other tools or services" },
    ],
    customOption: { id: "custom", label: "Something else" },
  },
  "technical-work": {
    id: "technical-work",
    prompt: "What parts of the technical work did you handle?",
    description: "Select more than one when the work crossed areas.",
    selectionMode: "multiple",
    informationTargets: ["contributed-areas", "technical-work"],
    options: [
      { id: "design", label: "Architecture or technical design" },
      { id: "frontend", label: "User interface or frontend" },
      { id: "backend", label: "Backend services or APIs" },
      { id: "operations", label: "Testing, deployment, or operations" },
    ],
    customOption: { id: "custom", label: "Something else" },
  },
  "domain-detail": {
    id: "domain-detail",
    prompt: (routeKind) =>
      routeKind === "web"
        ? "What does the web experience help people do?"
        : routeKind === "data"
          ? "What happens in the data or model workflow?"
          : "What is the main workflow people use?",
    description: "Keep this to the parts you know or worked on.",
    selectionMode: "multiple",
    informationTargets: ["core-workflow"],
    options: [
      { id: "create", label: "Create or edit information" },
      { id: "analyze", label: "Analyze or transform information" },
      { id: "automate", label: "Automate a repeated task" },
      { id: "share", label: "Share results with other people" },
    ],
    customOption: { id: "custom", label: "Something else" },
  },
  "evidence-limitations": {
    id: "evidence-limitations",
    prompt: "What should we be careful not to assume?",
    description: "You can skip this if nothing comes to mind.",
    selectionMode: "multiple",
    informationTargets: ["evidence-limitations"],
    options: [
      { id: "prototype", label: "Some parts are prototypes" },
      { id: "partial", label: "I worked on only part of it" },
      { id: "no-metrics", label: "I don’t have measured results" },
      { id: "private", label: "Some project details are private" },
    ],
    customOption: { id: "custom", label: "Something else" },
  },
  "intended-users": {
    id: "intended-users",
    prompt: "Who is the project mainly for?",
    selectionMode: "multiple",
    informationTargets: ["intended-users"],
    options: [
      { id: "customers", label: "Customers or the public" },
      { id: "internal", label: "People inside an organization" },
      { id: "developers", label: "Developers or technical teams" },
      { id: "myself", label: "Myself or a small group" },
    ],
    customOption: { id: "custom", label: "Something else" },
  },
  "delivery-decisions": {
    id: "delivery-decisions",
    prompt: "Which implementation decisions were part of your work?",
    selectionMode: "multiple",
    informationTargets: ["implementation-decisions"],
    options: [
      { id: "data-model", label: "Data structures or storage" },
      { id: "api-design", label: "Service or API design" },
      { id: "reliability", label: "Reliability or error handling" },
      { id: "accessibility", label: "Accessibility or responsive behavior" },
    ],
    customOption: { id: "custom", label: "Something else" },
  },
  outcomes: {
    id: "outcomes",
    prompt: "What changed because of this work?",
    description:
      "A qualitative result is useful. Only include numbers you can verify.",
    selectionMode: "single",
    informationTargets: ["outcomes", "evidence-limitations"],
    options: [
      { id: "new-workflow", label: "A new workflow became possible" },
      { id: "less-manual", label: "Some work became less manual" },
      { id: "clearer", label: "Information became easier to understand" },
      { id: "not-measured", label: "I don’t have a measured outcome" },
    ],
    customOption: { id: "custom", label: "Something else" },
  },
};

function questionFor(id: string, routeKind: "web" | "data" | "other") {
  const spec = questionSpecs[id];
  if (!spec) throw new Error(`Missing scripted question: ${id}`);
  return {
    ...spec,
    prompt:
      typeof spec.prompt === "function" ? spec.prompt(routeKind) : spec.prompt,
  } satisfies InterviewQuestion;
}

function summarize(
  question: InterviewQuestion,
  answer: InterviewAnswer,
): InterviewAnswerSummary {
  const allOptions = [...question.options, question.customOption];
  return {
    nodeId: question.id,
    prompt: question.prompt,
    optionIds: [...answer.optionIds],
    optionLabels: answer.optionIds.flatMap((id) => {
      const option = allOptions.find((candidate) => candidate.id === id);
      return option ? [option.label] : [];
    }),
    customAnswer: answer.customAnswer?.trim() || null,
    skipped: answer.optionIds.length === 0,
  };
}

export function createScriptedContextInterviewPort(
  options: ScriptedPortOptions = {},
) {
  const routeLength = options.routeLength ?? "adaptive";
  const summaries = new Map<string, InterviewAnswerSummary>();
  const rawAnswers = new Map<string, InterviewAnswer>();
  const delayMs = Math.max(0, Math.min(5_000, options.delayMs ?? 0));
  let failuresRemaining = Math.max(0, options.failCalls ?? 0);
  let shouldDropAnswerResponse = options.dropNextAnswerResponse ?? false;
  let answerSubmissionCount = 0;
  let notes = "";
  let contextRevision = 0;
  let phase: InterviewSnapshot["phase"] = options.initialPhase ?? "active";
  let currentQuestionId: string | null =
    phase === "active" ? "project-purpose" : null;
  let notice: string | null = null;
  let prunedAnswerIds: string[] = [];

  function routeKind(): "web" | "data" | "other" {
    const purpose = rawAnswers.get("project-purpose");
    if (
      purpose?.optionIds.includes("kind-web") ||
      purpose?.optionIds.includes("kind-mobile")
    ) {
      return "web";
    }
    if (purpose?.optionIds.includes("kind-data")) return "data";
    return "other";
  }

  function desiredLength() {
    if (routeLength !== "adaptive") return routeLength;
    const purpose = rawAnswers.get("project-purpose");
    if (!purpose) return 7;
    if (
      purpose.optionIds.includes("kind-tool") ||
      purpose.optionIds.includes("custom")
    ) {
      return 5;
    }
    if (purpose.optionIds.includes("kind-data")) return 10;
    return 7;
  }

  function routeIds() {
    if (options.initialPhase === "empty" && summaries.size === 0) return [];
    const all = [
      "project-purpose",
      "ownership",
      "contribution-style",
      "capabilities",
      "technical-work",
      "domain-detail",
      "evidence-limitations",
      "intended-users",
      "delivery-decisions",
      "outcomes",
    ];
    return all.slice(0, desiredLength());
  }

  function currentQuestion() {
    if (!currentQuestionId) return null;
    return questionFor(currentQuestionId, routeKind());
  }

  function orderedSummaries() {
    const route = routeIds();
    return route.flatMap((id) => {
      const summary = summaries.get(id);
      return summary ? [summary] : [];
    });
  }

  function makeSnapshot(): InterviewSnapshot {
    const route = routeIds();
    const activeQuestion = phase === "active" ? currentQuestion() : null;
    const currentIndex = activeQuestion ? route.indexOf(activeQuestion.id) : -1;
    return {
      catalogVersion,
      phase,
      currentQuestion: activeQuestion,
      currentQuestionNumber: activeQuestion ? currentIndex + 1 : null,
      canGoBack:
        (phase === "active" && currentIndex > 0) ||
        (phase === "review" && orderedSummaries().length > 0),
      provisionalPlannedQuestionCount:
        phase === "active" &&
        (routeLength !== "adaptive" || summaries.has("project-purpose"))
          ? { count: route.length, provisional: true }
          : null,
      answers: orderedSummaries(),
      notes,
      contextRevision,
      applicableQuestionCount:
        phase === "review" ? route.length : phase === "empty" ? 0 : null,
      notice,
      prunedAnswerIds: [...prunedAnswerIds],
    };
  }

  async function beforeResponse() {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (failuresRemaining > 0) {
      failuresRemaining -= 1;
      throw new Error("Scripted temporary port failure");
    }
  }

  const port: ContextInterviewPort = {
    async getSnapshot() {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return makeSnapshot();
    },

    async submitAnswer(answer) {
      await beforeResponse();
      answerSubmissionCount += 1;
      if (
        phase !== "active" ||
        !currentQuestionId ||
        answer.nodeId !== currentQuestionId
      ) {
        throw new Error("Answer does not match the active scripted question");
      }

      const previousRoute = routeIds();
      const previousQuestions = new Map(
        previousRoute.map((id) => [id, questionFor(id, routeKind())]),
      );
      const question = currentQuestion();
      if (!question) throw new Error("No active scripted question");

      const normalized: InterviewAnswer = {
        ...answer,
        optionIds: [...answer.optionIds],
      };
      rawAnswers.set(answer.nodeId, normalized);
      summaries.set(answer.nodeId, summarize(question, normalized));
      contextRevision += 1;

      const nextRoute = routeIds();
      const pruned: string[] = [];
      for (const id of [...summaries.keys()]) {
        const wasOnRoute = previousRoute.includes(id);
        const remainsOnRoute = nextRoute.includes(id);
        const previousQuestion = previousQuestions.get(id);
        const nextQuestion = remainsOnRoute
          ? questionFor(id, routeKind())
          : null;
        const changedMeaning = Boolean(
          previousQuestion &&
          nextQuestion &&
          (previousQuestion.prompt !== nextQuestion.prompt ||
            previousQuestion.informationTargets.join("|") !==
              nextQuestion.informationTargets.join("|")),
        );
        if (
          id !== answer.nodeId &&
          (!wasOnRoute || !remainsOnRoute || changedMeaning)
        ) {
          summaries.delete(id);
          rawAnswers.delete(id);
          pruned.push(id);
        }
      }

      prunedAnswerIds = pruned;
      notice = pruned.length
        ? `Your earlier answer changed, so ${pruned.length} follow-up answer${pruned.length === 1 ? "" : "s"} no longer apply.`
        : null;

      const route = routeIds();
      const currentIndex = route.indexOf(answer.nodeId);
      const nextId = route
        .slice(Math.max(0, currentIndex + 1))
        .find((id) => !summaries.has(id));
      if (nextId) {
        currentQuestionId = nextId;
        phase = "active";
      } else {
        currentQuestionId = null;
        phase = "review";
      }
      if (shouldDropAnswerResponse) {
        shouldDropAnswerResponse = false;
        throw new Error("Scripted response was lost after applying the answer");
      }
      return makeSnapshot();
    },

    async updateNotes(value) {
      await beforeResponse();
      if (value !== notes) {
        notes = value;
        contextRevision += 1;
      }
      notice = null;
      prunedAnswerIds = [];
      return makeSnapshot();
    },

    async goBack() {
      await beforeResponse();
      const route = routeIds();
      if (phase === "review") {
        const lastAnswered = [...route]
          .reverse()
          .find((id) => summaries.has(id));
        currentQuestionId = lastAnswered ?? route[0] ?? null;
        phase = currentQuestionId ? "active" : "empty";
      } else if (phase === "active" && currentQuestionId) {
        const index = route.indexOf(currentQuestionId);
        if (index > 0)
          currentQuestionId = route[index - 1] ?? currentQuestionId;
      }
      notice = null;
      prunedAnswerIds = [];
      return makeSnapshot();
    },

    async editAnswer(nodeId) {
      await beforeResponse();
      if (!summaries.has(nodeId) || !routeIds().includes(nodeId)) {
        throw new Error("That answer is no longer applicable");
      }
      currentQuestionId = nodeId;
      phase = "active";
      notice = null;
      prunedAnswerIds = [];
      return makeSnapshot();
    },

    async beginReview() {
      await beforeResponse();
      currentQuestionId = null;
      phase = "review";
      notice = null;
      prunedAnswerIds = [];
      return makeSnapshot();
    },

    async resume(snapshot) {
      await beforeResponse();
      notes = snapshot.notes;
      summaries.clear();
      rawAnswers.clear();
      const purposeAnswer = snapshot.answers.find(
        (answer) => answer.nodeId === "project-purpose",
      );
      if (purposeAnswer) {
        rawAnswers.set("project-purpose", {
          nodeId: purposeAnswer.nodeId,
          optionIds: purposeAnswer.optionIds,
          ...(purposeAnswer.customAnswer
            ? { customAnswer: purposeAnswer.customAnswer }
            : {}),
          catalogVersion,
        });
      }
      for (const answer of snapshot.answers) {
        if (!routeIds().includes(answer.nodeId)) continue;
        summaries.set(answer.nodeId, answer);
        rawAnswers.set(answer.nodeId, {
          nodeId: answer.nodeId,
          optionIds: answer.optionIds,
          ...(answer.customAnswer ? { customAnswer: answer.customAnswer } : {}),
          catalogVersion,
        });
      }
      contextRevision = Math.max(contextRevision, snapshot.contextRevision);
      if (snapshot.phase === "review") {
        phase = "review";
        currentQuestionId = null;
      } else if (snapshot.phase === "empty") {
        phase = "empty";
        currentQuestionId = null;
      } else {
        phase = "active";
        currentQuestionId =
          snapshot.currentQuestion?.id ??
          routeIds().find((id) => !summaries.has(id)) ??
          null;
      }
      notice = null;
      prunedAnswerIds = [];
      return makeSnapshot();
    },
  };

  if (phase === "active" && routeLength === "adaptive") {
    currentQuestionId = "project-purpose";
  }
  if (phase === "expired") {
    const purpose = questionFor("project-purpose", "other");
    const retained: InterviewAnswer = {
      nodeId: "project-purpose",
      optionIds: ["kind-web"],
      catalogVersion,
    };
    rawAnswers.set("project-purpose", retained);
    summaries.set("project-purpose", summarize(purpose, retained));
    notes = "Keep this note while reconnecting.";
    contextRevision = 2;
    currentQuestionId = "ownership";
  }

  return {
    port,
    providerCallCount: () => 0,
    answerSubmissionCount: () => answerSubmissionCount,
    snapshot: () => makeSnapshot(),
  };
}
