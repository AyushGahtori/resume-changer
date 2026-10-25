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
