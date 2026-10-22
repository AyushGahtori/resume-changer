import { expect, test } from "@playwright/test";
import { homeAnalysis } from "../helpers/home-analysis";

for (const theme of ["light", "dark"]) {
  test(`adaptive workflow and keyboard scrolling in ${theme}`, async ({
    page,
  }) => {
    if (theme === "dark")
      await page.getByRole("button", { name: "Switch to dark mode" }).click();
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      if (width === 768) {
        await expect(page.locator(".sidebar")).toHaveCSS("width", "72px");
        await expect(
          page.getByRole("button", { name: "Expand sidebar" }),
        ).toBeVisible();
      }
      if (width < 700)
        await expect(page.locator("#workspace-sidebar")).toBeHidden();
      await page.getByLabel("Company", { exact: true }).fill("Example Systems");
      const jd = page.getByRole("textbox", {
        name: "Job description",
        exact: true,
      });
      await jd.focus();
      await page.keyboard.type("A role with accessible interfaces.");
      await expect(jd).toBeInViewport();
      await page
        .getByRole("button", { name: "Save draft", exact: true })
        .click();
      await expect(page.locator(".form-save-feedback")).toContainText(
        "Draft saved",
      );
      if (width < 700) {
        const fields = await page
          .locator(".metadata-fields input")
          .evaluateAll((els) =>
            els.map((el) => {
              const r = el.getBoundingClientRect();
              return { x: r.x, width: r.width, y: r.y };
            }),
          );
        expect(fields[1].y).toBeGreaterThan(fields[0].y);
        expect(fields[2].y).toBeGreaterThan(fields[1].y);
        expect(
          fields.every(
            (f) =>
              Math.abs(f.x - fields[0].x) < 1 &&
              Math.abs(f.width - fields[0].width) < 1,
          ),
        ).toBe(true);
        const buttons = await page
          .locator(".form-actions button")
          .evaluateAll((els) =>
            els.map((el) => {
              const r = el.getBoundingClientRect();
              return { x: r.x, width: r.width, y: r.y, height: r.height };
            }),
          );
        expect(
          buttons.every(
            (b) => b.height >= 44 && Math.abs(b.width - buttons[0].width) < 1,
          ),
        ).toBe(true);
        expect(buttons[1].y).toBeGreaterThan(buttons[0].y);
        expect(buttons[2].y).toBeGreaterThan(buttons[1].y);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: `docs/ui-review/task-27/${theme}-${width}.png`,
        fullPage: true,
        animations: "disabled",
        style: "nextjs-portal{display:none}",
      });
      await page
        .getByRole("button", { name: "Clear draft", exact: true })
        .click();
    }
  });
}

test("short mobile drawer scrolls internally and tablet preference remains operable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 320 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation menu" });
  const settings = drawer.getByRole("link", { name: "Settings", exact: true });
  await settings.focus();
  await expect(settings).toBeInViewport();
  expect(await drawer.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
    true,
  );
  await page.screenshot({
    path: "docs/ui-review/task-27/short-drawer.png",
    animations: "disabled",
    style: "nextjs-portal{display:none}",
  });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeFocused();
  await page.setViewportSize({ width: 768, height: 844 });
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(
    page.getByRole("button", { name: "Collapse sidebar" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.locator(".sidebar")).toHaveCSS("width", "72px");
});

for (const theme of ["light", "dark"]) {
  test(`desktop grid alignment and growing content in ${theme}`, async ({
    page,
  }) => {
    if (theme === "dark")
      await page.getByRole("button", { name: "Switch to dark mode" }).click();
    for (const [width, height] of [
      [1440, 900],
      [1280, 800],
      [1024, 768],
    ]) {
      await page.setViewportSize({ width, height });
      const geometry = await page.evaluate(() => {
        const bounds = (selector: string) => {
          const r = document.querySelector(selector)!.getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            right: r.right,
            bottom: r.bottom,
          };
        };
        return {
          content: bounds(".page-content"),
          heading: bounds(".page-heading-row"),
          form: bounds(".jd-form"),
          preview: bounds(".ats-preview"),
          grid: bounds(".jd-work-grid"),
          inset: getComputedStyle(document.querySelector(".page-content")!)
            .paddingLeft,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(geometry.inset).toBe(width <= 1100 ? "24px" : "32px");
      expect(geometry.overflow).toBe(false);
      expect(geometry.heading.x).toBe(geometry.grid.x);
      expect(geometry.grid.y - geometry.heading.bottom).toBe(24);
      expect(geometry.grid.width).toBe(geometry.heading.width);
      if (width >= 1280) {
        expect(Math.abs(geometry.form.y - geometry.preview.y)).toBeLessThan(1);
        expect(geometry.preview.x - geometry.form.right).toBeCloseTo(24, 0);
        expect(geometry.form.width / geometry.preview.width).toBeCloseTo(2, 1);
        await expect(page.locator(".sidebar")).toHaveCSS("width", "260px");
      } else expect(geometry.preview.y).toBeGreaterThan(geometry.form.bottom);
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: `docs/ui-review/task-26/${theme}-${width}-idle.png`,
        fullPage: true,
        animations: "disabled",
        style: "nextjs-portal{display:none}",
      });
      await page
        .getByLabel("Company", { exact: true })
        .fill("A very long company name ".repeat(6));
      await page
        .getByLabel("Role title")
        .fill("Senior platform and infrastructure engineer ".repeat(4));
      await page.getByLabel("Job link").fill("invalid-link");
      await page
        .getByRole("textbox", { name: "Job description", exact: true })
        .fill("Build reliable services and accessible interfaces.");
      await page
        .getByRole("button", { name: "Save draft", exact: true })
        .click();
      await expect(page.locator("#job-url-error")).toBeVisible();
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: `docs/ui-review/task-26/${theme}-${width}-error.png`,
        fullPage: true,
        animations: "disabled",
        style: "nextjs-portal{display:none}",
      });
      await page.getByLabel("Job link").fill("https://example.test/job");
      await page.route("**/api/ai/analyze-job-description", (route) =>
        route.fulfill({
          json: {
            analysis: {
              ...homeAnalysis,
              requiredQualifications: [
                "A long requirement that remains readable without overlapping the form or its actions. ".repeat(
                  4,
                ),
              ],
            },
          },
        }),
      );
      await page
        .getByRole("button", { name: "Analyze job description", exact: true })
        .click();
      await expect(page.locator(".analysis-role")).toContainText(
        homeAnalysis.targetTitle,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: `docs/ui-review/task-26/${theme}-${width}-analysis.png`,
        fullPage: true,
        animations: "disabled",
        style: "nextjs-portal{display:none}",
      });
      await page
        .getByRole("button", { name: "Clear draft", exact: true })
        .click();
    }
  });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
});

test("uses a focus-trapped mobile drawer and exposes every destination", async ({
  page,
}) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });

    const toggle = page.locator(".sidebar-toggle");
    const sidebar = page.locator("#workspace-sidebar");
    const main = page.locator("#workspace-main");

    await expect(sidebar).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-label", "Open navigation");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toHaveCSS("width", "44px");

    const closedLayout = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(closedLayout.documentWidth).toBeLessThanOrEqual(
      closedLayout.viewportWidth,
    );

    await toggle.click();

    const dialog = page.getByRole("dialog", { name: "Navigation menu" });
    const closeButton = dialog.getByRole("button", {
      name: "Close navigation",
    });
    const navigation = dialog.getByRole("navigation", {
      name: "Main navigation",
    });

    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(main).toHaveAttribute("inert", "");
    await expect(closeButton).toBeVisible();
    await expect(closeButton).toBeFocused();
    await expect(navigation.getByRole("link")).toHaveCount(5);

    const drawer = await sidebar.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
        background: getComputedStyle(element).backgroundColor,
      };
    });
    expect(drawer.width).toBeLessThanOrEqual(Math.min(280, width * 0.85) + 1);
    expect(drawer.height).toBeGreaterThanOrEqual(844);

    await page.keyboard.press("Shift+Tab");
    await expect(
      dialog.getByRole("link", { name: "Resume Changer home" }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      navigation.getByRole("link", { name: "Settings" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("link", { name: "Resume Changer home" }),
    ).toBeFocused();

    if (width === 390) {
      await closeButton.click();
      await expect(sidebar).toBeHidden();
      await expect(toggle).toBeFocused();

      await toggle.click();
      await expect(dialog).toBeVisible();
      await page.mouse.click(width - 8, 300);
      await expect(sidebar).toBeHidden();
      await expect(toggle).toBeFocused();
    } else {
      await page.keyboard.press("Escape");
      await expect(sidebar).toBeHidden();
      await expect(toggle).toBeFocused();

      await toggle.click();
      await navigation.getByRole("link", { name: "History" }).click();
      await expect(page).toHaveURL(/\/history$/);
      await expect(sidebar).toBeHidden();

      const navigatedLayout = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      }));
      expect(navigatedLayout.documentWidth).toBeLessThanOrEqual(
        navigatedLayout.viewportWidth,
      );
    }
  }
});

test("keeps the mobile drawer available in dark mode and honors reduced motion", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ reducedMotion: "reduce" });

  await page.locator(".sidebar-toggle").click();
  const sidebar = page.locator("#workspace-sidebar");
  await expect(
    page.getByRole("dialog", { name: "Navigation menu" }),
  ).toBeVisible();

  const drawerStyles = await sidebar.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      transitionDuration: style.transitionDuration,
    };
  });
  expect(drawerStyles.background).toBe("rgb(20, 17, 31)");
  expect(Number.parseFloat(drawerStyles.transitionDuration)).toBeLessThan(
    0.001,
  );
});

test("keeps all destinations available without JavaScript hydration", async ({
  browser,
  page,
}) => {
  const baseURL = new URL(page.url()).origin;
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 320, height: 844 },
  });

  try {
    const noJsPage = await context.newPage();
    await noJsPage.goto(baseURL);

    const navigation = noJsPage.getByRole("navigation", {
      name: "Main navigation",
    });
    const destinations = [
      "Job description",
      "Achievement library",
      "Resume builder",
      "History",
      "Settings",
    ];

    await expect(navigation).toBeVisible();
    for (const label of destinations) {
      await expect(navigation.getByRole("link", { name: label })).toBeVisible();
    }

    const layout = await noJsPage.evaluate(() => {
      const nav = document.querySelector(".main-navigation")!;
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        navWidth: nav.clientWidth,
        navContentWidth: nav.scrollWidth,
      };
    });
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.navContentWidth).toBeLessThanOrEqual(layout.navWidth);
  } finally {
    await context.close();
  }
});
