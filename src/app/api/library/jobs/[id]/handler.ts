import { protectAccountRoute } from "@/lib/cloud/protect-route";
import { NextResponse } from "next/server";
import { StableIdSchema } from "@/lib/schemas/resume-data";
import {
  UpsertJobMetadataInputSchema,
  upsertJobMetadata,
} from "@/lib/data/writers";
import { fieldError, invalidJson, metadataFailure } from "../../metadata-response";

export const runtime = "nodejs";

async function PUTForAccount(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!StableIdSchema.safeParse(id).success) {
    return fieldError("Check the job fields and try again.", [
      { path: "id", message: "Use a stable lowercase ID with hyphens." },
    ]);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidJson();
  }
  const parsed = UpsertJobMetadataInputSchema.safeParse(body);
  if (!parsed.success) {
    return fieldError(
      "Check the job fields and try again.",
      parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    );
  }
  try {
    const result = await upsertJobMetadata(id, parsed.data);
    return NextResponse.json(
      { job: result.job, changed: result.changed },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    return metadataFailure(error, "The job could not be saved. Try again.");
  }
}

export const PUT = protectAccountRoute(PUTForAccount);
