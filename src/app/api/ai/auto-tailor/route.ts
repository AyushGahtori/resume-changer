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

export const runtime = "nodejs";

const AutoTailorRequestSchema = z
  .object({
    dataSource: z.enum(["personal", "demo"]).default("personal"),
    jobDescription: z.string().trim().min(1).max(MAX_JD_CHARACTERS),
    analysis: JobAnalysisResultSchema,
    job: ResumeDraftJobRequestSchema,
  })
  .strict();

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON.", code: "INVALID_REQUEST" },
      { status: 400 },
    );
  }

  const parsed = AutoTailorRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Provide the active job, its analysis, and a data source.",
        code: "INVALID_REQUEST",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
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
    if (expectedContextId !== parsed.data.job.contextId) {
      return NextResponse.json(
        {
          error: "The job or analysis changed. Reanalyze the active job first.",
          code: "STALE_CONTEXT",
        },
        { status: 409 },
      );
    }

    const library = await loadResumeLibrary({ source: parsed.data.dataSource });
    const selectionInput = buildAchievementSelectionInput({
      library,
      jobDescription: parsed.data.jobDescription,
      analysis: parsed.data.analysis,
    });
    let provider: ReturnType<typeof createAiProvider> | undefined;
    let providerCreationError: unknown;
    try {
      provider = createAiProvider();
    } catch (error) {
      providerCreationError = error;
    }
    const selection = await recommendAchievements({
      input: selectionInput,
      selectWithAi: () => {
        if (!provider) throw providerCreationError;
        return provider.selectAchievements(selectionInput);
      },
    });
    const recommendation = AchievementSelectionResponseSchema.parse(selection);
    const achievementIds = recommendation.recommendations.selections.map(
      (item) => item.achievementId,
    );
    if (achievementIds.length === 0) {
      return NextResponse.json(
        {
          error:
            "No enabled source points matched this job description. Review the library or choose points manually.",
          code: "NO_SUPPORTED_ACHIEVEMENTS",
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
    } else {
      try {
        tailoring = createTailoringResponse({
          input: draftInput,
          result: await provider.draftResume(draftInput),
        });
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
    return NextResponse.json(
      AutoTailorResponseSchema.parse({
        recommendation,
        tailoring,
        selectedSkillIds,
        draftingMode: tailoring.mode,
      }),
    );
  } catch (error) {
    if (error instanceof DataLoadError) {
      return NextResponse.json(
        { error: error.message, code: "RESUME_DATA_UNAVAILABLE" },
        { status: 409 },
      );
    }
    if (error instanceof AchievementTailoringError) {
      return NextResponse.json(
        { error: error.message, code: error.code, retryable: false },
        { status: error.code === "STALE_CONTEXT" ? 409 : 422 },
      );
    }
    if (error instanceof AiProviderError) {
      return NextResponse.json(
        { error: error.message, code: error.code, retryable: error.retryable },
        { status: error.code === "INPUT_TOO_LARGE" ? 413 : 503 },
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "The resume context could not be prepared for Auto Tailor.",
          code: "INVALID_RESUME_DATA",
        },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { error: "Auto Tailor could not prepare this resume. Try again." },
      { status: 500 },
    );
  }
}
