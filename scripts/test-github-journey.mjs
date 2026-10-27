import { spawn } from "node:child_process";
import { join } from "node:path";

if (process.env.VERCEL === "1")
  throw new Error(
    "Run the fictional GitHub journey in local CI, never inside a deployment.",
  );
const child = spawn(
  process.execPath,
  [
    join(process.cwd(), "node_modules/@playwright/test/cli.js"),
    "test",
    "tests/e2e/github-integrated-backend.spec.ts",
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GITHUB_IMPORT_E2E_BACKEND: "1",
      PLAYWRIGHT_PORT: process.env.PLAYWRIGHT_PORT ?? "3012",
    },
    stdio: "inherit",
    windowsHide: true,
  },
);
child.once("error", () => {
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
