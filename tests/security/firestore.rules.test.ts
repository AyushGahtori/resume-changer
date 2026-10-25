import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  collectionGroup,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  setLogLevel,
  Timestamp,
  updateDoc,
  writeBatch,
  type Firestore,
  type WriteBatch,
} from "firebase/firestore";

let environment: RulesTestEnvironment;
const hash = "a".repeat(64);
const projectId = "demo-resume-changer-security";
const claims = (uid: string) => ({
  email: `${uid}@example.test`,
  email_verified: true,
  firebase: { sign_in_provider: "google.com" as const },
});
const database = (uid: string) =>
  environment
    .authenticatedContext(uid, claims(uid))
    .firestore() as unknown as Firestore;

function account(uid: string) {
  return {
    uid,
    email: `${uid}@example.test`,
    displayName: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}
function library(uid: string) {
  return {
    uid,
    revision: 1,
    payload: '{"schemaVersion":1}',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}
function generation(uid: string) {
  return {
    uid,
    revision: 1,
    payload: '{"id":"generation-1"}',
    pdfHash: hash,
    sortDate: "2026-10-25T12:00:00.000Z",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}
function content(uid: string) {
  return {
    uid,
    revision: 1,
    latex: "Fictional resume text",
    sha256: hash,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

async function usageProof(
  db: Firestore,
  batch: WriteBatch,
  action: string,
  targetId: string,
  uid = "alice",
) {
  const reference = doc(db, "accounts", uid, "usage", action);
  const prior = await getDoc(reference);
  batch.set(reference, {
    uid,
    action,
    targetId,
    count: prior.exists() ? prior.data().count + 1 : 1,
    windowStart: prior.exists() ? prior.data().windowStart : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
async function libraryUpdate(db: Firestore, changes: Record<string, unknown>) {
  const batch = writeBatch(db);
  await usageProof(db, batch, "library", "current");
  batch.update(doc(db, "accounts", "alice", "libraries", "current"), {
    ...changes,
    updatedAt: serverTimestamp(),
  });
  return batch.commit();
}

async function saveGeneration(
  db: Firestore,
  uid = "alice",
  id = "generation-1",
) {
  const batch = writeBatch(db);
  await usageProof(db, batch, "history", id, uid);
  batch.set(doc(db, "accounts", uid, "generations", id), generation(uid));
  batch.set(
    doc(db, "accounts", uid, "generations", id, "content", "latex"),
    content(uid),
  );
  return batch.commit();
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error("Security tests require the isolated Firestore emulator.");
  setLogLevel("silent");
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: await readFile("firestore.rules", "utf8"),
    },
  });
});
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore() as unknown as Firestore;
    for (const uid of ["alice", "bob"]) {
      await setDoc(doc(db, "accounts", uid), account(uid));
      await setDoc(
        doc(db, "accounts", uid, "libraries", "current"),
        library(uid),
      );
    }
  });
});
afterAll(async () => environment?.cleanup());

describe("Firestore account isolation and schema enforcement", () => {
  it("denies direct writes without an atomic quota increment and rejects proof replay", async () => {
    const db = database("alice");
    const reference = doc(db, "accounts", "alice", "libraries", "current");
    await assertFails(
      updateDoc(reference, { revision: 2, updatedAt: serverTimestamp() }),
    );
    const standalone = writeBatch(db);
    await usageProof(db, standalone, "library", "current");
    await standalone.commit();
    await assertFails(
      updateDoc(reference, { revision: 2, updatedAt: serverTimestamp() }),
    );
    await assertSucceeds(libraryUpdate(db, { revision: 2 }));
    await assertFails(
      updateDoc(reference, { revision: 3, updatedAt: serverTimestamp() }),
    );
  });
  it("cannot authorize two generation IDs with one quota proof", async () => {
    const db = database("alice");
    const batch = writeBatch(db);
    await usageProof(db, batch, "history", "generation-1");
    for (const id of ["generation-1", "generation-2"]) {
      batch.set(
        doc(db, "accounts", "alice", "generations", id),
        generation("alice"),
      );
      batch.set(
        doc(db, "accounts", "alice", "generations", id, "content", "latex"),
        content("alice"),
      );
    }
    await assertFails(batch.commit());
  });
  it("cannot delete metadata without deleting content and recording cleanup", async () => {
    const db = database("alice");
    await saveGeneration(db);
    const batch = writeBatch(db);
    await usageProof(db, batch, "history", "generation-1");
    batch.delete(doc(db, "accounts", "alice", "generations", "generation-1"));
    await assertFails(batch.commit());
    await assertFails(
      getDocs(
        collection(database("bob"), "accounts", "alice", "pendingDeletions"),
      ),
    );
  });

  it("allows an owner read and denies signed-out, other-account and public-list access", async () => {
    const alice = database("alice");
    const bob = database("bob");
    const signedOut = environment
      .unauthenticatedContext()
      .firestore() as unknown as Firestore;
    const path = ["accounts", "alice", "libraries", "current"] as const;
    await assertSucceeds(getDoc(doc(alice, ...path)));
    await assertFails(getDoc(doc(bob, ...path)));
    await assertFails(getDoc(doc(signedOut, ...path)));
    await assertFails(getDocs(collection(alice, "accounts")));
    await assertFails(
      getDocs(collection(alice, "accounts", "alice", "libraries")),
    );
    await assertFails(
      getDocs(query(collectionGroup(alice, "generations"), limit(50))),
    );
  });

  it("rejects anonymous and unverified identities even when the UID matches", async () => {
    for (const token of [
      { ...claims("alice"), email_verified: false },
      {
        ...claims("alice"),
        firebase: { sign_in_provider: "anonymous" as const },
      },
    ]) {
      const db = environment
        .authenticatedContext("alice", token)
        .firestore() as unknown as Firestore;
      await assertFails(
        getDoc(doc(db, "accounts", "alice", "libraries", "current")),
      );
    }
  });

  it("creates a valid account and rejects forged ownership, email and admin fields", async () => {
    const carol = database("carol");
    await assertSucceeds(
      setDoc(doc(carol, "accounts", "carol"), account("carol")),
    );
    await assertFails(
      setDoc(doc(carol, "accounts", "mallory"), account("mallory")),
    );
    await assertFails(
      updateDoc(doc(carol, "accounts", "carol"), {
        email: "alice@example.test",
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(carol, "accounts", "carol"), {
        isAdmin: true,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(deleteDoc(doc(carol, "accounts", "carol")));
  });

  it("permits an atomic account/library creation but rejects orphaned subcollections", async () => {
    const carol = database("carol");
    await assertFails(
      setDoc(
        doc(carol, "accounts", "carol", "libraries", "current"),
        library("carol"),
      ),
    );
    const batch = writeBatch(carol);
    batch.set(doc(carol, "accounts", "carol"), account("carol"));
    batch.set(doc(carol, "accounts", "carol", "usage", "library"), {
      uid: "carol",
      action: "library",
      targetId: "current",
      count: 1,
      windowStart: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(
      doc(carol, "accounts", "carol", "libraries", "current"),
      library("carol"),
    );
    await assertSucceeds(batch.commit());
  });

  it("enforces revisions, immutable timestamps and full validation on library updates", async () => {
    const alice = database("alice");
    const reference = doc(alice, "accounts", "alice", "libraries", "current");
    await assertSucceeds(
      libraryUpdate(alice, {
        payload: '{"updated":true}',
        revision: 2,
        updatedAt: serverTimestamp(),
      }),
    );
    const badChanges = [
      { revision: 2 },
      { revision: 4 },
      { revision: 3.5 },
      { revision: 3, uid: "bob" },
      { revision: 3, createdAt: Timestamp.fromMillis(0) },
      { revision: 3, admin: true },
      { revision: 3, payload: deleteField() },
      { revision: 3, payload: 123 },
      { revision: 3, payload: "x".repeat(512_001) },
    ];
    for (const changes of badChanges)
      await assertFails(libraryUpdate(alice, changes));
    await assertFails(deleteDoc(reference));
    expect((await getDoc(reference)).data()?.revision).toBe(2);
  });

  it("rejects oversized creates and every cross-account library mutation", async () => {
    const bob = database("bob");
    const reference = doc(bob, "accounts", "alice", "libraries", "current");
    await assertFails(
      updateDoc(reference, {
        payload: "stolen",
        revision: 2,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(deleteDoc(reference));
    const carol = database("carol");
    await setDoc(doc(carol, "accounts", "carol"), account("carol"));
    await assertFails(
      setDoc(doc(carol, "accounts", "carol", "libraries", "current"), {
        ...library("carol"),
        payload: "x".repeat(512_001),
      }),
    );
    await assertFails(
      setDoc(doc(carol, "accounts", "carol", "libraries", "current"), {
        ...library("carol"),
        uid: "alice",
      }),
    );
  });

  it("requires matching metadata/content transactions and bounds history queries", async () => {
    const alice = database("alice");
    const root = doc(alice, "accounts", "alice", "generations", "generation-1");
    await assertFails(setDoc(root, generation("alice")));
    await assertSucceeds(saveGeneration(alice));
    await assertFails(
      updateDoc(root, { revision: 2, updatedAt: serverTimestamp() }),
    );
    const batch = writeBatch(alice);
    await usageProof(alice, batch, "history", "generation-1");
    batch.update(root, { revision: 2, updatedAt: serverTimestamp() });
    batch.update(
      doc(
        alice,
        "accounts",
        "alice",
        "generations",
        "generation-1",
        "content",
        "latex",
      ),
      {
        revision: 2,
        latex: "Updated fictional content",
        updatedAt: serverTimestamp(),
      },
    );
    await assertSucceeds(batch.commit());
    const histories = collection(alice, "accounts", "alice", "generations");
    await assertSucceeds(
      getDocs(query(histories, orderBy("sortDate", "desc"), limit(50))),
    );
    await assertFails(getDocs(histories));
    await assertFails(getDocs(query(histories, limit(51))));
    await assertFails(
      getDocs(
        query(
          collection(database("bob"), "accounts", "alice", "generations"),
          limit(50),
        ),
      ),
    );
  });

  it("protects private output content and rejects invalid hashes and oversized rewrites", async () => {
    const alice = database("alice");
    await saveGeneration(alice);
    const output = doc(
      alice,
      "accounts",
      "alice",
      "generations",
      "generation-1",
      "content",
      "latex",
    );
    await assertSucceeds(getDoc(output));
    await assertFails(getDoc(doc(database("bob"), output.path)));
    await assertFails(
      deleteDoc(
        doc(
          database("bob"),
          "accounts",
          "alice",
          "generations",
          "generation-1",
        ),
      ),
    );
    const batch = writeBatch(alice);
    await usageProof(alice, batch, "history", "generation-1");
    batch.update(
      doc(alice, "accounts", "alice", "generations", "generation-1"),
      {
        revision: 2,
        pdfHash: "https://attacker.example/private.pdf",
        updatedAt: serverTimestamp(),
      },
    );
    batch.update(output, {
      revision: 2,
      latex: "x".repeat(150_001),
      updatedAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
    const deletion = writeBatch(alice);
    await usageProof(alice, deletion, "history", "generation-1");
    deletion.delete(
      doc(alice, "accounts", "alice", "generations", "generation-1"),
    );
    deletion.delete(output);
    for (const section of ["deletedGenerations", "pendingDeletions"])
      deletion.set(doc(alice, "accounts", "alice", section, "generation-1"), {
        uid: "alice",
        createdAt: serverTimestamp(),
      });
    await assertSucceeds(deletion.commit());
    await assertFails(getDoc(output));
    await assertFails(saveGeneration(alice));
  });

  it("prevents resetting, deleting, skipping or moving an active usage counter", async () => {
    const alice = database("alice");
    const reference = doc(alice, "accounts", "alice", "usage", "ai");
    await assertSucceeds(
      setDoc(reference, {
        uid: "alice",
        action: "ai",
        targetId: "ai",
        count: 1,
        windowStart: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      updateDoc(reference, { count: 2, updatedAt: serverTimestamp() }),
    );
    for (const changes of [
      { count: 1 },
      { count: 4 },
      { count: 2 },
      { count: 3, action: "compile" },
      { count: 1, windowStart: serverTimestamp() },
      { count: 3, uid: "bob" },
      { count: 3, isAdmin: true },
    ])
      await assertFails(
        updateDoc(reference, { ...changes, updatedAt: serverTimestamp() }),
      );
    await assertFails(deleteDoc(reference));
    await assertFails(
      updateDoc(doc(database("bob"), reference.path), {
        count: 3,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("enforces the quota ceiling and permits a reset only after the old window expires", async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore;
      await setDoc(doc(db, "accounts", "alice", "usage", "ai"), {
        uid: "alice",
        action: "ai",
        targetId: "ai",
        count: 19,
        windowStart: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      await setDoc(doc(db, "accounts", "bob", "usage", "ai"), {
        uid: "bob",
        action: "ai",
        targetId: "ai",
        count: 20,
        windowStart: Timestamp.fromMillis(Date.now() - 172_800_000),
        updatedAt: Timestamp.now(),
      });
    });
    const alice = database("alice");
    await assertSucceeds(
      updateDoc(doc(alice, "accounts", "alice", "usage", "ai"), {
        count: 20,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(alice, "accounts", "alice", "usage", "ai"), {
        count: 21,
        updatedAt: serverTimestamp(),
      }),
    );
    const bob = database("bob");
    await assertSucceeds(
      updateDoc(doc(bob, "accounts", "bob", "usage", "ai"), {
        count: 1,
        windowStart: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });
});
