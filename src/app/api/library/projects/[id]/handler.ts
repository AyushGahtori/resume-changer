import { protectAccountRoute } from "@/lib/cloud/protect-route";
import { NextResponse } from "next/server";
import { StableIdSchema } from "@/lib/schemas/resume-data";
import {
  UpsertProjectMetadataInputSchema,
  upsertProjectMetadata,
} from "@/lib/data/writers";
import {
  fieldError,
  invalidJson,
  metadataFailure,
} from "../../metadata-response";

export const runtime = "nodejs";

async function PUTForAccount(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!StableIdSchema.safeParse(id).success) {
    return fieldError("Check the project fields and try again.", [
      { path: "id", message: "Use a stable lowercase ID with hyphens." },
    ]);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidJson();
  }
  const parsed = UpsertProjectMetadataInputSchema.safeParse(body);
  if (!parsed.success) {
    return fieldError(
      "Check the project fields and try again.",
      parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    );
  }
  try {
    const result = await upsertProjectMetadata(id, parsed.data);
    return NextResponse.json(
      { project: result.project, changed: result.changed },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    return metadataFailure(error, "The project could not be saved. Try again.");
  }
}

export const PUT = protectAccountRoute(PUTForAccount);
