import { AccountAccessError } from "@/lib/cloud/security";
import { NextResponse } from "next/server";
import { DataLoadError } from "@/lib/data/loaders";
import { LibraryWriteError } from "@/lib/data/writers";

export function metadataFailure(error: unknown, fallback: string) {
  if (error instanceof AccountAccessError)
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  if (error instanceof LibraryWriteError) {
    const status =
      error.code === "not-found"
        ? 404
        : error.code === "locked" || error.code === "version-conflict"
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

export function invalidJson() {
  return NextResponse.json(
    { error: "Request body must be valid JSON." },
    { status: 400 },
  );
}

export function fieldError(
  error: string,
  issues: { path: string; message: string }[],
) {
  return NextResponse.json({ error, issues }, { status: 400 });
}
