import { expect, test } from "@playwright/test";
import {
  JD_DRAFT_STORAGE_KEY,
  MAX_JD_CHARACTERS,
} from "../../src/lib/jd-draft";

// Next dev compiles the home route on its first request.
test.setTimeout(90_000);

// Headless Chromium otherwise hides the native scrollbar in screenshots.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

const description =
  "# Platform Engineer\n\n**Company:** Example Systems\n**Location:** Remote / Hybrid\n**Experience:** 1–3 Years\n**Employment Type:** Full-time\n\n" +
  Array.from(
    { length: 30 },
    (_, i) =>
      `${i + 1}. Build reliable APIs, improve data services, and document requirements.`,
  ).join("\n");

for (const theme of ["light", "dark"] as const) {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    test(`${theme} textarea at ${viewport.width}px preserves readable, scrollable states`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.goto("/");
      const editor = page.getByRole("textbox", {
        name: "Job description",
        exact: true,
      });
      // Wait for client restoration and theme initialization before toggling.
      await expect(editor).toBeEnabled();
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        /^(light|dark)$/,
      );
      if ((await page.locator("html").getAttribute("data-theme")) !== theme) {
        await page
          .getByRole("button", { name: `Switch to ${theme} mode` })
          .click();
      }
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(editor).toHaveValue("");
      await editor.screenshot({ path: testInfo.outputPath("default.png") });
      await editor.fill(description);
      await editor.evaluate((el) => {
        el.scrollTop = 0;
      });
      await page
        .getByRole("heading", { name: "Role details", exact: true })
        .click();
      const geometry = await editor.evaluate((el: HTMLTextAreaElement) => {
        const style = getComputedStyle(el);
        return {
          width: el.getBoundingClientRect().width,
          parentWidth:
            el.parentElement!.clientWidth -
            parseFloat(getComputedStyle(el.parentElement!).paddingLeft) -
            parseFloat(getComputedStyle(el.parentElement!).paddingRight),
          height: el.getBoundingClientRect().height,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          radius: style.borderRadius,
          padding: style.padding,
          background: style.backgroundColor,
          color: style.color,
          border: style.borderColor,
          resize: style.resize,
        };
      });
      const contrast = await editor.evaluate((el) => {
        const style = getComputedStyle(el);
        const luminance = (color: string) => {
          const channels = color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number)
            .map((value) => {
              const channel = value / 255;
              return channel <= 0.04045
                ? channel / 12.92
                : ((channel + 0.055) / 1.055) ** 2.4;
            });
          return (
            channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
          );
        };
        const background = luminance(style.backgroundColor);
        return [style.color, getComputedStyle(el, "::placeholder").color].map(
          (color) => {
            const foreground = luminance(color);
            return (
              (Math.max(background, foreground) + 0.05) /
              (Math.min(background, foreground) + 0.05)
            );
          },
        );
      });
      for (const ratio of contrast) expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(geometry.height).toBe(240);
      expect(geometry.width).toBeCloseTo(geometry.parentWidth, 0);
      expect(geometry).toMatchObject({
        fontSize: "14px",
        lineHeight: "20px",
        radius: "6px",
        padding: "12px 14px",
      });
      expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("page.png"),
        fullPage: true,
      });
      await editor.screenshot({ path: testInfo.outputPath("textarea.png") });
      await editor.focus();
      await expect(editor).toBeFocused();
      await expect(editor).toHaveCSS("outline-width", "2px");
      await expect(editor).toHaveCSS("outline-style", "solid");
      await page.screenshot({
        path: testInfo.outputPath("focus.png"),
        fullPage: true,
      });
      await editor.press("Control+End");
      expect(await editor.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      await expect(editor).toHaveValue(description);

      // The fluid preview grid keeps native vertical resizing at every width.
      expect(geometry.resize).toBe("vertical");
      await editor.scrollIntoViewIfNeeded();
      const bounds = (await editor.boundingBox())!;
      await page.mouse.move(
        bounds.x + bounds.width - 3,
        bounds.y + bounds.height - 3,
      );
      await page.mouse.down();
      await page.mouse.move(
        bounds.x + bounds.width + 50,
        bounds.y + bounds.height + 50,
      );
      await page.mouse.up();
      // A newly visible page scrollbar can reduce available width.
      expect((await editor.boundingBox())!.width).toBeLessThanOrEqual(
        bounds.width,
      );
      expect((await editor.boundingBox())!.height).toBeGreaterThan(
        bounds.height,
      );
      await editor.fill("");
      await page
        .getByRole("button", { name: "Save draft", exact: true })
        .click();
      await expect(editor).toHaveAttribute("aria-invalid", "true");
      await expect(editor).toHaveAccessibleDescription(
        /Enter a job description before saving/,
      );
      await expect(
        page
          .getByRole("alert")
          .filter({ hasText: "Enter a job description before saving." }),
      ).toContainText("Enter a job description before saving.");
      expect(
        await editor.evaluate((el) => getComputedStyle(el).borderColor),
      ).not.toBe(geometry.border);
      await page.screenshot({
        path: testInfo.outputPath("error.png"),
        fullPage: true,
      });
      // The disabled state normally exists only during draft restoration.
      // Hold that native state as a visual fixture without changing app behavior.
      await editor.evaluate((el: HTMLTextAreaElement) => {
        el.setAttribute("aria-invalid", "false");
        el.disabled = true;
      });
      await expect(editor).toBeDisabled();
      expect(
        await editor.evaluate((el) => getComputedStyle(el).backgroundColor),
      ).not.toBe(geometry.background);
      await editor.screenshot({ path: testInfo.outputPath("disabled.png") });
    });
  }
}

test("keyboard typing and clipboard paste preserve multiline markup verbatim across reload", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  const editor = page.getByRole("textbox", {
    name: "Job description",
    exact: true,
  });
  await expect(editor).toBeEnabled();
  await page.getByLabel("Job link").focus();
  await page.keyboard.press("Tab");
  await expect(editor).toBeFocused();
  await editor.pressSequentially("Typed heading");
  await editor.press("Enter");
  const pasted =
    "  **Requirements:**\n- TypeScript & APIs\n<script>window.__pasted = true</script>\n" +
    "long-token".repeat(150) +
    "\n  ";
  await page.evaluate((text) => navigator.clipboard.writeText(text), pasted);
  await editor.press("Control+V");
  await expect(editor).toHaveValue("Typed heading\n" + pasted);
  expect(
    await page.evaluate(() => Reflect.get(window, "__pasted")),
  ).toBeUndefined();
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? "{}").jobDescription,
        JD_DRAFT_STORAGE_KEY,
      ),
    )
    .toBe("Typed heading\n" + pasted);
  await page.reload();
  await expect(editor).toHaveValue("Typed heading\n" + pasted);
  expect(await editor.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
});

test("accepts the existing limit and retains oversized input with an associated error", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", {
    name: "Job description",
    exact: true,
  });
  await expect(editor).toBeEnabled();
  await editor.fill("x".repeat(MAX_JD_CHARACTERS - 1));
  await editor.press("End");
  await editor.press("x");
  await expect(editor).toHaveValue("x".repeat(MAX_JD_CHARACTERS));
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(editor).toHaveAttribute("aria-invalid", "false");
  await editor.press("Control+End");
  await editor.press("x");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(editor).toHaveValue("x".repeat(MAX_JD_CHARACTERS + 1));
  await expect(editor).toHaveAccessibleDescription(/30,000 characters/);
  await expect(editor).toHaveAttribute("aria-invalid", "true");
});
