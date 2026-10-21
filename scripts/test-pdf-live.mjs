import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function checkExecutable(executable, name, args) {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    timeout: 20_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    const detail = result.error
      ? `${result.error.code ?? "spawn error"}: ${result.error.message}`
      : (result.stderr || result.stdout || `exit code ${result.status}`).trim();
    console.error(`${name} could not run: ${detail}`);
    process.exit(1);
  }
}

const tectonic = process.env.TECTONIC_BINARY ?? "tectonic";
checkExecutable(tectonic, "Tectonic", ["--version"]);
checkExecutable(process.env.PDFINFO_BINARY ?? "pdfinfo", "pdfinfo", ["-v"]);

/**
 * Fills the Tectonic package cache with the resume template's own packages.
 *
 * The compiler runs with `--only-cached`, so it can only use resource files
 * that are already cached locally. On a machine with an empty cache that
 * fails before any document is typeset: Tectonic cannot open the format
 * file it needs, and reports "failed to open input file
 * tectonic-format-latex.tex". Compiling a real resume once without
 * `--only-cached` downloads the format, the packages the template imports,
 * and the font metrics its commands use. After that the cached compiler
 * behaves as the app expects.
 *
 * The resume is rendered by the app's own renderer, so the warm-up covers
 * every command in the template. A document that leaves one font metric
 * uncached fails later with an error such as "Font T1/lmr/bx/n/9=ec-lmbx9 at
 * 9.0pt not loadable".
 */
function warmTectonicPackageCache() {
  const directory = mkdtempSync(path.join(tmpdir(), "resume-tectonic-warmup-"));
  const texPath = path.join(directory, "warm.tex");
  try {
    const render = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../node_modules/vite-node/vite-node.mjs", import.meta.url),
        ),
        fileURLToPath(new URL("./warm-tectonic-cache.mjs", import.meta.url)),
        texPath,
      ],
      {
        encoding: "utf8",
        timeout: 120_000,
        windowsHide: true,
      },
    );
    if (render.error || render.status !== 0) {
      const detail = render.error
        ? `${render.error.code ?? "spawn error"}: ${render.error.message}`
        : (
            render.stderr ||
            render.stdout ||
            `exit code ${render.status}`
          ).trim();
      console.error(`Could not render the warm-up resume: ${detail}`);
      process.exit(1);
    }
    const result = spawnSync(
      tectonic,
      ["--untrusted", "--keep-logs", "--outdir", directory, texPath],
      {
        encoding: "utf8",
        // An empty cache downloads the whole LaTeX bundle, which takes
        // several minutes on a slow connection.
        timeout: 900_000,
        windowsHide: true,
        env: { ...process.env, TECTONIC_UNTRUSTED_MODE: "1" },
      },
    );
    if (result.error || result.status !== 0) {
      const detail = result.error
        ? `${result.error.code ?? "spawn error"}: ${result.error.message}`
        : (
            result.stderr ||
            result.stdout ||
            `exit code ${result.status}`
          ).trim();
      console.error(`Tectonic could not prepare the package cache: ${detail}`);
      process.exit(1);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

warmTectonicPackageCache();

process.env.PDF_TOOLCHAIN_REQUIRED = "1";
process.env.PDF_TOOLCHAIN_WARM_CACHE = "1";
const vitestPath = fileURLToPath(
  new URL("../node_modules/vitest/vitest.mjs", import.meta.url),
);
const result = spawnSync(
  process.execPath,
  [
    vitestPath,
    "run",
    "tests/unit/pdf/compile-integration.test.ts",
    "tests/unit/pdf/studio-integration.test.ts",
  ],
  { stdio: "inherit", env: process.env },
);

if (result.error) {
  console.error("Could not start the real PDF integration tests.");
  process.exit(1);
}
process.exit(result.status ?? 1);
