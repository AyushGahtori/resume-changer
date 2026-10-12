import { spawnSync } from "node:child_process";
import sampleLibrary from "../../../examples/sample-resume-library.json";
import { renderResumeLatex } from "../../../src/lib/latex/render-resume";
import type { ResumeLibrary } from "../../../src/lib/schemas/resume-data";
import { describe, expect, it } from "vitest";
import { compileLatexToPdf } from "../../../src/lib/pdf/compile-service";

const library = sampleLibrary as ResumeLibrary;
const firstAchievementId = library.jobs[0]?.points[0]?.id;

function isExecutableAvailable(executable: string): boolean {
  const result = spawnSync(executable, ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  });
  return !result.error && result.status === 0;
}

const tectonic = process.env.TECTONIC_BINARY ?? "tectonic";
const pdfInfo = process.env.PDFINFO_BINARY ?? "pdfinfo";
const hasLocalToolchain =
  isExecutableAvailable(tectonic) && isExecutableAvailable(pdfInfo);

describe.skipIf(!hasLocalToolchain)("real local PDF toolchain", () => {
  it("compiles the deterministic resume template to a verified one-page PDF", async () => {
    expect(firstAchievementId).toBeTruthy();
    const resumeLatex = renderResumeLatex({
      library,
      selectedAchievementIds: [firstAchievementId!],
    });

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
