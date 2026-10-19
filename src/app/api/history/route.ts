import { NextResponse } from "next/server";
import {
  GenerationHistoryError,
  listGenerationHistory,
  saveGenerationHistoryItem,
} from "@/lib/generation/history-store";

export const runtime = "nodejs";

function failureResponse(error: unknown) {
  if (error instanceof GenerationHistoryError) {
    const status =
      error.code === "not-found"
        ? 404
        : error.code === "locked"
          ? 409
          : error.code === "invalid-generation"
            ? 400
            : error.code === "invalid-history"
              ? 409
              : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json(
    { error: "Generation history is unavailable. Try again." },
    { status: 500 },
  );
}

export async function GET() {
  try {
    return NextResponse.json({ entries: await listGenerationHistory() });
  } catch (error) {
    return failureResponse(error);
  }
}

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

  try {
    const entry = await saveGenerationHistoryItem(body);
    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    return failureResponse(error);
  }
}
