import "server-only";
import {
  doc,
  runTransaction,
  serverTimestamp,
  type Firestore,
  type Transaction,
} from "firebase/firestore";
import { ensureCloudAccount } from "./account-store";
import { AccountAccessError } from "./security";

export const ACCOUNT_DAILY_LIMITS = {
  ai: 20,
  compile: 60,
  library: 120,
  history: 60,
  files: 30,
} as const;
export type UsageAction = keyof typeof ACCOUNT_DAILY_LIMITS;

export async function consumeAccountUsage(action: UsageAction) {
  const { account, db } = await ensureCloudAccount();
  await runTransaction(db, (transaction) =>
    writeUsageInTransaction(transaction, db, account.uid, action, action),
  );
}

/** Call after other transaction reads and before its first write. Rules require
 * library/history writes to advance this exact target's counter atomically. */
export async function writeUsageInTransaction(
  transaction: Transaction,
  db: Firestore,
  uid: string,
  action: UsageAction,
  targetId: string,
) {
  const reference = doc(db, "accounts", uid, "usage", action);
  const maximum = ACCOUNT_DAILY_LIMITS[action];
  const saved = await transaction.get(reference);
  const prior = saved.data();
  const active =
    typeof prior?.windowStart?.toMillis === "function" &&
    Date.now() < prior.windowStart.toMillis() + 86_400_000;
  const count = active ? Number(prior!.count) + 1 : 1;
  if (!Number.isSafeInteger(count) || count > maximum)
    throw new AccountAccessError(
      "Your daily limit for this action has been reached. Please try again after the usage window resets.",
      "RATE_LIMITED",
      429,
    );
  transaction.set(reference, {
    uid,
    action,
    targetId,
    count,
    windowStart: active ? prior!.windowStart : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
