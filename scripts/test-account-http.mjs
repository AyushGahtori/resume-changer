import { spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

if (
  process.env.VERCEL ||
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error("Account HTTP tests require local demo emulators.");
const root = process.cwd();
await mkdir(".runtime", { recursive: true });
const log = createWriteStream(".runtime/account-http.log");
const environment = {
  ...process.env,
  RESUME_APP_MODE: "firebase",
  NEXT_DIST_DIR: ".next-cloud-test",
  NEXT_TELEMETRY_DISABLED: "1",
  AI_PROVIDER: "mock",
  GEMINI_API_KEY: "fictional-unused-key",
  NEXT_PUBLIC_FIREBASE_API_KEY: "demo-key",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-resume-changer-security",
  NEXT_PUBLIC_FIREBASE_DATABASE_ID: "(default)",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:
    "demo-resume-changer-security.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_APP_ID: "demo-app",
  NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST:
    process.env.FIREBASE_AUTH_EMULATOR_HOST,
};
const server = spawn(
  process.execPath,
  [
    path.join(root, "node_modules/next/dist/bin/next"),
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3017",
  ],
  { cwd: root, env: environment, windowsHide: true },
);
server.stdout.pipe(log);
server.stderr.pipe(log);
let result = 1;
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null)
      throw new Error(
        "The account test server exited. Inspect .runtime/account-http.log.",
      );
    try {
      ready = (
        await fetch("http://127.0.0.1:3017/sign-in", {
          signal: AbortSignal.timeout(2_000),
        })
      ).ok;
    } catch {
      /* Wait for the actual route to compile. */
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("The account test server did not start.");
  const tests = spawn(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "--config",
      "vitest.account.config.ts",
    ],
    { cwd: root, env: environment, stdio: "inherit", windowsHide: true },
  );
  result = await new Promise((resolve) =>
    tests.on("exit", (code) => resolve(code ?? 1)),
  );
} finally {
  if (process.platform === "win32")
    spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
  else server.kill("SIGTERM");
  log.end();
}
process.exitCode = result;
