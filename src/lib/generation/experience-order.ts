/**
 * The generated resume leads with a role that is still current, then the
 * latest start date. Resume Studio uses the same order so the editor matches
 * the Experience section.
 */
export type DatedExperience = {
  startDate: string;
  endDate: string | null;
};

export function compareResumeExperience(
  left: DatedExperience,
  right: DatedExperience,
): number {
  return (
    Number(right.endDate === null) - Number(left.endDate === null) ||
    right.startDate.localeCompare(left.startDate)
  );
}

export function orderExperiencesForResume<T extends DatedExperience>(
  experiences: readonly T[],
): T[] {
  return [...experiences].sort(compareResumeExperience);
}
