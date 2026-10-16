import { createHash } from "node:crypto";
import { fitResumeToPage } from "@/lib/generation/fit-resume";
import { PdfCompileError } from "@/lib/pdf/compile-service";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AchievementSelectionResponseSchema,
  AutoTailorResponseSchema,
  JobAnalysisResultSchema,
  ResumeDraftJobRequestSchema,
} from "@/lib/ai/contracts";
import { createAiProvider } from "@/lib/ai/provider-factory";
import { AiProviderError } from "@/lib/ai/provider";
import {
  buildAchievementSelectionInput,
  recommendAchievements,
} from "@/lib/ai/achievement-selection";
import {
  AchievementTailoringError,
  buildResumeDraftInput,
  createOriginalsFallbackResponse,
  createTailoringResponse,
  TailorAchievementsRequestSchema,
} from "@/lib/ai/tailor-achievements";
import { DataLoadError, loadResumeLibrary } from "@/lib/data/loaders";
import { MAX_JD_CHARACTERS } from "@/lib/jd-draft";
import { createJobContextId } from "@/lib/ai/job-context";
import { createServerTrace } from "@/lib/diagnostics/server-trace";

export const runtime = "nodejs";

const AutoTailorRequestSchema = z
  .object({
    dataSource: z.enum(["personal", "demo"]).default("personal"),
    generatePdf: z.boolean().default(false),
    jobDescription: z.string().trim().min(1).max(MAX_JD_CHARACTERS),
    analysis: JobAnalysisResultSchema,
    job: ResumeDraftJobRequestSchema,
  })
  .strict();

export async function POST(request: Request) {
  const trace = createServerTrace();
  const runId = request.headers.get("x-resume-run-id") ?? "unknown";
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: "Request body must be valid JSON.",
        code: "INVALID_REQUEST",
        diagnostics: runId === "unknown" ? undefined : trace.events,
      },
      { status: 400 },
    );
  }
  trace.record(
    "auto-tailor.request",
    "Received Auto Tailor request body.",
    body,
  );

  const parsed = AutoTailorRequestSchema.safeParse(body);
  if (!parsed.success) {
    trace.record(
      "auto-tailor.validation",
      "Request failed schema validation.",
      parsed.error.issues,
    );
    return NextResponse.json(
      {
        error: "Provide the active job, its analysis, and a data source.",
        code: "INVALID_REQUEST",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
        diagnostics: runId === "unknown" ? undefined : trace.events,
      },
      { status: 400 },
    );
  }

  try {
    const expectedContextId = await createJobContextId({
      ...parsed.data.job,
      jobDescription: parsed.data.jobDescription,
      analysis: parsed.data.analysis,
    });
    trace.record(
      "auto-tailor.context",
      "Recomputed active job context fingerprint.",
      {
        expectedContextId,
        requestContextId: parsed.data.job.contextId,
        matches: expectedContextId === parsed.data.job.contextId,
      },
    );
    if (expectedContextId !== parsed.data.job.contextId) {
      return NextResponse.json(
        {
          error: "The job or analysis changed. Reanalyze the active job first.",
          code: "STALE_CONTEXT",
          diagnostics: runId === "unknown" ? undefined : trace.events,
        },
        { status: 409 },
      );
    }

    const library = await loadResumeLibrary({ source: parsed.data.dataSource });
    trace.record("auto-tailor.library", "Loaded resume evidence library.", {
      source: parsed.data.dataSource,
      profile: library.profile,
      jobs: library.jobs,
      projects: library.projects,
      skills: library.skills,
      credentials: library.credentials,
    });
    const selectionInput = buildAchievementSelectionInput({
      library,
      jobDescription: parsed.data.jobDescription,
      analysis: parsed.data.analysis,
    });
    trace.record(
      "auto-tailor.selection-input",
      "Built candidate evidence, skills, requirements, and content budget for selection.",
      selectionInput,
    );
    let provider: ReturnType<typeof createAiProvider> | undefined;
    let providerCreationError: unknown;
    try {
      provider = createAiProvider(undefined, (event) =>
        trace.events.push(event),
      );
      trace.record("auto-tailor.provider", "Selected AI provider.", {
        provider: provider.name,
      });
    } catch (error) {
      providerCreationError = error;
      trace.record(
        "auto-tailor.provider-error",
        "AI provider could not be initialized.",
        {
          error:
            error instanceof AiProviderError
              ? { code: error.code, message: error.message }
              : "unknown provider error",
        },
      );
    }
    const selection = await recommendAchievements({
      input: selectionInput,
      selectWithAi: () => {
        if (!provider) throw providerCreationError;
        return provider.selectAchievements(selectionInput);
      },
    });
    trace.record(
      "auto-tailor.selection-result",
      "Selection, fallback, budget, and requirement evidence results.",
      selection,
    );
    const { audit: selectionAudit, ...selectionResponse } = selection;
    trace.record(
      "auto-tailor.selection-audit",
      "Candidate-by-candidate scoring and inclusion decisions.",
      selectionAudit,
    );
    const recommendation =
      AchievementSelectionResponseSchema.parse(selectionResponse);
    const achievementIds = recommendation.recommendations.selections.map(
      (item) => item.achievementId,
    );
    if (achievementIds.length === 0) {
      return NextResponse.json(
        {
          error:
            "No enabled source points matched this job description. Review the library or choose points manually.",
          code: "NO_SUPPORTED_ACHIEVEMENTS",
          diagnostics: runId === "unknown" ? undefined : trace.events,
        },
        { status: 422 },
      );
    }

    const draftRequest = TailorAchievementsRequestSchema.parse({
      dataSource: parsed.data.dataSource,
      jobDescription: parsed.data.jobDescription,
      analysis: parsed.data.analysis,
      job: parsed.data.job,
      selectionContext: recommendation,
      achievementIds,
    });
    const draftInput = await buildResumeDraftInput(library, draftRequest);
    trace.record(
      "auto-tailor.draft-input",
      "Built evidence-grounded drafting input and requirement coverage handoff.",
      draftInput,
    );
    let tailoring;
    if (selection.mode === "local-fallback" || !provider) {
      const notice =
        selection.notice ??
        (providerCreationError instanceof AiProviderError
          ? providerCreationError.message
          : "AI is unavailable.");
      tailoring = createOriginalsFallbackResponse({
        input: draftInput,
        notice: `${notice} Auto Tailor kept the selected source wording unchanged.`,
      });
      trace.record(
        "auto-tailor.draft-fallback",
        "AI draft skipped; original wording retained.",
        {
          mode: tailoring.mode,
          notice: tailoring.notice,
          proposals: tailoring.proposals,
        },
      );
    } else {
      try {
        const draftResult = await provider.draftResume(draftInput);
        trace.record(
          "auto-tailor.draft-result",
          "Received structured AI achievement draft.",
          draftResult,
        );
        tailoring = createTailoringResponse({
          input: draftInput,
          result: draftResult,
          repairInvalid: true,
        });
        trace.record(
          "auto-tailor.evidence-validation",
          "Validated proposed wording against source evidence and allowed terms.",
          tailoring,
        );
      } catch (error) {
        if (
          (error instanceof AiProviderError &&
            (error.retryable || error.code === "MISSING_API_KEY")) ||
          (error instanceof AchievementTailoringError &&
            error.code === "INVALID_AI_OUTPUT")
        ) {
          tailoring = createOriginalsFallbackResponse({
            input: draftInput,
            notice:
              error instanceof AiProviderError
                ? `${error.message} Auto Tailor kept the selected source wording unchanged.`
                : "The AI draft did not pass evidence checks. Auto Tailor kept the selected source wording unchanged.",
          });
          trace.record(
            "auto-tailor.draft-fallback",
            "AI draft failed or did not pass evidence checks; original wording retained.",
            {
              error:
                error instanceof AiProviderError
                  ? {
                      code: error.code,
                      message: error.message,
                      diagnosticCode: error.diagnosticCode,
                    }
                  : error instanceof AchievementTailoringError
                    ? { code: error.code, message: error.message }
                    : "unknown draft error",
              proposals: tailoring.proposals,
            },
          );
        } else {
          throw error;
        }
      }
    }

    const selectedSkillIds = [
      ...new Set([
        ...library.skills
          .filter((skill) => skill.isListedOnCurrentResume)
          .map((skill) => skill.id),
        ...recommendation.recommendations.skillRecommendations.map(
          (skill) => skill.skillId,
        ),
      ]),
    ];
    let compiled:
      | {
          latex: string;
          metadata: import("@/lib/generation/manual-generation").ManualGenerationMetadata;
          pdfBase64: string;
        }
      | undefined;
    if (parsed.data.generatePdf) {
      const fitted = await fitResumeToPage({
        library,
        input: selectionInput,
        scores: new Map(
          selection.audit.map((item) => [item.achievementId, item.localScore]),
        ),
        request: {
          dataSource: parsed.data.dataSource,
          company: parsed.data.job.company,
          roleTitle: parsed.data.job.roleTitle,
          jobUrl: parsed.data.job.jobUrl,
          jobDescription: parsed.data.jobDescription,
          tailoringMode: "auto",
          selectedAchievementIds: achievementIds,
          selectedSkillIds,
          summaryOverride: tailoring.resumeSummary,
          achievementTextOverrides: tailoring.proposals.map((proposal) => ({
            achievementId: proposal.achievementId,
            sourceAchievementIds: proposal.sourceAchievementIds,
            inferredTerms: proposal.inferredTerms,
            text: proposal.proposedText,
          })),
        },
        onDiagnostic: (event) =>
          trace.record(event.stage, event.message, event.data),
      });
      compiled = {
        ...fitted.generation,
        pdfBase64: fitted.pdf.toString("base64"),
      };
      trace.record(
        "auto-tailor.pdf-result",
        "Prepared the final measured PDF.",
        {
          metadata: fitted.generation.metadata,
          byteLength: fitted.pdf.length,
          sha256: createHash("sha256").update(fitted.pdf).digest("hex"),
        },
      );
    }
    const response = AutoTailorResponseSchema.parse({
      recommendation,
      tailoring,
      selectedSkillIds,
      draftingMode: tailoring.mode,
      compiled,
    });
    trace.record(
      "auto-tailor.response",
      "Completed Auto Tailor response after contract validation.",
      {
        ...response,
        compiled: response.compiled
          ? {
              ...response.compiled,
              pdfBase64: "[PDF bytes omitted; see hash and size]",
            }
          : undefined,
      },
    );
    return NextResponse.json({
      ...response,
      ...(runId !== "unknown" ? { diagnostics: trace.events, runId } : {}),
    });
  } catch (error) {
    trace.record("auto-tailor.error", "Auto Tailor request failed.", {
      error: error instanceof Error ? error.message : "Unknown error",
      code:
        error instanceof AiProviderError ||
        error instanceof AchievementTailoringError
          ? error.code
          : undefined,
    });
    if (error instanceof PdfCompileError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          diagnostics: runId === "unknown" ? undefined : trace.events,
        },
        { status: error.status },
      );
    }
    if (error instanceof DataLoadError) {
      return NextResponse.json(
        {
          error: error.message,
          code: "RESUME_DATA_UNAVAILABLE",
          diagnostics: runId === "unknown" ? undefined : trace.events,
        },
        { status: 409 },
      );
    }
    if (error instanceof AchievementTailoringError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          retryable: false,
          diagnostics: runId === "unknown" ? undefined : trace.events,
        },
        { status: error.code === "STALE_CONTEXT" ? 409 : 422 },
      );
    }
    if (error instanceof AiProviderError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          retryable: error.retryable,
          diagnostics: runId === "unknown" ? undefined : trace.events,
        },
        { status: error.code === "INPUT_TOO_LARGE" ? 413 : 503 },
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "The resume context could not be prepared for Auto Tailor.",
          code: "INVALID_RESUME_DATA",
          diagnostics: runId === "unknown" ? undefined : trace.events,
        },
        { status: 422 },
      );
    }
    return NextResponse.json(
      {
        error: "Auto Tailor could not prepare this resume. Try again.",
        diagnostics: runId === "unknown" ? undefined : trace.events,
      },
      { status: 500 },
    );
  }
}
