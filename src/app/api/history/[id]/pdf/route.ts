import { AccountAccessError } from "@/lib/cloud/security";
import { protectAccountRoute } from "@/lib/cloud/protect-route";
import { NextResponse } from "next/server";
import {
  GenerationHistoryError,
  readGenerationHistoryPdf,
} from "@/lib/generation/history-store";

export const runtime = "nodejs";

async function GETForAccount(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const pdf = await readGenerationHistoryPdf(id);
    const disposition = new URL(request.url).searchParams.has("download")
      ? "attachment"
      : "inline";
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="resume.pdf"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AccountAccessError)
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    const status =
      error instanceof GenerationHistoryError && error.code === "not-found"
        ? 404
        : error instanceof GenerationHistoryError &&
            error.code === "invalid-history"
          ? 409
          : 500;
    return NextResponse.json(
      {
        error:
          error instanceof GenerationHistoryError
            ? error.message
            : "The saved PDF is unavailable.",
      },
      { status },
    );
  }
}

export const GET = protectAccountRoute(GETForAccount);
