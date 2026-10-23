import React, { type ReactNode } from "react";

export type ImaginationCanvasLayoutProps = {
  title: ReactNode;
  composer: ReactNode;
  connectionCanvas: ReactNode;
  contextLibraries: ReactNode;
  writingControls: ReactNode;
  result: ReactNode;
  footer: ReactNode;
};

export default function ImaginationCanvasLayout({
  title,
  composer,
  connectionCanvas,
  contextLibraries,
  writingControls,
  result,
  footer,
}: ImaginationCanvasLayoutProps) {
  return (
    <div
      className="imagination-canvas-layout"
      data-layout="responsive-two-column"
    >
      <div className="imagination-canvas-layout__columns">
        <section
          aria-label="Achievement workspace"
          className="imagination-canvas-layout__workspace"
        >
          <header
            className="imagination-canvas-layout__title"
            data-slot="title"
          >
            {title}
          </header>
          <div
            className="imagination-canvas-layout__composer"
            data-slot="composer"
          >
            {composer}
          </div>
          <div
            className="imagination-canvas-layout__connection-canvas"
            data-slot="connection-canvas"
          >
            {connectionCanvas}
          </div>
          <div
            className="imagination-canvas-layout__context-libraries"
            data-slot="context-libraries"
          >
            {contextLibraries}
          </div>
        </section>

        <aside
          aria-label="Writing controls and imagined result"
          className="imagination-canvas-layout__writing-panel"
        >
          <div
            className="imagination-canvas-layout__writing-controls"
            data-slot="writing-controls"
          >
            {writingControls}
          </div>
          <div className="imagination-canvas-layout__result" data-slot="result">
            {result}
          </div>
        </aside>
      </div>

      <footer className="imagination-canvas-layout__footer" data-slot="footer">
        {footer}
      </footer>
    </div>
  );
}
