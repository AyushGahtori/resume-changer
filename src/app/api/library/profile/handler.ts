import { AccountAccessError } from "@/lib/cloud/security";
import { protectAccountRoute } from "@/lib/cloud/protect-route";
import { NextResponse } from "next/server";
import { DataLoadError } from "@/lib/data/loaders";
import { LibraryWriteError } from "@/lib/data/writers";
import {
  UpdateProfileInputSchema as MetadataProfileInputSchema,
  updateProfile,
} from "@/lib/data/writers";
import {
  UpdateProfileInputSchema,
  updateResumeProfile,
} from "@/lib/data/profile-records";

export const runtime = "nodejs";

function schemaError(issues: { message: string }[]) {
  const message = issues.find((issue) =>
    /^(Enter |Use |Check )/.test(issue.message),
  );
  return message?.message ?? "Check the profile details and try again.";
}

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
    { error: "The profile could not be saved. Try again." },
    { status: 500 },
  );
}

async function PATCHForAccount(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (body && typeof body === "object" && Object.hasOwn(body, "changes")) {
    const parsed = MetadataProfileInputSchema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json(
        { error: schemaError(parsed.error.issues) },
        { status: 400 },
      );
    try {
      return NextResponse.json(await updateProfile(parsed.data));
    } catch (error) {
      return failureResponse(error);
    }
  }
  const parsed = UpdateProfileInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: schemaError(parsed.error.issues) },
      { status: 400 },
    );
  }

  try {
    const { profile, changed } = await updateResumeProfile(parsed.data);
    return NextResponse.json({ profile, changed }, { status: 200 });
  } catch (error) {
    return failureResponse(error);
  }
}

export const PATCH = protectAccountRoute(PATCHForAccount);
