/**
 * The colour maths a contrast check needs.
 *
 * The helpers read the colour the browser actually paints, so a check runs
 * against the rendered surface rather than against a token on its own.
 */
export function parseColor(value: string): [number, number, number] {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) throw new Error(`Unsupported color value: ${value}`);
  const [red, green, blue] = match[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  return [red, green, blue];
}

export function relativeLuminance([red, green, blue]: [
  number,
  number,
  number,
]) {
  const channel = (value: number) => {
    const srgb = value / 255;
    return srgb <= 0.03928
      ? srgb / 12.92
      : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
  );
}

export function contrastRatio(foreground: string, background: string) {
  const first = relativeLuminance(parseColor(foreground));
  const second = relativeLuminance(parseColor(background));
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}
