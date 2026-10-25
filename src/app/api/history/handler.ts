import { protectAccountRoute } from "@/lib/cloud/protect-route";
import { NextResponse } from "next/server";
import { AccountAccessError, getAppMode } from "@/lib/cloud/security";
import {
  GenerationHistoryError,
  listGenerationHistory,
  saveGenerationHistoryItem,
} from "@/lib/generation/history-store";

export const runtime = "nodejs";

function failureResponse(error: unknown) {
  if (error instanceof AccountAccessError)
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
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

async function GETForAccount(request: Request) {
  try {
    if (getAppMode() === "firebase") {
      const { listCloudHistory } = await import("@/lib/cloud/history-store");
      return NextResponse.json(
        await listCloudHistory(
          new URL(request.url).searchParams.get("cursor") ?? undefined,
        ),
      );
    }
    return NextResponse.json({ entries: await listGenerationHistory() });
  } catch (error) {
    return failureResponse(error);
  }
}

async function POSTForAccount(request: Request) {
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

export const GET = protectAccountRoute(GETForAccount);

export const POST = protectAccountRoute(POSTForAccount);
