import { z } from "zod";
import { protectAccountRoute } from "@/lib/cloud/protect-route";
import { AccountAccessError, getAppMode } from "@/lib/cloud/security";
import { requireCloudAccount } from "@/lib/cloud/server-account";
import { saveGenerationHistoryItem } from "@/lib/generation/history-store";

async function POSTForAccount(request: Request) {
  if (getAppMode() !== "firebase")
    return Response.json(
      { error: "Account imports are not enabled in local mode." },
      { status: 404 },
    );
  const body = z
    .object({ targetEmail: z.email(), generation: z.unknown() })
    .strict()
    .safeParse(await request.json().catch(() => null));
  if (!body.success)
    return Response.json(
      { error: "The saved generation import is invalid." },
      { status: 400 },
    );
  const account = await requireCloudAccount();
  if (account.email.toLowerCase() !== body.data.targetEmail.toLowerCase())
    throw new AccountAccessError(
      "The import destination does not match your signed-in account.",
      "FORBIDDEN",
      403,
    );
  const entry = await saveGenerationHistoryItem(body.data.generation, {
    importOnly: true,
  });
  return Response.json({ entry }, { status: 201 });
}

export const POST = protectAccountRoute(POSTForAccount, { usage: "history" });
