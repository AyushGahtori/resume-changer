import { describe, expect, it } from "vitest";
import sampleLibrary from "../../../examples/sample-resume-library.json";
import { renderResumeLatex } from "../../../src/lib/latex/render-resume";
import { validateResumeLatex } from "../../../src/lib/latex/validate-resume-latex";
import type { ResumeLibrary } from "../../../src/lib/schemas/resume-data";

const library = sampleLibrary as ResumeLibrary;
const validLatex = renderResumeLatex({
  library,
  selectedAchievementIds: [],
});

describe("validateResumeLatex", () => {
  it("accepts deterministic renderer output, including escaped special characters", () => {
    const latex = renderResumeLatex({
      library: {
        ...library,
        profile: { ...library.profile, fullName: "Jordan A&B_100% Example" },
      },
      selectedAchievementIds: [],
    });

    expect(validateResumeLatex(latex)).toEqual({ valid: true, errors: [] });
  });

  it("reports an altered or corrupted template shell", () => {
    const result = validateResumeLatex(validLatex.replace("10pt", "12pt"));

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "The document does not match the approved resume template. Regenerate the LaTeX from the resume builder.",
    );
  });

  it("rejects missing document boundaries and unbalanced groups", () => {
    const noEnd = validLatex.replace("\\end{document}", "");
    const unbalanced = validLatex.replace("Jordan Example", "Jordan {Example");

    expect(validateResumeLatex(noEnd).errors).toContain(
      "The document must contain one correctly ordered document start and end.",
    );
    expect(validateResumeLatex(unbalanced).errors).toContain(
      "The LaTeX contains unbalanced braces or malformed groups.",
    );
  });

  it("requires a contact block and at least one resume content section", () => {
    const missingContact = validLatex.replace(
      /\\ResumeHeader\{[^\n]+\}\{[^\n]*\}/,
      "\\ResumeHeader{Jordan Example}{}",
    );
    const missingSection = validLatex.replace(/\\section\*\{[^}]+\}/g, "");

    expect(validateResumeLatex(missingContact).errors).toContain(
      "The resume header is missing its contact block. Add at least one contact detail in your profile.",
    );
    expect(validateResumeLatex(missingSection).errors).toContain(
      "The resume has no content section. Include experience, projects, education, skills, or credentials before compiling.",
    );
  });

  it("rejects unresolved placeholders and unsafe TeX commands in variable content", () => {
    const unresolved = validLatex.replace(
      "Jordan Example",
      "{{CANDIDATE_NAME}}",
    );
    const unsafe = validLatex.replace(
      "Jordan Example",
      String.raw`Jordan\input{/etc/passwd} Example`,
    );

    expect(validateResumeLatex(unresolved).errors).toContain(
      "The LaTeX contains an unresolved template placeholder. Regenerate the resume.",
    );
    expect(validateResumeLatex(unsafe).errors.join(" ")).toContain(
      String.raw`\input`,
    );
  });

  it("does not treat dangerous-looking text inside LaTeX comments as executable commands", () => {
    const commented = validLatex.replace(
      "\\begin{document}",
      "\\begin{document}\n% \\input{not-executed}",
    );

    expect(validateResumeLatex(commented).valid).toBe(true);
  });
});
