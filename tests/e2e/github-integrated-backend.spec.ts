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

test("runs the assembled import through the separate worker and saves only confirmed drafts", async ({
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
      new URL(response.url()).pathname.endsWith("/extract") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Analyze this selection", exact: true })
    .click();
  expect((await accepted).status()).toBe(202);
  // Navigate away while the separate worker owns execution; reopening must recover review.
  const importUrl = page.url();
  await page.goto("/library");
  await page.goto(importUrl);
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
