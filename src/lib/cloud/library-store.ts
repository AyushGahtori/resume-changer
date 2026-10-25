import "server-only";
import { cache } from "react";
import {
  doc,
  getDocFromServer,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import type { ResumeLibrary } from "../schemas/resume-data";
import { ensureCloudAccount } from "./account-store";
import { writeUsageInTransaction } from "./usage";
import { AccountAccessError } from "./security";
import { emptyAccountLibrary, validateCloudLibrary } from "./library-contract";

export const getCloudLibrary = cache(async (): Promise<ResumeLibrary> => {
  const { account, db } = await ensureCloudAccount();
  const reference = doc(db, "accounts", account.uid, "libraries", "current");
  const existing = await getDocFromServer(reference);
  if (existing.exists())
    return validateCloudLibrary(JSON.parse(existing.data().payload));
  return changeCloudLibrary((current) => current);
});

export async function changeCloudLibrary(
  change: (library: ResumeLibrary) => ResumeLibrary,
  expectedRevision?: number,
) {
  const { account, db } = await ensureCloudAccount();
  const reference = doc(db, "accounts", account.uid, "libraries", "current");
  let observedRevision = -1;
  const commit = () =>
    runTransaction(db, async (transaction) => {
      const saved = await transaction.get(reference);
      const revision = saved.exists() ? Number(saved.data().revision) : 0;
      observedRevision = revision;
      if (
        !Number.isSafeInteger(revision) ||
        revision < 0 ||
        revision >= 1_000_000_000
      )
        throw new AccountAccessError(
          "The saved library revision is invalid.",
          "INVALID_REQUEST",
          409,
        );
      if (expectedRevision !== undefined && expectedRevision !== revision)
        throw new AccountAccessError(
          "Your library changed in another window. Reload before importing.",
          "INVALID_REQUEST",
          409,
        );
      const prior = saved.exists()
        ? validateCloudLibrary(JSON.parse(saved.data().payload))
        : emptyAccountLibrary(account);
      const next = validateCloudLibrary(change(prior));
      await writeUsageInTransaction(
        transaction,
        db,
        account.uid,
        "library",
        "current",
      );
      transaction.set(reference, {
        uid: account.uid,
        revision: revision + 1,
        payload: JSON.stringify(next),
        createdAt: saved.exists() ? saved.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return next;
    });
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await commit();
    } catch (error) {
      // Some optimistic conflicts are evaluated by Rules before the storage
      // precondition and arrive as permission-denied rather than ABORTED. Retry
      // only when a fresh authorized read proves that this library advanced.
      if (
        attempt >= 2 ||
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        error.code !== "permission-denied"
      )
        throw error;
      const latest = await getDocFromServer(reference);
      if (
        !latest.exists() ||
        Number(latest.data().revision) <= observedRevision
      )
        throw error;
    }
  }
}

export async function importCloudLibrary(input: unknown, replace = false) {
  const next = validateCloudLibrary(input);
  return changeCloudLibrary((current) => {
    const hasContent =
      current.jobs.length ||
      current.projects.length ||
      current.skills.length ||
      current.credentials.length ||
      current.profile.education.length;
    if (
      !replace &&
      hasContent &&
      JSON.stringify(current) !== JSON.stringify(next)
    )
      throw new AccountAccessError(
        "Your account already has a library. Export a backup and choose Replace to import over it.",
        "INVALID_REQUEST",
        409,
      );
    return next;
  });
}
