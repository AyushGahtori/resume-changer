import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ImaginationCanvasLayout from "../../../src/components/imagination-canvas-layout";

function renderLayout() {
  const slot = (name: string) => createElement("span", { key: name }, name);

  return renderToStaticMarkup(
    createElement(ImaginationCanvasLayout, {
      title: slot("title"),
      composer: slot("composer"),
      connectionCanvas: slot("connection-canvas"),
      contextLibraries: slot("context-libraries"),
      writingControls: slot("writing-controls"),
      result: slot("result"),
      footer: slot("footer"),
    }),
  );
}

describe("ImaginationCanvasLayout", () => {
  it("keeps the responsive reading order from title through save footer", () => {
    const markup = renderLayout();
    const slots = [
      ...markup.matchAll(new RegExp('data-slot="([^"]+)"', "g")),
    ].map((match) => match[1]);

    expect(markup).toContain('data-layout="responsive-two-column"');
    expect(slots).toEqual([
      "title",
      "composer",
      "connection-canvas",
      "context-libraries",
      "writing-controls",
      "result",
      "footer",
    ]);
    expect(markup).toContain('aria-label="Achievement workspace"');
    expect(markup).toContain(
      'aria-label="Writing controls and imagined result"',
    );
  });

  it("uses a two-column desktop grid that collapses without scroll traps", () => {
    const styles = readFileSync(
      new URL("../../../src/app/globals.css", import.meta.url),
      "utf8",
    );
    const layoutStyles = styles.slice(
      styles.lastIndexOf("/* Imagination Canvas responsive layout */"),
    );

    expect(layoutStyles).toContain(
      "grid-template-columns: minmax(0, 2fr) minmax(300px, 1fr);",
    );
    expect(layoutStyles).toContain("@media (max-width: 1100px)");
    expect(layoutStyles).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(layoutStyles).toContain("flex-wrap: wrap;");
    expect(layoutStyles).toContain("min-width: 0;");
    expect(layoutStyles).toContain("overflow-wrap: anywhere;");
    expect(layoutStyles).not.toContain("position: fixed;");
    expect(layoutStyles).not.toContain("overflow-y: auto;");
    expect(layoutStyles).not.toContain("height: 100dvh;");
  });
});
