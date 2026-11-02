import { describe, expect, it } from "vitest";
import {
  countCodePoints,
  isInterviewQuestion,
  isInterviewSnapshot,
  limitCodePoints,
  progressLabel,
} from "../../../../src/components/github-import/context-interview/contract";
import { createScriptedContextInterviewPort } from "../../../../src/components/github-import/context-interview/testing/scripted-port";
import type {
  InterviewAnswer,
  InterviewSnapshot,
} from "../../../../src/components/github-import/context-interview/types";

async function completeRoute(
  port: ReturnType<typeof createScriptedContextInterviewPort>["port"],
  firstOptionId = "kind-tool",
) {
  let snapshot = await port.getSnapshot();
  while (snapshot.phase === "active" && snapshot.currentQuestion) {
    const question = snapshot.currentQuestion;
    const optionIds =
      question.id === "project-purpose"
        ? [firstOptionId]
        : question.selectionMode === "multiple"
          ? [question.options[0]!.id, question.options[1]!.id]
          : [question.options[0]!.id];
    const answer: InterviewAnswer = {
      nodeId: question.id,
      optionIds,
      catalogVersion: snapshot.catalogVersion,
    };
    snapshot = await port.submitAnswer(answer);
  }
  return snapshot;
}

describe("context interview UI contract", () => {
  it("accepts only questions with four normal choices and a final custom choice", async () => {
    const { port } = createScriptedContextInterviewPort();
    const snapshot = await port.getSnapshot();
    const question = snapshot.currentQuestion;
    expect(question).not.toBeNull();
    expect(isInterviewQuestion(question)).toBe(true);
    expect(question?.options).toHaveLength(4);

    expect(
      isInterviewQuestion({
        ...question,
        options: question?.options.slice(0, 3),
      }),
    ).toBe(false);
    expect(
      isInterviewQuestion({
        ...question,
        customOption: question?.options[0],
      }),
    ).toBe(false);
  });

  it("counts and limits Unicode code points without splitting emoji", () => {
    const emojiText = "😀".repeat(501);
    const limited = limitCodePoints(emojiText);
    expect(countCodePoints(limited)).toBe(500);
    expect(limited).toBe("😀".repeat(500));
    expect(limitCodePoints("A😀e\u0301", 3)).toBe("A😀e");
  });

  it("rejects malformed snapshots and empty active routes", async () => {
    const { port } = createScriptedContextInterviewPort();
    const snapshot = await port.getSnapshot();
    expect(isInterviewSnapshot(snapshot)).toBe(true);
    expect(isInterviewSnapshot({ ...snapshot, currentQuestion: null })).toBe(
      false,
    );
    expect(isInterviewSnapshot({ ...snapshot, notes: "😀".repeat(501) })).toBe(
      false,
    );
  });

  it("keeps uncertain progress honest and labels only provisional plans as planned", () => {
    const base = {
      catalogVersion: "fixture-v1",
      phase: "active",
      currentQuestion: null,
      currentQuestionNumber: 3,
      canGoBack: true,
      provisionalPlannedQuestionCount: null,
      answers: [],
      notes: "",
      contextRevision: 0,
      applicableQuestionCount: null,
      notice: null,
    } as unknown as InterviewSnapshot;
    expect(progressLabel(base)).toBe("Question 3 · up to 10");
    expect(
      progressLabel({
        ...base,
        provisionalPlannedQuestionCount: { count: 7, provisional: true },
      }),
    ).toBe("Question 3 · 7 currently planned");
  });

  it.each([5, 7, 10] as const)(
    "completes a deterministic %i-question fixture route",
    async (routeLength) => {
      const { port } = createScriptedContextInterviewPort({ routeLength });
      const snapshot = await completeRoute(port);
      expect(snapshot.phase).toBe("review");
      expect(snapshot.applicableQuestionCount).toBe(routeLength);
      expect(snapshot.answers).toHaveLength(routeLength);
      expect(snapshot.answers[1]?.optionIds).toEqual(["whole-project"]);
      expect(isInterviewSnapshot(snapshot)).toBe(true);
    },
  );

  it("prunes branch-only answers when an earlier answer shortens the route", async () => {
    const { port } = createScriptedContextInterviewPort({
      routeLength: "adaptive",
    });
    const webReview = await completeRoute(port, "kind-web");
    expect(webReview.applicableQuestionCount).toBe(7);

    let snapshot = await port.editAnswer("project-purpose");
    snapshot = await port.submitAnswer({
      nodeId: "project-purpose",
      optionIds: ["kind-tool"],
      catalogVersion: snapshot.catalogVersion,
    });
    expect(snapshot.phase).toBe("review");
    expect(snapshot.applicableQuestionCount).toBe(5);
    expect(snapshot.prunedAnswerIds).toEqual([
      "domain-detail",
      "evidence-limitations",
    ]);
    expect(snapshot.answers.map((answer) => answer.nodeId)).not.toContain(
      "domain-detail",
    );
  });

  it("lengthens the route after a data project answer and resumes without losing earlier answers", async () => {
    const { port } = createScriptedContextInterviewPort({
      routeLength: "adaptive",
    });
    let snapshot = await port.getSnapshot();
    snapshot = await port.submitAnswer({
      nodeId: "project-purpose",
      optionIds: ["kind-tool"],
      catalogVersion: snapshot.catalogVersion,
    });
    const shortReview = await completeRouteFromSnapshot(port, snapshot);
    expect(shortReview.phase).toBe("review");
    snapshot = await port.editAnswer("project-purpose");
    snapshot = await port.submitAnswer({
      nodeId: "project-purpose",
      optionIds: ["kind-data"],
      catalogVersion: snapshot.catalogVersion,
    });
    expect(snapshot.phase).toBe("active");
    expect(snapshot.currentQuestion?.id).toBe("domain-detail");
    expect(snapshot.currentQuestionNumber).toBe(6);
    const resumed = await port.resume(snapshot);
    expect(resumed.currentQuestion?.id).toBe("domain-detail");
    expect(resumed.answers.map((answer) => answer.nodeId)).toContain(
      "ownership",
    );
  });
});

async function completeRouteFromSnapshot(
  port: ReturnType<typeof createScriptedContextInterviewPort>["port"],
  initial: InterviewSnapshot,
) {
  let snapshot = initial;
  while (snapshot.phase === "active" && snapshot.currentQuestion) {
    const question = snapshot.currentQuestion;
    snapshot = await port.submitAnswer({
      nodeId: question.id,
      optionIds:
        question.selectionMode === "multiple"
          ? [question.options[0]!.id, question.options[1]!.id]
          : [question.options[0]!.id],
      catalogVersion: snapshot.catalogVersion,
    });
  }
  return snapshot;
}
