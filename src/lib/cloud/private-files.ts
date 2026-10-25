import "server-only";
import { createHash } from "node:crypto";
import { del, get, list, put } from "@vercel/blob";
import { consumeAccountUsage } from "./usage";
import { requireCloudAccount } from "./server-account";
import { AccountAccessError, privatePdfPath } from "./security";

export const MAX_CLOUD_PDF_BYTES = 2 * 1024 * 1024;

export async function savePrivatePdf(
  generationId: string,
  pdf: Buffer,
): Promise<string> {
  const { uid } = await requireCloudAccount();
  if (
    pdf.byteLength > MAX_CLOUD_PDF_BYTES ||
    pdf.subarray(0, 5).toString("ascii") !== "%PDF-"
  )
    throw new AccountAccessError(
      "The PDF is invalid or exceeds the 2 MB saved-file limit.",
      "INVALID_REQUEST",
      400,
    );
  const hash = createHash("sha256").update(pdf).digest("hex");
  await consumeAccountUsage("files");
  await put(privatePdfPath(uid, generationId, hash), pdf, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/pdf",
    cacheControlMaxAge: 60,
    abortSignal: AbortSignal.timeout(20_000),
  });
  return hash;
}

export async function readPrivatePdf(
  generationId: string,
  hash: string,
): Promise<Buffer> {
  const { uid } = await requireCloudAccount();
  const result = await get(privatePdfPath(uid, generationId, hash), {
    access: "private",
    abortSignal: AbortSignal.timeout(20_000),
  });
  if (!result || result.statusCode !== 200)
    throw new AccountAccessError(
      "This saved PDF is unavailable.",
      "INVALID_REQUEST",
      404,
    );
  const reader = result.stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_CLOUD_PDF_BYTES) {
        await reader.cancel();
        throw new Error("Saved PDF exceeded its limit.");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const pdf = Buffer.concat(chunks);
  if (
    createHash("sha256").update(pdf).digest("hex") !== hash ||
    pdf.subarray(0, 5).toString("ascii") !== "%PDF-"
  )
    throw new Error("The saved PDF failed its integrity check.");
  return pdf;
}

export async function deletePrivatePdfVersions(
  generationId: string,
): Promise<boolean> {
  const { uid } = await requireCloudAccount();
  const prefix = privatePdfPath(uid, generationId, "0".repeat(64)).replace(
    /0{64}\.pdf$/,
    "",
  );
  const page = await list({
    prefix,
    limit: 100,
    abortSignal: AbortSignal.timeout(20_000),
  });
  const paths = page.blobs.map((blob) => {
    if (
      !blob.pathname.startsWith(prefix) ||
      !/^[a-f0-9]{64}\.pdf$/.test(blob.pathname.slice(prefix.length))
    )
      throw new Error("Unexpected private file identity.");
    return blob.pathname;
  });
  if (paths.length)
    await del(paths, { abortSignal: AbortSignal.timeout(20_000) });
  return !page.hasMore;
}
