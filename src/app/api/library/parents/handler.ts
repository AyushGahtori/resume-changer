import { AccountAccessError } from "@/lib/cloud/security";
import { protectAccountRoute } from "@/lib/cloud/protect-route";
import { NextResponse } from "next/server";
import { DataLoadError } from "@/lib/data/loaders";
import {
  CreateLibraryParentInputSchema,
  LibraryWriteError,
  createLibraryParent,
} from "@/lib/data/writers";

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
    { error: "The job or project could not be saved. Try again." },
    { status: 500 },
  );
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

  const parsed = CreateLibraryParentInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter a job or project name." },
      { status: 400 },
    );
  }

  try {
    const { parent } = await createLibraryParent(parsed.data);
    return NextResponse.json({ parent }, { status: 201 });
  } catch (error) {
    return failureResponse(error);
  }
}

export const POST = protectAccountRoute(POSTForAccount);
