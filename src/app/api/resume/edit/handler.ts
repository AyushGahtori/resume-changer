import { protectAccountRoute } from "@/lib/cloud/protect-route";
import { NextResponse } from "next/server";
import { loadResumeLibrary, DataLoadError } from "@/lib/data/loaders";
import {
  StudioApplySchema,
  renderStudioGeneration,
} from "@/lib/generation/studio-generation";
import { measureSkillWidths } from "@/lib/pdf/skill-measurements";
import { compileLatexToPdf, PdfCompileError } from "@/lib/pdf/compile-service";
import { analyzePdfLayout } from "@/lib/pdf/layout-analysis";
import { ResumeRenderError } from "@/lib/latex/render-resume";

export const runtime = "nodejs";

async function POSTForAccount(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Provide a valid resume draft." },
      { status: 400 },
    );
  }
  const parsed = StudioApplySchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: "Check the draft text, destinations, and selected skills." },
      { status: 400 },
    );
  try {
    const library = await loadResumeLibrary({ source: parsed.data.dataSource });
    const measurements =
      parsed.data.document.skillIds.length &&
      parsed.data.document.sectionOrder.includes("skills")
        ? await measureSkillWidths(library.skills)
        : {
            widths: {},
            labelWidths: [0, 0] as [number, number],
            separatorWidth: 0,
            lineWidth: 532.8,
            source: "latex" as const,
          };
    const generation = renderStudioGeneration(
      library,
      parsed.data,
      measurements,
    );
    const { pdf } = await compileLatexToPdf(generation.latex);
    const analysis = await analyzePdfLayout(pdf);
    if (analysis.layout.clipped || analysis.layout.pageCount !== 1)
      return NextResponse.json(
        {
          error:
            "This draft extends outside the template margins. Shorten the edited content or remove a point. Your previous PDF is unchanged.",
        },
        { status: 422 },
      );
    generation.metadata.layout = analysis.layout;
    generation.metadata.visibleWordCount = analysis.layout.visibleWordCount;
    return NextResponse.json(
      { generation, pdfBase64: pdf.toString("base64") },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (
      error instanceof PdfCompileError ||
      error instanceof ResumeRenderError ||
      error instanceof DataLoadError
    )
      return NextResponse.json(
        {
          error: `${error.message} Your previous PDF and working draft are preserved.`,
          ...(error instanceof PdfCompileError
            ? { code: error.code, diagnostics: error.diagnostics }
            : {}),
        },
        { status: error instanceof PdfCompileError ? error.status : 422 },
      );
    return NextResponse.json(
      {
        error:
          "The draft could not be validated. Your previous PDF and working draft are preserved. Try again.",
      },
      { status: 500 },
    );
  }
}

export const POST = protectAccountRoute(POSTForAccount);
