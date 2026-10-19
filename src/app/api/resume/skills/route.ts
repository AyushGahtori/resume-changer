import { NextResponse } from "next/server";
import { loadResumeLibrary } from "@/lib/data/loaders";
import { measureSkillWidths } from "@/lib/pdf/skill-measurements";
import { PdfCompileError } from "@/lib/pdf/compile-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const source = new URL(request.url).searchParams.get("source");
  if (source !== "personal" && source !== "demo")
    return NextResponse.json(
      { error: "Choose a valid resume library." },
      { status: 400 },
    );
  try {
    const library = await loadResumeLibrary({ source });
    return NextResponse.json(await measureSkillWidths(library.skills), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof PdfCompileError
            ? error.message
            : "Template widths could not be measured. You can keep editing; Apply will validate the layout.",
      },
      { status: 503 },
    );
  }
}
