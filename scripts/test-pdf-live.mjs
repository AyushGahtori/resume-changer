import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function checkExecutable(executable, name, args) {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    console.error(
      `${name} was not found or could not run. Install it or set its *_BINARY environment variable.`,
    );
    process.exit(1);
  }
}

checkExecutable(process.env.TECTONIC_BINARY ?? "tectonic", "Tectonic", [
  "--version",
]);
checkExecutable(process.env.PDFINFO_BINARY ?? "pdfinfo", "pdfinfo", ["-v"]);

process.env.PDF_TOOLCHAIN_REQUIRED = "1";
process.env.PDF_TOOLCHAIN_WARM_CACHE = "1";
const vitestPath = fileURLToPath(
  new URL("../node_modules/vitest/vitest.mjs", import.meta.url),
);
const result = spawnSync(
  process.execPath,
  [vitestPath, "run", "tests/unit/pdf/compile-integration.test.ts"],
  { stdio: "inherit", env: process.env },
);

if (result.error) {
  console.error("Could not start the real PDF integration tests.");
  process.exit(1);
}
process.exit(result.status ?? 1);
