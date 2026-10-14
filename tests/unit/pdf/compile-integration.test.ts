import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sampleLibrary from "../../../examples/sample-resume-library.json";
import { renderResumeLatex } from "../../../src/lib/latex/render-resume";
import type { ResumeLibrary } from "../../../src/lib/schemas/resume-data";
import { describe, expect, it } from "vitest";
import { compileLatexToPdf } from "../../../src/lib/pdf/compile-service";

const library = sampleLibrary as ResumeLibrary;
const firstAchievementId = library.jobs[0]?.points[0]?.id;

function isExecutableAvailable(executable: string, args: string[]): boolean {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  });
  return !result.error && result.status === 0;
}

const tectonic = process.env.TECTONIC_BINARY ?? "tectonic";
const pdfInfo = process.env.PDFINFO_BINARY ?? "pdfinfo";
const hasLocalToolchain =
  isExecutableAvailable(tectonic, ["--version"]) &&
  isExecutableAvailable(pdfInfo, ["-v"]);
const toolchainRequired = process.env.PDF_TOOLCHAIN_REQUIRED === "1";

if (toolchainRequired && !hasLocalToolchain) {
  throw new Error(
    "The required real PDF integration test needs Tectonic and pdfinfo. Install both or set TECTONIC_BINARY and PDFINFO_BINARY.",
  );
}

async function warmTectonicCache(latex: string) {
  if (process.env.PDF_TOOLCHAIN_WARM_CACHE !== "1") return;

  const directory = await mkdtemp(
    path.join(tmpdir(), "resume-tectonic-warmup-"),
  );
  const texPath = path.join(directory, "resume.tex");
  try {
    await writeFile(texPath, latex, "utf8");
    const result = spawnSync(
      tectonic,
      ["--untrusted", "--keep-logs", "--outdir", directory, texPath],
      {
        encoding: "utf8",
        timeout: 120_000,
        windowsHide: true,
        env: { ...process.env, TECTONIC_UNTRUSTED_MODE: "1" },
      },
    );
    if (result.error || result.status !== 0) {
      throw new Error(
        `Tectonic could not prepare the local package cache. ${result.stderr || result.stdout || result.error?.message || "Unknown compiler error."}`,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe.skipIf(!hasLocalToolchain)("real local PDF toolchain", () => {
  it("compiles the deterministic resume template to a verified one-page PDF", async () => {
    expect(firstAchievementId).toBeTruthy();
    const resumeLatex = renderResumeLatex({
      library,
      selectedAchievementIds: [firstAchievementId!],
    });

    await warmTectonicCache(resumeLatex);
    const result = await compileLatexToPdf(resumeLatex);

    expect(result.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(result.pageCount).toBe(1);
  }, 60_000);

  it("rejects a real two-page document with the one-page diagnostic", async () => {
    await expect(
      compileLatexToPdf(
        String.raw`\documentclass{article}
\begin{document}
First page.\newpage Second page.
\end{document}`,
      ),
    ).rejects.toMatchObject({
      code: "PAGE_LIMIT_EXCEEDED",
      status: 422,
      diagnostics:
        "Compiled page count: 2. Reduce or reprioritize content; template typography and spacing are fixed.",
    });
  }, 60_000);

  it("returns a useful error for invalid LaTeX from the real compiler", async () => {
    await expect(
      compileLatexToPdf(
        String.raw`\documentclass{article}
\begin{document}
\definitelyNotALatexCommand
\end{document}`,
      ),
    ).rejects.toMatchObject({ code: "LATEX_ERROR", status: 422 });
  }, 60_000);
});

if (!hasLocalToolchain) {
  console.info(
    "Skipping real PDF toolchain tests: install Tectonic and pdfinfo, or set TECTONIC_BINARY and PDFINFO_BINARY.",
  );
}
