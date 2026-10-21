import { describe, expect, it } from "vitest";
import {
  decidePasteFromUrlSubmit,
  initialPasteFromUrlState,
  pasteFromUrlReducer,
  type PasteFromUrlState,
} from "../../src/lib/paste-from-url-state";

function reduce(
  state: PasteFromUrlState,
  actions: Parameters<typeof pasteFromUrlReducer>[1][],
): PasteFromUrlState {
  return actions.reduce(pasteFromUrlReducer, state);
}

describe("initialPasteFromUrlState", () => {
  it("starts idle with no error", () => {
    expect(initialPasteFromUrlState()).toEqual({
      status: "idle",
      url: "",
      error: "",
    });
  });

  it("pre-fills the URL the user already entered", () => {
    expect(initialPasteFromUrlState("https://example.com/job").url).toBe(
      "https://example.com/job",
    );
  });
});

describe("decidePasteFromUrlSubmit", () => {
  it("requests a valid http url", () => {
    expect(decidePasteFromUrlSubmit("https://example.com/jobs/1")).toEqual({
      kind: "request",
      url: "https://example.com/jobs/1",
    });
  });

  it("requests a valid http url over plain http", () => {
    expect(decidePasteFromUrlSubmit("http://example.com/job").kind).toBe(
      "request",
    );
  });

  it("trims surrounding whitespace before requesting", () => {
    expect(decidePasteFromUrlSubmit("  https://example.com/job  ")).toEqual({
      kind: "request",
      url: "https://example.com/job",
    });
  });

  it("rejects an empty url without requesting", () => {
    const decision = decidePasteFromUrlSubmit("   ");
    expect(decision.kind).toBe("invalid");
    expect(decision.kind === "invalid" && decision.error).toBe(
      "Enter the link to the job description.",
    );
  });

  it("rejects a non-url without requesting", () => {
    const decision = decidePasteFromUrlSubmit("not a url");
    expect(decision.kind).toBe("invalid");
    expect(decision.kind === "invalid" && decision.error).toBe(
      "Enter a valid job link.",
    );
  });

  it("rejects a non-http scheme without requesting", () => {
    const decision = decidePasteFromUrlSubmit("javascript:alert(1)");
    expect(decision.kind).toBe("invalid");
    expect(decision.kind === "invalid" && decision.error).toBe(
      "Enter an HTTP or HTTPS link.",
    );
  });
});

describe("pasteFromUrlReducer", () => {
  it("clears a previous error when the url changes", () => {
    const state = reduce(initialPasteFromUrlState(), [
      { type: "submit-failed", error: "Enter a valid job link." },
      { type: "url-change", url: "https://example.com/job" },
    ]);

    expect(state.error).toBe("");
    expect(state.url).toBe("https://example.com/job");
  });

  it("clears a previous error when the panel is reopened", () => {
    const state = reduce(initialPasteFromUrlState(), [
      { type: "submit-failed", error: "Enter a valid job link." },
      { type: "open" },
    ]);

    expect(state.error).toBe("");
  });

  it("moves to loading and clears the error on submit", () => {
    const state = reduce(initialPasteFromUrlState(), [
      { type: "submit-failed", error: "Enter a valid job link." },
      { type: "submit" },
    ]);

    expect(state.status).toBe("loading");
    expect(state.error).toBe("");
  });

  it("keeps the typed url while loading", () => {
    const state = reduce(initialPasteFromUrlState(), [
      { type: "url-change", url: "https://example.com/job" },
      { type: "submit" },
    ]);

    expect(state.url).toBe("https://example.com/job");
  });

  it("records a failure message", () => {
    const state = reduce(initialPasteFromUrlState(), [
      { type: "submit" },
      {
        type: "submit-failed",
        error: "Could not reach the extraction service.",
      },
    ]);

    expect(state.status).toBe("error");
    expect(state.error).toBe("Could not reach the extraction service.");
  });

  it("reports success and clears the error", () => {
    const state = reduce(initialPasteFromUrlState(), [
      { type: "submit" },
      { type: "submit-succeeded" },
    ]);

    expect(state.status).toBe("success");
    expect(state.error).toBe("");
  });

  it("resets to idle on cancel", () => {
    const state = reduce(initialPasteFromUrlState(), [
      { type: "submit" },
      { type: "submit-failed", error: "No job description was found." },
      { type: "close" },
    ]);

    expect(state.status).toBe("idle");
    expect(state.error).toBe("");
  });

  it("keeps the url after a cancel so a retry can reuse it", () => {
    const state = reduce(initialPasteFromUrlState(), [
      { type: "url-change", url: "https://example.com/job" },
      { type: "close" },
    ]);

    expect(state.url).toBe("https://example.com/job");
  });

  it("never reaches success without a successful submission", () => {
    const state = reduce(initialPasteFromUrlState(), [
      { type: "submit-failed", error: "Enter a valid job link." },
    ]);

    expect(state.status).not.toBe("success");
  });
});
