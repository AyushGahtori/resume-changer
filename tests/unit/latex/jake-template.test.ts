import { describe, expect, it } from "vitest";
import {
  applyJakeStyleTemplate,
  JAKE_STYLE_TEMPLATE,
} from "../../../src/lib/latex/jake-template";
import { validateResumeLatex } from "../../../src/lib/latex/validate-resume-latex";

describe("applyJakeStyleTemplate", () => {
  it("replaces the single content marker with the supplied body", () => {
    const output = applyJakeStyleTemplate("\\section*{Experience}");

    expect(output).toContain("\\section*{Experience}");
    expect(output).not.toContain("%%RESUME_CONTENT%%");
    expect(output).toContain("\\begin{document}");
    expect(output).toContain("\\end{document}");
  });

  it("keeps the approved typography and layout settings unchanged", () => {
    const output = applyJakeStyleTemplate("body");

    expect(output).toContain("\\documentclass[letterpaper,10pt]{article}");
    expect(output).toContain(
      "\\usepackage[letterpaper,top=0.45in,bottom=0.45in,left=0.55in,right=0.55in]{geometry}",
    );
    expect(output).toContain("\\setlist[itemize]{leftmargin=0.17in");
    expect(output).toContain("\\titleformat{\\section}");
  });

  it("leaves a duplicated document body for the validator to reject", () => {
    // The body is inserted inside the template's document, so content that
    // opens another one is malformed rather than silently merged.
    const output = applyJakeStyleTemplate("\\begin{document}\\end{document}");

    expect((output.match(/\\begin\{document\}/g) ?? []).length).toBe(2);
    expect(validateResumeLatex(output).valid).toBe(false);
  });

  it("is deterministic for the same content", () => {
    expect(applyJakeStyleTemplate("body")).toBe(applyJakeStyleTemplate("body"));
  });

  it("keeps the template's preamble intact after the body is inserted", () => {
    const output = applyJakeStyleTemplate("body");
    const preamble = JAKE_STYLE_TEMPLATE.slice(
      0,
      JAKE_STYLE_TEMPLATE.indexOf("%%RESUME_CONTENT%%"),
    );

    expect(output.startsWith(preamble)).toBe(true);
  });
});

describe("the template marker contract", () => {
  it("contains exactly one content marker", () => {
    expect(
      (JAKE_STYLE_TEMPLATE.match(/%%RESUME_CONTENT%%/g) ?? []).length,
    ).toBe(1);
  });

  it("produces LaTeX the validator accepts when a section is present", () => {
    const output = applyJakeStyleTemplate(
      "\\ResumeHeader{Jordan Example}{Resume Changer}\n\\section*{Experience}\nEntry",
    );

    expect(validateResumeLatex(output)).toEqual({ valid: true, errors: [] });
  });
});
