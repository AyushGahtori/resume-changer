import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

async function audit(page: Page, state: string) {
  const directory = join(process.cwd(), ".runtime", "github-gate-c");
  await mkdir(directory, { recursive: true });
  for (const theme of ["light", "dark"] as const)
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement)
          document.activeElement.blur();
        window.scrollTo(0, 0);
      });
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                document.documentElement.scrollWidth <= window.innerWidth + 1,
            ),
          {
            message: `${state} ${theme} ${width}px must not overflow horizontally`,
          },
        )
        .toBe(true);
      await page.screenshot({
        path: join(directory, `${state}-${theme}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
}

test("runs a tab-owned foreground import, saves only confirmed drafts and discards unsaved state on reload", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.GITHUB_IMPORT_E2E_BACKEND !== "1",
    "Requires the isolated synthetic external-boundary backend.",
  );
  test.setTimeout(120_000);
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.route(
    "https://github.com/login/oauth/authorize**",
    async (route) => {
      const authorization = new URL(route.request().url());
      const callback = new URL(authorization.searchParams.get("redirect_uri")!);
      callback.searchParams.set(
        "state",
        authorization.searchParams.get("state")!,
      );
      callback.searchParams.set("code", "fictional-oauth-code");
      await route.fulfill({
        status: 302,
        headers: { location: callback.href },
      });
    },
  );
  await page.goto("/library/github/new");
  page.on("response", (response) => {
    if (response.url().includes("/api/github/") && response.status() >= 400)
      failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  await page
    .getByRole("button", { name: "Connect GitHub", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("Connected", { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Repository", exact: true })
    .selectOption("42");
  await expect(
    page.getByRole("checkbox", { name: /Validate publishing requests/ }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: /Validate publishing requests/ })
    .check();
  await page
    .getByLabel("Your role on this project")
    .fill(
      "I implemented publishing input validation and the regression tests.",
    );
  if (testInfo.repeatEachIndex === 0) await audit(page, "setup");
  await page
    .getByRole("button", { name: "Prepare selected evidence", exact: true })
    .click();
  await expect(
    page.getByText(
      "I reviewed this selection and explicitly approve one analysis run.",
    ),
  ).toBeVisible({ timeout: 30000 });
  await page
    .getByRole("checkbox", {
      name: "I reviewed this selection and explicitly approve one analysis run.",
    })
    .check();
  const accepted = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/github/session" &&
      response.request().postDataJSON()?.path?.endsWith("/extract"),
  );
  await page
    .getByRole("button", { name: "Analyze this selection", exact: true })
    .click();
  expect((await accepted).status()).toBe(200);
  await expect(
    page
      .getByRole("button", { name: "Confirm my contribution", exact: true })
      .first(),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("textbox", { name: "Achievement text for draft 1" }),
  ).toHaveValue(
    "Implemented publishing input validation and added a regression assertion for blank content.",
  );
  await page
    .getByRole("button", { name: /Review evidence and context/ })
    .click();
  await page
    .getByRole("button", { name: "Add a measurement", exact: true })
    .click();
  if (testInfo.repeatEachIndex === 0) await audit(page, "review-expanded");
  const selection = page.getByRole("checkbox", {
    name: "Select draft 1 for save",
  });
  await selection.focus();
  await page.keyboard.press("Space");
  await expect(selection).toBeChecked();
  const confirmation = page
    .getByRole("button", { name: "Confirm my contribution", exact: true })
    .first();
  await confirmation.focus();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("button", { name: "Contribution confirmed", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const save = page.getByRole("button", { name: /Save selected achievements/ });
  await save.focus();
  await expect(save).toBeFocused();
  await page.screenshot({
    path: join(
      process.cwd(),
      ".runtime/github-gate-c/review-keyboard-focus-light-1440.png",
    ),
    animations: "disabled",
  });
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Saved 1 achievement/i).first()).toBeVisible({
    timeout: 15000,
  });
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((k) => k.startsWith("resume.github")),
    ),
  ).toEqual([]);
  await page.goto("/library");
  await expect(
    page
      .getByText(
        "Implemented publishing input validation and added a regression assertion for blank content.",
        { exact: true },
      )
      .first(),
  ).toBeVisible();
  expect(failures).toEqual([]);
});

test("reload abandons unsaved evidence and old import URLs offer a fresh start", async ({
  page,
}) => {
  test.skip(process.env.GITHUB_IMPORT_E2E_BACKEND !== "1");
  await page.context().addCookies([
    {
      name: "github_session",
      value: "a".repeat(43),
      url: "http://127.0.0.1:" + (process.env.PLAYWRIGHT_PORT ?? "3012"),
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/library/github/new");
  await page
    .getByRole("combobox", { name: "Repository", exact: true })
    .selectOption("42");
  await page
    .getByLabel("Your role on this project")
    .fill("I implemented publishing input validation and regression tests.");
  await page
    .getByRole("button", { name: "Prepare selected evidence", exact: true })
    .click();
  await expect(
    page.getByText(
      "I reviewed this selection and explicitly approve one analysis run.",
    ),
  ).toBeVisible({ timeout: 30000 });
  await expect(page).toHaveURL(/\/library\/github\/(?!new)[a-z0-9-]+$/);
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Start a new import", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/temporary import ended/)).toBeVisible();
});

async function preparePartialFixture(page: Page, repositoryId: string) {
  await page.context().addCookies([
    {
      name: "github_session",
      value: "a".repeat(43),
      url: "http://127.0.0.1:" + (process.env.PLAYWRIGHT_PORT ?? "3012"),
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/library/github/new");
  await page
    .getByRole("combobox", { name: "Repository", exact: true })
    .selectOption(repositoryId);
  await page.getByLabel("Your role on this project").fill("entire project.");
  await page
    .getByRole("button", { name: "Prepare selected evidence", exact: true })
    .click();
  await expect(page).toHaveURL(/\/library\/github\/(?!new)[a-z0-9-]+$/);
}

test("implementation-only evidence reaches consent, generates drafts once, and saves only after confirmation", async ({
  page,
}) => {
  test.skip(process.env.GITHUB_IMPORT_E2E_BACKEND !== "1");
  test.setTimeout(120000);
  let analysisSubmissions = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/github/session" &&
      request.postDataJSON()?.path?.endsWith("/extract")
    )
      analysisSubmissions++;
  });
  await preparePartialFixture(page, "43");
  await expect(
    page.locator('[aria-label="GitHub import progress"] [aria-current="step"]'),
  ).toContainText("Analyze");
  await expect(
    page.getByText("Evidence prepared with coverage limitations", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Evidence prepared — analysis has not started", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("note", { name: "Evidence limitations" }),
  ).toContainText("No test evidence was included");
  await expect(
    page.getByRole("heading", { name: "Repository preparation", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Save selected achievements/ }),
  ).toHaveCount(0);
  expect(analysisSubmissions).toBe(0);
  await page
    .getByRole("button", { name: "Edit repository setup", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Set up repository evidence",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review prepared evidence", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Review the staged selection",
      exact: true,
    }),
  ).toBeVisible();
  const consent = page.getByRole("checkbox", {
    name: "I reviewed this selection and explicitly approve one analysis run.",
  });
  const analyze = page.getByRole("button", {
    name: "Analyze this selection",
    exact: true,
  });
  await expect(analyze).toBeDisabled();
  await consent.check();
  await page
    .getByRole("button", { name: "Edit repository setup", exact: true })
    .click();
  await page
    .getByLabel("Your role on this project")
    .fill("I implemented publishing input validation.");
  await expect(
    page.getByRole("button", { name: "Review prepared evidence", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Prepare updated evidence", exact: true })
    .click();
  await expect(consent).not.toBeChecked();
  await expect(analyze).toBeDisabled();
  expect(analysisSubmissions).toBe(0);
  await audit(page, "partial-evidence-before-consent");
  await consent.check();
  await expect(analyze).toBeEnabled();
  await analyze.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  const text = page.getByRole("textbox", {
    name: "Achievement text for draft 1",
  });
  await expect(text).toHaveValue(
    "Implemented publishing input validation that rejects blank content.",
    { timeout: 30000 },
  );
  expect(analysisSubmissions).toBe(1);
  await page.getByRole("checkbox", { name: "Select draft 1 for save" }).check();
  await page
    .getByRole("button", { name: "Confirm my contribution", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: /Save selected achievements/ })
    .click();
  await expect(page.getByText(/Saved 1 achievement/i).first()).toBeVisible();
  expect(analysisSubmissions).toBe(1);
});

test("documentation-only evidence names the blocker and never offers model analysis", async ({
  page,
}) => {
  test.skip(process.env.GITHUB_IMPORT_E2E_BACKEND !== "1");
  let analysisSubmissions = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/github/session" &&
      request.postDataJSON()?.path?.endsWith("/extract")
    )
      analysisSubmissions++;
  });
  await preparePartialFixture(page, "44");
  await expect(
    page.getByRole("note", { name: "Evidence limitations" }),
  ).toContainText("does not show an implementation");
  await expect(
    page.getByRole("button", { name: "Analyze this selection", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Save selected achievements/ }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Add missing context", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "More evidence or contribution context" }),
  ).toBeVisible();
  await audit(page, "blocked-implementation");
  expect(analysisSubmissions).toBe(0);
});

test("a completed zero-draft model result has a truthful empty state and no save control", async ({
  page,
}) => {
  test.skip(process.env.GITHUB_IMPORT_E2E_BACKEND !== "1");
  await preparePartialFixture(page, "45");
  await page
    .getByRole("checkbox", {
      name: "I reviewed this selection and explicitly approve one analysis run.",
    })
    .check();
  await page
    .getByRole("button", { name: "Analyze this selection", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "No supported achievements were generated",
      exact: true,
    }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("button", { name: /Save selected achievements/ }),
  ).toHaveCount(0);
  await expect(
    page.getByText("synthetic-source-extractor", { exact: true }),
  ).toBeVisible();
  await audit(page, "empty-model-result");
});
