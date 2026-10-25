import "server-only";
import { doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { getAccountDatabase, type CloudAccount } from "./server-account";

const initialized = new WeakMap<CloudAccount, ReturnType<typeof initialize>>();
async function initialize(
  context: Awaited<ReturnType<typeof getAccountDatabase>>,
) {
  const { account, db } = context;
  await runTransaction(db, async (transaction) => {
    const reference = doc(db, "accounts", account.uid);
    if (!(await transaction.get(reference)).exists())
      transaction.set(reference, {
        uid: account.uid,
        email: account.email,
        displayName: account.displayName.slice(0, 200),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
  });
  return context;
}
export async function ensureCloudAccount() {
  const context = await getAccountDatabase();
  let pending = initialized.get(context.account);
  if (!pending) {
    pending = initialize(context);
    initialized.set(context.account, pending);
  }
  return pending;
}
