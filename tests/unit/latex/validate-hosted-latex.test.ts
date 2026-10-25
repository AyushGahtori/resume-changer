import { describe, expect, it } from "vitest";
import sample from "../../../examples/sample-resume-library.json";
import type { ResumeLibrary } from "../../../src/lib/schemas/resume-data";
import { renderResumeLatex } from "../../../src/lib/latex/render-resume";
import { validateHostedLatex } from "../../../src/lib/latex/validate-hosted-latex";
const valid = renderResumeLatex({
  library: sample as ResumeLibrary,
  selectedAchievementIds: [],
});
const inject = (text: string) =>
  valid.replace("\\end{document}", `${text}\n\\end{document}`);
describe("hosted LaTeX command boundary", () => {
  it("accepts the real template and ordinary formatting/overflow measurement", () => {
    expect(validateHostedLatex(valid)).toBe(true);
    expect(
      validateHostedLatex(inject("\\textbf{Evidence}\\newpage More evidence")),
    ).toBe(true);
  });
  it("rejects filesystem primitives, command expansion and encoded command names", () => {
    for (const text of [
      "\\input{/proc/self/environ}",
      "\\@@input{/etc/passwd}",
      "\\everyjob{bad}",
      "\\expandafter\\foo",
      "\\immediate\\write18{bad}",
      "\\^^69nput{bad}",
      "\\begin{filecontents}{bad}data\\end{filecontents}",
    ])
      expect(validateHostedLatex(inject(text)), text).toBe(false);
  });
  it("rejects changed template shells and control bytes", () => {
    expect(validateHostedLatex(valid.replace("10pt", "12pt"))).toBe(false);
    expect(validateHostedLatex(inject("unsafe\u0000text"))).toBe(false);
  });
});
