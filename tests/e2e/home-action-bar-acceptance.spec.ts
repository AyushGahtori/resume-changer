import { expect, test, type Page } from "@playwright/test";
import { homeAnalysis } from "../helpers/home-analysis";
import { auditHome } from "../helpers/home-accessibility";

async function capture(page: Page, name: string) {
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: `docs/ui-review/task-29/${name}.png`,
    fullPage: true,
    animations: "disabled",
    style: "nextjs-portal{display:none}",
  });
}

for (const theme of ["light", "dark"]) {
  for (const width of [1440, 390, 320]) {
    test(`action states and final visual acceptance in ${theme} at ${width}`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      const badResponses: string[] = [];
      const failedRequests: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on(
        "requestfailed",
        (request) =>
          // Next cancels speculative RSC prefetches when pointer/focus moves.
          // A cancelled prefetch is not a failed user operation.
          !(
            new URL(request.url()).searchParams.has("_rsc") &&
            request.failure()?.errorText === "net::ERR_ABORTED"
          ) &&
          failedRequests.push(
            `${request.url()} ${request.failure()?.errorText}`,
          ),
      );
      page.on("response", (response) => {
        if (
          response.status() >= 400 &&
          !(
            response.url().endsWith("/api/ai/analyze-job-description") &&
            response.status() === 503
          )
        )
          badResponses.push(`${response.status()} ${response.url()}`);
      });
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      if (theme === "dark")
        await page.getByRole("button", { name: "Switch to dark mode" }).click();
      const actions = page.locator(".form-actions");
      const clear = actions.getByRole("button", {
        name: "Clear draft",
        exact: true,
      });
      const analyze = page.locator(".form-actions .analyze-button");
      const save = actions.getByRole("button", {
        name: "Save draft",
        exact: true,
      });
      const jd = page.getByRole("textbox", {
        name: "Job description",
        exact: true,
      });
      await expect(save).toBeEnabled();
      await expect(actions.getByRole("button")).toHaveText([
        "Clear draft",
        "Analyze job description",
        "Save draft",
      ]);
      await expect(analyze.locator("svg")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      await expect(save.locator("svg")).toHaveClass(/lucide-arrow-up-right/);
      await expect(save.locator("svg")).toHaveAttribute("aria-hidden", "true");
      await expect(analyze).toHaveCSS(
        "background-color",
        theme === "light" ? "rgb(239, 235, 255)" : "rgb(124, 58, 237)",
      );
      await expect(save).toHaveCSS("background-color", "rgb(249, 115, 22)");
      await capture(page, `${theme}-${width}-idle`);
      await save.click();
      await expect(jd).toBeFocused();
      await expect(page.locator("#jd-error")).toBeVisible();
      await capture(page, `${theme}-${width}-validation`);
      await jd.fill("Build reliable APIs with TypeScript and PostgreSQL.");
      await expect(page.locator("#jd-error")).toHaveCount(0);
      for (const [name, button] of [
        ["clear", clear],
        ["analyze", analyze],
        ["save", save],
      ] as const) {
        await button.hover();
        await actions.screenshot({
          path: `docs/ui-review/task-29/${theme}-${width}-${name}-hover.png`,
          animations: "disabled",
        });
        await page.mouse.down();
        await expect(button).toHaveCSS(
          "transform",
          "matrix(0.98, 0, 0, 0.98, 0, 0)",
        );
        await actions.screenshot({
          path: `docs/ui-review/task-29/${theme}-${width}-${name}-pressed.png`,
          animations: "disabled",
        });
        // Release away from the button to inspect :active without invoking it.
        await page.mouse.move(0, 0);
        await page.mouse.up();
      }
      await analyze.focus();
      await page.keyboard.press("Tab");
      await expect(save).toBeFocused();
      await expect(save).toHaveCSS("outline-width", "2px");
      await actions.screenshot({
        path: `docs/ui-review/task-29/${theme}-${width}-keyboard-focus.png`,
        animations: "disabled",
      });
      let release: () => void = () => {};
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      let attempts = 0;
      await page.route("**/api/ai/analyze-job-description", async (route) => {
        attempts++;
        if (attempts === 1) {
          await pending;
          await route.fulfill({
            status: 503,
            json: { error: "Analysis temporarily unavailable." },
          });
        } else await route.fulfill({ json: { analysis: homeAnalysis } });
      });
      const idleWidth = (await analyze.boundingBox())!.width;
      await analyze.click();
      await expect(analyze).toBeDisabled();
      await expect(analyze).toHaveAttribute("aria-busy", "true");
      await expect(analyze).toHaveText("Analyzing...");
      await expect(analyze.locator(".home-action-spinner")).toHaveCSS(
        "width",
        "16px",
      );
      expect((await analyze.boundingBox())!.width).toBeCloseTo(idleWidth, 1);
      await expect(page.locator(".analysis-status")).toContainText(
        "Analyzing job description",
      );
      await capture(page, `${theme}-${width}-analyzing-disabled`);
      release();
      await expect(page.locator(".analysis-error-notice")).toContainText(
        "Analysis temporarily unavailable.",
      );
      await expect(jd).toHaveValue(
        "Build reliable APIs with TypeScript and PostgreSQL.",
      );
      await capture(page, `${theme}-${width}-analysis-error`);
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(page.locator(".analysis-role")).toContainText(
        homeAnalysis.targetTitle,
      );
      await expect(
        page.getByRole("button", { name: "Reanalyze", exact: true }),
      ).toBeFocused();
      await expect(analyze).toHaveAttribute("aria-busy", "false");
      expect((await analyze.boundingBox())!.width).toBeCloseTo(idleWidth, 1);
      await save.click();
      await expect(page.locator(".form-save-feedback")).toContainText(
        "Draft saved in this browser",
      );
      await expect(page.locator(".draft-state")).toHaveText(
        "Saved on this device",
      );
      await capture(page, `${theme}-${width}-saved-success`);
      expect(await auditHome(page)).toEqual([]);
      await clear.click();
      await expect(jd).toHaveValue("");
      await expect(page.locator(".draft-state")).toHaveText("No saved draft");
      await expect(page.locator(".analysis-panel")).toHaveCount(0);
      await capture(page, `${theme}-${width}-cleared`);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(attempts).toBe(2);
      expect(pageErrors).toEqual([]);
      expect(badResponses).toEqual([]);
      expect(failedRequests).toEqual([]);
      // Chromium logs the deliberately mocked 503 used to verify the error state.
      expect(
        consoleErrors.filter(
          (message) =>
            !/Failed to load resource: the server responded with a status of 503/.test(
              message,
            ),
        ),
      ).toEqual([]);
    });
  }

  test(`truthful autosave pending feedback in ${theme}`, async ({ page }) => {
    await page.goto("/");
    if (theme === "dark")
      await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 100));
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page
        .getByRole("textbox", { name: "Job description", exact: true })
        .fill(`Pending draft at ${width}.`);
      await expect(page.locator(".draft-state")).toHaveText("Saving...");
      await expect(
        page.locator(".form-actions .home-action-button--primary"),
      ).toBeEnabled();
      await capture(page, `${theme}-${width}-saving`);
      await page.clock.runFor(350);
      await expect(page.locator(".draft-state")).toHaveText(
        "Saved on this device",
      );
    }
  });
}
