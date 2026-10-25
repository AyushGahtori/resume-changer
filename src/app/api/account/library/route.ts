import { z } from "zod";
import { protectAccountRoute } from "@/lib/cloud/protect-route";
import { AccountAccessError, getAppMode } from "@/lib/cloud/security";
import { requireCloudAccount } from "@/lib/cloud/server-account";
import { getCloudLibrary, importCloudLibrary } from "@/lib/cloud/library-store";

const ImportSchema = z
  .object({
    library: z.unknown(),
    replace: z.boolean().default(false),
    targetEmail: z.email(),
  })
  .strict();

async function GETForAccount(_request: Request) {
  if (getAppMode() !== "firebase")
    return Response.json(
      { error: "Account imports are not enabled in local mode." },
      { status: 404 },
    );
  return Response.json({ library: await getCloudLibrary() });
}

async function PUTForAccount(request: Request) {
  if (getAppMode() !== "firebase")
    return Response.json(
      { error: "Account imports are not enabled in local mode." },
      { status: 404 },
    );
  const parsed = ImportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: "Choose a valid library file and destination account." },
      { status: 400 },
    );
  const account = await requireCloudAccount();
  if (parsed.data.targetEmail.toLowerCase() !== account.email.toLowerCase())
    throw new AccountAccessError(
      "This backup belongs to a different account. Sign in with the intended account before importing.",
      "FORBIDDEN",
      403,
    );
  return Response.json({
    library: await importCloudLibrary(parsed.data.library, parsed.data.replace),
  });
}

export const GET = protectAccountRoute(GETForAccount);
export const PUT = protectAccountRoute(PUTForAccount, { maxBytes: 514_000 });
