import { JAKE_STYLE_TEMPLATE } from "./jake-template";

export type LatexValidationResult =
  { valid: true; errors: [] } | { valid: false; errors: string[] };

const TEMPLATE_MARKER = "%%RESUME_CONTENT%%";
const FORBIDDEN_COMMANDS = new Set([
  "catcode",
  "csname",
  "def",
  "edef",
  "file",
  "gdef",
  "include",
  "includeonly",
  "includegraphics",
  "input",
  "let",
  "newcommand",
  "newread",
  "newwrite",
  "openin",
  "openout",
  "pdfextension",
  "pdfobj",
  "pdfxform",
  "providecommand",
  "read",
  "readline",
  "renewcommand",
  "scantokens",
  "special",
  "usepackage",
  "write",
  "write18",
  "xdef",
  "graphicspath",
]);

const REQUIRED_CONTENT_SECTIONS = [
  "Experience",
  "Projects",
  "Education",
  "Technical Skills",
  "Licenses and Certifications",
];

function stripComments(source: string): string {
  return source.replace(/\\.|%[^\r\n]*/g, (token) =>
    token.startsWith("%") ? " ".repeat(token.length) : token,
  );
}

function findCommandArgument(
  source: string,
  command: string,
  argumentIndex: number,
): string | undefined {
  const commandIndex = source.indexOf(command);
  if (commandIndex < 0) return undefined;

  let cursor = commandIndex + command.length;
  let argument = 0;
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (source[cursor] !== "{") return undefined;

    const start = ++cursor;
    let depth = 1;
    while (cursor < source.length && depth > 0) {
      const character = source[cursor];
      if (character === "\\") {
        cursor += 2;
        continue;
      }
      if (character === "{") depth += 1;
      if (character === "}") depth -= 1;
      cursor += 1;
    }
    if (depth !== 0) return undefined;
    if (argument === argumentIndex) {
      return source.slice(start, cursor - 1);
    }
    argument += 1;
  }
  return undefined;
}

function listForbiddenCommands(content: string): string[] {
  const commands = new Set<string>();
  const commandPattern = /\\([A-Za-z]+|.)/g;
  for (const match of content.matchAll(commandPattern)) {
    const command = match[1];
    if (FORBIDDEN_COMMANDS.has(command.toLowerCase())) {
      commands.add(command);
    }
  }
  return [...commands].sort();
}

export function validateResumeLatex(latex: string): LatexValidationResult {
  const errors: string[] = [];
  const markerIndex = JAKE_STYLE_TEMPLATE.indexOf(TEMPLATE_MARKER);
  const prefix = JAKE_STYLE_TEMPLATE.slice(0, markerIndex);
  const suffix = JAKE_STYLE_TEMPLATE.slice(
    markerIndex + TEMPLATE_MARKER.length,
  );

  if (!latex.startsWith(prefix) || !latex.endsWith(suffix)) {
    errors.push(
      "The document does not match the approved resume template. Regenerate the LaTeX from the resume builder.",
    );
  }

  const contentStart = latex.indexOf(prefix) === 0 ? prefix.length : 0;
  const contentEnd = latex.endsWith(suffix)
    ? latex.length - suffix.length
    : latex.length;
  const content = latex.slice(contentStart, contentEnd);
  const visibleLatex = stripComments(latex);

  if (
    (visibleLatex.match(/\\begin\{document\}/g) ?? []).length !== 1 ||
    (visibleLatex.match(/\\end\{document\}/g) ?? []).length !== 1 ||
    visibleLatex.indexOf("\\begin{document}") >
      visibleLatex.indexOf("\\end{document}")
  ) {
    errors.push(
      "The document must contain one correctly ordered document start and end.",
    );
  }

  let braceDepth = 0;
  for (let index = 0; index < visibleLatex.length; index += 1) {
    const character = visibleLatex[index];
    if (character === "\\") {
      const command = visibleLatex.slice(index + 1).match(/^[A-Za-z]+|^./)?.[0];
      if (command) index += command.length;
      continue;
    }
    if (character === "{") braceDepth += 1;
    if (character === "}") {
      braceDepth -= 1;
      if (braceDepth < 0) break;
    }
  }
  if (braceDepth !== 0) {
    errors.push("The LaTeX contains unbalanced braces or malformed groups.");
  }

  const contact = findCommandArgument(content, "\\ResumeHeader", 1);
  if (!contact?.trim()) {
    errors.push(
      "The resume header is missing its contact block. Add at least one contact detail in your profile.",
    );
  }

  if (
    !REQUIRED_CONTENT_SECTIONS.some((section) =>
      content.includes(`\\section*{${section}}`),
    )
  ) {
    errors.push(
      "The resume has no content section. Include experience, projects, education, skills, or credentials before compiling.",
    );
  }

  if (
    /%%[A-Z0-9_]+%%|\{\{[^{}]+\}\}/.test(content) ||
    content.includes(TEMPLATE_MARKER)
  ) {
    errors.push(
      "The LaTeX contains an unresolved template placeholder. Regenerate the resume.",
    );
  }

  const forbiddenCommands = listForbiddenCommands(stripComments(content));
  if (forbiddenCommands.length > 0) {
    errors.push(
      `The resume contains unsupported or unsafe LaTeX command(s): ${forbiddenCommands.map((command) => `\\${command}`).join(", ")}. Remove them and regenerate the resume.`,
    );
  }

  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, errors: [] };
}
