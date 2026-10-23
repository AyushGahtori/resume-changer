import { JSDOM } from "jsdom";
import { act, createElement, type RefObject } from "react";
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
import type { ImaginationResultProps } from "../../../src/components/imagination-result";

let createRoot: typeof import("react-dom/client").createRoot;
let ImaginationResult: typeof import("../../../src/components/imagination-result").default;
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});

beforeAll(async () => {
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    HTMLTextAreaElement: {
      configurable: true,
      value: dom.window.HTMLTextAreaElement,
    },
    Element: { configurable: true, value: dom.window.Element },
    Node: { configurable: true, value: dom.window.Node },
    Event: { configurable: true, value: dom.window.Event },
  });
  ({ createRoot } = await import("react-dom/client"));
  ({ default: ImaginationResult } =
    await import("../../../src/components/imagination-result"));
});

afterAll(() => dom.window.close());

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Array<{ root: Root; host: HTMLDivElement }> = [];

function mount(props: ImaginationResultProps) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(ImaginationResult, props));
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

function baseProps(
  overrides: Partial<ImaginationResultProps> = {},
): ImaginationResultProps {
  return {
    status: "empty",
    text: "",
    measuredLines: null,
    targetLines: 2,
    composerRef: { current: null } as RefObject<HTMLTextAreaElement | null>,
    onTextChange: vi.fn(),
    onUseSuggestion: vi.fn(),
    onRegenerate: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  for (const { root, host } of mountedRoots.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  document.body.replaceChildren();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
  vi.restoreAllMocks();
});

describe("ImaginationResult", () => {
  it("renders empty, loading, and error states accessibly", () => {
    const empty = mount(baseProps());
    expect(empty.textContent).toContain(
      "Your imagined version will appear here after generation.",
    );
    expect(empty.querySelector("textarea")).toBeNull();

    const loading = mount(baseProps({ status: "loading" }));
    expect(loading.querySelector('[role="status"]')?.textContent).toContain(
      "Creating a suggestion",
    );
    expect(loading.querySelector('[aria-busy="true"]')).not.toBeNull();

    const error = mount(
      baseProps({
        status: "error",
        errorMessage: "The request failed. Try again.",
      }),
    );
    expect(error.querySelector('[role="alert"]')?.textContent).toContain(
      "The request failed. Try again.",
    );
    expect(buttonNamed(error, "Regenerate").disabled).toBe(false);
  });

  it("keeps the suggestion editable and reports only an actual measurement", () => {
    const onTextChange = vi.fn();
    const host = mount(
      baseProps({
        status: "ready",
        text: "Built a reliable service from connected evidence.",
        measuredLines: 2,
        onTextChange,
      }),
    );

    expect(
      host.querySelector('[aria-label="Measured by LaTeX: 2 lines"]'),
    ).not.toBeNull();
    const editor = host.querySelector("textarea");
    expect(editor?.value).toBe(
      "Built a reliable service from connected evidence.",
    );

    const setValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    if (!editor || !setValue) throw new Error("Textarea is unavailable.");
    act(() => {
      setValue.call(editor, "Edited suggestion text.");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onTextChange).toHaveBeenCalledWith("Edited suggestion text.");
    expect(host.querySelector('[aria-label^="Measured by LaTeX"]')).toBeNull();
    expect(host.textContent).toContain("Wording changed after generation.");

    const unmeasured = mount(
      baseProps({
        status: "ready",
        text: "A second suggestion.",
        measuredLines: null,
      }),
    );
    expect(
      unmeasured.querySelector('[aria-label^="Measured by LaTeX"]'),
    ).toBeNull();
    expect(unmeasured.textContent).toContain("Estimated until compiled.");
  });

  it("shows the server warning and flags a measured target miss", () => {
    const serverWarning =
      "Line count could not be compiled. Final fit will be checked on Apply.";
    const unmeasured = mount(
      baseProps({
        status: "ready",
        text: "A suggestion without a compile result.",
        layoutWarning: serverWarning,
      }),
    );
    expect(unmeasured.textContent).toContain(serverWarning);

    const targetMiss = mount(
      baseProps({
        status: "ready",
        text: "A longer suggestion.",
        measuredLines: 3,
        targetLines: 2,
      }),
    );
    expect(
      targetMiss.querySelector('[aria-label="Measured by LaTeX: 3 lines"]'),
    ).not.toBeNull();
    expect(targetMiss.textContent).toContain("above the selected line target");
  });

  it("uses the suggestion, returns focus to the composer, and regenerates", () => {
    const composer = document.createElement("textarea");
    document.body.append(composer);
    const composerRef = {
      current: composer,
    } as RefObject<HTMLTextAreaElement | null>;
    const onUseSuggestion = vi.fn();
    const onRegenerate = vi.fn();
    const text = "Reviewed achievement text.";
    const host = mount(
      baseProps({
        status: "ready",
        text,
        composerRef,
        onUseSuggestion,
        onRegenerate,
      }),
    );

    act(() => buttonNamed(host, "Use suggestion in editor").click());
    expect(onUseSuggestion).toHaveBeenCalledWith(text);
    expect(document.activeElement).toBe(composer);

    act(() => buttonNamed(host, "Regenerate").click());
    expect(onRegenerate).toHaveBeenCalledTimes(1);
    composer.remove();
  });

  it("confirms a successful copy and explains when clipboard access is unavailable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    document.body.replaceChildren();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const text = "Copy this reviewed suggestion.";
    const successfulCopy = mount(baseProps({ status: "ready", text }));

    await act(async () => {
      buttonNamed(successfulCopy, "Copy").click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith(text);
    expect(successfulCopy.textContent).toContain("Copied to clipboard.");

    document.body.replaceChildren();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    const unavailableCopy = mount(baseProps({ status: "ready", text }));
    await act(async () => {
      buttonNamed(unavailableCopy, "Copy").click();
      await Promise.resolve();
    });
    expect(unavailableCopy.textContent).toContain(
      "Clipboard unavailable. Select the suggestion and copy it manually.",
    );
  });
});
