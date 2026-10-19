import { describe, expect, it } from "vitest";
import { parseImaginationDraft } from "../../../src/lib/generation/imagination-draft";
import { studioLibrary } from "../../helpers/studio-fixtures";
const draft = {
  groupId: studioLibrary.jobs[0].id,
  text: "Unfinished achievement.",
  instruction: "Keep the facts.",
  selectedIds: [studioLibrary.jobs[0].points[0].id],
  skillIds: [],
  targetLines: 2,
};
describe("unfinished contextual writing", () => {
  it("restores author text and selected context", () => {
    expect(parseImaginationDraft(JSON.stringify(draft), studioLibrary)).toEqual(
      draft,
    );
  });
  it("rejects damaged, stale, duplicate, unrelated, and excessive context", () => {
    for (const value of [
      "{",
      JSON.stringify({ ...draft, groupId: "missing" }),
      JSON.stringify({
        ...draft,
        selectedIds: [studioLibrary.jobs[1].points[0].id],
      }),
      JSON.stringify({
        ...draft,
        selectedIds: [...draft.selectedIds, ...draft.selectedIds],
      }),
      JSON.stringify({
        ...draft,
        skillIds: studioLibrary.skills.slice(0, 10).map((skill) => skill.id),
      }),
      JSON.stringify({ ...draft, skillIds: ["missing"] }),
    ])
      expect(parseImaginationDraft(value, studioLibrary)).toBeNull();
    expect(parseImaginationDraft(null, studioLibrary)).toBeNull();
  });
});
