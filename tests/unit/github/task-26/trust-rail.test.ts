// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportTrustRail } from "@/components/github-import/trust-rail";
import { trustRailProps } from "@/components/github-import/testing/fixtures";
import type { ImportTrustRailProps } from "@/lib/github/contracts";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

type Mounted = {
  container: HTMLDivElement;
  rerender(props: ImportTrustRailProps): void;
  unmount(): void;
};

function mount(props: ImportTrustRailProps): Mounted {
  const container = document.createElement("div");
  document.body.append(container);
  const root: Root = createRoot(container);

  act(() => {
    root.render(createElement(ImportTrustRail, props));
  });

  return {
    container,
    rerender(nextProps) {
      act(() => {
        root.render(createElement(ImportTrustRail, nextProps));
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const mounted: Mounted[] = [];

afterEach(() => {
  mounted.splice(0).forEach((item) => item.unmount());
});

describe("ImportTrustRail", () => {
  it("renders server-reported counts and keeps unavailable run facts unknown", () => {
    const props = trustRailProps();
    const view = mount(props);
    mounted.push(view);

    expect(view.container.querySelectorAll("section")).toHaveLength(3);
    expect(view.container.textContent).toContain("Privacy & boundaries");
    expect(view.container.textContent).toContain("Run summary");
    expect(view.container.textContent).toContain(
      "0123456789abcdef0123456789abcdef01234567",
    );
    expect(view.container.textContent).toContain("3 files");
    expect(view.container.textContent).toContain("7,400 tokens");
    expect(view.container.textContent).toContain("Repository");
    expect(view.container.textContent).toContain("Not included");
    expect(view.container.textContent).toContain("AI model");
    expect(view.container.textContent).toContain("Not reported");
    expect(view.container.textContent).toContain("Unknown");
    expect(view.container.textContent).not.toContain("$0.02");
    expect(view.container.textContent).not.toContain("GPT-4o");
    expect(view.container.textContent).toContain(
      "does not certify that excluded repository content was never inspected",
    );
  });

  it("shows usage, cost and budget limits without treating estimates as reported values", () => {
    const props = trustRailProps();
    props.budget = {
      ...props.budget,
      estimatedInputTokens: 7_400,
      reportedInputTokens: null,
      selectedUniqueFiles: 15,
    };
    props.cost = {
      estimate: 0.0123,
      currency: "USD",
      uncertainty: "Estimate only; provider billing has not been reported.",
    };
    const view = mount(props);
    mounted.push(view);

    expect(
      view.container.querySelector('[data-budget-state="near"]'),
    ).not.toBeNull();
    expect(view.container.textContent).toContain("Near a configured limit");
    expect(view.container.textContent).toContain("Reported: Not reported");
    expect(view.container.textContent).toContain("$0.0123");
    expect(view.container.textContent).toContain("Estimate only");
  });

  it("marks a partial run, explains zero eligibility, and disables saving", () => {
    const props = trustRailProps(true);
    const view = mount(props);
    mounted.push(view);
    const save = view.container.querySelector<HTMLButtonElement>(
      '[data-testid="trust-save"]',
    );

    expect(
      view.container.querySelector('[data-budget-state="partial"]'),
    ).not.toBeNull();
    expect(view.container.textContent).toContain("Partial scope");
    expect(view.container.textContent).toContain("0 eligible");
    expect(view.container.textContent).toContain(
      "No selected drafts are eligible yet.",
    );
    expect(save?.disabled).toBe(true);
  });

  it("disables saving when eligibility exceeds the selected count", () => {
    const props = {
      ...trustRailProps(),
      selectedCount: 1,
      eligibleCount: 2,
    };
    const view = mount(props);
    mounted.push(view);

    expect(
      view.container.querySelector<HTMLButtonElement>(
        '[data-testid="trust-save"]',
      )?.disabled,
    ).toBe(true);
    expect(view.container.textContent).toContain(
      "eligibility count needs review",
    );
  });

  it("dispatches one save per pending attempt and permits a retry after failure", () => {
    const onSave = vi.fn();
    const props = { ...trustRailProps(), onSave };
    const view = mount(props);
    mounted.push(view);
    const save = view.container.querySelector<HTMLButtonElement>(
      '[data-testid="trust-save"]',
    );

    act(() => {
      save?.click();
      save?.click();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(save?.disabled).toBe(true);
    expect(view.container.textContent).toContain(
      "Saving the eligible selections",
    );

    view.rerender({
      ...props,
      saveState: "error",
      errors: [
        {
          code: "io-error",
          message: "The staged library could not be updated.",
          retryable: true,
        },
      ],
    });
    expect(view.container.textContent).toContain(
      "The staged library could not be updated.",
    );
    expect(view.container.textContent).toContain("1 selected");
    expect(
      view.container.querySelector('[data-testid="trust-save"]')?.textContent,
    ).toContain("Save selected achievements");

    act(() => {
      view.container
        .querySelector<HTMLButtonElement>('[data-testid="trust-save"]')
        ?.click();
    });
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("reports only the confirmed saved count and does not invent saved draft names", () => {
    const props = {
      ...trustRailProps(),
      selectedCount: 3,
      eligibleCount: 2,
      saveState: "saved" as const,
    };
    const view = mount(props);
    mounted.push(view);

    expect(view.container.textContent).toContain(
      "2 achievements saved to Achievement Library",
    );
    expect(view.container.textContent).not.toContain("Draft 1");
    expect(
      view.container.querySelector<HTMLButtonElement>(
        '[data-testid="trust-save"]',
      )?.disabled,
    ).toBe(true);
  });

  it("confirms staged discard inline and never mixes it with save or back", () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    const onBack = vi.fn();
    const props = { ...trustRailProps(), onSave, onDiscard, onBack };
    const view = mount(props);
    mounted.push(view);

    act(() => {
      view.container
        .querySelector<HTMLButtonElement>('[data-testid="trust-discard"]')
        ?.click();
    });
    expect(onDiscard).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain(
      "Discard the staged drafts from this import?",
    );
    expect(document.activeElement).toBe(
      view.container.querySelector(
        '[aria-describedby="trust-discard-confirmation"]',
      ),
    );

    act(() => {
      view.container
        .querySelector<HTMLButtonElement>(
          '[data-testid="trust-confirm-discard"]',
        )
        ?.click();
    });
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toContain(
      "Saved achievements are not affected.",
    );
    expect(onSave).not.toHaveBeenCalled();

    act(() => {
      view.container
        .querySelector<HTMLButtonElement>('[data-testid="trust-back"]')
        ?.click();
    });
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps back navigation independent from saving, cancellation and discard", () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    const onBack = vi.fn();
    const view = mount({ ...trustRailProps(), onSave, onDiscard, onBack });
    mounted.push(view);

    act(() => {
      view.container
        .querySelector<HTMLButtonElement>('[data-testid="trust-back"]')
        ?.click();
    });

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
    expect(view.container.textContent).not.toContain("Cancel analysis");
  });

  it("keeps the page in semantic reading order and exposes a keyboard-operable budget disclosure", () => {
    const view = mount(trustRailProps());
    mounted.push(view);
    const sections = [...view.container.querySelectorAll("section")];
    const actions = [
      ...view.container.querySelectorAll(
        '[data-testid="trust-action-buttons"] button',
      ),
    ];
    const disclosure = view.container.querySelector("details > summary");

    expect(
      sections.map((section) => section.querySelector("h2")?.textContent),
    ).toEqual(["Privacy & boundaries", "Run summary", "Review before saving"]);
    expect(actions.map((button) => button.textContent?.trim())).toEqual([
      "Save selected achievements (1)",
      "Discard staged drafts",
      "Back to Achievement Library",
    ]);
    expect(disclosure?.textContent).toContain("Technical budget details");
    expect(disclosure?.getAttribute("tabindex")).toBeNull();
  });
});
