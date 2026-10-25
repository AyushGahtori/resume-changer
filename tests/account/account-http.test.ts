import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
const origin = "http://127.0.0.1:3017";
type Identity = { uid: string; cookie: string; email: string };
let alice: Identity, bob: Identity;
let library: Record<string, unknown>;
async function signIn(name: string): Promise<Identity> {
  const email = `${name}@example.test`;
  const login = await fetch(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-key",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestUri: origin,
        postBody: new URLSearchParams({
          providerId: "google.com",
          id_token: JSON.stringify({
            sub: name,
            email,
            email_verified: true,
            name,
          }),
        }).toString(),
        returnSecureToken: true,
      }),
    },
  );
  const tokens = await login.json();
  expect(login.status, JSON.stringify(tokens)).toBe(200);
  const session = await fetch(`${origin}/api/auth/session`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: tokens.idToken }),
  });
  expect(session.status, await session.clone().text()).toBe(200);
  const cookie = session.headers.get("set-cookie")!.split(";")[0];
  expect(session.headers.get("set-cookie")).toContain("HttpOnly");
  return { uid: tokens.localId, cookie, email };
}
function call(
  identity: Identity | null,
  route: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return fetch(`${origin}${route}`, {
    method,
    redirect: "manual",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(identity
        ? { Cookie: identity.cookie, "X-Workspace-Account": identity.uid }
        : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const savedResume = {
  id: "generation-account-test",
  createdAt: "2026-10-19T12:00:00.000Z",
  company: "Example Systems",
  role: "Platform Engineer",
  selectedAchievementIds: ["achievement-api-reliability"],
  generatedBullets: [
    {
      id: "generated-bullet-1",
      text: "Improved service reliability through queue backpressure.",
      section: "experience",
      sourceAchievementIds: ["achievement-api-reliability"],
    },
  ],
  provider: "gemini",
  status: "drafted",
  repairAttemptCount: 0,
  latex:
    "\\documentclass{article}\\begin{document}Fictional resume\\end{document}",
};
beforeAll(async () => {
  if (
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !==
    "demo-resume-changer-security"
  )
    throw new Error("Fictional accounts must never run against production.");
  library = JSON.parse(
    await readFile("examples/sample-resume-library.json", "utf8"),
  );
  alice = await signIn("alice-http");
  bob = await signIn("bob-http");
});
describe("actual authenticated HTTP and database flow", () => {
  it("protects every API before parsing data or calling AI", async () => {
    const routes = [
      ["/api/ai/achievement", "POST"],
      ["/api/ai/analyze-job-description", "POST"],
      ["/api/ai/auto-tailor", "POST"],
      ["/api/ai/select-achievements", "POST"],
      ["/api/ai/tailor-achievements", "POST"],
      ["/api/compile", "POST"],
      ["/api/generate", "POST"],
      ["/api/history", "GET"],
      ["/api/history/missing", "GET"],
      ["/api/history/missing/pdf", "GET"],
      ["/api/library/points", "POST"],
      ["/api/library/points/missing", "PATCH"],
      ["/api/resume/edit", "POST"],
      ["/api/resume/skills", "GET"],
      ["/api/account/library", "GET"],
    ];
    for (const [route, method] of routes) {
      const response = await call(
        null,
        route,
        method,
        method === "GET" ? undefined : {},
      );
      expect(response.status, route).toBe(401);
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
  });
  it("redirects signed-out pages and supplies a fresh script nonce", async () => {
    const response = await call(null, "/library");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/sign-in");
    const first = await call(null, "/sign-in"),
      second = await call(null, "/sign-in");
    expect(first.headers.get("content-security-policy")).toContain("'nonce-");
    expect(first.headers.get("content-security-policy")).not.toBe(
      second.headers.get("content-security-policy"),
    );
  });
  it("creates empty accounts and imports only into the exact signed-in destination", async () => {
    const empty = await call(bob, "/api/account/library");
    expect(empty.status, await empty.clone().text()).toBe(200);
    expect((await empty.json()).library.jobs).toEqual([]);
    expect(
      (
        await call(bob, "/api/account/library", "PUT", {
          library,
          targetEmail: alice.email,
        })
      ).status,
    ).toBe(403);
    const imported = await call(alice, "/api/account/library", "PUT", {
      library,
      targetEmail: alice.email,
    });
    expect(imported.status, await imported.clone().text()).toBe(200);
    expect(
      (await (await call(alice, "/api/account/library")).json()).library,
    ).toEqual(library);
    expect(
      (await (await call(bob, "/api/account/library")).json()).library.jobs,
    ).toEqual([]);
  });
  it("rejects stale-tab identity, forged cookies and cross-site mutations", async () => {
    expect(
      (
        await call(
          bob,
          "/api/account/library",
          "PUT",
          { library, targetEmail: bob.email },
          { "X-Workspace-Account": alice.uid },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          alice,
          "/api/account/library",
          "PUT",
          {},
          { Origin: "https://attacker.example" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(alice, "/api/account/library", "GET", undefined, {
          Cookie: "resume_session=forged",
        })
      ).status,
    ).toBe(401);
  });

  it("preserves simultaneous edits to different achievements", async () => {
    const saved = await (await call(alice, "/api/account/library")).json();
    const points = saved.library.jobs.flatMap(
      (job: { points: { id: string }[] }) => job.points,
    );
    expect(points.length).toBeGreaterThan(1);
    const responses = await Promise.all(
      points.slice(0, 2).map((point: { id: string }, index: number) =>
        call(alice, `/api/library/points/${point.id}`, "PATCH", {
          changes: { text: `Fictional concurrent achievement ${index}` },
        }),
      ),
    );
    for (const response of responses)
      expect(response.status, await response.clone().text()).toBe(200);
    const after = (
      await (await call(alice, "/api/account/library")).json()
    ).library.jobs.flatMap((job: { points: { text: string }[] }) => job.points);
    expect(after.map((point: { text: string }) => point.text)).toContain(
      "Fictional concurrent achievement 0",
    );
    expect(after.map((point: { text: string }) => point.text)).toContain(
      "Fictional concurrent achievement 1",
    );
  });
  it("saves/reopens history, prevents cross-account access and imports idempotently", async () => {
    const body = { targetEmail: alice.email, generation: savedResume };
    for (let index = 0; index < 2; index++) {
      const response = await call(
        alice,
        "/api/account/import/history",
        "POST",
        body,
      );
      expect(response.status, await response.clone().text()).toBe(201);
    }
    expect(
      (
        await call(alice, "/api/account/import/history", "POST", {
          ...body,
          generation: { ...savedResume, latex: "A different output" },
        })
      ).status,
    ).toBe(409);
    const saved = await call(alice, `/api/history/${savedResume.id}`);
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect((await saved.json()).latex).toBe(savedResume.latex);
    expect((await call(bob, `/api/history/${savedResume.id}`)).status).toBe(
      404,
    );
    expect((await call(bob, `/api/history/${savedResume.id}/pdf`)).status).toBe(
      404,
    );
    expect((await (await call(bob, "/api/history")).json()).entries).toEqual(
      [],
    );
    const removed = await call(
      alice,
      `/api/history/${savedResume.id}`,
      "DELETE",
    );
    expect(removed.status, await removed.clone().text()).toBe(200);
    expect((await call(alice, `/api/history/${savedResume.id}`)).status).toBe(
      404,
    );
    expect(
      (await call(alice, "/api/account/import/history", "POST", body)).status,
    ).toBe(409);
  });
});
