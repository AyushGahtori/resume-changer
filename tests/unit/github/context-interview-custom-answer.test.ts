import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { InterviewAnswer } from "../../../src/components/github-import/context-interview/types";

let createRoot: typeof import("react-dom/client").createRoot;
let ContextInterview: typeof import("../../../src/components/github-import/context-interview/context-interview").ContextInterview;
let createEngineInterviewPort: typeof import("../../../src/components/github-import/context-interview/engine-port").createEngineInterviewPort;

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/e2e/github-context-interview",
});
dom.window.requestAnimationFrame = (callback) =>
  dom.window.setTimeout(() => callback(0), 0);
dom.window.cancelAnimationFrame = (id) => dom.window.clearTimeout(id);
const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

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
    getComputedStyle: {
      configurable: true,
      value: dom.window.getComputedStyle.bind(dom.window),
    },
  });
  ({ createRoot } = await import("react-dom/client"));
  ({ ContextInterview } =
    await import("../../../src/components/github-import/context-interview/context-interview"));
  ({ createEngineInterviewPort } =
    await import("../../../src/components/github-import/context-interview/engine-port"));
});

afterAll(() => dom.window.close());

const mountedRoots: Array<{ root: Root; host: HTMLDivElement }> = [];

afterEach(() => {
  for (const mounted of mountedRoots.splice(0)) {
    act(() => mounted.root.unmount());
    mounted.host.remove();
  }
});

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function mount(submitted: InterviewAnswer[]) {
  const engine = createEngineInterviewPort(() => undefined);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      createElement(ContextInterview, {
        port: {
          ...engine,
          async submitAnswer(answer) {
            submitted.push(answer);
            return engine.submitAnswer(answer);
          },
        },
      }),
    );
  });
  mountedRoots.push({ root, host });
  return host;
}

function choice(host: HTMLElement, label: string) {
  const input = [...host.querySelectorAll("label")]
    .find((item) => item.textContent?.includes(label))
    ?.querySelector("input");
  if (!input) throw new Error(`Missing choice: ${label}`);
  act(() => input.click());
}

function setText(host: HTMLElement, value: string) {
  const element = host.querySelector("textarea");
  if (!element) throw new Error("Missing custom answer");
  const prototype = Object.getPrototypeOf(element) as object;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  act(() => {
    element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    element.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}

async function continueInterview(host: HTMLElement) {
  const button = [...host.querySelectorAll("button")].find((item) =>
    item.textContent?.includes("Continue"),
  );
  if (!button) throw new Error("Missing continue");
  act(() => button.click());
  await flush();
}

describe("context interview custom answers", () => {
  it("drops hidden custom text on later questions and keeps a purpose clarification", async () => {
    const submitted: InterviewAnswer[] = [];
    const host = mount(submitted);
    await flush();

    expect(host.textContent).toContain("What is this project mainly for?");
    choice(host, "Something else");
    setText(host, "Internal billing tool");
    choice(host, "A product or application for people to use");
    expect(host.querySelector("textarea")?.value).toBe("Internal billing tool");
    await continueInterview(host);
    expect(submitted[0]).toMatchObject({
      nodeId: "project.purpose",
      optionIds: ["product"],
      customAnswer: "Internal billing tool",
    });

    expect(host.textContent).toContain(
      "Which areas or capabilities are part of it?",
    );
    choice(host, "Something else");
    setText(host, "Batch jobs");
    choice(host, "Something else");
    choice(host, "Web or mobile experiences");
    expect(host.querySelector("#context-custom-answer")).toBeNull();
    await continueInterview(host);
    expect(submitted[1]).toMatchObject({
      nodeId: "project.areas",
      optionIds: ["web-mobile"],
    });
    expect(submitted[1]?.customAnswer).toBeUndefined();

    expect(host.textContent).toContain(
      "How would you describe your ownership of the project?",
    );
    choice(host, "Something else");
    setText(host, "Shared lead");
    choice(host, "I built the whole project");
    expect(host.querySelector("#context-custom-answer")).toBeNull();
    await continueInterview(host);
    expect(submitted[2]).toMatchObject({
      nodeId: "project.ownership",
      optionIds: ["whole-project"],
    });
    expect(submitted[2]?.customAnswer).toBeUndefined();
    expect(host.textContent).toContain("How did you work with other people?");
    expect(host.textContent).not.toContain(
      "Custom text is required exactly when the custom option is selected.",
    );
  });
});
