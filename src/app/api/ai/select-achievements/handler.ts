import { protectAccountRoute } from "@/lib/cloud/protect-route";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildAchievementSelectionInput,
  recommendAchievements,
} from "@/lib/ai/achievement-selection";
import {
  AchievementSelectionResponseSchema,
  JobAnalysisResultSchema,
} from "@/lib/ai/contracts";
import { createAiProvider } from "@/lib/ai/provider-factory";
import { AiProviderError } from "@/lib/ai/provider";
import { DataLoadError, loadResumeLibrary } from "@/lib/data/loaders";
import { MAX_JD_CHARACTERS } from "@/lib/jd-draft";

export const runtime = "nodejs";

const SelectionRequestSchema = z
  .object({
    dataSource: z.enum(["personal", "demo"]).default("personal"),
    jobDescription: z.string().trim().min(1).max(MAX_JD_CHARACTERS),
    analysis: JobAnalysisResultSchema,
    allowLocalFallback: z.boolean().default(false),
  })
  .strict();

async function POSTForAccount(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON.", code: "INVALID_REQUEST" },
      { status: 400 },
    );
  }

  const parsed = SelectionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Provide a valid job description and its structured analysis.",
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
    const library = await loadResumeLibrary({
      source: parsed.data.dataSource,
    });
    const hasEnabledPoints = [...library.jobs, ...library.projects].some(
      (group) => group.points.some((point) => point.enabled),
    );
    if (!hasEnabledPoints) {
      return NextResponse.json(
        {
          error:
            "Enable at least one job or project point before requesting recommendations.",
          code: "NO_ENABLED_ACHIEVEMENTS",
        },
        { status: 422 },
      );
    }
    const input = buildAchievementSelectionInput({
      library,
      jobDescription: parsed.data.jobDescription,
      analysis: parsed.data.analysis,
    });
    const response = await recommendAchievements({
      input,
      allowLocalFallback: parsed.data.allowLocalFallback,
      selectWithAi: () => createAiProvider().selectAchievements(input),
    });
    const { audit: _audit, ...responseBody } = response;
    return NextResponse.json(
      AchievementSelectionResponseSchema.parse(responseBody),
    );
  } catch (error) {
    if (error instanceof DataLoadError) {
      return NextResponse.json(
        { error: error.message, code: "RESUME_DATA_UNAVAILABLE" },
        { status: 409 },
      );
    }
    if (error instanceof AiProviderError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          retryable: error.retryable,
          fallbackAvailable: !parsed.data.allowLocalFallback,
          fallbackType: "local-matching",
        },
        { status: error.code === "INPUT_TOO_LARGE" ? 413 : 503 },
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error:
            "There are too many resume points to analyze at once. Narrow or tidy the library and try again.",
          code: "INVALID_LIBRARY_CONTEXT",
        },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { error: "Achievement recommendations failed. Try again." },
      { status: 500 },
    );
  }
}

export const POST = protectAccountRoute(POSTForAccount);
