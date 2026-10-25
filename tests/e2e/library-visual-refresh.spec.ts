import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/library?source=demo");
});

test("keeps the floating accents decorative and disables them for reduced motion", async ({
  page,
}) => {
  const atmosphere = page.locator(".library-page-atmosphere");
  await expect(atmosphere).toHaveAttribute("aria-hidden", "true");
  await expect(atmosphere.locator(".library-bubble")).toHaveCount(4);
  const bubbleSizes = await atmosphere
    .locator(".library-bubble")
    .evaluateAll((bubbles) =>
      bubbles.map((bubble) =>
        Number.parseFloat(getComputedStyle(bubble).width),
      ),
    );
  expect(bubbleSizes[0]).toBeGreaterThanOrEqual(64);
  expect(bubbleSizes[2]).toBeGreaterThanOrEqual(74);
  await expect
    .poll(() =>
      atmosphere
        .locator(".library-bubble")
        .first()
        .evaluate((bubble) => getComputedStyle(bubble).animationName),
    )
    .toBe("library-bubble-float");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() =>
      atmosphere
        .locator(".library-bubble")
        .first()
        .evaluate((bubble) => getComputedStyle(bubble).animationName),
    )
    .toBe("none");

  await page.getByRole("combobox", { name: "Tag" }).click();
  await expect
    .poll(() =>
      page
        .locator(".library-select-menu")
        .first()
        .evaluate((menu) => getComputedStyle(menu).animationName),
    )
    .toBe("none");
});

test("keeps the filter workbench polished and stable while scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/library?source=demo");
  const expandedWorkbenchHeight = await page
    .locator(".library-workbench")
    .evaluate((element) => element.getBoundingClientRect().height);
  await page.evaluate(() => window.scrollTo(0, 1000));

  const workbench = page.locator(".library-workbench");
  await expect(workbench).toHaveAttribute("data-stuck", "true");
  const stickyLayout = await page.evaluate(() => {
    const workbench =
      document.querySelector<HTMLElement>(".library-workbench")!;
    const topbar = document.querySelector<HTMLElement>(".topbar")!;
    const style = getComputedStyle(workbench);
    return {
      workbenchTop: workbench.getBoundingClientRect().top,
      topbarBottom: topbar.getBoundingClientRect().bottom,
      workbenchHeight: workbench.getBoundingClientRect().height,
      background: style.backgroundColor,
      shadow: style.boxShadow,
      backdrop: style.backdropFilter,
    };
  });

  expect(stickyLayout.workbenchTop).toBeCloseTo(stickyLayout.topbarBottom, 0);
  expect(stickyLayout.workbenchHeight).toBe(expandedWorkbenchHeight);
  expect(stickyLayout.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(stickyLayout.shadow).not.toBe("none");
  expect(stickyLayout.backdrop).toContain("blur");

  const tag = page.getByRole("combobox", { name: "Tag" });
  await tag.click();
  const menu = page.getByRole("listbox", { name: "Options for Tag" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("option", { name: "automation" })).toBeVisible();
  await menu.getByRole("option", { name: "automation" }).click();
  await expect(tag).toHaveAttribute("data-value", "automation");
});

test("gives evidence cards a small hover lift without hiding their text", async ({
  page,
}) => {
  const card = page.locator(".library-point").first();
  const initialTop = (await card.boundingBox())?.y;
  expect(initialTop).toBeDefined();

  await card.hover();
  await expect
    .poll(async () => (await card.boundingBox())?.y)
    .toBeLessThan(initialTop!);
  await expect(card.locator(".library-point-text")).not.toBeEmpty();
});
