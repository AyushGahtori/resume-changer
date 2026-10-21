import { expect, test } from "@playwright/test";
import { JD_DRAFT_STORAGE_KEY } from "../../src/lib/jd-draft";

test("live metrics cover empty, normal, maximum, over-limit and clear", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", {
    name: "Job description",
    exact: true,
  });
  const count = page.locator("#jd-count");
  await expect(count).toContainText("0 / 30,000 characters");
  await expect(count).toContainText("~0 tokens");
  await editor.fill("Build APIs.");
  await expect(count).toContainText("11 / 30,000 characters");
  await expect(count).toContainText("~3 tokens");
  await editor.fill("x".repeat(30_000));
  await expect(count).toContainText("30,000 / 30,000 characters");
  await expect(count).toContainText("~7,500 tokens");
  await expect(editor).toHaveAttribute("aria-invalid", "false");
  await editor.fill("x".repeat(30_001));
  await expect(count).toContainText("30,001 / 30,000 characters");
  await expect(count).toContainText("~7,501 tokens");
  await expect(count.locator(".metric-over-limit")).toBeVisible();
  await expect(editor).toHaveAttribute("aria-invalid", "true");
  await expect(editor).toHaveAttribute(
    "aria-describedby",
    "jd-helper jd-error jd-count",
  );
  await expect(page.locator("#jd-error")).toContainText("30,000 characters");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.locator("#jd-error")).toBeVisible();
  await editor.fill("Valid again");
  await expect(editor).toHaveAttribute("aria-invalid", "false");
  await expect(page.locator("#jd-error")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear draft", exact: true }).click();
  await expect(count).toContainText("0 / 30,000 characters");
  await expect(count).toContainText("~0 tokens");
});

test("restores exact counts and politely announces after typing pauses", async ({
  page,
}) => {
  await page.addInitScript(
    ({ key }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          schemaVersion: 1,
          company: "",
          roleTitle: "",
          jobUrl: "",
          jobDescription: "x".repeat(2736),
        }),
      );
    },
    { key: JD_DRAFT_STORAGE_KEY },
  );
  await page.goto("/");
  await expect(page.locator("#jd-count")).toContainText(
    "2,736 / 30,000 characters",
  );
  await expect(page.locator(".token-metric")).toContainText("~684 tokens");
  const announcement = page.locator(".metrics-announcement");
  await expect(announcement).toHaveAttribute("aria-live", "polite");
  await expect(announcement).toHaveAttribute("aria-atomic", "true");
  await expect(announcement).toContainText("2,736 of 30,000 characters");
  await page.clock.install();
  const editor = page.locator("#job-description");
  await editor.fill("A");
  await page.clock.runFor(600);
  await expect(announcement).toContainText("2,736 of 30,000 characters");
  await editor.fill("ABCDE");
  await page.clock.runFor(600);
  await expect(announcement).toContainText("2,736 of 30,000 characters");
  await page.clock.runFor(400);
  await expect(announcement).toHaveText(
    "5 of 30,000 characters, approximately 2 tokens.",
  );
});

test("metrics retain reference scale and wrap without clipping in both themes", async ({
  page,
}) => {
  await page.goto("/");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      theme,
    );
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator("#job-description").fill("x".repeat(30_001));
      const metrics = page.locator("#jd-count");
      await expect(metrics).toBeVisible();
      const geometry = await metrics.evaluate((element) => {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        const editorBounds = document
          .querySelector("#job-description")!
          .getBoundingClientRect();
        return {
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          numerals: style.fontVariantNumeric,
          gap: style.gap,
          left: bounds.left,
          right: bounds.right,
          editorLeft: editorBounds.left,
          below: bounds.top >= editorBounds.bottom,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(geometry).toMatchObject({
        fontSize: "12px",
        lineHeight: "16px",
        numerals: "tabular-nums",
        gap: "12px",
        below: true,
        overflow: false,
      });
      expect(geometry.left).toBe(geometry.editorLeft);
      expect(geometry.right).toBeLessThanOrEqual(width);
    }
  }
});
