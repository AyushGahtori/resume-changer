import { expect, test, type Locator } from "@playwright/test";
import { openStudio } from "../helpers/studio-browser";

const px = (value: string) => Number.parseFloat(value);

/** Largest blur radius used by a computed `box-shadow` list. */
function shadowBlur(boxShadow: string) {
  if (!boxShadow || boxShadow === "none") return 0;
  return boxShadow
    .split(/,(?![^(]*\))/)
    .map((layer) => layer.match(/(-?[\d.]+)px/g) ?? [])
    .map((lengths) => {
      const numbers = lengths.map((length) => px(length));
      // An unprefixed box-shadow is offset-x offset-y blur radius spread.
      return numbers.length >= 3 ? numbers[2] : 0;
    })
    .reduce((largest, blur) => Math.max(largest, blur), 0);
}

async function styleOf(locator: Locator, property: string) {
  return locator.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  );
}

test.describe("Resume Builder geometry", () => {
  test("major surfaces and controls share one radius scale", async ({
    page,
  }) => {
    await openStudio(page, false);

    const studio = page.locator(".resume-studio");
    await expect(studio).toBeVisible();
    expect(px(await styleOf(studio, "border-radius"))).toBeLessThanOrEqual(8);
    expect(await styleOf(studio, "border-top-width")).toBe("1px");

    const navigation = page.locator(".studio-navigation button").first();
    expect(px(await styleOf(navigation, "border-radius"))).toBe(6);

    // The Skills tab carries the search field, filter pills, and skill rows.
    await page
      .locator(".studio-navigation button[aria-label='Skills']")
      .click();

    const controls = [
      page.locator(".studio-field input").first(),
      page.locator(".studio-skill-option").first(),
    ];
    for (const control of controls) {
      await expect(control).toBeVisible();
      expect(px(await styleOf(control, "border-radius"))).toBe(6);
    }

    // Full rounding is reserved for chips, pills, and small round backgrounds.
    const badge = page.locator(".studio-badge").first();
    await expect(badge).toBeVisible();
    expect(px(await styleOf(badge, "border-radius"))).toBeGreaterThanOrEqual(
      999,
    );
  });

  test("the panel header is one surface, not a second card", async ({
    page,
  }) => {
    await openStudio(page, false);

    const heading = page.locator(".studio-heading");
    await expect(heading).toBeVisible();
    expect(await styleOf(heading, "background-image")).toBe("none");
    expect(px(await styleOf(heading, "padding-top"))).toBe(24);
    expect(px(await styleOf(heading, "padding-left"))).toBe(24);

    const studio = page.locator(".resume-studio");
    const studioSurface = await styleOf(studio, "background-color");
    expect(await styleOf(heading, "background-color")).toBe(studioSurface);
  });

  test("selection rows use the card radius and the shared gutter", async ({
    page,
  }) => {
    await openStudio(page, false);

    const card = page.locator(".studio-achievement-card").first();
    await expect(card).toBeVisible();
    expect(px(await styleOf(card, "border-radius"))).toBeLessThanOrEqual(8);
    expect(px(await styleOf(card, "padding-left"))).toBe(48);
    expect(await styleOf(card, "box-shadow")).toBe("none");
  });

  test("a major surface carries only the subtle light shadow", async ({
    page,
  }) => {
    await openStudio(page, false);

    const studio = page.locator(".resume-studio");
    const lightShadow = await styleOf(studio, "box-shadow");
    expect(lightShadow).not.toBe("none");
    expect(shadowBlur(lightShadow)).toBeLessThanOrEqual(4);

    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    expect(await styleOf(studio, "box-shadow")).toBe("none");

    // In dark mode the studio is separated by tone and border, not by a glow.
    const studioSurface = await styleOf(studio, "background-color");
    const canvas = await styleOf(page.locator("body"), "background-color");
    expect(studioSurface).not.toBe(canvas);
    expect(await styleOf(studio, "border-top-width")).toBe("1px");
  });

  test("toolbar controls keep their dimensions across states", async ({
    page,
  }) => {
    await openStudio(page, false);
    await page
      .locator(".studio-navigation button[aria-label='Skills']")
      .click();

    const filter = page.locator(".studio-filters button", {
      hasText: "Included",
    });
    await expect(filter).toBeVisible();
    const filterBefore = await filter.boundingBox();
    const toolbarBefore = await page.locator(".studio-filters").boundingBox();

    await filter.click();
    await expect(filter).toHaveAttribute("aria-pressed", "true");

    const filterAfter = await filter.boundingBox();
    const toolbarAfter = await page.locator(".studio-filters").boundingBox();
    expect(filterAfter?.height).toBe(filterBefore?.height);
    expect(filterAfter?.width).toBe(filterBefore?.width);
    expect(toolbarAfter?.height).toBe(toolbarBefore?.height);

    await page.locator(".studio-filters button", { hasText: "All" }).click();
    await expect(
      page.locator(".studio-filters button", { hasText: "All" }),
    ).toHaveAttribute("aria-pressed", "true");

    // Selecting a skill changes its state, but each skill row keeps its
    // dimensions so the group does not jump.
    const skillRowHeights = await page
      .locator(".studio-skill-option")
      .evaluateAll((nodes) =>
        nodes.map((node) => Math.round(node.getBoundingClientRect().height)),
      );
    expect(skillRowHeights.length).toBeGreaterThan(1);
    expect(skillRowHeights.every((height) => height >= 40)).toBe(true);
  });

  test("narrow layouts reduce insets instead of scrolling sideways", async ({
    page,
  }) => {
    await openStudio(page, false);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);

    const editor = page.locator(".studio-editor");
    await expect(editor).toBeVisible();
    expect(px(await styleOf(editor, "padding-left"))).toBeLessThanOrEqual(16);

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
