import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  measureAchievementLines,
  measureSkillWidths,
} from "../../../src/lib/pdf/skill-measurements";
import { compileLatexToPdf } from "../../../src/lib/pdf/compile-service";
import { analyzePdfLayout } from "../../../src/lib/pdf/layout-analysis";
import { renderStudioGeneration } from "../../../src/lib/generation/studio-generation";
import { studioApplyInput, studioLibrary } from "../../helpers/studio-fixtures";

function isExecutableAvailable(executable: string, args: string[]): boolean {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5000,
  });
  return !result.error && result.status === 0;
}

// These measurements compile real PDFs, so they need Tectonic and pdfinfo alike.
const available =
  isExecutableAvailable(process.env.TECTONIC_BINARY ?? "tectonic", [
    "--version",
  ]) && isExecutableAvailable(process.env.PDFINFO_BINARY ?? "pdfinfo", ["-v"]);
if (process.env.PDF_TOOLCHAIN_REQUIRED === "1" && !available)
  throw new Error(
    "The studio integration tests require Tectonic and pdfinfo. Install both or set TECTONIC_BINARY and PDFINFO_BINARY.",
  );

describe.skipIf(!available)("real studio layout validation", () => {
  it("measures the actual LaTeX font and compiles a skills-only transaction", async () => {
    const narrow = {
      ...studioLibrary.skills[0],
      id: "skill-narrow",
      name: "iiiiii",
    };
    const wide = {
      ...studioLibrary.skills[0],
      id: "skill-wide",
      name: "WWWWWW",
    };
    const unsupported = {
      ...studioLibrary.skills[0],
      id: "skill-unsupported-glyph",
      name: "Python 🚀",
    };
    const measurements = await measureSkillWidths([
      ...studioLibrary.skills,
      narrow,
      wide,
      unsupported,
    ]).catch((error) => {
      console.error(error.diagnostics);
      throw error;
    });
    expect(measurements.widths[wide.id]).toBeGreaterThan(
      measurements.widths[narrow.id] * 2,
    );
    expect(measurements.separatorWidth).toBeGreaterThan(0);
    expect(measurements.unsupportedSkillIds).toEqual([unsupported.id]);
    expect(measurements.widths).not.toHaveProperty(unsupported.id);
    const input = {
      ...studioApplyInput,
      document: {
        ...studioApplyInput.document,
        skillIds: ["skill-python", "skill-react"],
      },
    };
    const generation = renderStudioGeneration(
      studioLibrary,
      input,
      measurements,
    );
    const compiled = await compileLatexToPdf(generation.latex);
    const analysis = await analyzePdfLayout(compiled.pdf);
    expect(analysis.layout).toMatchObject({ pageCount: 1, clipped: false });
    expect(analysis.text).toContain("Python");
    expect(analysis.text).toContain("React");
    expect(generation.metadata.studioDocument?.bullets).toEqual(
      input.document.bullets,
    );
  }, 60000);
  it("confirms one-line and multi-line achievements with the actual renderer", async () => {
    expect(
      await measureAchievementLines("Built reliable deployment tooling.").catch(
        (error) => {
          console.error(error.diagnostics);
          throw error;
        },
      ),
    ).toBe(1);
    expect(
      await measureAchievementLines(
        "Built reliable deployment tooling and verified production workflows. ".repeat(
          12,
        ),
      ),
    ).toBeGreaterThan(2);
  }, 60000);
});
