import { expect, test } from "@playwright/test";

/**
 * The builder header answers three questions before the work starts: where the
 * user is, which step of the flow is active, and what the page is for. It is a
 * working context block rather than a hero, so it stays compact, keeps the
 * work below it inside the first viewport, and scales down on a narrow
 * screen instead of overflowing.
 */

async function openBuilder(page: import("@playwright/test").Page) {
  await page.goto("/generate?source=demo");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test("keeps one page title with the product name and the instruction", async ({
  page,
}) => {
  await openBuilder(page);

  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveCount(1);
  await expect(heading).toHaveText("Build your resume.");

  const builder = page.locator(".generation-page");
  await expect(builder).toHaveAttribute("aria-labelledby", "page-title");
  await expect(page.locator("#page-title")).toHaveCount(1);

  await expect(page.locator(".page-intro")).toHaveText(
    "Choose the experience you want to include, then review the LaTeX.",
  );
});

test("shows the current route in the breadcrumb", async ({ page }) => {
  await openBuilder(page);

  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumb).toContainText("Workspace");
  await expect(breadcrumb).toContainText("Resume builder");
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText(
    "Resume builder",
  );
});

test("keeps the manual generation step label", async ({ page }) => {
  await openBuilder(page);

  const eyebrow = page.locator(".generation-heading .eyebrow");
  await expect(eyebrow).toHaveText("MANUAL GENERATION 02 / 04");
  await expect(eyebrow.locator("span")).toHaveText("02 / 04");
});

test("sets the title in the serif display size and the label in orange", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openBuilder(page);

  const heading = page.getByRole("heading", { level: 1 });
  const title = await heading.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      family: style.fontFamily,
      size: style.fontSize,
      lineHeight: style.lineHeight,
    };
  });
  expect(title.family.toLowerCase()).toContain("georgia");
  expect(title.size).toBe("40px");
  expect(title.lineHeight).toBe("48px");

  const eyebrow = page.locator(".generation-heading .eyebrow");
  await expect(eyebrow).toHaveCSS("color", "rgb(249, 115, 22)");
  await expect(eyebrow).toHaveCSS("font-size", "10px");
  await expect(eyebrow.locator("span")).toHaveCSS(
    "color",
    "rgb(100, 116, 139)",
  );

  const intro = page.locator(".page-intro");
  await expect(intro).toHaveCSS("color", "rgb(71, 85, 105)");
  await expect(intro).toHaveCSS("font-size", "14px");
});

test("keeps the header compact and the work inside the first viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openBuilder(page);

  const layout = await page.evaluate(() => {
    const header = document.querySelector(".generation-heading");
    const selection = document.querySelector(".generation-selection");
    if (!header || !selection) return null;
    return {
      headerBottom: header.getBoundingClientRect().bottom,
      selectionTop: selection.getBoundingClientRect().top,
      viewportHeight: window.innerHeight,
    };
  });

  expect(layout).not.toBeNull();
  expect(layout!.headerBottom).toBeLessThan(layout!.viewportHeight);
  expect(layout!.selectionTop).toBeLessThan(layout!.viewportHeight);
});

test("scales the title down and stacks the header on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBuilder(page);

  const heading = page.getByRole("heading", { level: 1 });
  const title = await heading.evaluate((element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return {
      size: style.fontSize,
      lineHeight: style.lineHeight,
      left: bounds.left,
      right: bounds.right,
    };
  });
  expect(title.size).toBe("32px");
  expect(title.lineHeight).toBe("40px");
  expect(title.left).toBeGreaterThanOrEqual(0);
  expect(title.right).toBeLessThanOrEqual(390);

  const stacked = await page.evaluate(() => {
    const heading = document.querySelector(".generation-heading > div");
    const source = document.querySelector(".library-source-switch");
    if (!heading || !source) return null;
    return {
      headingBottom: heading.getBoundingClientRect().bottom,
      sourceTop: source.getBoundingClientRect().top,
    };
  });
  expect(stacked).not.toBeNull();
  expect(stacked!.sourceTop).toBeGreaterThanOrEqual(stacked!.headingBottom);

  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(
    dimensions.viewportWidth,
  );
});
