import { expect, test } from "@playwright/test";

/**
 * Task 14 "The sticky search and filter workbench".
 *
 * The workbench has to work on every supported width: it must not push the
 * page sideways, it must keep every control reachable, and it may only
 * become sticky when there is room for it.
 */

const WIDTHS = [320, 390, 768, 1024, 1440] as const;
const STICKY_WIDTH = 1024;

const FACETS = [
  "Job or project",
  "Point source",
  "Point status",
  "Linked skill",
  "Tag",
];

for (const width of WIDTHS) {
  test(`keeps the workbench inside a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/library?source=demo");

    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    // The page never scrolls sideways, whatever the workbench does.
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);

    const workbench = page.locator(".library-workbench");
    const workbenchBox = await workbench.boundingBox();
    expect(workbenchBox).not.toBeNull();
    expect(workbenchBox!.x).toBeGreaterThanOrEqual(0);
    expect(workbenchBox!.x + workbenchBox!.width).toBeLessThanOrEqual(width);

    const search = page.getByRole("searchbox", { name: "Search library" });
    await expect(search).toBeVisible();
    const searchBox = await search.boundingBox();
    // The search control keeps the shared 40-44px visual height.
    expect(searchBox!.height).toBeGreaterThanOrEqual(40);
    expect(searchBox!.height).toBeLessThanOrEqual(44);

    for (const label of FACETS) {
      const facet = page.getByLabel(label);
      await expect(facet).toBeVisible();
      const facetBox = await facet.boundingBox();
      expect(facetBox!.x).toBeGreaterThanOrEqual(0);
      expect(facetBox!.x + facetBox!.width).toBeLessThanOrEqual(width);
    }

    await expect(page.locator(".library-result-count")).toBeVisible();
  });
}

test("only pins the workbench when the viewport has room for it", async ({
  page,
}) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/library?source=demo");

    const position = await page
      .locator(".library-workbench")
      .evaluate((element) => getComputedStyle(element).position);
    expect(position).toBe(width >= STICKY_WIDTH ? "sticky" : "static");
  }
});

test("wraps the filter row before it can crowd the page", async ({ page }) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/library?source=demo");

    const rows = await page.evaluate(() => {
      const selects = Array.from(
        document.querySelectorAll(".library-filter-grid select"),
      );
      return new Set(
        selects.map((select) => Math.round(select.getBoundingClientRect().top)),
      ).size;
    });

    // A wide viewport keeps the five facets on one row; a narrow one
    // wraps them instead of squeezing them.
    if (width >= STICKY_WIDTH) {
      expect(rows).toBe(1);
    } else {
      expect(rows).toBeGreaterThan(1);
    }
  }
});
