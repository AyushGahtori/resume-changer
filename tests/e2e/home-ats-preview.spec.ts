import { expect, test } from "@playwright/test";
import { homeAnalysis, emptyHomeAnalysis } from "../helpers/home-analysis";
import { JobAnalysisResultSchema } from "../../src/lib/ai/contracts";

const description =
  "We'll analyze your job description to find key skills, keywords, and requirements that ATS systems look for.";

for (const theme of ["light", "dark"]) {
  test(`signal rows have truthful textual status, accessible labels and wrapping in ${theme}`, async ({
    page,
  }) => {
    const browserErrors: string[] = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 500)
        browserErrors.push(`${response.status()} ${response.url()}`);
    });
    await page.goto("/");
    if (theme === "dark")
      await page.getByRole("button", { name: "Switch to dark mode" }).click();
    const preview = page.getByRole("complementary", {
      name: "ATS analysis preview",
    });
    const signals = preview.getByRole("list", {
      name: "Job description analysis signals",
    });
    await expect(signals).toHaveCount(0);
    let payload = homeAnalysis;
    await page.route("**/api/ai/analyze-job-description", (route) =>
      route.fulfill({ json: { analysis: payload } }),
    );
    await page
      .getByRole("textbox", { name: "Job description", exact: true })
      .fill("Build reliable APIs with TypeScript and PostgreSQL.");
    await page
      .getByRole("button", { name: "Analyze job description", exact: true })
      .click();
    await expect(signals.getByRole("listitem")).toHaveText([
      "Extracted: 1 explicit requirement",
      "Identified: 2 tools and platforms",
      "Identified: 1 ATS term",
      "Review inference: 1 context note",
    ]);
    await expect(signals.locator(".is-success")).toHaveCount(1);
    await expect(signals.locator(".is-info")).toHaveCount(2);
    await expect(signals.locator(".is-attention")).toHaveCount(1);
    const accessibleList = await signals.ariaSnapshot();
    expect(accessibleList).toContain("Extracted: 1 explicit requirement");
    expect(accessibleList).toContain("Review inference: 1 context note");
    await expect(signals.locator('[aria-hidden="true"] svg')).toHaveCount(4);
    const iconColors = await signals
      .locator(".analysis-signal-icon")
      .evaluateAll((icons) =>
        icons.map((icon) => {
          const style = getComputedStyle(icon);
          return [style.color, style.backgroundColor];
        }),
      );
    for (const [foreground, background] of iconColors)
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(3);
    for (const width of [1440, 1280, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      if (width < 700)
        await expect(page.locator("#workspace-sidebar")).toBeHidden();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await signals.screenshot({
        path: `docs/ui-review/task-24/${theme}-signals-${width}.png`,
        animations: "disabled",
        style: "nextjs-portal {display:none}",
      });
      if (width === 1440 || width === 320) {
        await preview.screenshot({
          path: `docs/ui-review/task-24/${theme}-preview-${width}.png`,
          animations: "disabled",
          style: "nextjs-portal {display:none}",
        });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: `docs/ui-review/task-24/${theme}-page-${width}.png`,
          fullPage: true,
          animations: "disabled",
          style: "nextjs-portal {display:none}",
        });
      }
    }
    payload = emptyHomeAnalysis;
    await page
      .getByRole("button", { name: "Analyze job description", exact: true })
      .click();
    await expect(signals.locator(".is-info")).toHaveCount(4);
    await expect(signals.locator(".is-success, .is-attention")).toHaveCount(0);
    const row = signals.getByRole("listitem").first();
    const labelBounds = await row
      .locator(".analysis-signal-label")
      .boundingBox();
    const iconBounds = await row.locator(".analysis-signal-icon").boundingBox();
    expect(labelBounds!.height).toBeGreaterThan(20);
    expect(Math.abs(labelBounds!.y - iconBounds!.y)).toBeLessThanOrEqual(1);
    await signals.screenshot({
      path: `docs/ui-review/task-24/${theme}-empty-categories-320.png`,
      animations: "disabled",
      style: "nextjs-portal {display:none}",
    });
    await page.getByLabel("Company", { exact: true }).fill("New draft context");
    await expect(signals).toHaveCount(0);
    expect(browserErrors).toEqual([]);
  });
}

test("score contract contains no supported match-score field", () => {
  expect(JobAnalysisResultSchema.safeParse(homeAnalysis).success).toBe(true);
  expect(
    JobAnalysisResultSchema.safeParse({ ...homeAnalysis, atsMatch: 78 })
      .success,
  ).toBe(false);
  expect(
    JobAnalysisResultSchema.safeParse({ ...homeAnalysis, score: 78 }).success,
  ).toBe(false);
});

for (const theme of ["light", "dark"]) {
  test(`score contract stays unscored for idle, valid, empty and unsupported responses in ${theme}`, async ({
    page,
  }) => {
    await page.goto("/");
    if (theme === "dark")
      await page.getByRole("button", { name: "Switch to dark mode" }).click();
    const preview = page.getByRole("complementary", {
      name: "ATS analysis preview",
    });
    const assertUnscored = async () => {
      await expect(preview.getByRole("note")).toContainText("Not scored.");
      await expect(
        preview.locator(
          "[role=progressbar], progress, meter, [aria-valuenow], .ats-score-ring",
        ),
      ).toHaveCount(0);
      await expect(preview).not.toContainText(
        /78%|Estimated ATS match|ATS score:\s*\d/i,
      );
    };
    await assertUnscored();
    await preview.screenshot({
      path: `docs/ui-review/task-23/${theme}-empty.png`,
      animations: "disabled",
      style: "nextjs-portal {display:none}",
    });
    let payload: unknown = homeAnalysis;
    await page.route("**/api/ai/analyze-job-description", (route) =>
      route.fulfill({ json: { analysis: payload } }),
    );
    await page
      .getByRole("textbox", { name: "Job description", exact: true })
      .fill("Build accessible and reliable services.");
    for (const result of [
      homeAnalysis,
      emptyHomeAnalysis,
      { ...homeAnalysis, score: 78, atsMatch: 78, estimatedAtsMatch: 78 },
    ]) {
      payload = result;
      await page
        .getByRole("button", { name: "Analyze job description", exact: true })
        .click();
      await expect(preview.locator(".analysis-role")).toContainText(
        result.targetTitle,
      );
      await assertUnscored();
    }
    await preview.screenshot({
      path: `docs/ui-review/task-23/${theme}-unsupported.png`,
      animations: "disabled",
      style: "nextjs-portal {display:none}",
    });
    payload = homeAnalysis;
    await page
      .getByRole("button", { name: "Analyze job description", exact: true })
      .click();
    await expect(preview.locator(".analysis-role")).toContainText(
      homeAnalysis.targetTitle,
    );
    await expect(preview.locator(".analysis-cache-notice")).toHaveCount(0);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      if (width < 700)
        await expect(page.locator("#workspace-sidebar")).toBeHidden();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await preview.screenshot({
        path: `docs/ui-review/task-23/${theme}-result-${width}.png`,
        animations: "disabled",
        style: "nextjs-portal {display:none}",
      });
    }
  });
}

function contrast(foreground: string, background: string) {
  const luminance = (color: string) => {
    const channels = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((value) => {
      const channel = Number(value) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (values[0] + 0.05) / (values[1] + 0.05);
}

for (const theme of ["light", "dark"]) {
  test(`preview composition and states in ${theme}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    if (theme === "dark")
      await page.getByRole("button", { name: "Switch to dark mode" }).click();
    const preview = page.getByRole("complementary", {
      name: "ATS analysis preview",
    });
    await expect(preview.locator(".ats-preview-description")).toHaveText(
      description,
    );
    await expect(preview.getByText("Beta", { exact: true })).toBeVisible();
    await expect(preview.locator(".ats-preview-empty")).toContainText(
      "Enter a job description",
    );
    await expect(preview.locator("ul, [role=progressbar]")).toHaveCount(0);
    const colors = await preview.evaluate((element) => {
      const icon = getComputedStyle(
        element.querySelector(".ats-preview-icon")!,
      );
      const copy = getComputedStyle(
        element.querySelector(".ats-preview-description")!,
      );
      const badge = getComputedStyle(element.querySelector(".ats-beta")!);
      return {
        icon: [icon.color, icon.backgroundColor],
        copy: [copy.color, getComputedStyle(element).backgroundColor],
        badge: [badge.color, badge.backgroundColor],
      };
    });
    expect(contrast(colors.icon[0], colors.icon[1])).toBeGreaterThanOrEqual(3);
    expect(contrast(colors.copy[0], colors.copy[1])).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrast(colors.badge[0], colors.badge[1])).toBeGreaterThanOrEqual(
      4.5,
    );
    for (const width of [1440, 1280, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      if (width < 700)
        await expect(page.locator("#workspace-sidebar")).toBeHidden();
      const formBounds = await page.locator(".jd-form").boundingBox();
      const previewBounds = await preview.boundingBox();
      expect(formBounds).not.toBeNull();
      expect(previewBounds).not.toBeNull();
      if (width >= 1280) {
        expect(Math.abs(formBounds!.y - previewBounds!.y)).toBeLessThanOrEqual(
          1,
        );
        expect(previewBounds!.x).toBeGreaterThan(
          formBounds!.x + formBounds!.width,
        );
        expect(formBounds!.width / previewBounds!.width).toBeGreaterThan(1.7);
      } else
        expect(previewBounds!.y).toBeGreaterThanOrEqual(
          formBounds!.y + formBounds!.height + 15,
        );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await preview.screenshot({
        path: `docs/ui-review/task-22/${theme}-empty-${width}.png`,
        animations: "disabled",
        style: "nextjs-portal {display:none}",
      });
      if (width === 1440 || width === 320)
        await page.screenshot({
          path: `docs/ui-review/task-22/${theme}-page-${width}.png`,
          fullPage: true,
          animations: "disabled",
          style: "nextjs-portal {display:none}",
        });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let attempts = 0;
    await page.route("**/api/ai/analyze-job-description", async (route) => {
      if (++attempts === 1) {
        await pending;
        await route.fulfill({
          status: 503,
          json: { error: "Analysis is temporarily unavailable." },
        });
      } else await route.fulfill({ json: { analysis: homeAnalysis } });
    });
    await page
      .getByRole("textbox", { name: "Job description", exact: true })
      .fill("Build reliable APIs with TypeScript and PostgreSQL.");
    await page
      .getByRole("button", { name: "Analyze job description", exact: true })
      .click();
    await expect(preview.locator(".analysis-skeleton")).toBeVisible();
    await preview.screenshot({
      path: `docs/ui-review/task-22/${theme}-loading.png`,
      animations: "disabled",
    });
    release();
    await expect(preview.locator(".analysis-error-notice")).toContainText(
      "temporarily unavailable",
    );
    await preview.screenshot({
      path: `docs/ui-review/task-22/${theme}-error.png`,
      animations: "disabled",
    });
    await preview.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(preview.locator(".analysis-role")).toContainText(
      homeAnalysis.targetTitle,
    );
    await preview.screenshot({
      path: `docs/ui-review/task-22/${theme}-success.png`,
      animations: "disabled",
    });
    await page.getByLabel("Company", { exact: true }).fill("Updated context");
    await expect(preview.locator(".ats-preview-empty")).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("long response values wrap within the single preview surface", async ({
  page,
}) => {
  await page.goto("/");
  await page.route("**/api/ai/analyze-job-description", (route) =>
    route.fulfill({
      json: {
        analysis: {
          ...homeAnalysis,
          targetTitle: "VeryLongTitle".repeat(30),
          requiredQualifications: [
            "An unusually detailed requirement that must remain readable across narrow screens. ".repeat(
              5,
            ),
          ],
        },
      },
    }),
  );
  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill("Long role description.");
  await page
    .getByRole("button", { name: "Analyze job description", exact: true })
    .click();
  await expect(page.locator(".analysis-role")).toContainText("VeryLongTitle");
  for (const width of [1440, 1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
