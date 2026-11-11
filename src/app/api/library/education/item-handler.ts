import { AccountAccessError } from "@/lib/cloud/security";
import { protectAccountRoute } from "@/lib/cloud/protect-route";
import { NextResponse } from "next/server";
import { DataLoadError } from "@/lib/data/loaders";
import {
  UpdateEducationInputSchema,
  removeEducation,
  updateEducation,
} from "@/lib/data/qualification-records";
import { LibraryWriteError } from "@/lib/data/writers";

export const runtime = "nodejs";

function failureResponse(error: unknown) {
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
  return NextResponse.json(
    { error: "The degree could not be saved. Try again." },
    { status: 500 },
  );
}

async function PATCHForAccount(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = UpdateEducationInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ??
          "Check the degree fields and try again.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const { education } = await updateEducation(id, parsed.data);
    return NextResponse.json({ education });
  } catch (error) {
    return failureResponse(error);
  }
}

async function DELETEForAccount(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const removed = await removeEducation(id);
    return NextResponse.json({ id: removed.id });
  } catch (error) {
    return failureResponse(error);
  }
}

export const PATCH = protectAccountRoute(PATCHForAccount);
export const DELETE = protectAccountRoute(DELETEForAccount);
