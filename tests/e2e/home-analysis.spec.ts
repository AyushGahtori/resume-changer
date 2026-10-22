import { expect, test } from "@playwright/test";
import { homeAnalysis, emptyHomeAnalysis } from "../helpers/home-analysis";

const endpoint = "**/api/ai/analyze-job-description";

test("editing during an in-flight request cancels stale analysis", async ({
  page,
}) => {
  await page.goto("/");
  const jd = page.getByRole("textbox", {
    name: "Job description",
    exact: true,
  });
  await jd.fill("Original description");
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(endpoint, async (route) => {
    await pending;
    await route.fulfill({ json: { analysis: homeAnalysis } }).catch(() => {});
  });
  await page
    .getByRole("button", { name: "Analyze job description", exact: true })
    .click();
  await expect(page.locator(".analysis-status")).toContainText("Analyzing");
  await jd.fill("Replacement description");
  release();
  await expect(page.locator(".analysis-panel")).toHaveCount(0);
  await expect(jd).toHaveValue("Replacement description");
});

test("loading, failure, panel retry, real result and stale-analysis invalidation", async ({
  page,
}) => {
  await page.goto("/");
  const jd = page.getByRole("textbox", {
    name: "Job description",
    exact: true,
  });
  await jd.fill("Build reliable APIs with TypeScript and PostgreSQL.");
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let attempts = 0;
  await page.route(endpoint, async (route) => {
    attempts++;
    if (attempts === 1) {
      await pending;
      await route.fulfill({
        status: 503,
        json: { error: "Analysis service is unavailable. Try again." },
      });
    } else await route.fulfill({ json: { analysis: homeAnalysis } });
  });
  await page
    .getByRole("button", { name: "Analyze job description", exact: true })
    .click();
  await expect(page.locator(".analysis-status")).toHaveText(
    "Analyzing job description...",
  );
  await expect(page.locator(".analysis-skeleton span")).toHaveCount(4);
  await page.screenshot({
    path: "docs/ui-review/task-21/loading.png",
    fullPage: true,
    animations: "disabled",
    style: "nextjs-portal {display:none}",
  });
  release();
  await expect(page.locator(".analysis-error-notice")).toContainText(
    "Analysis service is unavailable",
  );
  await page.screenshot({
    path: "docs/ui-review/task-21/error.png",
    fullPage: true,
    animations: "disabled",
    style: "nextjs-portal {display:none}",
  });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".analysis-role")).toContainText(
    homeAnalysis.targetTitle,
  );
  await expect(page.locator(".analysis-inferred")).toContainText(
    "not requirements",
  );
  await expect(jd).toHaveValue(
    "Build reliable APIs with TypeScript and PostgreSQL.",
  );
  expect(attempts).toBe(2);
  await page.getByLabel("Company", { exact: true }).fill("New context");
  await expect(page.locator(".analysis-panel")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("resume-changer.jd-analysis.v1"),
    ),
  ).toBeNull();
});

test("empty categories are neutral and cache failure remains readable", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "resume-changer.jd-analysis.v1")
        throw new Error("Quota exceeded");
      original.call(this, key, value);
    };
  });
  await page.route(endpoint, (route) =>
    route.fulfill({ json: { analysis: emptyHomeAnalysis } }),
  );
  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill("A short role description.");
  await page
    .getByRole("button", { name: "Analyze job description", exact: true })
    .click();
  await expect(page.locator(".analysis-empty-category")).toHaveCount(0);
  await expect(page.locator(".analysis-empty-summary")).toHaveText(
    "No supported requirements or related signals were identified. Include the full job description for a more useful analysis.",
  );
  await expect(page.locator(".analysis-signals li")).toHaveCount(1);
  await expect(page.locator(".analysis-signals")).toContainText(
    "No supported requirements or related signals were identified.",
  );
  await expect(page.locator(".analysis-cache-notice")).toContainText(
    "could not be saved",
  );
});

for (const theme of ["light", "dark"]) {
  test(`analysis result visual review in ${theme}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    if (theme === "dark")
      await page.getByRole("button", { name: "Switch to dark mode" }).click();
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let attempt = 0;
    await page.route(endpoint, async (route) => {
      if (++attempt === 1) {
        await pending;
        await route.fulfill({
          status: 503,
          json: { error: "Analysis service is unavailable. Try again." },
        });
      } else await route.fulfill({ json: { analysis: homeAnalysis } });
    });
    await page
      .getByRole("textbox", { name: "Job description", exact: true })
      .fill("Build reliable APIs with TypeScript and PostgreSQL.");
    await page
      .getByRole("button", { name: "Analyze job description", exact: true })
      .click();
    await expect(page.locator(".analysis-skeleton")).toBeVisible();
    await page.screenshot({
      path: `docs/ui-review/task-21/${theme}-loading.png`,
      fullPage: true,
      animations: "disabled",
      style: "nextjs-portal {display:none}",
    });
    release();
    await expect(page.locator(".analysis-error-notice")).toBeVisible();
    await page.screenshot({
      path: `docs/ui-review/task-21/${theme}-error.png`,
      fullPage: true,
      animations: "disabled",
      style: "nextjs-portal {display:none}",
    });
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.locator(".analysis-role")).toContainText(
      homeAnalysis.targetTitle,
    );
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      if (width < 700)
        await expect(page.locator("#workspace-sidebar")).toBeHidden();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `docs/ui-review/task-21/${theme}-${width}.png`,
        fullPage: true,
        animations: "disabled",
        style: "nextjs-portal {display:none}",
      });
    }
    expect(errors).toEqual([]);
  });
}
