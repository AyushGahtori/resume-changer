import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";

const canvasPath = "/library/imagination";

async function openIntegratedCanvas(page: Page) {
  await page.goto(canvasPath);
  await expect(
    page.getByRole("heading", { name: "Imagination Canvas", exact: true }),
  ).toBeVisible();
}

async function connectFirstAchievementByKeyboard(page: Page) {
  const achievements = page.getByRole("region", { name: /achievements/i });
  const firstAchievement = achievements.getByRole("button").first();

  await expect(firstAchievement).toBeVisible();
  await expect(firstAchievement).toBeEnabled();
  await firstAchievement.focus();
  await firstAchievement.press("Space");
  await expect(firstAchievement).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("status").filter({ hasText: /1\s*\/\s*10 connected/i }),
  ).toBeVisible();

  return firstAchievement;
}

async function setTheme(page: Page, theme: "light" | "dark") {
  const root = page.locator("html");
  const currentTheme = await root.getAttribute("data-theme");

  if (currentTheme !== theme) {
    await page.getByRole("button", { name: `Switch to ${theme} mode` }).click();
  }

  await expect(root).toHaveAttribute("data-theme", theme);
}

test("keeps the particle cue one-shot, non-interactive, and static for reduced motion", async ({
  page,
}) => {
  await page.goto("/library?source=demo");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addStyleTag({
    path: join(process.cwd(), "src/components/imagination-canvas-motion.css"),
  });

  await page.evaluate(() => {
    const overlay = document.createElement("div");
    overlay.id = "motion-contract-fixture";
    overlay.className = "imagination-canvas-motion";
    overlay.dataset.active = "false";
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.cssText = "position: relative; width: 240px; height: 80px;";

    const arrow = document.createElement("span");
    arrow.className = "imagination-canvas-motion__arrow";
    arrow.textContent = String.fromCharCode(8593);
    overlay.append(arrow);
    document.body.append(overlay);
  });

  const overlay = page.locator("#motion-contract-fixture");
  const arrow = overlay.locator(".imagination-canvas-motion__arrow");

  await expect
    .poll(() =>
      arrow.evaluate((element) => getComputedStyle(element).animationName),
    )
    .toBe("none");

  await overlay.evaluate((element) => {
    (element as HTMLElement).dataset.active = "true";
  });

  const activeMotion = await arrow.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      animationName: style.animationName,
      iterationCount: style.animationIterationCount,
    };
  });
  expect(activeMotion.animationName).toBe("imagination-canvas-arrow-rise");
  expect(activeMotion.iterationCount).toBe("1");
  await expect
    .poll(() =>
      overlay.evaluate((element) => getComputedStyle(element).pointerEvents),
    )
    .toBe("none");

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedMotion = await arrow.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      animationName: style.animationName,
      opacity: Number.parseFloat(style.opacity),
    };
  });
  expect(reducedMotion.animationName).toBe("none");
  expect(reducedMotion.opacity).toBeGreaterThan(0);
});

test("opens as a standalone page and captures responsive light and dark views", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openIntegratedCanvas(page);
  await connectFirstAchievementByKeyboard(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const viewports = [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "mobile", width: 390, height: 844 },
  ] as const;

  for (const viewport of viewports) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });

    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);

      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(
        dimensions.clientWidth,
      );

      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: testInfo.outputPath(
          `imagination-canvas-${viewport.name}-${theme}.png`,
        ),
        fullPage: true,
      });
    }
  }

  await page.evaluate(() => {
    document.documentElement.style.zoom = "125%";
  });
  const zoomedDimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(zoomedDimensions.scrollWidth).toBeLessThanOrEqual(
    zoomedDimensions.clientWidth,
  );
});

test("connects and removes achievement context with the keyboard and announces the count", async ({
  page,
}) => {
  await openIntegratedCanvas(page);
  const firstAchievement = await connectFirstAchievementByKeyboard(page);

  const canvas = page.getByRole("region", { name: /connection canvas/i });
  const connectedItem = canvas.getByRole("button").first();
  await connectedItem.focus();
  await connectedItem.press("Enter");

  await expect(firstAchievement).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("status").filter({ hasText: /0\s*\/\s*10 connected/i }),
  ).toBeVisible();
});

test("keeps the connected-context cue still under reduced-motion preferences", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openIntegratedCanvas(page);
  await connectFirstAchievementByKeyboard(page);

  const arrows = page.locator(".imagination-canvas-motion__arrow");
  await expect(arrows.first()).toBeVisible();

  const state = await arrows.first().evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      animationName: style.animationName,
      opacity: Number.parseFloat(style.opacity),
    };
  });
  expect(state.animationName).toBe("none");
  expect(state.opacity).toBeGreaterThan(0);
});
