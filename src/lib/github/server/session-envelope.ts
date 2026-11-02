import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { z } from "zod";
import { SESSION_BYTES, type SessionMemory } from "./session-memory";

const Payload = z
  .object({
    version: z.literal(1),
    uid: z.string().min(1).max(128),
    id: z.string().uuid(),
    expiresAt: z.number().int(),
    files: z.record(
      z.string().regex(/^data\/github-[A-Za-z0-9_./-]+$/),
      z.string(),
    ),
  })
  .strict();
const PURPOSE = Buffer.from("github-tab-session-v1");
const localKey = randomBytes(32);
function key() {
  const secret = process.env.GITHUB_VAULT_KEY;
  if (secret && Buffer.from(secret, "base64").length !== 32)
    throw new Error("Session signing is unavailable.");
  if (
    !secret &&
    (process.env.VERCEL === "1" || process.env.RESUME_APP_MODE === "firebase")
  )
    throw new Error("Session signing is unavailable.");
  return Buffer.from(
    hkdfSync(
      "sha256",
      secret ? Buffer.from(secret, "base64") : localKey,
      Buffer.alloc(0),
      PURPOSE,
      32,
    ),
  );
}
export function sealImportSession(memory: SessionMemory, now = Date.now()) {
  const raw = Buffer.from(
    JSON.stringify({
      version: 1,
      uid: memory.uid,
      id: memory.id,
      expiresAt: now + 20 * 60_000,
      files: memory.files,
    }),
  );
  if (raw.length > SESSION_BYTES + 65536)
    throw new Error("Temporary workspace exceeds its limit.");
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(PURPOSE);
  const encrypted = Buffer.concat([
    cipher.update(gzipSync(raw)),
    cipher.final(),
  ]);
  const token = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    "base64url",
  );
  if (token.length > 3_800_000)
    throw new Error("Temporary workspace exceeds its limit.");
  return token;
}
export function openImportSession(
  token: string,
  uid: string,
  now = Date.now(),
) {
  if (token.length > 3_800_000 || !/^[A-Za-z0-9_-]+$/.test(token))
    throw new Error("Invalid temporary workspace.");
  const raw = Buffer.from(token, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  decipher.setAAD(PURPOSE);
  decipher.setAuthTag(raw.subarray(12, 28));
  const zipped = Buffer.concat([
    decipher.update(raw.subarray(28)),
    decipher.final(),
  ]);
  const value = Payload.parse(
    JSON.parse(
      gunzipSync(zipped, { maxOutputLength: SESSION_BYTES + 65536 }).toString(
        "utf8",
      ),
    ),
  );
  if (
    value.uid !== uid ||
    value.expiresAt <= now ||
    value.expiresAt > now + 20 * 60_000 + 30_000
  )
    throw new Error(
      "Temporary workspace expired or belongs to another account.",
    );
  return value;
}
