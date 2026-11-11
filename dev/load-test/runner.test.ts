import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { replayEvents, resolveRunDirectory } from "./artifacts.mjs";
import { isClientAbort } from "./browser-driver.mjs";
import { parseArgs, resolveRunConfig } from "./config.mjs";
import { estimateRun } from "./estimate.mjs";
import {
  assignUser,
  loadCatalog,
  userSeed,
  verifyLibrary,
} from "./fixtures.mjs";
import { observeLibrary, reconcileMutation } from "./reconcile.mjs";
import { percentile, summarizeRun, windowHealth } from "./report.mjs";
import { assertLoadTestEnvironment, assertLoopbackTarget } from "./safety.mjs";
import {
  browserSlotCap,
  createFakeClock,
  createLimiter,
  isBrowserUser,
  rampTargets,
  settleAfterInterrupt,
  simulatePool,
} from "./scheduler.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("load-test safety", () => {
  it("keeps the browser helper out of the product routes", () => {
    expect(
      existsSync(path.join(root, "src", "app", "e2e", "load-test-auth")),
    ).toBe(false);
  });

  it("refuses remote targets, redirects, credentials, and hosted environments", () => {
    expect(() => assertLoopbackTarget("https://example.com")).toThrow(
      /loopback/,
    );
    expect(() => assertLoopbackTarget("http://127.0.0.1:3020/library")).toThrow(
      /path/,
    );
    expect(() =>
      assertLoopbackTarget("http://user:pass@127.0.0.1:3020"),
    ).toThrow(/credentials/);
    expect(() =>
      assertLoadTestEnvironment(
        {
          VERCEL: "1",
          RESUME_APP_MODE: "firebase",
          NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-resume-changer-loadtest",
          NEXT_PUBLIC_FIREBASE_DATABASE_ID: "(default)",
          FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9098",
          NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9098",
          FIRESTORE_EMULATOR_HOST: "127.0.0.1:8088",
          RESUME_LOAD_TEST: "1",
        },
        "http://127.0.0.1:3020",
      ),
    ).toThrow(/VERCEL/);
    expect(() =>
      assertLoadTestEnvironment(
        {
          RESUME_APP_MODE: "firebase",
          NEXT_PUBLIC_FIREBASE_PROJECT_ID: "resume-changer-ayush-prod",
          NEXT_PUBLIC_FIREBASE_DATABASE_ID: "(default)",
          FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9098",
          NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9098",
          FIRESTORE_EMULATOR_HOST: "127.0.0.1:8088",
          RESUME_LOAD_TEST: "1",
        },
        "http://127.0.0.1:3020",
      ),
    ).toThrow(/demo-resume-changer-loadtest/);
  });

  it("rejects unknown flags and out-of-range integers", () => {
    expect(() => parseArgs(["run", "--force", "cloud"])).toThrow(
      /Unknown argument/,
    );
    expect(() =>
      resolveRunConfig(parseArgs(["run", "--users", "1001"])),
    ).toThrow(/users/);
    expect(() =>
      resolveRunConfig(
        parseArgs(["run", "--users", "10", "--concurrency", "11"]),
      ),
    ).toThrow(/concurrency/);
    expect(
      resolveRunConfig(parseArgs(["estimate", "--users", "10"])).users,
    ).toBe(10);
  });
});

describe("load-test scheduler", () => {
  it("assigns every twentieth user to the browser and caps both profiles", () => {
    const browsers = Array.from({ length: 1000 }, (_, index) =>
      isBrowserUser(index + 1, 5),
    ).filter(Boolean);
    expect(browsers).toHaveLength(50);
    expect(browserSlotCap(100, 5)).toBe(5);
    expect(browserSlotCap(120, 5)).toBe(6);
    expect(browserSlotCap(100, 0)).toBe(0);
    expect(rampTargets(100)).toEqual([5, 20, 50, 100]);
    expect(rampTargets(2)).toEqual([2]);
  });

  it("spaces requests without stored burst credits", async () => {
    const clock = createFakeClock();
    const limiter = createLimiter(20, clock);
    const first = limiter.acquire();
    await Promise.resolve();
    await clock.advance(0);
    expect(await first).toBe(0);
    const second = limiter.acquire();
    let released = false;
    void second.then(() => {
      released = true;
    });
    await Promise.resolve();
    expect(released).toBe(false);
    await clock.advance(49);
    await Promise.resolve();
    expect(released).toBe(false);
    await clock.advance(1);
    expect(await second).toBe(50);
  });

  it("reaches the pool caps at 100 and 120 and then drains", () => {
    for (const concurrency of [100, 120]) {
      const result = simulatePool({
        users: 1000,
        concurrency,
        browserPercent: 5,
        stageMs: 60_000,
        sessionMs: 500_000,
        limitMs: 8_000_000,
      });
      expect(result.browserUsers).toBe(50);
      expect(result.completed).toBe(1000);
      expect(result.maxActive).toBeLessThanOrEqual(concurrency);
      expect(result.maxActive).toBe(concurrency);
      expect(result.maxBrowsers).toBeLessThanOrEqual(
        browserSlotCap(concurrency, 5),
      );
    }
  });

  it("does not let a full browser cap block API admissions", () => {
    const result = simulatePool({
      users: 4,
      concurrency: 2,
      browserPercent: 50,
      stageMs: 60_000,
      sessionMs: 10_000,
      limitMs: 100_000,
    });
    expect(result.completed).toBe(4);
    expect(result.maxBrowsers).toBe(1);
    expect(result.maxActive).toBeLessThanOrEqual(2);
  });

  it("stops after the interrupt grace period", async () => {
    const clock = createFakeClock();
    let release = () => {};
    const hanging = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = settleAfterInterrupt([hanging], clock, 30_000);
    await clock.advance(30_000);
    await expect(pending).resolves.toEqual({ winner: "timeout" });
    release();
    const clockTwo = createFakeClock();
    await expect(
      settleAfterInterrupt([Promise.resolve()], clockTwo, 30_000),
    ).resolves.toEqual({ winner: "settled" });
  });
});

describe("load-test reconciliation and estimates", () => {
  it("checkpoints an equal read and retries only when the write is absent", () => {
    expect(reconcileMutation("uncertain", "equal")).toBe("checkpoint");
    expect(reconcileMutation("uncertain", "absent")).toBe("retry");
    expect(reconcileMutation("uncertain", "unavailable")).toBe("stop");
    expect(reconcileMutation("uncertain", "conflict")).toBe("fail");
    expect(
      observeLibrary(
        "point",
        { jobs: [], projects: [] },
        { id: "point-1", text: "x" },
      ),
    ).toBe("absent");
    expect(
      observeLibrary(
        "point",
        { jobs: [{ points: [{ id: "point-1", text: "x" }] }], projects: [] },
        { id: "point-1", text: "x" },
      ),
    ).toBe("equal");
  });

  it("builds the same assignment from the user seed and labels the estimate", async () => {
    const { catalog, hash } = await loadCatalog(
      path.join(root, "dev", "load-test", "fixtures", "catalog.json"),
    );
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    const first = assignUser(catalog, 42, 1, "estimate");
    const second = assignUser(catalog, 42, 1, "estimate");
    expect(first.jobs.map((job) => job.templateId)).toEqual(
      second.jobs.map((job) => job.templateId),
    );
    expect(userSeed(42, 1)).toBe(userSeed(42, 1));
    expect(assignUser(catalog, 42, 10, "estimate").partial).toBe(true);
    const estimate = estimateRun(catalog, { users: 10, seed: 42 });
    expect(estimate.label).toMatch(/estimated lower bound/i);
    expect(estimate.changedSaves).toBe(260);
    expect(estimate.documentWritesLowerBound).toBeGreaterThan(
      estimate.changedSaves,
    );
    expect(estimate.maxLibraryUtf8Bytes).toBeLessThan(
      estimate.libraryByteLimit,
    );
  });

  it("keeps cleanup paths inside the run directory", () => {
    expect(resolveRunDirectory(root, "smoke-1")).toContain(
      `${path.sep}.runtime${path.sep}load-test${path.sep}smoke-1`,
    );
    expect(() => resolveRunDirectory(root, "..")).toThrow(/invalid/i);
    expect(() => resolveRunDirectory(root, "nested/path")).toThrow(/invalid/i);
  });

  it("reports a missing achievement instead of throwing", () => {
    const profile = {
      fullName: "A",
      headline: "",
      email: "",
      phone: "",
      location: "",
      links: [],
    };
    const errors = verifyLibrary(
      {
        profile,
        skills: [],
        jobs: [{ id: "job-1", points: [] }],
        projects: [
          {
            id: "project-1",
            points: [{ id: "p1", text: "t", skillIds: [] }],
          },
        ],
      },
      {
        profile,
        skillNames: [],
        jobs: [
          {
            id: "job-1",
            points: [{ id: "missing", text: "t", skillIds: ["skill-1"] }],
          },
        ],
        projects: [
          {
            id: "project-1",
            points: [{ id: "p1", text: "t", skillIds: [] }],
          },
        ],
      },
    );
    expect(errors).toContain("point missing");
  });

  it("ignores browser session refreshes cancelled by a later navigation", () => {
    expect(isClientAbort("net::ERR_ABORTED")).toBe(true);
    expect(isClientAbort("net::ERR_BLOCKED_BY_CLIENT.Inspector")).toBe(false);
    expect(isClientAbort("net::ERR_CONNECTION_REFUSED")).toBe(false);
    expect(isClientAbort(undefined)).toBe(false);
  });

  it("replays checkpoint events without credentials", () => {
    const users = replayEvents([
      JSON.stringify({ type: "checkpoint", user: 4, step: 2, status: "saved" }),
      JSON.stringify({ type: "response", user: 4, status: 200 }),
    ]);
    expect(users.get(4)).toMatchObject({ step: 2, status: "saved" });
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
    const summary = summarizeRun({
      passed: true,
      correctness: "passed",
      performance: "pending",
      exitReason: "pending",
      attempted: 1,
      completed: 1,
      failed: 0,
      interrupted: 0,
      notStarted: 0,
      apiUsers: 1,
      browserUsers: 0,
      maxActive: 1,
      maxBrowsers: 0,
      requests: [
        { channel: "api", latencyMs: 40, limiterWaitMs: 12, error: false },
        { channel: "api", latencyMs: 80, limiterWaitMs: 0, error: false },
        { channel: "page", latencyMs: 9_000, limiterWaitMs: 0, error: true },
      ],
      browserTraffic: 1,
      logicalWrites: 26,
      estimatedUnits: "1 estimated lower-bound write units",
      providerRequests: 0,
      externalRequests: 0,
      generatorLimited: false,
      eventLoopDelayMs: 1,
      startedAt: 0,
      finishedAt: 2_000,
    });
    expect(summary.applicationRequests).toBe(2);
    expect(summary.latencyMs.p95).toBe(80);
    expect(summary.limiterWaitMs.p95).toBe(12);
    expect(summary.applicationErrorRate).toBe(0);
    expect(
      windowHealth(
        Array.from({ length: 20 }, () => ({
          at: 1_000,
          latencyMs: 6_000,
          error: true,
        })),
        1_000,
      ).stop,
    ).toBe(true);
  });
});

describe("load-test process isolation", () => {
  it("blocks a remote target before a local capture proxy is contacted", async () => {
    let hits = 0;
    const server = createServer((_request, response) => {
      hits += 1;
      response.end("seen");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const child = spawn(
      process.execPath,
      [
        "--require",
        path.join(root, "dev", "load-test", "bootstrap.cjs"),
        "-e",
        `
          const http = require("node:http");
          const results = [];
          function attempt(name, run) {
            try { run(); results.push(name + ":sent"); }
            catch { results.push(name + ":blocked"); }
          }
          attempt("proxy", () => http.request({ hostname: "127.0.0.1", port: ${port}, path: "http://example.com/secret", method: "GET" }).end());
          attempt("public", () => http.request({ hostname: "1.1.1.1", port: 80, method: "GET" }).end());
          fetch("http://127.0.0.1:${port}/ok").then(() => {
            results.push("loopback:sent");
            process.stdout.write(JSON.stringify({ results }));
          }).catch((error) => {
            results.push("loopback:" + error.message);
            process.stdout.write(JSON.stringify({ results }));
          });
        `,
      ],
      { cwd: root },
    );
    const output = await new Promise<string>((resolve, reject) => {
      let text = "";
      child.stdout.on("data", (chunk) => {
        text += chunk;
      });
      child.on("exit", (code) => {
        if (code === 0) resolve(text);
        else reject(new Error(text || `guard process exited ${code}`));
      });
    });
    await new Promise((resolve) => server.close(resolve));
    const parsed = JSON.parse(output);
    expect(parsed.results).toContain("proxy:blocked");
    expect(parsed.results).toContain("public:blocked");
    expect(parsed.results).toContain("loopback:sent");
    expect(hits).toBe(1);
  });

  it("does not load a dummy env file into the isolated process", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "resume-load-env-"));
    temporary.push(directory);
    await writeFile(
      path.join(directory, ".env.local"),
      "SECRET_LOAD_TEST_SENTINEL=do-not-leak\n",
    );
    const child = spawn(
      process.execPath,
      [
        "--require",
        path.join(root, "dev", "load-test", "bootstrap.cjs"),
        "-e",
        `
          const { createRequire } = require("node:module");
          const req = createRequire(require.resolve("next/package.json"));
          const env = req("@next/env");
          const loaded = env.loadEnvConfig(process.argv[1], false);
          let forced = "reloaded";
          try { env.loadEnvConfig(process.argv[1], false, console, true); }
          catch { forced = "refused"; }
          process.stdout.write(JSON.stringify({
            secret: process.env.SECRET_LOAD_TEST_SENTINEL || null,
            parsed: loaded.parsedEnv?.SECRET_LOAD_TEST_SENTINEL || null,
            forced,
          }));
        `,
        directory,
      ],
      { cwd: root },
    );
    let text = "";
    child.stdout.on("data", (chunk) => {
      text += chunk;
    });
    const code = await new Promise((resolve) => child.on("exit", resolve));
    expect(code).toBe(0);
    expect(JSON.parse(text)).toEqual({
      secret: null,
      parsed: null,
      forced: "refused",
    });
    expect(
      await readFile(path.join(directory, ".env.local"), "utf8"),
    ).toContain("do-not-leak");
  });
});
