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
const server = spawn(process.execPath, [nextCli, "dev", "--port", port], {
  cwd: projectRoot,
  env: {
    ...process.env,
    RESUME_LIBRARY_ROOT: fixtureRoot,
    NEXT_DIST_DIR: ".next-test",
    NEXT_TSCONFIG: "tsconfig.e2e.json",
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
  process.exit(shuttingDown ? 0 : code ?? (signal ? 1 : 0));
});

server.on("error", async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
  process.exit(1);
});
