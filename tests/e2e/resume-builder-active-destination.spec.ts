import { expect, test } from "@playwright/test";
import { waitForAnimationsToSettle } from "../helpers/animations";

/**
 * The sidebar is shared by every route, so the builder route has to mark
 * itself as the current destination and keep the established active
 * treatment: orange text and icon on a restrained soft background, in both
 * themes, while the other destinations stay neutral.
 */

async function readActiveTreatment(page: import("@playwright/test").Page) {
  return page.locator("html").evaluate((root) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--accent-hover)";
    probe.style.backgroundColor = "var(--accent-soft)";
    root.append(probe);
    const theme = getComputedStyle(probe);
    const treatment = {
      color: theme.color,
      background: theme.backgroundColor,
    };
    probe.remove();
    return treatment;
  });
}

test("marks Resume builder as the current destination on the builder route", async ({
  page,
}) => {
  await page.goto("/generate");

  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  const active = navigation.getByRole("link", { name: "Resume builder" });

  await expect(active).toHaveAttribute("aria-current", "page");
  await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(navigation.getByRole("link")).toHaveCount(5);
  await expect(
    navigation.getByRole("link", { name: "Job description" }),
  ).not.toHaveAttribute("aria-current", "page");
});

test("keeps the active destination orange and the other rows neutral in both themes", async ({
  page,
}) => {
  await page.goto("/generate");

  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  const active = navigation.getByRole("link", { name: "Resume builder" });
  const inactive = navigation.getByRole("link", { name: "Job description" });

  for (const theme of ["light", "dark"] as const) {
    if (theme === "dark") {
      await page.getByRole("button", { name: "Switch to dark mode" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    }
    await waitForAnimationsToSettle(active);
    const treatment = await readActiveTreatment(page);

    await expect(active).toHaveCSS("color", treatment.color);
    await expect(active).toHaveCSS("background-color", treatment.background);
    await expect(active.locator(".nav-icon")).toHaveCSS(
      "color",
      treatment.color,
    );

    await expect(inactive).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const inactiveColor = await inactive.evaluate(
      (element) => getComputedStyle(element).color,
    );
    expect(inactiveColor).not.toBe(treatment.color);
  }
});

test("keeps the active destination marked inside the mobile navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/generate");
  await page.getByRole("button", { name: "Open navigation" }).click();

  const dialog = page.getByRole("dialog", { name: "Navigation menu" });
  await expect(dialog).toBeVisible();
  const active = dialog.getByRole("link", { name: "Resume builder" });
  await expect(active).toHaveAttribute("aria-current", "page");
  await expect(dialog.locator('[aria-current="page"]')).toHaveCount(1);
  const treatment = await readActiveTreatment(page);
  await expect(active).toHaveCSS("color", treatment.color);
});

test("keeps a visible focus ring on the active destination", async ({
  page,
}) => {
  await page.goto("/generate");

  const active = page.getByRole("link", { name: "Resume builder" });
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press("Tab");
    const focused = await active.evaluate(
      (element) => element === document.activeElement,
    );
    if (focused) break;
  }
  await expect(active).toBeFocused();

  const outline = await active.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      style: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(outline.style).toBe("solid");
  expect(outline.width).toBeGreaterThanOrEqual(2);
});
