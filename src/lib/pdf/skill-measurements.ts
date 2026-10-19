import "server-only";
import { createHash } from "node:crypto";
import { applyJakeStyleTemplate } from "../latex/jake-template";
import { escapeLatexText } from "../latex/render-resume";
import { compileLatexToPdf } from "./compile-service";
import { readPdfTextBoxes } from "./layout-analysis";
import type { Skill } from "../schemas/resume-data";
import type { SkillMeasurements } from "../generation/skill-layout";

const cache = new Map<string, Promise<SkillMeasurements>>();

async function measure(skills: Skill[]): Promise<SkillMeasurements> {
  const glyphs = [
    ...Array.from({ length: 95 }, (_, index) =>
      String.fromCharCode(32 + index),
    ),
    "é",
    "–",
    "—",
    "’",
  ];
  const rows = [
    "I",
    "I, I",
    "\\textbf{Relevant Skills:} I",
    "\\textbf{Additional Skills:} I",
    ...skills.map((skill) => escapeLatexText(skill.name)),
    "XX",
    ...glyphs.map((glyph) => escapeLatexText(`X${glyph}X`)),
  ];
  const latex = applyJakeStyleTemplate(
    [
      "\\ResumeHeader{Template measurements}{Resume Changer}",
      "\\section*{Technical Skills}",
      "{\\small",
      ...rows.map(
        (row, index) =>
          `\\noindent\\makebox[34pt][l]{m${String(index).padStart(3, "0")}}\\mbox{${row}}\\par`,
      ),
      "}",
    ].join("\n"),
  );
  const { pdf } = await compileLatexToPdf(latex, { allowPageOverflow: true });
  const pages = await readPdfTextBoxes(pdf);
  const widths = rows.map((_, index) => {
    const marker = `m${String(index).padStart(3, "0")}`;
    const page = pages.find((boxes) =>
      boxes.some((box) => box.text.trim().startsWith(marker)),
    );
    const label = page?.find((box) => box.text.trim().startsWith(marker));
    if (!label || !page)
      throw new Error("The template font measurements could not be read.");
    const start = label.x + 34 * (72 / 72.27);
    const boxes = page.filter(
      (box) =>
        Math.abs(box.y - label.y) < 1 &&
        box.x + box.width > start &&
        box.text.trim(),
    );
    if (!boxes.length) {
      if (index >= 4 && index < skills.length + 4) return Number.NaN;
      throw new Error("A skill could not be measured with the resume font.");
    }
    if (index >= 4 && index < skills.length + 4) {
      const normalize = (value: string) =>
        value
          .normalize("NFKC")
          .replace(/\s+/g, "")
          .replace(/[’‘`]/g, "'")
          .replace(/[–—]/g, "-");
      const rendered = boxes
        .map((box) => box.text)
        .join("")
        .replace(new RegExp(`^${marker}\\s*`), "");
      if (normalize(rendered) !== normalize(skills[index - 4].name))
        return Number.NaN;
    }
    return Math.max(...boxes.map((box) => box.x + box.width)) - start;
  });
  return {
    widths: Object.fromEntries(
      skills.flatMap((skill, index) =>
        Number.isFinite(widths[index + 4])
          ? [[skill.id, widths[index + 4]]]
          : [],
      ),
    ),
    unsupportedSkillIds: skills
      .filter((_, index) => !Number.isFinite(widths[index + 4]))
      .map((skill) => skill.id),
    labelWidths: [widths[2] - widths[0], widths[3] - widths[0]],
    separatorWidth: Math.max(0, widths[1] - widths[0] * 2),
    lineWidth: (8.5 - 0.55 * 2) * 72,
    source: "latex",
    glyphWidths: Object.fromEntries(
      glyphs.map((glyph, index) => [
        glyph,
        Math.max(
          0,
          widths[skills.length + 5 + index] - widths[skills.length + 4],
        ),
      ]),
    ),
  };
}

export function measureSkillWidths(
  skills: Skill[],
): Promise<SkillMeasurements> {
  const key = createHash("sha256")
    .update(JSON.stringify(skills.map(({ id, name }) => [id, name])))
    .digest("hex");
  const existing = cache.get(key);
  if (existing) return existing;
  if (cache.size >= 8) cache.delete(cache.keys().next().value!);
  const promise = measure(skills).catch((error: unknown) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, promise);
  return promise;
}

export async function measureAchievementLines(text: string): Promise<number> {
  const latex = applyJakeStyleTemplate(
    [
      "\\ResumeHeader{Layout validation}{Resume Changer}",
      "\\section*{Experience}",
      "measurementstart\\par",
      "\\ResumeBulletListStart",
      `\\item ${escapeLatexText(text)}`,
      "\\ResumeBulletListEnd",
      "measurementend\\par",
    ].join("\n"),
  );
  const { pdf } = await compileLatexToPdf(latex, { allowPageOverflow: true });
  const pages = await readPdfTextBoxes(pdf);
  let counting = false;
  let foundStart = false;
  let foundEnd = false;
  let lines = 0;
  for (const page of pages) {
    const rows = new Map<number, string[]>();
    for (const box of page) {
      if (!box.text.trim()) continue;
      const y = Math.round(box.y * 2) / 2;
      rows.set(y, [...(rows.get(y) ?? []), box.text]);
    }
    for (const [, parts] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
      const value = parts.join("");
      if (value.includes("measurementstart")) {
        counting = true;
        foundStart = true;
        continue;
      }
      if (value.includes("measurementend")) {
        counting = false;
        foundEnd = true;
        continue;
      }
      if (counting && /[\p{L}\p{N}]/u.test(value)) lines += 1;
    }
  }
  if (!foundStart || !foundEnd || !lines)
    throw new Error("The achievement line count could not be verified.");
  return lines;
}
