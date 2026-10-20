import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("shows the brand, workspace label, and local workspace status in both themes", async ({
  page,
}) => {
  const brand = page.getByRole("link", { name: "Resume Changer home" });
  const workspaceLabel = page.getByText("WORKSPACE", { exact: true });

  await expect(brand).toHaveAttribute("href", "/");
  await expect(brand).toBeVisible();
  await expect(workspaceLabel).toBeVisible();
  await expect(
    page.getByText("Private workspace", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Saved on this device", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Go Pro", { exact: true })).toHaveCount(0);

  const brandStyle = await brand.evaluate((element) => {
    const textStyle = getComputedStyle(element);
    const markStyle = getComputedStyle(element.querySelector(".brand-mark")!);
    return {
      fontSize: textStyle.fontSize,
      fontWeight: textStyle.fontWeight,
      markWidth: markStyle.width,
      markHeight: markStyle.height,
      markColor: markStyle.color,
    };
  });
  expect(brandStyle).toEqual({
    fontSize: "16px",
    fontWeight: "700",
    markWidth: "24px",
    markHeight: "24px",
    markColor: "rgb(249, 115, 22)",
  });

  const lightSidebarWidth = await page
    .locator(".sidebar")
    .evaluate((sidebar) => getComputedStyle(sidebar).width);
  expect(lightSidebarWidth).toBe("260px");

  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(brand).toBeVisible();
  await expect(workspaceLabel).toBeVisible();
  await expect(
    page.getByText("Private workspace", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Saved on this device", { exact: true }),
  ).toBeVisible();
});

test("brand link is first keyboard destination and returns to the home route", async ({
  page,
}) => {
  await page.goto("/settings");

  const brand = page.getByRole("link", { name: "Resume Changer home" });
  await page.keyboard.press("Tab");
  await expect(brand).toBeFocused();

  const focusStyle = await brand.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
  expect(focusStyle).toEqual({ outlineStyle: "solid", outlineWidth: "3px" });

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Start with the role." }),
  ).toBeVisible();
});

test("brand link responds to pointer hover and press", async ({ page }) => {
  await page.goto("/settings");

  const brand = page.getByRole("link", { name: "Resume Changer home" });
  await brand.hover();
  await expect(brand).toBeVisible();
  await page.mouse.down();
  await page.mouse.up();

  await expect(page).toHaveURL(/\/$/);
});

test("keeps the longest destination label readable at desktop and compact desktop widths", async ({
  page,
}) => {
  const longestDestination = page.getByRole("link", {
    name: "Achievement library",
  });

  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(longestDestination).toBeVisible();

    const geometry = await longestDestination.evaluate((link) => {
      const label = link.querySelector(":scope > span:last-child");
      const range = document.createRange();
      if (label) range.selectNodeContents(label);
      const labelBounds = range.getBoundingClientRect();
      const linkBounds = link.getBoundingClientRect();

      return {
        labelRight: labelBounds.right,
        contentRight:
          linkBounds.right -
          Number.parseFloat(getComputedStyle(link).paddingRight),
        scrollWidth: link.scrollWidth,
        clientWidth: link.clientWidth,
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
      };
    });

    expect(geometry.labelRight).toBeLessThanOrEqual(geometry.contentRight + 1);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  }
});
