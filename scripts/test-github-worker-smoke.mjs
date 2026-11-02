import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const projectRoot = process.cwd();
const buildScript = join(projectRoot, "scripts", "build-github-worker.mjs");
const build = spawnSync(process.execPath, [buildScript], {
  cwd: projectRoot,
  stdio: "inherit",
  windowsHide: true,
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const hostEntry = join(
  projectRoot,
  ".runtime",
  "github-worker",
  "workers",
  "github-import-host.js",
);
const moduleSmoke = spawnSync(
  process.execPath,
  [
    "-e",
    [
      "lib/github/server/backend-runtime.js",
      "lib/github/server/access-port.js",
      "lib/ai/provider-factory-core.js",
      "workers/github-import-worker.js",
    ]
      .map(
        (file) =>
          "require(" +
          JSON.stringify(join(projectRoot, ".runtime", "github-worker", file)) +
          ");",
      )
      .join("\n"),
  ],
  { cwd: projectRoot, stdio: "inherit", windowsHide: true },
);
if (moduleSmoke.error) throw moduleSmoke.error;
if (moduleSmoke.status !== 0)
  throw new Error(
    "The compiled backend/provider entries do not load in ordinary Node.",
  );

const tempRoot = await mkdtemp(join(tmpdir(), "github-worker-smoke-"));
const statusPath = join(tempRoot, "status.json");
const missingRuntime = join(tempRoot, "not-installed-worker-runtime.js");
const worker = spawn(process.execPath, [hostEntry], {
  cwd: projectRoot,
  env: {
    ...process.env,
    GITHUB_IMPORT_WORKER_STATUS_PATH: statusPath,
    GITHUB_IMPORT_WORKER_RUNTIME_MODULE: missingRuntime,
  },
  stdio: ["ignore", "pipe", "inherit", "ipc"],
  windowsHide: true,
});

let output = "";
let startupTimer;
const ready = new Promise((resolve, reject) => {
  startupTimer = setTimeout(
    () =>
      reject(new Error("Worker host did not report unavailable readiness.")),
    15_000,
  );
  worker.stdout.setEncoding("utf8");
  worker.stdout.on("data", (chunk) => {
    output += chunk;
    if (output.includes("GITHUB_IMPORT_WORKER_STATUS=unavailable")) resolve();
  });
  worker.once("error", reject);
  worker.once("exit", (code, signal) => {
    if (code !== 0 && signal !== "SIGTERM") {
      reject(
        new Error(`Worker host exited before readiness (${code ?? signal}).`),
      );
    }
  });
});

try {
  await ready;
  clearTimeout(startupTimer);
  const status = JSON.parse(await readFile(statusPath, "utf8"));
  if (status.state !== "unavailable" || status.available !== false) {
    throw new Error("Missing runtime was not reported as unavailable.");
  }
  const firstHeartbeat = status.updatedAt;
  const heartbeatDeadline = Date.now() + 6_000;
  let refreshedStatus;
  while (Date.now() < heartbeatDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    refreshedStatus = JSON.parse(await readFile(statusPath, "utf8"));
    if (
      refreshedStatus.state === "unavailable" &&
      refreshedStatus.updatedAt !== firstHeartbeat
    ) {
      break;
    }
  }
  if (
    refreshedStatus?.state !== "unavailable" ||
    refreshedStatus.updatedAt === firstHeartbeat
  ) {
    throw new Error(
      "Unavailable worker status was not kept fresh by heartbeat.",
    );
  }
  worker.send({ type: "shutdown" });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.kill("SIGKILL");
      reject(new Error("Worker host did not shut down cleanly."));
    }, 8_000);
    worker.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0 || signal === "SIGTERM") resolve();
      else
        reject(new Error(`Worker host shutdown failed (${code ?? signal}).`));
    });
  });
  const finalStatus = JSON.parse(await readFile(statusPath, "utf8"));
  if (finalStatus.state !== "stopping") {
    throw new Error("Worker host did not publish its clean shutdown state.");
  }
  process.stdout.write(
    "GitHub worker build/start/unavailable/shutdown smoke passed.\n",
  );
} finally {
  clearTimeout(startupTimer);
  if (worker.exitCode === null) worker.kill("SIGKILL");
  await rm(tempRoot, { recursive: true, force: true });
}
