import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { exportJWK, generateKeyPair, SignJWT, type JSONWebKeySet } from "jose";

const state = vi.hoisted(() => ({ keySet: { keys: [] } as JSONWebKeySet }));
vi.mock("jose", async (original) => {
  const actual = await original<typeof import("jose")>();
  return {
    ...actual,
    createRemoteJWKSet: () => actual.createLocalJWKSet(state.keySet),
  };
});

let privateKey: CryptoKey;
let verifyToken: typeof import("../../../src/lib/cloud/server-account").verifyAccountToken;
const now = () => Math.floor(Date.now() / 1000);
const baseClaims = () => ({
  sub: "alice",
  email: "alice@example.test",
  email_verified: true,
  firebase: { sign_in_provider: "google.com" },
  auth_time: now(),
  iat: now(),
  exp: now() + 3600,
  iss: "https://securetoken.google.com/resume-test-project",
  aud: "resume-test-project",
});
async function token(changes: Record<string, unknown> = {}) {
  return new SignJWT({ ...baseClaims(), ...changes })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .sign(privateKey);
}

beforeAll(async () => {
  const keyPair = await generateKeyPair("RS256");
  privateKey = keyPair.privateKey;
  state.keySet.keys.push({
    ...(await exportJWK(keyPair.publicKey)),
    kid: "test-key",
    alg: "RS256",
    use: "sig",
  });
  verifyToken = (await import("../../../src/lib/cloud/server-account"))
    .verifyAccountToken;
});
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "resume-test-project");
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "fictional-public-key");
  vi.stubEnv(
    "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    "resume-test-project.firebaseapp.com",
  );
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_APP_ID", "fictional-app");
  vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "");
  vi.stubEnv("FIRESTORE_EMULATOR_HOST", "");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        users: [
          {
            localId: "alice",
            email: "alice@example.test",
            emailVerified: true,
            validSince: "0",
            displayName: "Alice",
          },
        ],
      }),
    ),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("server Firebase identity verification", () => {
  it("accepts a correctly signed token for the intended project and backend identity", async () => {
    await expect(verifyToken(await token())).resolves.toMatchObject({
      uid: "alice",
      email: "alice@example.test",
      displayName: "Alice",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=fictional-public-key",
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
  });
  it("rejects wrong projects, issuers, expired tokens, unverified emails and non-Google identities before account lookup", async () => {
    for (const changes of [
      { aud: "another-project" },
      { iss: "https://attacker.example" },
      { exp: now() - 60 },
      { email_verified: false },
      { firebase: { sign_in_provider: "anonymous" } },
      { auth_time: now() + 60 },
      { sub: "../bob" },
    ])
      await expect(verifyToken(await token(changes))).rejects.toMatchObject({
        status: 401,
      });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects modified signatures and unsigned tokens", async () => {
    const signed = await token();
    const [header, payload, signature] = signed.split(".");
    const alteredPayload = Buffer.from(
      JSON.stringify({ ...baseClaims(), sub: "bob" }),
    ).toString("base64url");
    await expect(
      verifyToken(`${header}.${alteredPayload}.${signature}`),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      verifyToken(
        `${Buffer.from('{"alg":"none"}').toString("base64url")}.${payload}.`,
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects disabled, revoked, deleted and mismatched backend accounts", async () => {
    const signed = await token();
    for (const changes of [
      { disabled: true },
      { validSince: String(now() + 10) },
      { localId: "bob" },
      { email: "bob@example.test" },
      { emailVerified: false },
    ]) {
      vi.mocked(fetch).mockResolvedValueOnce(
        Response.json({
          users: [
            {
              localId: "alice",
              email: "alice@example.test",
              emailVerified: true,
              validSince: "0",
              ...changes,
            },
          ],
        }),
      );
      await expect(verifyToken(signed)).rejects.toMatchObject({ status: 401 });
    }
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error: { message: "USER_NOT_FOUND" } }, { status: 400 }),
    );
    await expect(verifyToken(signed)).rejects.toMatchObject({ status: 401 });
  });
  it("keeps overlapping request identities isolated", async () => {
    const { accountContext, requireCloudAccount } =
      await import("../../../src/lib/cloud/server-account");
    const alice = {
      uid: "alice",
      email: "alice@example.test",
      displayName: "Alice",
      idToken: "fictional-alice-token",
      expiresAt: now() + 3600,
    };
    const bob = { ...alice, uid: "bob", email: "bob@example.test" };
    const results = await Promise.all(
      [alice, bob].map((account) =>
        accountContext.run(account, async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return (await requireCloudAccount()).uid;
        }),
      ),
    );
    expect(results).toEqual(["alice", "bob"]);
  });
});
