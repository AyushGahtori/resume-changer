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
  EvidenceItem,
  EvidencePanelProps,
  FileCandidate,
} from "../../../../src/lib/github/contracts";
import {
  blockedFileCandidate,
  exactBudget,
  manualFileCandidate,
  safeFileCandidate,
} from "../../../../src/components/github-import/testing/fixtures";

let createRoot: typeof import("react-dom/client").createRoot;
let EvidencePanel: typeof import("../../../../src/components/github-import/evidence-panel").EvidencePanel;

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
    Element: { configurable: true, value: dom.window.Element },
    Node: { configurable: true, value: dom.window.Node },
    Event: { configurable: true, value: dom.window.Event },
    KeyboardEvent: { configurable: true, value: dom.window.KeyboardEvent },
    MouseEvent: { configurable: true, value: dom.window.MouseEvent },
  });
  ({ createRoot } = await import("react-dom/client"));
  ({ EvidencePanel } =
    await import("../../../../src/components/github-import/evidence-panel"));
});

afterAll(() => dom.window.close());

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Array<{ root: Root; host: HTMLDivElement }> = [];

function mount(props: EvidencePanelProps) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(EvidencePanel, props)));
  mountedRoots.push({ root, host });
  return host;
}

function buttonNamed(host: HTMLElement, label: string) {
  const button = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.getAttribute("aria-label") === label,
  );
  if (!button) throw new Error(`Missing button: ${label}`);
  return button;
}

function baseProps(
  overrides: Partial<EvidencePanelProps> = {},
): EvidencePanelProps {
  const candidate = safeFileCandidate();
  return {
    candidates: [candidate],
    selectedIds: [candidate.id],
    pinnedIds: [],
    excerpts: [],
    limitations: [],
    budget: exactBudget(),
    onPin: vi.fn(),
    onRemove: vi.fn(),
    onInspect: vi.fn(),
    ...overrides,
  };
}

function evidenceItem(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: "summary-excerpt-one",
    snapshotId: "summary-snapshot",
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    path: "apps/dashboard/src/summary.ts",
    blobSha: "abcdef0123456789abcdef0123456789abcdef01",
    pointer: { kind: "lines", startLine: 12, endLine: 14 },
    excerpt:
      "export function summarize(rows: Row[]) {\n  return rows.length;\n}",
    excerptSha256: "a".repeat(64),
    category: "implementation",
    classification: "observed",
    ...overrides,
  };
}

afterEach(() => {
  for (const { root, host } of mountedRoots.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("EvidencePanel", () => {
  it("starts collapsed and exposes a native keyboard disclosure", () => {
    const host = mount(baseProps());
    const disclosure = host.querySelector("details");
    const summary = disclosure?.querySelector("summary");

    expect(disclosure?.open).toBe(false);
    expect(summary).not.toBeNull();
    expect(summary?.tabIndex).toBeGreaterThanOrEqual(0);
    expect(host.textContent).toContain("Files and evidence");
  });

  it("stages a safe manual addition without an analysis callback", () => {
    const onPin = vi.fn();
    const onInspect = vi.fn();
    const generation = vi.fn();
    const candidate: FileCandidate = {
      ...manualFileCandidate(),
      selected: false,
      pinned: false,
    };
    const host = mount(
      baseProps({
        candidates: [candidate],
        selectedIds: [],
        pinnedIds: [],
        onPin,
        onInspect,
      }),
    );

    act(() => buttonNamed(host, `Add safe file ${candidate.path}`).click());

    expect(onPin).toHaveBeenCalledTimes(1);
    expect(onPin).toHaveBeenCalledWith(candidate.id);
    expect(onInspect).not.toHaveBeenCalled();
    expect(generation).not.toHaveBeenCalled();
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "Selection change staged",
    );
  });

  it("allows removing a selected file so another safe file can replace it", () => {
    const current = safeFileCandidate();
    const replacement: FileCandidate = {
      ...manualFileCandidate(),
      selected: false,
      pinned: false,
    };
    const onPin = vi.fn();
    const onRemove = vi.fn();
    const host = mount(
      baseProps({
        candidates: [current, replacement],
        selectedIds: [current.id],
        pinnedIds: [],
        onPin,
        onRemove,
      }),
    );

    act(() =>
      buttonNamed(
        host,
        `Remove ${current.path} from the selected files`,
      ).click(),
    );
    act(() => buttonNamed(host, `Add safe file ${replacement.path}`).click());

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith(current.id);
    expect(onPin).toHaveBeenCalledTimes(1);
    expect(onPin).toHaveBeenCalledWith(replacement.id);
  });

  it("keeps blocked candidates visible, explains the block, and never pins them", () => {
    const candidate = blockedFileCandidate();
    const onPin = vi.fn();
    const host = mount(
      baseProps({
        candidates: [candidate],
        selectedIds: [],
        pinnedIds: [],
        onPin,
      }),
    );
    const add = buttonNamed(host, `Cannot add ${candidate.path}`);

    expect(host.textContent).toContain("Blocked by the safety rule");
    expect(add.disabled).toBe(true);
    act(() => add.click());
    expect(onPin).not.toHaveBeenCalled();
  });

  it("shows explicit replacement guidance for a safe file outside hard limits", () => {
    const candidate: FileCandidate = {
      ...safeFileCandidate(),
      selected: false,
      pinned: false,
      eligible: false,
    };
    const onPin = vi.fn();
    const host = mount(
      baseProps({
        candidates: [candidate],
        selectedIds: [],
        pinnedIds: [],
        budget: { ...exactBudget(), selectedUniqueFiles: 12 },
        onPin,
      }),
    );
    const add = buttonNamed(host, `Cannot add ${candidate.path}`);

    expect(host.textContent).toContain(
      "Remove a selected file or narrow the scope before adding this path.",
    );
    expect(add.disabled).toBe(true);
    act(() => add.click());
    expect(onPin).not.toHaveBeenCalled();
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it("searches by path/category and keeps the action list keyboard reachable", () => {
    const first = safeFileCandidate();
    const second: FileCandidate = {
      ...manualFileCandidate(),
      selected: false,
      pinned: false,
    };
    const host = mount(
      baseProps({ candidates: [first, second], selectedIds: [first.id] }),
    );
    const search = host.querySelector<HTMLInputElement>(
      'input[aria-label="Search repository files"]',
    );

    expect(search).not.toBeNull();
    expect(buttonNamed(host, `Inspect source ${first.path}`).tabIndex).toBe(0);
    const valueSetter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    )?.set;
    valueSetter?.call(search, "test/summary");
    act(() =>
      search!.dispatchEvent(new dom.window.Event("input", { bubbles: true })),
    );

    expect(host.querySelectorAll("[data-file-id]")).toHaveLength(1);
    expect(
      host.querySelector("[data-file-id]")?.getAttribute("data-file-id"),
    ).toBe(second.id);
  });

  it("renders escaped excerpts with exact source provenance and collapses duplicate ranges", () => {
    const candidate = safeFileCandidate();
    const maliciousText =
      '<img src=x onerror="globalThis.injected=true"> & source';
    const first = evidenceItem({ excerpt: maliciousText });
    const duplicate = evidenceItem({
      id: "summary-excerpt-two",
      excerpt: maliciousText,
    });
    const onInspect = vi.fn();
    const host = mount(
      baseProps({
        candidates: [candidate],
        selectedIds: [candidate.id],
        excerpts: [first, duplicate],
        onInspect,
      }),
    );

    act(() => buttonNamed(host, `Inspect source ${candidate.path}`).click());

    expect(onInspect).toHaveBeenCalledTimes(1);
    expect(onInspect).toHaveBeenCalledWith(candidate.id);
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("pre")?.textContent).toBe(maliciousText);
    expect(host.textContent).toContain(candidate.path);
    expect(host.textContent).toContain(first.commitSha);
    expect(host.textContent).toContain("Lines 12–14");
    expect(host.textContent).toContain(
      "2 evidence records share this original source range",
    );
    expect(host.querySelectorAll("pre")).toHaveLength(1);
  });

  it("shows partial-scope limitations and keeps estimates distinct from reported usage", () => {
    const host = mount(
      baseProps({
        limitations: ["Only a subset of the package inventory was available."],
        budget: {
          ...exactBudget(),
          limitReason: "source-line-or-file-limit",
          estimatedInputTokens: 7_400,
          reportedInputTokens: null,
        },
      }),
    );
    const budget = host.querySelectorAll("details")[1];
    if (budget) budget.open = true;

    expect(host.textContent).toContain(
      "Only a subset of the package inventory was available.",
    );
    expect(host.textContent).toContain(
      "The current selection reached a file or source-line limit.",
    );
    expect(host.textContent).toContain("7,400 tokens");
    expect(host.textContent).toContain("Not reported");
    expect(host.textContent).not.toMatch(/no secrets were imported/i);
  });
});
