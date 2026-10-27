import {
  EVIDENCE_LIMITS,
  getPhysicalLines,
  normalizeSourceText,
  sha256,
  type EvidenceCategory,
} from "./file-policy-core";

export interface SourceBlock {
  lineStart: number;
  lineEnd: number;
  excerpt: string;
  category: EvidenceCategory;
  score: number;
  blockKind: "file" | "declaration" | "test" | "section" | "paragraph" | "rule";
}

/**
 * Finds complete, bounded source units. It never returns a prefix or a cut-off
 * function merely to fill a line allowance.
 */
export function extractMeaningfulBlocks(
  source: string,
  path: string,
  category: EvidenceCategory,
  relevanceTerms: readonly string[] = [],
): SourceBlock[] {
  const normalized = normalizeSourceText(source);
  const lines = getPhysicalLines(normalized);
  if (lines.length === 0) return [];

  if (
    lines.length <= EVIDENCE_LIMITS.maxLinesPerFile &&
    normalized.length <= EVIDENCE_LIMITS.maxCharsPerFile
  ) {
    return [
      makeBlock(lines, 0, lines.length - 1, category, "file", relevanceTerms),
    ];
  }

  let ranges: Array<{
    start: number;
    end: number;
    blockKind: SourceBlock["blockKind"];
  }>;
  if (/\.(?:md|mdx|rst|adoc|txt)$/i.test(path)) {
    ranges = findDocumentSections(lines);
  } else if (/\.(?:css|scss|sass|less)$/i.test(path)) {
    ranges = findBraceDeclarations(lines, "rule");
  } else if (/\.py$/i.test(path)) {
    ranges = findPythonDeclarations(lines);
  } else {
    ranges = findBraceDeclarations(
      lines,
      category === "corroboration" ? "test" : "declaration",
    );
  }

  const unique = new Map<string, SourceBlock>();
  for (const range of ranges) {
    const blockLines = lines.slice(range.start, range.end + 1);
    if (
      blockLines.length > EVIDENCE_LIMITS.maxLinesPerFile ||
      blockLines.join("\n").length > EVIDENCE_LIMITS.maxCharsPerFile
    ) {
      continue;
    }
    const block = makeBlock(
      lines,
      range.start,
      range.end,
      category,
      range.blockKind,
      relevanceTerms,
    );
    const key = `${block.lineStart}:${block.lineEnd}:${sha256(block.excerpt)}`;
    unique.set(key, block);
  }

  return [...unique.values()].sort(
    (left, right) =>
      right.score - left.score || left.lineStart - right.lineStart,
  );
}

export function mergeLineRanges(
  ranges: readonly { lineStart: number; lineEnd: number }[],
): Array<{ lineStart: number; lineEnd: number }> {
  const sorted = [...ranges]
    .filter(
      (range) =>
        Number.isInteger(range.lineStart) &&
        Number.isInteger(range.lineEnd) &&
        range.lineStart > 0 &&
        range.lineEnd >= range.lineStart,
    )
    .sort(
      (left, right) =>
        left.lineStart - right.lineStart || left.lineEnd - right.lineEnd,
    );
  const merged: Array<{ lineStart: number; lineEnd: number }> = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (!previous || range.lineStart > previous.lineEnd + 1) {
      merged.push({ ...range });
    } else {
      previous.lineEnd = Math.max(previous.lineEnd, range.lineEnd);
    }
  }
  return merged;
}

function makeBlock(
  lines: string[],
  start: number,
  end: number,
  category: EvidenceCategory,
  blockKind: SourceBlock["blockKind"],
  relevanceTerms: readonly string[],
): SourceBlock {
  const excerpt = lines.slice(start, end + 1).join("\n");
  const normalized = excerpt.toLowerCase();
  const matches = relevanceTerms.reduce(
    (count, term) =>
      count +
      (term.length > 2 && normalized.includes(term.toLowerCase()) ? 1 : 0),
    0,
  );
  const hasAssertions = /\b(?:expect|assert|should|test|it)\s*\(/i.test(
    excerpt,
  );
  const hasExportOrBoundary =
    /\b(?:export|public|async|route|handler|endpoint)\b/i.test(excerpt);
  const score =
    (blockKind === "test" && hasAssertions ? 16 : 0) +
    (blockKind === "declaration" && hasExportOrBoundary ? 12 : 0) +
    (category === "core-method" || category === "product-surface" ? 8 : 0) +
    (category === "corroboration" ? 9 : 0) +
    (category === "purpose" ? 4 : 0) +
    (category === "measurement" ? 6 : 0) +
    Math.min(matches * 3, 15) -
    Math.max(0, Math.ceil(excerpt.length / 4_000) - 1);

  return {
    lineStart: start + 1,
    lineEnd: end + 1,
    excerpt,
    category,
    score,
    blockKind,
  };
}

function findDocumentSections(
  lines: string[],
): Array<{ start: number; end: number; blockKind: SourceBlock["blockKind"] }> {
  const headings = lines
    .map((line, index) => ({ index, match: /^(#{1,6})\s+\S/.exec(line) }))
    .filter((entry): entry is { index: number; match: RegExpExecArray } =>
      Boolean(entry.match),
    );
  const ranges: Array<{
    start: number;
    end: number;
    blockKind: SourceBlock["blockKind"];
  }> = [];

  if (headings.length > 0 && headings[0].index > 0) {
    ranges.push({
      start: 0,
      end: headings[0].index - 1,
      blockKind: "paragraph",
    });
  }
  headings.forEach((heading, index) => {
    const level = heading.match[1].length;
    let end = lines.length - 1;
    for (const next of headings.slice(index + 1)) {
      if (next.match[1].length <= level) {
        end = next.index - 1;
        break;
      }
    }
    ranges.push({ start: heading.index, end, blockKind: "section" });
  });

  if (ranges.length === 0) return splitParagraphs(lines);
  return ranges;
}

function splitParagraphs(
  lines: string[],
): Array<{ start: number; end: number; blockKind: SourceBlock["blockKind"] }> {
  const ranges: Array<{
    start: number;
    end: number;
    blockKind: SourceBlock["blockKind"];
  }> = [];
  let start = -1;
  for (let index = 0; index <= lines.length; index += 1) {
    if (index < lines.length && lines[index].trim() !== "") {
      if (start < 0) start = index;
      continue;
    }
    if (start >= 0) {
      ranges.push({ start, end: index - 1, blockKind: "paragraph" });
      start = -1;
    }
  }
  return ranges;
}

function findPythonDeclarations(
  lines: string[],
): Array<{ start: number; end: number; blockKind: SourceBlock["blockKind"] }> {
  const starts: Array<{
    index: number;
    indent: number;
    kind: SourceBlock["blockKind"];
  }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)(?:(?:async\s+)?def|class)\s+\w+/.exec(lines[index]);
    if (!match) continue;
    let start = index;
    while (start > 0 && /^\s*@/.test(lines[start - 1])) start -= 1;
    starts.push({
      index: start,
      indent: match[1].length,
      kind: /(?:test|spec)/i.test(lines[index]) ? "test" : "declaration",
    });
  }

  return starts.map((entry, index) => {
    let end = lines.length - 1;
    for (let cursor = index + 1; cursor < starts.length; cursor += 1) {
      if (starts[cursor].indent <= entry.indent) {
        end = starts[cursor].index - 1;
        break;
      }
    }
    while (end > entry.index && lines[end].trim() === "") end -= 1;
    return { start: entry.index, end, blockKind: entry.kind };
  });
}

function findBraceDeclarations(
  lines: string[],
  defaultKind: "declaration" | "test" | "rule",
): Array<{ start: number; end: number; blockKind: SourceBlock["blockKind"] }> {
  const ranges: Array<{
    start: number;
    end: number;
    blockKind: SourceBlock["blockKind"];
  }> = [];
  const declarationStart =
    /^\s*(?:(?:export|default|public|private|protected|static|async|abstract|declare)\s+)*(?:function|class|interface|enum|type|const|let|var|def|func|fn|struct|impl|trait|record|namespace)\b|^\s*(?:it|test|describe)\s*\(/;
  const testStart = /^\s*(?:it|test)\s*\(/;
  const cssStart = /^\s*[^@/].*\{\s*(?:\/\*.*\*\/\s*)?$/;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const looksLikeStart =
      defaultKind === "rule"
        ? cssStart.test(line)
        : declarationStart.test(line);
    if (!looksLikeStart) continue;

    const start = includeLeadingComments(lines, index);
    const blockEnd = findBalancedBlockEnd(lines, index);
    if (blockEnd === null) {
      const semicolonEnd = findStatementEnd(lines, index);
      if (semicolonEnd !== null) {
        ranges.push({ start, end: semicolonEnd, blockKind: defaultKind });
      }
      continue;
    }

    const end = blockEnd;
    const kind = testStart.test(line) ? "test" : defaultKind;
    ranges.push({ start, end, blockKind: kind });
    index = Math.max(index, blockEnd);
  }

  return ranges;
}

function includeLeadingComments(lines: string[], index: number): number {
  let start = index;
  let included = 0;
  while (start > 0 && included < 6) {
    const previous = lines[start - 1].trim();
    if (/^(?:\/\/|\*|\/\*|\*\/|#)/.test(previous)) {
      start -= 1;
      included += 1;
      continue;
    }
    break;
  }
  return start;
}

function findStatementEnd(lines: string[], start: number): number | null {
  for (let index = start; index < lines.length; index += 1) {
    if (lines[index].trimEnd().endsWith(";")) return index;
    if (index > start && lines[index].trim() === "") return index - 1;
  }
  return start < lines.length ? lines.length - 1 : null;
}

function findBalancedBlockEnd(
  lines: string[],
  startLine: number,
): number | null {
  let depth = 0;
  let sawOpen = false;
  let state:
    | "normal"
    | "single"
    | "double"
    | "template"
    | "line-comment"
    | "block-comment" = "normal";
  let escaped = false;

  for (let lineIndex = startLine; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    for (let column = 0; column < line.length; column += 1) {
      const character = line[column];
      const next = line[column + 1];

      if (state === "line-comment") break;
      if (state === "block-comment") {
        if (character === "*" && next === "/") {
          state = "normal";
          column += 1;
        }
        continue;
      }
      if (state === "single" || state === "double" || state === "template") {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (character === "\\") {
          escaped = true;
          continue;
        }
        if (
          (state === "single" && character === "'") ||
          (state === "double" && character === '"') ||
          (state === "template" && character === "`")
        ) {
          state = "normal";
        }
        continue;
      }

      if (character === "/" && next === "/") {
        state = "line-comment";
        break;
      }
      if (character === "/" && next === "*") {
        state = "block-comment";
        column += 1;
        continue;
      }
      if (character === "'") state = "single";
      else if (character === '"') state = "double";
      else if (character === "`") state = "template";
      else if (character === "{") {
        sawOpen = true;
        depth += 1;
      } else if (character === "}" && sawOpen) {
        depth -= 1;
        if (depth === 0) return lineIndex;
      }
    }
    if ((state as string) === "line-comment") state = "normal";
  }
  return null;
}
