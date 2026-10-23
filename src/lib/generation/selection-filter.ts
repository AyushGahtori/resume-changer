/**
 * The search and the experience filter over the achievement groups.
 *
 * The helper only decides what is visible. It never reads or writes the
 * selected set, so a search can never deselect evidence on its own.
 */

export type SelectionPoint = { id: string; text: string };

export type SelectionGroup = {
  id: string;
  title: string;
  subtitle: string;
  points: SelectionPoint[];
};

export type SelectionFilter = {
  query: string;
  experienceId: string;
};

/**
 * The comparison text of one achievement.
 *
 * The achievement text and the experience it belongs to are searched
 * together, so a person can look for a company as well as for a phrase.
 */
function normalize(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .trim();
}

export function matchesSelectionQuery(
  group: { title: string; subtitle: string },
  point: SelectionPoint,
  query: string,
) {
  const terms = normalize(query).split(" ").filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = normalize(
    [point.text, group.title, group.subtitle].join(" "),
  );
  return terms.every((term) => haystack.includes(term));
}

/**
 * The groups that survive the current search and experience filter.
 *
 * A group without a matching achievement is left out, so the list only
 * holds what the person asked for. The empty result is reported by the
 * caller, which also knows whether the library itself has any evidence.
 */
export function filterSelectionGroups<G extends SelectionGroup>(
  groups: G[],
  filter: SelectionFilter,
): G[] {
  const experienceId = filter.experienceId.trim();
  const query = filter.query.trim();
  const filtered = groups
    .filter((group) => !experienceId || group.id === experienceId)
    .map((group) => ({
      ...group,
      points: query
        ? group.points.filter((point) =>
            matchesSelectionQuery(group, point, query),
          )
        : group.points,
    }))
    .filter((group) => group.points.length > 0);
  // The spread above keeps every field of the group, so the result is the
  // same shape as the input; the cast only restates that for the type
  // checker.
  return filtered as G[];
}

export function countSelectionPoints<G extends SelectionGroup>(groups: G[]) {
  return groups.reduce((total, group) => total + group.points.length, 0);
}
