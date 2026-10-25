import { describe, expect, it } from "vitest";
import example from "../../examples/sample-resume-library.json";
import type { ResumeLibrary } from "../../src/lib/schemas/resume-data";
import { renderResumeLatex } from "../../src/lib/latex/render-resume";
import { compileLatexToPdf } from "../../src/lib/pdf/compile-service";
import { analyzePdfLayout } from "../../src/lib/pdf/layout-analysis";
import { buildPdfServiceCheckLatex } from "../../src/lib/pdf/service-check";

const library = example as ResumeLibrary;
const ids = library.jobs.flatMap((job) => job.points.map((point) => point.id));

describe("packaged production PDF runtime", () => {
  it("compiles the fixed service readiness sample without loading personal data", async () => {
    const compiled = await compileLatexToPdf(buildPdfServiceCheckLatex());
    expect(compiled.pageCount).toBe(1);
    expect((await analyzePdfLayout(compiled.pdf)).text).toContain(
      "Fictional sample",
    );
  });
  it("compiles the approved template offline and measures its real one-page output", async () => {
    const latex = renderResumeLatex({
      library,
      selectedAchievementIds: ids.slice(0, 4),
    });
    const compiled = await compileLatexToPdf(latex);
    const measured = await analyzePdfLayout(compiled.pdf);
    expect(compiled.pageCount).toBe(1);
    expect(measured.layout.pageCount).toBe(1);
    expect(measured.text).toContain("Jordan Example");
    expect(measured.layout.visibleWordCount).toBeGreaterThan(100);
  });
  it("uses actual PDF.js page counts to reject overflow and permit internal fitting measurements", async () => {
    const longLibrary = {
      ...library,
      jobs: library.jobs.map((job) => ({
        ...job,
        points: job.points.map((point) => ({
          ...point,
          text: Array.from({ length: 24 }, () => point.text).join(" "),
        })),
      })),
    };
    const latex = renderResumeLatex({
      library: longLibrary,
      selectedAchievementIds: ids,
    });
    await expect(compileLatexToPdf(latex)).rejects.toMatchObject({
      code: "PAGE_LIMIT_EXCEEDED",
    });
    const compiled = await compileLatexToPdf(latex, {
      allowPageOverflow: true,
    });
    expect(compiled.pageCount).toBeGreaterThan(1);
  });
  it("returns a compiler error for malformed commands and blocks unsafe commands", async () => {
    const latex = renderResumeLatex({ library, selectedAchievementIds: [] });
    await expect(
      compileLatexToPdf(
        latex.replace(
          "Jordan Example",
          String.raw`Jordan\vspace{invalid-dimension}`,
        ),
      ),
    ).rejects.toMatchObject({ code: "LATEX_ERROR" });
    await expect(
      compileLatexToPdf(
        latex.replace("Jordan Example", String.raw`\input{secret}`),
      ),
    ).rejects.toMatchObject({ code: "LATEX_VALIDATION_ERROR" });
  });
  it("keeps simultaneous users' source files and PDF text separate", async () => {
    const names = ["Alice Fictional", "Bob Fictional", "Carol Fictional"];
    const outputs = await Promise.all(
      names.map(async (name) => {
        const latex = renderResumeLatex({
          library: {
            ...library,
            profile: { ...library.profile, fullName: name },
          },
          selectedAchievementIds: ids.slice(0, 2),
        });
        const compiled = await compileLatexToPdf(latex);
        return (await analyzePdfLayout(compiled.pdf)).text;
      }),
    );
    outputs.forEach((text, index) => {
      expect(text).toContain(names[index]);
      for (const other of names.filter((_, otherIndex) => index !== otherIndex))
        expect(text).not.toContain(other);
    });
  });
});
