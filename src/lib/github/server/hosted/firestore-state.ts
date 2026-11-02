import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import type { Firestore } from "firebase-admin/firestore";
import type { DurableStateStorage } from "../state";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const LEASE_MS = 30_000;
const MAX_COMPRESSED_BYTES = 700_000;
type Lease = { owner: string; fence: number };

/** Internal collections are inaccessible through browser Firestore rules. */
export function createFirestoreStateStorage(
  db: Firestore,
  namespace: string,
): DurableStateStorage {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(namespace))
    throw new Error("Invalid state namespace.");
  const locks = new AsyncLocalStorage<Map<string, Lease>>();
  function key(root: string, target: string) {
    const path = relative(root, target);
    if (
      !isAbsolute(root) ||
      resolve(root) !== root ||
      !path ||
      path === ".." ||
      path.startsWith(`..${sep}`) ||
      isAbsolute(path)
    )
      throw new Error("Unsafe durable state path.");
    return digest(path.split(sep).join("/"));
  }
  const reference = (root: string, target: string) =>
    db.collection(`github-internal-${namespace}`).doc(key(root, target));
  const storage: DurableStateStorage = {
    kind: "durable",
    async assertPath(root, target) {
      key(root, target);
    },
    async read(root, target, maxBytes) {
      const saved = await reference(root, target).get();
      const data = saved.data();
      if (!data?.payload)
        throw Object.assign(new Error("State is not present."), {
          code: "ENOENT",
        });
      if (
        !Number.isSafeInteger(maxBytes) ||
        maxBytes < 0 ||
        !Number.isSafeInteger(data.rawBytes) ||
        data.rawBytes > maxBytes ||
        !Buffer.isBuffer(data.payload) ||
        data.payload.length > MAX_COMPRESSED_BYTES
      )
        throw new Error("Durable state exceeds its limit.");
      const raw = gunzipSync(data.payload, { maxOutputLength: maxBytes + 1 });
      if (
        raw.length !== data.rawBytes ||
        digest(raw.toString("utf8")) !== data.hash
      )
        throw new Error("Durable state integrity check failed.");
      return raw.toString("utf8");
    },
    async write(root, target, text) {
      const lease = locks.getStore()?.get(key(root, target));
      if (!lease)
        return storage.withLock(root, target, () =>
          storage.write(root, target, text),
        );
      const payload = gzipSync(Buffer.from(text));
      if (payload.length > MAX_COMPRESSED_BYTES)
        throw new Error(
          "The staged cloud workspace is full; discard expired imports before continuing.",
        );
      const ref = reference(root, target);
      await db.runTransaction(async (transaction) => {
        const current = (await transaction.get(ref)).data();
        if (
          current?.lockOwner !== lease.owner ||
          current?.fence !== lease.fence ||
          current?.leaseUntil <= Date.now()
        )
          throw new Error("The state writer lost its lease.");
        transaction.set(
          ref,
          {
            payload,
            rawBytes: Buffer.byteLength(text),
            hash: digest(text),
            updatedAt: new Date(),
          },
          { merge: true },
        );
      });
    },
    async withLock(root, target, work, maxWaitMs = 5000) {
      const id = key(root, target);
      if (locks.getStore()?.has(id))
        throw new Error("Recursive durable state lock.");
      const ref = reference(root, target),
        owner = randomUUID(),
        start = Date.now();
      let lease: Lease | undefined;
      while (!lease) {
        lease = await db.runTransaction(async (transaction) => {
          const current = (await transaction.get(ref)).data();
          if (current?.lockOwner && current.leaseUntil > Date.now())
            return undefined;
          const fence = (Number(current?.fence) || 0) + 1;
          transaction.set(
            ref,
            { lockOwner: owner, fence, leaseUntil: Date.now() + LEASE_MS },
            { merge: true },
          );
          return { owner, fence };
        });
        if (!lease) {
          if (Date.now() - start >= maxWaitMs)
            throw new Error("Timed out acquiring staged state.");
          await new Promise((done) => setTimeout(done, 20));
        }
      }
      const scope = new Map(locks.getStore());
      scope.set(id, lease);
      try {
        return await locks.run(scope, work);
      } finally {
        await db.runTransaction(async (transaction) => {
          const current = (await transaction.get(ref)).data();
          if (current?.lockOwner === owner && current?.fence === lease!.fence)
            transaction.set(
              ref,
              { lockOwner: "", leaseUntil: 0 },
              { merge: true },
            );
        });
      }
    },
  };
  return storage;
}
