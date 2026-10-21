import { expect, test } from "@playwright/test";
import { auditHome } from "../helpers/home-accessibility";
import { homeAnalysis } from "../helpers/home-analysis";

test("reduced-motion drawer repeatedly opens with visible focus and restores it", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 320, height: 320 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  for (let index = 0; index < 5; index++) {
    await page.getByRole("button", { name: "Open navigation" }).click();
    const drawer = page.getByRole("dialog", { name: "Navigation menu" });
    const close = drawer.getByRole("button", {
      name: "Close navigation",
      exact: true,
    });
    await expect(close).toBeFocused();
    await expect(close).toBeInViewport();
    await drawer.getByRole("link", { name: "Settings", exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Open navigation" }),
    ).toBeFocused();
  }
});

for (const theme of ["light", "dark"]) {
  test(`keyboard validation, retry focus, contrast and announcements in ${theme}`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Skip to main content" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
    if (theme === "dark")
      await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    expect(await auditHome(page)).toEqual([]);
    const save = page.getByRole("button", { name: "Save draft", exact: true });
    const jd = page.getByRole("textbox", {
      name: "Job description",
      exact: true,
    });
    await save.focus();
    await page.keyboard.press("Enter");
    await expect(jd).toBeFocused();
    await expect(jd).toHaveAttribute("aria-invalid", "true");
    await expect(jd).toHaveAttribute(
      "aria-describedby",
      "jd-helper jd-error jd-count",
    );
    await expect(page.locator("#jd-error svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await expect(jd).toHaveCSS("outline-width", "2px");
    await expect(jd).toHaveCSS("outline-offset", "2px");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `docs/ui-review/task-28/${theme}-validation-focus.png`,
      fullPage: true,
      animations: "disabled",
      style: "nextjs-portal{display:none}",
    });
    expect(await auditHome(page)).toEqual([]);
    await jd.fill("Build reliable and accessible services.");
    await page.getByLabel("Job link").fill("invalid-url");
    await save.click();
    await expect(page.getByLabel("Job link")).toBeFocused();
    await expect(page.locator("#job-url-error svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await page.getByLabel("Job link").fill("");
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let attempt = 0;
    await page.route("**/api/ai/analyze-job-description", async (route) => {
      attempt++;
      if (attempt === 2) await pending;
      await route.fulfill(
        attempt < 3
          ? {
              status: 503,
              json: { error: "Analysis temporarily unavailable." },
            }
          : { json: { analysis: homeAnalysis } },
      );
    });
    await page
      .getByRole("button", { name: "Analyze job description", exact: true })
      .click();
    const retry = page.locator(".analysis-retry");
    await expect(retry).toHaveText("Retry");
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(retry).toBeFocused();
    await expect(retry).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator(".analysis-spinner")).toHaveCSS(
      "animation-name",
      "none",
    );
    await expect(page.locator(".analysis-status")).toContainText(
      "Analyzing job description",
    );
    release();
    await expect(retry).toHaveText("Retry");
    await expect(retry).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(retry).toHaveText("Reanalyze");
    await expect(retry).toBeFocused();
    await expect(page.locator(".analysis-status")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(await auditHome(page)).toEqual([]);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const targets = await page
        .locator(
          ".jd-form button,.ats-preview button,.theme-toggle,.sidebar-toggle",
        )
        .evaluateAll((els) =>
          els.map((el) => {
            const r = el.getBoundingClientRect();
            return { label: el.textContent, width: r.width, height: r.height };
          }),
        );
      expect(targets.filter((t) => t.width < 44 || t.height < 44)).toEqual([]);
      await jd.focus();
      await expect(jd).toBeInViewport();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: `docs/ui-review/task-28/${theme}-${width}.png`,
        fullPage: true,
        animations: "disabled",
        style: "nextjs-portal{display:none}",
      });
    }
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(
      page.getByRole("button", { name: "Close navigation", exact: true }),
    ).toBeFocused();
    expect(await auditHome(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Open navigation" }),
    ).toBeFocused();
  });
}
