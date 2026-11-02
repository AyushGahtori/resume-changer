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
  ImportQuestion,
  MeasurementAnswer,
  MeasurementFieldsProps,
  MeasurementResult,
} from "../../../../src/lib/github/contracts";
import { METRIC_CATALOG } from "../../../../src/lib/github/measurement-catalog";

let createRoot: typeof import("react-dom/client").createRoot;
let MeasurementFields: typeof import("../../../../src/components/github-import/measurement-fields").MeasurementFields;

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});
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
    HTMLSelectElement: {
      configurable: true,
      value: dom.window.HTMLSelectElement,
    },
    Element: { configurable: true, value: dom.window.Element },
    Node: { configurable: true, value: dom.window.Node },
    Event: { configurable: true, value: dom.window.Event },
  });
  ({ createRoot } = await import("react-dom/client"));
  ({ MeasurementFields } =
    await import("../../../../src/components/github-import/measurement-fields"));
});

afterAll(() => dom.window.close());

const mountedRoots: Array<{ root: Root; host: HTMLDivElement }> = [];

afterEach(() => {
  for (const mounted of mountedRoots.splice(0)) {
    act(() => mounted.root.unmount());
    mounted.host.remove();
  }
});

function metricChoice(id: string, label: string) {
  return `metric:${id} — ${label}`;
}

const apiDefinition = METRIC_CATALOG.find(
  (definition) => definition.id === "web.api-latency.p95",
)!;
const publishDefinition = METRIC_CATALOG.find(
  (definition) => definition.id === "web.publish-latency.p95",
)!;
const accuracyDefinition = METRIC_CATALOG.find(
  (definition) => definition.id === "ml.classification.accuracy",
)!;
const macroF1Definition = METRIC_CATALOG.find(
  (definition) => definition.id === "ml.classification.macro-f1",
)!;

function publicId(definitionId: string) {
  return `metric-${definitionId
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()}`;
}

const modeChoices = [
  "Yes, I have a result",
  "There is a report to review",
  "Help me measure it",
  "Continue without a number",
  "Set a future target",
];

function question(overrides: Partial<ImportQuestion> = {}): ImportQuestion {
  return {
    id: "measurement-question",
    version: 2,
    draftId: "draft-measurement",
    kind: "measurement",
    prompt: "Did you measure a result for this contribution?",
    required: false,
    definitionId: publicId(apiDefinition.id),
    choices: [
      ...modeChoices,
      metricChoice(publicId(apiDefinition.id), apiDefinition.label),
      metricChoice(publicId(publishDefinition.id), publishDefinition.label),
      metricChoice(publicId(accuracyDefinition.id), accuracyDefinition.label),
      metricChoice(publicId(macroF1Definition.id), macroF1Definition.label),
    ],
    answered: false,
    ...overrides,
  };
}

function measuredAnswer(
  overrides: Partial<MeasurementAnswer> = {},
): MeasurementAnswer {
  return {
    questionId: "measurement-question",
    version: 1,
    mode: "result",
    originalValues: [245],
    originalUnits: ["ms"],
    definitionId: publicId(apiDefinition.id),
    statistic: "p95",
    context: {
      capabilityId: "web-api",
      taskType: "web-api",
      endpoint: "/summary",
      workload: "10 requests per second",
      environment: "repeatable load test",
      averagingMode: "none",
      sourceDescription: "Recorded load-test report, run 14",
    },
    sourceEvidenceIds: [],
    attestation: "measured",
    answerHash: "a".repeat(64),
    ...overrides,
  };
}

function serverPreview(
  overrides: Partial<MeasurementResult> = {},
): MeasurementResult {
  return {
    id: "latency-result",
    definitionId: publicId(apiDefinition.id),
    version: 1,
    originalValues: [245],
    originalUnits: ["ms"],
    normalizedValues: [245],
    normalizedUnit: "ms",
    context: {
      endpoint: "/summary",
      workload: "10 requests per second",
      environment: "repeatable load test",
    },
    evidenceStatus: "measured",
    formulaVersion: null,
    roundingPolicy: null,
    derivedQuantity: null,
    rendererId: "duration-absolute.v1",
    previewHash: "b".repeat(64),
    confirmed: false,
    ...overrides,
  };
}

function baseProps(
  overrides: Partial<MeasurementFieldsProps> = {},
): MeasurementFieldsProps {
  return {
    questions: [question()],
    answers: {},
    validation: {},
    previews: {},
    onAnswer: vi.fn(),
    onSkip: vi.fn(),
    onDefer: vi.fn(),
    ...overrides,
  };
}

function mount(props: MeasurementFieldsProps) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(MeasurementFields, props)));
  mountedRoots.push({ root, host });
  return host;
}

function buttonStarting(host: HTMLElement, label: string) {
  const button = [...host.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.replace(/\s+/g, " ").trim().startsWith(label),
  );
  if (!button) throw new Error(`Missing button starting with: ${label}`);
  return button;
}

function click(host: HTMLElement, selectorOrLabel: string) {
  const element =
    selectorOrLabel.startsWith("[") || selectorOrLabel.startsWith("#")
      ? host.querySelector<HTMLElement>(selectorOrLabel)
      : buttonStarting(host, selectorOrLabel);
  if (!element) throw new Error(`Missing element: ${selectorOrLabel}`);
  act(() => element.click());
}

function changeValue(host: HTMLElement, selector: string, value: string) {
  const element = host.querySelector<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >(selector);
  if (!element) throw new Error(`Missing field: ${selector}`);
  const prototype = Object.getPrototypeOf(element) as object;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  act(() => {
    element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    element.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}

describe("MeasurementFields", () => {
  it("keeps measurement optional and shows the short answer choices before fields", () => {
    const host = mount(
      baseProps({ questions: [question({ definitionId: null })] }),
    );

    expect(
      host.querySelector('[data-testid="measurement-expand"]'),
    ).not.toBeNull();
    expect(host.querySelector("input[type=number]")).toBeNull();

    click(host, '[data-testid="measurement-expand"]');

    expect(buttonStarting(host, "Yes, I have a result")).toBeTruthy();
    expect(buttonStarting(host, "There is a report to review")).toBeTruthy();
    expect(buttonStarting(host, "Help me measure it")).toBeTruthy();
    expect(buttonStarting(host, "Continue without a number")).toBeTruthy();
    expect(host.querySelector("input[type=number]")).toBeNull();
  });

  it("opens web fields only after choosing a result and keeps endpoint timing explicit", () => {
    const host = mount(baseProps());
    click(host, '[data-testid="measurement-expand"]');
    click(host, "Yes, I have a result");

    expect(host.querySelector("#measurement-question-endpoint")).not.toBeNull();
    expect(
      host.querySelector("#measurement-question-environment"),
    ).not.toBeNull();
    expect(host.textContent).toContain("p95 API latency");
    expect(host.textContent).toContain("not end-to-end browser latency");
    expect(
      host.querySelector("#measurement-question-statistic")?.textContent,
    ).toContain("p95");
    expect(host.textContent).toContain("I measured it in a run");
    expect(host.textContent).toContain("User-attested");
  });

  it("does not treat an ambiguous 0.92 score as accuracy before a metric is selected", () => {
    const host = mount(
      baseProps({ questions: [question({ definitionId: null })] }),
    );
    click(host, '[data-testid="measurement-expand"]');
    click(host, "Yes, I have a result");

    const metricSelect = host.querySelector<HTMLSelectElement>(
      "#measurement-question-metric",
    );
    expect(metricSelect?.value).toBe("");
    expect(host.textContent).toContain("0.92 is ambiguous");
    expect(
      host.querySelector("#measurement-question-observation-value"),
    ).toBeNull();

    changeValue(
      host,
      "#measurement-question-metric",
      publicId(macroF1Definition.id),
    );

    expect(host.textContent).toContain("macro-F1 score");
    expect(
      host.querySelector("#measurement-question-averaging")?.textContent,
    ).toContain("macro");
    expect(
      host.querySelector<HTMLInputElement>(
        "#measurement-question-observation-value",
      )?.value,
    ).toBe("");
  });

  it("keeps invalid comparison values attached to their fields and does not submit them", () => {
    const onAnswer = vi.fn<MeasurementFieldsProps["onAnswer"]>();
    const host = mount(baseProps({ onAnswer }));
    click(host, '[data-testid="measurement-expand"]');
    click(host, "Yes, I have a result");
    click(host, "Add a comparable baseline");
    changeValue(host, "#measurement-question-baseline-value", "-4");
    changeValue(host, "#measurement-question-baseline-unit", "ms");
    changeValue(host, "#measurement-question-observation-value", "245");
    changeValue(host, "#measurement-question-observation-unit", "ms");
    changeValue(host, "#measurement-question-endpoint", "/summary");
    changeValue(
      host,
      "#measurement-question-workload",
      "10 requests per second",
    );
    changeValue(
      host,
      "#measurement-question-environment",
      "repeatable load test",
    );
    changeValue(host, "#measurement-question-sourceDescription", "Run 14");
    click(host, "Preview measurement");

    expect(host.textContent).toContain("The normalized value must be between");
    expect(
      host
        .querySelector("#measurement-question-baseline-value")
        ?.getAttribute("aria-invalid"),
    ).toBe("true");
    expect(
      host
        .querySelector("#measurement-question-observation-value")
        ?.getAttribute("aria-invalid"),
    ).toBe("false");
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("marks target values as future-only and never renders them as achieved previews", () => {
    const target = measuredAnswer({
      mode: "target",
      originalValues: [200],
      attestation: "target",
      answerHash: "c".repeat(64),
    });
    const host = mount(
      baseProps({
        questions: [question({ answered: true })],
        answers: { "measurement-question": target },
        previews: { "measurement-question": serverPreview() },
      }),
    );

    expect(
      host.querySelector('[data-testid="measurement-target-state"]')
        ?.textContent,
    ).toContain("never preview as an achieved metric");
    expect(
      host.querySelector('[data-testid="measurement-server-preview"]'),
    ).toBeNull();
  });

  it("completes qualitatively on skip and defers measurement help without a provider call", () => {
    const onSkip = vi.fn<MeasurementFieldsProps["onSkip"]>();
    const onDefer = vi.fn<MeasurementFieldsProps["onDefer"]>();
    const skipHost = mount(baseProps({ onSkip }));
    click(skipHost, '[data-testid="measurement-expand"]');
    click(skipHost, "Continue without a number");

    expect(onSkip).toHaveBeenCalledWith("measurement-question", 2);
    expect(skipHost.textContent).toContain("Qualitative point stays complete");
    expect(skipHost.textContent).toContain(
      "No number or unfinished template text is needed.",
    );

    const helpHost = mount(
      baseProps({
        questions: [question({ definitionId: null })],
        onDefer,
      }),
    );
    click(helpHost, '[data-testid="measurement-expand"]');
    click(helpHost, "Help me measure it");

    expect(onDefer).toHaveBeenCalledWith("measurement-question", 2);
    expect(helpHost.textContent).toContain(
      "will not run tests or create a result",
    );
    changeValue(
      helpHost,
      "#measurement-question-help-metric",
      publicId(publishDefinition.id),
    );
    expect(
      helpHost.querySelector('[data-testid="measurement-recipe"]')?.textContent,
    ).toContain("Measure a publishing flow");
    expect(helpHost.textContent).toContain(
      "Compare against a baseline only when the operation and conditions are comparable.",
    );
  });

  it("does not claim measurement help was saved when an asynchronous mutation fails", async () => {
    let finish!: (value: boolean) => void;
    const onDefer = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const host = mount(baseProps({ onDefer }));
    click(host, '[data-testid="measurement-expand"]');
    click(host, "Help me measure it");
    expect(host.textContent).not.toContain("Measurement help saved for later");
    expect(host.textContent).toContain("Saving your answer");
    await act(async () => {
      finish(false);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).not.toContain("Measurement help saved for later");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "could not be saved",
    );
    expect(buttonStarting(host, "Help me measure it")?.disabled).toBe(false);
  });

  it("shows a server preview only for the current answer and invalidates it on edits", () => {
    const host = mount(
      baseProps({
        questions: [question({ answered: true })],
        answers: { "measurement-question": measuredAnswer() },
        previews: { "measurement-question": serverPreview() },
      }),
    );

    expect(
      host.querySelector('[data-testid="measurement-server-preview"]'),
    ).not.toBeNull();

    changeValue(host, "#measurement-question-endpoint", "/other-endpoint");

    expect(
      host.querySelector('[data-testid="measurement-server-preview"]'),
    ).toBeNull();
    expect(
      host.querySelector('[data-testid="measurement-local-preview"]'),
    ).not.toBeNull();
    expect(host.textContent).toContain("pending server review");
  });

  it("preserves answer fields and submits the frozen answer with a fresh versioned hash", async () => {
    const onAnswer = vi.fn<MeasurementFieldsProps["onAnswer"]>();
    const host = mount(
      baseProps({
        questions: [question({ answered: true })],
        answers: { "measurement-question": measuredAnswer() },
        previews: { "measurement-question": serverPreview() },
        onAnswer,
      }),
    );
    click(host, "Change answer");
    click(host, "Yes, I have a result");
    expect(
      host.querySelector<HTMLInputElement>(
        "#measurement-question-observation-value",
      )?.value,
    ).toBe("245");
    expect(
      host.querySelector<HTMLInputElement>(
        "#measurement-question-sourceDescription",
      )?.value,
    ).toContain("run 14");
    click(host, "Preview measurement");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onAnswer).toHaveBeenCalledTimes(1);
    const [questionId, submitted] = onAnswer.mock.calls[0];
    expect(questionId).toBe("measurement-question");
    expect(submitted).toMatchObject({
      questionId,
      version: 2,
      mode: "result",
      originalValues: [245],
      originalUnits: ["ms"],
      definitionId: publicId(apiDefinition.id),
      attestation: "measured",
    });
    expect(submitted.answerHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
