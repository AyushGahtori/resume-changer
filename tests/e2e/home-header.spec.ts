import { expect, test } from "@playwright/test";

const DRAFT_STORAGE_KEY = "resume-changer.jd-draft.v1";

type Rgb = readonly [number, number, number];

function parseCssColor(color: string): Rgb {
  const normalized = color.trim();
  const hexMatch = normalized.match(/^#([\da-f]{3}|[\da-f]{6})$/i);

  if (hexMatch) {
    const hex =
      hexMatch[1].length === 3
        ? [...hexMatch[1]].map((digit) => digit + digit).join("")
        : hexMatch[1];
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }

  const rgbMatch = normalized.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgbMatch) {
    return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
  }

  throw new Error("Unsupported CSS color: " + color);
}

function relativeLuminance([red, green, blue]: Rgb) {
  const linearize = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };

  return (
    0.2126 * linearize(red) +
    0.7152 * linearize(green) +
    0.0722 * linearize(blue)
  );
}

function contrastRatio(first: Rgb, second: Rgb) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);

  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("No saved draft");
});

test("shows the home context and heading hierarchy in both themes and at varied widths", async ({
  page,
}) => {
  const context = page.locator(".eyebrow");
  const progress = context.locator("span");
  const title = page.getByRole("heading", {
    level: 1,
    name: "Start with the role.",
  });
  const intro = page.locator(".page-intro");
  const draftState = page.locator(".draft-state");

  await expect(context).toHaveText("NEW APPLICATION 01 / 04");
  await expect(progress).toHaveText("01 / 04");
  await expect(title).toBeVisible();
  await expect(intro).toHaveText(
    "Add the job description and let AI analyze it for a stronger, ATS-optimized resume.",
  );
  await expect(page.getByRole("button", { name: "01 / 04" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "01 / 04" })).toHaveCount(0);

  for (const theme of ["light", "dark"] as const) {
    const currentTheme = await page.locator("html").getAttribute("data-theme");
    if (currentTheme !== theme) {
      await page
        .getByRole("button", { name: "Switch to " + theme + " mode" })
        .click();
    }

    for (const width of [1440, 1152, 1024, 960, 768, 720, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.evaluate(() => {
        const read = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector);
          if (!element) throw new Error(`Missing ${selector}`);
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return {
            color: style.color,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            lineHeight: style.lineHeight,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            height: rect.height,
          };
        };
        const root = getComputedStyle(document.documentElement);
        const headingRow = document
          .querySelector(".page-heading-row")!
          .getBoundingClientRect();
        const draftElement = document.querySelector(".draft-state")!;
        const draft = draftElement.getBoundingClientRect();
        const actions = document
          .querySelector(".form-actions")!
          .getBoundingClientRect();
        const form = document
          .querySelector(".jd-form")!
          .getBoundingClientRect();

        return {
          theme: document.documentElement.dataset.theme,
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          canvas: root.getPropertyValue("--color-canvas").trim(),
          orange: root.getPropertyValue("--color-orange-strong").trim(),
          muted: root.getPropertyValue("--color-text-muted").trim(),
          context: read(".eyebrow"),
          progress: read(".eyebrow span"),
          title: read(".jd-page h1"),
          intro: read(".page-intro"),
          headingBottom: headingRow.bottom,
          draftTop: draft.top,
          draftBottom: draft.bottom,
          draftRight: draft.right,
          actionsBottom: actions.bottom,
          formBottom: form.bottom,
          draftInsideForm: Boolean(draftElement.closest(".jd-form")),
        };
      });

      expect(layout.theme).toBe(theme);
      expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
      expect(layout.context.fontSize).toBe("12px");
      expect(layout.context.lineHeight).toBe("16px");
      expect(layout.context.fontWeight).toBe("600");
      expect(layout.progress.fontSize).toBe("12px");
      expect(layout.progress.lineHeight).toBe("16px");
      expect(layout.title.fontFamily).toContain("Georgia");
      expect(layout.title.fontSize).toBe(width <= 700 ? "32px" : "40px");
      expect(layout.title.lineHeight).toBe(width <= 700 ? "40px" : "48px");
      expect(layout.title.fontWeight).toBe("700");
      expect(layout.intro.fontSize).toBe("16px");
      expect(layout.intro.lineHeight).toBe("24px");
      expect(layout.title.right).toBeLessThanOrEqual(width);
      expect(layout.intro.right).toBeLessThanOrEqual(width);
      expect(layout.context.bottom).toBeLessThanOrEqual(layout.title.top);
      expect(layout.title.bottom).toBeLessThanOrEqual(layout.intro.top);

      expect(layout.draftInsideForm).toBe(true);
      expect(layout.draftTop).toBeGreaterThanOrEqual(layout.actionsBottom);
      expect(layout.draftBottom).toBeLessThanOrEqual(layout.formBottom);
      expect(layout.draftRight).toBeLessThanOrEqual(width);

      expect(parseCssColor(layout.context.color)).toEqual(
        parseCssColor(layout.orange),
      );
      expect(parseCssColor(layout.progress.color)).toEqual(
        parseCssColor(layout.muted),
      );
      expect(
        contrastRatio(
          parseCssColor(layout.context.color),
          parseCssColor(layout.canvas),
        ),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(
          parseCssColor(layout.progress.color),
          parseCssColor(layout.canvas),
        ),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(
          parseCssColor(layout.intro.color),
          parseCssColor(layout.canvas),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("keeps restore notices adjacent and announces draft saves", async ({
  page,
}) => {
  await page.evaluate(
    (key) => localStorage.setItem(key, "{invalid"),
    DRAFT_STORAGE_KEY,
  );
  await page.reload({ waitUntil: "domcontentloaded" });

  const notice = page.locator(".storage-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("The saved draft could not be restored");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(notice).toBeVisible();
    const placement = await page.evaluate(() => {
      const header = document
        .querySelector(".page-heading-row")!
        .getBoundingClientRect();
      const notice = document
        .querySelector(".storage-notice")!
        .getBoundingClientRect();
      const form = document.querySelector(".jd-form")!.getBoundingClientRect();
      return {
        headerBottom: header.bottom,
        noticeTop: notice.top,
        noticeBottom: notice.bottom,
        noticeLeft: notice.left,
        noticeRight: notice.right,
        formTop: form.top,
      };
    });
    expect(placement.noticeTop).toBeGreaterThan(placement.headerBottom - 20);
    expect(placement.noticeBottom).toBeLessThan(placement.formTop);
    expect(placement.noticeLeft).toBeGreaterThanOrEqual(0);
    expect(placement.noticeRight).toBeLessThanOrEqual(width);
  }

  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill("Build dependable services for customers.");
  const save = page.getByRole("button", { name: "Save draft" });
  await save.hover();
  await save.focus();
  await expect(save).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.locator(".form-save-feedback")).toContainText(
    "Draft saved in this browser. You can open Resume builder now.",
  );
  await expect(page.locator(".draft-state")).toContainText(
    "Saved on this device",
  );
  await expect(notice).toHaveCount(0);
});
