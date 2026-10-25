import { protectAccountRoute } from "@/lib/cloud/protect-route";
import { loadResumeLibrary } from "@/lib/data/loaders";
import { renderResumeLatex } from "@/lib/latex/render-resume";
import { compileLatexToPdf, PdfCompileError } from "@/lib/pdf/compile-service";

export const runtime = "nodejs";
async function POSTForAccount() {
  try {
    // A health check must never change saved history or send personal data to AI.
    const library = await loadResumeLibrary({ source: "demo" });
    const selectedAchievementIds = library.jobs
      .flatMap((job) =>
        job.points.filter((point) => point.enabled).map((point) => point.id),
      )
      .slice(0, 3);
    const latex = renderResumeLatex({ library, selectedAchievementIds });
    const result = await compileLatexToPdf(latex);
    return Response.json({ ready: true, pageCount: result.pageCount });
  } catch (error) {
    return Response.json(
      {
        ready: false,
        error:
          error instanceof PdfCompileError
            ? error.message
            : "The PDF service is temporarily unavailable.",
        code: error instanceof PdfCompileError ? error.code : "PDF_UNAVAILABLE",
      },
      { status: error instanceof PdfCompileError ? error.status : 503 },
    );
  }
}
export const POST = protectAccountRoute(POSTForAccount, {
  usage: "compile",
  maxBytes: 1024,
});
