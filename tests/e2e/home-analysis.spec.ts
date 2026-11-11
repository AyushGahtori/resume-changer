import { expect, test } from "@playwright/test";
import { homeAnalysis, emptyHomeAnalysis } from "../helpers/home-analysis";
import { saveJobAnalysis } from "../helpers/saved-job";

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
  await page.getByLabel("Company", { exact: true }).fill("Example Systems");
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
  await page.getByLabel("Company", { exact: true }).fill("Example Systems");
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
  const explicitRequirements = page.locator("details.analysis-section").filter({
    has: page.getByRole("heading", {
      name: "Explicit requirements",
      exact: true,
    }),
  });
  await expect(explicitRequirements).toHaveJSProperty("open", true);
  const tools = page.locator("details.analysis-section").filter({
    has: page.getByRole("heading", {
      name: "Tools and platforms",
      exact: true,
    }),
  });
  await expect(tools).toHaveJSProperty("open", false);
  await expect(tools.locator(".analysis-section-summary")).toContainText(
    "2 items",
  );
  await tools.locator("summary").click();
  await expect(tools).toHaveJSProperty("open", true);
  await expect(tools.locator(".analysis-keyword-chip")).toContainText([
    "TypeScript",
    "PostgreSQL",
  ]);
  await expect(page.locator(".analysis-inferred")).toContainText(
    "not requirements",
  );
  await expect(jd).toHaveValue(
    "Build reliable APIs with TypeScript and PostgreSQL.",
  );
  expect(attempts).toBe(2);
  await page.getByLabel("Company", { exact: true }).fill("New context");
  await expect(page.locator(".saved-job-unsaved")).toBeVisible();
  await expect(page.locator(".analysis-status")).toContainText("out of date");
  await expect(page.locator(".analysis-panel")).toBeVisible();
  await expect(page.locator(".saved-job-open").first()).toContainText(
    "Example Systems",
  );
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
  await page.route("**/api/job-analyses", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 500,
        json: { error: "Saved job analyses are unavailable. Try again." },
      });
    }
    return route.continue();
  });
  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill("A short role description.");
  await page.getByLabel("Company", { exact: true }).fill("Example Systems");
  await page
    .getByRole("button", { name: "Analyze job description", exact: true })
    .click();
  await expect(page.locator(".analysis-empty-category")).toHaveCount(8);
  await expect(page.locator(".analysis-cache-notice")).toContainText(
    "not added",
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
    await page.getByLabel("Company", { exact: true }).fill("Example Systems");
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

test("shows a saved analysis again after visiting another page", async ({
  page,
}) => {
  await page.goto("/");
  let analysisCalls = 0;
  await page.route(endpoint, async (route) => {
    analysisCalls += 1;
    await route.fulfill({ json: { analysis: homeAnalysis } });
  });
  await page.getByLabel("Company", { exact: true }).fill("BJAK");
  await page.getByLabel("Role title").fill("Backend Engineer");
  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill("Build APIs for the product.");
  await page
    .getByRole("button", { name: "Analyze job description", exact: true })
    .click();
  await expect(page.locator(".analysis-panel")).toContainText(
    "Job description analysis ready.",
  );
  await expect(
    page.locator(".saved-job-open", { hasText: "BJAK" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Resume builder" }).click();
  await page.goto("/");
  await page.locator(".saved-job-open", { hasText: "BJAK" }).click();
  await expect(
    page.getByRole("textbox", { name: "Job description", exact: true }),
  ).toHaveValue("Build APIs for the product.");
  await expect(page.locator(".analysis-panel")).toBeVisible();
  expect(analysisCalls).toBe(1);
});

test("says analyzed jobs stay on this device in local mode", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".workspace-note")).toContainText(
    "Analyzed jobs stay on this device",
  );
});

test("keeps the saved job link after opening another page", async ({
  page,
}) => {
  await page.goto("/");
  await page.route(endpoint, (route) =>
    route.fulfill({ json: { analysis: homeAnalysis } }),
  );
  await page.getByLabel("Company", { exact: true }).fill("Northwind Labs");
  await page.getByLabel("Role title").fill("Backend Engineer");
  await page.getByLabel("Job link").fill("https://jobs.example/northwind");
  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill("Build APIs for the product.");
  await page
    .getByRole("button", { name: "Analyze job description", exact: true })
    .click();
  await expect(page.locator(".analysis-panel")).toContainText(
    "Job description analysis ready.",
  );
  await expect(
    page.locator(".saved-job-open", { hasText: "Northwind Labs" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Resume builder" }).click();
  await page.goto("/");
  const listed = await page.request.get("/api/job-analyses");
  const body = (await listed.json()) as {
    jobs?: { id: string; company: string }[];
  };
  const match = body.jobs?.find((job) => job.company === "Northwind Labs");
  expect(match).toBeTruthy();
  const detail = await page.request.get(`/api/job-analyses/${match!.id}`);
  const saved = (await detail.json()) as { job?: { jobUrl?: string } };
  expect(saved.job?.jobUrl).toBe("https://jobs.example/northwind");
});

test("asks before a saved analysis replaces typed text", async ({ page }) => {
  await saveJobAnalysis(page, {
    company: "Saved Labs",
    roleTitle: "Backend Engineer",
    jobDescription: "The saved description.",
  });
  await page.goto("/");
  await page.getByLabel("Company", { exact: true }).fill("Typed Labs");
  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill("Text I just typed.");
  await page.locator(".saved-job-open", { hasText: "Saved Labs" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("will be discarded");
  await expect(page.getByLabel("Company", { exact: true })).toHaveValue(
    "Typed Labs",
  );
  await dialog.getByRole("button", { name: "Keep what I typed" }).click();
  await expect(page.getByLabel("Company", { exact: true })).toHaveValue(
    "Typed Labs",
  );
  await page.locator(".saved-job-open", { hasText: "Saved Labs" }).click();
  await dialog.getByRole("button", { name: "Replace draft" }).click();
  await expect(page.getByLabel("Company", { exact: true })).toHaveValue(
    "Saved Labs",
  );
  await expect(page.getByText("restored from this device")).toHaveCount(0);
});

test("deleting a saved analysis keeps the text in the form", async ({
  page,
}) => {
  await saveJobAnalysis(page, {
    company: "Kept Labs",
    roleTitle: "Backend Engineer",
    jobDescription: "Keep this description.",
  });
  await page.goto("/");
  await page.locator(".saved-job-open", { hasText: "Kept Labs" }).click();
  await expect(page.getByLabel("Company", { exact: true })).toHaveValue(
    "Kept Labs",
  );
  await page
    .getByRole("button", { name: /Delete saved analysis for Kept Labs/ })
    .click();
  await expect(page.getByRole("dialog")).toContainText("form stays");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete saved analysis", exact: true })
    .click();
  await expect(page.getByLabel("Company", { exact: true })).toHaveValue(
    "Kept Labs",
  );
  await expect(
    page.getByRole("textbox", { name: "Job description", exact: true }),
  ).toHaveValue("Keep this description.");
});

test("an empty delete response keeps the draft and the saved job", async ({
  page,
}) => {
  const saved = await saveJobAnalysis(page, {
    company: "Empty Delete Labs",
    roleTitle: "Backend Engineer",
    jobDescription: "Still on the server.",
  });
  await page.goto("/");
  await page
    .locator(".saved-job-open", { hasText: "Empty Delete Labs" })
    .click();
  await expect(page.getByLabel("Company", { exact: true })).toHaveValue(
    "Empty Delete Labs",
  );
  await page.route(`**/api/job-analyses/${saved.job.id}`, (route) => {
    if (route.request().method() === "DELETE") {
      return route.fulfill({ status: 200, body: "" });
    }
    return route.continue();
  });
  await page
    .getByRole("button", {
      name: /Delete saved analysis for Empty Delete Labs/,
    })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete saved analysis", exact: true })
    .click();
  await expect(page.getByText(/could not be deleted/i)).toBeVisible();
  await expect(page.getByLabel("Company", { exact: true })).toHaveValue(
    "Empty Delete Labs",
  );
  await page.reload();
  await expect(
    page.locator(".saved-job-open", { hasText: "Empty Delete Labs" }),
  ).toBeVisible();
});

test("a saved-job load failure names the server error and can be retried", async ({
  page,
}) => {
  let failList = true;
  await page.route("**/api/job-analyses", (route) => {
    if (failList && route.request().method() === "GET") {
      return route.fulfill({
        status: 401,
        json: { error: "Sign in again before loading saved jobs." },
      });
    }
    return route.continue();
  });
  await page.goto("/");
  const loadError = page.locator(".saved-jobs").getByRole("alert");
  await expect(loadError).toContainText(
    "Sign in again before loading saved jobs.",
  );
  await expect(page.getByText("No analyzed jobs yet")).toHaveCount(0);
  failList = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(loadError).toHaveCount(0);
});

test("opening a saved job uses not-found only for a missing job", async ({
  page,
}) => {
  await saveJobAnalysis(page, {
    company: "Readable Labs",
    roleTitle: "Backend Engineer",
    jobDescription: "Leave this text alone.",
  });
  await page.goto("/");
  await page.getByLabel("Company", { exact: true }).fill("Still here");
  await page.route("**/api/job-analyses/*", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 502,
        contentType: "text/html",
        body: "<html>",
      });
    }
    return route.continue();
  });
  await page.locator(".saved-job-open", { hasText: "Readable Labs" }).click();
  await expect(
    page.getByText("The saved job could not be loaded."),
  ).toBeVisible();
  await expect(page.getByText("Saved job not found.")).toHaveCount(0);
  await expect(page.getByLabel("Company", { exact: true })).toHaveValue(
    "Still here",
  );
});

test("can save the analysis already on screen when the first save fails", async ({
  page,
}) => {
  let posts = 0;
  await page.route(endpoint, (route) =>
    route.fulfill({ json: { analysis: homeAnalysis } }),
  );
  await page.route("**/api/job-analyses", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts += 1;
    if (posts === 1) {
      return route.fulfill({
        status: 500,
        json: { error: "Saved job analyses are unavailable. Try again." },
      });
    }
    return route.continue();
  });
  await page.goto("/");
  await page.getByLabel("Company", { exact: true }).fill("Retry Save Labs");
  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill("Build APIs for the product.");
  await page
    .getByRole("button", { name: "Analyze job description", exact: true })
    .click();
  const notice = page.locator(".analysis-cache-notice");
  await expect(notice).toContainText(
    "Saved job analyses are unavailable. Try again.",
  );
  await expect(notice).toContainText("not added");
  await page.getByRole("button", { name: "Save this analysis" }).click();
  await expect(notice).toHaveCount(0);
  expect(posts).toBe(2);
});
