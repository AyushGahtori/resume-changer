import { AccountAccessError } from "@/lib/cloud/security";
import { protectAccountRoute } from "@/lib/cloud/protect-route";
import { NextResponse } from "next/server";
import {
  deleteGenerationHistoryItem,
  GenerationHistoryError,
  getGenerationHistoryItem,
} from "@/lib/generation/history-store";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

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
        : error.code === "invalid-history"
          ? 409
          : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json(
    { error: "The saved generation is unavailable. Try again." },
    { status: 500 },
  );
}

async function GETForAccount(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json(await getGenerationHistoryItem(id));
  } catch (error) {
    return failureResponse(error);
  }
}

async function DELETEForAccount(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json(await deleteGenerationHistoryItem(id));
  } catch (error) {
    return failureResponse(error);
  }
}

export const GET = protectAccountRoute(GETForAccount);

export const DELETE = protectAccountRoute(DELETEForAccount);
