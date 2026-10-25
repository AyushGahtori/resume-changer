import "server-only";
import { createHash } from "node:crypto";
import {
  collection,
  doc,
  documentId,
  getDocFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
} from "firebase/firestore";
import { z } from "zod";
import {
  GenerationHistoryEntrySchema,
  StableIdSchema,
  type GenerationHistoryEntry,
} from "../schemas/resume-data";
import { ensureCloudAccount } from "./account-store";
import { writeUsageInTransaction } from "./usage";
import { AccountAccessError } from "./security";
import {
  deletePrivatePdfVersions,
  readPrivatePdf,
  savePrivatePdf,
} from "./private-files";

function validId(value: string) {
  const id = StableIdSchema.max(200).safeParse(value);
  if (!id.success)
    throw new AccountAccessError(
      "Generation not found.",
      "INVALID_REQUEST",
      404,
    );
  return id.data;
}

function readEntry(payload: unknown): GenerationHistoryEntry {
  if (typeof payload !== "string" || Buffer.byteLength(payload) > 64_000)
    throw new Error("A saved history record has an invalid size.");
  return GenerationHistoryEntrySchema.parse(JSON.parse(payload));
}

const CursorSchema = z
  .object({ date: z.iso.datetime(), id: StableIdSchema.max(200) })
  .strict();

export async function listCloudHistory(
  cursor?: string,
): Promise<{ entries: GenerationHistoryEntry[]; nextCursor: string | null }> {
  const { account, db } = await ensureCloudAccount();
  await retryPendingDeletion();
  const constraints = [
    orderBy("sortDate", "desc"),
    orderBy(documentId(), "desc"),
  ];
  let continuation;
  if (cursor) {
    try {
      if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor))
        throw new Error("Invalid cursor");
      continuation = CursorSchema.parse(
        JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
      );
    } catch {
      throw new AccountAccessError(
        "The history page reference is invalid.",
        "INVALID_REQUEST",
        400,
      );
    }
  }
  // Core queries enforce a maximum list size in Security Rules. Pipeline rules
  // cannot inspect request.query.limit, so Core is intentional for this boundary.
  const page = await getDocs(
    query(
      collection(db, "accounts", account.uid, "generations"),
      ...constraints,
      ...(continuation ? [startAfter(continuation.date, continuation.id)] : []),
      limit(50),
    ),
  );
  const entries = page.docs.map((record) => {
    const entry = readEntry(record.data().payload);
    if (entry.id !== record.id)
      throw new Error("A history record has mismatched identity.");
    return entry;
  });
  const last = page.docs.at(-1);
  return {
    entries,
    nextCursor:
      page.size === 50 && last
        ? Buffer.from(
            JSON.stringify({ date: last.data().sortDate, id: last.id }),
          ).toString("base64url")
        : null,
  };
}

export async function getCloudHistoryItem(id: string) {
  const { account, db } = await ensureCloudAccount();
  const generation = doc(
    db,
    "accounts",
    account.uid,
    "generations",
    validId(id),
  );
  const saved = await getDocFromServer(generation);
  if (!saved.exists())
    throw new AccountAccessError(
      "Generation not found.",
      "INVALID_REQUEST",
      404,
    );
  const output = await getDocFromServer(doc(generation, "content", "latex"));
  if (!output.exists()) throw new Error("Saved generation content is missing.");
  const entry = readEntry(saved.data().payload);
  const latex = output.data().latex;
  if (
    entry.id !== id ||
    typeof latex !== "string" ||
    latex.length > 150_000 ||
    createHash("sha256").update(latex).digest("hex") !== output.data().sha256 ||
    output.data().revision !== saved.data().revision
  )
    throw new Error("Saved generation integrity check failed.");
  return {
    entry,
    latex,
    pdfHash: String(saved.data().pdfHash),
    revision: Number(saved.data().revision),
  };
}

export async function getCloudHistoryPdf(id: string): Promise<Buffer> {
  const { account, db } = await ensureCloudAccount();
  const saved = await getDocFromServer(
    doc(db, "accounts", account.uid, "generations", validId(id)),
  );
  if (!saved.exists() || !saved.data().pdfHash)
    throw new AccountAccessError("PDF not found.", "INVALID_REQUEST", 404);
  return readPrivatePdf(id, String(saved.data().pdfHash));
}

export async function saveCloudHistory(
  entry: GenerationHistoryEntry,
  latex: string,
  pdf?: Buffer,
  importOnly = false,
): Promise<GenerationHistoryEntry> {
  const { account, db } = await ensureCloudAccount();
  validId(entry.id);
  const payload = JSON.stringify(GenerationHistoryEntrySchema.parse(entry));
  if (Buffer.byteLength(payload) > 64_000)
    throw new AccountAccessError(
      "The history record is too large to save.",
      "PAYLOAD_TOO_LARGE",
      413,
    );
  const hash = createHash("sha256").update(latex).digest("hex");
  const pdfHash = pdf ? await savePrivatePdf(entry.id, pdf) : "";
  const reference = doc(db, "accounts", account.uid, "generations", entry.id);
  const output = doc(reference, "content", "latex");
  await runTransaction(db, async (transaction) => {
    const [prior, deleted] = await Promise.all([
      transaction.get(reference),
      transaction.get(
        doc(db, "accounts", account.uid, "deletedGenerations", entry.id),
      ),
    ]);
    if (deleted.exists())
      throw new AccountAccessError(
        "This saved generation was deleted. Create a new generation instead.",
        "INVALID_REQUEST",
        409,
      );
    const priorOutput = prior.exists()
      ? await transaction.get(output)
      : undefined;
    if (importOnly && prior.exists()) {
      if (
        prior.data().payload === payload &&
        prior.data().pdfHash === pdfHash &&
        priorOutput?.data()?.sha256 === hash
      )
        return;
      throw new AccountAccessError(
        "A different saved generation already uses this ID. Your existing output was preserved.",
        "INVALID_REQUEST",
        409,
      );
    }
    const revision = prior.exists() ? Number(prior.data().revision) + 1 : 1;
    if (!Number.isSafeInteger(revision) || revision > 1_000_000_000)
      throw new Error("Saved generation revision is invalid.");
    await writeUsageInTransaction(
      transaction,
      db,
      account.uid,
      "history",
      entry.id,
    );
    transaction.set(reference, {
      uid: account.uid,
      revision,
      payload,
      pdfHash,
      sortDate: new Date(entry.createdAt).toISOString(),
      createdAt: prior.exists() ? prior.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    transaction.set(output, {
      uid: account.uid,
      revision,
      latex,
      sha256: hash,
      createdAt: priorOutput?.exists()
        ? priorOutput.data().createdAt
        : serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  return entry;
}

export async function deleteCloudHistory(id: string) {
  const { account, db } = await ensureCloudAccount();
  const reference = doc(
    db,
    "accounts",
    account.uid,
    "generations",
    validId(id),
  );
  await runTransaction(db, async (transaction) => {
    const saved = await transaction.get(reference);
    if (!saved.exists())
      throw new AccountAccessError(
        "Generation not found.",
        "INVALID_REQUEST",
        404,
      );
    await writeUsageInTransaction(transaction, db, account.uid, "history", id);
    transaction.set(
      doc(db, "accounts", account.uid, "deletedGenerations", id),
      { uid: account.uid, createdAt: serverTimestamp() },
    );
    transaction.set(doc(db, "accounts", account.uid, "pendingDeletions", id), {
      uid: account.uid,
      createdAt: serverTimestamp(),
    });
    transaction.delete(doc(reference, "content", "latex"));
    transaction.delete(reference);
  });
  // The grace period lets uploads already in flight finish. The tombstone
  // prevents them from restoring a deleted generation; the outbox survives errors.
  return { deletedId: id, cleanupPending: true };
}

async function retryPendingDeletion() {
  const { account, db } = await ensureCloudAccount();
  const pending = await getDocs(
    query(
      collection(db, "accounts", account.uid, "pendingDeletions"),
      orderBy("createdAt", "asc"),
      limit(1),
    ),
  );
  const item = pending.docs[0];
  if (!item || Date.now() < item.data().createdAt.toMillis() + 60_000) return;
  try {
    if (await deletePrivatePdfVersions(item.id)) {
      await runTransaction(db, async (transaction) => {
        await transaction.get(item.ref);
        await writeUsageInTransaction(
          transaction,
          db,
          account.uid,
          "history",
          item.id,
        );
        transaction.delete(item.ref);
      });
    }
  } catch {
    console.error("Private file cleanup will be retried.", {
      code: "FILE_CLEANUP_PENDING",
    });
  }
}
