import { spawn, spawnSync } from "node:child_process";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";

const projectRoot = process.cwd();
const fixtureRoot =
  process.env.RESUME_LIBRARY_ROOT ??
  join(tmpdir(), "resume-changer-playwright-data");
if (
  dirname(resolve(fixtureRoot)).toLowerCase() !==
    resolve(tmpdir()).toLowerCase() ||
  !/^resume-changer-playwright-data(?:-\d+)?$/.test(basename(fixtureRoot))
) {
  throw new Error(
    "E2E fixtures must use a dedicated resume-changer-playwright-data directory directly inside the temporary directory.",
  );
}
await rm(fixtureRoot, { recursive: true, force: true });
await mkdir(join(fixtureRoot, "data"), { recursive: true });
await copyFile(
  join(projectRoot, "examples", "sample-resume-library.json"),
  join(fixtureRoot, "data", "resume-library.json"),
);

const nextCli = join(
  projectRoot,
  "node_modules",
  "next",
  "dist",
  "bin",
  "next",
);
const port = process.env.PLAYWRIGHT_PORT ?? "3010";
const distDir = process.env.NEXT_DIST_DIR ?? ".next-test";
const tsconfig = process.env.NEXT_TSCONFIG ?? "tsconfig.e2e.json";

/**
 * The browser suite runs against a production build.
 *
 * The development server recompiles each route on demand, so a page that is
 * requested for the first time in a run can take several seconds to answer.
 * Several assertions here have short timeouts, and a cold compile regularly
 * pushed them over the limit, which made the suite fail for reasons that had
 * nothing to do with the behaviour under test. A production build answers the
 * same requests in milliseconds and keeps the timings meaningful.
 */
const build = spawnSync(process.execPath, [nextCli, "build"], {
  cwd: projectRoot,
  env: {
    ...process.env,
    RESUME_APP_MODE: "local",
    NEXT_DIST_DIR: distDir,
    NEXT_TSCONFIG: tsconfig,
    NEXT_TELEMETRY_DISABLED: "1",
  },
  stdio: "inherit",
  shell: false,
  windowsHide: true,
});
if (build.status !== 0) {
  await rm(fixtureRoot, { recursive: true, force: true });
  process.exit(build.status ?? 1);
}

const server = spawn(process.execPath, [nextCli, "start", "--port", port], {
  cwd: projectRoot,
  env: {
    ...process.env,
    RESUME_APP_MODE: "local",
    RESUME_LIBRARY_ROOT: fixtureRoot,
    NEXT_DIST_DIR: distDir,
    NEXT_TSCONFIG: tsconfig,
    NEXT_TELEMETRY_DISABLED: "1",
    /**
     * The browser suite must never reach a real model. Every AI route in
     * the tests is answered by a network mock, and the mock provider
     * covers anything that is not. A placeholder key is set as well, so a
     * code path that ignored AI_PROVIDER would fail authentication
     * instead of spending API credits.
     */
    AI_PROVIDER: "mock",
    GEMINI_API_KEY: "e2e-placeholder-key-not-a-real-credential",
    GEMINI_MODEL: "",
  },
  stdio: "inherit",
  detached: process.platform !== "win32",
  windowsHide: true,
});

let shuttingDown = false;
function stop(signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  if (server.exitCode === null) {
    if (process.platform === "win32")
      spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], {
        windowsHide: true,
        timeout: 5000,
        stdio: "ignore",
      });
    else {
      try {
        process.kill(-server.pid, signal);
      } catch {
        server.kill(signal);
      }
    }
  }
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

server.on("exit", async (code, signal) => {
  await rm(fixtureRoot, { recursive: true, force: true });
  process.exit(shuttingDown ? 0 : (code ?? (signal ? 1 : 0)));
});

server.on("error", async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
  process.exit(1);
});
