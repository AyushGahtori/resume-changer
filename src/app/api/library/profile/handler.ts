import { protectAccountRoute } from "@/lib/cloud/protect-route";
import { NextResponse } from "next/server";
import { UpdateProfileInputSchema, updateProfile } from "@/lib/data/writers";
import { fieldError, invalidJson, metadataFailure } from "../metadata-response";

export const runtime = "nodejs";

async function PATCHForAccount(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidJson();
  }
  const parsed = UpdateProfileInputSchema.safeParse(body);
  if (!parsed.success) {
    return fieldError(
      "Check the profile fields and try again.",
      parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    );
  }
  try {
    const result = await updateProfile(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return metadataFailure(error, "The profile could not be saved. Try again.");
  }
}

export const PATCH = protectAccountRoute(PATCHForAccount);
