import type { RepositoryExtractionModelInput } from "./repository-extraction";

const INITIAL_SOURCE_CHARACTERS = 12_000;

/** Keep a broad initial view; the remainder is an ID-only catalog of already consented evidence. */
export function initialRepositoryContext(
  full: RepositoryExtractionModelInput,
): RepositoryExtractionModelInput {
  if (
    full.evidence.reduce((sum, e) => sum + e.excerpt.length, 0) <=
    INITIAL_SOURCE_CHARACTERS
  )
    return full;
  const ordered = [...full.evidence].sort(
    (a, b) =>
      priority(a.path) - priority(b.path) ||
      a.excerpt.length - b.excerpt.length ||
      a.id.localeCompare(b.id),
  );
  const selected: typeof full.evidence = [];
  const paths = new Set<string>();
  let used = 0;
  for (const distinctPaths of [true, false]) {
    for (const evidence of ordered) {
      if (
        selected.includes(evidence) ||
        (distinctPaths && paths.has(evidence.path)) ||
        used + evidence.excerpt.length > INITIAL_SOURCE_CHARACTERS
      )
        continue;
      selected.push(evidence);
      paths.add(evidence.path);
      used += evidence.excerpt.length;
    }
  }
  const selectedIds = new Set(selected.map((e) => e.id));
  return {
    ...full,
    evidence: selected,
    availableEvidence: full.evidence
      .filter((e) => !selectedIds.has(e.id))
      .map((e) => ({
        id: e.id,
        path: e.path,
        category: /\b(?:test|spec)\b/.test(e.path) ? "verification" : "source",
      })),
    finalAttempt: false,
  };
}

export function expandRepositoryContext(
  current: RepositoryExtractionModelInput,
  full: RepositoryExtractionModelInput,
  ids: string[],
): RepositoryExtractionModelInput {
  const wanted = new Set([...current.evidence.map((e) => e.id), ...ids]);
  return {
    ...full,
    evidence: full.evidence.filter((e) => wanted.has(e.id)),
    availableEvidence: [],
    finalAttempt: true,
  };
}

function priority(path: string): number {
  if (/(?:^|\/)readme\./i.test(path)) return 0;
  if (/(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\./.test(path))
    return 3;
  if (/\.(?:md|json|ya?ml)$/.test(path)) return 2;
  return 1;
}
