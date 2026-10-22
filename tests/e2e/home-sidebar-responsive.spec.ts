import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
});

test("collapses the desktop sidebar while keeping every destination accessible", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sidebar = page.locator("#workspace-sidebar");
  const links = page.getByRole("navigation", { name: "Main navigation" });
  const destinations = [
    "Job description",
    "Achievement library",
    "Resume builder",
    "History",
    "Settings",
  ];

  await expect(sidebar).toHaveCSS("width", "260px");
  await expect(links.getByRole("link")).toHaveCount(destinations.length);
  await expect(
    page.getByRole("link", { name: "Job description" }),
  ).toHaveAttribute("aria-current", "page");

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(sidebar).toHaveCSS("width", "72px");
  await expect(
    page.getByRole("button", { name: "Expand sidebar" }),
  ).toHaveAttribute("aria-expanded", "false");

  for (const label of destinations) {
    const link = links.getByRole("link", { name: label });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("aria-label", label);
    await expect(link.locator(".nav-link-label")).toHaveText(label);
    await expect(link.locator(".nav-icon svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await expect(link.locator(".nav-icon svg")).toHaveAttribute(
      "viewBox",
      "0 0 24 24",
    );
  }

  const settings = links.getByRole("link", { name: "Settings" });
  await expect(settings).toHaveAttribute("title", "Settings");

  await page.keyboard.press("Shift+Tab");
  await expect(settings).toBeFocused();
  await expect(settings).toHaveCSS("outline-style", "solid");
  await expect
    .poll(() =>
      settings.evaluate((link) => getComputedStyle(link, "::after").visibility),
    )
    .toBe("visible");

  const achievementLibrary = links.getByRole("link", {
    name: "Achievement library",
  });
  await achievementLibrary.hover();
  await expect
    .poll(() =>
      achievementLibrary.evaluate(
        (link) => getComputedStyle(link, "::after").visibility,
      ),
    )
    .toBe("visible");
  await page.mouse.down();
  expect(
    await achievementLibrary.evaluate((link) => link.matches(":active")),
  ).toBe(true);
  await page.mouse.up();

  // Mouse up completes the activation already exercised above.
  await expect(page).toHaveURL(/\/library$/, { timeout: 30_000 });
  await expect(achievementLibrary).toHaveAttribute("aria-current", "page");
  await expect(sidebar).toHaveCSS("width", "72px");
});

test("keeps the collapsed rail and its tooltips legible in dark mode", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  const historyLink = page.getByRole("link", { name: "History" });
  await historyLink.hover();

  await expect(page.locator("#workspace-sidebar")).toHaveCSS("width", "72px");
  await expect
    .poll(() =>
      historyLink.evaluate(
        (link) => getComputedStyle(link, "::after").visibility,
      ),
    )
    .toBe("visible");
  await expect(historyLink).toHaveAttribute("title", "History");
});
