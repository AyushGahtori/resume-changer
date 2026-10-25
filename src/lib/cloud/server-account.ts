import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { initializeServerApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { getFirebaseClientConfig, getFirestoreDatabaseId } from "./config";
import {
  AccountAccessError,
  assertSafeEmulator,
  requireSafeUid,
} from "./security";

export type CloudAccount = {
  uid: string;
  email: string;
  displayName: string;
  idToken: string;
  expiresAt: number;
};

export const accountContext = new AsyncLocalStorage<CloudAccount>();
const keys = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  ),
);
const authFailure = () =>
  new AccountAccessError(
    "Sign in to access your workspace.",
    "AUTH_REQUIRED",
    401,
  );
const AuthUserSchema = z.object({
  localId: z.string(),
  email: z.email(),
  emailVerified: z.literal(true),
  displayName: z.string().optional(),
  validSince: z.string().regex(/^\d+$/).optional(),
  disabled: z.boolean().optional(),
});

export function sessionCookieName(): string {
  return process.env.VERCEL === "1" ||
    (process.env.NODE_ENV === "production" && !assertSafeEmulator())
    ? "__Host-resume_session"
    : "resume_session";
}

/** Verify signature, intended project, expiry, verified email and backend revocation state. */
export async function verifyAccountToken(
  idToken: string,
): Promise<CloudAccount> {
  if (!idToken || idToken.length > 12_000) throw authFailure();
  const config = getFirebaseClientConfig();
  const emulator = assertSafeEmulator();
  let claims: Record<string, unknown>;
  try {
    if (emulator) {
      claims = JSON.parse(
        Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"),
      );
    } else {
      const verified = await jwtVerify(idToken, keys, {
        algorithms: ["RS256"],
        audience: config.projectId,
        issuer: `https://securetoken.google.com/${config.projectId}`,
        clockTolerance: 15,
      });
      claims = verified.payload;
    }
    const now = Math.floor(Date.now() / 1000);
    const provider =
      claims.firebase &&
      typeof claims.firebase === "object" &&
      "sign_in_provider" in claims.firebase
        ? claims.firebase.sign_in_provider
        : undefined;
    if (
      claims.aud !== config.projectId ||
      claims.iss !== `https://securetoken.google.com/${config.projectId}` ||
      typeof claims.sub !== "string" ||
      typeof claims.exp !== "number" ||
      claims.exp <= now ||
      typeof claims.auth_time !== "number" ||
      claims.auth_time < 0 ||
      claims.auth_time > now + 15 ||
      claims.email_verified !== true ||
      provider !== "google.com"
    )
      throw authFailure();
    try {
      requireSafeUid(claims.sub);
    } catch {
      throw authFailure();
    }
    const authOrigin = emulator
      ? `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com`
      : "https://identitytoolkit.googleapis.com";
    const response = await fetch(
      `${authOrigin}/v1/accounts:lookup?key=${encodeURIComponent(config.apiKey!)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!response.ok) throw authFailure();
    const result = z
      .object({ users: z.array(AuthUserSchema).length(1) })
      .parse(await response.json());
    const user = result.users[0];
    if (
      user.disabled ||
      user.localId !== claims.sub ||
      user.email.toLowerCase() !== String(claims.email).toLowerCase() ||
      Number(user.validSince ?? "0") > claims.auth_time
    )
      throw authFailure();
    return {
      uid: user.localId,
      email: user.email,
      displayName: user.displayName ?? "",
      idToken,
      expiresAt: claims.exp,
    };
  } catch (error) {
    if (error instanceof AccountAccessError) throw error;
    throw authFailure();
  }
}

export async function accountFromRequest(
  request: Request,
): Promise<CloudAccount> {
  const token = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookieName()}=`))
    ?.slice(sessionCookieName().length + 1);
  if (!token) throw authFailure();
  return verifyAccountToken(token);
}

const accountFromCookies = cache(async () => {
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value;
  if (!token) throw authFailure();
  return verifyAccountToken(token);
});

export function requireCloudAccount(): Promise<CloudAccount> {
  const current = accountContext.getStore();
  return current ? Promise.resolve(current) : accountFromCookies();
}

const accountDatabase = cache(async (account: CloudAccount) => {
  const app = initializeServerApp(getFirebaseClientConfig(), {
    authIdToken: account.idToken,
    releaseOnDeref: await headers(),
  });
  const auth = getAuth(app);
  if (
    assertSafeEmulator() &&
    process.env.FIREBASE_AUTH_EMULATOR_HOST &&
    !auth.emulatorConfig
  ) {
    connectAuthEmulator(
      auth,
      `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`,
      { disableWarnings: true },
    );
  }
  await auth.authStateReady();
  if (auth.currentUser?.uid !== account.uid) throw authFailure();
  const db = getFirestore(app, getFirestoreDatabaseId());
  if (
    assertSafeEmulator() &&
    process.env.FIRESTORE_EMULATOR_HOST &&
    !emulatorDatabases.has(db)
  ) {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(":");
    connectFirestoreEmulator(db, host, Number(port));
    emulatorDatabases.add(db);
  }
  return db;
});

const emulatorDatabases = new WeakSet<object>();
const databaseRequests = new WeakMap<
  CloudAccount,
  ReturnType<typeof accountDatabase>
>();

export async function getAccountDatabase() {
  const account = await requireCloudAccount();
  let pending = databaseRequests.get(account);
  if (!pending) {
    pending = accountDatabase(account);
    databaseRequests.set(account, pending);
  }
  return { account, db: await pending };
}
