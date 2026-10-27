import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();
const [mode, ...nextArguments] = process.argv.slice(2);
if (mode !== "dev" && mode !== "start") {
  throw new Error(
    "Usage: node scripts/run-local.mjs <dev|start> [Next.js arguments]",
  );
}

const hostSource = join(projectRoot, "src", "workers", "github-import-host.ts");
const hostBuild = join(
  projectRoot,
  ".runtime",
  "github-worker",
  "workers",
  "github-import-host.js",
);
const tsxCli = join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
const nextCli = join(
  projectRoot,
  "node_modules",
  "next",
  "dist",
  "bin",
  "next",
);
const workerEntry = mode === "dev" ? hostSource : hostBuild;
if (mode === "dev" && !existsSync(tsxCli)) {
  throw new Error(
    "The existing tsx development dependency is required for the local worker.",
  );
}
if (mode === "start" && !existsSync(workerEntry)) {
  throw new Error(
    "The worker is not built. Run npm run build before npm start.",
  );
}

const workerArguments = mode === "dev" ? [tsxCli, workerEntry] : [workerEntry];
const worker = spawn(process.execPath, workerArguments, {
  cwd: projectRoot,
  env: {
    ...process.env,
    NODE_ENV: mode === "start" ? "production" : process.env.NODE_ENV,
    GITHUB_IMPORT_WORKER_RUNTIME_MODULE:
      process.env.GITHUB_IMPORT_WORKER_RUNTIME_MODULE ??
      (mode === "dev"
        ? join(projectRoot, "src", "workers", "github-import-worker.ts")
        : join(
            projectRoot,
            ".runtime",
            "github-worker",
            "workers",
            "github-import-worker.js",
          )),
  },
  stdio: ["inherit", "pipe", "inherit", "ipc"],
  windowsHide: true,
});

let stopping = false;
let exitCode = 0;
let startupSettled = false;
let outputBuffer = "";
let app;
let resolveStartup;
let rejectStartup;
let resolveFinished;
const startupStatus = new Promise((resolve, reject) => {
  resolveStartup = resolve;
  rejectStartup = reject;
});
const finished = new Promise((resolve) => {
  resolveFinished = resolve;
});
const children = new Set([worker]);

function sendSignal(child, label, signal) {
  if (!child || child.exitCode !== null) return;
  try {
    if (label === "worker" && child.connected) {
      child.send({ type: "shutdown" });
    } else if (process.platform !== "win32" && label === "app" && child.pid) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    // The child may have exited between the state check and signal delivery.
  }
  const forceTimer = setTimeout(() => {
    if (child.exitCode === null) {
      try {
        if (process.platform === "win32") {
          spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
            windowsHide: true,
            stdio: "ignore",
            timeout: 5_000,
          });
        } else if (label === "app" && child.pid) {
          process.kill(-child.pid, "SIGKILL");
        } else {
          child.kill("SIGKILL");
        }
      } catch {
        // Process shutdown is best-effort after the graceful interval.
      }
    }
  }, 5_000);
  forceTimer.unref();
}

function beginShutdown(code, signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  for (const child of children) {
    sendSignal(child, child === worker ? "worker" : "app", signal);
  }
  if (!startupSettled) {
    startupSettled = true;
    rejectStartup(
      new Error("Local app startup stopped before the worker became ready."),
    );
  }
  if (children.size === 0) resolveFinished();
}

function attachChild(child, label) {
  child.on("error", () => {
    if (!startupSettled && label === "worker") {
      startupSettled = true;
      rejectStartup(
        new Error("The GitHub import worker could not be started."),
      );
    }
    beginShutdown(1);
  });
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (label === "worker" && !startupSettled) {
      startupSettled = true;
      rejectStartup(
        new Error(
          "The GitHub import worker exited before reporting readiness.",
        ),
      );
    }
    if (!stopping) beginShutdown(code ?? (signal ? 1 : 0));
    if (stopping && children.size === 0) resolveFinished();
  });
}

attachChild(worker, "worker");
worker.stdout.setEncoding("utf8");
worker.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  outputBuffer += chunk;
  const lines = outputBuffer.split(/\r?\n/);
  outputBuffer = lines.pop() ?? "";
  for (const line of lines) {
    const match = line.match(
      /^GITHUB_IMPORT_WORKER_STATUS=(ready|unavailable)$/,
    );
    if (match && !startupSettled) {
      startupSettled = true;
      resolveStartup(match[1]);
    }
  }
});

const startupTimer = setTimeout(() => {
  if (!startupSettled) {
    startupSettled = true;
    rejectStartup(
      new Error(
        "The GitHub import worker did not report readiness within 30 seconds.",
      ),
    );
    beginShutdown(1);
  }
}, 30_000);
startupTimer.unref();

process.once("SIGINT", () => beginShutdown(0, "SIGINT"));
process.once("SIGTERM", () => beginShutdown(0, "SIGTERM"));

try {
  await startupStatus;
  clearTimeout(startupTimer);
  if (!stopping) {
    app = spawn(process.execPath, [nextCli, mode, ...nextArguments], {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    children.add(app);
    attachChild(app, "app");
  }
} catch {
  clearTimeout(startupTimer);
  beginShutdown(1);
}

await finished;
process.exitCode = exitCode;
