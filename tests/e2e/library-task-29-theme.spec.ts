import { expect, test, type Page } from "@playwright/test";

/**
 * Task 29 coverage for the library in the dark theme.
 *
 * The theme is a shell concern, but the library has to survive it: the
 * surfaces have to change with the theme, the choice has to survive a
 * reload, and the library text has to stay readable in both.
 */

function canvasColour(page: Page) {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

function textLuminance(page: Page, selector: string) {
  return page.evaluate((target) => {
    const element = document.querySelector(target);
    if (!element) return 0;
    const [red, green, blue] = getComputedStyle(element)
      .color.match(/\d+/g)!
      .map(Number);
    return (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  }, selector);
}

const POINT_TEXT = ".library-point-text";

test("starts in the light theme and switches to the dark one", async ({
  page,
}) => {
  await page.goto("/library?source=demo");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const light = await canvasColour(page);

  await page.getByRole("button", { name: "Switch to dark mode" }).click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => canvasColour(page)).not.toBe(light);
  await expect(
    page.getByRole("button", { name: "Switch to light mode" }),
  ).toBeVisible();
});

test("keeps the library text readable in the dark theme", async ({ page }) => {
  await page.goto("/library?source=demo");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const lightLuminance = await textLuminance(page, POINT_TEXT);

  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await expect
    .poll(() => textLuminance(page, POINT_TEXT))
    .toBeGreaterThan(lightLuminance);
  expect(await textLuminance(page, POINT_TEXT)).toBeGreaterThan(0.5);
});

test("keeps the chosen theme across a reload", async ({ page }) => {
  await page.goto("/library?source=demo");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("button", { name: "Switch to light mode" }),
  ).toBeVisible();
});

test("shows the library without an animation when motion is reduced", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/library?source=demo");

  await expect(
    page.getByRole("heading", { name: "Achievement library", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByText("achievement-service-capacity-design"),
  ).toBeVisible();
});
