import { describe, expect, it } from "vitest";
import { createEngineInterviewPort } from "../../../../src/components/github-import/context-interview/engine-port";
import { isInterviewSnapshot } from "../../../../src/components/github-import/context-interview/contract";
import type { ProjectContext } from "../../../../src/lib/github/context-interview";

describe("production interview adapter", () => {
  it.each([1, 3, 6, 9])(
    "goes back from an unanswered question after %s answers without poisoning later actions",
    async (count) => {
      const port = createEngineInterviewPort(() => undefined);
      let snapshot = await port.getSnapshot();
      const answered: string[] = [];
      for (let index = 0; index < count; index++) {
        const question = snapshot.currentQuestion!;
        answered.push(question.id);
        snapshot = await port.submitAnswer({
          nodeId: question.id,
          optionIds: [question.options[0].id],
          catalogVersion: snapshot.catalogVersion,
        });
      }
      const unansweredId = snapshot.currentQuestion!.id;
      snapshot = await port.goBack();
      expect(snapshot.currentQuestion?.id).toBe(answered.at(-1));
      expect(isInterviewSnapshot(snapshot)).toBe(true);
      expect((await port.getSnapshot()).currentQuestion?.id).toBe(
        answered.at(-1),
      );
      snapshot = await port.updateNotes("Keep these notes through Back");
      const question = snapshot.currentQuestion!;
      snapshot = await port.submitAnswer({
        nodeId: question.id,
        optionIds: [],
        catalogVersion: snapshot.catalogVersion,
      });
      expect(isInterviewSnapshot(snapshot)).toBe(true);
      expect(snapshot.notes).toBe("Keep these notes through Back");
      expect(snapshot.currentQuestion?.id).toBe(unansweredId);
      const restored = await port.resume(snapshot);
      expect(restored.currentQuestion?.id).toBe(unansweredId);
    },
  );

  it("disables Back at the first question even when later answers remain in history", async () => {
    const port = createEngineInterviewPort(() => undefined);
    let snapshot = await port.getSnapshot();
    for (let index = 0; index < 3; index++) {
      const question = snapshot.currentQuestion!;
      snapshot = await port.submitAnswer({
        nodeId: question.id,
        optionIds: [question.options[0].id],
        catalogVersion: snapshot.catalogVersion,
      });
    }
    for (let index = 0; index < 3; index++) snapshot = await port.goBack();
    expect(snapshot.currentQuestion?.id).toBe("project.purpose");
    expect(snapshot.canGoBack).toBe(false);
  });

  it("completes the real catalog, preserves purpose detail and whole-project ownership, and restores in-tab context", async () => {
    let context: ProjectContext | undefined;
    let complete = false;
    const port = createEngineInterviewPort((next, done) => {
      context = next;
      complete = done;
    });
    let snapshot = await port.getSnapshot();
    const seen = new Set<string>();
    while (snapshot.currentQuestion) {
      expect(isInterviewSnapshot(snapshot)).toBe(true);
      const question = snapshot.currentQuestion;
      expect(seen.has(question.id)).toBe(false);
      seen.add(question.id);
      snapshot = await port.submitAnswer({
        nodeId: question.id,
        optionIds: [
          question.id === "project.ownership"
            ? "whole-project"
            : question.options[0].id,
        ],
        ...(question.id === "project.purpose"
          ? { customAnswer: "Build tailored resumes using evidence" }
          : {}),
        catalogVersion: snapshot.catalogVersion,
      });
      expect(seen.size).toBeLessThanOrEqual(10);
    }
    expect(complete).toBe(true);
    expect(seen.size).toBeGreaterThanOrEqual(5);
    expect(context?.ownership?.value).toBe("whole-project");
    expect(context?.answers[0].customAnswer).toContain("tailored resumes");
    const restored = createEngineInterviewPort(() => undefined, context);
    expect((await restored.getSnapshot()).phase).toBe("review");
    await port.updateNotes("I designed and implemented the system.");
    expect(context?.notes?.value).toContain("implemented");
    const edited = await port.editAnswer("project.purpose");
    expect(edited.currentQuestion?.id).toBe("project.purpose");
  });
});
