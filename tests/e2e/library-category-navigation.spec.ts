import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/library?source=demo");
});

test("shows live category counts and starts at the page overview", async ({
  page,
}) => {
  const navigation = page.getByRole("navigation", { name: "Library sections" });
  const links = navigation.getByRole("link");

  await expect(links).toHaveCount(5);
  await expect(links.nth(0)).toHaveAccessibleName(/^All, \d+ items$/);
  await expect(links.nth(1)).toHaveAccessibleName(/^Jobs, \d+ items$/);
  await expect(links.nth(2)).toHaveAccessibleName(/^Projects, \d+ items$/);
  await expect(links.nth(3)).toHaveAccessibleName(/^Skills, \d+ items$/);
  await expect(links.nth(4)).toHaveAccessibleName(/^Credentials, \d+ items$/);
  await expect(links.nth(0)).toHaveAttribute("aria-current", "location");

  const sectionCounts = await Promise.all(
    ["jobs", "projects", "skills", "credentials"].map(async (category) =>
      Number(
        await page
          .locator(`#library-${category} .library-section-count`)
          .textContent(),
      ),
    ),
  );
  const navigationCounts = await Promise.all(
    ["jobs", "projects", "skills", "credentials"].map(async (category) =>
      Number(
        await navigation
          .locator(`[data-section="${category}"] .library-category-count`)
          .textContent(),
      ),
    ),
  );

  expect(navigationCounts).toEqual(sectionCounts);
  await expect(
    navigation.locator('[data-section="all"] .library-category-count'),
  ).toHaveText(
    String(sectionCounts.reduce((total, count) => total + count, 0)),
  );
});

test("navigates with mouse and keyboard and tracks the section in view", async ({
  page,
}) => {
  const navigation = page.getByRole("navigation", { name: "Library sections" });
  const projects = navigation.getByRole("link", { name: /^Projects,/ });

  await page
    .locator("#library-projects")
    .evaluate((section) => section.scrollIntoView());
  await expect(projects).toHaveAttribute("aria-current", "location");
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(navigation.locator('[data-section="all"]')).toHaveAttribute(
    "aria-current",
    "location",
  );

  await projects.click();

  await expect(page).toHaveURL(/#library-projects$/);
  await expect(projects).toHaveAttribute("aria-current", "location");
  await expect(navigation.locator('[data-section="all"]')).not.toHaveAttribute(
    "aria-current",
    "location",
  );

  const skills = navigation.getByRole("link", { name: /^Skills,/ });
  await skills.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#library-skills$/);
  await expect(skills).toHaveAttribute("aria-current", "location");

  const query = page.getByRole("searchbox", { name: "Search library" });
  await query.fill("platform");
  await navigation.getByRole("link", { name: /^Credentials,/ }).click();
  await expect(query).toHaveValue("platform");
});

test("keeps zero-count categories navigable to truthful empty states", async ({
  page,
}) => {
  const query = page.getByRole("searchbox", { name: "Search library" });
  await query.fill("no matching achievement phrase");

  const navigation = page.getByRole("navigation", { name: "Library sections" });
  for (const category of ["all", "jobs", "projects", "skills", "credentials"]) {
    await expect(
      navigation.locator(
        `[data-section="${category}"] .library-category-count`,
      ),
    ).toHaveText("0");
  }

  await navigation.getByRole("link", { name: /^Jobs,/ }).click();
  await expect(page.locator("#library-jobs")).toContainText(
    "No jobs match the current filters.",
  );
  await expect(page.locator("#library-projects")).toContainText(
    "No projects match the current filters.",
  );
  await expect(query).toHaveValue("no matching achievement phrase");
});

test("preserves reduced motion and usable category targets on mobile", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });

  const navigation = page.getByRole("navigation", { name: "Library sections" });
  await expect(navigation.getByRole("link")).toHaveCount(5);
  const geometry = await navigation.evaluate((element) => {
    const links = Array.from(
      element.querySelectorAll<HTMLElement>(".library-category-link"),
    );
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      heights: links.map((link) => link.getBoundingClientRect().height),
      scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    };
  });

  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.heights.every((height) => height >= 44)).toBe(true);
  expect(geometry.scrollBehavior).toBe("auto");
});
