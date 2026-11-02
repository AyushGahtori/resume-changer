import { createHash } from "node:crypto";
import { getAppMode } from "../../cloud/security";
import { consumeAccountUsage } from "../../cloud/usage";
import { hostedAdmin } from "./hosted/admin";

/** One bounded source-free receipt document per account, never an evidence store. */
export async function claimSessionOperation(
  uid: string,
  sessionId: string,
  operationId: string,
  action: "ai" | "files",
) {
  if (getAppMode() !== "firebase") return async () => {};
  const { db, namespace } = hostedAdmin();
  const accountKey = createHash("sha256").update(uid).digest("hex");
  const id = createHash("sha256")
    .update(JSON.stringify([sessionId, action, operationId]))
    .digest("hex");
  const ref = db
    .collection(`github-session-operations-${namespace}`)
    .doc(accountKey);
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data();
    const receipts = Object.fromEntries(
      Object.entries(data?.receipts ?? {}).filter(
        ([, v]) =>
          typeof v === "object" &&
          v !== null &&
          Number((v as { expiresAt?: number }).expiresAt) > now,
      ),
    );
    if (receipts[id])
      throw new Error(
        "This operation was already submitted. Review its outcome before starting another attempt.",
      );
    if (Object.keys(receipts).length >= 60)
      throw new Error("The daily operation limit was reached.");
    receipts[id] = { state: "started", expiresAt: now + 86400000 };
    tx.set(ref, { receipts });
  });
  // A crash after admission is an unknown outcome, never permission to replay AI.
  await consumeAccountUsage(action);
  return async () => {
    await ref.update({ [`receipts.${id}.state`]: "finished" });
  };
}
