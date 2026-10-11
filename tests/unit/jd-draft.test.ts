import { describe, expect, it } from "vitest";
import {
  clearDraft,
  EMPTY_DRAFT,
  estimateTokenCount,
  JD_DRAFT_STORAGE_KEY,
  MAX_JD_CHARACTERS,
  readDraft,
  validateDraft,
  writeDraft,
} from "../../src/lib/jd-draft";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("JD draft utilities", () => {
  it("estimates tokens from character count", () => {
    expect(estimateTokenCount("")).toBe(0);
    expect(estimateTokenCount("abcd")).toBe(1);
    expect(estimateTokenCount("abcde")).toBe(2);
  });

  it("requires a non-empty description and enforces the character limit", () => {
    expect(validateDraft(EMPTY_DRAFT)).toMatchObject({
      jobDescription: "Enter a job description before saving.",
    });

    expect(
      validateDraft({
        ...EMPTY_DRAFT,
        jobDescription: "x".repeat(MAX_JD_CHARACTERS + 1),
      }),
    ).toHaveProperty("jobDescription");

    expect(
      validateDraft({
        ...EMPTY_DRAFT,
        jobDescription: "x".repeat(MAX_JD_CHARACTERS),
      }),
    ).not.toHaveProperty("jobDescription");
  });

  it("accepts only optional HTTP or HTTPS job links", () => {
    const validDraft = { ...EMPTY_DRAFT, jobDescription: "Backend engineer" };
    expect(validateDraft({ ...validDraft, jobUrl: "" })).not.toHaveProperty(
      "jobUrl",
    );
    expect(
      validateDraft({ ...validDraft, jobUrl: "https://jobs.example/role" }),
    ).not.toHaveProperty("jobUrl");
    expect(
      validateDraft({ ...validDraft, jobUrl: "javascript:alert(1)" }),
    ).toHaveProperty("jobUrl");
  });

  it("writes, restores, and clears a versioned local draft", () => {
    const storage = createStorage();
    const draft = {
      ...EMPTY_DRAFT,
      jobDescription: "Backend engineer",
      company: "Example Inc.",
      roleTitle: "Backend Engineer",
    };

    expect(writeDraft(storage, draft)).toBe(true);
    expect(storage.getItem(JD_DRAFT_STORAGE_KEY)).toContain(
      '"schemaVersion":1',
    );
    expect(readDraft(storage)).toEqual({ draft, state: "restored" });
    expect(clearDraft(storage)).toBe(true);
    expect(readDraft(storage)).toEqual({ draft: EMPTY_DRAFT, state: "empty" });
  });

  it("handles corrupted storage without returning its contents", () => {
    const storage = createStorage();
    storage.setItem(JD_DRAFT_STORAGE_KEY, "private text {broken");

    expect(readDraft(storage)).toEqual({
      draft: EMPTY_DRAFT,
      state: "invalid",
    });
  });

  it("reports unavailable storage instead of throwing", () => {
    const storage = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      },
    };

    expect(readDraft(storage)).toEqual({
      draft: EMPTY_DRAFT,
      state: "unavailable",
    });
    expect(writeDraft(storage, EMPTY_DRAFT)).toBe(false);
    expect(clearDraft(storage)).toBe(false);
  });
});
