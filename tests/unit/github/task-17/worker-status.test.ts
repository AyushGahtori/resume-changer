import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readGithubImportWorkerStatus } from "../../../../src/workers/github-import-host";

const roots: string[] = [];
const priorStatusPath = process.env.GITHUB_IMPORT_WORKER_STATUS_PATH;

afterEach(async () => {
  if (priorStatusPath === undefined) {
    delete process.env.GITHUB_IMPORT_WORKER_STATUS_PATH;
  } else {
    process.env.GITHUB_IMPORT_WORKER_STATUS_PATH = priorStatusPath;
  }
  vi.useRealTimers();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("GitHub import worker readiness", () => {
  it("reports missing, malformed and stale status as unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "github-worker-status-"));
    roots.push(root);
    const statusPath = join(root, "status.json");
    process.env.GITHUB_IMPORT_WORKER_STATUS_PATH = statusPath;

    expect(readGithubImportWorkerStatus()).toMatchObject({
      state: "unknown",
      available: false,
    });
    await writeFile(statusPath, "not-json", "utf8");
    expect(readGithubImportWorkerStatus()).toMatchObject({
      state: "unknown",
      available: false,
    });

    await writeFile(
      statusPath,
      JSON.stringify({ state: "ready", updatedAt: "2026-10-26T11:00:00.000Z" }),
      "utf8",
    );
    expect(
      readGithubImportWorkerStatus({
        now: Date.parse("2026-10-26T12:00:00.000Z"),
      }),
    ).toMatchObject({ state: "unknown", available: false });
  });

  it("distinguishes a fresh ready worker from a fresh unavailable worker", async () => {
    const root = await mkdtemp(join(tmpdir(), "github-worker-status-"));
    roots.push(root);
    const statusPath = join(root, "status.json");
    process.env.GITHUB_IMPORT_WORKER_STATUS_PATH = statusPath;
    const now = Date.parse("2026-10-26T12:00:00.000Z");
    vi.setSystemTime(now);

    await writeFile(
      statusPath,
      JSON.stringify({
        pid: process.pid,
        state: "ready",
        available: true,
        updatedAt: new Date(now).toISOString(),
        reason: null,
      }),
      "utf8",
    );
    expect(readGithubImportWorkerStatus()).toMatchObject({
      state: "ready",
      available: true,
    });

    await writeFile(
      statusPath,
      JSON.stringify({
        pid: process.pid,
        state: "unavailable",
        available: false,
        updatedAt: new Date(now).toISOString(),
        reason: "runtime-unavailable",
      }),
      "utf8",
    );
    expect(readGithubImportWorkerStatus()).toMatchObject({
      state: "unavailable",
      available: false,
      reason: "runtime-unavailable",
    });

    await writeFile(
      statusPath,
      JSON.stringify({
        pid: 2_147_483_647,
        state: "ready",
        updatedAt: new Date(now).toISOString(),
        reason: null,
      }),
      "utf8",
    );
    expect(readGithubImportWorkerStatus()).toMatchObject({
      state: "unknown",
      available: false,
    });

    await writeFile(
      statusPath,
      JSON.stringify({
        pid: process.pid,
        state: "ready",
        updatedAt: new Date(now + 1_000).toISOString(),
        reason: null,
      }),
      "utf8",
    );
    expect(readGithubImportWorkerStatus()).toMatchObject({
      state: "unknown",
      available: false,
    });
  });
});
