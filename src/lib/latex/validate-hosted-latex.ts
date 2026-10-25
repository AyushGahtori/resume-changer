import { JAKE_STYLE_TEMPLATE } from "./jake-template";

// Hosted edits support resume formatting, not arbitrary TeX programming. The
// fixed, separately validated template may define macros; user content may not.
const commands = new Set([
  "ResumeHeader",
  "ResumeProfileSummary",
  "ResumeEntry",
  "ResumeEducationEntry",
  "ResumeBulletListStart",
  "ResumeBulletListEnd",
  "ResumeSkillGroup",
  "ResumeCredential",
  "begin",
  "end",
  "section",
  "item",
  "href",
  "url",
  "underline",
  "textbf",
  "textit",
  "texttt",
  "textrm",
  "textsf",
  "textsc",
  "emph",
  "small",
  "large",
  "Large",
  "LARGE",
  "footnotesize",
  "normalsize",
  "fontsize",
  "selectfont",
  "par",
  "vspace",
  "hspace",
  "textwidth",
  "linewidth",
  "textbar",
  "textbackslash",
  "textasciitilde",
  "textasciicircum",
  "cdot",
  "bullet",
  "enspace",
  "quad",
  "qquad",
  "hfill",
  "noindent",
  "raggedright",
  "newline",
  "linebreak",
  "newpage",
  "clearpage",
  "nobreak",
  "mbox",
  "strut",
  "\\",
  "&",
  "%",
  "$",
  "#",
  "_",
  "{",
  "}",
  " ",
  ",",
  ";",
  "!",
]);
const environments = new Set([
  "center",
  "itemize",
  "enumerate",
  "tabular",
  "tabular*",
  "tabularx",
]);

/** Called only after the approved-template validator succeeds. */
export function validateHostedLatex(latex: string): boolean {
  const [prefix, suffix] = JAKE_STYLE_TEMPLATE.split("%%RESUME_CONTENT%%");
  if (!latex.startsWith(prefix) || !latex.endsWith(suffix)) return false;
  const content = latex.slice(prefix.length, latex.length - suffix.length);
  // TeX's ^^ translation happens before tokenization and could conceal commands.
  if (
    content.includes("^^") ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(content)
  )
    return false;
  for (const match of content.matchAll(/\\([A-Za-z@]+|[^\r\n])/g))
    if (!commands.has(match[1])) return false;
  for (const match of content.matchAll(/\\(?:begin|end)\s*\{([^}]+)\}/g))
    if (!environments.has(match[1])) return false;
  return true;
}
