import { protectAccountRoute } from "@/lib/cloud/protect-route";
import { NextResponse } from "next/server";
import { AccountAccessError } from "@/lib/cloud/security";
import { SavedJobError } from "@/lib/jobs/saved-job-error";
import { deleteSavedJob, getSavedJob } from "@/lib/jobs/saved-job-store";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function failureResponse(error: unknown) {
  if (error instanceof AccountAccessError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  if (error instanceof SavedJobError) {
    const status =
      error.code === "not-found"
        ? 404
        : error.code === "locked"
          ? 409
          : error.code === "unavailable"
            ? 500
            : 400;
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status },
    );
  }
  return NextResponse.json(
    { error: "The saved job is unavailable. Try again." },
    { status: 500 },
  );
}

async function GETForAccount(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ job: await getSavedJob(id) });
  } catch (error) {
    return failureResponse(error);
  }
}

async function DELETEForAccount(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json(await deleteSavedJob(id));
  } catch (error) {
    return failureResponse(error);
  }
}

export const GET = protectAccountRoute(GETForAccount);
export const DELETE = protectAccountRoute(DELETEForAccount);
