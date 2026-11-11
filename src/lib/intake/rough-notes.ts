/**
 * Turns a pasted block of rough notes into reviewable achievement texts.
 * Saving those texts is the caller's job.
 */

const LEADING_BULLET = /^([-*•–—])(\s*)([\s\S]*)$/;
const LEADING_NUMBER = /^(\d+)([.)])(\s*)([\s\S]*)$/;
const STABLE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type AchievementNoteDraft = {
  id: string;
  text: string;
  tags: string[];
  skillIds: string[];
  metrics: [];
  source: { type: "direct-user" };
  enabled: true;
  githubEvidence: null;
};

/**
 * Splits pasted notes on line breaks and blank lines.
 * One leading list marker is removed from each line. Metrics, dates, and
 * tool names stay as written.
 */
export function splitRoughNotes(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (!normalized.includes("\n")) {
    const paragraph = stripOneLeadingMarker(normalized);
    return paragraph ? [paragraph] : [];
  }

  const notes: string[] = [];
  for (const line of normalized.split("\n")) {
    const trimmed = stripOneLeadingMarker(line);
    if (trimmed) notes.push(trimmed);
  }
  return notes;
}

/**
 * Joins notes[index] with the next note using one space.
 * An index that has no following note leaves the list unchanged.
 */
export function mergeNotes(notes: string[], index: number): string[] {
  if (!Number.isInteger(index) || index < 0 || index + 1 >= notes.length) {
    return notes;
  }
  return [
    ...notes.slice(0, index),
    `${notes[index]} ${notes[index + 1]}`,
    ...notes.slice(index + 2),
  ];
}

/**
 * Splits notes[index] at the first ". " that still leaves text after it.
 * A note with no such boundary is returned unchanged.
 */
export function splitNote(notes: string[], index: number): string[] {
  if (!Number.isInteger(index) || index < 0 || index >= notes.length) {
    return notes;
  }
  const note = notes[index] ?? "";
  const boundary = firstSentenceBoundary(note);
  if (boundary < 0) return notes;
  const left = note.slice(0, boundary + 1).trim();
  const right = note.slice(boundary + 2).trim();
  if (!left || !right) return notes;
  return [...notes.slice(0, index), left, right, ...notes.slice(index + 1)];
}

/** Builds unsaved achievement points. Ids avoid usedIds and the rest of the batch. */
export function achievementDrafts(
  notes: string[],
  usedIds: Set<string>,
): AchievementNoteDraft[] {
  const used = new Set(usedIds);
  return notes.map((text) => {
    const id = uniqueNoteId(text, used);
    used.add(id);
    const draft: AchievementNoteDraft = {
      id,
      text,
      tags: [],
      skillIds: [],
      metrics: [],
      source: { type: "direct-user" },
      enabled: true,
      githubEvidence: null,
    };
    return draft;
  });
}

function stripOneLeadingMarker(line: string): string {
  const body = line.trimStart();
  if (!body) return "";

  const numbered = body.match(LEADING_NUMBER);
  if (numbered) {
    const delimiter = numbered[2] ?? "";
    const spacing = numbered[3] ?? "";
    const rest = numbered[4] ?? "";
    const decimalWithoutSpace =
      delimiter === "." && spacing.length === 0 && rest.length > 0;
    if (!decimalWithoutSpace) return rest.trim();
  }

  const bullet = body.match(LEADING_BULLET);
  if (bullet) {
    const marker = bullet[1] ?? "";
    const spacing = bullet[2] ?? "";
    const rest = bullet[3] ?? "";
    const hyphenLike = marker === "-" || marker === "–" || marker === "—";
    if (hyphenLike && spacing.length === 0 && /^\d/.test(rest)) {
      return body.trim();
    }
    return rest.trim();
  }

  return body.trim();
}

function firstSentenceBoundary(note: string): number {
  let from = 0;
  while (from < note.length) {
    const found = note.indexOf(". ", from);
    if (found < 0) return -1;
    if (note.slice(found + 2).trim()) return found;
    from = found + 2;
  }
  return -1;
}

function noteSlug(text: string): string {
  const words = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, 6);
  const slug = words.join("-").slice(0, 48).replace(/-+$/g, "");
  return slug || "note";
}

function uniqueNoteId(text: string, used: Set<string>): string {
  const root = `achievement-note-${noteSlug(text)}`;
  if (!used.has(root) && STABLE_ID.test(root)) return root;
  for (let suffix = 2; suffix < 10000; suffix += 1) {
    const candidate = `${root}-${suffix}`;
    if (!used.has(candidate) && STABLE_ID.test(candidate)) return candidate;
  }
  const fallback = `${root}-${used.size + 1}`;
  return STABLE_ID.test(fallback) ? fallback : "achievement-note-note";
}
