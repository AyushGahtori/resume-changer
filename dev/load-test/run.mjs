import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { runApiUser } from "./api-driver.mjs";
import { atomicWrite, readJson, resolveRunDirectory } from "./artifacts.mjs";
import { failurePath, runBrowserUser } from "./browser-driver.mjs";
import { parseArgs, resolveRunConfig } from "./config.mjs";
import { estimateRun } from "./estimate.mjs";
import { assignUser, loadCatalog, mulberry32 } from "./fixtures.mjs";
import { renderReport, summarizeRun, windowHealth } from "./report.mjs";
import {
  assertLoadTestEnvironment,
  assertLoopbackTarget,
  loadTestEnvironment,
} from "./safety.mjs";
import {
  browserSlotCap,
  createLimiter,
  createSystemClock,
  isBrowserUser,
  rampTargets,
} from "./scheduler.mjs";
import { sleep } from "./timing.mjs";

const require = createRequire(import.meta.url);
const devDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(devDir, "../..");
const firebaseBin = "/tmp/firebase-tools-pin/node_modules/.bin/firebase";
const nextCli = path.join(root, "node_modules", "next", "dist", "bin", "next");
const bootstrap = path.join(devDir, "bootstrap.cjs");
const guard = path.join(devDir, "outbound-guard.cjs");
const catalogPath = path.join(devDir, "fixtures", "catalog.json");
const authRouteDir = path.join(root, "src", "app", "e2e", "load-test-auth");
let built = false;

function exitWith(code, message) {
  if (message) console.error(message);
  process.exit(code);
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

function allowlistedEnv(baseURL) {
  const env = loadTestEnvironment(baseURL);
  assertLoadTestEnvironment(env, baseURL);
  return {
    ...env,
    PATH: process.env.PATH,
    HOME: process.env.HOME ?? "/tmp",
    TMPDIR: process.env.TMPDIR || "/tmp",
    LANG: "C.UTF-8",
    NODE_ENV: "production",
    NODE_OPTIONS: `--require ${bootstrap}`,
    CI: "1",
    NO_UPDATE_NOTIFIER: "1",
  };
}

function startChild(command, args, env, logFile) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const log = createWriteStream(logFile, { flags: "a" });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return child;
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode) return child.exitCode;
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(timeoutMs).then(() => child.kill("SIGKILL")),
  ]);
  return child.exitCode;
}

async function commandFinished(command, args, env) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  const code = await new Promise((resolve) => child.once("exit", resolve));
  if (code !== 0) {
    throw Object.assign(
      new Error(`${path.basename(command)} ${args.join(" ")} failed.`),
      { code: 2 },
    );
  }
}

async function ensureTools() {
  const { existsSync } = await import("node:fs");
  if (!existsSync(firebaseBin)) {
    await commandFinished(
      "npm",
      [
        "install",
        "--prefix",
        "/tmp/firebase-tools-pin",
        "firebase-tools@15.34.1",
        "--no-audit",
        "--no-fund",
      ],
      process.env,
    );
  }
  const playwright = require("playwright");
  if (!existsSync(playwright.chromium.executablePath())) {
    await commandFinished(
      process.execPath,
      [
        path.join(root, "node_modules", "playwright", "cli.js"),
        "install",
        "chromium",
      ],
      process.env,
    );
  }
}

async function writeEmulatorConfig() {
  const target = path.join(root, "firebase.load-test.json");
  const source = JSON.parse(
    await readFile(path.join(devDir, "firebase.json"), "utf8"),
  );
  source.firestore.rules = "firestore.rules";
  source.firestore.indexes = "firestore.indexes.json";
  await writeFile(target, `${JSON.stringify(source, null, 2)}\n`);
  return target;
}

async function mountLoadTestRoute() {
  await mkdir(authRouteDir, { recursive: true });
  await copyFile(
    path.join(devDir, "browser-auth", "page.tsx"),
    path.join(authRouteDir, "page.tsx"),
  );
  await copyFile(
    path.join(devDir, "browser-auth", "load-test-auth-client.tsx"),
    path.join(authRouteDir, "load-test-auth-client.tsx"),
  );
}

async function unmountLoadTestRoute() {
  await rm(authRouteDir, { recursive: true, force: true });
}

async function ensureBuild(env) {
  if (built) return;
  const preserved = ["next-env.d.ts", "tsconfig.json"];
  const snapshots = new Map();
  for (const name of preserved) {
    snapshots.set(name, await readFile(path.join(root, name)));
  }
  await mountLoadTestRoute();
  try {
    await commandFinished(
      process.execPath,
      [path.join(root, "scripts", "build-github-worker.mjs")],
      env,
    );
    await commandFinished(
      process.execPath,
      ["--require", bootstrap, nextCli, "build"],
      env,
    );
    built = true;
  } finally {
    for (const [name, contents] of snapshots) {
      await writeFile(path.join(root, name), contents);
    }
    await unmountLoadTestRoute();
  }
}

function sanitize(event) {
  const copy = { ...event };
  for (const key of [
    "idToken",
    "cookie",
    "authorization",
    "email",
    "refreshToken",
  ]) {
    delete copy[key];
  }
  return copy;
}

async function executeRun(config, runId, { resume = false } = {}) {
  assertLoopbackTarget(config.baseURL);
  if (process.env.VERCEL) {
    throw Object.assign(
      new Error("The load test refuses to run when VERCEL is set."),
      {
        code: 2,
      },
    );
  }
  const directory = resolveRunDirectory(root, runId);
  await mkdir(path.join(directory, "failures"), { recursive: true });
  const { catalog, hash } = await loadCatalog(catalogPath);
  const configPath = path.join(directory, "config.json");
  const resolved = {
    ...config,
    runId,
    fixtureHash: hash,
    projectId: "demo-resume-changer-loadtest",
    databaseId: "(default)",
  };
  if (resume) {
    const previous = await readJson(configPath);
    for (const key of [
      "users",
      "concurrency",
      "browserPercent",
      "seed",
      "fixtureHash",
      "projectId",
      "baseURL",
    ]) {
      if (previous[key] !== resolved[key]) {
        throw Object.assign(
          new Error(`Refusing to resume because ${key} changed.`),
          { code: 2 },
        );
      }
    }
    const owner = await readJson(path.join(directory, "emulator-owner.json"));
    if (owner.projectId !== resolved.projectId || owner.runId !== runId) {
      throw Object.assign(
        new Error("The emulator export belongs to another run."),
        {
          code: 2,
        },
      );
    }
  } else {
    await atomicWrite(configPath, JSON.stringify(resolved, null, 2));
    await atomicWrite(
      path.join(directory, "emulator-owner.json"),
      JSON.stringify({ projectId: resolved.projectId, runId }, null, 2),
    );
  }
  const appPort = Number(new URL(config.baseURL).port || 80);
  for (const port of [appPort, 9098, 8088]) {
    if (!(await portFree(port))) {
      throw Object.assign(
        new Error(
          `Port ${port} is already in use. Stop that process before the load test.`,
        ),
        { code: 2 },
      );
    }
  }
  const env = allowlistedEnv(config.baseURL);
  const children = new Set();
  const logFile = path.join(directory, "processes.log");
  const emulatorArgs = [
    "emulators:start",
    "--only",
    "auth,firestore",
    "--project",
    "demo-resume-changer-loadtest",
    "--config",
    await writeEmulatorConfig(),
    "--export-on-exit",
    path.join(directory, "emulator"),
  ];
  if (resume) emulatorArgs.push("--import", path.join(directory, "emulator"));
  const emulatorEnv = {
    ...env,
    NODE_OPTIONS: `--require ${guard}`,
  };
  delete emulatorEnv.PORT;
  delete emulatorEnv.HOSTNAME;
  console.error(`Starting load run ${runId}.`);
  const emulator = startChild(firebaseBin, emulatorArgs, emulatorEnv, logFile);
  children.add(emulator);
  let server;
  const abortControllers = new Set();
  let interrupted = false;
  const onSigint = () => {
    interrupted = true;
    if (onSigint.count) {
      for (const abort of abortControllers) abort();
      for (const child of children) child.kill("SIGKILL");
      return;
    }
    onSigint.count = 1;
    setTimeout(() => {
      for (const abort of abortControllers) abort();
      for (const child of children) child.kill("SIGTERM");
    }, 30_000).unref();
  };
  process.on("SIGINT", onSigint);
  try {
    await waitForTcp(9098, 60_000);
    await waitForTcp(8088, 60_000);
    console.error(`Emulators are ready for ${runId}.`);
    await ensureBuild(env);
    console.error(`Production build is ready for ${runId}.`);
    server = startChild(
      process.execPath,
      [
        "--require",
        bootstrap,
        nextCli,
        "start",
        "-H",
        "127.0.0.1",
        "-p",
        String(appPort),
      ],
      env,
      logFile,
    );
    children.add(server);
    const safety = await waitForJson(
      `${config.baseURL}/api/load-test/safety`,
      60_000,
    );
    if (
      safety.mode !== "firebase" ||
      safety.projectId !== "demo-resume-changer-loadtest" ||
      safety.databaseId !== "(default)" ||
      safety.authEmulatorHost !== "127.0.0.1:9098" ||
      safety.firestoreEmulatorHost !== "127.0.0.1:8088"
    ) {
      throw Object.assign(
        new Error("The local safety response did not match the demo emulator."),
        {
          code: 2,
        },
      );
    }
    return await runPool({
      config,
      runId,
      directory,
      catalog,
      resume,
      interrupted: () => interrupted,
      abortControllers,
    });
  } finally {
    process.off("SIGINT", onSigint);
    for (const child of children) {
      if (child.exitCode === null && !child.killed) child.kill("SIGINT");
    }
    await Promise.race([
      Promise.all([...children].map((child) => waitForExit(child, 20_000))),
      sleep(25_000),
    ]);
    for (const child of children) {
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    await rm(path.join(root, "firebase.load-test.json"), { force: true });
  }
}

function waitForTcp(port, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ port, host: "127.0.0.1" });
      socket.once("connect", () => {
        socket.end();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) {
          reject(
            Object.assign(
              new Error(`Timed out waiting for 127.0.0.1:${port}.`),
              {
                code: 2,
              },
            ),
          );
          return;
        }
        setTimeout(attempt, 400);
      });
    };
    attempt();
  });
}

async function waitForJson(url, timeoutMs) {
  const started = Date.now();
  let last = "unavailable";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error.message;
    }
    await sleep(400);
  }
  throw Object.assign(new Error(`The app was not ready: ${last}`), { code: 2 });
}

async function runPool({
  config,
  runId,
  directory,
  catalog,
  resume,
  interrupted,
  abortControllers,
}) {
  const eventsFile = path.join(directory, "events.ndjson");
  const manifestPath = path.join(directory, "manifest.json");
  const manifest = resume ? await readJson(manifestPath) : { runId, users: [] };
  const done = new Set(
    manifest.users
      .filter((user) => user.status === "completed")
      .map((user) => user.userNumber),
  );
  const apiQueue = [];
  const browserQueue = [];
  for (let userNumber = 1; userNumber <= config.users; userNumber += 1) {
    if (done.has(userNumber)) continue;
    const queue = isBrowserUser(userNumber, config.browserPercent)
      ? browserQueue
      : apiQueue;
    queue.push(userNumber);
  }
  const limiter = createLimiter(config.apiRps, createSystemClock());
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  const requests = [];
  let logicalWrites = manifest.logicalWrites ?? 0;
  let externalRequests = 0;
  let providerRequests = 0;
  let maxActive = 0;
  let maxBrowsers = 0;
  let browsers = 0;
  let admissions = true;
  let stopReason = null;
  let eventChain = Promise.resolve();
  let manifestChain = Promise.resolve();
  const startedAt = Date.now();
  let stageStarted = startedAt;
  let stage = 0;
  const targets = rampTargets(config.concurrency);
  const cap = browserSlotCap(config.concurrency, config.browserPercent);
  let lastStart = 0;
  let failureShots = 0;
  const inflight = new Set();

  function rememberManifest() {
    const snapshot = JSON.stringify(manifest, null, 2);
    manifestChain = manifestChain.then(() =>
      atomicWrite(manifestPath, snapshot),
    );
    return manifestChain;
  }

  async function onEvent(event) {
    const safe = sanitize(event);
    const line = `${JSON.stringify(safe)}\n`;
    eventChain = eventChain.then(() => appendFile(eventsFile, line));
    await eventChain;
    if (safe.channel === "api" && Number.isFinite(safe.latencyMs)) {
      requests.push({
        at: safe.at,
        channel: "api",
        latencyMs: safe.latencyMs,
        limiterWaitMs: safe.limiterWaitMs ?? 0,
        error: Boolean(safe.error),
      });
    }
    if (safe.type === "external" || safe.channel === "external")
      externalRequests += 1;
    if (String(safe.op ?? "").startsWith("/api/ai/")) providerRequests += 1;
    const health = windowHealth(requests, Date.now());
    if (health.stop) {
      admissions = false;
      stopReason = "performance";
    }
    if (externalRequests || providerRequests) {
      admissions = false;
      stopReason = "external";
    }
  }

  function targetNow() {
    if (stage < targets.length - 1 && Date.now() - stageStarted >= 60_000) {
      stage += 1;
      stageStarted = Date.now();
    }
    return targets[stage];
  }

  async function startUser(userNumber, browser) {
    const controller = new AbortController();
    abortControllers.add(controller);
    const timer = setTimeout(() => controller.abort(), config.sessionTimeoutMs);
    const assignment = assignUser(catalog, config.seed, userNumber, runId);
    assignment.browser = browser;
    const record = {
      userNumber,
      browser,
      partial: assignment.partial,
      subject: assignment.subject,
      status: "running",
      templates: {
        jobs: assignment.jobs.map((job) => job.templateId),
        projects: assignment.projects.map((project) => project.templateId),
        skills: assignment.skills.map((skill) => skill.name),
      },
    };
    manifest.users = manifest.users.filter(
      (user) => user.userNumber !== userNumber,
    );
    manifest.users.push(record);
    try {
      const rng = mulberry32(
        (Math.imul(config.seed ^ userNumber, 0x9e3779b1) ^ userNumber) >>> 0,
      );
      const shared = {
        assignment,
        baseURL: config.baseURL,
        limiter,
        rng,
        onEvent,
        signal: controller.signal,
        resume,
        pauseAdmissions() {
          admissions = false;
          stopReason = stopReason ?? "admission-paused";
        },
      };
      const result = browser
        ? await runBrowserUser({
            ...shared,
            failureFile:
              failureShots < 5
                ? failurePath(path.join(directory, "failures"), userNumber)
                : null,
          })
        : await runApiUser({
            ...shared,
            authHost: "127.0.0.1:9098",
            timeoutMs: config.requestTimeoutMs,
          });
      record.status = "completed";
      console.error(
        `User ${userNumber} completed (${browser ? "browser" : "api"}).`,
      );
      record.uid = result.uid;
      record.recordIds = result.recordIds;
      logicalWrites += result.logicalWrites;
    } catch (error) {
      if (browser) failureShots += 1;
      record.status =
        error?.code === "interrupted" || controller.signal.aborted
          ? "interrupted"
          : "failed";
      record.error =
        error instanceof Error ? error.message : "The session failed.";
      console.error(`User ${userNumber} ${record.status}: ${record.error}`);
      if (error?.code === "integrity" || error?.code === "external") {
        admissions = false;
        stopReason = error.code;
      }
    } finally {
      clearTimeout(timer);
      abortControllers.delete(controller);
      await rememberManifest();
    }
  }

  const runTimer = setTimeout(() => {
    admissions = false;
    stopReason = stopReason ?? "timeout";
    for (const abort of abortControllers) abort();
  }, config.runTimeoutMs);

  while (
    (apiQueue.length || browserQueue.length || inflight.size) &&
    !interrupted()
  ) {
    if (stopReason === "external" || stopReason === "integrity") break;
    maxActive = Math.max(maxActive, inflight.size);
    maxBrowsers = Math.max(maxBrowsers, browsers);
    const target = targetNow();
    const choices = [];
    if (admissions && apiQueue.length && inflight.size < target) {
      choices.push({ browser: false, userNumber: apiQueue[0] });
    }
    if (
      admissions &&
      browserQueue.length &&
      browsers < cap &&
      inflight.size < target
    ) {
      choices.push({ browser: true, userNumber: browserQueue[0] });
    }
    choices.sort((left, right) => left.userNumber - right.userNumber);
    const choice = choices[0];
    if (!choice || Date.now() - lastStart < 1000 / config.startsPerSecond) {
      if (!inflight.size && !admissions) break;
      await sleep(40);
      continue;
    }
    (choice.browser ? browserQueue : apiQueue).shift();
    lastStart = Date.now();
    if (choice.browser) browsers += 1;
    const task = startUser(choice.userNumber, choice.browser).finally(() => {
      inflight.delete(task);
      if (choice.browser) browsers -= 1;
    });
    inflight.add(task);
  }
  if (interrupted()) {
    await Promise.race([Promise.allSettled(inflight), sleep(30_000)]);
    for (const abort of abortControllers) abort();
  }
  await Promise.allSettled(inflight);
  clearTimeout(runTimer);
  await eventChain;
  histogram.disable();
  const finishedAt = Date.now();
  const completed = manifest.users.filter(
    (user) => user.status === "completed",
  ).length;
  const failed = manifest.users.filter(
    (user) => user.status === "failed",
  ).length;
  const interruptedUsers = manifest.users.filter(
    (user) => user.status === "interrupted",
  ).length;
  const notStarted = config.users - manifest.users.length;
  const delayMs = histogram.percentile(99) / 1e6;
  const generatorLimited = delayMs > 100;
  const estimate = estimateRun(catalog, config);
  const correctness =
    !interrupted() &&
    stopReason !== "external" &&
    stopReason !== "integrity" &&
    failed === 0 &&
    interruptedUsers === 0 &&
    notStarted === 0 &&
    completed === config.users &&
    externalRequests === 0 &&
    providerRequests === 0;
  const recordedRequests = await loadRequestSamples(eventsFile);
  const draft = summarizeRun({
    passed: false,
    correctness: correctness ? "passed" : "failed",
    performance: "pending",
    exitReason: "pending",
    attempted: manifest.users.length,
    completed,
    failed,
    interrupted: interruptedUsers,
    notStarted,
    apiUsers:
      config.users -
      Array.from({ length: config.users }, (_, index) =>
        isBrowserUser(index + 1, config.browserPercent),
      ).filter(Boolean).length,
    browserUsers: Array.from({ length: config.users }, (_, index) =>
      isBrowserUser(index + 1, config.browserPercent),
    ).filter(Boolean).length,
    maxActive,
    maxBrowsers,
    requests: recordedRequests ?? requests,
    browserTraffic: 0,
    logicalWrites,
    estimatedUnits: `${estimate.approximateEnterpriseWriteUnits} estimated lower-bound write units`,
    providerRequests,
    externalRequests,
    generatorLimited,
    eventLoopDelayMs: delayMs,
    startedAt,
    finishedAt,
  });
  const browserTraffic = await countChannel(eventsFile, "page");
  draft.browserTraffic = browserTraffic;
  const enough = (draft.latencyMs.samples ?? 0) > 0;
  const performanceOk =
    enough &&
    draft.latencyMs.p95 < 2_000 &&
    draft.latencyMs.p99 < 5_000 &&
    draft.applicationErrorRate < 0.01;
  draft.performance = performanceOk ? "passed" : "failed";
  let exitCode = 0;
  if (interrupted() || stopReason === "timeout") {
    draft.exitReason = interrupted() ? "interrupted" : "timed out";
    draft.label = "failed";
    exitCode = 3;
  } else if (!correctness || !performanceOk) {
    draft.exitReason =
      generatorLimited && correctness && !performanceOk
        ? "generator-limited"
        : stopReason === "external"
          ? "external-request"
          : stopReason === "integrity"
            ? "integrity"
            : "failed";
    draft.label = "failed";
    exitCode = 1;
  } else {
    draft.exitReason = "passed";
    draft.label = "passed";
    draft.correctness = "passed";
    draft.performance = "passed";
  }
  draft.passed = exitCode === 0;
  const limitations = [
    "Figures are from the local emulators. They are not measured Vercel or live Firebase usage.",
    estimate.label,
    estimate.retryAllowanceNotIncluded,
    "Playwright routes browser API calls through the shared limiter, which can change browser cache behavior.",
    "Server-side emulator traffic is not capped by the application request limiter.",
    ...estimate.unknowns.map((item) => `Unknown: ${item}`),
  ];
  if (generatorLimited) {
    limitations.unshift(
      "The generator event loop was delayed. A slow result here does not by itself show an application capacity failure.",
    );
  }
  await atomicWrite(
    path.join(directory, "summary.json"),
    JSON.stringify({ ...draft, estimate }, null, 2),
  );
  await atomicWrite(
    path.join(directory, "report.md"),
    renderReport(draft, limitations),
  );
  manifest.logicalWrites = logicalWrites;
  manifest.status = draft.exitReason;
  await rememberManifest();
  await manifestChain;
  console.error(
    `${runId} ${draft.exitReason}. Report: ${path.join(directory, "report.md")}`,
  );
  return { code: exitCode, directory, summary: draft };
}

async function loadRequestSamples(file) {
  try {
    const text = await readFile(file, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter(
        (event) => event.channel === "api" && Number.isFinite(event.latencyMs),
      )
      .map((event) => ({
        at: event.at,
        channel: "api",
        latencyMs: event.latencyMs,
        limiterWaitMs: event.limiterWaitMs ?? 0,
        error: Boolean(event.error),
      }));
  } catch {
    return null;
  }
}

async function countChannel(file, channel) {
  try {
    const text = await readFile(file, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((event) => event.channel === channel).length;
  } catch {
    return 0;
  }
}

function makeRunId(prefix) {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `${prefix}-${stamp}`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "estimate") {
    const config = resolveRunConfig(options, { command: "estimate" });
    const { catalog } = await loadCatalog(catalogPath);
    console.log(JSON.stringify(estimateRun(catalog, config), null, 2));
    return;
  }
  if (options.command === "cleanup") {
    const { removeRunDirectory } = await import("./artifacts.mjs");
    if (!options["run-id"]) exitWith(2, "Cleanup requires --run-id.");
    await removeRunDirectory(root, options["run-id"]);
    console.log(`Removed local artifacts for ${options["run-id"]}.`);
    return;
  }
  await ensureTools();
  const { installOutboundGuard } = require("./outbound-guard.cjs");
  installOutboundGuard();
  if (options.command === "smoke") {
    const api = await executeRun(
      resolveRunConfig(
        {
          command: "run",
          users: "1",
          concurrency: "1",
          "browser-percent": "0",
          seed: "42",
        },
        {},
      ),
      makeRunId("smoke-api"),
    );
    if (api.code !== 0) process.exit(api.code);
    const mixed = await executeRun(
      resolveRunConfig(
        {
          command: "run",
          users: "10",
          concurrency: "2",
          "browser-percent": "10",
          seed: "42",
        },
        {},
      ),
      makeRunId("smoke-mix"),
    );
    process.exit(mixed.code);
  }
  const config = resolveRunConfig(options);
  if (options.resume) {
    const result = await executeRun(config, options.resume, { resume: true });
    process.exit(result.code);
  }
  const prefix = config.concurrency === 120 ? "load120" : "load";
  const result = await executeRun(config, makeRunId(prefix));
  console.log(result.summary.exitReason);
  console.log(result.directory);
  process.exit(result.code);
}

main().catch((error) => {
  const code = error?.code === 2 ? 2 : 1;
  exitWith(
    code,
    error instanceof Error ? error.message : "The load test failed.",
  );
});
