"use client";

import { useState } from "react";
import type { ProcessedScreenshot } from "../../../../lib/github/context-screenshots/contracts";
import { ContextScreenshots } from "../context-screenshots";

export function ContextScreenshotsHarness() {
  const [images, setImages] = useState<ProcessedScreenshot[]>([]);
  const [consentRevision, setConsentRevision] = useState(0);

  return (
    <main style={{ maxWidth: 760, margin: "32px auto", padding: 20 }}>
      <ContextScreenshots
        images={images}
        onChange={setImages}
        onConsentInvalidated={() => setConsentRevision((value) => value + 1)}
      />
      <output data-testid="screenshot-count" aria-live="polite">
        {images.length}
      </output>
      <output data-testid="consent-revision">{consentRevision}</output>
      <output data-testid="provider-calls">0</output>
    </main>
  );
}
