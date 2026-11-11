// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RoughNotesIntake } from "../../../src/components/library/rough-notes-intake";
import {
  achievementDrafts,
  mergeNotes,
  splitNote,
  splitRoughNotes,
} from "../../../src/lib/intake/rough-notes";

describe("splitRoughNotes", () => {
  it("splits five bullet lines into five notes", () => {
    const notes = splitRoughNotes(
      "- First\r\n* Second\r\n• Third\r\n– Fourth\r\n— Fifth",
    );
    expect(notes).toEqual(["First", "Second", "Third", "Fourth", "Fifth"]);
  });

  it("drops blank lines and keeps a single paragraph without inventing text", () => {
    expect(splitRoughNotes("First line\n\nSecond line\n\n")).toEqual([
      "First line",
      "Second line",
    ]);
    expect(splitRoughNotes("  Built Python scripts.  ")).toEqual([
      "Built Python scripts.",
    ]);
    expect(splitRoughNotes("- Built Python scripts")).toEqual([
      "Built Python scripts",
    ]);
    expect(splitRoughNotes("-40% latency")).toEqual(["-40% latency"]);
  });

  it("preserves metrics, dates, and tool names", () => {
    const notes = splitRoughNotes(
      [
        "- Built Python scripts to clean SQL exports and publish Power BI reports",
        "1. reduced latency 40% in 2024",
      ].join("\n"),
    );
    expect(notes).toEqual([
      "Built Python scripts to clean SQL exports and publish Power BI reports",
      "reduced latency 40% in 2024",
    ]);
  });

  it("returns no notes for blank input", () => {
    expect(splitRoughNotes("")).toEqual([]);
    expect(splitRoughNotes("   ")).toEqual([]);
    expect(splitRoughNotes(" \n\n\t ")).toEqual([]);
  });
});

describe("mergeNotes", () => {
  it("merges the first two of five notes into four", () => {
    const notes = ["First", "Second", "Third", "Fourth", "Fifth"];
    expect(mergeNotes(notes, 0)).toEqual([
      "First Second",
      "Third",
      "Fourth",
      "Fifth",
    ]);
    expect(notes).toEqual(["First", "Second", "Third", "Fourth", "Fifth"]);
  });

  it("leaves the list unchanged when the index has no neighbor", () => {
    const notes = ["First", "Second"];
    expect(mergeNotes(notes, 1)).toBe(notes);
    expect(mergeNotes(notes, -1)).toBe(notes);
  });
});

describe("splitNote", () => {
  it("splits on the first sentence boundary and keeps metrics", () => {
    expect(splitNote(["Built APIs. Reduced latency 40% in 2024."], 0)).toEqual([
      "Built APIs.",
      "Reduced latency 40% in 2024.",
    ]);
  });

  it("returns the same list when there is no interior sentence boundary", () => {
    const notes = ["reduced latency 40% in 2024"];
    expect(splitNote(notes, 0)).toBe(notes);
    const trailing = ["Built APIs. "];
    expect(splitNote(trailing, 0)).toBe(trailing);
  });
});

describe("achievementDrafts", () => {
  it("builds direct-user payloads with unique stable ids", () => {
    const used = new Set(["achievement-note-built-python-scripts"]);
    const drafts = achievementDrafts(
      [
        "Built Python scripts",
        "Built Python scripts",
        "reduced latency 40% in 2024",
      ],
      used,
    );

    expect(used).toEqual(new Set(["achievement-note-built-python-scripts"]));
    expect(drafts.map((draft) => draft.id)).toEqual([
      "achievement-note-built-python-scripts-2",
      "achievement-note-built-python-scripts-3",
      "achievement-note-reduced-latency-40-in-2024",
    ]);
    expect(drafts[2]).toEqual({
      id: "achievement-note-reduced-latency-40-in-2024",
      text: "reduced latency 40% in 2024",
      tags: [],
      skillIds: [],
      metrics: [],
      source: { type: "direct-user" },
      enabled: true,
      githubEvidence: null,
    });
    const ids = new Set(drafts.map((draft) => draft.id));
    expect(ids.size).toBe(drafts.length);
    for (const draft of drafts) {
      expect(draft.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });
});

describe("RoughNotesIntake", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(node: ReactNode) {
    act(() => root.render(node));
  }

  function button(label: string, index = 0): HTMLButtonElement {
    const matches = [...container.querySelectorAll("button")].filter(
      (element) => element.textContent?.trim() === label,
    );
    const found = matches[index];
    if (!found) throw new Error(`Missing button ${label}`);
    return found as HTMLButtonElement;
  }

  function setNotes(value: string) {
    const textarea = container.querySelector("textarea");
    if (!textarea) throw new Error("Missing textarea");
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(textarea, value);
    act(() => {
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function bulletTexts(): string[] {
    return [...container.querySelectorAll("li p")].map(
      (item) => item.textContent ?? "",
    );
  }

  it("reviews, merges, splits, and saves bullets without saving skills itself", async () => {
    const saved: Array<{ texts: string[]; skills: string[] }> = [];
    render(
      createElement(RoughNotesIntake, {
        parentLabel: "Data analyst",
        existingSkills: [],
        usedIds: [],
        onSave: async (drafts, candidates) => {
          saved.push({
            texts: drafts.map((draft) => draft.text),
            skills: candidates.map((candidate) => candidate.name),
          });
        },
      }),
    );

    expect(container.textContent).toContain("Data analyst");
    expect(container.textContent).toContain("Paste what you worked on");
    expect(button("Save notes").disabled).toBe(true);
    expect(container.querySelector(".editor-field")).not.toBeNull();
    expect(button("Review bullets").className).toContain(
      "ui-button--secondary",
    );
    expect(button("Save notes").className).toContain("ui-button--primary");

    setNotes(
      [
        "- Built Python scripts to clean SQL exports and publish Power BI reports",
        "- Shipped the API. Reduced latency 40% in 2024.",
      ].join("\n"),
    );
    act(() => button("Review bullets").click());

    expect(bulletTexts()).toEqual([
      "Built Python scripts to clean SQL exports and publish Power BI reports",
      "Shipped the API. Reduced latency 40% in 2024.",
    ]);
    expect(container.textContent).toContain("Skills found in these notes");
    expect(container.textContent).toContain("Python");
    expect(container.textContent).toContain("SQL");
    expect(container.textContent).toContain("Power BI");
    expect(button("Merge with next", 1).disabled).toBe(true);
    expect(button("Split", 0).disabled).toBe(true);
    expect(button("Split", 1).disabled).toBe(false);

    act(() => button("Split", 1).click());
    expect(bulletTexts()).toEqual([
      "Built Python scripts to clean SQL exports and publish Power BI reports",
      "Shipped the API.",
      "Reduced latency 40% in 2024.",
    ]);

    act(() => button("Merge with next", 0).click());
    expect(bulletTexts()).toEqual([
      "Built Python scripts to clean SQL exports and publish Power BI reports Shipped the API.",
      "Reduced latency 40% in 2024.",
    ]);

    await act(async () => {
      button("Save notes").click();
    });
    expect(saved).toEqual([
      {
        texts: [
          "Built Python scripts to clean SQL exports and publish Power BI reports Shipped the API.",
          "Reduced latency 40% in 2024.",
        ],
        skills: ["Python", "SQL", "Power BI"],
      },
    ]);
    expect(container.querySelector(".editor-error")).toBeNull();
  });

  it("shows the message when saving fails", async () => {
    render(
      createElement(RoughNotesIntake, {
        parentLabel: "Data analyst",
        existingSkills: [],
        usedIds: ["achievement-note-kept-the-metric"],
        onSave: async () => {
          throw new Error("The library rejected these notes.");
        },
      }),
    );
    setNotes("- kept the metric");
    act(() => button("Review bullets").click());
    await act(async () => {
      button("Save notes").click();
    });
    expect(container.querySelector(".editor-error")?.textContent).toBe(
      "The library rejected these notes.",
    );
  });

  it("saves the edited paste instead of the earlier review", async () => {
    const saved: string[][] = [];
    render(
      createElement(RoughNotesIntake, {
        parentLabel: "Data analyst",
        existingSkills: [],
        usedIds: [],
        onSave: async (drafts) => {
          saved.push(drafts.map((draft) => draft.text));
        },
      }),
    );
    setNotes("- First draft\n- Second draft");
    act(() => button("Review bullets").click());
    expect(bulletTexts()).toEqual(["First draft", "Second draft"]);

    setNotes("- Rewritten after review");
    expect(bulletTexts()).toEqual(["Rewritten after review"]);
    await act(async () => {
      button("Save notes").click();
    });
    expect(saved).toEqual([["Rewritten after review"]]);
  });

  it("keeps a rejected skill unchecked after a merge", async () => {
    const saved: string[][] = [];
    render(
      createElement(RoughNotesIntake, {
        parentLabel: "Data analyst",
        existingSkills: [],
        usedIds: [],
        onSave: async (_drafts, candidates) => {
          saved.push(candidates.map((candidate) => candidate.name));
        },
      }),
    );
    setNotes("- Built Python scripts\n- Published the report");
    act(() => button("Review bullets").click());
    const python = [
      ...container.querySelectorAll(".note-skill-picks label"),
    ].find((label) => label.textContent?.includes("Python"));
    const checkbox = python?.querySelector("input");
    expect(checkbox).toBeInstanceOf(HTMLInputElement);
    act(() => checkbox?.click());
    act(() => button("Merge with next", 0).click());
    const pythonAfter = [
      ...container.querySelectorAll(".note-skill-picks label"),
    ].find((label) => label.textContent?.includes("Python"));
    expect(pythonAfter?.querySelector("input")?.checked).toBe(false);
    await act(async () => {
      button("Save notes").click();
    });
    expect(saved).toEqual([[]]);
  });
});
