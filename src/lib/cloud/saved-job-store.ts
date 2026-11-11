import "server-only";
import {
  collection,
  doc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Transaction,
} from "firebase/firestore";
import { StableIdSchema } from "../schemas/resume-data";
import { SavedJobError } from "../jobs/saved-job-error";
import {
  nextSavedJob,
  nextStoredJobCount,
  readStoredJobCount,
} from "../jobs/saved-job-record";
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
import { ACCOUNT_DAILY_LIMITS } from "./usage";

function writeJobUsage(
  transaction: Transaction,
  reference: DocumentReference,
  saved: DocumentSnapshot,
  uid: string,
  targetId: string,
  storedJobs: number,
) {
  const maximum = ACCOUNT_DAILY_LIMITS.jobs;
  const prior = saved.data();
  const windowStart = prior?.windowStart as
    { toMillis?: () => number } | undefined;
  const active =
    typeof windowStart?.toMillis === "function" &&
    Date.now() < windowStart.toMillis() + 86_400_000;
  const count = active ? Number(prior?.count) + 1 : 1;
  if (!Number.isSafeInteger(count) || count > maximum) {
    throw new AccountAccessError(
      "Your daily limit for this action has been reached. Please try again after the usage window resets.",
      "RATE_LIMITED",
      429,
    );
  }
  transaction.set(reference, {
    uid,
    action: "jobs",
    targetId,
    count,
    storedJobs,
    windowStart: active ? prior?.windowStart : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

async function storedJobFallback(
  db: Awaited<ReturnType<typeof ensureCloudAccount>>["db"],
  uid: string,
) {
  const counted = await getDocsFromServer(
    query(
      collection(db, "accounts", uid, "jobAnalyses"),
      limit(MAX_SAVED_JOBS),
    ),
  );
  return counted.size;
}

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
  const reference = doc(db, ...savedJobDocumentPath(account.uid, next.id));
  const usageReference = doc(db, "accounts", account.uid, "usage", "jobs");
  const payload = JSON.stringify(next);
  await runTransaction(db, async (transaction) => {
    const prior = await transaction.get(reference);
    const usage = await transaction.get(usageReference);
    const creating = !prior.exists();
    const current = readStoredJobCount(usage.data()?.storedJobs);
    const storedJobs = nextStoredJobCount(
      current,
      current === null ? storedCount : 0,
      creating ? "create" : "update",
    );
    const revision = prior.exists() ? Number(prior.data().revision) + 1 : 1;
    if (!Number.isSafeInteger(revision) || revision > 1_000_000_000) {
      throw new SavedJobError(
        "unavailable",
        "Saved job analyses could not be updated.",
      );
    }
    writeJobUsage(
      transaction,
      usageReference,
      usage,
      account.uid,
      next.id,
      storedJobs,
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
  const usageReference = doc(db, "accounts", account.uid, "usage", "jobs");
  await runTransaction(db, async (transaction) => {
    const prior = await transaction.get(reference);
    if (!prior.exists()) {
      throw new SavedJobError("not-found", "Saved job not found.");
    }
    const usage = await transaction.get(usageReference);
    const current = readStoredJobCount(usage.data()?.storedJobs);
    const storedJobs = nextStoredJobCount(
      current,
      current === null ? await storedJobFallback(db, account.uid) : 0,
      "delete",
    );
    writeJobUsage(
      transaction,
      usageReference,
      usage,
      account.uid,
      parsedId,
      storedJobs,
    );
    transaction.delete(reference);
  });
  return { deleted: true as const };
}
