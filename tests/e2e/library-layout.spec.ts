import { expect, test } from "@playwright/test";

const COMPOSITION_ORDER = [
  ".library-page-header",
  ".library-overview",
  ".library-workbench",
  "#library-content",
];

test.beforeEach(async ({ page }) => {
  await page.goto("/library?source=demo");
});

test("keeps the library inside the shared application shell", async ({
  page,
}) => {
  await expect(page.getByRole("main")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("navigation", { name: "Breadcrumb" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "Achievement library" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("navigation", { name: "Library sections" }),
  ).toBeVisible();
});

test("orders the library composition from context to content", async ({
  page,
}) => {
  const positions = await page.evaluate((selectors) => {
    return selectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      return element.getBoundingClientRect().top + window.scrollY;
    });
  }, COMPOSITION_ORDER);

  expect(positions.every((position) => position !== null)).toBe(true);
  const ordered = positions as number[];
  for (let index = 1; index < ordered.length; index += 1) {
    expect(ordered[index]).toBeGreaterThan(ordered[index - 1]);
  }
});

test("orders the category sections and keeps their counts truthful", async ({
  page,
}) => {
  const sectionIds = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".library-section")).map(
      (section) => section.id,
    ),
  );
  expect(sectionIds).toEqual([
    "library-jobs",
    "library-projects",
    "library-skills",
    "library-credentials",
  ]);

  await expect(page.locator("#library-jobs .library-section-count")).toHaveText(
    "7 achievements",
  );
  await expect(
    page.locator("#library-projects .library-section-count"),
  ).toHaveText("6 achievements");
  await expect(
    page.locator("#library-skills .library-section-count"),
  ).toHaveText("14 skills");
  await expect(
    page.locator("#library-credentials .library-section-count"),
  ).toHaveText("2 credentials");
});

test("navigates to a category section from the workbench", async ({ page }) => {
  const navigation = page.getByRole("navigation", { name: "Library sections" });

  await expect(navigation.getByRole("link", { name: "All" })).toHaveAttribute(
    "href",
    "#library-content",
  );
  await expect(navigation.getByRole("link", { name: "Jobs" })).toHaveAttribute(
    "href",
    "#library-jobs",
  );
  await expect(
    navigation.getByRole("link", { name: "Credentials" }),
  ).toHaveAttribute("href", "#library-credentials");

  await navigation.getByRole("link", { name: "Skills" }).click();
  await expect(page).toHaveURL(/#library-skills$/);
  await expect(page.locator("#library-skills")).toBeInViewport();
});

test("keeps the workbench reachable while the long page scrolls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();

  await page.evaluate(() => window.scrollTo(0, 1500));
  await expect
    .poll(() =>
      page
        .locator(".library-workbench")
        .evaluate((element) => element.getBoundingClientRect().top),
    )
    .toBeLessThan(120);
  await expect(
    page.getByRole("searchbox", { name: "Search library" }),
  ).toBeVisible();
});

test("keeps the composition free of horizontal overflow", async ({ page }) => {
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(
      dimensions.documentWidth,
      `overflow at ${width}px`,
    ).toBeLessThanOrEqual(dimensions.viewportWidth);
  }
});

test("keeps every section truthful when no record matches", async ({
  page,
}) => {
  await page
    .getByRole("searchbox", { name: "Search library" })
    .fill("no matching library content");

  await expect(page.getByRole("status")).toHaveText(
    "No achievement points match these filters.",
  );
  await expect(page.locator("#library-jobs .secondary-empty")).toHaveText(
    "No jobs match this search.",
  );
  await expect(page.locator("#library-projects .secondary-empty")).toHaveText(
    "No projects match this search.",
  );
  await expect(page.locator("#library-skills .secondary-empty")).toHaveText(
    "No skills match this search.",
  );
  await expect(
    page.locator("#library-credentials .secondary-empty"),
  ).toHaveText("No credentials match this search.");

  await expect(page.locator("#library-jobs .library-section-count")).toHaveText(
    "0 achievements",
  );
  await expect(
    page.locator("#library-skills .library-section-count"),
  ).toHaveText("0 skills");
  await expect(
    page.locator("#library-credentials .library-section-count"),
  ).toHaveText("0 credentials");
});
