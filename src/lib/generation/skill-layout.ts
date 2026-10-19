export type SkillMeasurements = {
  widths: Record<string, number>;
  labelWidths: [number, number];
  separatorWidth: number;
  lineWidth: number;
  source: "latex";
  glyphWidths?: Record<string, number>;
  unsupportedSkillIds?: string[];
};

export type SkillPlacement = {
  rows: [string[], string[]];
  used: [number, number];
  capacity: [number, number];
};

/** Widths are measured with the template's LaTeX font, in PDF points. */
export function placeSkills(
  ids: string[],
  measurements: SkillMeasurements,
): SkillPlacement | null {
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => !Number.isFinite(measurements.widths[id]))
  )
    return null;
  const capacity: [number, number] = [
    measurements.lineWidth - measurements.labelWidths[0],
    measurements.lineWidth - measurements.labelWidths[1],
  ];
  const widths = ids.map((id) => measurements.widths[id]);
  const separator = measurements.separatorWidth;
  const makePlacement = (rows: [string[], string[]]): SkillPlacement => ({
    rows,
    capacity,
    used: rows.map(
      (row) =>
        row.reduce((sum, id) => sum + measurements.widths[id], 0) +
        Math.max(0, row.length - 1) * separator,
    ) as [number, number],
  });
  const greedy: [string[], string[]] = [[], []];
  const used = [0, 0];
  let greedyFits = true;
  for (const [index, id] of ids.entries()) {
    const row = [0, 1].find(
      (line) =>
        used[line] + widths[index] + (greedy[line].length ? separator : 0) <=
        capacity[line],
    );
    if (row === undefined) {
      greedyFits = false;
      break;
    }
    used[row] += widths[index] + (greedy[row].length ? separator : 0);
    greedy[row].push(id);
  }
  if (greedyFits) return makePlacement(greedy);

  // Two-bin partitioning, rounded conservatively to tenths of a point.
  const weights = widths.map((width) => Math.ceil((width + separator) * 10));
  const caps = capacity.map((width) => Math.floor((width + separator) * 10));
  const total = weights.reduce((sum, width) => sum + width, 0);
  if (total > caps[0] + caps[1]) return null;
  const previous = new Int32Array(caps[0] + 1).fill(-1);
  const chosen = new Int32Array(caps[0] + 1).fill(-1);
  previous[0] = 0;
  for (const [index, width] of weights.entries()) {
    for (let sum = caps[0]; sum >= width; sum -= 1) {
      if (previous[sum] < 0 && previous[sum - width] >= 0) {
        previous[sum] = sum - width;
        chosen[sum] = index;
      }
    }
  }
  let sum = caps[0];
  while (sum >= Math.max(0, total - caps[1]) && previous[sum] < 0) sum -= 1;
  if (sum < Math.max(0, total - caps[1])) return null;
  const first = new Set<number>();
  while (sum > 0) {
    first.add(chosen[sum]);
    sum = previous[sum];
  }
  return makePlacement([
    ids.filter((_, index) => first.has(index)),
    ids.filter((_, index) => !first.has(index)),
  ]);
}

export function estimateBulletLines(
  text: string,
  measurements: SkillMeasurements | null,
): number | null {
  if (!measurements?.glyphWidths) return null;
  const glyphs = measurements.glyphWidths;
  const width = (value: string) =>
    [...value].reduce(
      (sum, character) =>
        sum + (glyphs[character] ?? glyphs.x ?? 4.5) * (10 / 9),
      0,
    );
  const available = measurements.lineWidth - 0.17 * 72;
  let lines = 1;
  let occupied = 0;
  for (const word of text.trim().split(/\s+/)) {
    const next = width(word);
    const space = occupied ? width(" ") : 0;
    if (occupied && occupied + space + next > available) {
      lines += 1;
      occupied = next;
    } else occupied += space + next;
    while (occupied > available) {
      lines += 1;
      occupied -= available;
    }
  }
  return lines;
}
