import scenariosJson from "../../../fixtures/github/context-interview/transcripts.v1.json";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUESTION_CATALOG,
  DEFAULT_QUESTION_COUNT,
} from "@/lib/github/context-interview/catalog";
import {
  InterviewStateError,
  applyAnswer,
  createInterviewState,
  getInterviewCompletion,
  goBack,
  isInterviewComplete,
  migrateAnswers,
  nextQuestion,
  pruneInvalidAnswers,
  reviewContext,
  serializeProjectContext,
  setExtraNotes,
  setRepositorySuggestionDisposition,
  validateQuestionCatalog,
} from "@/lib/github/context-interview/engine";
import {
  MAX_CUSTOM_ANSWER_CODE_POINTS,
  PROJECT_CONTEXT_VERSION,
  type InterviewAnswer,
  type InterviewState,
  type QuestionCatalog,
} from "@/lib/github/context-interview/types";

type TranscriptStep = {
  nodeId: string;
  optionIds: string[];
  customAnswer?: string;
  skipped?: boolean;
};

type TranscriptScenario = {
  id: string;
  answers: TranscriptStep[];
  notes?: string;
};

const scenarios = scenariosJson as {
  catalogVersion: string;
  scenarios: TranscriptScenario[];
};

function scenario(id: string): TranscriptScenario {
  const result = scenarios.scenarios.find((entry) => entry.id === id);
  if (!result) throw new Error("Missing transcript fixture: " + id);
  return result;
}

function play(
  transcript: TranscriptScenario,
  catalog: QuestionCatalog = DEFAULT_QUESTION_CATALOG,
): InterviewState {
  let state = createInterviewState();
  for (const step of transcript.answers) {
    const next = nextQuestion(catalog, state);
    expect(
      next.status,
      "The fixture must not exceed the completion boundary.",
    ).toBe("question");
    if (next.status !== "question") {
      throw new Error("Transcript ended before " + step.nodeId);
    }
    expect(next.question.id).toBe(step.nodeId);
    state = applyAnswer(catalog, next.state, {
      ...step,
      catalogVersion: scenarios.catalogVersion,
    });
  }
  return transcript.notes ? setExtraNotes(state, transcript.notes) : state;
}

function answerCurrent(
  state: InterviewState,
  optionIds: string[],
  customAnswer?: string,
  skipped = false,
): InterviewState {
  const currentNodeId = state.currentNodeId;
  if (!currentNodeId) throw new Error("There is no current question.");
  return applyAnswer(DEFAULT_QUESTION_CATALOG, state, {
    nodeId: currentNodeId,
    optionIds,
    ...(customAnswer === undefined ? {} : { customAnswer }),
    skipped,
    catalogVersion: PROJECT_CONTEXT_VERSION,
  });
}

function createHint(
  disposition: "suggested" | "accepted" | "dismissed" = "suggested",
) {
  return {
    id: "hint.api-capability",
    target: "capability" as const,
    value: "A read-only reporting API",
    label: "Possible reporting API",
    disposition,
    provenance: "repository-inferred" as const,
    source: {
      repositoryId: "repo-123",
      commitSha: "a".repeat(40),
      path: "src/api/report.ts",
    },
  };
}

describe("adaptive context interview", () => {
  it("ships a reachable, acyclic 60-question catalog with bounded answer controls", () => {
    expect(DEFAULT_QUESTION_COUNT).toBe(60);
    expect(DEFAULT_QUESTION_CATALOG.nodes).toHaveLength(60);
    expect(validateQuestionCatalog(DEFAULT_QUESTION_CATALOG)).toMatchObject({
      success: true,
      issues: [],
    });

    for (const node of DEFAULT_QUESTION_CATALOG.nodes) {
      expect(node.options).toHaveLength(5);
      expect(
        node.options.slice(0, 4).every((option) => option.kind === "choice"),
      ).toBe(true);
      expect(node.options[4]).toMatchObject({ id: "custom", kind: "custom" });
      expect(node.reason.trim().length).toBeGreaterThan(0);
      expect(node.informationTargets.length).toBeGreaterThan(0);
    }
    expect(DEFAULT_QUESTION_CATALOG.maxQuestions).toBe(10);
  });

  it("keeps whole-project ownership, project purpose, and solo work as separate facts", () => {
    const state = play(scenario("solo-whole-project"));
    const context = reviewContext(DEFAULT_QUESTION_CATALOG, state);
    expect(context.primaryKind?.value).toBe("product");
    expect(context.projectPurpose?.value).toBe(
      "A product or application for people to use",
    );
    expect(context.projectPurpose?.provenance).toBe("user-reported");
    expect(context.ownership?.value).toBe("whole-project");
    expect(context.ownership?.provenance).toBe("user-reported");
    expect(context.collaboration?.value).toBe("solo");
    expect(state.presentedNodeIds).toHaveLength(10);
    expect(nextQuestion(DEFAULT_QUESTION_CATALOG, state).status).toBe(
      "complete",
    );
  });

  it("asks for personal scope on team work without requiring an essay", () => {
    const state = play(scenario("team-dashboard-contribution"));
    const context = reviewContext(DEFAULT_QUESTION_CATALOG, state);
    expect(state.presentedNodeIds).toContain("project.contribution-scope");
    expect(context.ownership?.value).toBe("shared");
    expect(context.collaboration?.value).toBe("team");
    expect(context.notes?.value).toBe(
      "I implemented the analytics dashboard layout and filter controls with a product teammate.",
    );
    expect(state.presentedNodeIds).toHaveLength(10);
  });

  it("follows an ML/data route without adding an unrelated dashboard question", () => {
    const state = play(scenario("machine-learning-without-dashboard"));
    const context = reviewContext(DEFAULT_QUESTION_CATALOG, state);
    expect(context.secondaryTags.map((fact) => fact.value)).toContain(
      "machine-learning",
    );
    const presentedPrompts = state.presentedNodeIds
      .map(
        (nodeId) =>
          DEFAULT_QUESTION_CATALOG.nodes.find((node) => node.id === nodeId)
            ?.prompt,
      )
      .join(" ")
      .toLowerCase();
    expect(presentedPrompts).not.toContain("dashboard");
    expect(state.presentedNodeIds).toContain("branch.ai-ml-data.1");
  });

  it("allows web and AI areas together and ranks both relevant branches deterministically", () => {
    const first = play(scenario("overlapping-ai-and-web"));
    const second = play(scenario("overlapping-ai-and-web"));
    expect(first.presentedNodeIds).toEqual(second.presentedNodeIds);
    expect(first.presentedNodeIds).toContain("branch.web-mobile.1");
    expect(first.presentedNodeIds).toContain("branch.ai-ml-data.1");
    expect(
      reviewContext(DEFAULT_QUESTION_CATALOG, first).secondaryTags,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "web" }),
        expect.objectContaining({ value: "ai" }),
      ]),
    );
  });

  it("preserves custom project descriptions and treats the text as inert data", () => {
    const state = play(scenario("custom-unknown-project"));
    const context = reviewContext(DEFAULT_QUESTION_CATALOG, state);
    expect(context.projectPurpose?.value).toBe(
      "A neighborhood archive for oral histories",
    );
    expect(context.primaryKind).toBeNull();
    expect(context.secondaryTags.map((fact) => fact.value)).toContain(
      "research",
    );

    const literal = "(() => { globalThis.__catalogInjected = true; })()";
    let customState = createInterviewState();
    let current = nextQuestion(DEFAULT_QUESTION_CATALOG, customState);
    if (current.status !== "question")
      throw new Error("Expected a root question.");
    customState = applyAnswer(DEFAULT_QUESTION_CATALOG, current.state, {
      nodeId: current.question.id,
      optionIds: ["custom"],
      customAnswer: literal,
      catalogVersion: PROJECT_CONTEXT_VERSION,
    });
    const customContext = reviewContext(DEFAULT_QUESTION_CATALOG, customState);
    expect(customContext.projectPurpose?.value).toBe(literal);
    expect(
      (globalThis as { __catalogInjected?: boolean }).__catalogInjected,
    ).toBe(undefined);
  });

  it("counts Unicode code points and enforces the custom text and notes limits", () => {
    const maximum = "🙂".repeat(MAX_CUSTOM_ANSWER_CODE_POINTS);
    let state = createInterviewState();
    let next = nextQuestion(DEFAULT_QUESTION_CATALOG, state);
    if (next.status !== "question")
      throw new Error("Expected a root question.");
    state = applyAnswer(DEFAULT_QUESTION_CATALOG, next.state, {
      nodeId: "project.purpose",
      optionIds: ["custom"],
      customAnswer: maximum,
      catalogVersion: PROJECT_CONTEXT_VERSION,
    });
    expect(
      reviewContext(DEFAULT_QUESTION_CATALOG, state).projectPurpose?.value,
    ).toBe(maximum);

    next = nextQuestion(DEFAULT_QUESTION_CATALOG, state);
    if (next.status !== "question")
      throw new Error("Expected the area question.");
    expect(() =>
      applyAnswer(DEFAULT_QUESTION_CATALOG, next.state, {
        nodeId: "project.areas",
        optionIds: ["custom"],
        customAnswer: maximum + "🙂",
        catalogVersion: PROJECT_CONTEXT_VERSION,
      }),
    ).toThrow(InterviewStateError);
    expect(() =>
      setExtraNotes(createInterviewState(), "🙂".repeat(501)),
    ).toThrow();
  });

  it("allows skips and finishes without inventing facts or padding the route", () => {
    let state = createInterviewState();
    while (true) {
      const result = nextQuestion(DEFAULT_QUESTION_CATALOG, state);
      if (result.status === "complete") break;
      state = answerCurrent(result.state, [], undefined, true);
    }
    const completion = getInterviewCompletion(DEFAULT_QUESTION_CATALOG, state);
    const context = reviewContext(DEFAULT_QUESTION_CATALOG, state);
    expect(isInterviewComplete(DEFAULT_QUESTION_CATALOG, state)).toBe(true);
    expect(state.presentedNodeIds.length).toBeGreaterThanOrEqual(5);
    expect(state.presentedNodeIds.length).toBeLessThanOrEqual(10);
    expect(completion?.skippedQuestionCount).toBe(state.answers.length);
    expect(context.primaryKind).toBeNull();
    expect(context.ownership).toBeNull();
    expect(context.confirmedCapabilities).toHaveLength(0);
    expect(completion?.reason).toBe("no-relevant-questions");
  });

  it("prunes ownership-specific answers while retaining still-valid downstream facts", () => {
    const scoped = play(scenario("team-dashboard-contribution"));
    let state = scoped;
    while (state.currentNodeId !== "project.ownership") {
      state = goBack(DEFAULT_QUESTION_CATALOG, state);
      if (state.currentNodeId === null)
        throw new Error("Could not return to ownership.");
    }
    state = applyAnswer(DEFAULT_QUESTION_CATALOG, state, {
      nodeId: "project.ownership",
      optionIds: ["whole-project"],
      catalogVersion: PROJECT_CONTEXT_VERSION,
    });
    expect(state.answers.map((answer) => answer.nodeId)).not.toContain(
      "project.contribution-scope",
    );

    const staleState = {
      ...scoped,
      answers: scoped.answers.map((answer) =>
        answer.nodeId === "project.ownership"
          ? { ...answer, optionIds: ["whole-project"] }
          : answer,
      ),
    };
    const pruned = pruneInvalidAnswers(DEFAULT_QUESTION_CATALOG, staleState);
    expect(pruned.removedNodeIds).toContain("project.contribution-scope");
    expect(pruned.state.answers.map((answer) => answer.nodeId)).toContain(
      "project.intended-users",
    );
    expect(pruned.state.answers.map((answer) => answer.nodeId)).toContain(
      "branch.web-mobile.1",
    );
    expect(
      reviewContext(DEFAULT_QUESTION_CATALOG, pruned.state).ownership?.value,
    ).toBe("whole-project");
  });

  it("keeps repository hints as suggestions until the user accepts them", () => {
    const initial = createInterviewState({
      repositorySuggestions: [createHint()],
    });
    const suggestedContext = reviewContext(DEFAULT_QUESTION_CATALOG, initial);
    expect(suggestedContext.confirmedCapabilities).toHaveLength(0);
    expect(suggestedContext.repositorySuggestions[0]).toMatchObject({
      disposition: "suggested",
      provenance: "repository-inferred",
    });

    const accepted = setRepositorySuggestionDisposition(
      DEFAULT_QUESTION_CATALOG,
      initial,
      "hint.api-capability",
      "accepted",
    );
    const acceptedContext = reviewContext(DEFAULT_QUESTION_CATALOG, accepted);
    expect(acceptedContext.confirmedCapabilities).toContainEqual(
      expect.objectContaining({
        value: "A read-only reporting API",
        provenance: "user-confirmed",
        repositoryHintId: "hint.api-capability",
      }),
    );
  });

  it("requires an accepted repository hint before following a hint-gated edge", () => {
    const root = {
      id: "root",
      prompt: "What is the project for?",
      reason: "A synthetic root.",
      informationTargets: ["project-purpose"],
      selectionMode: "single",
      options: [
        { id: "a", label: "Option A", kind: "choice", facts: [] },
        { id: "b", label: "Option B", kind: "choice", facts: [] },
        { id: "c", label: "Option C", kind: "choice", facts: [] },
        { id: "d", label: "Option D", kind: "choice", facts: [] },
        { id: "custom", label: "Custom answer", kind: "custom", facts: [] },
      ],
      customTarget: "projectPurpose",
      phase: "setup",
      priority: 10,
      terminal: false,
      edges: [
        {
          to: "follow-up-a",
          when: [
            {
              op: "hint-status",
              hintId: "hint.api-capability",
              status: "accepted",
            },
          ],
        },
      ],
    };
    const terminal = (id: string) => ({
      id,
      prompt: "What else matters?",
      reason: "A synthetic wrap-up question.",
      informationTargets: ["contribution-details"],
      selectionMode: "single",
      options: [
        { id: "a", label: "Option A", kind: "choice", facts: [] },
        { id: "b", label: "Option B", kind: "choice", facts: [] },
        { id: "c", label: "Option C", kind: "choice", facts: [] },
        { id: "d", label: "Option D", kind: "choice", facts: [] },
        { id: "custom", label: "Custom answer", kind: "custom", facts: [] },
      ],
      customTarget: "contributionDetails",
      phase: "wrap-up",
      priority: 10,
      terminal: true,
      edges: [],
    });
    const catalog = {
      version: PROJECT_CONTEXT_VERSION,
      rootId: "root",
      maxQuestions: 5,
      maxBranchQuestions: 0,
      wrapUpNodeIds: ["follow-up-a", "follow-up-b"],
      nodes: [
        root,
        {
          ...terminal("follow-up-a"),
          terminal: false,
          edges: [{ to: "follow-up-b", when: [] }],
        },
        terminal("follow-up-b"),
      ],
    } as unknown as QuestionCatalog;
    expect(validateQuestionCatalog(catalog).success).toBe(true);

    const initial = createInterviewState({
      repositorySuggestions: [createHint()],
    });
    const question = nextQuestion(catalog, initial);
    if (question.status !== "question")
      throw new Error("Expected a root question.");
    const answered = applyAnswer(catalog, question.state, {
      nodeId: "root",
      optionIds: ["a"],
      catalogVersion: PROJECT_CONTEXT_VERSION,
    });
    expect(nextQuestion(catalog, answered).status).toBe("complete");
    const accepted = setRepositorySuggestionDisposition(
      catalog,
      answered,
      "hint.api-capability",
      "accepted",
    );
    expect(nextQuestion(catalog, accepted)).toMatchObject({
      status: "question",
      question: { id: "follow-up-a" },
    });
  });

  it("validates answer shape, selection mode, unknown options, and versioned migrations", () => {
    let state = createInterviewState();
    const root = nextQuestion(DEFAULT_QUESTION_CATALOG, state);
    if (root.status !== "question")
      throw new Error("Expected a root question.");
    expect(() =>
      applyAnswer(DEFAULT_QUESTION_CATALOG, root.state, {
        nodeId: "project.purpose",
        optionIds: ["product", "developer-tool"],
        catalogVersion: PROJECT_CONTEXT_VERSION,
      }),
    ).toThrow("one selected option");
    expect(() =>
      applyAnswer(DEFAULT_QUESTION_CATALOG, root.state, {
        nodeId: "project.purpose",
        optionIds: ["unknown"],
        catalogVersion: PROJECT_CONTEXT_VERSION,
      }),
    ).toThrow("unknown option ID");
    expect(() =>
      applyAnswer(DEFAULT_QUESTION_CATALOG, root.state, {
        nodeId: "project.purpose",
        optionIds: ["custom"],
        customAnswer: "x".repeat(501),
        catalogVersion: PROJECT_CONTEXT_VERSION,
      }),
    ).toThrow();

    const oldAnswer: InterviewAnswer = {
      nodeId: "old-purpose",
      optionIds: ["old-product"],
      skipped: false,
      catalogVersion: "project-context-v0",
    };
    expect(migrateAnswers(DEFAULT_QUESTION_CATALOG, [oldAnswer])).toMatchObject(
      { success: false, error: "unsupported-catalog-version" },
    );
    const migrated = migrateAnswers(DEFAULT_QUESTION_CATALOG, [oldAnswer], {
      fromVersion: "project-context-v0",
      toVersion: PROJECT_CONTEXT_VERSION,
      nodeMappings: [{ from: "old-purpose", to: "project.purpose" }],
      optionMappings: [
        {
          fromNodeId: "old-purpose",
          fromOptionId: "old-product",
          toNodeId: "project.purpose",
          toOptionId: "product",
        },
      ],
    });
    expect(migrated).toMatchObject({
      success: true,
      answers: [
        {
          nodeId: "project.purpose",
          optionIds: ["product"],
          catalogVersion: PROJECT_CONTEXT_VERSION,
        },
      ],
    });
    expect(
      migrateAnswers(DEFAULT_QUESTION_CATALOG, [
        { ...oldAnswer, catalogVersion: "project-context-v0" },
        { ...oldAnswer, nodeId: "another-old-node" },
      ]),
    ).toMatchObject({ success: false, error: "unsupported-catalog-version" });
  });

  it("rejects duplicate IDs, unknown references, cycles, unreachable nodes, and contradictory rules", () => {
    const duplicate = structuredClone(DEFAULT_QUESTION_CATALOG);
    duplicate.nodes.push(duplicate.nodes[0]);
    expect(validateQuestionCatalog(duplicate)).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "duplicate-node" }),
      ]),
    });

    const unknownReference = structuredClone(DEFAULT_QUESTION_CATALOG);
    unknownReference.nodes[0].edges[0].to = "missing-question";
    expect(validateQuestionCatalog(unknownReference)).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "unknown-edge-target" }),
      ]),
    });

    const cycle = structuredClone(DEFAULT_QUESTION_CATALOG);
    const terminalNode = cycle.nodes.find(
      (node) => node.id === "project.future-work",
    );
    if (!terminalNode) throw new Error("Missing terminal fixture.");
    terminalNode.terminal = false;
    terminalNode.edges = [{ to: cycle.rootId, when: [] }];
    expect(validateQuestionCatalog(cycle)).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "cycle" }),
      ]),
    });

    const unreachable = structuredClone(DEFAULT_QUESTION_CATALOG);
    const users = unreachable.nodes.find(
      (node) => node.id === "project.intended-users",
    );
    if (!users) throw new Error("Missing users fixture.");
    users.edges = users.edges.filter(
      (candidate) => candidate.to !== "branch.web-mobile.1",
    );
    expect(validateQuestionCatalog(unreachable)).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "unreachable-question" }),
      ]),
    });

    const conflict = structuredClone(DEFAULT_QUESTION_CATALOG);
    const collaboration = conflict.nodes.find(
      (node) => node.id === "project.collaboration",
    );
    if (!collaboration) throw new Error("Missing collaboration fixture.");
    collaboration.edges[0].when = [
      {
        op: "selected-any",
        nodeId: "project.ownership",
        optionIds: ["selected-areas"],
      },
      {
        op: "selected-any",
        nodeId: "project.ownership",
        optionIds: ["whole-project"],
      },
    ];
    expect(validateQuestionCatalog(conflict)).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "conflicting-conditions" }),
      ]),
    });

    const executableRule = structuredClone(
      DEFAULT_QUESTION_CATALOG,
    ) as unknown as {
      nodes: Array<{ edges: Array<Record<string, unknown>> }>;
    };
    executableRule.nodes[0].edges[0].when = [
      "(() => globalThis.process.exit())()",
    ];
    expect(validateQuestionCatalog(executableRule).success).toBe(false);
  });

  it("serializes the same reviewed context to the same consent input", () => {
    const context = reviewContext(
      DEFAULT_QUESTION_CATALOG,
      play(scenario("solo-whole-project")),
    );
    expect(serializeProjectContext(context)).toBe(
      serializeProjectContext(structuredClone(context)),
    );
    expect(JSON.parse(serializeProjectContext(context))).toEqual(context);
  });
});
