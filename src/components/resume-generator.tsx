"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  EMPTY_DRAFT,
  readDraft,
  type JobDescriptionDraft,
} from "@/lib/jd-draft";
import { createResumeFilename } from "@/lib/generation/resume-filename";
import type { ManualGenerationResult } from "@/lib/generation/manual-generation";
import type { ResumeDataSource } from "@/lib/data/loaders";
import type {
  AchievementPoint,
  ResumeLibrary,
} from "@/lib/schemas/resume-data";

type Props = {
  library: ResumeLibrary;
  source: ResumeDataSource;
};

type PointGroup = {
  id: string;
  kind: "JOB" | "PROJECT";
  title: string;
  subtitle: string;
  points: AchievementPoint[];
};

type ApiResponse = ManualGenerationResult | { error?: string };

function getPointGroups(library: ResumeLibrary): PointGroup[] {
  return [
    ...library.jobs.map((job) => ({
      id: job.id,
      kind: "JOB" as const,
      title: job.title,
      subtitle: job.company,
      points: job.points.filter((point) => point.enabled),
    })),
    ...library.projects.map((project) => ({
      id: project.id,
      kind: "PROJECT" as const,
      title: project.name,
      subtitle: project.role ?? "",
      points: project.points.filter((point) => point.enabled),
    })),
  ].filter((group) => group.points.length > 0);
}

function getSafeJobUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export default function ResumeGenerator({ library, source }: Props) {
  const [draft, setDraft] = useState<JobDescriptionDraft>(EMPTY_DRAFT);
  const [draftReady, setDraftReady] = useState(false);
  const [draftNotice, setDraftNotice] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [result, setResult] = useState<ManualGenerationResult | null>(null);
  const [requestError, setRequestError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const groups = useMemo(() => getPointGroups(library), [library]);
  const enabledIds = useMemo(
    () => groups.flatMap((group) => group.points.map((point) => point.id)),
    [groups],
  );

  useEffect(() => {
    const saved = readDraft(window.localStorage);
    setDraft(saved.draft);
    setDraftNotice(
      saved.state === "invalid"
        ? "The saved job draft could not be restored. Return to Job description and save it again."
        : saved.state === "unavailable"
          ? "Browser storage is unavailable, so no saved job draft can be used."
          : "",
    );
    setDraftReady(true);
  }, []);

  function changeSelection(id: string, checked: boolean) {
    setSelectedIds((current) =>
      checked
        ? current.includes(id)
          ? current
          : [...current, id]
        : current.filter((selectedId) => selectedId !== id),
    );
    setResult(null);
    setCopyMessage("");
    setRequestError("");
  }

  function selectAll() {
    setSelectedIds(enabledIds);
    setResult(null);
    setCopyMessage("");
    setRequestError("");
  }

  function clearSelection() {
    setSelectedIds([]);
    setResult(null);
    setCopyMessage("");
    setRequestError("");
  }

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestError("");
    setCopyMessage("");

    if (!draft.jobDescription.trim()) {
      setRequestError("Save a job description before generating a resume.");
      return;
    }
    if (selectedIds.length === 0) {
      setRequestError("Select at least one enabled achievement point.");
      return;
    }

    setIsGenerating(true);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataSource: source,
          company: draft.company,
          roleTitle: draft.roleTitle,
          jobUrl: draft.jobUrl,
          jobDescription: draft.jobDescription,
          selectedAchievementIds: selectedIds,
        }),
      });
      const payload = (await response.json()) as ApiResponse;

      if (!response.ok || !("latex" in payload)) {
        setRequestError(
          "error" in payload && payload.error
            ? payload.error
            : "The resume could not be generated. Try again.",
        );
        setResult(null);
        return;
      }

      setResult(payload);
    } catch {
      setRequestError("The server could not be reached. Try again.");
      setResult(null);
    } finally {
      setIsGenerating(false);
    }
  }

  async function copyLatex() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.latex);
      setCopyMessage("LaTeX copied.");
    } catch {
      setCopyMessage(
        "Clipboard access failed. Download the .tex file instead.",
      );
    }
  }

  function downloadLatex() {
    if (!result) return;
    const file = new Blob([result.latex], { type: "application/x-tex" });
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = createResumeFilename(
      result.metadata.company,
      result.metadata.roleTitle,
    );
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const hasJobDescription = Boolean(draft.jobDescription.trim());
  const safeJobUrl = getSafeJobUrl(draft.jobUrl);

  return (
    <section className="generation-page" aria-labelledby="page-title">
      <div className="generation-heading page-heading-row">
        <div>
          <p className="eyebrow">
            MANUAL GENERATION <span>02 / 04</span>
          </p>
          <h1 id="page-title">Build your resume.</h1>
          <p className="page-intro">
            Choose the experience you want to include, then review the LaTeX.
          </p>
        </div>
        <nav className="library-source-switch" aria-label="Resume data source">
          <Link
            aria-current={source === "personal" ? "page" : undefined}
            href="/generate"
          >
            My data
          </Link>
          <Link
            aria-current={source === "demo" ? "page" : undefined}
            href="/generate?source=demo"
          >
            Demo data
          </Link>
        </nav>
      </div>

      <div className="generation-draft" aria-live="polite">
        <div>
          <p className="generation-label">JOB DESCRIPTION</p>
          {!draftReady ? (
            <p>Loading saved job details…</p>
          ) : hasJobDescription ? (
            <>
              <strong>{draft.roleTitle || "Target role not specified"}</strong>
              {draft.company && <span>{draft.company}</span>}
              <span>
                {draft.jobDescription.length.toLocaleString()} description
                characters
              </span>
            </>
          ) : (
            <p>
              No saved job description. <Link href="/">Add job details</Link>
            </p>
          )}
        </div>
        {safeJobUrl && (
          <a href={safeJobUrl} rel="noreferrer" target="_blank">
            Open job link
          </a>
        )}
      </div>
      {draftNotice && (
        <p className="generation-notice" role="status">
          {draftNotice}
        </p>
      )}

      <form className="generation-form" onSubmit={handleGenerate}>
        <div className="generation-layout">
          <section
            className="generation-selection"
            aria-labelledby="selection-title"
          >
            <div className="generation-section-heading">
              <div>
                <h2 id="selection-title">Choose achievements</h2>
                <p>
                  {selectedIds.length} selected · {enabledIds.length} enabled
                </p>
              </div>
              <div className="generation-selection-actions">
                <button type="button" onClick={selectAll}>
                  Select all
                </button>
                <button type="button" onClick={clearSelection}>
                  Clear
                </button>
              </div>
            </div>

            {groups.length === 0 ? (
              <p className="generation-empty" role="status">
                This library has no enabled achievement points.
              </p>
            ) : (
              <div className="generation-groups">
                {groups.map((group) => (
                  <fieldset className="generation-group" key={group.id}>
                    <legend>
                      <span>{group.kind}</span>
                      <strong>{group.title}</strong>
                      {group.subtitle && <small>{group.subtitle}</small>}
                    </legend>
                    <div className="generation-points">
                      {group.points.map((point) => (
                        <label className="generation-point" key={point.id}>
                          <input
                            aria-label={`Select achievement ${point.id}`}
                            checked={selectedIds.includes(point.id)}
                            onChange={(event) =>
                              changeSelection(point.id, event.target.checked)
                            }
                            type="checkbox"
                          />
                          <span>{point.text}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
            )}
          </section>

          <section
            className="generation-preview"
            aria-labelledby="preview-title"
          >
            <div className="generation-section-heading">
              <div>
                <h2 id="preview-title">LaTeX preview</h2>
                <p>Generated from your selected points</p>
              </div>
              {result && (
                <div className="generation-output-actions">
                  <button
                    aria-label="Copy LaTeX"
                    onClick={copyLatex}
                    title="Copy LaTeX"
                    type="button"
                  >
                    Copy
                  </button>
                  <button
                    aria-label="Download LaTeX file"
                    onClick={downloadLatex}
                    title="Download LaTeX file"
                    type="button"
                  >
                    Download
                  </button>
                </div>
              )}
            </div>

            {requestError && (
              <p className="generation-error-message" role="alert">
                {requestError}
              </p>
            )}
            {copyMessage && (
              <p className="generation-notice" role="status">
                {copyMessage}
              </p>
            )}
            {result ? (
              <>
                <p className="generation-metadata" role="status">
                  Generated{" "}
                  {new Date(result.metadata.generatedAt).toLocaleString()} ·{" "}
                  {result.metadata.selectedAchievementIds.length} achievement
                  {result.metadata.selectedAchievementIds.length === 1
                    ? ""
                    : "s"}
                </p>
                <pre
                  className="latex-preview"
                  aria-label="Generated LaTeX"
                  role="region"
                >
                  <code>{result.latex}</code>
                </pre>
              </>
            ) : (
              <div className="generation-preview-empty" role="status">
                <p>Your generated LaTeX will appear here.</p>
              </div>
            )}
          </section>
        </div>

        <div className="generation-footer">
          <span>
            {source === "personal"
              ? "Using your local resume data"
              : "Using fictional demo data"}
          </span>
          <button
            className="primary-button"
            disabled={isGenerating || !draftReady}
            type="submit"
          >
            {isGenerating ? "Generating…" : "Generate LaTeX"}
          </button>
        </div>
      </form>
    </section>
  );
}
