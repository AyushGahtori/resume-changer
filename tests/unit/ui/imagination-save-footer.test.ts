import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ImaginationSaveFooter from "@/components/imagination-save-footer";

type FooterProps = ComponentProps<typeof ImaginationSaveFooter>;

function renderFooter(overrides: Partial<FooterProps> = {}) {
  const props: FooterProps = {
    operation: "create",
    source: "personal",
    allowResume: true,
    hasLibraryDestination: true,
    saveTo: "resume",
    canSave: true,
    isBusy: false,
    isSaving: false,
    onSaveToChange: () => {},
    onCancel: () => {},
    onSave: () => {},
    ...overrides,
  };
  return renderToStaticMarkup(createElement(ImaginationSaveFooter, props));
}

describe("Imagination Canvas save footer", () => {
  it("shows the review reminder, truthful PDF note, destination, and save actions", () => {
    const markup = renderFooter();

    expect(markup).toContain("Review the facts before accepting this draft.");
    expect(markup).toContain("Your PDF updates only after Apply changes.");
    expect(markup).toContain('aria-label="Save achievement to"');
    expect(markup).toContain("Current resume");
    expect(markup).toContain("Achievement Library");
    expect(markup).toContain("Resume and library");
    expect(markup).toContain("Cancel");
    expect(markup).toContain("Save achievement");
  });

  it("limits destinations for demo and library-only contexts", () => {
    const demoMarkup = renderFooter({ source: "demo", saveTo: "resume" });
    expect(demoMarkup).toContain("Current resume");
    expect(demoMarkup).not.toContain("Achievement Library");
    expect(demoMarkup).not.toContain("Resume and library");

    const libraryMarkup = renderFooter({
      allowResume: false,
      saveTo: "library",
    });
    expect(libraryMarkup).toContain("Achievement Library");
    expect(libraryMarkup).not.toContain("Current resume");
    expect(libraryMarkup).not.toContain("Resume and library");
  });

  it("disables saving when there is no reviewed text or destination", () => {
    const emptyMarkup = renderFooter({ canSave: false });
    expect(emptyMarkup).toContain('disabled=""');

    const unavailableMarkup = renderFooter({
      source: "demo",
      allowResume: false,
      saveTo: null,
    });
    expect(unavailableMarkup).toContain(
      "No save destination is available for this data source.",
    );
    expect(unavailableMarkup).toContain('disabled=""');
    expect(unavailableMarkup).not.toContain('aria-label="Save achievement to"');
  });

  it("keeps saving and generating states disabled and announces save errors", () => {
    expect(renderFooter({ isBusy: true })).toContain('disabled=""');
    const savingMarkup = renderFooter({ isSaving: true });
    expect(savingMarkup).toContain("Saving…");
    expect(savingMarkup).toContain('aria-busy="true"');

    const errorMarkup = renderFooter({ error: "The library is locked." });
    expect(errorMarkup).toContain('role="alert"');
    expect(errorMarkup).toContain("The library is locked.");
  });

  it("announces line review status and hides create destinations for edits", () => {
    const markup = renderFooter({
      operation: "edit",
      source: "demo",
      allowResume: false,
      saveTo: null,
      reviewStatus: "2 lines confirmed by LaTeX.",
    });

    expect(markup).toContain('role="status"');
    expect(markup).toContain("2 lines confirmed by LaTeX.");
    expect(markup).not.toContain('aria-label="Save achievement to"');
    expect(markup).toContain("Accept draft");
  });
});
