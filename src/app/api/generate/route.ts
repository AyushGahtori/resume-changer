import { NextResponse } from "next/server";
import { DataLoadError, loadResumeLibrary } from "@/lib/data/loaders";
import {
  createManualGeneration,
  ManualGenerationRequestSchema,
} from "@/lib/generation/manual-generation";
import { ResumeRenderError } from "@/lib/latex/render-resume";
import { createServerTrace } from "@/lib/diagnostics/server-trace";

export const runtime = "nodejs";

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
        diagnostics: runId === "unknown" ? undefined : trace.events,
      },
      { status: 400 },
    );
  }
  trace.record(
    "latex.request",
    "Received deterministic LaTeX generation request.",
    body,
  );

  const parsed = ManualGenerationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Check the job details and selected achievements.",
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
    const library = await loadResumeLibrary({ source: parsed.data.dataSource });
    trace.record("latex.library", "Loaded source library used for rendering.", {
      source: parsed.data.dataSource,
      profile: library.profile,
      jobs: library.jobs,
      projects: library.projects,
      skills: library.skills,
      credentials: library.credentials,
    });
    const generated = createManualGeneration(library, parsed.data);
    trace.record(
      "latex.result",
      "Rendered deterministic LaTeX and generation metadata.",
      generated,
    );
    return NextResponse.json({
      ...generated,
      ...(runId !== "unknown" ? { diagnostics: trace.events, runId } : {}),
    });
  } catch (error) {
    if (error instanceof ResumeRenderError) {
      trace.record(
        "latex.error",
        "LaTeX render validation failed.",
        error.message,
      );
      return NextResponse.json(
        {
          error: error.message,
          diagnostics: runId === "unknown" ? undefined : trace.events,
        },
        { status: 400 },
      );
    }
    if (error instanceof DataLoadError) {
      trace.record(
        "latex.error",
        "Resume library could not be loaded.",
        error.message,
      );
      return NextResponse.json(
        {
          error: error.message,
          diagnostics: runId === "unknown" ? undefined : trace.events,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        error: "The resume could not be generated. Try again.",
        diagnostics: runId === "unknown" ? undefined : trace.events,
      },
      { status: 500 },
    );
  }
}
