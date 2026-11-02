import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type {
  AchievementReviewDetails,
  AchievementReviewDraft,
  AchievementReviewProps,
} from "../../../../src/components/github-import/achievement-review";
import { AchievementReview } from "../../../../src/components/github-import/achievement-review";

let createRoot: typeof import("react-dom/client").createRoot;
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});

beforeAll(async () => {
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    HTMLInputElement: {
      configurable: true,
      value: dom.window.HTMLInputElement,
    },
    HTMLTextAreaElement: {
      configurable: true,
      value: dom.window.HTMLTextAreaElement,
    },
    Element: { configurable: true, value: dom.window.Element },
    Node: { configurable: true, value: dom.window.Node },
    Event: { configurable: true, value: dom.window.Event },
  });
  ({ createRoot } = await import("react-dom/client"));
}, 30_000);

afterAll(() => dom.window.close());

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Array<{ root: Root; host: HTMLDivElement }> = [];

function mount(props: AchievementReviewProps) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(AchievementReview, props));
  });
  mountedRoots.push({ root, host });
  return host;
}

function buttonNamed(host: HTMLElement, label: string) {
  const button = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.replace(/\s+/g, " ").trim() === label,
  );
  if (!button) throw new Error("Missing button: " + label);
  return button;
}

function baseDraft(
  overrides: Partial<AchievementReviewDraft> = {},
): AchievementReviewDraft {
  return {
    id: "draft-1",
    version: 1,
    projectId: "project-1",
    text: "Implemented a validated achievement update flow.",
    reviewedBaseText: "Implemented a validated achievement update flow.",
    claimIds: ["claim-1"],
    supportStatus: "supported",
    selectedForSave: false,
    contributionConfirmed: false,
    metricResultIds: [],
    approvalEligible: true,
    approvalErrors: [],
    ...overrides,
  };
}

function baseDetails(
  overrides: Partial<AchievementReviewDetails> = {},
): AchievementReviewDetails {
  return {
    evidence: [
      {
        id: "evidence-1",
        category: "observed",
        path: "src/lib/data/writers.ts",
        lineStart: 42,
        lineEnd: 58,
        excerpt: "Validates the update and writes it atomically.",
        sourceUrl:
          "https://github.com/example/project/blob/abc/src/lib/data/writers.ts#L42-L58",
      },
    ],
    userContext: ["I worked on the achievement update workflow."],
    inference: ["This may improve reliability for repeated edits."],
    metrics: [],
    ...overrides,
  };
}

function baseProps(
  overrides: Partial<AchievementReviewProps> = {},
): AchievementReviewProps {
  return {
    drafts: [baseDraft()],
    selectedIds: [],
    contributionConfirmations: {},
    supportDetails: {
      "draft-1": "The selected source shows validation and safe writes.",
    },
    detailsByDraftId: { "draft-1": baseDetails() },
    onTextChange: vi.fn(),
    onSelect: vi.fn(),
    onConfirmContribution: vi.fn(),
    onReject: vi.fn(),
    onExpandMeasurement: vi.fn(),
    ...overrides,
  };
}

function setInputValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(element),
    "value",
  )?.set;
  if (!setter) throw new Error("Input value setter is unavailable.");
  setter.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

afterEach(() => {
  for (const { root, host } of mountedRoots.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("AchievementReview", () => {
  it("keeps save selection separate from contribution confirmation", () => {
    const onSelect = vi.fn();
    const onConfirmContribution = vi.fn();
    const host = mount(baseProps({ onSelect, onConfirmContribution }));

    const select = host.querySelector<HTMLInputElement>(
      '[aria-label="Select draft 1 for save"]',
    );
    if (!select) throw new Error("Draft selection checkbox is missing.");

    act(() => select.click());
    expect(onSelect).toHaveBeenCalledWith("draft-1", true);
    expect(onConfirmContribution).not.toHaveBeenCalled();

    act(() => buttonNamed(host, "Confirm my contribution").click());
    expect(onConfirmContribution).toHaveBeenCalledWith("draft-1", true);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("invalidates an old confirmation when the achievement text changes", () => {
    const draft = baseDraft({ contributionConfirmed: true });
    const onTextChange = vi.fn();
    const onConfirmContribution = vi.fn();
    const host = mount(
      baseProps({
        drafts: [draft],
        selectedIds: [draft.id],
        contributionConfirmations: { [draft.id]: true },
        onTextChange,
        onConfirmContribution,
      }),
    );

    expect(host.textContent).toContain("You confirmed your contribution");
    const editor = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Achievement text for draft 1"]',
    );
    if (!editor) throw new Error("Achievement editor is missing.");

    act(() => setInputValue(editor, "A revised achievement statement."));

    expect(onTextChange).toHaveBeenCalledWith(
      "draft-1",
      "A revised achievement statement.",
      1,
    );
    expect(onConfirmContribution).toHaveBeenCalledWith("draft-1", false);
    expect(host.textContent).toContain("Your contribution is not confirmed");
    expect(host.textContent).toContain(
      "Confirm that you contributed to this work before saving it.",
    );
  });

  it("supports an indeterminate select-all state and reports selected eligibility", () => {
    const first = baseDraft();
    const second = baseDraft({
      id: "draft-2",
      projectId: "project-2",
      text: "Built a bounded inspection service.",
    });
    const onSelect = vi.fn();
    const host = mount(
      baseProps({
        drafts: [first, second],
        selectedIds: [first.id],
        onSelect,
      }),
    );
    const selectAll = host.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    if (!selectAll) throw new Error("Select-all checkbox is missing.");

    expect(selectAll.indeterminate).toBe(true);
    expect(host.textContent).toContain("1 selected");
    expect(host.textContent).toContain("0 eligible to save");

    act(() => selectAll.click());
    expect(onSelect).toHaveBeenNthCalledWith(1, "draft-1", true);
    expect(onSelect).toHaveBeenNthCalledWith(2, "draft-2", true);
  });

  it("keeps the selection and review actions keyboard-focusable", () => {
    const host = mount(baseProps());
    const selection = host.querySelector<HTMLInputElement>(
      '[aria-label="Select draft 1 for save"]',
    );
    const confirm = buttonNamed(host, "Confirm my contribution");
    const evidence = buttonNamed(host, "Review evidence and context (1)");
    if (!selection) throw new Error("Draft selection checkbox is missing.");

    expect(selection.tabIndex).toBe(0);
    expect(confirm.tabIndex).toBe(0);
    expect(evidence.tabIndex).toBe(0);

    act(() => confirm.focus());
    expect(document.activeElement).toBe(confirm);
    act(() => evidence.focus());
    expect(document.activeElement).toBe(evidence);
  });

  it("explains missing evidence and keeps support status read-only", () => {
    const draft = baseDraft({
      supportStatus: "unsupported",
      approvalEligible: false,
      approvalErrors: ["No selected source supports this claim."],
    });
    const host = mount(
      baseProps({
        drafts: [draft],
        selectedIds: [draft.id],
        supportDetails: {
          [draft.id]: "No selected source supports this claim.",
        },
        detailsByDraftId: { [draft.id]: baseDetails({ evidence: [] }) },
      }),
    );

    expect(host.textContent).toContain("Insufficient evidence");
    expect(host.textContent).toContain(
      "No selected source supports this claim.",
    );
    expect(host.textContent).toContain("cannot be saved");
    expect(host.querySelector("select")).toBeNull();

    act(() => buttonNamed(host, "Review evidence and context (0)").click());
    expect(host.textContent).toContain("No source excerpts are attached.");
  });

  it("keeps observations, user context, and inference distinct without clipping text", () => {
    const longText = "Validated source-backed achievement. ".repeat(36);
    const details = baseDetails({
      evidence: [
        {
          id: "safe-source",
          category: "observed",
          path: "src/features/a/very-long-folder-name/achievement-handler.ts",
          lineStart: 1,
          lineEnd: 200,
          excerpt:
            "A long source excerpt that should wrap without clipping. ".repeat(
              8,
            ),
          sourceUrl: "https://github.com/example/project/blob/abc/src/file.ts",
        },
        {
          id: "unsafe-source",
          category: "documented",
          path: "docs/unsafe-link.md",
          sourceUrl: "javascript:alert(1)",
        },
      ],
    });
    const draft = baseDraft({ text: longText });
    const host = mount(
      baseProps({
        drafts: [draft],
        detailsByDraftId: { [draft.id]: details },
      }),
    );
    const editor = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Achievement text for draft 1"]',
    );
    if (!editor) throw new Error("Achievement editor is missing.");
    expect(editor.value).toBe(longText);
    expect(Number(editor.getAttribute("rows"))).toBeGreaterThan(10);

    act(() => buttonNamed(host, "Review evidence and context (2)").click());
    expect(host.textContent).toContain("Observed source");
    expect(host.textContent).toContain("Your context");
    expect(host.textContent).toContain("Inference to review");
    expect(host.textContent).toContain(
      "src/features/a/very-long-folder-name/achievement-handler.ts",
    );
    expect(host.querySelector('a[href^="https://github.com/"]')).not.toBeNull();
    expect(host.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(host.querySelector("code")?.textContent).toContain(
      "docs/unsafe-link.md",
    );
  });

  it("expands the measurement slot inline and emits the task callback", () => {
    const draft = baseDraft();
    const onExpandMeasurement = vi.fn();
    const host = mount(
      baseProps({
        drafts: [draft],
        onExpandMeasurement,
        renderMeasurement: () =>
          createElement("div", null, "Measurement questions for this draft"),
      }),
    );

    act(() => buttonNamed(host, "Add a measurement").click());
    expect(onExpandMeasurement).toHaveBeenCalledWith("draft-1");
    expect(host.textContent).toContain("Measurement questions for this draft");

    act(() => buttonNamed(host, "Close measurement").click());
    expect(onExpandMeasurement).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain(
      "Measurement questions for this draft",
    );
  });

  it("rejects only the staged draft", () => {
    const onReject = vi.fn();
    const host = mount(baseProps({ onReject }));

    act(() => buttonNamed(host, "Reject draft").click());

    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledWith("draft-1");
  });

  it("renders an empty review state without a selectable draft", () => {
    const host = mount(baseProps({ drafts: [] }));

    expect(host.textContent).toContain(
      "No achievement drafts are ready to review yet.",
    );
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
  });
});
