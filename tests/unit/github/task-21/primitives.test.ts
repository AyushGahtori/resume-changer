// @vitest-environment jsdom

import { act, createElement, Fragment, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EvidenceChip,
  ImportButton,
  ImportInfoBanner,
  ImportStatusPill,
} from "../../../../src/components/github-import/import-primitives";

let container: HTMLDivElement;
let root: Root;

function PendingAction({ onAction }: { onAction: () => void }) {
  const [busy, setBusy] = useState(false);

  return createElement(ImportButton, {
    label: "Analyze repository",
    busy,
    onClick: () => {
      onAction();
      setBusy(true);
    },
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(children: ReactNode) {
  act(() => root.render(children));
}

describe("GitHub import primitives", () => {
  it("fires an enabled action once and preserves its action label", () => {
    const onClick = vi.fn();

    render(
      createElement(ImportButton, {
        label: "Save selected achievements",
        variant: "primary",
        onClick,
      }),
    );

    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    expect(button?.textContent).toBe("Save selected achievements");
    expect(button?.getAttribute("type")).toBe("button");

    act(() => button?.click());

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("prevents disabled and pending actions from firing", () => {
    const onClick = vi.fn();

    render(
      createElement(
        Fragment,
        null,
        createElement(ImportButton, {
          label: "Continue",
          disabled: true,
          onClick,
        }),
        createElement(ImportButton, {
          label: "Analyze repository",
          busy: true,
          onClick,
        }),
      ),
    );

    const [disabledButton, pendingButton] =
      container.querySelectorAll("button");

    expect(disabledButton.disabled).toBe(true);
    expect(pendingButton.disabled).toBe(true);
    expect(pendingButton.getAttribute("aria-busy")).toBe("true");
    expect(pendingButton.textContent).toContain("Analyze repository");
    expect(pendingButton.getAttribute("data-state")).toBe("pending");

    act(() => {
      disabledButton.click();
      pendingButton.click();
    });

    expect(onClick).not.toHaveBeenCalled();
  });

  it("does not activate again after an action enters its pending state", () => {
    const onAction = vi.fn();

    render(createElement(PendingAction, { onAction }));
    const button = container.querySelector("button");

    act(() => button?.click());
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute("aria-busy")).toBe("true");

    act(() => button?.click());
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("exposes an accessible name and stable destructive error state", () => {
    render(
      createElement(ImportButton, {
        label: "Remove all drafts",
        ariaLabel: "Reject all GitHub drafts",
        error: true,
        variant: "destructive",
      }),
    );

    const button = container.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("Reject all GitHub drafts");
    const describedBy = button?.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? "")?.textContent).toBe(
      "This action needs attention.",
    );
    expect(button?.getAttribute("data-variant")).toBe("destructive");
    expect(button?.getAttribute("data-state")).toBe("error");
  });

  it("renders supported, needs-context, and inference as distinct read-only statuses", () => {
    render(
      createElement(
        Fragment,
        null,
        createElement(ImportStatusPill, {
          state: "ready-to-review",
          label: "Supported by evidence",
          evidenceStatus: "supported",
        }),
        createElement(ImportStatusPill, {
          state: "ready-to-review",
          label: "Needs context",
          evidenceStatus: "needs-context",
        }),
        createElement(ImportStatusPill, {
          state: "ready-to-review",
          label: "Inference",
          evidenceStatus: "inference",
        }),
      ),
    );

    const pills = Array.from(container.querySelectorAll("[data-status]"));
    expect(pills.map((pill) => pill.textContent)).toEqual([
      "Supported by evidence",
      "Needs context",
      "Inference",
    ]);
    expect(pills.map((pill) => pill.getAttribute("data-tone"))).toEqual([
      "positive",
      "warning",
      "accent",
    ]);
    expect(container.querySelector("select, input")).toBeNull();
  });

  it("announces errors and marks blocked evidence in text as well as color", () => {
    render(
      createElement(
        Fragment,
        null,
        createElement(ImportInfoBanner, {
          title: "Analysis failed",
          description: "The repository could not be analyzed.",
          tone: "error",
        }),
        createElement(EvidenceChip, {
          label: "unsafe.env",
          category: "other",
          state: "blocked",
        }),
      ),
    );

    const banner = container.querySelector('[role="alert"]');
    const chip = container.querySelector('[data-state="blocked"]');
    expect(banner?.getAttribute("aria-live")).toBe("assertive");
    expect(banner?.textContent).toContain("Analysis failed");
    expect(chip?.textContent).toContain("unsafe.env");
    expect(chip?.textContent).toContain("Excluded");
    expect(chip?.querySelector("svg")).not.toBeNull();
  });
});
