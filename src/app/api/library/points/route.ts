import { NextResponse } from "next/server";
import { DataLoadError } from "@/lib/data/loaders";
import {
  CreateAchievementInputSchema,
  LibraryWriteError,
  createAchievementPoint,
} from "@/lib/data/writers";

export const runtime = "nodejs";

function failureResponse(error: unknown) {
  if (error instanceof LibraryWriteError) {
    const status =
      error.code === "not-found"
        ? 404
        : error.code === "locked"
          ? 409
          : error.code === "invalid-library"
            ? 400
            : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  if (error instanceof DataLoadError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  return NextResponse.json(
    { error: "The achievement could not be saved. Try again." },
    { status: 500 },
  );
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

  const parsed = CreateAchievementInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Check the achievement fields and try again.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const { point } = await createAchievementPoint(parsed.data);
    return NextResponse.json({ point }, { status: 201 });
  } catch (error) {
    return failureResponse(error);
  }
}
