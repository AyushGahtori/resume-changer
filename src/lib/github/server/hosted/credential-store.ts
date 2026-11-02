import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { CollectionReference, Firestore } from "firebase-admin/firestore";
import type { GithubAccessStore } from "../access-core";
import {
  parseGithubCredentialHandle,
  type GithubCredentialScope,
  type GithubCredentialSecrets,
  type GithubCredentialVault,
} from "../credentials-core";
import { z } from "zod";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const Secrets = z
  .object({
    accessToken: z.string().min(1).max(16000),
    refreshToken: z.string().min(1).max(16000).optional(),
    accessExpiresAt: z.iso.datetime().optional(),
    refreshExpiresAt: z.iso.datetime().optional(),
  })
  .strict();
function scopeKey(scope: GithubCredentialScope) {
  if (
    !scope.sessionId ||
    scope.sessionId.length > 256 ||
    !["user", "repository"].includes(scope.purpose) ||
    (scope.purpose === "repository" &&
      !/^[1-9][0-9]*$/.test(scope.repositoryId ?? ""))
  )
    throw new Error("Invalid credential scope.");
  return JSON.stringify([
    scope.sessionId,
    scope.purpose,
    scope.repositoryId ?? null,
  ]);
}
async function removeCollection(collection: CollectionReference) {
  for (;;) {
    const page = await collection.limit(100).get();
    if (page.empty) return;
    const batch = collection.firestore.batch();
    for (const item of page.docs) batch.delete(item.ref);
    await batch.commit();
  }
}
export function createHostedCredentialVault(
  db: Firestore,
  namespace: string,
  encodedKey: string,
): GithubCredentialVault {
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32 || !/^[a-z][a-z0-9-]{0,47}$/.test(namespace))
    throw new Error("Invalid credential vault configuration.");
  const collection = (sessionId: string) =>
    db
      .collection(`github-vault-${namespace}`)
      .doc(hash(sessionId))
      .collection("credentials");
  function ref(handle: string, scope: GithubCredentialScope) {
    if (!parseGithubCredentialHandle(handle))
      throw new Error("Invalid credential handle.");
    return collection(scope.sessionId).doc(handle);
  }
  function seal(
    scope: GithubCredentialScope,
    secrets: GithubCredentialSecrets,
  ) {
    const aad = scopeKey(scope),
      iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(Secrets.parse(secrets)), "utf8"),
      cipher.final(),
    ]);
    return {
      version: 1,
      scopeHash: hash(aad),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  }
  const vault: GithubCredentialVault = {
    async put({ scope, secrets }) {
      const handle = parseGithubCredentialHandle(
        randomBytes(32).toString("base64url"),
      )!;
      await ref(handle, scope).create(seal(scope, secrets));
      return handle;
    },
    async read(handle, scope) {
      const saved = await ref(handle, scope).get();
      if (!saved.exists) return undefined;
      const data = saved.data()!,
        aad = scopeKey(scope);
      if (data.version !== 1 || data.scopeHash !== hash(aad))
        throw new Error("Credential ownership does not match.");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(data.iv, "base64"),
      );
      decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(Buffer.from(data.tag, "base64"));
      return Secrets.parse(
        JSON.parse(
          Buffer.concat([
            decipher.update(Buffer.from(data.ciphertext, "base64")),
            decipher.final(),
          ]).toString("utf8"),
        ),
      );
    },
    async replace(handle, scope, secrets) {
      const target = ref(handle, scope),
        replacement = seal(scope, secrets);
      await db.runTransaction(async (transaction) => {
        const saved = await transaction.get(target);
        if (!saved.exists || saved.data()?.scopeHash !== replacement.scopeHash)
          throw new Error("Credential ownership does not match.");
        transaction.set(target, replacement);
      });
    },
    async delete(handle, scope) {
      const target = ref(handle, scope);
      await db.runTransaction(async (transaction) => {
        const saved = await transaction.get(target);
        if (!saved.exists) return;
        if (saved.data()?.scopeHash !== hash(scopeKey(scope)))
          throw new Error("Credential ownership does not match.");
        transaction.delete(target);
      });
    },
    async deleteSession(sessionId) {
      await removeCollection(collection(sessionId));
    },
  };
  return vault;
}
export function createHostedAccessStore(
  db: Firestore,
  namespace: string,
  clearCaches: GithubAccessStore["clearCaches"],
): GithubAccessStore {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(namespace))
    throw new Error("Invalid access namespace.");
  const ref = (sessionId: string) => {
    if (!sessionId || sessionId.length > 256)
      throw new Error("Invalid session.");
    return db
      .collection(`github-connections-${namespace}`)
      .doc(hash(sessionId));
  };
  return {
    async savePending(input) {
      await ref(input.sessionId)
        .collection("pending")
        .doc(input.stateHash)
        .create(input);
    },
    async consumePending(input) {
      const target = ref(input.sessionId)
        .collection("pending")
        .doc(input.stateHash);
      return db.runTransaction(async (transaction) => {
        const saved = await transaction.get(target);
        if (!saved.exists) return undefined;
        const value = saved.data()!;
        if (
          value.sessionId !== input.sessionId ||
          value.callbackOrigin !== input.callbackOrigin ||
          value.stateHash !== input.stateHash ||
          Date.parse(value.expiresAt) <= Date.parse(input.now)
        )
          return undefined;
        transaction.delete(target);
        return value as Awaited<
          ReturnType<GithubAccessStore["consumePending"]>
        >;
      });
    },
    async deletePendingForSession(sessionId) {
      await removeCollection(ref(sessionId).collection("pending"));
    },
    async getConnection(sessionId) {
      return (await ref(sessionId).get()).data()?.connection;
    },
    async createConnectionIfAbsent(input) {
      const target = ref(input.sessionId);
      return db.runTransaction(async (transaction) => {
        if ((await transaction.get(target)).data()?.connection) return false;
        transaction.set(target, { connection: input });
        return true;
      });
    },
    async deleteConnection(sessionId) {
      await ref(sessionId).delete();
      await removeCollection(ref(sessionId).collection("grants"));
    },
    async listRepositoryGrants(sessionId) {
      return (
        await ref(sessionId).collection("grants").limit(500).get()
      ).docs.map(
        (doc) =>
          doc.data() as Awaited<
            ReturnType<GithubAccessStore["listRepositoryGrants"]>
          >[number],
      );
    },
    async saveRepositoryGrant(input) {
      if (!/^[1-9][0-9]*$/.test(input.repositoryId))
        throw new Error("Invalid repository.");
      await ref(input.sessionId)
        .collection("grants")
        .doc(input.repositoryId)
        .set(input);
    },
    async removeRepositoryGrant(sessionId, repositoryId) {
      if (!/^[1-9][0-9]*$/.test(repositoryId))
        throw new Error("Invalid repository.");
      await ref(sessionId).collection("grants").doc(repositoryId).delete();
    },
    clearCaches,
  };
}
