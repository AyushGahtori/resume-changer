import { protectAccountRoute } from "@/lib/cloud/protect-route";
import { NextResponse } from "next/server";
import { AccountAccessError } from "@/lib/cloud/security";
import { SavedJobError } from "@/lib/jobs/saved-job-error";
import { listSavedJobs, saveSavedJob } from "@/lib/jobs/saved-job-store";

export const runtime = "nodejs";

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
        : error.code === "invalid"
          ? 400
          : error.code === "too-large"
            ? 413
            : error.code === "limit" || error.code === "locked"
              ? 409
              : 500;
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status },
    );
  }
  return NextResponse.json(
    { error: "Saved job analyses are unavailable. Try again." },
    { status: 500 },
  );
}

async function GETForAccount() {
  try {
    return NextResponse.json({ jobs: await listSavedJobs() });
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
      { error: "Request body must be valid JSON.", code: "invalid" },
      { status: 400 },
    );
  }
  try {
    const job = await saveSavedJob(body);
    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    return failureResponse(error);
  }
}

export const GET = protectAccountRoute(GETForAccount);
export const POST = protectAccountRoute(POSTForAccount);
