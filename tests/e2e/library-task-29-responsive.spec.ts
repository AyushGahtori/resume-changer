import { expect, test } from "@playwright/test";

/**
 * Task 29 coverage for the library at every viewport the plan lists.
 *
 * The library is read on a laptop and on a phone, so the same content has
 * to stay reachable and free of sideways scrolling at 1440, 1024, 768, 390
 * and 320. The filter row is the part that has to reflow, so its reflow is
 * checked as well.
 */

const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "390x844", width: 390, height: 844 },
  { name: "320x740", width: 320, height: 740 },
];

for (const viewport of VIEWPORTS) {
  test(`keeps the library usable at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.goto("/library?source=demo");

    await expect(
      page.getByRole("heading", { name: "Achievement library", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("searchbox", { name: "Search library" }),
    ).toBeVisible();
    await expect(page.getByLabel("Job or project")).toBeVisible();
    await expect(page.getByLabel("Point source")).toBeVisible();
    await expect(page.getByLabel("Point status")).toBeVisible();
    await expect(page.getByLabel("Linked skill")).toBeVisible();
    await expect(page.getByLabel("Tag")).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Library summary" }),
    ).toBeVisible();
    await expect(
      page.getByText("achievement-service-capacity-design"),
    ).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(
      dimensions.viewportWidth,
    );
  });
}

test("keeps the filter row on one line while it fits", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/library?source=demo");

  const first = await page
    .getByText("Job or project", { exact: true })
    .boundingBox();
  const second = await page
    .getByText("Point source", { exact: true })
    .boundingBox();

  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(second!.x).toBeGreaterThan(first!.x + 10);
});

test("stacks the filter row on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/library?source=demo");

  const first = await page
    .getByText("Job or project", { exact: true })
    .boundingBox();
  const second = await page
    .getByText("Point source", { exact: true })
    .boundingBox();

  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(second!.x).toBe(first!.x);
  expect(second!.y).toBeGreaterThan(first!.y);
});

test("keeps the source switch reachable on the narrowest viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/library?source=demo");

  const source = page.locator(".library-source-switch");
  await expect(source.getByRole("link", { name: "My data" })).toBeVisible();
  await expect(source.getByRole("link", { name: "Demo data" })).toBeVisible();
});

test("does not clip the text of a point on a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/library?source=demo");

  const text = page
    .locator(".library-point")
    .filter({ hasText: "achievement-service-capacity-design" })
    .locator(".library-point-text");
  const box = await text.boundingBox();
  const card = await page
    .locator(".library-point")
    .filter({ hasText: "achievement-service-capacity-design" })
    .boundingBox();

  expect(box).not.toBeNull();
  expect(card).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(card!.width);
  expect(box!.x).toBeGreaterThanOrEqual(card!.x - 1);
});
