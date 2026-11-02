// @vitest-environment jsdom
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
import type { AnalysisStatusProps } from "../../../../src/components/github-import/analysis-status";
import { statusProps } from "../../../fixtures/github/task-27/status";

let createRoot: typeof import("react-dom/client").createRoot;
let AnalysisStatus: typeof import("../../../../src/components/github-import/analysis-status").AnalysisStatus;
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});

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
  ({ AnalysisStatus } =
    await import("../../../../src/components/github-import/analysis-status"));
});

afterAll(() => dom.window.close());

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Array<{ root: Root; host: HTMLDivElement }> = [];

function mount(props: AnalysisStatusProps) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(AnalysisStatus, props)));
  mountedRoots.push({ root, host });
  return host;
}

function rerender(host: HTMLDivElement, props: AnalysisStatusProps) {
  const mounted = mountedRoots.find((item) => item.host === host);
  if (!mounted) throw new Error("Expected a mounted analysis-status host.");
  act(() => mounted.root.render(createElement(AnalysisStatus, props)));
}

function buttonNamed(host: HTMLElement, label: string) {
  const button = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.replace(/\s+/g, " ").trim() === label,
  );
  if (!button) throw new Error(`Missing button: ${label}`);
  return button;
}

afterEach(() => {
  for (const { root, host } of mountedRoots.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AnalysisStatus", () => {
  it("keeps partial preparation at Analyze until an analysis actually runs", () => {
    const props = statusProps("partial", {
      analysisStarted: false,
      stage: "Partial analysis is ready for review",
    });
    const host = mount(props);
    expect(host.querySelector('[aria-current="step"]')?.textContent).toContain(
      "Analyze",
    );
    expect(host.textContent).toContain(
      "Evidence prepared with coverage limitations",
    );
    expect(host.textContent).not.toContain(
      "Partial analysis is ready for review",
    );
    rerender(host, { ...props, analysisStarted: true });
    expect(host.querySelector('[aria-current="step"]')?.textContent).toContain(
      "Review & save",
    );
  });

  it("shows queued work in the three-state flow and separates leaving from cancelling", () => {
    const onCancel = vi.fn();
    const host = mount(statusProps("queued", { onCancel }));

    expect(
      host.querySelector('[aria-label="GitHub import progress"] ol'),
    ).not.toBeNull();
    expect(host.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(host.querySelector('[aria-current="step"]')?.textContent).toContain(
      "Analyze",
    );
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "Analysis is queued",
    );
    expect(host.textContent).toContain(
      "Keep this tab open. Reloading or closing it discards unsaved evidence.",
    );
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
    expect(host.textContent).not.toMatch(
      /\b\d+%|minutes remaining|estimated completion/i,
    );

    const backLink =
      host.querySelector<HTMLAnchorElement>('a[href="/library"]');
    expect(backLink?.textContent).toBe("Back to library");
    backLink?.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });
    act(() => backLink?.click());
    expect(onCancel).not.toHaveBeenCalled();

    act(() => buttonNamed(host, "Cancel analysis").click());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("keeps a dropped status stream distinct from a running job failure", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const onRetry = vi.fn();
    const props = statusProps("analyzing", {
      stage: "Resolving the selected repository snapshot",
      connectionState: "reconnecting",
      onRetry,
    });
    const host = mount(props);

    expect(host.textContent).toContain("Analyzing your project");
    expect(host.textContent).toContain(
      "Resolving the selected repository snapshot",
    );
    expect(host.textContent).toContain(
      "Reconnecting to status updates. Your analysis state is unchanged.",
    );
    expect(host.textContent).not.toContain("Analysis couldn’t finish");
    expect(
      host.querySelector('[role="status"][aria-live="polite"]'),
    ).not.toBeNull();

    vi.useFakeTimers();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onRetry).not.toHaveBeenCalled();

    rerender(host, { ...props, connectionState: "connected" });
    expect(host.textContent).toContain("Analyzing your project");
    expect(host.textContent).not.toContain("Reconnecting to status updates");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("offers missing-context recovery only when the state allows it", () => {
    const onResumeSetup = vi.fn();
    const onRetry = vi.fn();
    const onCancel = vi.fn();
    const host = mount(
      statusProps("needs-input", {
        error: {
          code: "needs-context",
          message: "Add which part of the project you owned.",
          retryable: false,
        },
        resumeAvailable: true,
        onResumeSetup,
        onRetry,
        onCancel,
      }),
    );

    expect(host.textContent).toContain("Analysis needs more context");
    expect(host.textContent).toContain(
      "Add which part of the project you owned.",
    );
    expect(
      host.querySelector('button[aria-disabled="true"]')?.textContent,
    ).toBe("Cancel analysis");
    expect(host.querySelector("button")?.textContent).not.toBe(
      "Retry analysis",
    );

    act(() => buttonNamed(host, "Add missing context").click());
    act(() => buttonNamed(host, "Cancel analysis").click());
    expect(onResumeSetup).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("shows a missing worker as unavailable instead of spinning forever", () => {
    const onResumeSetup = vi.fn();
    const host = mount(
      statusProps("preparing", {
        stage: "Waiting for the local analysis worker",
        error: {
          code: "unavailable",
          message: "The local analysis worker is unavailable.",
          retryable: false,
        },
        cancellationAvailable: false,
        resumeAvailable: true,
        onResumeSetup,
      }),
    );

    expect(host.textContent).toContain("Analysis worker unavailable");
    expect(host.textContent).toContain(
      "The local analysis worker is unavailable.",
    );
    expect(host.querySelector('[role="status"]')?.textContent).not.toContain(
      "still working",
    );
    expect(
      host.querySelector('[data-testid="analysis-status-spinner"]'),
    ).toBeNull();
    expect(host.querySelector('button[aria-disabled="true"]')).not.toBeNull();
    act(() => buttonNamed(host, "Return to setup").click());
    expect(onResumeSetup).toHaveBeenCalledTimes(1);
  });

  it("keeps library and cancel focus stable while the job state changes", () => {
    const queued = statusProps("queued", { cancellationAvailable: true });
    const host = mount(queued);
    const libraryLink =
      host.querySelector<HTMLAnchorElement>('a[href="/library"]');
    const cancelButton = buttonNamed(host, "Cancel analysis");

    libraryLink?.focus();
    rerender(host, statusProps("ready-to-review"));
    expect(document.activeElement).toBe(libraryLink);

    cancelButton.focus();
    rerender(host, statusProps("failed"));
    expect(document.activeElement).toBe(cancelButton);
    expect(cancelButton.getAttribute("aria-disabled")).toBe("true");
    expect(host.textContent).toContain("Analysis couldn’t finish");
  });

  it("shows Retry-After guidance without an automatic retry", () => {
    const onRetry = vi.fn();
    const base = statusProps("failed", {
      stage: "Waiting for provider response",
      error: {
        code: "rate-limited",
        message: "The provider asked us to slow down.",
        retryable: true,
        retryAfterSeconds: 61,
      },
      retryAvailable: false,
      onRetry,
    });
    const host = mount(base);

    expect(host.textContent).toContain("wait about 2 minutes");
    expect(host.textContent).toContain("No automatic retry will run.");
    expect(host.textContent).not.toContain("another analysis request");
    expect(host.querySelector("button")?.textContent).not.toContain("Retry");
    expect(onRetry).not.toHaveBeenCalled();

    rerender(host, { ...base, retryAvailable: true });
    expect(buttonNamed(host, "Retry analysis")).not.toBeNull();
    expect(host.textContent).toContain(
      "Retry prepares the evidence again. AI analysis requires your confirmation.",
    );
    expect(onRetry).not.toHaveBeenCalled();
    act(() => buttonNamed(host, "Retry analysis").click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not promise a future notification after drafts are ready", () => {
    const host = mount(statusProps("ready-to-review"));
    expect(host.textContent).toContain("Analysis ready to review");
    expect(host.textContent).not.toContain(
      "we'll notify you in Achievement Library",
    );
    expect(host.textContent).toContain("Nothing has been saved");
  });

  it("does not present an unqueued import as active analysis", () => {
    const host = mount(statusProps("created"));
    expect(host.textContent).toContain("Analysis hasn’t started");
    expect(host.textContent).not.toContain(
      "Keep this tab open. Reloading or closing it discards unsaved evidence.",
    );
  });

  it.each([
    ["ready-to-review", "Analysis ready to review", "Nothing has been saved"],
    ["partial", "Partial analysis is ready", "limitations"],
    ["interrupted", "Analysis was interrupted", "checkpoint"],
    ["cancelled", "Analysis cancelled", "selected evidence remain available"],
    ["expired", "Analysis result expired", "Start a fresh analysis"],
  ] as const)(
    "renders the %s recovery or completion state honestly",
    (state, title, detail) => {
      const host = mount(statusProps(state));
      expect(host.textContent).toContain(title);
      expect(host.textContent).toContain(detail);
      expect(host.textContent).not.toMatch(
        /\b\d+%|finished in|time remaining/i,
      );
    },
  );

  it("keeps recovery controls and stage copy readable with long labels", () => {
    const host = mount(
      statusProps("analyzing", {
        stage:
          "Reading the selected repository evidence and validating the immutable snapshot revision",
        resumeAvailable: true,
        retryAvailable: true,
      }),
    );

    expect(host.textContent).toContain(
      "Reading the selected repository evidence and validating the immutable snapshot revision",
    );
    expect(host.querySelector("a[href='/library']")).not.toBeNull();
    expect(buttonNamed(host, "Cancel analysis")).not.toBeNull();
    expect(buttonNamed(host, "Retry analysis")).not.toBeNull();
    expect(buttonNamed(host, "Return to setup")).not.toBeNull();
  });
});
