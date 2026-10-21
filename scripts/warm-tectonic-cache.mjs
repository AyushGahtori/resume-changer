import { mkdirSync, writeFileSync } from "node:fs";
import { renderResumeLatex } from "../src/lib/latex/render-resume.ts";
import sampleLibrary from "../examples/sample-resume-library.json";

/**
 * Writes a real resume to the given path, so the Tectonic cache can be
 * filled with the packages and font metrics the approved template uses.
 *
 * The document is rendered from the actual renderer rather than assembled by
 * hand, so it exercises every command in the template. A hand-written
 * document can leave a font metric uncached, and the compiler then fails
 * with "Font T1/lmr/bx/n/9=ec-lmbx9 at 9.0pt not loadable".
 */

const outputPath = process.argv[2];
if (!outputPath) {
  throw new Error("Pass the path of the .tex file to write.");
}

mkdirSync(outputPath.replace(/[^/\\]+$/, ""), { recursive: true });
const library = sampleLibrary;
const latex = renderResumeLatex({
  library,
  selectedAchievementIds: [library.jobs[0].points[0].id],
});
writeFileSync(outputPath, latex, "utf8");
console.log(`Wrote ${latex.length} characters of resume LaTeX.`);
