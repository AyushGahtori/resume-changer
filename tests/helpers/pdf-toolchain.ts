import { spawnSync } from "node:child_process";

/**
 * Detection for the real local PDF toolchain.
 *
 * The studio integration tests need Tectonic *and* pdfinfo: the renderer
 * measures the compiled page geometry through pdfinfo, so a machine that only
 * has Tectonic installed cannot run those tests. Probing for one binary and
 * ignoring the other makes the suite fail deep inside a test instead of
 * skipping cleanly, so both are resolved together here.
 */

export type PdfToolchain = {
  tectonic: string;
  pdfInfo: string;
  available: boolean;
  missing: string[];
};

function resolveBinary(environmentVariable: string, fallback: string): string {
  const configured = process.env[environmentVariable]?.trim();
  return configured ? configured : fallback;
}

function isExecutableAvailable(executable: string, args: string[]): boolean {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  });
  return !result.error && result.status === 0;
}

export function detectPdfToolchain(): PdfToolchain {
  const tectonic = resolveBinary("TECTONIC_BINARY", "tectonic");
  const pdfInfo = resolveBinary("PDFINFO_BINARY", "pdfinfo");
  const missing: string[] = [];

  if (!isExecutableAvailable(tectonic, ["--version"])) missing.push("Tectonic");
  if (!isExecutableAvailable(pdfInfo, ["-v"])) missing.push("pdfinfo");

  return {
    tectonic,
    pdfInfo,
    available: missing.length === 0,
    missing,
  };
}

export function describeMissingToolchain(toolchain: PdfToolchain): string {
  if (!toolchain.missing.length) return "The real PDF toolchain is available.";
  return `Skipping real PDF toolchain tests: install ${toolchain.missing.join(
    " and ",
  )}, or set TECTONIC_BINARY and PDFINFO_BINARY.`;
}

/**
 * When the toolchain is mandatory, a missing binary must fail loudly instead
 * of silently skipping the test.
 */
export function requirePdfToolchain(toolchain: PdfToolchain): void {
  if (toolchain.available) return;
  throw new Error(
    `The required real PDF integration tests need ${toolchain.missing.join(
      " and ",
    )}. Install both or set TECTONIC_BINARY and PDFINFO_BINARY.`,
  );
}
