import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImportJobRunnerPort } from "../lib/github/ports";

export type GithubImportWorkerState =
  "starting" | "ready" | "unavailable" | "stopping" | "unknown";

export type GithubImportWorkerStatus = {
  state: GithubImportWorkerState;
  available: boolean;
  updatedAt: string | null;
  reason: "runtime-unavailable" | "runtime-failed" | "stopping" | null;
};

type WorkerRuntime = {
  runner: ImportJobRunnerPort;
  shutdown?(): Promise<void>;
};

type WorkerRuntimeModule = {
  createGithubImportWorkerRuntime?: () =>
    Promise<WorkerRuntime> | WorkerRuntime;
};

type PersistedStatus = Omit<GithubImportWorkerStatus, "state"> & {
  state: Exclude<GithubImportWorkerState, "unknown">;
  pid: number;
};

const STATUS_FRESHNESS_MS = 15_000;
const HEARTBEAT_MS = 4_000;
const IDLE_POLL_MS = 250;
const RUNTIME_RETRY_MS = 2_000;

export function githubImportWorkerStatusPath(cwd = process.cwd()): string {
  return (
    process.env.GITHUB_IMPORT_WORKER_STATUS_PATH ??
    path.join(cwd, ".runtime", "github-worker", "status.json")
  );
}

/** Read-only readiness check for the Next composition and import service. */
export function readGithubImportWorkerStatus(options?: {
  cwd?: string;
  now?: number;
  maxAgeMs?: number;
}): GithubImportWorkerStatus {
  const filePath = githubImportWorkerStatusPath(options?.cwd);
  try {
    const parsed = JSON.parse(
      readFileSync(filePath, "utf8"),
    ) as Partial<PersistedStatus>;
    const updatedAt =
      typeof parsed.updatedAt === "string" ? parsed.updatedAt : null;
    const timestamp = updatedAt ? Date.parse(updatedAt) : Number.NaN;
    const state = parsed.state;
    const now = options?.now ?? Date.now();
    const pid = parsed.pid;
    let processAlive = false;
    if (Number.isInteger(pid) && (pid as number) > 0) {
      try {
        process.kill(pid as number, 0);
        processAlive = true;
      } catch (error) {
        processAlive =
          error && typeof error === "object" && "code" in error
            ? error.code === "EPERM"
            : false;
      }
    }
    const fresh =
      Number.isFinite(timestamp) &&
      now >= timestamp &&
      now - timestamp <= (options?.maxAgeMs ?? STATUS_FRESHNESS_MS);
    if (
      (state === "ready" ||
        state === "unavailable" ||
        state === "starting" ||
        state === "stopping") &&
      fresh &&
      processAlive
    ) {
      return {
        state,
        available: state === "ready",
        updatedAt,
        reason:
          parsed.reason === "runtime-unavailable" ||
          parsed.reason === "runtime-failed" ||
          parsed.reason === "stopping"
            ? parsed.reason
            : null,
      };
    }
  } catch {
    // A missing, malformed or stale status file is an unavailable worker.
  }
  return { state: "unknown", available: false, updatedAt: null, reason: null };
}

function runtimeModulePath(): string {
  if (process.env.GITHUB_IMPORT_WORKER_RUNTIME_MODULE) {
    return path.resolve(process.env.GITHUB_IMPORT_WORKER_RUNTIME_MODULE);
  }
  const extension = __filename.endsWith(".ts") ? ".ts" : ".js";
  return path.join(__dirname, `github-import-worker${extension}`);
}

async function writeStatus(
  state: PersistedStatus["state"],
  reason: PersistedStatus["reason"],
): Promise<void> {
  const filePath = githubImportWorkerStatusPath();
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  const status: PersistedStatus = {
    state,
    available: state === "ready",
    updatedAt: new Date().toISOString(),
    pid: process.pid,
    reason,
  };
  await writeFile(temporaryPath, JSON.stringify(status), "utf8");
  await rename(temporaryPath, filePath);
}

function announce(state: "ready" | "unavailable"): void {
  process.stdout.write(`GITHUB_IMPORT_WORKER_STATUS=${state}\n`);
}

function waitFor(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, delayMs);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export async function runGithubImportWorkerHost(): Promise<void> {
  const abortController = new AbortController();
  const requireFromHost = createRequire(__filename);
  let runtime: WorkerRuntime | undefined;
  let announced: "ready" | "unavailable" | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let stopping = false;
  let lastPublishedState: PersistedStatus["state"] = "starting";
  let lastPublishedReason: PersistedStatus["reason"] = null;
  let statusWrites = Promise.resolve();

  const publish = async (
    state: "starting" | "ready" | "unavailable" | "stopping",
    reason: PersistedStatus["reason"] = null,
  ) => {
    lastPublishedState = state;
    lastPublishedReason = reason;
    const write = statusWrites.then(() => writeStatus(state, reason));
    statusWrites = write.catch(() => undefined);
    await write;
    if (state === "ready" || state === "unavailable") {
      if (announced !== state) announce(state);
      announced = state;
    }
  };

  const stop = () => {
    if (stopping) return;
    stopping = true;
    abortController.abort();
    if (heartbeat) clearInterval(heartbeat);
    if (runtime) void runtime.runner.shutdown().catch(() => undefined);
  };
  const receiveMessage = (message: unknown) => {
    if (
      message &&
      typeof message === "object" &&
      "type" in message &&
      message.type === "shutdown"
    ) {
      stop();
    }
  };
  process.on("message", receiveMessage);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  await publish("starting");
  heartbeat = setInterval(() => {
    void publish(lastPublishedState, lastPublishedReason).catch(
      () => undefined,
    );
  }, HEARTBEAT_MS);
  try {
    const requireRuntime = () =>
      requireFromHost(runtimeModulePath()) as WorkerRuntimeModule;

    while (!stopping) {
      if (!runtime) {
        try {
          const runtimeExports = requireRuntime();
          if (
            typeof runtimeExports.createGithubImportWorkerRuntime !== "function"
          ) {
            await publish("unavailable", "runtime-unavailable");
            await waitFor(RUNTIME_RETRY_MS, abortController.signal);
            continue;
          }
          const candidate =
            await runtimeExports.createGithubImportWorkerRuntime();
          const recovered = await candidate.runner.recover();
          if (!recovered.ok) {
            await candidate.runner.shutdown();
            await candidate.shutdown?.();
            await publish("unavailable", "runtime-failed");
            await waitFor(RUNTIME_RETRY_MS, abortController.signal);
            continue;
          }
          runtime = candidate;
          await publish("ready");
        } catch (error) {
          const missingModule =
            error &&
            typeof error === "object" &&
            "code" in error &&
            (error.code === "MODULE_NOT_FOUND" ||
              error.code === "ERR_MODULE_NOT_FOUND");
          await publish(
            "unavailable",
            missingModule ? "runtime-unavailable" : "runtime-failed",
          );
          await waitFor(RUNTIME_RETRY_MS, abortController.signal);
          continue;
        }
      }

      if (stopping || abortController.signal.aborted) break;
      const result = await runtime.runner.runOnce();
      if (!result.ok) {
        await publish("unavailable", "runtime-failed");
        await waitFor(RUNTIME_RETRY_MS, abortController.signal);
        continue;
      }
      if (announced !== "ready") await publish("ready");
      if (result.value === null)
        await waitFor(IDLE_POLL_MS, abortController.signal);
    }
  } catch {
    await publish("unavailable", "runtime-failed").catch(() => undefined);
    process.exitCode = 1;
    throw new Error("GitHub import worker stopped after an internal failure.");
  } finally {
    stop();
    if (heartbeat) clearInterval(heartbeat);
    if (runtime) {
      await runtime.runner.shutdown().catch(() => undefined);
      if (runtime.shutdown) await runtime.shutdown().catch(() => undefined);
    }
    await publish("stopping", "stopping").catch(() => undefined);
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    process.removeListener("message", receiveMessage);
  }
}

if (require.main === module) {
  void runGithubImportWorkerHost().catch(() => {
    process.stderr.write("GitHub import worker exited unexpectedly.\n");
    process.exitCode = 1;
  });
}
