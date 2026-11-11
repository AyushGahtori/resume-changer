/**
 * The generated resume leads with a role that is explicitly current, then
 * dated roles by the latest start month. Unknown dates follow dated entries.
 * Equal keys keep the library's insertion order.
 */
export type DatedExperience = {
  startDate?: string;
  endDate?: string | null;
};

function experienceRank(item: DatedExperience) {
  if (item.endDate === null) return 0;
  if (item.startDate || typeof item.endDate === "string") return 1;
  return 2;
}

export function compareResumeExperience(
  left: DatedExperience,
  right: DatedExperience,
): number {
  const rank = experienceRank(left) - experienceRank(right);
  if (rank !== 0 || experienceRank(left) === 2) return rank;
  const leftStart = left.startDate ?? "";
  const rightStart = right.startDate ?? "";
  if (leftStart === rightStart) return 0;
  if (!leftStart) return 1;
  if (!rightStart) return -1;
  return rightStart.localeCompare(leftStart);
}

export function orderExperiencesForResume<T extends DatedExperience>(
  experiences: readonly T[],
): T[] {
  return [...experiences].sort(compareResumeExperience);
}
