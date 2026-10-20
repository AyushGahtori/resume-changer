import { expect, test } from "@playwright/test";

type Rgb = readonly [number, number, number];
type Rgba = { channels: Rgb; alpha: number };

function parseCssColor(color: string): Rgba {
  const normalized = color.trim();
  const hexMatch = normalized.match(/^#([\da-f]{3}|[\da-f]{6})$/i);

  if (hexMatch) {
    const hex =
      hexMatch[1].length === 3
        ? [...hexMatch[1]].map((digit) => digit + digit).join("")
        : hexMatch[1];
    return {
      channels: [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16),
      ],
      alpha: 1,
    };
  }

  const rgbMatch = normalized.match(/^rgba?\(([^)]+)\)$/i);

  if (rgbMatch) {
    const values = rgbMatch[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);

    if (values.length >= 3 && values.slice(0, 3).every(Number.isFinite)) {
      return {
        channels: [values[0], values[1], values[2]],
        alpha: values[3] ?? 1,
      };
    }
  }

  throw new Error("Unsupported CSS color: " + color);
}

function relativeLuminance([red, green, blue]: Rgb) {
  const linearize = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };

  return (
    0.2126 * linearize(red) +
    0.7152 * linearize(green) +
    0.0722 * linearize(blue)
  );
}

function contrastRatio(first: Rgb, second: Rgb) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);

  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("No saved draft");
});

test("applies shared color tokens in light and dark themes", async ({
  page,
}) => {
  const palette = () =>
    page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      const token = (name: string) => styles.getPropertyValue(name).trim();

      return {
        canvas: token("--color-canvas"),
        sidebar: token("--color-sidebar"),
        surface: token("--color-surface"),
        surfaceAlt: token("--color-surface-alt"),
        textPrimary: token("--color-text-primary"),
        textSecondary: token("--color-text-secondary"),
        border: token("--color-border"),
        violet: token("--color-violet"),
        violetLight: token("--color-violet-light"),
        violetSubtle: token("--color-violet-subtle"),
        orange: token("--color-orange"),
        orangeLight: token("--color-orange-light"),
        orangeSubtle: token("--color-orange-subtle"),
        success: token("--color-success"),
        warning: token("--color-warning"),
        error: token("--color-error"),
        info: token("--color-info"),
        focus: token("--color-focus-ring"),
      };
    });

  expect(await palette()).toMatchObject({
    canvas: "#f8fafc",
    sidebar: "#ffffff",
    surface: "#ffffff",
    surfaceAlt: "#f1f5f9",
    textPrimary: "#0f172a",
    textSecondary: "#475569",
    border: "#e2e8f0",
    violet: "#7c3aed",
    violetLight: "#a78bfa",
    violetSubtle: "#ede9fe",
    orange: "#f97316",
    orangeLight: "#fdba74",
    orangeSubtle: "#fff7ed",
    success: "#10b981",
    warning: "#f59e0b",
    error: "#ef4444",
    info: "#3b82f6",
    focus: "#7c3aed",
  });

  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  expect(await palette()).toMatchObject({
    canvas: "#171421",
    sidebar: "#14111f",
    surface: "#211d2e",
    surfaceAlt: "#2a2538",
    textPrimary: "#f8fafc",
    textSecondary: "#b7b3c7",
    border: "#3a3548",
    violet: "#7c3aed",
    violetLight: "#a78bfa",
    violetSubtle: "#322548",
    orange: "#f97316",
    orangeLight: "#fdba74",
    orangeSubtle: "#442719",
    success: "#34d399",
    warning: "#fbbf24",
    error: "#f87171",
    info: "#60a5fa",
    focus: "#a78bfa",
  });
});

test("keeps the orange save action legible and the focus ring contrasted", async ({
  page,
}) => {
  const jobDescription = page.getByRole("textbox", {
    name: "Job description",
    exact: true,
  });
  const saveButton = page.getByRole("button", { name: "Save draft" });

  const focusAppearance = async () => {
    await expect(saveButton).toBeFocused();
    const appearance = await saveButton.evaluate((button) => {
      const style = getComputedStyle(button);
      const rootStyle = getComputedStyle(document.documentElement);
      const token = (name: string) => rootStyle.getPropertyValue(name).trim();

      return {
        outlineColor: style.outlineColor,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        focusToken: token("--color-focus-ring"),
        surfaces: [
          token("--color-canvas"),
          token("--color-sidebar"),
          token("--color-surface"),
          token("--color-surface-alt"),
          token("--color-surface-hover"),
        ],
      };
    });

    expect(appearance.outlineStyle).toBe("solid");
    expect(appearance.outlineWidth).toBe("3px");
    expect(parseCssColor(appearance.outlineColor)).toEqual(
      parseCssColor(appearance.focusToken),
    );

    for (const surface of appearance.surfaces) {
      expect(
        contrastRatio(
          parseCssColor(appearance.outlineColor).channels,
          parseCssColor(surface).channels,
        ),
      ).toBeGreaterThanOrEqual(3);
    }
  };

  await jobDescription.fill("Synthetic engineering role.");
  await jobDescription.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");

  await expect(saveButton).toBeFocused();
  const lightColors = await saveButton.evaluate((button) => {
    const style = getComputedStyle(button);
    return { backgroundColor: style.backgroundColor, color: style.color };
  });
  expect(lightColors).toEqual({
    backgroundColor: "rgb(249, 115, 22)",
    color: "rgb(15, 23, 42)",
  });
  await focusAppearance();

  await saveButton.hover();
  await expect(saveButton).toHaveCSS("background-color", "rgb(194, 65, 12)");
  await expect(saveButton).toHaveCSS("color", "rgb(255, 255, 255)");

  await saveButton.click();
  await expect(page.locator(".form-save-feedback")).toContainText(
    "Draft saved in this browser.",
  );

  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await jobDescription.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");

  await expect(saveButton).toBeFocused();
  await expect(saveButton).toHaveCSS("color", "rgb(23, 20, 33)");
  const darkColors = await saveButton.evaluate((button) => {
    const style = getComputedStyle(button);
    return { backgroundColor: style.backgroundColor, color: style.color };
  });
  expect(darkColors).toEqual({
    backgroundColor: "rgb(249, 115, 22)",
    color: "rgb(23, 20, 33)",
  });
  await focusAppearance();
});
