import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
});

test("uses a focus-trapped mobile drawer and exposes every destination", async ({
  page,
}) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });

    const toggle = page.locator(".sidebar-toggle");
    const sidebar = page.locator("#workspace-sidebar");
    const main = page.locator("#workspace-main");

    await expect(sidebar).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-label", "Open navigation");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toHaveCSS("width", "44px");

    const closedLayout = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(closedLayout.documentWidth).toBeLessThanOrEqual(
      closedLayout.viewportWidth,
    );

    await toggle.click();

    const dialog = page.getByRole("dialog", { name: "Navigation menu" });
    const closeButton = dialog.getByRole("button", {
      name: "Close navigation",
    });
    const navigation = dialog.getByRole("navigation", {
      name: "Main navigation",
    });

    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(main).toHaveAttribute("inert", "");
    await expect(closeButton).toBeVisible();
    await expect(closeButton).toBeFocused();
    await expect(navigation.getByRole("link")).toHaveCount(5);

    const drawer = await sidebar.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
        background: getComputedStyle(element).backgroundColor,
      };
    });
    expect(drawer.width).toBeLessThanOrEqual(Math.min(280, width * 0.85) + 1);
    expect(drawer.height).toBeGreaterThanOrEqual(844);

    await page.keyboard.press("Shift+Tab");
    await expect(
      dialog.getByRole("link", { name: "Resume Changer home" }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      navigation.getByRole("link", { name: "Settings" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("link", { name: "Resume Changer home" }),
    ).toBeFocused();

    if (width === 390) {
      await closeButton.click();
      await expect(sidebar).toBeHidden();
      await expect(toggle).toBeFocused();

      await toggle.click();
      await expect(dialog).toBeVisible();
      await page.mouse.click(width - 8, 300);
      await expect(sidebar).toBeHidden();
      await expect(toggle).toBeFocused();
    } else {
      await page.keyboard.press("Escape");
      await expect(sidebar).toBeHidden();
      await expect(toggle).toBeFocused();

      await toggle.click();
      await navigation.getByRole("link", { name: "History" }).click();
      await expect(page).toHaveURL(/\/history$/);
      await expect(sidebar).toBeHidden();

      const navigatedLayout = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      }));
      expect(navigatedLayout.documentWidth).toBeLessThanOrEqual(
        navigatedLayout.viewportWidth,
      );
    }
  }
});

test("keeps the mobile drawer available in dark mode and honors reduced motion", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ reducedMotion: "reduce" });

  await page.locator(".sidebar-toggle").click();
  const sidebar = page.locator("#workspace-sidebar");
  await expect(
    page.getByRole("dialog", { name: "Navigation menu" }),
  ).toBeVisible();

  const drawerStyles = await sidebar.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      transitionDuration: style.transitionDuration,
    };
  });
  expect(drawerStyles.background).toBe("rgb(20, 17, 31)");
  expect(Number.parseFloat(drawerStyles.transitionDuration)).toBeLessThan(
    0.001,
  );
});

test("keeps all destinations available without JavaScript hydration", async ({
  browser,
  page,
}) => {
  const baseURL = new URL(page.url()).origin;
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 320, height: 844 },
  });

  try {
    const noJsPage = await context.newPage();
    await noJsPage.goto(baseURL);

    const navigation = noJsPage.getByRole("navigation", {
      name: "Main navigation",
    });
    const destinations = [
      "Job description",
      "Achievement library",
      "Resume builder",
      "History",
      "Settings",
    ];

    await expect(navigation).toBeVisible();
    for (const label of destinations) {
      await expect(navigation.getByRole("link", { name: label })).toBeVisible();
    }

    const layout = await noJsPage.evaluate(() => {
      const nav = document.querySelector(".main-navigation")!;
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        navWidth: nav.clientWidth,
        navContentWidth: nav.scrollWidth,
      };
    });
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.navContentWidth).toBeLessThanOrEqual(layout.navWidth);
  } finally {
    await context.close();
  }
});
