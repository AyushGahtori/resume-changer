"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  Check,
  CircleX,
  FileText,
  FolderKanban,
  Search,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, KeyboardEvent, ReactNode } from "react";
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleMinus,
  Info,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  TriangleAlert,
} from "lucide-react";
import {
  EMPTY_DRAFT,
  readDraft,
  type JobDescriptionDraft,
} from "@/lib/jd-draft";
import {
  AutoTailorResponseSchema,
  AchievementSelectionResponseSchema,
  TailorAchievementsResponseSchema,
  type AchievementSelectionResponse,
  type JobAnalysisResult,
  type TailorAchievementsResponse,
} from "@/lib/ai/contracts";
import {
  buildAchievementEvidence,
  buildSkillEvidence,
  buildProfileEvidence,
} from "@/lib/ai/evidence";
import { assessRequirementCoverage } from "@/lib/ai/requirement-coverage";
import type { CoverageStatus } from "@/lib/ai/requirement-coverage";
import {
  coverageStatusLabel,
  coverageStatusTone,
  describeCoverageDenominator,
  describeCoverageSource,
  jobAnalysisStateMessage,
  resolveJobAnalysisState,
  summarizeCoverage,
} from "@/lib/generation/coverage-presentation";
import { createJobContextId } from "@/lib/ai/job-context";
import { readJobAnalysisCache } from "@/lib/jd-analysis-cache";
import { createResumeFilename } from "@/lib/generation/resume-filename";
import {
  describeCompiledPdf,
  readPageCount,
} from "@/lib/generation/preview-metadata";
import { createResumeExportPackage } from "@/lib/generation/export-package";
import {
  countSelectionPoints,
  filterSelectionGroups,
} from "@/lib/generation/selection-filter";
import ResumeStudio from "./resume-studio";
import { parseStudioSession } from "@/lib/generation/studio-session";
import { getGenerationOriginNotice } from "@/lib/generation/generation-origin";
import type { ManualGenerationResult } from "@/lib/generation/manual-generation";
import type { ResumeDataSource } from "@/lib/data/loaders";
import type {
  AchievementPoint,
  ResumeLibrary,
  ResumeSectionType,
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

type StatusTone = "info" | "success" | "caution" | "error";

const STATUS_ICONS = {
  info: Info,
  success: CircleCheck,
  caution: TriangleAlert,
  error: CircleAlert,
} as const;

/**
 * A status banner carries an icon, a message, and a semantic tone. The tone
 * is only a second signal: every banner repeats its meaning in words, so the
 * message stays readable without the color.
 */
function StatusBanner({
  tone,
  role,
  className = "",
  children,
}: {
  tone: StatusTone;
  role: "status" | "alert";
  className?: string;
  children: ReactNode;
}) {
  const Icon = STATUS_ICONS[tone];

  return (
    <div
      className={`status-banner status-banner--${tone}${
        className ? ` ${className}` : ""
      }`}
      role={role}
    >
      <Icon
        aria-hidden="true"
        className="status-banner-icon"
        size={14}
        strokeWidth={2}
      />
      <div className="status-banner-body">{children}</div>
    </div>
  );
}

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

function createHistoryRequest(
  generation: ManualGenerationResult,
  status: "drafted" | "compiled" | "failed",
  pdfBase64?: string,
) {
  const metadata = generation.metadata;
  return {
    id: metadata.id,
    createdAt: metadata.generatedAt,
    ...(metadata.company.trim() ? { company: metadata.company.trim() } : {}),
    role: metadata.roleTitle.trim() || "Untitled resume",
    selectedAchievementIds: metadata.selectedAchievementIds,
    generatedBullets: metadata.generatedBullets.map((bullet, index) => ({
      id: `generated-bullet-${index + 1}`,
      text: bullet.text,
      section:
        metadata.sourceProvenance.find(
          (sourcePoint) => sourcePoint.achievementId === bullet.achievementId,
        )?.section ?? "experience",
      sourceAchievementIds: bullet.sourceAchievementIds,
    })),
    provider: metadata.aiProvider ?? "none",
    status,
    repairAttemptCount: metadata.fitting?.repairAttempts ?? 0,
    latex: generation.latex,
    ...(pdfBase64 ? { pdfBase64 } : {}),
  };
}

function normalizeKeywordText(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .trim();
}

async function postWithFallbackConsent(
  url: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
) {
  const send = async (requestBody: Record<string, unknown>) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal,
    });
    return { response, payload: (await response.json()) as unknown };
  };

  let result = await send(body);
  if (
    !result.response.ok &&
    result.payload &&
    typeof result.payload === "object" &&
    "fallbackAvailable" in result.payload &&
    result.payload.fallbackAvailable === true
  ) {
    const error =
      "error" in result.payload && typeof result.payload.error === "string"
        ? result.payload.error
        : "The AI step failed.";
    const fallbackType =
      "fallbackType" in result.payload &&
      typeof result.payload.fallbackType === "string"
        ? result.payload.fallbackType
        : "local fallback";
    const accepted = window.confirm(
      `${error}\n\nThe AI did not complete this step. Continue with ${fallbackType}? No fallback will run unless you choose OK.`,
    );
    if (accepted) {
      const consentedBody =
        fallbackType === "original-wording"
          ? { ...body, allowOriginalsFallback: true }
          : { ...body, allowLocalFallback: true };
      result = await send(consentedBody);
    }
  }
  return result;
}

function CoverageStatusIcon({ status }: { status: CoverageStatus }) {
  const icon =
    status === "supported" ? (
      <CircleCheck size={11} />
    ) : status === "partial" ? (
      <CircleDashed size={11} />
    ) : status === "uncertain" ? (
      <CircleHelp size={11} />
    ) : status === "evidence-not-selected" ? (
      <CircleMinus size={11} />
    ) : (
      <CircleX size={11} />
    );
  return (
    <span aria-hidden="true" className="coverage-status-icon">
      {icon}
    </span>
  );
}

export default function ResumeGenerator({ library, source }: Props) {
  const [studioSession, setStudioSession] = useState(0);
  const [draft, setDraft] = useState<JobDescriptionDraft>(EMPTY_DRAFT);
  const [draftReady, setDraftReady] = useState(false);
  const [draftNotice, setDraftNotice] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pointQuery, setPointQuery] = useState("");
  const [experienceFilter, setExperienceFilter] = useState("");
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
  const [summaryApproved, setSummaryApproved] = useState(false);
  const [tailoredText, setTailoredText] = useState<Record<string, string>>({});
  const [approvedTailoredIds, setApprovedTailoredIds] = useState<string[]>([]);
  const [tailoringError, setTailoringError] = useState("");
  const [isTailoring, setIsTailoring] = useState(false);
  const [isAutoTailoring, setIsAutoTailoring] = useState(false);
  const [autoTailorStatus, setAutoTailorStatus] = useState("");
  const [tailoringWorkflow, setTailoringWorkflow] = useState<
    "guided" | "auto" | null
  >(null);
  const [result, setResult] = useState<ManualGenerationResult | null>(null);
  const [showGenerationSettings, setShowGenerationSettings] = useState(false);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [savedSession, setSavedSession] = useState<{
    generation: ManualGenerationResult;
    pdfBase64: string | null;
  } | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [compileError, setCompileError] = useState<CompileErrorResponse | null>(
    null,
  );
  const [compileStatus, setCompileStatus] = useState("");
  const [viewerNotice, setViewerNotice] = useState("");
  const [historyNotice, setHistoryNotice] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [outputView, setOutputView] = useState<"latex" | "pdf">("latex");
  const [pdfZoom, setPdfZoom] = useState(100);
  const [isPdfFullscreen, setIsPdfFullscreen] = useState(false);
  const [pdfFit, setPdfFit] = useState<"width" | "page" | null>("width");
  const [previewShare, setPreviewShare] = useState(43);
  const compileAbortRef = useRef<AbortController | null>(null);
  const selectionAbortRef = useRef<AbortController | null>(null);
  const tailoringAbortRef = useRef<AbortController | null>(null);
  const pdfViewportRef = useRef<HTMLDivElement>(null);
  const latexTabRef = useRef<HTMLButtonElement>(null);
  const pdfTabRef = useRef<HTMLButtonElement>(null);
  const groups = useMemo(() => getPointGroups(library), [library]);
  const enabledIds = useMemo(
    () => groups.flatMap((group) => group.points.map((point) => point.id)),
    [groups],
  );
  /*
   * The search and the experience filter only change what the list shows.
   * The selected set stays untouched, so looking for evidence never
   * deselects it.
   */
  const visibleGroups = useMemo(
    () =>
      filterSelectionGroups(groups, {
        query: pointQuery,
        experienceId: experienceFilter,
      }),
    [groups, pointQuery, experienceFilter],
  );
  const visiblePointCount = useMemo(
    () => countSelectionPoints(visibleGroups),
    [visibleGroups],
  );
  const hasPointFilter = pointQuery.trim() !== "" || experienceFilter !== "";
  /*
   * The experience filter names every group of the library. The company or
   * the role is only added when two groups share a title, so the closed
   * select stays short without hiding a difference.
   */
  const experienceOptions = useMemo(() => {
    const titleCounts = new Map<string, number>();
    for (const group of groups) {
      titleCounts.set(group.title, (titleCounts.get(group.title) ?? 0) + 1);
    }
    return groups.map((group) => {
      const kind = group.kind === "JOB" ? "Job" : "Project";
      const shared = (titleCounts.get(group.title) ?? 0) > 1;
      return {
        id: group.id,
        label:
          shared && group.subtitle
            ? `${kind}: ${group.title} · ${group.subtitle}`
            : `${kind}: ${group.title}`,
      };
    });
  }, [groups]);
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

  async function persistGeneration(
    generation: ManualGenerationResult,
    status: "drafted" | "compiled" | "failed",
    savedPdfBase64?: string,
  ) {
    try {
      const response = await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          createHistoryRequest(generation, status, savedPdfBase64),
        ),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setHistoryNotice(
        response.ok
          ? "Saved to generation history on this device."
          : `Resume output is ready, but it could not be saved to history. ${payload.error ?? "Try again from the History page."}`,
      );
    } catch {
      setHistoryNotice(
        "Resume output is ready, but local history could not be reached. You can keep using this output; try again later.",
      );
    }
  }

  useEffect(() => {
    const saved = readDraft(window.localStorage);
    const cachedAnalysis = readJobAnalysisCache(
      window.localStorage,
      saved.draft,
    );
    setDraft(saved.draft);
    setAnalysis(cachedAnalysis);
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
    if (!draftReady || sessionReady) return;
    try {
      setSavedSession(
        parseStudioSession(
          localStorage.getItem(`resume-changer.resume-session.v1.${source}`),
          JSON.stringify([
            draft.company,
            draft.roleTitle,
            draft.jobDescription,
          ]),
          source,
        ),
      );
    } catch {
      /* Storage can be unavailable without blocking generation. */
    }
    setSessionReady(true);
  }, [draftReady, sessionReady, source, draft]);

  useEffect(() => {
    if (!sessionReady || !result || savedSession) return;
    try {
      localStorage.setItem(
        `resume-changer.resume-session.v1.${source}`,
        JSON.stringify({
          jobSignature: JSON.stringify([
            draft.company,
            draft.roleTitle,
            draft.jobDescription,
          ]),
          generation: result,
          pdfBase64,
        }),
      );
    } catch {
      /* The studio separately reports draft-storage failures. */
    }
  }, [result, pdfBase64, draft, source, sessionReady, savedSession]);

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
    setSummaryApproved(false);
    setTailoredText({});
    setApprovedTailoredIds([]);
    setTailoringError("");
    setTailoringWorkflow(null);
    setAutoTailorStatus("");
  }

  function clearPdfOutput() {
    compileAbortRef.current?.abort();
    compileAbortRef.current = null;
    setIsCompiling(false);
    setPdfUrl(null);
    setPdfBase64(null);
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

  function resetPointFilters() {
    setPointQuery("");
    setExperienceFilter("");
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

  function applyDraftEvidenceAction(achievementId: string, replaceId?: string) {
    if (!enabledIds.includes(achievementId)) return;
    const nextIds = selectedIds.filter((id) => id !== replaceId);
    if (!nextIds.includes(achievementId)) nextIds.push(achievementId);
    clearTailoring();
    setSelectedIds(nextIds);
    setSelectedSkillIds(null);
    setApprovedTailoredIds([]);
    clearPdfOutput();
    setResult(null);
    setRequestError("");
    setAutoTailorStatus(
      "Source selection updated. Run Guided Tailor to review wording for these points.",
    );
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
      const { response, payload } = await postWithFallbackConsent(
        "/api/ai/select-achievements",
        {
          dataSource: source,
          jobDescription: draft.jobDescription,
          analysis,
        },
        controller.signal,
      );
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
    setAutoTailorStatus("");
    setTailoringWorkflow(null);
    setTailoring(null);
    setSummaryApproved(false);
    setTailoredText({});
    setApprovedTailoredIds([]);
    clearPdfOutput();
    setResult(null);
    setRequestError("");

    try {
      const job = {
        company: draft.company,
        roleTitle: draft.roleTitle,
        jobUrl: draft.jobUrl,
        contextId: await createJobContextId({
          company: draft.company,
          roleTitle: draft.roleTitle,
          jobUrl: draft.jobUrl,
          jobDescription: draft.jobDescription,
          analysis,
        }),
      };
      const { response, payload } = await postWithFallbackConsent(
        "/api/ai/tailor-achievements",
        {
          dataSource: source,
          jobDescription: draft.jobDescription,
          analysis,
          job,
          ...(recommendation ? { selectionContext: recommendation } : {}),
          achievementIds: selectedIds,
        },
        controller.signal,
      );
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
      setSummaryApproved(false);
      setTailoringWorkflow("guided");
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

  async function handleAutoTailor() {
    if (!draft.jobDescription.trim() || !analysis) {
      setTailoringError(
        "Save and analyze a job description before running Auto Tailor.",
      );
      return;
    }

    clearTailoring();
    const controller = new AbortController();
    tailoringAbortRef.current = controller;
    setIsAutoTailoring(true);
    setTailoringError("");
    setAutoTailorStatus("Selecting evidence and drafting your resume…");
    clearPdfOutput();
    setResult(null);

    try {
      const job = {
        company: draft.company,
        roleTitle: draft.roleTitle,
        jobUrl: draft.jobUrl,
        contextId: await createJobContextId({
          company: draft.company,
          roleTitle: draft.roleTitle,
          jobUrl: draft.jobUrl,
          jobDescription: draft.jobDescription,
          analysis,
        }),
      };
      const requestBody = {
        dataSource: source,
        generatePdf: true,
        jobDescription: draft.jobDescription,
        analysis,
        job,
      };
      const { response, payload } = await postWithFallbackConsent(
        "/api/ai/auto-tailor",
        requestBody,
        controller.signal,
      );
      if (!response.ok) {
        const message =
          payload &&
          typeof payload === "object" &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Auto Tailor could not prepare this resume. Try again.";
        throw new Error(message);
      }
      const parsed = AutoTailorResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(
          "Auto Tailor returned an invalid response. No resume was generated.",
        );
      }

      const auto = parsed.data;
      const nextIds = auto.recommendation.recommendations.selections.map(
        (item) => item.achievementId,
      );
      const nextTailoredText = Object.fromEntries(
        auto.tailoring.proposals.map((proposal) => [
          proposal.achievementId,
          proposal.proposedText,
        ]),
      );
      setRecommendation(auto.recommendation);
      setSelectedIds(nextIds);
      setSelectedSkillIds(auto.selectedSkillIds);
      setTailoring(auto.tailoring);
      setTailoredText(nextTailoredText);
      setApprovedTailoredIds(
        auto.tailoring.proposals.map((proposal) => proposal.achievementId),
      );
      setTailoringWorkflow("auto");
      clearPdfOutput();
      setRequestError("");
      setCopyMessage("");
      setAutoTailorStatus(
        auto.draftingMode === "ai"
          ? "AI selected and drafted the source evidence. Generating LaTeX and checking the PDF…"
          : "AI is unavailable, so Auto Tailor kept the selected source wording unchanged. Generating LaTeX and checking the PDF…",
      );

      if (auto.compiled) {
        const binary = atob(auto.compiled.pdfBase64);
        const bytes = Uint8Array.from(binary, (character) =>
          character.charCodeAt(0),
        );
        if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
          throw new Error("Auto Tailor returned invalid PDF bytes.");
        const generation = {
          latex: auto.compiled.latex,
          metadata: auto.compiled.metadata,
        };
        setStudioSession((current) => current + 1);
        setResult(generation);
        setPdfBase64(auto.compiled.pdfBase64);
        await persistGeneration(
          generation,
          "compiled",
          auto.compiled.pdfBase64,
        );
        setSelectedIds(generation.metadata.selectedAchievementIds);
        setPdfUrl(
          URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })),
        );
        setPdfZoom(100);
        setOutputView("pdf");
        const fit = generation.metadata.fitting;
        const repairNotice = fit?.repairAttempts
          ? ` Wording repair used ${fit.repairAttempts} time${fit.repairAttempts === 1 ? "" : "s"}.`
          : "";
        setCompileStatus(
          `PDF ready · 1 page${generation.metadata.layout ? ` · ${Math.round(generation.metadata.layout.utilization * 100)}% page fill` : ""}.${repairNotice}`,
        );
        setAutoTailorStatus(
          fit?.status === "filled"
            ? `Auto Tailor completed with a verified one-page PDF and measured page fill.${repairNotice}`
            : fit?.status === "measurement-unavailable"
              ? `One-page PDF prepared; page-fill measurement was unavailable.${repairNotice}`
              : `One-page PDF prepared. More relevant evidence is needed to fill the remaining space.${repairNotice}`,
        );
        return;
      }

      const generated = await requestGeneration({
        selectedIds: nextIds,
        selectedSkillIds: auto.selectedSkillIds,
        tailoring: auto.tailoring,
        approvedTailoredIds: auto.tailoring.proposals.map(
          (proposal) => proposal.achievementId,
        ),
        tailoredText: nextTailoredText,
        workflow: "auto",
      });
      if (!generated) {
        setAutoTailorStatus(
          "Auto Tailor selected and drafted the content, but LaTeX generation failed. Review the error below.",
        );
        return;
      }

      const pdfReady = await compilePdf(generated);
      setAutoTailorStatus(
        pdfReady
          ? auto.draftingMode === "ai"
            ? "Auto Tailor completed and the one-page PDF was verified."
            : "Auto Tailor prepared a one-page PDF using original source wording; no AI rewrites were applied."
          : "LaTeX was prepared, but PDF compilation did not verify a one-page result. Review the compiler message.",
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      setTailoringError(
        error instanceof Error
          ? error.message
          : "Auto Tailor could not prepare this resume. Try again.",
      );
      setAutoTailorStatus("");
    } finally {
      if (tailoringAbortRef.current === controller) {
        tailoringAbortRef.current = null;
        setIsAutoTailoring(false);
      }
    }
  }

  async function requestGeneration(
    options: {
      selectedIds: string[];
      selectedSkillIds: string[] | null;
      tailoring: TailorAchievementsResponse | null;
      approvedTailoredIds: string[];
      tailoredText: Record<string, string>;
      workflow: "manual" | "guided" | "auto";
      achievementTextOverrides?: Array<{
        achievementId: string;
        sourceAchievementIds: string[];
        inferredTerms?: string[];
        text: string;
      }>;
      sectionOrder?: ResumeSectionType[];
      summaryOverride?: string;
    } = {
      selectedIds,
      selectedSkillIds,
      tailoring,
      approvedTailoredIds,
      tailoredText,
      workflow: tailoringWorkflow ?? (tailoring ? "guided" : "manual"),
      sectionOrder: library.preferences.sectionOrder,
    },
  ): Promise<ManualGenerationResult | null> {
    setRequestError("");
    setCopyMessage("");

    if (!draft.jobDescription.trim()) {
      setRequestError("Save a job description before generating a resume.");
      return null;
    }
    if (options.selectedIds.length === 0) {
      setRequestError("Select at least one enabled achievement point.");
      return null;
    }

    setIsGenerating(true);
    try {
      const requestBody = {
        dataSource: source,
        company: draft.company,
        roleTitle: draft.roleTitle,
        jobUrl: draft.jobUrl,
        jobDescription: draft.jobDescription,
        tailoringMode: options.workflow,
        ...(options.summaryOverride
          ? { summaryOverride: options.summaryOverride }
          : options.tailoring?.resumeSummary &&
              (options.workflow === "auto" || summaryApproved)
            ? { summaryOverride: options.tailoring.resumeSummary }
            : {}),
        selectedAchievementIds: options.selectedIds,
        sectionOrder: options.sectionOrder ?? library.preferences.sectionOrder,
        ...(options.selectedSkillIds
          ? { selectedSkillIds: options.selectedSkillIds }
          : {}),
        ...(options.achievementTextOverrides
          ? { achievementTextOverrides: options.achievementTextOverrides }
          : options.tailoring
            ? {
                achievementTextOverrides: options.tailoring.proposals
                  .filter(
                    (proposal) =>
                      options.approvedTailoredIds.includes(
                        proposal.achievementId,
                      ) && options.selectedIds.includes(proposal.achievementId),
                  )
                  .map((proposal) => ({
                    achievementId: proposal.achievementId,
                    sourceAchievementIds: proposal.sourceAchievementIds,
                    inferredTerms: proposal.inferredTerms,
                    text:
                      options.tailoredText[proposal.achievementId] ??
                      proposal.proposedText,
                  })),
              }
            : {}),
      };
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const payload = (await response.json()) as ApiResponse;

      if (!response.ok || !("latex" in payload)) {
        setRequestError(
          "error" in payload && payload.error
            ? payload.error
            : "The resume could not be generated. Try again.",
        );
        return null;
      }

      payload.metadata.aiProvider =
        options.workflow === "manual"
          ? null
          : (options.tailoring?.providerName ?? null);
      clearPdfOutput();
      setStudioSession((current) => current + 1);
      setResult(payload);
      await persistGeneration(payload, "drafted");
      return payload;
    } catch {
      setRequestError("The server could not be reached. Try again.");
      return null;
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await requestGeneration();
  }

  async function compilePdf(target: ManualGenerationResult | null = result) {
    if (!target || isCompiling) return false;
    const retainedPdfBase64 =
      result?.metadata.id === target.metadata.id ? pdfBase64 : null;
    const persistFailure = () =>
      void persistGeneration(
        target,
        retainedPdfBase64 ? "compiled" : "failed",
        retainedPdfBase64 ?? undefined,
      );
    const controller = new AbortController();
    compileAbortRef.current = controller;
    setIsCompiling(true);
    setCompileError(null);
    setCompileStatus("");
    setViewerNotice("");

    try {
      const requestBody = { latex: target.latex };
      const response = await fetch("/api/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const payload = (await response.json()) as CompileErrorResponse;
        setCompileError({
          error: payload.error ?? "The PDF could not be created. Try again.",
          diagnostics: payload.diagnostics,
        });
        persistFailure();
        return false;
      }

      if (
        !response.headers.get("Content-Type")?.includes("application/pdf") ||
        readPageCount(response.headers.get("X-PDF-Pages")) !== 1
      ) {
        setCompileError({
          error: "The server returned an unverified PDF. Try compiling again.",
        });
        persistFailure();
        return false;
      }

      const pdf = await response.blob();
      if (controller.signal.aborted) return false;
      if ((await pdf.slice(0, 5).text()) !== "%PDF-") {
        setCompileError({
          error: "The server response was not a valid PDF. Try again.",
        });
        persistFailure();
        return false;
      }
      if (controller.signal.aborted) return false;

      const pageCount = readPageCount(response.headers.get("X-PDF-Pages"));
      setPdfUrl(URL.createObjectURL(pdf));
      const bytes = new Uint8Array(await pdf.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 32768)
        binary += String.fromCharCode(
          ...bytes.subarray(offset, offset + 32768),
        );
      const compiledPdfBase64 = btoa(binary);
      setPdfBase64(compiledPdfBase64);
      await persistGeneration(target, "compiled", compiledPdfBase64);
      setOutputView("pdf");
      setCompileStatus(describeCompiledPdf({ pageCount }));
      return true;
    } catch {
      if (!controller.signal.aborted) {
        setCompileError({
          error: "The PDF service could not be reached. Try again.",
        });
        persistFailure();
      }
      return false;
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
      setViewerNotice("Full-screen preview is unavailable in this browser.");
    }
  }

  /**
   * The LaTeX and PDF tabs follow the ARIA tabs pattern: arrow keys move
   * between the available formats, Home and End jump to the first and last
   * one, and the tab list keeps a single tab stop. Formats that are not
   * ready, such as a PDF that has not been compiled yet, are skipped.
   */
  function handleOutputTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const available: ("latex" | "pdf")[] = pdfUrl
      ? ["latex", "pdf"]
      : ["latex"];
    const current = available.indexOf(outputView);
    if (current === -1) return;

    let next = current;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (current + 1) % available.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (current - 1 + available.length) % available.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = available.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const target = available[next];
    setOutputView(target);
    (target === "pdf" ? pdfTabRef.current : latexTabRef.current)?.focus();
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

  function downloadExportPackage() {
    if (!result) return;
    const exported = createResumeExportPackage(result, pdfBase64);
    const url = URL.createObjectURL(exported.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exported.filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setCopyMessage(
      exported.includedPdf
        ? "Export package downloaded with LaTeX, PDF, and metadata."
        : "Export package downloaded with LaTeX and metadata. No verified PDF was available to include.",
    );
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
  const currentCoverage = useMemo(
    () =>
      analysis
        ? assessRequirementCoverage(
            {
              jobDescription: draft.jobDescription,
              analysis,
              achievements: buildAchievementEvidence(library),
              skills: buildSkillEvidence(library),
              profile: buildProfileEvidence(library),
              contentBudgetLines: 60,
            },
            selectedIds,
            { renderedSkillIds: selectedSkillIds ?? undefined },
          )
        : null,
    [analysis, draft.jobDescription, library, selectedIds, selectedSkillIds],
  );
  const finalCoverage = result?.metadata.finalCoverage;
  const coverageItems = (
    finalCoverage ??
    currentCoverage ??
    recommendation?.recommendations.requirementCoverage ??
    []
  ).map((item) => {
    const details = recommendation?.requirementEvidence?.find(
      (entry) => entry.requirement === item.requirement,
    );
    const availableIds =
      availableEvidence.get(item.requirement) ?? item.coveredByAchievementIds;
    const selectedEvidenceIds = availableIds.filter((id) =>
      selectedIds.includes(id),
    );
    return {
      requirement: item.requirement,
      category: coverageCategories.get(item.requirement) ?? "Other signals",
      availableIds,
      selectedEvidenceIds,
      evidence: item.evidence ?? details?.evidence ?? [],
      facets: item.facets ?? details?.facets ?? [],
      priority: item.priority ?? details?.priority,
      reason: item.reason ?? details?.reason,
      status:
        item.status ??
        details?.status ??
        (selectedEvidenceIds.length
          ? "supported"
          : availableIds.length
            ? "evidence-not-selected"
            : "no-evidence-found"),
    };
  });
  const coveredCount = coverageItems.filter(
    (item) => item.status === "supported",
  ).length;
  const coverageSummary = summarizeCoverage(coverageItems);
  const coverageSource = describeCoverageSource({
    targetTitle: analysis?.targetTitle,
    seniority: analysis?.seniority,
    roleTitle: draft.roleTitle,
    company: draft.company,
  });
  const analysisContext = [
    { label: "Role", value: analysis?.targetTitle || draft.roleTitle },
    { label: "Seniority", value: analysis?.seniority },
    { label: "Company", value: draft.company },
  ].filter(({ value }) => Boolean(value?.trim()));
  const jobAnalysisState = resolveJobAnalysisState({
    draftReady,
    hasJobDescription,
    isAnalyzing: isRecommending,
    hasError: Boolean(selectionError),
    analysis,
  });
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
    result?.metadata.studioDocument &&
    !result.metadata.studioDocument.sectionOrder.includes("skills")
      ? 0
      : (result?.metadata.selectedSkillIds?.length ??
        library.skills.filter((skill) => skill.isListedOnCurrentResume).length);
  const renderedAchievementCount =
    result?.metadata.generatedBullets?.length ??
    result?.metadata.selectedAchievementIds.length ??
    0;
  const omittedSkillCount = result
    ? Math.max(0, requestedSkillCount - result.metadata.renderedSkillIds.length)
    : 0;
  const hasRecommendationEdits =
    JSON.stringify([...selectedIds].sort()) !==
      JSON.stringify([...recommendedIds].sort()) ||
    recommendedSkillIds.some(
      (id) => selectedSkillIds !== null && !selectedSkillIds.includes(id),
    );
  /**
   * The compile control stays a single utility action: it creates the first
   * PDF, recompiles the current LaTeX once one exists, and reports the
   * pending state while the compiler runs.
   */
  const compileActionLabel = isCompiling
    ? pdfUrl
      ? "Compiling…"
      : "Creating PDF…"
    : pdfUrl
      ? "Recompile"
      : "Create PDF";

  return (
    <section className="generation-page" aria-labelledby="page-title">
      <div className="generation-page-atmosphere" aria-hidden="true">
        <span className="generation-bubble generation-bubble-large" />
        <span className="generation-bubble generation-bubble-small" />
        <span className="generation-bubble generation-bubble-ring" />
        <span className="generation-bubble-orbit" />
      </div>
      <div className="generation-heading page-heading-row">
        <div>
          <p className="eyebrow">
            MANUAL GENERATION{" "}
            <span className="generation-step-chip">
              <span aria-hidden="true" className="generation-step-track">
                <i />
                <i />
                <i />
                <i />
              </span>
              02 / 04
            </span>
          </p>
          <h1 id="page-title">
            {result ? "Your next chapter." : "Build your resume."}
          </h1>
          <p className="page-intro">
            {result
              ? "A focused workspace for your experience, skills, and story."
              : "Choose the experience you want to include, then review the LaTeX."}
          </p>
        </div>
      </div>

      <div className="generation-draft">
        <span aria-hidden="true" className="generation-context-icon">
          <BriefcaseBusiness size={19} strokeWidth={1.8} />
        </span>
        <div className="generation-draft-details" aria-live="polite">
          <p className="generation-label">JOB DESCRIPTION</p>
          {!draftReady ? (
            <p className="generation-draft-note">Loading saved job details…</p>
          ) : hasJobDescription ? (
            <div className="generation-draft-context">
              {draft.roleTitle ? (
                <p className="generation-draft-role">{draft.roleTitle}</p>
              ) : (
                <p className="generation-draft-role is-empty">
                  Role not specified
                </p>
              )}
              <p className="generation-draft-meta">
                {draft.company && <span>{draft.company}</span>}
                <span className="generation-draft-count">
                  <FileText aria-hidden="true" size={13} />
                  {draft.jobDescription.length.toLocaleString()} description
                  characters
                </span>
              </p>
            </div>
          ) : (
            <p className="generation-draft-note">
              No saved job description. <Link href="/">Add job details</Link>
            </p>
          )}
        </div>
        {/*
         * The source choice decides which library the builder loads, so it
         * sits with the job context it applies to instead of floating in the
         * page heading. Each segment is a real link to its own route, and
         * the loaded one carries the current-page marker.
         */}
        <div className="generation-draft-source">
          <span className="generation-source-caption">RESUME DATA</span>
          <nav
            className="builder-source-switch"
            aria-label="Resume data source"
          >
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
          {safeJobUrl && (
            <a href={safeJobUrl} rel="noreferrer" target="_blank">
              Open job link
            </a>
          )}
        </div>
      </div>
      {draftNotice && (
        <p className="generation-notice" role="status">
          {draftNotice}
        </p>
      )}
      {result && autoTailorStatus && (
        <p className="auto-tailor-status" role="status">
          {autoTailorStatus}
        </p>
      )}
      {historyNotice && (
        <p className="generation-notice" role="status">
          {historyNotice}
        </p>
      )}
      {savedSession && !result && (
        <div className="studio-restore" role="status">
          <span>
            A previous resume and editing session are saved for this job.
          </span>
          <button
            type="button"
            onClick={() => {
              setResult(savedSession.generation);
              setPdfBase64(savedSession.pdfBase64);
              void persistGeneration(
                savedSession.generation,
                savedSession.pdfBase64 ? "compiled" : "drafted",
                savedSession.pdfBase64 ?? undefined,
              );
              if (savedSession.pdfBase64) {
                const bytes = Uint8Array.from(
                  atob(savedSession.pdfBase64),
                  (character) => character.charCodeAt(0),
                );
                setPdfUrl(
                  URL.createObjectURL(
                    new Blob([bytes], { type: "application/pdf" }),
                  ),
                );
                setOutputView("pdf");
              }
              setSavedSession(null);
            }}
          >
            Restore editing session
          </button>
          <button
            type="button"
            onClick={() => {
              setSavedSession(null);
              try {
                localStorage.removeItem(
                  `resume-changer.resume-session.v1.${source}`,
                );
              } catch {}
            }}
          >
            Start fresh
          </button>
        </div>
      )}

      <form className="generation-form" onSubmit={handleGenerate}>
        <div
          className={`generation-layout${result ? " is-studio-layout" : ""}`}
          style={{ "--preview-share": `${previewShare}%` } as CSSProperties}
        >
          <section
            className="generation-selection"
            id="resume-editing"
            tabIndex={-1}
            aria-label={
              result ? "Resume editing workspace" : "Choose achievements"
            }
          >
            <div
              aria-hidden="true"
              className="generation-selection-atmosphere"
            >
              <span className="selection-bubble selection-bubble-one" />
              <span className="selection-bubble selection-bubble-two" />
              <span className="selection-bubble selection-bubble-three" />
            </div>
            {(!result || showGenerationSettings) && (
              <>
                <div className="generation-section-heading">
                  <div className="generation-selection-title">
                    <span
                      aria-hidden="true"
                      className="generation-selection-icon"
                    >
                      <FileText size={18} strokeWidth={1.8} />
                    </span>
                    <div>
                      <p className="generation-selection-eyebrow">
                        YOUR EVIDENCE
                      </p>
                      <h2 id="selection-title">Choose achievements</h2>
                      <p className="generation-selection-helper">
                        Pick the details you want to bring into this resume.
                      </p>
                      <p className="generation-selection-count">
                        <strong>{selectedIds.length} selected</strong>
                        <span aria-hidden="true">·</span>
                        <span>{enabledIds.length} available</span>
                      </p>
                    </div>
                  </div>
                  <div className="generation-selection-actions">
                    <div className="generation-ai-actions">
                      <button
                        className="generation-ai-button"
                        disabled={
                          !draftReady ||
                          !hasJobDescription ||
                          !analysis ||
                          isRecommending ||
                          isTailoring ||
                          isAutoTailoring ||
                          enabledIds.length === 0
                        }
                        onClick={handleRecommend}
                        type="button"
                      >
                        <Sparkles aria-hidden="true" size={14} />
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
                          isAutoTailoring ||
                          selectedIds.length === 0 ||
                          selectedIds.length > 100
                        }
                        onClick={handleTailorSelected}
                        type="button"
                      >
                        <Sparkles aria-hidden="true" size={14} />
                        {isTailoring
                          ? "Drafting wording…"
                          : tailoringError
                            ? "Retry Guided Tailor"
                            : "Guided Tailor"}
                      </button>
                      <button
                        className="generation-ai-button"
                        disabled={
                          !draftReady ||
                          !hasJobDescription ||
                          !analysis ||
                          isRecommending ||
                          isTailoring ||
                          isAutoTailoring ||
                          enabledIds.length === 0
                        }
                        onClick={handleAutoTailor}
                        type="button"
                      >
                        <Sparkles aria-hidden="true" size={14} />
                        {isAutoTailoring ? "Auto tailoring…" : "Auto Tailor"}
                      </button>
                    </div>
                    <div className="generation-selection-utilities">
                      <button
                        disabled={
                          isRecommending || isTailoring || isAutoTailoring
                        }
                        type="button"
                        onClick={selectAll}
                      >
                        <Check aria-hidden="true" size={14} />
                        Select all
                      </button>
                      <button
                        disabled={
                          isRecommending || isTailoring || isAutoTailoring
                        }
                        type="button"
                        onClick={clearSelection}
                      >
                        <CircleX aria-hidden="true" size={14} />
                        Clear
                      </button>
                    </div>
                  </div>
                </div>

                {autoTailorStatus && (
                  <p className="auto-tailor-status" role="status">
                    {autoTailorStatus}
                  </p>
                )}

                <section
                  className="selection-analysis"
                  aria-label="Job analysis"
                >
                  <div className="selection-analysis-heading">
                    <div className="selection-analysis-title">
                      <span aria-hidden="true">
                        <Info size={15} strokeWidth={2} />
                      </span>
                      <h3>Job analysis</h3>
                    </div>
                    <span
                      className={`selection-analysis-state is-${jobAnalysisState}`}
                    >
                      {jobAnalysisState === "ready"
                        ? "Analyzed"
                        : jobAnalysisState === "loading"
                          ? "Analyzing…"
                          : jobAnalysisState === "error"
                            ? "Unavailable"
                            : jobAnalysisState === "empty"
                              ? "No requirements"
                              : "Not analyzed"}
                    </span>
                  </div>
                  {analysis && (
                    <>
                      <p className="selection-analysis-context-label">
                        Compared with the saved job description
                      </p>
                      {analysisContext.length > 0 && (
                        <dl className="selection-analysis-context">
                          {analysisContext.map(({ label, value }) => (
                            <div key={label}>
                              <dt>{label}</dt>
                              <dd>{value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </>
                  )}
                  {jobAnalysisState === "ready" ? (
                    <p className="selection-analysis-detail">
                      <strong>
                        {coverageSummary.total} requirement
                        {coverageSummary.total === 1 ? "" : "s"} extracted.
                      </strong>{" "}
                      The coverage below shows how selected evidence supports
                      each one.
                    </p>
                  ) : (
                    <p className="selection-analysis-detail">
                      {jobAnalysisStateMessage(jobAnalysisState)}
                    </p>
                  )}
                  {jobAnalysisState === "absent" && hasJobDescription && (
                    <p className="selection-analysis-detail">
                      <Link className="selection-analysis-action" href="/">
                        Analyze this job description
                        <ArrowUpRight aria-hidden="true" size={14} />
                      </Link>
                      <span>to unlock evidence suggestions.</span>
                    </p>
                  )}
                </section>
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
                      {Math.round(
                        recommendation.recommendations.confidence * 100,
                      )}
                      %<span aria-hidden="true"> · </span>
                      Estimated content budget:{" "}
                      {recommendation.budget.usedLines} /{" "}
                      {recommendation.budget.availableLines} lines
                    </p>
                    {recommendation.notice && (
                      <p className="selection-fallback-notice" role="status">
                        {recommendation.notice}
                      </p>
                    )}
                    <div className="selection-coverage">
                      <div className="selection-coverage-heading">
                        <div>
                          <h4>Requirement coverage</h4>
                          <p className="selection-coverage-source">
                            {coverageSource}
                          </p>
                        </div>
                        <strong className="selection-coverage-count">
                          {coverageSummary.headline}
                        </strong>
                      </div>
                      {coverageItems.length ? (
                        <>
                          <progress
                            aria-label="Requirements covered by selected achievements, out of the job requirements analyzed from this job description"
                            max={coverageSummary.total}
                            value={coveredCount}
                          />
                          <p className="selection-coverage-denominator">
                            {describeCoverageDenominator(coverageSummary.total)}
                          </p>
                          {coverageSummary.breakdowns.length > 0 && (
                            <p className="selection-coverage-breakdown">
                              {coverageSummary.breakdowns
                                .map((tally) => `${tally.count} ${tally.label}`)
                                .join(" · ")}
                            </p>
                          )}
                          {[
                            ...new Set(
                              coverageItems.map((item) => item.category),
                            ),
                          ].map((category) => (
                            <div className="coverage-category" key={category}>
                              <h5>{category}</h5>
                              <ul>
                                {coverageItems
                                  .filter((item) => item.category === category)
                                  .map((item) => {
                                    const tone = coverageStatusTone(
                                      item.status,
                                    );
                                    const status = coverageStatusLabel(
                                      item.status,
                                    );
                                    const evidenceIds = item.selectedEvidenceIds
                                      .length
                                      ? item.selectedEvidenceIds
                                      : item.availableIds;
                                    return (
                                      <li key={item.requirement}>
                                        <details>
                                          <summary>
                                            <span
                                              className={`coverage-status is-${tone}`}
                                            >
                                              <CoverageStatusIcon
                                                status={item.status}
                                              />
                                              {status}
                                            </span>
                                            <span>{item.requirement}</span>
                                          </summary>
                                          <p>
                                            {item.evidence.length
                                              ? `${item.reason ?? ""} ${item.evidence.map((evidence) => `${evidence.kind}: ${evidence.label} — ${evidence.quote}`).join("; ")}`
                                              : evidenceIds.length
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
                                          {item.facets.length > 0 && (
                                            <ul>
                                              {item.facets.map((facet) => (
                                                <li key={facet.label}>
                                                  {facet.matchedBy.length
                                                    ? "Evidence found"
                                                    : "Needs evidence"}
                                                  : {facet.label}
                                                </li>
                                              ))}
                                            </ul>
                                          )}
                                        </details>
                                      </li>
                                    );
                                  })}
                              </ul>
                            </div>
                          ))}
                        </>
                      ) : (
                        <p className="selection-coverage-denominator">
                          The job analysis did not extract any requirements or
                          responsibilities from this job description.
                        </p>
                      )}
                    </div>
                    {recommendedSkillIds.length > 0 && (
                      <div className="selection-skill-recommendations">
                        <h4>Job-relevant skills to add</h4>
                        {recommendation.recommendations.skillRecommendations.map(
                          (suggestion) => {
                            const skill = skillById.get(suggestion.skillId);
                            if (!skill) return null;
                            return (
                              <label
                                className="selection-skill-option"
                                key={skill.id}
                              >
                                <input
                                  aria-label={`Add ${skill.name} to skills`}
                                  checked={
                                    selectedSkillIds?.includes(skill.id) ??
                                    false
                                  }
                                  onChange={(event) => {
                                    setSelectedSkillIds((current) => {
                                      const base =
                                        current ??
                                        library.skills
                                          .filter(
                                            (item) =>
                                              item.isListedOnCurrentResume,
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
                    aria-label={
                      tailoringWorkflow === "auto"
                        ? "Auto Tailor review"
                        : "Guided Tailor review"
                    }
                    aria-live="polite"
                  >
                    <div className="guided-tailor-heading">
                      <div>
                        <h3>
                          {tailoringWorkflow === "auto"
                            ? "Auto Tailor review"
                            : "Guided Tailor"}
                        </h3>
                        <p>{tailoring.summary}</p>
                        {tailoring.resumeSummary && (
                          <div>
                            <h4>Resume summary</h4>
                            <p>{tailoring.resumeSummary}</p>
                            {tailoringWorkflow !== "auto" && (
                              <label>
                                <input
                                  type="checkbox"
                                  checked={summaryApproved}
                                  onChange={(event) => {
                                    setSummaryApproved(event.target.checked);
                                    setResult(null);
                                    clearPdfOutput();
                                  }}
                                />{" "}
                                Use this generated summary
                              </label>
                            )}
                          </div>
                        )}
                        {tailoring.qualityNotes?.map((note) => (
                          <p className="selection-fallback-notice" key={note}>
                            {note}
                          </p>
                        ))}
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
                      Review disclosed framework inferences before using them.
                      Only approved wording for selected points replaces the
                      originals in the generated resume.
                    </p>
                    {tailoring.notice && (
                      <p className="selection-fallback-notice" role="status">
                        {tailoring.notice}
                      </p>
                    )}
                    <details className="draft-handoff">
                      <summary>
                        Draft context ·{" "}
                        {tailoring.handoff.job.company || "Company"}
                        {tailoring.handoff.job.roleTitle
                          ? " · " + tailoring.handoff.job.roleTitle
                          : ""}
                      </summary>
                      <p>
                        Context {tailoring.handoff.job.contextId.slice(0, 12)} ·{" "}
                        {tailoring.handoff.selectedAchievements.length} selected
                        sources · {tailoring.handoff.suggestedEvidence.length}{" "}
                        evidence suggestions
                      </p>
                      <ul>
                        {tailoring.handoff.requirements.map((requirement) => (
                          <li key={requirement.id}>
                            <strong>
                              {requirement.status === "supported"
                                ? "Supported"
                                : requirement.status === "uncertain"
                                  ? "Uncertain"
                                  : requirement.status ===
                                      "evidence-not-selected"
                                    ? "Evidence not selected"
                                    : "No evidence found"}
                            </strong>
                            <span>{requirement.text}</span>
                            <small>
                              {requirement.reason}
                              {requirement.selectedAchievementIds.length
                                ? " Selected: " +
                                  requirement.selectedAchievementIds.join(
                                    ", ",
                                  ) +
                                  "."
                                : ""}
                              {requirement.availableAchievementIds.length &&
                              !requirement.selectedAchievementIds.length
                                ? " Available: " +
                                  requirement.availableAchievementIds.join(
                                    ", ",
                                  ) +
                                  "."
                                : ""}
                            </small>
                          </li>
                        ))}
                      </ul>
                      <p>
                        Estimated content budget:{" "}
                        {tailoring.handoff.contentBudgetLines} lines.
                      </p>
                    </details>
                    {tailoring.handoff.suggestedEvidence.length > 0 && (
                      <div className="draft-evidence-suggestions">
                        <h4>Other evidence to review</h4>
                        <p>
                          These points may help with open requirements. Add one
                          or explicitly replace a selected point; they are never
                          inserted automatically in Guided Tailor.
                        </p>
                        {tailoring.handoff.suggestedEvidence.map(
                          (suggestion) => {
                            const supportingRequirements =
                              tailoring.handoff.requirements.filter(
                                (requirement) =>
                                  suggestion.supportedRequirementIds.includes(
                                    requirement.id,
                                  ),
                              );
                            const replaceChoices = selectedIds.filter(
                              (id) => id !== suggestion.achievementId,
                            );
                            return (
                              <article key={suggestion.achievementId}>
                                <strong>
                                  {suggestion.groupTitle}
                                  {suggestion.groupSubtitle
                                    ? " · " + suggestion.groupSubtitle
                                    : ""}
                                </strong>
                                <p>{suggestion.text}</p>
                                <small>
                                  May support:{" "}
                                  {supportingRequirements
                                    .map((requirement) => requirement.text)
                                    .join("; ")}
                                </small>
                                <div className="guided-tailor-actions">
                                  <button
                                    disabled={isTailoring || isAutoTailoring}
                                    onClick={() =>
                                      applyDraftEvidenceAction(
                                        suggestion.achievementId,
                                      )
                                    }
                                    type="button"
                                  >
                                    Add to selection
                                  </button>
                                  {replaceChoices.length > 0 && (
                                    <select
                                      aria-label={
                                        "Replace a selected point with " +
                                        suggestion.groupTitle
                                      }
                                      defaultValue=""
                                      disabled={isTailoring || isAutoTailoring}
                                      onChange={(event) => {
                                        if (event.target.value) {
                                          applyDraftEvidenceAction(
                                            suggestion.achievementId,
                                            event.target.value,
                                          );
                                        }
                                      }}
                                    >
                                      <option value="">
                                        Replace selected point…
                                      </option>
                                      {replaceChoices.map((id) => (
                                        <option key={id} value={id}>
                                          {pointById.get(id)?.group.title ?? id}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                </div>
                              </article>
                            );
                          },
                        )}
                      </div>
                    )}
                    <div className="guided-tailor-proposals">
                      {tailoring.proposals.map((proposal) => {
                        const sourcePoint = pointById.get(
                          proposal.achievementId,
                        );
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
                        const proposedNormalized =
                          normalizeKeywordText(editedText);
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
                        const sourceContext =
                          tailoring.handoff.selectedAchievements.find(
                            (item) =>
                              item.achievementId === proposal.achievementId,
                          );
                        const supportedRequirements =
                          tailoring.handoff.requirements.filter((requirement) =>
                            sourceContext?.supportedRequirementIds.includes(
                              requirement.id,
                            ),
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
                                {(
                                  proposal.sourceAchievementIds ?? [
                                    proposal.achievementId,
                                  ]
                                )
                                  .flatMap(
                                    (id) =>
                                      pointById.get(id)?.point.metrics ?? [],
                                  )
                                  .map((metric) => (
                                    <p
                                      className="guided-tailor-rationale"
                                      key={metric.id}
                                    >
                                      Recorded metric: {metric.label} —{" "}
                                      {metric.value}
                                      {metric.unit === "%"
                                        ? "%"
                                        : ` ${metric.unit ?? ""}`}
                                    </p>
                                  ))}
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
                                      [proposal.achievementId]:
                                        event.target.value,
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
                            {proposal.inferredTerms?.length ? (
                              <p className="selection-fallback-notice">
                                Inferred, not directly recorded:{" "}
                                {proposal.inferredTerms.join(", ")}. Check that
                                this describes your work.
                              </p>
                            ) : null}
                            <p className="guided-tailor-rationale">
                              Source: {sourceContext?.section ?? "resume"} ·{" "}
                              {sourceContext?.groupId ?? proposal.achievementId}
                              {sourceContext?.selectionConfidence !== undefined
                                ? " · " +
                                  Math.round(
                                    sourceContext.selectionConfidence * 100,
                                  ) +
                                  "% selection confidence"
                                : ""}
                            </p>
                            <p className="guided-tailor-rationale">
                              Supports:{" "}
                              {supportedRequirements.length
                                ? supportedRequirements
                                    .map((requirement) => requirement.text)
                                    .join("; ")
                                : "No direct requirement match identified; wording stays grounded in the source."}
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
                                No new exact JD terms were detected in this
                                wording.
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
              </>
            )}

            {result && (
              <ResumeStudio
                key={studioSession}
                library={library}
                source={source}
                generation={result}
                hasPdf={Boolean(pdfUrl)}
                isCompiling={isCompiling}
                analysis={analysis}
                recommendedSkillIds={recommendedSkillIds}
                qualityNotes={tailoring?.qualityNotes}
                onSetup={() => setShowGenerationSettings((current) => !current)}
                onApplied={(generation, base64) => {
                  const bytes = Uint8Array.from(atob(base64), (character) =>
                    character.charCodeAt(0),
                  );
                  const appliedGeneration = {
                    ...generation,
                    metadata: {
                      ...generation.metadata,
                      aiProvider: result?.metadata.aiProvider ?? null,
                    },
                  };
                  setResult(appliedGeneration);
                  setPdfBase64(base64);
                  void persistGeneration(appliedGeneration, "compiled", base64);
                  setPdfUrl(
                    URL.createObjectURL(
                      new Blob([bytes], { type: "application/pdf" }),
                    ),
                  );
                  setOutputView("pdf");
                  setCompileError(null);
                  setCompileStatus(
                    describeCompiledPdf({
                      pageCount: generation.metadata.layout?.pageCount ?? null,
                      utilization:
                        generation.metadata.layout?.utilization ?? null,
                    }),
                  );
                }}
              />
            )}
            {(!result || showGenerationSettings) && groups.length > 0 && (
              <div className="generation-selection-filters">
                <div className="generation-search-field">
                  <Search aria-hidden="true" size={14} strokeWidth={2} />
                  <input
                    aria-label="Search achievements"
                    onChange={(event) => setPointQuery(event.target.value)}
                    placeholder="Search achievements…"
                    type="search"
                    value={pointQuery}
                  />
                </div>
                <select
                  aria-label="Filter by experience"
                  className="generation-experience-filter"
                  onChange={(event) => setExperienceFilter(event.target.value)}
                  value={experienceFilter}
                >
                  <option value="">All experiences</option>
                  {experienceOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {hasPointFilter && (
                  <button
                    className="generation-filter-reset"
                    onClick={resetPointFilters}
                    type="button"
                  >
                    Reset filters
                  </button>
                )}
                {hasPointFilter && (
                  <p className="generation-filter-count" role="status">
                    {visiblePointCount} of {enabledIds.length} achievements
                    match
                  </p>
                )}
              </div>
            )}

            {(!result || showGenerationSettings) &&
              (groups.length === 0 ? (
                <p className="generation-empty" role="status">
                  This library has no enabled achievement points.
                </p>
              ) : visibleGroups.length === 0 ? (
                <p className="generation-no-matches" role="status">
                  No achievements match this search.
                </p>
              ) : (
                <div className="generation-groups">
                  {visibleGroups.map((group) => (
                    <fieldset className="generation-group" key={group.id}>
                      <legend>
                        <span
                          className={`generation-group-kind is-${group.kind.toLowerCase()}`}
                        >
                          {group.kind === "JOB" ? (
                            <BriefcaseBusiness aria-hidden="true" size={13} />
                          ) : (
                            <FolderKanban aria-hidden="true" size={13} />
                          )}
                          {group.kind}
                        </span>
                        <strong>{group.title}</strong>
                        {group.subtitle && (
                          <small className="generation-group-subtitle">
                            {group.subtitle}
                          </small>
                        )}
                        <span className="generation-group-count">
                          {group.points.length}{" "}
                          {group.points.length === 1 ? "point" : "points"}
                        </span>
                      </legend>
                      <div className="generation-points">
                        {group.points.map((point) => (
                          <label className="generation-point" key={point.id}>
                            <input
                              aria-label={`Select achievement ${point.id}: ${point.text}`}
                              checked={selectedIds.includes(point.id)}
                              disabled={
                                isRecommending || isTailoring || isAutoTailoring
                              }
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
              ))}
          </section>

          {result && (
            <div
              className="studio-panel-resizer"
              role="slider"
              aria-label="Resize resume preview"
              aria-orientation="horizontal"
              aria-valuemin={30}
              aria-valuemax={60}
              aria-valuenow={previewShare}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  setPreviewShare((value) =>
                    Math.max(
                      30,
                      Math.min(
                        60,
                        value + (event.key === "ArrowLeft" ? 2 : -2),
                      ),
                    ),
                  );
                }
              }}
              onPointerDown={(event) =>
                event.currentTarget.setPointerCapture(event.pointerId)
              }
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId))
                  return;
                const parent =
                  event.currentTarget.parentElement!.getBoundingClientRect();
                setPreviewShare(
                  Math.max(
                    30,
                    Math.min(
                      60,
                      ((parent.right - event.clientX) / parent.width) * 100,
                    ),
                  ),
                );
              }}
              onPointerUp={(event) =>
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
            />
          )}

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
                <a className="preview-return-link" href="#resume-editing">
                  Back to editing
                </a>
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
                      ref={latexTabRef}
                      aria-selected={outputView === "latex"}
                      aria-controls="resume-output-panel"
                      onClick={() => setOutputView("latex")}
                      onKeyDown={handleOutputTabKeyDown}
                      role="tab"
                      tabIndex={outputView === "latex" ? 0 : -1}
                      type="button"
                    >
                      LaTeX
                    </button>
                    <button
                      id="resume-output-tab-pdf"
                      ref={pdfTabRef}
                      aria-selected={outputView === "pdf"}
                      aria-controls="resume-output-panel"
                      disabled={!pdfUrl}
                      onClick={() => setOutputView("pdf")}
                      onKeyDown={handleOutputTabKeyDown}
                      role="tab"
                      title={
                        pdfUrl
                          ? "Show the compiled PDF"
                          : "Compile the PDF to preview it here"
                      }
                      tabIndex={outputView === "pdf" ? 0 : -1}
                      type="button"
                    >
                      PDF
                    </button>
                  </div>
                  <button
                    aria-describedby={
                      pdfUrl ? undefined : "generation-pdf-availability"
                    }
                    aria-label="Download PDF"
                    className="generation-action generation-action-download"
                    disabled={!pdfUrl || isCompiling}
                    onClick={downloadPdf}
                    title={
                      pdfUrl
                        ? "Download the compiled PDF"
                        : "Compile the PDF to enable this download"
                    }
                    type="button"
                  >
                    Download PDF
                  </button>
                  <button
                    aria-busy={isCompiling}
                    className="generation-action generation-action-compile"
                    disabled={isCompiling || isGenerating}
                    onClick={() => compilePdf()}
                    title="Compile the current generated LaTeX into a PDF"
                    type="button"
                  >
                    {compileActionLabel}
                  </button>
                  {outputView === "latex" && (
                    <>
                      <button
                        aria-label="Copy LaTeX"
                        className="generation-action generation-action-utility"
                        onClick={copyLatex}
                        title="Copy LaTeX"
                        type="button"
                      >
                        Copy
                      </button>
                      <button
                        aria-label="Download LaTeX file"
                        className="generation-action generation-action-utility"
                        onClick={downloadLatex}
                        title="Download LaTeX file"
                        type="button"
                      >
                        Download LaTeX
                      </button>
                    </>
                  )}
                  <button
                    aria-label="Download export package"
                    className="generation-action generation-action-utility"
                    disabled={isCompiling}
                    onClick={downloadExportPackage}
                    title={
                      isCompiling
                        ? "Wait for the current compile to finish."
                        : "Download LaTeX, PDF when available, and generation metadata"
                    }
                    type="button"
                  >
                    Export package
                  </button>
                </div>
              )}
            </div>

            {result && !pdfUrl && (
              <p
                className="generation-action-hint"
                id="generation-pdf-availability"
              >
                {isCompiling
                  ? "Compiling your generated LaTeX into a PDF…"
                  : "No compiled PDF yet. Choose “Create PDF” to compile your generated LaTeX; the PDF download and the PDF inside the export package stay unavailable until it succeeds."}
              </p>
            )}

            {copyMessage && (
              <p className="generation-notice" role="status">
                {copyMessage}
              </p>
            )}
            {requestError ? (
              <StatusBanner
                tone="error"
                role="alert"
                className="preview-status"
              >
                <p>{requestError}</p>
              </StatusBanner>
            ) : compileError ? (
              <StatusBanner
                tone="error"
                role="alert"
                className="preview-status"
              >
                <p>{compileError.error}</p>
                {compileError.diagnostics && (
                  <details>
                    <summary>Compiler details</summary>
                    <pre>{compileError.diagnostics}</pre>
                  </details>
                )}
              </StatusBanner>
            ) : isCompiling ? (
              <StatusBanner
                tone="info"
                role="status"
                className="preview-status"
              >
                <p>Compiling the PDF…</p>
                <p className="preview-status-detail">
                  The document is being prepared from your generated LaTeX. This
                  may take a few seconds.
                </p>
              </StatusBanner>
            ) : result ? (
              <StatusBanner
                tone="success"
                role="status"
                className="preview-status"
              >
                {outputView === "pdf" && pdfUrl
                  ? compileStatus || "PDF ready."
                  : "LaTeX ready."}
              </StatusBanner>
            ) : null}
            {viewerNotice && (
              <StatusBanner
                tone="caution"
                role="status"
                className="preview-status"
              >
                {viewerNotice}
              </StatusBanner>
            )}
            {result ? (
              <div
                className="generation-output-panel"
                role="tabpanel"
                id="resume-output-panel"
                aria-labelledby={`resume-output-tab-${outputView}`}
              >
                <div
                  className="status-banner status-banner--info generation-origin"
                  role="status"
                  aria-label="Generation method"
                >
                  <Info
                    aria-hidden="true"
                    className="status-banner-icon"
                    size={14}
                    strokeWidth={2}
                  />
                  <div className="status-banner-body">
                    {getGenerationOriginNotice(
                      result.metadata.tailoringMode,
                      tailoring?.mode,
                    )}
                  </div>
                </div>
                {result.metadata.qualityReport && (
                  <details className="generation-quality">
                    <summary>
                      Final resume checks ·{" "}
                      {
                        Object.values(result.metadata.qualityReport)
                          .flat()
                          .filter((check) => check.status !== "pass").length
                      }{" "}
                      need review
                    </summary>
                    {(
                      [
                        [
                          "PDF readability",
                          result.metadata.qualityReport.machine,
                        ],
                        [
                          "Recruiter skim",
                          result.metadata.qualityReport.recruiter,
                        ],
                        [
                          "Claim credibility",
                          result.metadata.qualityReport.credibility,
                        ],
                      ] as const
                    ).map(([title, checks]) => (
                      <section key={title}>
                        <h4>{title}</h4>
                        <ul>
                          {checks.map((check) => (
                            <li key={check.id}>
                              <strong>
                                {check.status === "pass" ? "Checked" : "Review"}
                                :
                              </strong>{" "}
                              {check.message}
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </details>
                )}
                {omittedSkillCount > 0 ? (
                  <StatusBanner
                    tone="caution"
                    role="status"
                    className="generation-metadata-notice"
                  >
                    <p className="generation-metadata">
                      Generated{" "}
                      {new Date(result.metadata.generatedAt).toLocaleString()} ·{" "}
                      {renderedAchievementCount} achievement
                      {renderedAchievementCount === 1 ? "" : "s"}
                      {" · "}
                      {result.metadata.renderedSkillIds.length} skills shown
                      {" · "}
                      {omittedSkillCount} omitted to keep two rows
                    </p>
                  </StatusBanner>
                ) : (
                  <p className="generation-metadata">
                    Generated{" "}
                    {new Date(result.metadata.generatedAt).toLocaleString()} ·{" "}
                    {renderedAchievementCount} achievement
                    {renderedAchievementCount === 1 ? "" : "s"}
                    {" · "}
                    {result.metadata.renderedSkillIds.length} skills shown
                  </p>
                )}
                {outputView === "pdf" && pdfUrl ? (
                  <div className="pdf-preview-workspace">
                    <div className="pdf-preview-viewport" ref={pdfViewportRef}>
                      <div
                        className="pdf-preview-toolbar"
                        role="group"
                        aria-label="PDF viewer controls"
                      >
                        <div
                          className="pdf-zoom-control"
                          role="group"
                          aria-label="PDF zoom controls"
                        >
                          <button
                            className="pdf-toolbar-icon"
                            aria-label="Zoom out"
                            disabled={pdfZoom <= 50}
                            onClick={() => {
                              setPdfFit(null);
                              setPdfZoom((zoom) => Math.max(50, zoom - 10));
                            }}
                            title="Zoom out"
                            type="button"
                          >
                            <Minus
                              aria-hidden="true"
                              size={14}
                              strokeWidth={2}
                            />
                          </button>
                          <span className="pdf-zoom-value" aria-live="polite">
                            {pdfFit
                              ? pdfFit === "width"
                                ? "Fit width"
                                : "Fit page"
                              : `${pdfZoom}%`}
                          </span>
                          <button
                            className="pdf-toolbar-icon"
                            aria-label="Zoom in"
                            disabled={pdfZoom >= 200}
                            onClick={() => {
                              setPdfFit(null);
                              setPdfZoom((zoom) => Math.min(200, zoom + 10));
                            }}
                            title="Zoom in"
                            type="button"
                          >
                            <Plus
                              aria-hidden="true"
                              size={14}
                              strokeWidth={2}
                            />
                          </button>
                          <span
                            className="pdf-toolbar-divider"
                            aria-hidden="true"
                          />
                          <button
                            type="button"
                            className="pdf-fit-button"
                            aria-pressed={pdfFit === "width"}
                            onClick={() => setPdfFit("width")}
                            title="Fit the full page width to the preview"
                          >
                            Fit width
                          </button>
                          <button
                            type="button"
                            className="pdf-fit-button"
                            aria-pressed={pdfFit === "page"}
                            onClick={() => setPdfFit("page")}
                            title="Fit the whole page inside the preview"
                          >
                            Fit page
                          </button>
                        </div>
                        <button
                          className="pdf-toolbar-action"
                          onClick={togglePdfFullscreen}
                          title={
                            isPdfFullscreen
                              ? "Exit full screen"
                              : "Open full screen"
                          }
                          type="button"
                        >
                          {isPdfFullscreen ? (
                            <Minimize2
                              aria-hidden="true"
                              size={14}
                              strokeWidth={2}
                            />
                          ) : (
                            <Maximize2
                              aria-hidden="true"
                              size={14}
                              strokeWidth={2}
                            />
                          )}
                          <span>
                            {isPdfFullscreen
                              ? "Exit full screen"
                              : "Open full screen"}
                          </span>
                        </button>
                      </div>
                      <iframe
                        className="pdf-preview-frame"
                        src={`${pdfUrl}#${pdfFit ? `view=${pdfFit === "width" ? "FitH" : "Fit"}` : `zoom=${pdfZoom}`}&toolbar=0`}
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
              <div
                className="generation-preview-empty"
                role={isGenerating ? "status" : undefined}
              >
                {isGenerating ? (
                  <>
                    <LoaderCircle
                      aria-hidden="true"
                      className="generation-preview-empty-icon is-spinning"
                      size={20}
                      strokeWidth={2}
                    />
                    <p>Generating your resume…</p>
                    <p className="preview-status-detail">
                      Your LaTeX will appear here as soon as it is ready.
                    </p>
                  </>
                ) : (
                  <>
                    <FileText
                      aria-hidden="true"
                      className="generation-preview-empty-icon"
                      size={20}
                      strokeWidth={1.75}
                    />
                    <p>Your generated LaTeX will appear here.</p>
                  </>
                )}
              </div>
            )}
          </section>
        </div>

        {(!result || showGenerationSettings) && (
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
        )}
      </form>
    </section>
  );
}
