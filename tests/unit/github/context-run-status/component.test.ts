// @vitest-environment jsdom
import { JSDOM } from "jsdom";
import { act, createElement, type ReactNode } from "react";
import type { Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { RunStatusInput } from "../../../../src/lib/github/context-run-status/status";
import { runStatusSnapshot } from "../../../fixtures/github/context-run-status/snapshots";

let createRoot: typeof import("react-dom/client").createRoot;
let RunStatusPanel: typeof import("../../../../src/components/github-import/context-run-status/run-status").RunStatusPanel;
let RunStatusSidebar: typeof import("../../../../src/components/github-import/context-run-status/run-status").RunStatusSidebar;
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});
const mounted: Array<{ root: Root; host: HTMLDivElement }> = [];

beforeAll(async () => {
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    Element: { configurable: true, value: dom.window.Element },
    Node: { configurable: true, value: dom.window.Node },
    Event: { configurable: true, value: dom.window.Event },
  });
  ({ createRoot } = await import("react-dom/client"));
  ({ RunStatusPanel, RunStatusSidebar } =
    await import("../../../../src/components/github-import/context-run-status/run-status"));
});

afterAll(() => dom.window.close());

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

function mount(element: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(element));
  mounted.push({ root, host });
  return host;
}

afterEach(() => {
  for (const { root, host } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  document.body.replaceChildren();
});

describe("RunStatusPanel and RunStatusSidebar", () => {
  it("show the same outcome when a prepared run was interrupted", () => {
    const snapshot: RunStatusInput = runStatusSnapshot({
      lifecycle: "interrupted",
      jobState: "interrupted",
      preparedSelection: "available",
      attempt: {
        runId: "run-current",
        marker: "may-have-been-submitted",
        number: 1,
      },
      failure: {
        runId: "run-current",
        category: "final-acknowledgement",
        stage: "final-acknowledgement",
      },
    });
    const panel = mount(createElement(RunStatusPanel, { snapshot }));
    const sidebar = mount(createElement(RunStatusSidebar, { snapshot }));

    expect(
      panel.querySelector("[data-phase]")?.getAttribute("data-phase"),
    ).toBe("interrupted-unknown");
    expect(
      sidebar.querySelector("[data-phase]")?.getAttribute("data-phase"),
    ).toBe("interrupted-unknown");
    expect(panel.textContent).toContain("Analysis outcome is unknown");
    expect(sidebar.textContent).toContain("Analysis outcome is unknown");
    expect(panel.textContent).toContain("No automatic paid retry will run");
    expect(panel.textContent).toContain("Completion acknowledgement");
    expect(panel.querySelector("button")).toBeNull();
  });

  it("does not render a save action for a confirmed zero-draft result", () => {
    const snapshot = runStatusSnapshot({
      lifecycle: "ready-to-review",
      attempt: {
        runId: "run-current",
        marker: "result-persisted",
        number: 1,
      },
      result: {
        availability: "available",
        runId: "run-current",
        draftCount: 0,
      },
    });
    const panel = mount(createElement(RunStatusPanel, { snapshot }));

    expect(panel.textContent).toContain("Analysis finished with no drafts");
    expect(panel.textContent).toContain("No achievements are ready to save");
    expect(panel.querySelector("button")).toBeNull();
  });

  it("does not expose a raw diagnostic string in status copy", () => {
    const snapshot = runStatusSnapshot({
      lifecycle: "failed",
      failure: {
        runId: "run-current",
        category: "unknown",
        stage: "api-key=private-secret",
      },
    });
    const panel = mount(createElement(RunStatusPanel, { snapshot }));

    expect(panel.textContent).not.toContain("api-key=private-secret");
    expect(panel.textContent).not.toContain("private-secret");
    expect(panel.textContent).toContain("Unclassified outcome");
  });
});
