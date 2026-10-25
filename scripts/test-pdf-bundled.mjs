import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--config",
    "vitest.runtime.config.ts",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      RESUME_PDF_RUNTIME: "bundled",
      PDF_PAGE_COUNTER: "pdfjs",
    },
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
