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
  TailorAchievementsResponseSchema,
  type AchievementSelectionResponse,
  type JobAnalysisResult,
  type TailorAchievementsResponse,
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

function normalizeKeywordText(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .trim();
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
  const [tailoring, setTailoring] = useState<TailorAchievementsResponse | null>(
    null,
  );
  const [tailoredText, setTailoredText] = useState<Record<string, string>>({});
  const [approvedTailoredIds, setApprovedTailoredIds] = useState<string[]>([]);
  const [tailoringError, setTailoringError] = useState("");
  const [isTailoring, setIsTailoring] = useState(false);
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
  const tailoringAbortRef = useRef<AbortController | null>(null);
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
      tailoringAbortRef.current?.abort();
    },
    [],
  );

  function clearTailoring() {
    tailoringAbortRef.current?.abort();
    tailoringAbortRef.current = null;
    setIsTailoring(false);
    setTailoring(null);
    setTailoredText({});
    setApprovedTailoredIds([]);
    setTailoringError("");
  }

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
    if (!checked) {
      setApprovedTailoredIds((current) =>
        current.filter((selectedId) => selectedId !== id),
      );
    }
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
    clearTailoring();
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
      clearTailoring();
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
    clearTailoring();
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

  async function handleTailorSelected() {
    if (!draft.jobDescription.trim() || !analysis || selectedIds.length === 0) {
      setTailoringError(
        "Save and analyze a job description, then select at least one achievement point.",
      );
      return;
    }
    if (selectedIds.length > 100) {
      setTailoringError(
        "Select at most 100 points for one tailoring request. A shorter, focused selection usually works better.",
      );
      return;
    }

    tailoringAbortRef.current?.abort();
    const controller = new AbortController();
    tailoringAbortRef.current = controller;
    setIsTailoring(true);
    setTailoringError("");
    setTailoring(null);
    setTailoredText({});
    setApprovedTailoredIds([]);
    clearPdfOutput();
    setResult(null);
    setRequestError("");

    try {
      const response = await fetch("/api/ai/tailor-achievements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataSource: source,
          jobDescription: draft.jobDescription,
          analysis,
          achievementIds: selectedIds,
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
            : "Tailored wording could not be prepared. Try again.";
        throw new Error(message);
      }
      const parsed = TailorAchievementsResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(
          "The tailoring service returned an invalid response. Try again.",
        );
      }
      setTailoring(parsed.data);
      setTailoredText(
        Object.fromEntries(
          parsed.data.proposals.map((proposal) => [
            proposal.achievementId,
            proposal.proposedText,
          ]),
        ),
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      setTailoringError(
        error instanceof Error
          ? error.message
          : "Tailored wording could not be prepared. Try again.",
      );
    } finally {
      if (tailoringAbortRef.current === controller) {
        tailoringAbortRef.current = null;
        setIsTailoring(false);
      }
    }
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
          ...(tailoring
            ? {
                achievementTextOverrides: tailoring.proposals
                  .filter(
                    (proposal) =>
                      approvedTailoredIds.includes(proposal.achievementId) &&
                      selectedIds.includes(proposal.achievementId),
                  )
                  .map((proposal) => ({
                    achievementId: proposal.achievementId,
                    text:
                      tailoredText[proposal.achievementId] ??
                      proposal.proposedText,
                  })),
              }
            : {}),
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
  const availableEvidence = new Map(
    recommendation?.requirementEvidence?.map((item) => [
      item.requirement,
      item.availableAchievementIds,
    ]) ?? [],
  );
  const coverageCategories = new Map<string, string>();
  for (const [title, requirements] of [
    ["Required qualifications", analysis?.requiredQualifications ?? []],
    ["Responsibilities", analysis?.responsibilities ?? []],
    ["Preferred qualifications", analysis?.preferredQualifications ?? []],
  ] as const) {
    for (const requirement of requirements) {
      if (!coverageCategories.has(requirement)) {
        coverageCategories.set(requirement, title);
      }
    }
  }
  const coverageItems =
    recommendation?.recommendations.requirementCoverage.map((item) => {
      const availableIds =
        availableEvidence.get(item.requirement) ?? item.coveredByAchievementIds;
      return {
        requirement: item.requirement,
        category: coverageCategories.get(item.requirement) ?? "Other signals",
        availableIds,
        selectedEvidenceIds: availableIds.filter((id) =>
          selectedIds.includes(id),
        ),
      };
    }) ?? [];
  const coveredCount = coverageItems.filter(
    (item) => item.selectedEvidenceIds.length > 0,
  ).length;
  const visibleProposals =
    tailoring?.proposals.filter((proposal) =>
      selectedIds.includes(proposal.achievementId),
    ) ?? [];
  const bulkApprovableIds = visibleProposals
    .filter(
      (proposal) =>
        (tailoredText[proposal.achievementId] ?? proposal.proposedText) ===
        proposal.proposedText,
    )
    .map((proposal) => proposal.achievementId);
  const hasUnapprovedBulkProposals = bulkApprovableIds.some(
    (id) => !approvedTailoredIds.includes(id),
  );
  const requestedSkillCount =
    result?.metadata.selectedSkillIds?.length ??
    library.skills.filter((skill) => skill.isListedOnCurrentResume).length;
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
                    isTailoring ||
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
                <button
                  className="generation-ai-button"
                  disabled={
                    !draftReady ||
                    !hasJobDescription ||
                    !analysis ||
                    isRecommending ||
                    isTailoring ||
                    selectedIds.length === 0 ||
                    selectedIds.length > 100
                  }
                  onClick={handleTailorSelected}
                  type="button"
                >
                  {isTailoring
                    ? "Drafting wording…"
                    : tailoringError
                      ? "Retry Guided Tailor"
                      : "Guided Tailor"}
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
                  <div className="selection-coverage-heading">
                    <h4>Requirement coverage</h4>
                    <strong>
                      {coveredCount} / {coverageItems.length} supported
                    </strong>
                  </div>
                  {coverageItems.length ? (
                    <>
                      <progress
                        aria-label="Requirements covered by selected achievements"
                        max={coverageItems.length}
                        value={coveredCount}
                      />
                      {[
                        ...new Set(coverageItems.map((item) => item.category)),
                      ].map((category) => (
                        <div className="coverage-category" key={category}>
                          <h5>{category}</h5>
                          <ul>
                            {coverageItems
                              .filter((item) => item.category === category)
                              .map((item) => {
                                const status = item.selectedEvidenceIds.length
                                  ? "Covered"
                                  : item.availableIds.length
                                    ? "Not selected"
                                    : "No match found";
                                const evidenceIds = item.selectedEvidenceIds
                                  .length
                                  ? item.selectedEvidenceIds
                                  : item.availableIds;
                                return (
                                  <li key={item.requirement}>
                                    <details>
                                      <summary>
                                        <span
                                          className={
                                            status === "Covered"
                                              ? "coverage-status is-covered"
                                              : "coverage-status"
                                          }
                                        >
                                          {status}
                                        </span>
                                        <span>{item.requirement}</span>
                                      </summary>
                                      <p>
                                        {evidenceIds.length
                                          ? `${item.selectedEvidenceIds.length ? "Selected evidence" : "Available evidence"}: ${evidenceIds
                                              .map((id) => {
                                                const source =
                                                  pointById.get(id);
                                                return source
                                                  ? `${source.group.title}${source.group.subtitle ? `, ${source.group.subtitle}` : ""}: ${source.point.text}`
                                                  : id;
                                              })
                                              .join("; ")}`
                                          : "No supporting achievement was identified in the enabled library."}
                                      </p>
                                    </details>
                                  </li>
                                );
                              })}
                          </ul>
                        </div>
                      ))}
                    </>
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
                              onChange={(event) => {
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
                                });
                                clearPdfOutput();
                                setResult(null);
                                setRequestError("");
                                setCopyMessage("");
                              }}
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

            {tailoring && (
              <section
                className="guided-tailor-review"
                aria-label="Guided Tailor review"
                aria-live="polite"
              >
                <div className="guided-tailor-heading">
                  <div>
                    <h3>Guided Tailor</h3>
                    <p>{tailoring.summary}</p>
                  </div>
                  <span className="guided-tailor-count" role="status">
                    {
                      approvedTailoredIds.filter((id) =>
                        selectedIds.includes(id),
                      ).length
                    }{" "}
                    /{" "}
                    {
                      tailoring.proposals.filter((proposal) =>
                        selectedIds.includes(proposal.achievementId),
                      ).length
                    }{" "}
                    approved
                  </span>
                </div>
                <div className="guided-tailor-actions">
                  <button
                    disabled={!hasUnapprovedBulkProposals}
                    onClick={() => {
                      setApprovedTailoredIds((current) => [
                        ...new Set([...current, ...bulkApprovableIds]),
                      ]);
                      clearPdfOutput();
                      setResult(null);
                    }}
                    type="button"
                  >
                    Approve all unchanged
                  </button>
                  <button
                    disabled={approvedTailoredIds.length === 0}
                    onClick={() => {
                      setApprovedTailoredIds([]);
                      clearPdfOutput();
                      setResult(null);
                    }}
                    type="button"
                  >
                    Revoke all
                  </button>
                </div>
                <p className="guided-tailor-note">
                  Review each change. Only approved wording for selected points
                  replaces the originals in the generated resume.
                </p>
                <div className="guided-tailor-proposals">
                  {tailoring.proposals.map((proposal) => {
                    const sourcePoint = pointById.get(proposal.achievementId);
                    if (
                      !sourcePoint ||
                      !selectedIds.includes(proposal.achievementId)
                    ) {
                      return null;
                    }
                    const editedText =
                      tailoredText[proposal.achievementId] ??
                      proposal.proposedText;
                    const originalNormalized = normalizeKeywordText(
                      proposal.originalText,
                    );
                    const proposedNormalized = normalizeKeywordText(editedText);
                    const addedTerms = tailoring.analyzedTerms.filter(
                      (term) => {
                        const normalizedTerm = normalizeKeywordText(term);
                        return (
                          normalizedTerm.length > 0 &&
                          proposedNormalized.includes(normalizedTerm) &&
                          !originalNormalized.includes(normalizedTerm)
                        );
                      },
                    );
                    return (
                      <article
                        className="guided-tailor-proposal"
                        key={proposal.achievementId}
                      >
                        <h4>
                          {sourcePoint.group.title}
                          {sourcePoint.group.subtitle
                            ? ` · ${sourcePoint.group.subtitle}`
                            : ""}
                        </h4>
                        <div className="guided-tailor-comparison">
                          <div>
                            <span className="guided-tailor-label">
                              Original
                            </span>
                            <p>{proposal.originalText}</p>
                          </div>
                          <label>
                            <span className="guided-tailor-label">
                              Proposed wording
                            </span>
                            <textarea
                              aria-label={`Tailored wording for ${proposal.achievementId}`}
                              maxLength={8_000}
                              onChange={(event) => {
                                setTailoredText((current) => ({
                                  ...current,
                                  [proposal.achievementId]: event.target.value,
                                }));
                                setApprovedTailoredIds((current) =>
                                  current.filter(
                                    (id) => id !== proposal.achievementId,
                                  ),
                                );
                                clearPdfOutput();
                                setResult(null);
                                setRequestError("");
                                setCopyMessage("");
                              }}
                              rows={4}
                              value={editedText}
                            />
                          </label>
                        </div>
                        <p className="guided-tailor-rationale">
                          {proposal.rationale}
                        </p>
                        {addedTerms.length > 0 ? (
                          <div className="guided-tailor-terms">
                            <span>New JD terms reflected</span>
                            <ul>
                              {addedTerms.map((term) => (
                                <li key={term}>{term}</li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          <p className="guided-tailor-rationale">
                            No new exact JD terms were detected in this wording.
                          </p>
                        )}
                        <label className="guided-tailor-approve">
                          <input
                            checked={approvedTailoredIds.includes(
                              proposal.achievementId,
                            )}
                            onChange={(event) => {
                              setApprovedTailoredIds((current) =>
                                event.target.checked
                                  ? [
                                      ...new Set([
                                        ...current,
                                        proposal.achievementId,
                                      ]),
                                    ]
                                  : current.filter(
                                      (id) => id !== proposal.achievementId,
                                    ),
                              );
                              clearPdfOutput();
                              setResult(null);
                              setRequestError("");
                              setCopyMessage("");
                            }}
                            type="checkbox"
                          />
                          <span>Use tailored wording for this point</span>
                        </label>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}
            {tailoringError && (
              <p className="generation-error-message" role="alert">
                {tailoringError}
              </p>
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
                  {" · "}
                  {result.metadata.renderedSkillIds.length} skills shown
                  {requestedSkillCount >
                    result.metadata.renderedSkillIds.length && (
                    <>
                      {" · "}
                      {requestedSkillCount -
                        result.metadata.renderedSkillIds.length}{" "}
                      omitted to keep two rows
                    </>
                  )}
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
