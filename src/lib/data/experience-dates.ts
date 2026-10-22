/**
 * Date helpers for the Achievement Library group headers.
 *
 * The library stores dates as `YYYY-MM`. The headers present a month and a
 * year in the same readable form the generated resume uses, and they only
 * say "Present" when the stored end date is actually null. An absent or
 * malformed end date is an unknown end, not an ongoing role, so it is
 * never presented as "Present".
 */

const YEAR_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export type FormattedMonth = {
  /** The stored `YYYY-MM` value, used for a `datetime` attribute. */
  value: string;
  /** The visible month and year, for example `Jan 2023`. */
  label: string;
};

export type ExperienceRange = {
  /** The start month, or null when the source has no usable start date. */
  start: FormattedMonth | null;
  /** The end month, or null when the source has no usable end date. */
  end: FormattedMonth | null;
  /** True only when the stored end date is null. */
  present: boolean;
};

/**
 * Formats a stored `YYYY-MM` value as a month and a year.
 *
 * A value that is not a usable `YYYY-MM` string returns null, so a
 * malformed date is treated as absent rather than rendered as nonsense.
 */
export function formatMonth(value: unknown): FormattedMonth | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = YEAR_MONTH.exec(trimmed);
  if (!match) return null;
  const [, year, month] = match;
  return {
    value: trimmed,
    label: `${MONTH_NAMES[Number(month) - 1]} ${year}`,
  };
}

/**
 * Formats the date range of a job or a project.
 *
 * Returns null when the source holds no usable date at all, so the header
 * can omit the range instead of showing an empty one.
 */
export function formatExperienceRange(
  startDate?: string | null,
  endDate?: string | null,
): ExperienceRange | null {
  const start = formatMonth(startDate);
  const end = formatMonth(endDate);
  const present = endDate === null;
  if (!start && !end && !present) return null;
  return { start, end, present };
}
