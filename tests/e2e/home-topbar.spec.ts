import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("shows the current route and local-only status in the topbar", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });

  await expect(
    breadcrumb.getByText("Workspace", { exact: true }),
  ).toBeVisible();
  await expect(
    breadcrumb.getByText("Job description", { exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Local mode", { exact: true })).toBeVisible();

  await page.goto("/library");
  await expect(
    page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByText("Achievement library", { exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("toggles the theme from the keyboard and persists the preference", async ({
  page,
}) => {
  const toggle = page.getByRole("button", { name: "Switch to dark mode" });

  await page.getByRole("link", { name: "Resume Changer home" }).focus();
  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press("Tab");
  }

  await expect(toggle).toBeFocused();
  expect(
    await toggle.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe("none");

  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("button", { name: "Switch to light mode" }),
  ).toBeVisible();

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("button", { name: "Switch to light mode" }),
  ).toBeVisible();

  const homeLink = page.getByRole("link", { name: "Resume Changer home" });
  await homeLink.focus();
  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press("Tab");
  }

  const darkToggle = page.getByRole("button", { name: "Switch to light mode" });
  await expect(darkToggle).toBeFocused();
  expect(
    await darkToggle.evaluate(
      (element) => getComputedStyle(element).outlineWidth,
    ),
  ).toBe("3px");
});

test("shows hover and pressed feedback for the theme control", async ({
  page,
}) => {
  const toggle = page.getByRole("button", { name: "Switch to dark mode" });
  const restingBackground = await toggle.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );

  await toggle.hover();
  await expect
    .poll(() =>
      toggle.evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    .not.toBe(restingBackground);

  await page.mouse.down();
  await expect
    .poll(() =>
      toggle.evaluate((element) => getComputedStyle(element).transform),
    )
    .not.toBe("none");
  await page.mouse.up();
});

test("keeps topbar content inside desktop, zoomed, and mobile viewports in both themes", async ({
  page,
}) => {
  // Effective widths cover typical 125%, 150%, and 200% zoom from 1440px.
  const widths = [1440, 1152, 1024, 960, 768, 720, 390, 320];
  const verifyWidths = async () => {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      await expect(page.getByText("Local mode", { exact: true })).toBeVisible();

      const geometry = await page.evaluate(() => {
        const breadcrumb = document
          .querySelector(".breadcrumbs")!
          .getBoundingClientRect();
        const status = document
          .querySelector(".local-status")!
          .getBoundingClientRect();
        const toggle = document
          .querySelector(".theme-toggle")!
          .getBoundingClientRect();

        return {
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
          breadcrumbLeft: breadcrumb.left,
          statusRight: status.right,
          toggleRight: toggle.right,
        };
      });

      expect(geometry.documentWidth).toBeLessThanOrEqual(
        geometry.viewportWidth,
      );
      expect(geometry.breadcrumbLeft).toBeGreaterThanOrEqual(0);
      expect(geometry.statusRight).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.toggleRight).toBeLessThanOrEqual(geometry.viewportWidth);
    }
  };

  await verifyWidths();
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await verifyWidths();
});
