import { expect, test, type Page } from "@playwright/test";

/**
 * Task 04: shared surface, spacing, border, and shadow tokens.
 *
 * The checks read the resolved custom properties and the computed styles of
 * the library surfaces. A page-specific override that reintroduces a raw
 * radius, an off-scale inset, or a light-theme shadow in dark mode fails
 * here, because the resolved values are the shared design-system contract.
 */

const demoLibraryUrl = "/library?source=demo";

type Tokens = Record<string, string>;

async function readTokens(page: Page): Promise<Tokens> {
  return page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string) => styles.getPropertyValue(name).trim();

    return {
      space4: token("--space-4"),
      space8: token("--space-8"),
      space12: token("--space-12"),
      space16: token("--space-16"),
      space24: token("--space-24"),
      space32: token("--space-32"),
      space48: token("--space-48"),
      space64: token("--space-64"),
      radiusXs: token("--radius-xs"),
      radiusControl: token("--radius-control"),
      radiusCard: token("--radius-card"),
      radiusFull: token("--radius-full"),
      borderDefault: token("--border-default"),
      borderControl: token("--border-control"),
      borderStrong: token("--border-strong"),
      shadowXs: token("--shadow-xs"),
      shadowSm: token("--shadow-sm"),
    };
  });
}

type SurfaceStyle = {
  borderTopWidth: string;
  borderTopStyle: string;
  borderTopColor: string;
  borderRadius: string;
  backgroundColor: string;
  boxShadow: string;
  paddingTop: string;
  paddingLeft: string;
};

async function readSurface(
  page: Page,
  selector: string,
): Promise<SurfaceStyle> {
  const surface = page.locator(selector).first();

  return surface.evaluate((element) => {
    const style = getComputedStyle(element);

    return {
      borderTopWidth: style.borderTopWidth,
      borderTopStyle: style.borderTopStyle,
      borderTopColor: style.borderTopColor,
      borderRadius: style.borderTopLeftRadius,
      backgroundColor: style.backgroundColor,
      boxShadow: style.boxShadow,
      paddingTop: style.paddingTop,
      paddingLeft: style.paddingLeft,
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto(demoLibraryUrl);
});

test("exposes one shared spacing, radius, border, and shadow scale", async ({
  page,
}) => {
  const tokens = await readTokens(page);

  expect(tokens).toMatchObject({
    space4: "4px",
    space8: "8px",
    space12: "12px",
    space16: "16px",
    space24: "24px",
    space32: "32px",
    space48: "48px",
    space64: "64px",
    radiusXs: "4px",
    radiusControl: "6px",
    radiusCard: "8px",
    radiusFull: "999px",
  });

  // The border tokens carry a 1px outline around a shared color token, so the
  // exact hue stays owned by the shared color decision.
  expect(tokens.borderDefault).toMatch(/^1px solid .+$/);
  expect(tokens.borderControl).toMatch(/^1px solid .+$/);
  expect(tokens.borderStrong).toMatch(/^1px solid .+$/);
  expect(tokens.borderDefault).not.toBe(tokens.borderStrong);

  // Light surfaces may carry the faint XS and SM elevations, but never the
  // board's MD/LG or Glow treatments.
  expect(tokens.shadowXs).not.toBe("none");
  expect(tokens.shadowSm).not.toBe("none");
  expect(tokens.shadowXs).not.toContain("16px 40px");
  expect(tokens.shadowSm).not.toContain("16px 40px");

  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  const darkTokens = await readTokens(page);

  // Dark separates surfaces with a border and a tonal step instead of a
  // light-theme shadow.
  expect(darkTokens.shadowXs).toBe("none");
  expect(darkTokens.shadowSm).toBe("none");
});

test("applies the shared tokens to the library surfaces", async ({ page }) => {
  const summary = await readSurface(page, ".library-overview");

  expect(summary.borderTopWidth).toBe("1px");
  expect(summary.borderTopStyle).toBe("solid");
  expect(summary.borderRadius).toBe("8px");
  expect(summary.paddingTop).toBe("24px");
  expect(summary.paddingLeft).toBe("24px");
  expect(summary.backgroundColor).not.toBe(summary.borderTopColor);
  expect(summary.boxShadow).not.toBe("none");

  const workbench = await readSurface(page, ".library-controls");

  expect(workbench.borderRadius).toBe("8px");
  expect(workbench.paddingTop).toBe("16px");
  expect(workbench.paddingLeft).toBe("16px");
  expect(workbench.boxShadow).toBe("none");

  const sourceSwitch = await readSurface(page, ".library-source-switch");

  expect(sourceSwitch.borderRadius).toBe("6px");

  const sourceSegment = await page
    .locator(".library-source-switch a")
    .first()
    .evaluate((element) => getComputedStyle(element).borderRadius);

  expect(sourceSegment).toBe("4px");

  const searchField = await page
    .locator(".library-search input")
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);

      return {
        borderRadius: style.borderRadius,
        borderTopWidth: style.borderTopWidth,
        borderTopStyle: style.borderTopStyle,
        height: style.height,
      };
    });

  expect(searchField).toMatchObject({
    borderRadius: "6px",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    height: "44px",
  });
});

test("separates dark library surfaces with a border instead of a shadow", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Switch to dark mode" }).click();

  const summary = await readSurface(page, ".library-overview");

  expect(summary.boxShadow).toBe("none");
  expect(summary.borderTopWidth).toBe("1px");
  expect(summary.borderTopStyle).toBe("solid");
  expect(summary.backgroundColor).not.toBe(summary.borderTopColor);
  expect(summary.borderRadius).toBe("8px");
});

test("steps the surface insets down on tablet and mobile", async ({ page }) => {
  const widths = [1440, 768, 640, 390, 320];
  const paddings: Record<number, string> = {};

  for (const width of widths) {
    // A viewport change re-evaluates the media queries on its own, so the
    // layout is re-read without a navigation.
    await page.setViewportSize({ width, height: 900 });

    const surface = await readSurface(page, ".library-overview");

    paddings[width] = surface.paddingTop;
    expect(surface.paddingLeft).toBe(surface.paddingTop);

    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));

    expect(dimensions.documentWidth).toBeLessThanOrEqual(
      dimensions.viewportWidth,
    );
  }

  expect(paddings).toEqual({
    1440: "24px",
    768: "24px",
    640: "16px",
    390: "12px",
    320: "12px",
  });
});

test("keeps the point editor a flat nested surface", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: "Detailed entry" }).click();
  await page.getByRole("button", { name: "Add metric" }).click();

  const editor = await readSurface(page, ".point-editor");

  expect(editor.borderRadius).toBe("8px");
  expect(editor.paddingTop).toBe("24px");
  expect(editor.borderTopWidth).toBe("1px");
  expect(editor.boxShadow).not.toBe("none");

  // The metric group sits inside the editor, so it must not add a second
  // floating surface of its own.
  const metrics = await readSurface(page, ".metric-fields");

  expect(metrics.boxShadow).toBe("none");
  expect(metrics.borderRadius).toBe("6px");

  await page.getByRole("button", { name: "Switch to dark mode" }).click();

  const darkEditor = await readSurface(page, ".point-editor");

  expect(darkEditor.boxShadow).toBe("none");
  expect(darkEditor.borderTopWidth).toBe("1px");
  expect(darkEditor.backgroundColor).not.toBe(darkEditor.borderTopColor);
});
