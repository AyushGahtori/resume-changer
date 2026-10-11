import { spawn } from "node:child_process";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const projectRoot = process.cwd();
const fixtureRoot =
  process.env.RESUME_LIBRARY_ROOT ??
  join(tmpdir(), "resume-changer-playwright-data");
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
const server = spawn(process.execPath, [nextCli, "dev", "--port", "3010"], {
  cwd: projectRoot,
  env: { ...process.env, RESUME_LIBRARY_ROOT: fixtureRoot },
  stdio: "inherit",
});

let shuttingDown = false;
function stop(signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  if (server.exitCode === null) server.kill(signal);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

server.on("exit", async (code, signal) => {
  await rm(fixtureRoot, { recursive: true, force: true });
  process.exit(code ?? (signal ? 1 : 0));
});

server.on("error", async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
  process.exit(1);
});
