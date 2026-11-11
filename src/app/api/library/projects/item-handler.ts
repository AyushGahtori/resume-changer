import { AccountAccessError } from "@/lib/cloud/security";
import { protectAccountRoute } from "@/lib/cloud/protect-route";
import { NextResponse } from "next/server";
import { DataLoadError } from "@/lib/data/loaders";
import { LibraryWriteError } from "@/lib/data/writers";
import {
  UpdateProjectInputSchema,
  removeExperienceRecord,
  updateExperienceRecord,
} from "@/lib/data/experience-records";

export const runtime = "nodejs";

function schemaError(issues: { message: string }[]) {
  const message = issues.find((issue) =>
    /^(Enter |Use |Check )/.test(issue.message),
  );
  return message?.message ?? "Check the project fields and try again.";
}

function failureResponse(error: unknown, fallback: string) {
  if (error instanceof AccountAccessError)
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  if (error instanceof LibraryWriteError) {
    const status =
      error.code === "not-found"
        ? 404
        : error.code === "locked"
          ? 409
          : error.code === "invalid-library" || error.code === "invalid-input"
            ? 400
            : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  if (error instanceof DataLoadError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}

async function PATCHForAccount(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = UpdateProjectInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: schemaError(parsed.error.issues) },
      { status: 400 },
    );
  }

  try {
    const { record } = await updateExperienceRecord(id, parsed.data, {
      kind: "project",
    });
    return NextResponse.json({ record });
  } catch (error) {
    return failureResponse(error, "The project could not be saved. Try again.");
  }
}

async function DELETEForAccount(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const removed = await removeExperienceRecord(id, { kind: "project" });
    return NextResponse.json({ removed });
  } catch (error) {
    return failureResponse(
      error,
      "The project could not be removed. Try again.",
    );
  }
}

export const PATCH = protectAccountRoute(PATCHForAccount);
export const DELETE = protectAccountRoute(DELETEForAccount);
