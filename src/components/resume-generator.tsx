"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  EMPTY_DRAFT,
  readDraft,
  type JobDescriptionDraft,
} from "@/lib/jd-draft";
import {
  AchievementSelectionResponseSchema,
  type AchievementSelectionResponse,
  type JobAnalysisResult,
} from "@/lib/ai/contracts";
import { readJobAnalysisCache } from "@/lib/jd-analysis-cache";
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
type CompileErrorResponse = {
  error?: string;
  code?: string;
  diagnostics?: string;
};

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
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[] | null>(
    null,
  );
  const [analysis, setAnalysis] = useState<JobAnalysisResult | null>(null);
  const [recommendation, setRecommendation] =
    useState<AchievementSelectionResponse | null>(null);
  const [selectionError, setSelectionError] = useState("");
  const [isRecommending, setIsRecommending] = useState(false);
  const [result, setResult] = useState<ManualGenerationResult | null>(null);
  const [requestError, setRequestError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [compileError, setCompileError] = useState<CompileErrorResponse | null>(
    null,
  );
  const [compileStatus, setCompileStatus] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [outputView, setOutputView] = useState<"latex" | "pdf">("latex");
  const [pdfZoom, setPdfZoom] = useState(100);
  const [isPdfFullscreen, setIsPdfFullscreen] = useState(false);
  const compileAbortRef = useRef<AbortController | null>(null);
  const selectionAbortRef = useRef<AbortController | null>(null);
  const pdfViewportRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => getPointGroups(library), [library]);
  const enabledIds = useMemo(
    () => groups.flatMap((group) => group.points.map((point) => point.id)),
    [groups],
  );
  const pointById = useMemo(
    () =>
      new Map(
        groups.flatMap((group) =>
          group.points.map((point) => [point.id, { point, group }] as const),
        ),
      ),
    [groups],
  );
  const skillById = useMemo(
    () => new Map(library.skills.map((skill) => [skill.id, skill])),
    [library.skills],
  );

  useEffect(() => {
    const saved = readDraft(window.localStorage);
    setDraft(saved.draft);
    setAnalysis(readJobAnalysisCache(window.localStorage, saved.draft));
    setDraftNotice(
      saved.state === "invalid"
        ? "The saved job draft could not be restored. Return to Job description and save it again."
        : saved.state === "unavailable"
          ? "Browser storage is unavailable, so no saved job draft can be used."
          : "",
    );
    setDraftReady(true);
  }, []);

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  useEffect(() => {
    function syncFullscreenState() {
      setIsPdfFullscreen(document.fullscreenElement === pdfViewportRef.current);
    }

    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () =>
      document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  useEffect(
    () => () => {
      compileAbortRef.current?.abort();
      selectionAbortRef.current?.abort();
    },
    [],
  );

  function clearPdfOutput() {
    compileAbortRef.current?.abort();
    compileAbortRef.current = null;
    setIsCompiling(false);
    setPdfUrl(null);
    setOutputView("latex");
    setPdfZoom(100);
    setCompileError(null);
    setCompileStatus("");
  }

  function changeSelection(id: string, checked: boolean) {
    const nextIds = checked
      ? selectedIds.includes(id)
        ? selectedIds
        : [...selectedIds, id]
      : selectedIds.filter((selectedId) => selectedId !== id);
    setSelectedIds(nextIds);
    setSelectedSkillIds(
      (current) =>
        current?.filter((skillId) => {
          const suggestion =
            recommendation?.recommendations.skillRecommendations.find(
              (item) => item.skillId === skillId,
            );
          return (
            !suggestion ||
            suggestion.supportingAchievementIds.some((supportId) =>
              nextIds.includes(supportId),
            )
          );
        }) ?? null,
    );
    clearPdfOutput();
    setResult(null);
    setCopyMessage("");
    setRequestError("");
  }

  function selectAll() {
    setSelectedIds(enabledIds);
    clearPdfOutput();
    setResult(null);
    setCopyMessage("");
    setRequestError("");
  }

  function clearSelection() {
    setSelectedIds([]);
    setSelectedSkillIds(
      library.skills
        .filter((skill) => skill.isListedOnCurrentResume)
        .map((skill) => skill.id),
    );
    clearPdfOutput();
    setResult(null);
    setCopyMessage("");
    setRequestError("");
  }

  async function handleRecommend() {
    if (!draft.jobDescription.trim()) {
      setSelectionError(
        "Save a job description before requesting recommendations.",
      );
      return;
    }
    if (!analysis) {
      setSelectionError(
        "Analyze this job description first, then return to the resume builder.",
      );
      return;
    }

    selectionAbortRef.current?.abort();
    const controller = new AbortController();
    selectionAbortRef.current = controller;
    setIsRecommending(true);
    setSelectionError("");
    try {
      const response = await fetch("/api/ai/select-achievements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataSource: source,
          jobDescription: draft.jobDescription,
          analysis,
        }),
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          payload &&
          typeof payload === "object" &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Achievement recommendations failed. Try again.";
        throw new Error(message);
      }
      const parsed = AchievementSelectionResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(
          "The recommendation service returned an invalid response. Try again.",
        );
      }

      setRecommendation(parsed.data);
      setSelectedIds(
        parsed.data.recommendations.selections.map(
          (item) => item.achievementId,
        ),
      );
      setSelectedSkillIds([
        ...new Set([
          ...library.skills
            .filter((skill) => skill.isListedOnCurrentResume)
            .map((skill) => skill.id),
          ...parsed.data.recommendations.skillRecommendations.map(
            (item) => item.skillId,
          ),
        ]),
      ]);
      clearPdfOutput();
      setResult(null);
      setRequestError("");
      setCopyMessage("");
    } catch (error) {
      if (controller.signal.aborted) return;
      setSelectionError(
        error instanceof Error
          ? error.message
          : "Achievement recommendations failed. Try again.",
      );
    } finally {
      if (selectionAbortRef.current === controller) {
        selectionAbortRef.current = null;
        setIsRecommending(false);
      }
    }
  }

  function applyRecommendations() {
    if (!recommendation) return;
    setSelectedIds(
      recommendation.recommendations.selections.map(
        (item) => item.achievementId,
      ),
    );
    setSelectedSkillIds([
      ...new Set([
        ...library.skills
          .filter((skill) => skill.isListedOnCurrentResume)
          .map((skill) => skill.id),
        ...recommendation.recommendations.skillRecommendations.map(
          (item) => item.skillId,
        ),
      ]),
    ]);
    clearPdfOutput();
    setResult(null);
    setRequestError("");
    setCopyMessage("");
  }

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearPdfOutput();
    setResult(null);
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
          ...(selectedSkillIds ? { selectedSkillIds } : {}),
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

  async function compilePdf() {
    if (!result || isCompiling) return;

    const controller = new AbortController();
    compileAbortRef.current = controller;
    setIsCompiling(true);
    setCompileError(null);
    setCompileStatus("");

    try {
      const response = await fetch("/api/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latex: result.latex }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const payload = (await response.json()) as CompileErrorResponse;
        setCompileError({
          error: payload.error ?? "The PDF could not be created. Try again.",
          diagnostics: payload.diagnostics,
        });
        return;
      }

      if (
        !response.headers.get("Content-Type")?.includes("application/pdf") ||
        response.headers.get("X-PDF-Pages") !== "1"
      ) {
        setCompileError({
          error: "The server returned an unverified PDF. Try compiling again.",
        });
        return;
      }

      const pdf = await response.blob();
      if (controller.signal.aborted) return;
      if ((await pdf.slice(0, 5).text()) !== "%PDF-") {
        setCompileError({
          error: "The server response was not a valid PDF. Try again.",
        });
        return;
      }
      if (controller.signal.aborted) return;

      setPdfUrl(URL.createObjectURL(pdf));
      setPdfZoom(100);
      setOutputView("pdf");
      setCompileStatus("PDF ready · 1 page.");
    } catch {
      if (!controller.signal.aborted) {
        setCompileError({
          error: "The PDF service could not be reached. Try again.",
        });
      }
    } finally {
      if (compileAbortRef.current === controller) {
        compileAbortRef.current = null;
        setIsCompiling(false);
      }
    }
  }

  async function togglePdfFullscreen() {
    const viewport = pdfViewportRef.current;
    if (!viewport) return;

    try {
      if (document.fullscreenElement === viewport) {
        await document.exitFullscreen();
      } else {
        await viewport.requestFullscreen();
      }
    } catch {
      setCompileError({
        error: "Full-screen preview is unavailable in this browser.",
      });
    }
  }

  function downloadPdf() {
    if (!pdfUrl || !result) return;
    const anchor = document.createElement("a");
    anchor.href = pdfUrl;
    anchor.download = createResumeFilename(
      result.metadata.company,
      result.metadata.roleTitle,
    ).replace(/\.tex$/, ".pdf");
    anchor.click();
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
  const recommendedSelections =
    recommendation?.recommendations.selections ?? [];
  const recommendedIds = recommendedSelections.map(
    (item) => item.achievementId,
  );
  const recommendedSkillIds =
    recommendation?.recommendations.skillRecommendations.map(
      (item) => item.skillId,
    ) ?? [];
  const hasRecommendationEdits =
    JSON.stringify([...selectedIds].sort()) !==
      JSON.stringify([...recommendedIds].sort()) ||
    recommendedSkillIds.some(
      (id) => selectedSkillIds !== null && !selectedSkillIds.includes(id),
    );

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
                <button
                  className="generation-ai-button"
                  disabled={
                    !draftReady ||
                    !hasJobDescription ||
                    !analysis ||
                    isRecommending ||
                    enabledIds.length === 0
                  }
                  onClick={handleRecommend}
                  type="button"
                >
                  {isRecommending
                    ? "Finding matches…"
                    : selectionError
                      ? "Retry suggestions"
                      : "Suggest points"}
                </button>
                <button type="button" onClick={selectAll}>
                  Select all
                </button>
                <button type="button" onClick={clearSelection}>
                  Clear
                </button>
              </div>
            </div>

            {!analysis && draftReady && hasJobDescription && (
              <p className="selection-analysis-notice">
                Analyze this job description on the{" "}
                <Link href="/">Job description</Link> page before requesting AI
                recommendations.
              </p>
            )}
            {selectionError && (
              <p className="generation-error-message" role="alert">
                {selectionError}
              </p>
            )}
            {recommendation && (
              <section
                className="selection-recommendation"
                aria-label="AI recommendations"
                aria-live="polite"
              >
                <div className="selection-recommendation-heading">
                  <div>
                    <h3>
                      {recommendation.mode === "ai"
                        ? "AI recommendations"
                        : "Local matching fallback"}
                    </h3>
                    <p>{recommendation.recommendations.summary}</p>
                  </div>
                  {hasRecommendationEdits && (
                    <button onClick={applyRecommendations} type="button">
                      Apply suggestions
                    </button>
                  )}
                </div>
                <p className="selection-budget" role="status">
                  Confidence estimate:{" "}
                  {Math.round(recommendation.recommendations.confidence * 100)}%
                  <span aria-hidden="true"> · </span>
                  Estimated content budget: {
                    recommendation.budget.usedLines
                  } / {recommendation.budget.availableLines} lines
                </p>
                {recommendation.notice && (
                  <p className="selection-fallback-notice" role="status">
                    {recommendation.notice}
                  </p>
                )}
                <div className="selection-coverage">
                  <h4>Requirement coverage</h4>
                  {recommendation.recommendations.requirementCoverage.length ? (
                    <ul>
                      {recommendation.recommendations.requirementCoverage.map(
                        ({ requirement, coveredByAchievementIds }) => {
                          const currentIds = coveredByAchievementIds.filter(
                            (id) => selectedIds.includes(id),
                          );
                          return (
                            <li key={requirement}>
                              <span
                                className={
                                  currentIds.length
                                    ? "coverage-status is-covered"
                                    : "coverage-status"
                                }
                              >
                                {currentIds.length ? "Covered" : "Uncovered"}
                              </span>
                              <span>{requirement}</span>
                            </li>
                          );
                        },
                      )}
                    </ul>
                  ) : (
                    <p>
                      No explicit requirements or responsibilities were
                      extracted.
                    </p>
                  )}
                </div>
                {recommendedSkillIds.length > 0 && (
                  <div className="selection-skill-recommendations">
                    <h4>Supported skills to add</h4>
                    {recommendation.recommendations.skillRecommendations.map(
                      (suggestion) => {
                        const skill = skillById.get(suggestion.skillId);
                        if (!skill) return null;
                        const hasSupport =
                          suggestion.supportingAchievementIds.some((id) =>
                            selectedIds.includes(id),
                          );
                        const supportSources =
                          suggestion.supportingAchievementIds
                            .map((id) => pointById.get(id)?.group.title)
                            .filter((title): title is string => Boolean(title));
                        return (
                          <label
                            className="selection-skill-option"
                            key={skill.id}
                          >
                            <input
                              checked={
                                selectedSkillIds?.includes(skill.id) ?? false
                              }
                              disabled={!hasSupport}
                              onChange={(event) =>
                                setSelectedSkillIds((current) => {
                                  const base =
                                    current ??
                                    library.skills
                                      .filter(
                                        (item) => item.isListedOnCurrentResume,
                                      )
                                      .map((item) => item.id);
                                  return event.target.checked
                                    ? [...new Set([...base, skill.id])]
                                    : base.filter((id) => id !== skill.id);
                                })
                              }
                              type="checkbox"
                            />
                            <span>
                              <strong>{skill.name}</strong>
                              <small>{suggestion.rationale}</small>
                              <small>
                                Evidence:{" "}
                                {supportSources.join(", ") ||
                                  "Selected resume points"}
                              </small>
                              {!hasSupport && (
                                <small>
                                  Select a supporting point to include this
                                  skill.
                                </small>
                              )}
                            </span>
                          </label>
                        );
                      },
                    )}
                  </div>
                )}
              </section>
            )}

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
                          <span>
                            {point.text}
                            {recommendation &&
                              (() => {
                                const suggestion = recommendedSelections.find(
                                  (item) => item.achievementId === point.id,
                                );
                                return suggestion ? (
                                  <small className="selection-point-reason">
                                    {suggestion.rationale} ·{" "}
                                    {Math.round(suggestion.confidence * 100)}%
                                    confidence
                                  </small>
                                ) : null;
                              })()}
                          </span>
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
                <h2 id="preview-title">
                  {outputView === "pdf" ? "PDF preview" : "LaTeX preview"}
                </h2>
                <p>
                  {outputView === "pdf"
                    ? "Compiled from your generated LaTeX"
                    : "Generated from your selected points"}
                </p>
              </div>
              {result && (
                <div className="generation-output-actions">
                  <div
                    className="generation-output-tabs"
                    role="tablist"
                    aria-label="Resume output"
                  >
                    <button
                      id="resume-output-tab-latex"
                      aria-selected={outputView === "latex"}
                      aria-controls="resume-output-panel"
                      onClick={() => setOutputView("latex")}
                      role="tab"
                      type="button"
                    >
                      LaTeX
                    </button>
                    <button
                      id="resume-output-tab-pdf"
                      aria-selected={outputView === "pdf"}
                      aria-controls="resume-output-panel"
                      disabled={!pdfUrl}
                      onClick={() => setOutputView("pdf")}
                      role="tab"
                      type="button"
                    >
                      PDF
                    </button>
                  </div>
                  {outputView === "pdf" && pdfUrl ? (
                    <>
                      <button
                        aria-label="Download PDF"
                        onClick={downloadPdf}
                        title="Download PDF"
                        type="button"
                      >
                        Download PDF
                      </button>
                      <button
                        onClick={compilePdf}
                        disabled={isCompiling}
                        type="button"
                      >
                        {isCompiling ? "Compiling…" : "Recompile"}
                      </button>
                    </>
                  ) : (
                    <>
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
                        Download LaTeX
                      </button>
                      <button
                        className="primary-button generation-compile-button"
                        disabled={isCompiling || isGenerating}
                        onClick={compilePdf}
                        type="button"
                      >
                        {isCompiling ? "Creating PDF…" : "Create PDF"}
                      </button>
                    </>
                  )}
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
            {compileError && (
              <div className="generation-error-message" role="alert">
                <p>{compileError.error}</p>
                {compileError.diagnostics && (
                  <details>
                    <summary>Compiler details</summary>
                    <pre>{compileError.diagnostics}</pre>
                  </details>
                )}
              </div>
            )}
            {compileStatus && (
              <p className="generation-notice" role="status">
                {compileStatus}
              </p>
            )}
            {result ? (
              <div
                className="generation-output-panel"
                role="tabpanel"
                id="resume-output-panel"
                aria-labelledby={`resume-output-tab-${outputView}`}
              >
                <p className="generation-metadata" role="status">
                  Generated{" "}
                  {new Date(result.metadata.generatedAt).toLocaleString()} ·{" "}
                  {result.metadata.selectedAchievementIds.length} achievement
                  {result.metadata.selectedAchievementIds.length === 1
                    ? ""
                    : "s"}
                </p>
                {outputView === "pdf" && pdfUrl ? (
                  <div className="pdf-preview-workspace">
                    <div className="pdf-preview-viewport" ref={pdfViewportRef}>
                      <div className="pdf-preview-toolbar">
                        <div
                          className="pdf-zoom-control"
                          aria-label="PDF zoom controls"
                        >
                          <button
                            aria-label="Zoom out"
                            disabled={pdfZoom <= 50}
                            onClick={() =>
                              setPdfZoom((zoom) => Math.max(50, zoom - 10))
                            }
                            title="Zoom out"
                            type="button"
                          >
                            −
                          </button>
                          <span aria-live="polite">{pdfZoom}%</span>
                          <button
                            aria-label="Zoom in"
                            disabled={pdfZoom >= 200}
                            onClick={() =>
                              setPdfZoom((zoom) => Math.min(200, zoom + 10))
                            }
                            title="Zoom in"
                            type="button"
                          >
                            +
                          </button>
                        </div>
                        <button
                          aria-label={
                            isPdfFullscreen
                              ? "Exit full screen"
                              : "Open full screen"
                          }
                          onClick={togglePdfFullscreen}
                          title={
                            isPdfFullscreen
                              ? "Exit full screen"
                              : "Open full screen"
                          }
                          type="button"
                        >
                          {isPdfFullscreen ? "Exit full screen" : "Full screen"}
                        </button>
                      </div>
                      <iframe
                        className="pdf-preview-frame"
                        key={`${pdfUrl}-${pdfZoom}`}
                        src={`${pdfUrl}#zoom=${pdfZoom}`}
                        title="Generated resume PDF"
                      />
                    </div>
                  </div>
                ) : (
                  <pre
                    className="latex-preview"
                    aria-label="Generated LaTeX"
                    role="region"
                  >
                    <code>{result.latex}</code>
                  </pre>
                )}
              </div>
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
            disabled={isGenerating || isCompiling || !draftReady}
            type="submit"
          >
            {isGenerating ? "Generating…" : "Generate LaTeX"}
          </button>
        </div>
      </form>
    </section>
  );
}
