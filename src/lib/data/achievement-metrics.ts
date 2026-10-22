import type { Metric } from "../schemas/resume-data";

/**
 * A unit that opens with a symbol belongs to the number.
 *
 * "28%" reads as one figure and "28 ms" needs a space in front of the unit.
 * The stored value and unit are never rewritten, only the space between them
 * is decided.
 */
const symbolUnit = /^[\p{S}\p{P}]/u;

/**
 * A currency symbol is written in front of the number.
 *
 * The unit is stored apart from the value, so "$" has to find its own place
 * to read as the amount it names.
 */
const currencyUnit = /^[$€£¥₹₽]$/u;

export type FormattedMetricValue = {
  /** The number, exactly as it is stored. */
  value: string;
  /** The unit, exactly as it is stored, or null when the metric has none. */
  unit: string | null;
  /** The text that belongs in front of the number. */
  prefix: string;
  /** The text that belongs behind the number. */
  suffix: string;
  /** The number and the unit written the way they read together. */
  text: string;
};

/**
 * Prepares a metric value and its unit for display.
 *
 * The formatter never changes what a metric says: it only trims the padding
 * around the stored text and works out where the unit belongs.
 */
export function formatMetricValue(
  metric: Pick<Metric, "value" | "unit">,
): FormattedMetricValue {
  const value = metric.value.trim();
  const unit = metric.unit?.trim();

  if (!unit) {
    return { value, unit: null, prefix: "", suffix: "", text: value };
  }

  if (currencyUnit.test(unit)) {
    return { value, unit, prefix: unit, suffix: "", text: `${unit}${value}` };
  }

  const suffix = symbolUnit.test(unit) ? unit : ` ${unit}`;

  return { value, unit, prefix: "", suffix, text: `${value}${suffix}` };
}
