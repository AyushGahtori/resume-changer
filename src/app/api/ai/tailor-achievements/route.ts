import { NextResponse } from "next/server";
import { z } from "zod";
import { createAiProvider } from "@/lib/ai/provider-factory";
import { AiProviderError } from "@/lib/ai/provider";
import {
  AchievementTailoringError,
  buildResumeDraftInput,
  createTailoringResponse,
  TailorAchievementsRequestSchema,
} from "@/lib/ai/tailor-achievements";
import { DataLoadError, loadResumeLibrary } from "@/lib/data/loaders";

export const runtime = "nodejs";

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

  const parsed = TailorAchievementsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Provide a job description, its analysis, and selected points.",
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
    const library = await loadResumeLibrary({ source: parsed.data.dataSource });
    const input = buildResumeDraftInput(library, parsed.data);
    const result = await createAiProvider().draftResume(input);
    return NextResponse.json(createTailoringResponse({ input, result }));
  } catch (error) {
    if (error instanceof AchievementTailoringError) {
      const status = error.code === "INVALID_SELECTION" ? 422 : 502;
      return NextResponse.json(
        { error: error.message, code: error.code, retryable: false },
        { status },
      );
    }
    if (error instanceof DataLoadError) {
      return NextResponse.json(
        { error: error.message, code: "RESUME_DATA_UNAVAILABLE" },
        { status: 409 },
      );
    }
    if (error instanceof AiProviderError) {
      const invalidResponse = error.code === "INVALID_RESPONSE";
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          retryable: error.retryable,
        },
        {
          status: invalidResponse
            ? 502
            : error.code === "INPUT_TOO_LARGE"
              ? 413
              : 503,
        },
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error:
            "The selected resume data could not be prepared for tailoring.",
          code: "INVALID_RESUME_DATA",
        },
        { status: 422 },
      );
    }
    return NextResponse.json(
      {
        error: "Tailored wording could not be prepared. Try again.",
        code: "TAILORING_FAILED",
      },
      { status: 500 },
    );
  }
}
