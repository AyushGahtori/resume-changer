import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Task 10 coverage for the two creation actions.
 *
 * `Add achievement` opens the Imagination Canvas and `Detailed entry` opens
 * the manual point editor. These tests lock in the presentation of both
 * actions, the focus they hand over and take back, and the rule that stops
 * a second invocation from restarting a flow that is already open.
 */

const detailedEntry = (page: Page) =>
  page.getByRole("button", { name: "Detailed entry" });
const addAchievement = (page: Page) =>
  page.getByRole("button", { name: "Add achievement", exact: true });

/** Reads a token from the document root as a resolved colour. */
async function tokenColor(page: Page, token: string) {
  return page.evaluate((name) => {
    const probe = document.createElement("div");
    probe.style.background = `var(${name})`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  }, token);
}

async function buttonStyles(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      borderRadius: style.borderRadius,
      borderWidth: style.borderTopWidth,
      color: style.color,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      gap: style.gap,
      minHeight: style.minHeight,
    };
  });
}

/** Tabs until the control takes keyboard focus, so :focus-visible applies. */
async function focusWithKeyboard(page: Page, target: Locator) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement))
      return;
  }
  throw new Error("The control never received keyboard focus.");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/library");
});

test("offers both creation actions on the personal route only", async ({
  page,
}) => {
  await expect(detailedEntry(page)).toBeVisible();
  await expect(addAchievement(page)).toBeVisible();

  await page.goto("/library?source=demo");
  await expect(detailedEntry(page)).toHaveCount(0);
  await expect(addAchievement(page)).toHaveCount(0);
});

test("presents Add achievement as the primary orange action", async ({
  page,
}) => {
  const button = addAchievement(page);
  await expect(button).toBeVisible();
  await expect(button).toHaveAccessibleName("Add achievement");
  expect(await button.evaluate((element) => element.tagName)).toBe("BUTTON");
  expect(await button.getAttribute("role")).toBeNull();

  const icon = button.locator("svg").first();
  await expect(icon).toBeVisible();
  await expect(icon).toHaveAttribute("aria-hidden", "true");
  expect(await icon.getAttribute("class")).toContain("lucide-plus");

  const iconBox = await icon.boundingBox();
  const labelBox = await button.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const text = walker.nextNode();
    if (!text) return null;
    const range = document.createRange();
    range.selectNodeContents(text);
    const rect = range.getBoundingClientRect();
    return { x: rect.x, width: rect.width };
  });
  expect(iconBox).not.toBeNull();
  expect(labelBox).not.toBeNull();
  expect(iconBox!.x).toBeLessThan(labelBox!.x);
  expect(iconBox!.x + iconBox!.width).toBeLessThanOrEqual(labelBox!.x + 1);

  const styles = await buttonStyles(button);
  expect(styles.minHeight).toBe("44px");
  expect(styles.fontSize).toBe("14px");
  expect(styles.fontWeight).toBe("600");
  expect(styles.borderRadius).toBe("6px");
  expect(styles.gap).toBe("12px");
  expect(styles.background).toBe(
    await tokenColor(page, "--action-orange-surface"),
  );
});

test("presents Detailed entry as a neutral secondary button, never a switch", async ({
  page,
}) => {
  const button = detailedEntry(page);
  await expect(button).toBeVisible();
  await expect(button).toHaveAccessibleName("Detailed entry");
  expect(await button.evaluate((element) => element.tagName)).toBe("BUTTON");
  expect(await button.getAttribute("role")).toBeNull();
  expect(await button.getAttribute("aria-checked")).toBeNull();

  const styles = await buttonStyles(button);
  expect(styles.minHeight).toBe("44px");
  expect(styles.fontSize).toBe("14px");
  expect(styles.fontWeight).toBe("600");
  expect(styles.borderWidth).toBe("1px");
  expect(styles.background).not.toBe(
    await tokenColor(page, "--action-orange-surface"),
  );
  expect(styles.background).toBe(await tokenColor(page, "--color-surface"));
});

test("moves focus into the manual editor and returns it on cancel", async ({
  page,
}) => {
  await detailedEntry(page).click();
  await expect(page.getByLabel("Achievement ID")).toBeFocused();

  await page.getByLabel("Achievement ID").fill("achievement-focus-probe");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await expect(detailedEntry(page)).toBeFocused();
  await expect(page.getByLabel("Achievement ID")).toHaveCount(0);
});

test("does not restart the manual editor on a repeated invocation", async ({
  page,
}) => {
  await detailedEntry(page).click();
  await page.getByLabel("Achievement ID").fill("achievement-duplicate-probe");

  await expect(detailedEntry(page)).toBeDisabled();
  await expect(page.getByLabel("Achievement ID")).toHaveValue(
    "achievement-duplicate-probe",
  );
});

test("moves focus into the Imagination Canvas and returns it on cancel", async ({
  page,
}) => {
  await addAchievement(page).click();
  await expect(
    page.getByRole("heading", { name: "Imagination Canvas" }),
  ).toBeVisible();
  await expect(page.getByLabel("Achievement text")).toBeFocused();
  await expect(addAchievement(page)).toBeDisabled();

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Imagination Canvas" }),
  ).toHaveCount(0);
  await expect(addAchievement(page)).toBeFocused();
});

test("keeps both actions reachable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.reload();

  const detailed = detailedEntry(page);
  const primary = addAchievement(page);
  await expect(detailed).toBeVisible();
  await expect(primary).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(
    dimensions.viewportWidth,
  );

  const detailedBox = await detailed.boundingBox();
  const primaryBox = await primary.boundingBox();
  expect(detailedBox).not.toBeNull();
  expect(primaryBox).not.toBeNull();
  // The documented stack rule puts the two actions on separate rows.
  expect(primaryBox!.y).toBeGreaterThan(detailedBox!.y);
  expect(primaryBox!.width).toBeCloseTo(detailedBox!.width, 0);
});

test("deepens the primary action on hover and mutes both when disabled", async ({
  page,
}) => {
  const primary = addAchievement(page);
  const restBackground = (await buttonStyles(primary)).background;

  /*
   * The action colours transition over 120ms, so each state is read once the
   * transition has settled rather than in the middle of it.
   */
  await primary.hover();
  const hoverBackground = await tokenColor(
    page,
    "--action-orange-surface-hover",
  );
  await expect
    .poll(async () => (await buttonStyles(primary)).background)
    .toBe(hoverBackground);
  expect(hoverBackground).not.toBe(restBackground);

  // The pressed state deepens the fill again while the pointer is down.
  const box = await primary.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  const pressedBackground = await tokenColor(
    page,
    "--action-orange-surface-pressed",
  );
  await expect
    .poll(async () => (await buttonStyles(primary)).background)
    .toBe(pressedBackground);
  expect(pressedBackground).not.toBe(hoverBackground);
  await page.mouse.up();

  // The press also completes a click, which opens the Imagination Canvas.
  await expect(primary).toBeDisabled();
  const disabledBackground = await tokenColor(
    page,
    "--action-orange-surface-disabled",
  );
  await expect
    .poll(async () => (await buttonStyles(primary)).background)
    .toBe(disabledBackground);
  expect(disabledBackground).not.toBe(restBackground);

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(primary).toBeEnabled();

  const secondary = detailedEntry(page);
  const enabledSecondary = await buttonStyles(secondary);
  await secondary.click();
  await expect(secondary).toBeDisabled();
  await expect
    .poll(async () => (await buttonStyles(secondary)).background)
    .not.toBe(enabledSecondary.background);
  const disabledSecondary = await buttonStyles(secondary);
  expect(disabledSecondary.color).not.toBe(enabledSecondary.color);
});

test("shows a visible focus ring on both actions", async ({ page }) => {
  await focusWithKeyboard(page, detailedEntry(page));
  await expect(detailedEntry(page)).toBeFocused();
  const detailedOutline = await detailedEntry(page).evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      matches: element.matches(":focus-visible"),
      width: style.outlineWidth,
      style: style.outlineStyle,
    };
  });
  expect(detailedOutline.matches).toBe(true);
  expect(parseFloat(detailedOutline.width)).toBeGreaterThan(0);
  expect(detailedOutline.style).not.toBe("none");

  await focusWithKeyboard(page, addAchievement(page));
  await expect(addAchievement(page)).toBeFocused();
  const primaryOutline = await addAchievement(page).evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      matches: element.matches(":focus-visible"),
      width: style.outlineWidth,
      style: style.outlineStyle,
    };
  });
  expect(primaryOutline.matches).toBe(true);
  expect(parseFloat(primaryOutline.width)).toBeGreaterThan(0);
  expect(primaryOutline.style).not.toBe("none");
});
