import { readFile } from "node:fs/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { initializeApp, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  initializeTestEnvironment,
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFirestoreStateStorage } from "../../src/lib/github/server/hosted/firestore-state";
import {
  createHostedCredentialVault,
  createHostedAccessStore,
} from "../../src/lib/github/server/hosted/credential-store";
import type { GithubCredentialScope } from "../../src/lib/github/server/credentials-core";
import { createHostedJobOwners } from "../../src/lib/github/server/hosted/job-owners";
import { newGithubRequestContext } from "../../src/lib/github/server/composition";
import { createUnavailableBudgetLedger } from "../../src/lib/github/server/unavailable";

let app: App, db: Firestore, environment: RulesTestEnvironment;
const namespace = `test-${randomUUID().slice(0, 8)}`,
  root = resolve(".runtime/github-cloud-test"),
  target = join(root, "data", "state.json");
const recordId = createHash("sha256").update("data/state.json").digest("hex");
beforeAll(async () => {
  if (
    !/^(127\.0\.0\.1|localhost):\d+$/.test(
      process.env.FIRESTORE_EMULATOR_HOST ?? "",
    )
  )
    throw new Error("Only the local security emulator may run this suite.");
  app = initializeApp({ projectId: "demo-resume-changer-security" }, namespace);
  db = getFirestore(app);
  environment = await initializeTestEnvironment({
    projectId: "demo-resume-changer-security",
    firestore: { rules: await readFile("firestore.rules", "utf8") },
  });
});
afterAll(async () => {
  await environment?.cleanup();
  if (app) await deleteApp(app);
});
describe("hosted GitHub state boundaries", () => {
  it("persists job ownership independently of the browser and forbids rebinding another account", async () => {
    const owners = createHostedJobOwners(db, namespace, async () => ({
      disabled: false,
      emailVerified: true,
      providerData: [{ providerId: "google.com" }],
    }));
    const context = (uid: string) =>
      newGithubRequestContext({
        personalRoot: root,
        sessionId: `account-${uid}`,
        authorizationNamespace: `firebase:${uid}`,
        accountId: uid,
        grantedRepositoryIds: ["42"],
        signal: new AbortController().signal,
        budget: createUnavailableBudgetLedger(),
      });
    const job = {
      id: "owner-bound-job",
      importId: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    await owners.bind(job, context("owner-a"), "42");
    expect((await owners.resolve(job)).uid).toBe("owner-a");
    await expect(owners.bind(job, context("owner-b"), "42")).rejects.toThrow(
      /cannot change/,
    );
    await expect(
      owners.resolve({ ...job, importId: randomUUID() }),
    ).rejects.toThrow(/does not match/);
    expect(await owners.list("owner-b")).not.toContain(job.id);
  });
  it("rechecks account status before reconstructing a worker context", async () => {
    let disabled = false;
    const owners = createHostedJobOwners(db, namespace, async () => ({
      disabled,
      emailVerified: true,
      providerData: [{ providerId: "google.com" }],
    }));
    const context = newGithubRequestContext({
      personalRoot: root,
      sessionId: "account-owner-a",
      authorizationNamespace: "firebase:owner-a",
      accountId: "owner-a",
      grantedRepositoryIds: ["42"],
      signal: new AbortController().signal,
      budget: createUnavailableBudgetLedger(),
    });
    const job = {
      id: "disabled-owner-job",
      importId: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    await owners.bind(job, context, "42");
    disabled = true;
    await expect(owners.resolve(job)).rejects.toThrow(/unavailable/);
    await expect(
      owners.bind(
        { ...job, id: "forged-owner-job" },
        {
          ...context,
          access: {
            ...context.access,
            authorizationNamespace: "firebase:another-user",
          },
        },
        "42",
      ),
    ).rejects.toThrow(/Invalid/);
  });
  it("persists bounded state across independent adapter instances and rejects escaping paths", async () => {
    const first = createFirestoreStateStorage(db, namespace),
      second = createFirestoreStateStorage(db, namespace);
    await first.write(root, target, JSON.stringify({ version: 1 }));
    expect(await second.read(root, target, 1024)).toBe('{"version":1}');
    await expect(second.read(root, target, 2)).rejects.toThrow(/limit/);
    await expect(
      first.write(root, join(root, "..", "outside.json"), "bad"),
    ).rejects.toThrow(/Unsafe/);
  });
  it("serializes concurrent updates through database transactions", async () => {
    const adapters = [
      createFirestoreStateStorage(db, namespace),
      createFirestoreStateStorage(db, namespace),
    ];
    await adapters[0].write(root, target, "0");
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        adapters[i % 2].withLock(root, target, async () => {
          const value = Number(await adapters[i % 2].read(root, target, 100));
          await adapters[i % 2].write(root, target, String(value + 1));
        }),
      ),
    );
    expect(await adapters[0].read(root, target, 100)).toBe("6");
  });
  it("fences a writer whose lease was replaced and preserves the committed payload", async () => {
    const state = createFirestoreStateStorage(db, namespace);
    await state.write(root, target, "original");
    await state.withLock(root, target, async () => {
      const ref = db.collection(`github-internal-${namespace}`).doc(recordId);
      const current = (await ref.get()).data()!;
      await ref.set(
        {
          lockOwner: "new-writer",
          fence: current.fence + 1,
          leaseUntil: Date.now() + 30000,
        },
        { merge: true },
      );
      await expect(state.write(root, target, "stale")).rejects.toThrow(
        /lost its lease/,
      );
      await ref.set({ lockOwner: "", leaseUntil: 0 }, { merge: true });
    });
    expect(await state.read(root, target, 100)).toBe("original");
  });
  it("keeps credentials encrypted and binds decryption to the session, purpose and repository", async () => {
    const vault = createHostedCredentialVault(
      db,
      namespace,
      randomBytes(32).toString("base64"),
    );
    const scope: GithubCredentialScope = {
      sessionId: "account-owner",
      purpose: "repository",
      repositoryId: "42",
    };
    const handle = await vault.put({
      scope,
      secrets: { accessToken: "fictional-private-token" },
    });
    expect(await vault.read(handle, scope)).toEqual({
      accessToken: "fictional-private-token",
    });
    const ref = db
      .collection(`github-vault-${namespace}`)
      .doc(createHash("sha256").update(scope.sessionId).digest("hex"))
      .collection("credentials")
      .doc(handle);
    expect(JSON.stringify((await ref.get()).data())).not.toContain(
      "fictional-private-token",
    );
    expect(
      await vault.read(handle, { ...scope, sessionId: "account-other" }),
    ).toBeUndefined();
    await expect(
      vault.read(handle, { ...scope, repositoryId: "43" }),
    ).rejects.toThrow(/ownership/);
    await expect(
      vault.replace(
        handle,
        { ...scope, repositoryId: "43" },
        { accessToken: "replacement" },
      ),
    ).rejects.toThrow(/ownership/);
    await vault.deleteSession(scope.sessionId);
    expect(await vault.read(handle, scope)).toBeUndefined();
  });
  it("consumes OAuth state exactly once after matching account, origin and expiry", async () => {
    const store = createHostedAccessStore(db, namespace, async () => {}),
      pending = {
        stateHash: "a".repeat(64),
        sessionId: "account-owner",
        callbackOrigin: "https://preview.example.test",
        callbackUrl: "https://preview.example.test/callback",
        codeVerifier: "private-verifier",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      };
    await store.savePending(pending);
    expect(
      await store.consumePending({
        ...pending,
        callbackOrigin: "https://wrong.example.test",
        now: new Date().toISOString(),
      }),
    ).toBeUndefined();
    const results = await Promise.all(
      [1, 2].map(() =>
        store.consumePending({ ...pending, now: new Date().toISOString() }),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it("denies direct reads and writes to internal state and credentials even for a signed-in owner", async () => {
    const browser = environment
      .authenticatedContext("account-owner", {
        email: "owner@example.test",
        email_verified: true,
        firebase: { sign_in_provider: "google.com" },
      })
      .firestore();
    for (const path of [
      `github-internal-${namespace}/${recordId}`,
      `github-vault-${namespace}/owner/credentials/secret`,
      `github-connections-${namespace}/owner`,
      `github-job-owners-${namespace}/job`,
    ]) {
      await assertFails(getDoc(doc(browser, path)));
      await assertFails(setDoc(doc(browser, path), { tampered: true }));
    }
  });
});
