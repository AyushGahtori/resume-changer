import { NextResponse } from "next/server";
import {
  JobAnalysisInputSchema,
  JobAnalysisResultSchema,
} from "@/lib/ai/contracts";
import { createAiProvider } from "@/lib/ai/provider-factory";
import { AiProviderError } from "@/lib/ai/provider";

export const runtime = "nodejs";

function statusForError(error: AiProviderError) {
  switch (error.code) {
    case "INPUT_TOO_LARGE":
      return 413;
    case "INVALID_REQUEST":
      return 400;
    case "RATE_LIMITED":
      return 429;
    case "MISSING_API_KEY":
    case "SERVICE_UNAVAILABLE":
    case "REQUEST_TIMEOUT":
      return 503;
    default:
      return 502;
  }
}

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

  const parsed = JobAnalysisInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Enter a job description of 1 to 30,000 characters.",
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
    const providerResult = await createAiProvider().analyzeJobDescription(
      parsed.data,
    );
    const analysis = JobAnalysisResultSchema.parse(providerResult);
    return NextResponse.json({ analysis });
  } catch (error) {
    if (error instanceof AiProviderError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          retryable: error.retryable,
        },
        { status: statusForError(error) },
      );
    }
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json(
        {
          error:
            "The AI returned an analysis that did not match the expected format. Try again.",
          code: "INVALID_RESPONSE",
          retryable: true,
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      {
        error: "Job description analysis failed. Try again.",
        code: "ANALYSIS_FAILED",
        retryable: true,
      },
      { status: 500 },
    );
  }
}
