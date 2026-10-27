import { spawnSync } from "node:child_process";
import { join } from "node:path";

const projectRoot = process.cwd();
const tsc = join(projectRoot, "node_modules", "typescript", "bin", "tsc");
const build = spawnSync(
  process.execPath,
  [tsc, "--project", "tsconfig.worker.json"],
  {
    cwd: projectRoot,
    stdio: "inherit",
    windowsHide: true,
  },
);

if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);
