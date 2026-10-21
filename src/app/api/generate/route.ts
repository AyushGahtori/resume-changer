import { NextResponse } from "next/server";
import { DataLoadError, loadResumeLibrary } from "@/lib/data/loaders";
import {
  createManualGeneration,
  ManualGenerationRequestSchema,
} from "@/lib/generation/manual-generation";
import { ResumeRenderError } from "@/lib/latex/render-resume";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }
  const parsed = ManualGenerationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Check the job details and selected achievements.",
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
    const generated = createManualGeneration(library, parsed.data);
    return NextResponse.json(generated);
  } catch (error) {
    if (error instanceof ResumeRenderError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof DataLoadError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: "The resume could not be generated. Try again." },
      { status: 500 },
    );
  }
}
