import { describe, expect, it } from "vitest";
import { deleteBeforeCaret } from "../../../src/lib/editing/delete-word";

describe("deleteBeforeCaret", () => {
  it("removes the word before the caret and keeps the earlier space", () => {
    const next = deleteBeforeCaret("Keep this phrase", 16, 16);

    expect(next).toEqual({ value: "Keep this ", caret: 10 });
  });

  it("removes a selected range instead of the word behind it", () => {
    const next = deleteBeforeCaret("Keep this phrase", 5, 9);

    expect(next).toEqual({ value: "Keep  phrase", caret: 5 });
  });
});
