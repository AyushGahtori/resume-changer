/**
 * Proposes skills a note names outright.
 * A target job description is not an input: only the notes and the library.
 */

export type SkillCandidate = {
  name: string;
  aliases: string[];
  sourceIndexes: number[];
  reason: string;
};

type LibrarySkill = {
  name: string;
  aliases: string[];
};

type CatalogSkill = {
  name: string;
  aliases: readonly string[];
};

type Matcher = {
  text: string;
  canonical: string;
  aliases: readonly string[];
  reason: string;
};

const NAMED_IN_NOTES = "Named in your notes";
const MATCHES_EXISTING = "Matches your existing skill";

const SKILL_CATALOG: readonly CatalogSkill[] = [
  { name: "Python", aliases: ["py"] },
  { name: "SQL", aliases: [] },
  { name: "Power BI", aliases: ["powerbi", "power-bi"] },
  { name: "JavaScript", aliases: ["js"] },
  { name: "TypeScript", aliases: ["ts"] },
  { name: "React", aliases: [] },
  { name: "Node.js", aliases: ["node", "nodejs"] },
  { name: "Java", aliases: [] },
  { name: "Go", aliases: [] },
  { name: "Rust", aliases: [] },
  { name: "C++", aliases: [] },
  { name: "C#", aliases: [] },
  { name: "AWS", aliases: ["Amazon Web Services"] },
  { name: "GCP", aliases: [] },
  { name: "Azure", aliases: [] },
  { name: "Docker", aliases: [] },
  { name: "Kubernetes", aliases: ["k8s"] },
  { name: "Terraform", aliases: [] },
  { name: "Git", aliases: [] },
  { name: "PostgreSQL", aliases: ["postgres"] },
  { name: "Excel", aliases: [] },
  { name: "Tableau", aliases: [] },
  { name: "Figma", aliases: [] },
  { name: "TensorFlow", aliases: [] },
  { name: "PyTorch", aliases: [] },
  { name: "Spark", aliases: [] },
  { name: "Hadoop", aliases: [] },
  { name: "Airflow", aliases: [] },
  { name: "dbt", aliases: [] },
  { name: "Looker", aliases: [] },
  { name: "Salesforce", aliases: [] },
];

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/**
 * Returns catalog or library skills explicitly written in the notes.
 * Longer names are tried first, so "javascript" does not also match Java.
 */
export function detectSkillCandidates(
  notes: string[],
  existing: Array<{ name: string; aliases: string[] }>,
): SkillCandidate[] {
  const matchers = buildMatchers(existing);
  const found = new Map<string, SkillCandidate>();

  notes.forEach((note, noteIndex) => {
    const lower = note.toLowerCase();
    let cursor = 0;
    while (cursor < lower.length) {
      const match = matchAt(lower, cursor, matchers);
      if (!match) {
        cursor += 1;
        continue;
      }
      const current = found.get(match.canonical);
      if (!current) {
        found.set(match.canonical, {
          name: match.canonical,
          aliases: [...match.aliases],
          sourceIndexes: [noteIndex],
          reason: match.reason,
        });
      } else if (!current.sourceIndexes.includes(noteIndex)) {
        current.sourceIndexes.push(noteIndex);
      }
      cursor += match.text.length;
    }
  });

  return [...found.values()];
}

function buildMatchers(existing: readonly LibrarySkill[]): Matcher[] {
  const matchers: Matcher[] = [];
  const seen = new Set<string>();
  const existingByName = new Map<string, LibrarySkill>();

  for (const skill of existing) {
    const nameKey = normalizeToken(skill.name);
    if (nameKey && !existingByName.has(nameKey)) {
      existingByName.set(nameKey, skill);
    }
    for (const token of [skill.name, ...skill.aliases]) {
      addMatcher(matchers, seen, {
        text: normalizeToken(token),
        canonical: skill.name,
        aliases: skill.aliases,
        reason: MATCHES_EXISTING,
      });
    }
  }

  for (const entry of SKILL_CATALOG) {
    const librarySkill = existingByName.get(normalizeToken(entry.name));
    const canonical = librarySkill?.name ?? entry.name;
    const aliases = librarySkill?.aliases ?? entry.aliases;
    const reason = librarySkill ? MATCHES_EXISTING : NAMED_IN_NOTES;
    for (const token of [entry.name, ...entry.aliases]) {
      addMatcher(matchers, seen, {
        text: normalizeToken(token),
        canonical,
        aliases,
        reason,
      });
    }
  }

  matchers.sort((left, right) => right.text.length - left.text.length);
  return matchers;
}

function addMatcher(matchers: Matcher[], seen: Set<string>, matcher: Matcher) {
  if (!matcher.text || seen.has(matcher.text)) return;
  seen.add(matcher.text);
  matchers.push(matcher);
}

function matchAt(
  text: string,
  cursor: number,
  matchers: readonly Matcher[],
): Matcher | null {
  for (const matcher of matchers) {
    if (!text.startsWith(matcher.text, cursor)) continue;
    if (!bounded(text, cursor, matcher.text.length)) continue;
    return matcher;
  }
  return null;
}

function bounded(text: string, start: number, length: number): boolean {
  if (start > 0 && isWordChar(text[start - 1] ?? "")) return false;
  const end = start + length;
  if (end < text.length && isWordChar(text[end] ?? "")) return false;
  return true;
}

function isWordChar(char: string): boolean {
  return WORD_CHAR.test(char);
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}
