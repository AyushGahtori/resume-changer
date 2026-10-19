import { describe, expect, it } from "vitest";
import {
  documentFromGeneration,
  draftChangeCount,
  mergeDraftBullets,
  StudioDocumentSchema,
  validateMerge,
} from "../../../src/lib/generation/studio-document";
import { studioHistoryReducer } from "../../../src/lib/generation/studio-history";
import {
  studioDocument,
  studioGeneration,
  studioLibrary,
} from "../../helpers/studio-fixtures";

describe("normalized resume drafts", () => {
  it("hydrates Auto Tailor results with the skills actually rendered", () => {
    const generation = {
      ...studioGeneration,
      metadata: {
        ...studioGeneration.metadata,
        tailoringMode: "auto" as const,
        selectedSkillIds: [
          ...studioGeneration.metadata.renderedSkillIds,
          "not-rendered",
        ],
      },
    };
    const draft = documentFromGeneration(generation, studioLibrary);
    expect(draft.bullets).toHaveLength(
      generation.metadata.generatedBullets.length,
    );
    expect(draft.bullets[0].groupId).toBe(studioLibrary.jobs[0].id);
    expect(draft.skillIds).toEqual(generation.metadata.renderedSkillIds);
    expect(draft.skillIds).not.toContain("not-rendered");
  });
  it("counts a skills-only ordering change as a pending edit", () => {
    expect(
      draftChangeCount(studioDocument, {
        ...studioDocument,
        skillIds: [...studioDocument.skillIds].reverse(),
      }),
    ).toBe(1);
  });
  it("recovers selected source bullets from older incomplete generation metadata", () => {
    const generation = {
      ...studioGeneration,
      metadata: { ...studioGeneration.metadata, generatedBullets: [] },
    };
    const draft = documentFromGeneration(generation, studioLibrary);
    expect(draft.bullets.map((bullet) => bullet.id)).toEqual(
      generation.metadata.selectedAchievementIds,
    );
    expect(draft.bullets[0].text).toBe(
      generation.metadata.sourceProvenance[0].renderedText,
    );
  });
  it("recognizes persisted drafts, skill-only edits, and removals", () => {
    const draft = { ...studioDocument, skillIds: [] };
    expect(
      documentFromGeneration(
        {
          ...studioGeneration,
          metadata: { ...studioGeneration.metadata, studioDocument: draft },
        },
        studioLibrary,
      ),
    ).toEqual(draft);
    expect(draftChangeCount(studioDocument, draft)).toBe(
      studioDocument.skillIds.length,
    );
    expect(
      draftChangeCount(studioDocument, { ...studioDocument, bullets: [] }),
    ).toBe(studioDocument.bullets.length);
    expect(
      StudioDocumentSchema.safeParse({ ...draft, skillIds: ["same", "same"] })
        .success,
    ).toBe(false);
  });
  it("merges compatible sources reversibly and rejects false attribution", () => {
    const ids = studioDocument.bullets.map((bullet) => bullet.id);
    expect(validateMerge(studioDocument, ids)).toBeNull();
    const merged = mergeDraftBullets(
      studioDocument,
      ids,
      "Reviewed synthesis.",
      "studio-merged",
    );
    expect(merged.bullets).toHaveLength(1);
    expect(merged.bullets[0].sourceAchievementIds).toEqual(ids);
    expect(studioDocument.bullets).toHaveLength(2);
    const differentCompany = {
      ...studioDocument,
      bullets: studioDocument.bullets.map((bullet, index) =>
        index ? { ...bullet, groupId: "other-company" } : bullet,
      ),
    };
    expect(validateMerge(differentCompany, ids)).toContain("same company");
    expect(validateMerge(studioDocument, [ids[0], ids[0]])).toContain(
      "distinct",
    );
    const tooManySources = {
      ...studioDocument,
      bullets: studioDocument.bullets.map((bullet) => ({
        ...bullet,
        sourceAchievementIds: ["source-a", "source-b", "source-c", "source-d"],
      })),
    };
    expect(validateMerge(tooManySources, ids)).toContain("three original");
  });
});
describe("draft history", () => {
  it("undoes and redoes provenance and clears redo after a new edit", () => {
    const initial = { past: [], present: studioDocument, future: [] };
    const merged = mergeDraftBullets(
      studioDocument,
      studioDocument.bullets.map((bullet) => bullet.id),
      "Merged achievement.",
      "studio-merged",
    );
    const changed = studioHistoryReducer(initial, {
      type: "change",
      document: merged,
      label: "Merge",
      at: "2026-10-18T12:00:00Z",
    });
    const undone = studioHistoryReducer(changed, { type: "undo" });
    expect(changed.past[0].id).toMatch(/^revision-/);
    expect(undone.future[0].id).toBe(changed.past[0].id);
    expect(studioHistoryReducer(undone, { type: "redo" }).past[0].id).toBe(
      changed.past[0].id,
    );
    expect(undone.present).toEqual(studioDocument);
    expect(studioHistoryReducer(undone, { type: "redo" }).present).toEqual(
      merged,
    );
    const branch = studioHistoryReducer(undone, {
      type: "change",
      document: { ...studioDocument, skillIds: [] },
      label: "Remove skills",
    });
    expect(branch.future).toEqual([]);
    expect(studioHistoryReducer(branch, { type: "undo" }).present).toEqual(
      studioDocument,
    );
  });
  it("ignores no-op edits and bounds persisted revisions", () => {
    let history = {
      past: [],
      present: studioDocument,
      future: [],
    } as ReturnType<typeof studioHistoryReducer>;
    expect(
      studioHistoryReducer(history, {
        type: "change",
        document: studioDocument,
        label: "No change",
      }),
    ).toBe(history);
    for (let index = 0; index < 50; index++)
      history = studioHistoryReducer(history, {
        type: "change",
        document: { ...studioDocument, summary: String(index) },
        label: "Summary",
      });
    expect(history.past).toHaveLength(40);
  });
});
