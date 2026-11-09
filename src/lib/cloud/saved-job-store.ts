import "server-only";
import {
  collection,
  doc,
  getDocFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { StableIdSchema } from "../schemas/resume-data";
import { SavedJobError } from "../jobs/saved-job-error";
import { nextSavedJob } from "../jobs/saved-job-record";
import {
  MAX_SAVED_JOB_BYTES,
  MAX_SAVED_JOBS,
  SavedJobRecordSchema,
  savedJobDocumentPath,
  savedJobSummary,
  type SavedJobRecord,
} from "../jobs/saved-job";
import { ensureCloudAccount } from "./account-store";
import { AccountAccessError } from "./security";
import { writeUsageInTransaction } from "./usage";

function validId(value: string) {
  const id = StableIdSchema.max(200).safeParse(value);
  if (!id.success) {
    throw new SavedJobError("not-found", "Saved job not found.");
  }
  return id.data;
}

function readRecord(payload: unknown, id: string): SavedJobRecord | null {
  if (
    typeof payload !== "string" ||
    Buffer.byteLength(payload) > MAX_SAVED_JOB_BYTES
  ) {
    return null;
  }
  try {
    const parsed = SavedJobRecordSchema.safeParse(JSON.parse(payload));
    if (!parsed.success || parsed.data.id !== id) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

async function loadSavedJobs() {
  const { account, db } = await ensureCloudAccount();
  const page = await getDocs(
    query(
      collection(db, "accounts", account.uid, "jobAnalyses"),
      orderBy("updatedAt", "desc"),
      limit(MAX_SAVED_JOBS),
    ),
  );
  const records: SavedJobRecord[] = [];
  for (const record of page.docs) {
    const parsed = readRecord(record.data().payload, record.id);
    if (parsed) records.push(parsed);
  }
  return { account, db, records, storedCount: page.size };
}

export async function listCloudSavedJobs() {
  const { records } = await loadSavedJobs();
  return records.map(savedJobSummary);
}

export async function getCloudSavedJob(id: string) {
  const { account, db } = await ensureCloudAccount();
  const parsedId = validId(id);
  const path = savedJobDocumentPath(account.uid, parsedId);
  if (path[1] !== account.uid) {
    throw new AccountAccessError(
      "Saved job not found.",
      "INVALID_REQUEST",
      404,
    );
  }
  const saved = await getDocFromServer(doc(db, ...path));
  const record = saved.exists()
    ? readRecord(saved.data().payload, parsedId)
    : null;
  if (!record) throw new SavedJobError("not-found", "Saved job not found.");
  return record;
}

export async function saveCloudSavedJob(input: unknown) {
  const { account, db, records, storedCount } = await loadSavedJobs();
  const next = nextSavedJob(input, records);
  if (
    !records.some((record) => record.id === next.id) &&
    storedCount >= MAX_SAVED_JOBS
  ) {
    throw new SavedJobError(
      "limit",
      "Delete an older saved job before saving another. This account already has 40 saved analyses.",
    );
  }
  const reference = doc(db, ...savedJobDocumentPath(account.uid, next.id));
  const payload = JSON.stringify(next);
  await runTransaction(db, async (transaction) => {
    const prior = await transaction.get(reference);
    const revision = prior.exists() ? Number(prior.data().revision) + 1 : 1;
    if (!Number.isSafeInteger(revision) || revision > 1_000_000_000) {
      throw new SavedJobError(
        "unavailable",
        "Saved job analyses could not be updated.",
      );
    }
    await writeUsageInTransaction(
      transaction,
      db,
      account.uid,
      "jobs",
      next.id,
    );
    transaction.set(reference, {
      uid: account.uid,
      revision,
      payload,
      createdAt: prior.exists() ? prior.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  return next;
}

export async function deleteCloudSavedJob(id: string) {
  const { account, db } = await ensureCloudAccount();
  const parsedId = validId(id);
  const reference = doc(db, ...savedJobDocumentPath(account.uid, parsedId));
  await runTransaction(db, async (transaction) => {
    const prior = await transaction.get(reference);
    if (!prior.exists()) {
      throw new SavedJobError("not-found", "Saved job not found.");
    }
    await writeUsageInTransaction(
      transaction,
      db,
      account.uid,
      "jobs",
      parsedId,
    );
    transaction.delete(reference);
  });
  return { deleted: true as const };
}
