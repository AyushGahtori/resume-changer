import { Check, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  EvidenceChip,
  ImportButton,
  ImportInfoBanner,
  ImportStatusPill,
} from "../../../../src/components/github-import/import-primitives";
import "../../../../src/components/github-import/import-tokens.css";
import "./styles.css";

function PrimitiveFixture() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [saveCount, setSaveCount] = useState(0);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <main className="fixture">
      <header className="fixtureHeader">
        <div>
          <p className="eyebrow">GitHub import</p>
          <h1>Review before saving</h1>
          <p className="lead">
            Check source-backed drafts, then choose exactly what to save.
          </p>
        </div>
        <div aria-label="Theme" className="themeControls" role="group">
          <button
            aria-pressed={theme === "light"}
            onClick={() => setTheme("light")}
            type="button"
          >
            Light theme
          </button>
          <button
            aria-pressed={theme === "dark"}
            onClick={() => setTheme("dark")}
            type="button"
          >
            Dark theme
          </button>
        </div>
      </header>

      <ImportInfoBanner
        title="Nothing is saved automatically."
        description="Review every draft and explicitly save selected achievements to your library."
        tone="info"
      />

      <section aria-labelledby="buttons-heading" className="fixtureSection">
        <div className="sectionHeading">
          <h2 id="buttons-heading">Actions</h2>
          <span className="sectionNote">44px minimum touch target</span>
        </div>
        <div className="buttonRow">
          <ImportButton
            icon={<Check size={16} />}
            label="Save selected achievements"
            onClick={() => setSaveCount((count) => count + 1)}
            variant="primary"
          />
          <ImportButton
            icon={<RefreshCw size={16} />}
            label="Regenerate drafts"
            variant="secondary"
          />
          <ImportButton
            error
            icon={<Trash2 size={16} />}
            label="Reject all drafts"
            variant="destructive"
          />
          <ImportButton label="More options" variant="quiet" />
        </div>
        <div className="buttonRow">
          <ImportButton busy label="Analyze repository" variant="primary" />
          <ImportButton
            disabled
            label="Continue without PRs"
            variant="secondary"
          />
          <ImportButton error label="Retry analysis" variant="secondary" />
          <ImportButton
            busy={pending}
            label="Refresh repository snapshot"
            onClick={() => setPending(true)}
            variant="secondary"
          />
        </div>
        <p aria-live="polite" className="actionResult" data-testid="save-count">
          Saved activation count: {saveCount}
        </p>
      </section>

      <section aria-labelledby="status-heading" className="fixtureSection">
        <div className="sectionHeading">
          <h2 id="status-heading">Evidence status</h2>
          <span className="sectionNote">Read-only classifications</span>
        </div>
        <div className="chipRow">
          <ImportStatusPill
            evidenceStatus="supported"
            label="Supported by evidence"
            state="ready-to-review"
          />
          <ImportStatusPill
            evidenceStatus="needs-context"
            label="Needs context"
            state="ready-to-review"
          />
          <ImportStatusPill
            evidenceStatus="inference"
            label="Inference"
            state="ready-to-review"
          />
          <ImportStatusPill label="Analysis failed" state="failed" />
        </div>
      </section>

      <section aria-labelledby="evidence-heading" className="fixtureSection">
        <div className="sectionHeading">
          <h2 id="evidence-heading">Evidence</h2>
          <span className="sectionNote">Files and source states</span>
        </div>
        <div className="chipRow">
          <EvidenceChip
            category="implementation"
            label="src/features/publishing/create-scheduled-post.ts"
            state="included"
          />
          <EvidenceChip
            category="documentation"
            label="README.md"
            state="pinned"
          />
          <EvidenceChip category="test" label="unsafe.env" state="blocked" />
        </div>
      </section>

      <section aria-labelledby="messages-heading" className="fixtureSection">
        <div className="sectionHeading">
          <h2 id="messages-heading">Messages</h2>
          <span className="sectionNote">Semantic tone and text</span>
        </div>
        <div className="bannerStack">
          <ImportInfoBanner
            title="Analysis needs context."
            description="Choose a contribution scope before continuing."
            tone="warning"
          />
          <ImportInfoBanner
            title="Analysis could not finish."
            description="Try again after checking the repository access."
            tone="error"
          />
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<PrimitiveFixture />);
