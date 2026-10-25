import { protectAccountRoute } from "@/lib/cloud/protect-route";
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import {
  CompileRequestSchema,
  compileLatexToPdf,
  PdfCompileError,
} from "@/lib/pdf/compile-service";

export const runtime = "nodejs";

async function POSTForAccount(request: Request) {
  const startedAt = Date.now();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = CompileRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Provide LaTeX source (up to 150,000 characters).",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const { pdf, pageCount } = await compileLatexToPdf(parsed.data.latex);
    const pdfBytes = Buffer.from(pdf);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="resume.pdf"',
        "Cache-Control": "no-store",
        "X-PDF-Pages": String(pageCount),
        "X-PDF-Bytes": String(pdfBytes.byteLength),
        "X-PDF-SHA256": createHash("sha256").update(pdfBytes).digest("hex"),
        "X-Compile-Duration-Ms": String(Date.now() - startedAt),
      },
    });
  } catch (error) {
    if (error instanceof PdfCompileError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          diagnostics: error.diagnostics || undefined,
        },
        { status: error.status },
      );
    }
    return NextResponse.json(
      {
        error: "The resume PDF could not be compiled.",
        code: "COMPILE_FAILED",
      },
      { status: 500 },
    );
  }
}

export const POST = protectAccountRoute(POSTForAccount);
