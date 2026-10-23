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

/**
 * Returns the color as a canonical six-digit hex string.
 *
 * The token value is compared as a resolved color rather than as source
 * text, because a production build may rewrite `#ffffff` as `#fff`. The
 * applied color is the behavior under test; its spelling is not.
 */
function normalizeCssColor(color: string): string {
  const { channels } = parseCssColor(color);
  return (
    "#" +
    channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")
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
        surfaceHover: token("--color-surface-hover"),
        textPrimary: token("--color-text-primary"),
        textSecondary: token("--color-text-secondary"),
        textMuted: token("--color-text-muted"),
        border: token("--color-border"),
        borderStrong: token("--color-border-strong"),
        violet: token("--color-violet"),
        violetLight: token("--color-violet-light"),
        violetSubtle: token("--color-violet-subtle"),
        orange: token("--color-orange"),
        orangeLight: token("--color-orange-light"),
        orangeSubtle: token("--color-orange-subtle"),
        orangeStrong: token("--color-orange-strong"),
        success: token("--color-success"),
        warning: token("--color-warning"),
        error: token("--color-error"),
        info: token("--color-info"),
        focus: token("--color-focus-ring"),
        categoryJob: token("--color-category-job"),
        categoryProject: token("--color-category-project"),
        categoryPoints: token("--color-category-points"),
        categorySkills: token("--color-category-skills"),
        categoryCredentials: token("--color-category-credentials"),
      };
    });

  const normalized = async () => {
    const tokens = await palette();
    return Object.fromEntries(
      Object.entries(tokens).map(([name, value]) => [
        name,
        normalizeCssColor(value),
      ]),
    );
  };

  expect(await normalized()).toMatchObject({
    canvas: "#f8fafc",
    sidebar: "#fafbfd",
    surface: "#ffffff",
    surfaceAlt: "#f1f5f9",
    surfaceHover: "#e8eef5",
    textPrimary: "#0f172a",
    textSecondary: "#334155",
    textMuted: "#64748b",
    border: "#cbd5e1",
    borderStrong: "#94a3b8",
    violet: "#7c3aed",
    violetLight: "#a78bfa",
    violetSubtle: "#efebff",
    orange: "#ff7a45",
    orangeLight: "#fdba74",
    orangeSubtle: "#ffe9e0",
    orangeStrong: "#b23c0c",
    success: "#10b981",
    warning: "#f59e0b",
    error: "#ef4444",
    info: "#3b82f6",
    focus: "#7c3aed",
    categoryJob: "#ff7a45",
    categoryProject: "#7c3aed",
    categoryPoints: "#f59e0b",
    categorySkills: "#10b981",
    categoryCredentials: "#4f46e5",
  });

  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  expect(await normalized()).toMatchObject({
    canvas: "#151522",
    sidebar: "#0f1220",
    surface: "#17192d",
    surfaceAlt: "#202238",
    surfaceHover: "#2a2c46",
    textPrimary: "#f8fafc",
    textSecondary: "#c4c8d8",
    textMuted: "#9ba2b8",
    border: "#34374f",
    borderStrong: "#464a6b",
    violet: "#7c3aed",
    violetLight: "#a78bfa",
    violetSubtle: "#302342",
    orange: "#ff7a45",
    orangeLight: "#fdba74",
    orangeSubtle: "#40251f",
    orangeStrong: "#fdba74",
    success: "#34d399",
    warning: "#fbbf24",
    error: "#f87171",
    info: "#60a5fa",
    focus: "#a78bfa",
    categoryJob: "#ff7a45",
    categoryProject: "#a78bfa",
    categoryPoints: "#fbbf24",
    categorySkills: "#34d399",
    categoryCredentials: "#818cf8",
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
    expect(appearance.outlineWidth).toBe("2px");
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
  await expect(saveButton).toHaveCSS("background-color", "rgb(255, 122, 69)");
  const lightColors = await saveButton.evaluate((button) => {
    const style = getComputedStyle(button);
    return { backgroundColor: style.backgroundColor, color: style.color };
  });
  expect(lightColors).toEqual({
    backgroundColor: "rgb(255, 122, 69)",
    color: "rgb(15, 23, 42)",
  });
  await focusAppearance();

  await saveButton.hover();
  await expect(saveButton).toHaveCSS("background-color", "rgb(178, 60, 12)");
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
  await expect(saveButton).toHaveCSS("color", "rgb(21, 21, 34)");
  await expect(saveButton).toHaveCSS("background-color", "rgb(255, 122, 69)");
  const darkColors = await saveButton.evaluate((button) => {
    const style = getComputedStyle(button);
    return { backgroundColor: style.backgroundColor, color: style.color };
  });
  expect(darkColors).toEqual({
    backgroundColor: "rgb(255, 122, 69)",
    color: "rgb(21, 21, 34)",
  });
  await focusAppearance();
});

test("the achievement library renders from the same shared tokens", async ({
  page,
}) => {
  await page.goto("/library?source=demo");
  await expect(
    page.getByRole("heading", { name: "Jordan Example" }),
  ).toBeVisible();

  const libraryColors = async () =>
    page.evaluate(() => {
      const rootStyle = getComputedStyle(document.documentElement);
      const token = (name: string) => rootStyle.getPropertyValue(name).trim();
      const read = (selector: string) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const style = getComputedStyle(node);
        return {
          color: style.color,
          backgroundColor: style.backgroundColor,
          borderTopColor: style.borderTopColor,
        };
      };

      return {
        tokens: {
          canvas: token("--color-canvas"),
          surface: token("--color-surface"),
          surfaceAlt: token("--color-surface-alt"),
          border: token("--color-border"),
          textPrimary: token("--color-text-primary"),
          textSecondary: token("--color-text-secondary"),
          orange: token("--color-orange"),
          orangeStrong: token("--color-orange-strong"),
        },
        pageBackground: getComputedStyle(document.body).backgroundColor,
        overview: read(".library-overview"),
        sourceSwitch: read(".library-source-switch"),
        selectedSource: read('.library-source-switch a[aria-current="page"]'),
        eyebrow: read(".library-heading .eyebrow"),
      };
    });

  // The theme switch animates the surfaces, so a color is only comparable to
  // its token once the transition has settled on the final value.
  const expectColorToSettle = async (
    read: () => Promise<string | null>,
    token: string,
  ) => {
    await expect
      .poll(async () => {
        const value = await read();
        return value === null ? null : normalizeCssColor(value);
      })
      .toBe(normalizeCssColor(token));
  };

  const light = await libraryColors();

  // Every library surface resolves to the shared token, not a local palette.
  expect(normalizeCssColor(light.pageBackground)).toBe(
    normalizeCssColor(light.tokens.canvas),
  );
  expect(normalizeCssColor(light.overview!.backgroundColor)).toBe(
    normalizeCssColor(light.tokens.surface),
  );
  expect(normalizeCssColor(light.overview!.borderTopColor)).toBe(
    normalizeCssColor(light.tokens.border),
  );
  expect(normalizeCssColor(light.sourceSwitch!.backgroundColor)).toBe(
    normalizeCssColor(light.tokens.surfaceAlt),
  );
  expect(normalizeCssColor(light.selectedSource!.color)).toBe(
    normalizeCssColor(light.tokens.textPrimary),
  );
  expect(normalizeCssColor(light.eyebrow!.color)).toBe(
    normalizeCssColor(light.tokens.orangeStrong),
  );

  // The library eyebrow is a small orange label, so it must stay readable.
  expect(
    contrastRatio(
      parseCssColor(light.eyebrow!.color).channels,
      parseCssColor(light.pageBackground).channels,
    ),
  ).toBeGreaterThanOrEqual(4.5);

  await page.getByRole("button", { name: "Switch to dark mode" }).click();

  const darkTokens = (await libraryColors()).tokens;

  await expectColorToSettle(
    async () => (await libraryColors()).pageBackground,
    darkTokens.canvas,
  );
  await expectColorToSettle(
    async () => (await libraryColors()).overview?.backgroundColor ?? null,
    darkTokens.surface,
  );
  await expectColorToSettle(
    async () => (await libraryColors()).sourceSwitch?.backgroundColor ?? null,
    darkTokens.surface,
  );
  await expectColorToSettle(
    async () => (await libraryColors()).overview?.borderTopColor ?? null,
    darkTokens.border,
  );
  await expectColorToSettle(
    async () => (await libraryColors()).eyebrow?.color ?? null,
    darkTokens.orangeStrong,
  );

  const dark = await libraryColors();

  expect(normalizeCssColor(dark.overview!.backgroundColor)).toBe(
    normalizeCssColor(dark.tokens.surface),
  );
  expect(normalizeCssColor(dark.sourceSwitch!.backgroundColor)).toBe(
    normalizeCssColor(dark.tokens.surface),
  );
  expect(normalizeCssColor(dark.overview!.borderTopColor)).toBe(
    normalizeCssColor(dark.tokens.border),
  );
  expect(normalizeCssColor(dark.eyebrow!.color)).toBe(
    normalizeCssColor(dark.tokens.orangeStrong),
  );
  expect(
    contrastRatio(
      parseCssColor(dark.eyebrow!.color).channels,
      parseCssColor(dark.pageBackground).channels,
    ),
  ).toBeGreaterThanOrEqual(4.5);
});
