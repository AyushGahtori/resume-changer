import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { ImportLayout } from "../../../../src/components/github-import/import-layout";

function slot(name: string) {
  return createElement("span", { "data-fixture-slot": name }, name);
}

function renderLayout(
  options: {
    state?: "setup" | "analysis" | "review";
    rail?: ReturnType<typeof slot> | null;
    actions?: ReturnType<typeof slot> | null;
  } = {},
) {
  const markup = renderToStaticMarkup(
    createElement(ImportLayout, {
      header: slot("header"),
      progress: slot("progress"),
      main: slot("main"),
      rail: options.rail === undefined ? slot("rail") : options.rail,
      actions:
        options.actions === undefined ? slot("actions") : options.actions,
      state: options.state ?? "review",
    }),
  );
  return new JSDOM(markup).window.document;
}

describe("ImportLayout", () => {
  it("keeps the named slots in the reading order and exposes the current state", () => {
    const document = renderLayout();
    const root = document.querySelector('[data-testid="github-import-layout"]');

    expect(root?.getAttribute("data-state")).toBe("review");
    expect(
      Array.from(root?.querySelectorAll("[data-slot]") ?? []).map((element) =>
        element.getAttribute("data-slot"),
      ),
    ).toEqual(["header", "progress", "main", "rail", "actions"]);
    expect(document.querySelector("header")?.textContent).toBe("header");
    expect(
      document.querySelector('[data-slot="main"]')?.getAttribute("aria-label"),
    ).toBe("GitHub import workspace");
    expect(document.querySelector("aside")?.textContent).toContain("rail");
    expect(
      document
        .querySelector('[data-slot="actions"]')
        ?.getAttribute("aria-label"),
    ).toBe("Import actions");
  });

  it("supports the three frozen visible states without changing slot ownership", () => {
    for (const state of ["setup", "analysis", "review"] as const) {
      const document = renderLayout({ state });
      expect(
        document
          .querySelector('[data-testid="github-import-layout"]')
          ?.getAttribute("data-state"),
      ).toBe(state);
      expect(document.querySelector('[data-slot="main"]')?.textContent).toBe(
        "main",
      );
    }
  });

  it("omits an unused supporting column when the optional slots are empty", () => {
    const document = renderLayout({ rail: null, actions: null });

    expect(document.querySelector("aside")).toBeNull();
    expect(document.querySelector('[data-slot="rail"]')).toBeNull();
    expect(document.querySelector('[data-slot="actions"]')).toBeNull();
    expect(document.querySelector('[data-slot="main"]')?.textContent).toBe(
      "main",
    );
  });

  it("keeps actions reachable when the rail has no content", () => {
    const document = renderLayout({ rail: null });

    expect(document.querySelector("aside")).not.toBeNull();
    expect(document.querySelector('[data-slot="rail"]')).toBeNull();
    expect(document.querySelector('[data-slot="actions"]')?.textContent).toBe(
      "actions",
    );
  });
});
