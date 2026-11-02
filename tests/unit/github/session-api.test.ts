import { copyFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { sessionImport } from "../../../src/lib/github/server/session-handler";
import {
  configureGithubServices,
  resetGithubServicesForTests,
} from "../../../src/lib/github/server/composition";
import { createE2eGithubServices } from "../../../src/lib/github/server/testing/e2e-runtime";
import { createImportClient } from "../../../src/lib/github/client";
import { openImportSession } from "../../../src/lib/github/server/session-envelope";
import type { Result } from "../../../src/lib/github/contracts";
const unwrap = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
};
let root: string;
afterEach(async () => {
  resetGithubServicesForTests();
  vi.unstubAllEnvs();
  if (
    root &&
    dirname(resolve(root)) === resolve(tmpdir()) &&
    /resume-changer-playwright-data-\d+$/.test(root)
  )
    await rm(root, { recursive: true, force: true });
});
it("uses real session HTTP contracts, retains completed downloads after failure and durably saves references only", async () => {
  root = join(tmpdir(), "resume-changer-playwright-data-" + Date.now());
  await mkdir(join(root, "data"), { recursive: true });
  await copyFile(
    "examples/sample-resume-library.json",
    join(root, "data/resume-library.json"),
  );
  for (const [k, v] of Object.entries({
    VERCEL: "",
    RESUME_APP_MODE: "local",
    RESUME_LIBRARY_ROOT: root,
    GITHUB_IMPORT_E2E_HARNESS: "1",
    GITHUB_IMPORT_E2E_BACKEND: "1",
    NEXT_RUNTIME: "nodejs",
  }))
    vi.stubEnv(k, v);
  const requests: string[] = [];
  let fail = false;
  let first: string | undefined;
  configureGithubServices(({ personalRoot, now }) =>
    createE2eGithubServices({
      personalRoot,
      now,
      beforeRequest(url) {
        if (url.pathname.includes("/git/blobs/")) {
          requests.push(url.pathname);
          first ??= url.pathname;
          if (fail && url.pathname !== first)
            throw new Error("synthetic interrupted batch");
        }
      },
    }),
  );
  let analysisCheckpoint: string | undefined;
  let capsule: string | null = null,
    checkpoints = 0;
  const uid = "local-" + "a".repeat(43);
  const client = createImportClient({
    session: true,
    fetch: async (input, init = {}) => {
      const response = await sessionImport(
        new Request("http://localhost/api/github/session", {
          method: "POST",
          headers: {
            origin: "http://localhost",
            cookie: "github_session=" + "a".repeat(43),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            version: 1,
            operationId: randomUUID(),
            state: capsule,
            path: String(input),
            method: init.method ?? "GET",
            ...(init.body ? { body: JSON.parse(String(init.body)) } : {}),
          }),
        }),
      );
      if (!response.ok) return response;
      const events = (await response.text())
        .trim()
        .split("\n")
        .map((x) => JSON.parse(x));
      for (const event of events) {
        capsule = event.state;
        if (event.type === "checkpoint") {
          checkpoints++;
          if (String(input).endsWith("/extract"))
            analysisCheckpoint = event.state;
        }
      }
      const final = events.at(-1);
      return Response.json(final.body, { status: final.status });
    },
  });
  const library = JSON.parse(
    await readFile(join(root, "data/resume-library.json"), "utf8"),
  );
  const scope = {
    repositoryId: "42",
    owner: "example",
    name: "publishing",
    canonicalUrl: "https://github.com/example/publishing",
    visibility: "public" as const,
    ref: "main",
    commitSha: "a".repeat(40),
    selectedPaths: [],
    selectedPullRequestNumbers: [7],
    contributionStatement:
      "I implemented publishing validation and regression tests.",
    identitySource: "user-provided" as const,
  };
  const record = unwrap(
    await client.create({
      source: "personal",
      destinationProjectId: library.projects[0].id,
      scope,
    }),
  );
  const prepareStarted = performance.now();
  fail = true;
  const failed = await client.prepare(record.id, record.version);
  expect(failed.ok).toBe(false);
  expect(checkpoints).toBeGreaterThan(0);
  expect(openImportSession(capsule!, uid).files).toBeDefined();
  const count = requests.filter((p) => p === first).length;
  fail = false;
  let review = unwrap(await client.get(record.id));
  const prep = unwrap(await client.prepare(record.id, review.import.version));
  expect(prep.state).toBe("completed");
  const prepareMs = Math.round(performance.now() - prepareStarted);
  expect(requests.filter((p) => p === first)).toHaveLength(count);
  review = unwrap(await client.get(record.id));
  expect(review.prepared!.evidence.length).toBeGreaterThan(0);
  const analysis = unwrap(
    await client.enqueueAnalysis(
      record.id,
      review.import.version,
      review.prepared!.selectionHash,
      "session-consent",
    ),
  );
  expect(analysis.state).toBe("completed");
  const completedCapsule = capsule;
  const downloaded = Object.entries(openImportSession(capsule!, uid).files)
    .filter(([path]) => path.startsWith("data/github-imports/"))
    .flatMap(([, text]) => JSON.parse(text).cache)
    .filter((entry) => entry.value.kind === "safe-content");
  expect(downloaded).toEqual([]);
  capsule = analysisCheckpoint!;
  const requestsBeforeRestore = requests.length;
  expect(unwrap(await client.get(record.id)).import.lifecycle).toBe(
    "interrupted",
  );
  expect(requests).toHaveLength(requestsBeforeRestore);
  capsule = completedCapsule;
  console.info("Synthetic session preparation benchmark", {
    prepareAndRetryMs: prepareMs,
    blobAttempts: requests.length,
    completedFileCheckpoints: checkpoints,
    retainedFirstFileFetches: count,
    sourcePersistenceCalls: 0,
  });
  review = unwrap(await client.get(record.id));
  const draft = review.result!.drafts[0];
  unwrap(
    await client.updateDraft(
      record.id,
      draft.id,
      review.import.version,
      draft.text,
      { selectedForSave: true, contributionConfirmed: true },
    ),
  );
  review = unwrap(await client.get(record.id));
  const beforeSave = capsule;
  const saved = unwrap(
    await client.approve(
      record.id,
      review.import.version,
      [draft.id],
      "session-save",
    ),
  );
  expect(saved.savedIds).toHaveLength(1);
  expect(capsule).toBeNull();
  // Replaying a lost save acknowledgement is protected by the atomic library receipt.
  capsule = beforeSave;
  expect(
    unwrap(
      await client.approve(
        record.id,
        review.import.version,
        [draft.id],
        "session-save",
      ),
    ).savedIds,
  ).toEqual(saved.savedIds);
  const written = JSON.parse(
    await readFile(join(root, "data/resume-library.json"), "utf8"),
  );
  const point = written.projects
    .flatMap((p: { points: unknown[] }) => p.points)
    .find((p: { id: string }) => p.id === saved.savedIds[0]);
  // Saved provenance identifies the selector behavior that produced the evidence.
  expect(
    written.projects
      .flatMap(
        (p: {
          repositoryAttachments: { snapshots: { selectorVersion: string }[] }[];
        }) => p.repositoryAttachments,
      )
      .flatMap((a: { snapshots: { selectorVersion: string }[] }) => a.snapshots)
      .some(
        (snapshot: { selectorVersion: string }) =>
          snapshot.selectorVersion === "contribution-selector-v2",
      ),
  ).toBe(true);
  expect(
    point.githubEvidence.evidence.every((e: object) => !("excerpt" in e)),
  ).toBe(true);
  expect(JSON.stringify(written)).not.toContain(
    "export function validatePublish(input",
  );
  expect(
    (await readdir(join(root, "data"))).filter((x) => x.startsWith("github-")),
  ).toEqual([]);
  expect(await readdir(root)).toEqual(["data"]);
  capsule = null;
  expect((await client.get(record.id)).ok).toBe(false);
}, 20000);

async function partialFixture(repositoryId: string, name: string) {
  root = join(tmpdir(), "resume-changer-playwright-data-" + Date.now());
  await mkdir(join(root, "data"), { recursive: true });
  await copyFile(
    "examples/sample-resume-library.json",
    join(root, "data/resume-library.json"),
  );
  for (const [k, v] of Object.entries({
    VERCEL: "",
    RESUME_APP_MODE: "local",
    RESUME_LIBRARY_ROOT: root,
    GITHUB_IMPORT_E2E_HARNESS: "1",
    GITHUB_IMPORT_E2E_BACKEND: "1",
    NEXT_RUNTIME: "nodejs",
  }))
    vi.stubEnv(k, v);
  let providerCalls = 0,
    capsule: string | null = null;
  configureGithubServices(({ personalRoot, now }) =>
    createE2eGithubServices({
      personalRoot,
      now,
      beforeProvider() {
        providerCalls++;
      },
    }),
  );
  const client = createImportClient({
    session: true,
    fetch: async (path, init = {}) => {
      const response = await sessionImport(
        new Request("http://localhost/api/github/session", {
          method: "POST",
          headers: {
            origin: "http://localhost",
            cookie: "github_session=" + "a".repeat(43),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            version: 1,
            operationId: randomUUID(),
            state: capsule,
            path: String(path),
            method: init.method ?? "GET",
            ...(init.body ? { body: JSON.parse(String(init.body)) } : {}),
          }),
        }),
      );
      if (!response.ok) return response;
      const events = (await response.text())
        .trim()
        .split("\n")
        .map((x) => JSON.parse(x));
      capsule = events.at(-1).state;
      return Response.json(events.at(-1).body, {
        status: events.at(-1).status,
      });
    },
  });
  const library = JSON.parse(
    await readFile(join(root, "data/resume-library.json"), "utf8"),
  );
  const record = unwrap(
    await client.create({
      source: "personal",
      destinationProjectId: library.projects[0].id,
      scope: {
        repositoryId,
        owner: "example",
        name,
        canonicalUrl: `https://github.com/example/${name}`,
        visibility: "public",
        ref: "main",
        commitSha: "a".repeat(40),
        selectedPaths: [],
        selectedPullRequestNumbers: [],
        contributionStatement: "entire project.",
        identitySource: "user-provided",
      },
    }),
  );
  unwrap(await client.prepare(record.id, record.version));
  return { client, record, providerCalls: () => providerCalls };
}

it.each([
  ["43", "publishing-no-tests"],
  ["46", "publishing-dense"],
])(
  "allows partial evidence through the real session stack for %s without calling AI during preparation",
  async (repositoryId, name) => {
    const f = await partialFixture(repositoryId, name);
    let review = unwrap(await f.client.get(f.record.id));
    expect(review.import.lifecycle).toBe("partial");
    expect(review.prepared?.completeness).toBe("partial");
    expect(review.prepared?.limitations.join(" ")).toContain(
      "No test evidence was included",
    );
    expect(f.providerCalls()).toBe(0);
    expect(review.result).toBeNull();
    unwrap(
      await f.client.enqueueAnalysis(
        f.record.id,
        review.import.version,
        review.prepared!.selectionHash,
        "partial-consent",
      ),
    );
    review = unwrap(await f.client.get(f.record.id));
    expect(review.result?.drafts.length).toBeGreaterThan(0);
    expect(f.providerCalls()).toBe(1);
  },
  15000,
);

it("keeps documentation-only evidence blocked at the real API without calling the provider", async () => {
  const f = await partialFixture("44", "publishing-docs-only"),
    review = unwrap(await f.client.get(f.record.id));
  expect(review.prepared?.completeness).toBe("needs-context");
  expect(review.import.lifecycle).toBe("needs-input");
  expect(review.prepared?.limitations.join(" ")).toContain(
    "does not show an implementation",
  );
  const attempt = await f.client.enqueueAnalysis(
    f.record.id,
    review.import.version,
    review.prepared!.selectionHash,
    "blocked-consent",
  );
  expect(attempt.ok).toBe(false);
  expect(f.providerCalls()).toBe(0);
}, 15000);

it("returns an explicitly empty model result separately from a preparation blocker", async () => {
  const f = await partialFixture("45", "publishing-empty-output");
  let review = unwrap(await f.client.get(f.record.id));
  unwrap(
    await f.client.enqueueAnalysis(
      f.record.id,
      review.import.version,
      review.prepared!.selectionHash,
      "empty-consent",
    ),
  );
  review = unwrap(await f.client.get(f.record.id));
  expect(review.import.lifecycle).toBe("ready-to-review");
  expect(review.result?.drafts).toEqual([]);
  expect(review.result?.model).toBe("synthetic-source-extractor");
  expect(f.providerCalls()).toBe(1);
}, 15000);
