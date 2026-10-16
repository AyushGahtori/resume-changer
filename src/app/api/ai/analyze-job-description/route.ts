import { NextResponse } from "next/server";
import {
  JobAnalysisInputSchema,
  JobAnalysisResultSchema,
} from "@/lib/ai/contracts";
import { createAiProvider } from "@/lib/ai/provider-factory";
import { AiProviderError } from "@/lib/ai/provider";
import { createServerTrace } from "@/lib/diagnostics/server-trace";

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
  const trace = createServerTrace();
  const runId = request.headers.get("x-resume-run-id") ?? "unknown";
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    trace.record("analysis.validation", "Request body was not valid JSON.");
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
    "analysis.request",
    "Received job description analysis request.",
    body,
  );

  const parsed = JobAnalysisInputSchema.safeParse(body);
  if (!parsed.success) {
    trace.record(
      "analysis.validation",
      "Request failed schema validation.",
      parsed.error.issues,
    );
    return NextResponse.json(
      {
        error: "Enter a job description of 1 to 30,000 characters.",
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
    trace.record(
      "analysis.validation",
      "Request passed schema validation.",
      parsed.data,
    );
    const provider = createAiProvider(undefined, (event) =>
      trace.events.push(event),
    );
    trace.record("analysis.provider", "Selected AI provider.", {
      provider: provider.name,
    });
    const providerResult = await provider.analyzeJobDescription(parsed.data);
    const analysis = JobAnalysisResultSchema.parse(providerResult);
    trace.record(
      "analysis.complete",
      "Analysis passed the response contract.",
      analysis,
    );
    return NextResponse.json({
      analysis,
      ...(runId !== "unknown" ? { diagnostics: trace.events, runId } : {}),
    });
  } catch (error) {
    if (error instanceof AiProviderError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          retryable: error.retryable,
          diagnostics: runId === "unknown" ? undefined : trace.events,
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
          diagnostics: runId === "unknown" ? undefined : trace.events,
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      {
        error: "Job description analysis failed. Try again.",
        code: "ANALYSIS_FAILED",
        retryable: true,
        diagnostics: runId === "unknown" ? undefined : trace.events,
      },
      { status: 500 },
    );
  }
}
