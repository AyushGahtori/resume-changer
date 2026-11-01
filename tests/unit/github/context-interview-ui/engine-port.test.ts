import { describe, expect, it } from "vitest";
import { createEngineInterviewPort } from "../../../../src/components/github-import/context-interview/engine-port";
import { isInterviewSnapshot } from "../../../../src/components/github-import/context-interview/contract";
import type { ProjectContext } from "../../../../src/lib/github/context-interview";

describe("production interview adapter", () => {
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
