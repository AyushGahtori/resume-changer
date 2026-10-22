/**
 * Section and category counts are rendered next to their label, so the
 * singular and plural forms have to agree with the number that is shown.
 */
export function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}
