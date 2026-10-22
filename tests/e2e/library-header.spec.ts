import { expect, test } from "@playwright/test";

type Rgb = readonly [number, number, number];

function parseCssColor(color: string): Rgb {
  const normalized = color.trim();
  const hexMatch = normalized.match(/^#([\da-f]{3}|[\da-f]{6})$/i);

  if (hexMatch) {
    const hex =
      hexMatch[1].length === 3
        ? [...hexMatch[1]].map((digit) => digit + digit).join("")
        : hexMatch[1];
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }

  const rgbMatch = normalized.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgbMatch) {
    return [
      Number.parseInt(rgbMatch[1], 10),
      Number.parseInt(rgbMatch[2], 10),
      Number.parseInt(rgbMatch[3], 10),
    ];
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

type HeaderLayout = {
  canvas: string;
  documentWidth: number;
  eyebrowBottom: number;
  eyebrowColor: string;
  eyebrowFontSize: string;
  eyebrowFontWeight: string;
  eyebrowLineHeight: string;
  introBottom: number;
  introColor: string;
  introFontSize: string;
  introLineHeight: string;
  introText: string;
  introTop: number;
  isMobile: boolean;
  orange: string;
  secondary: string;
  titleBottom: number;
  titleFontFamily: string;
  titleFontSize: string;
  titleFontWeight: string;
  titleLineHeight: string;
  titleRight: number;
  titleTop: number;
  viewportWidth: number;
};

async function readHeaderLayout(page: import("@playwright/test").Page) {
  return page.evaluate<HeaderLayout>(() => {
    const read = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return { element, style, rect };
    };

    const root = getComputedStyle(document.documentElement);
    const eyebrow = read(".library-heading .eyebrow");
    const title = read(".library-heading h1");
    const intro = read(".library-heading .page-intro");

    return {
      canvas: root.getPropertyValue("--color-canvas").trim(),
      documentWidth: document.documentElement.scrollWidth,
      eyebrowBottom: eyebrow.rect.bottom,
      eyebrowColor: eyebrow.style.color,
      eyebrowFontSize: eyebrow.style.fontSize,
      eyebrowFontWeight: eyebrow.style.fontWeight,
      eyebrowLineHeight: eyebrow.style.lineHeight,
      introBottom: intro.rect.bottom,
      introColor: intro.style.color,
      introFontSize: intro.style.fontSize,
      introLineHeight: intro.style.lineHeight,
      introText: intro.element.textContent?.trim() ?? "",
      introTop: intro.rect.top,
      isMobile: window.innerWidth <= 700,
      orange: root.getPropertyValue("--color-orange-strong").trim(),
      secondary: root.getPropertyValue("--color-text-secondary").trim(),
      titleBottom: title.rect.bottom,
      titleFontFamily: title.style.fontFamily,
      titleFontSize: title.style.fontSize,
      titleFontWeight: title.style.fontWeight,
      titleLineHeight: title.style.lineHeight,
      titleRight: title.rect.right,
      titleTop: title.rect.top,
      viewportWidth: window.innerWidth,
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/library?source=demo");
  // The shell sets the theme attribute after it hydrates.
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    /^(light|dark)$/,
  );
});

test("shows one library title with the eyebrow, supporting line, and breadcrumb", async ({
  page,
}) => {
  const heading = page.locator(".library-heading");

  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(
    page.getByRole("heading", { level: 1, name: "Achievement library" }),
  ).toBeVisible();
  await expect(heading.locator(".eyebrow")).toHaveText("YOUR EXPERIENCE");
  await expect(heading.locator(".page-intro")).toHaveText(
    "Browse the resume information saved in this workspace.",
  );

  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumb).toContainText("Workspace");
  await expect(
    breadcrumb.locator('[aria-current="page"]'),
  ).toHaveText("Achievement library");

  // The poster headline and the shell brand are not part of the page header.
  await expect(page.getByText("Achievement Library UI Kit")).toHaveCount(0);
  await expect(heading).not.toContainText("Resume Changer");
});

test("keeps the header type scale, spacing, and alignment in both themes", async ({
  page,
}) => {
  for (const theme of ["light", "dark"] as const) {
    const currentTheme = await page
      .locator("html")
      .getAttribute("data-theme");
    if (currentTheme !== theme) {
      await page
        .getByRole("button", { name: "Switch to " + theme + " mode" })
        .click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    }

    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await readHeaderLayout(page);

      expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
      expect(layout.eyebrowFontSize).toBe("12px");
      expect(layout.eyebrowLineHeight).toBe("16px");
      expect(layout.eyebrowFontWeight).toBe("600");
      expect(layout.titleFontFamily).toContain("Georgia");
      expect(layout.titleFontSize).toBe(width <= 700 ? "32px" : "40px");
      expect(layout.titleLineHeight).toBe(width <= 700 ? "40px" : "48px");
      expect(layout.titleFontWeight).toBe("700");
      expect(layout.introFontSize).toBe("16px");
      expect(layout.introLineHeight).toBe("24px");
      expect(layout.titleRight).toBeLessThanOrEqual(width);

      // The eyebrow sits above the title, and the title above the summary line.
      expect(layout.eyebrowBottom).toBeLessThanOrEqual(layout.titleTop);
      expect(layout.titleBottom).toBeLessThanOrEqual(layout.introTop);

      expect(parseCssColor(layout.eyebrowColor)).toEqual(
        parseCssColor(layout.orange),
      );
      expect(parseCssColor(layout.introColor)).toEqual(
        parseCssColor(layout.secondary),
      );
      expect(
        contrastRatio(
          parseCssColor(layout.eyebrowColor),
          parseCssColor(layout.canvas),
        ),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(
          parseCssColor(layout.introColor),
          parseCssColor(layout.canvas),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("places the heading on the left and the controls on the right, stacking on small screens", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/library");

  const readPlacement = () =>
    page.evaluate(() => {
      const copy = document
        .querySelector(".library-heading-copy")!
        .getBoundingClientRect();
      const controls = document
        .querySelector(".library-header-controls")!
        .getBoundingClientRect();
      return {
        copyBottom: copy.bottom,
        copyRight: copy.right,
        copyTop: copy.top,
        controlsLeft: controls.left,
        controlsRight: controls.right,
        controlsTop: controls.top,
        viewportWidth: window.innerWidth,
      };
    });

  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    const desktop = await readPlacement();

    // Heading on the left, source and creation controls on the right.
    expect(desktop.copyRight).toBeLessThanOrEqual(desktop.controlsLeft);
    expect(desktop.controlsRight).toBeLessThanOrEqual(desktop.viewportWidth);
    expect(desktop.controlsTop).toBeLessThanOrEqual(desktop.copyTop + 1);
  }

  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const stacked = await readPlacement();

    // The controls stack below the heading without changing their order.
    expect(stacked.controlsTop).toBeGreaterThanOrEqual(stacked.copyBottom);
    expect(stacked.controlsLeft).toBeLessThanOrEqual(stacked.viewportWidth);
  }
});

test("keeps the source and creation controls visible at desktop and mobile widths", async ({
  page,
}) => {
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 740 });
    await page.goto("/library");

    await expect(page.getByRole("link", { name: "My data" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Demo data" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Detailed entry" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add achievement" }),
    ).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(
      dimensions.viewportWidth,
    );
  }
});

test("leaves the library summary visible in the first desktop fold", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/library");

  await expect(page.locator(".library-overview")).toBeInViewport();
});
