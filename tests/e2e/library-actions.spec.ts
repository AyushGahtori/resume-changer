import { expect, test, type Locator, type Page } from "@playwright/test";
import { copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

  const rgbMatch = normalized.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i,
  );

  if (rgbMatch) {
    return [
      Number.parseInt(rgbMatch[1], 10),
      Number.parseInt(rgbMatch[2], 10),
      Number.parseInt(rgbMatch[3], 10),
    ];
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

function toRgbString([red, green, blue]: Rgb) {
  return `rgb(${red}, ${green}, ${blue})`;
}

const libraryRoot =
  process.env.RESUME_LIBRARY_ROOT ??
  join(tmpdir(), "resume-changer-playwright-data-3010");

test.beforeEach(async ({ page }) => {
  await copyFile(
    join(process.cwd(), "examples", "sample-resume-library.json"),
    join(libraryRoot, "data", "resume-library.json"),
  );
  await page.goto("/library");
});

test("renders the add achievement action as a primary control with a leading plus icon", async ({
  page,
}) => {
  const add = page.getByRole("button", {
    name: "Add achievement",
    exact: true,
  });
  await expect(add).toBeVisible();
  await expect(add.locator("svg")).toHaveCount(1);
  await expect(add.locator("svg")).toHaveAttribute("aria-hidden", "true");

  // The icon precedes the label so the reading order matches the reference.
  const iconPrecedesLabel = await add.evaluate((button) => {
    const children = Array.from(button.childNodes);
    const iconIndex = children.findIndex(
      (node) => node.nodeName.toLowerCase() === "svg",
    );
    const labelIndex = children.findIndex(
      (node) =>
        node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
    );
    return iconIndex !== -1 && labelIndex !== -1 && iconIndex < labelIndex;
  });
  expect(iconPrecedesLabel).toBe(true);

  const box = await add.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);

  // The entry points sit 12px apart, matching the shared control rhythm.
  const detailed = page.getByRole("button", { name: "Detailed entry" });
  const detailedBox = await detailed.boundingBox();
  const addBox = await add.boundingBox();
  expect(detailedBox).not.toBeNull();
  expect(Math.round(addBox!.x - (detailedBox!.x + detailedBox!.width))).toBe(
    12,
  );
});

test("keeps the primary action readable in both themes", async ({ page }) => {
  const add = page.getByRole("button", {
    name: "Add achievement",
    exact: true,
  });

  const readState = () =>
    add.evaluate((button) => {
      const style = getComputedStyle(button);
      const root = getComputedStyle(document.documentElement);
      return {
        background: style.backgroundColor,
        color: style.color,
        opacity: style.opacity,
        idleBackgroundToken: root.getPropertyValue("--color-orange").trim(),
        idleTextToken: root.getPropertyValue("--color-text-on-orange").trim(),
        hoverBackgroundToken: root
          .getPropertyValue("--color-orange-strong")
          .trim(),
        hoverTextToken: root
          .getPropertyValue("--color-text-on-orange-hover")
          .trim(),
      };
    });

  const assertPrimaryContrast = async () => {
    const colors = await readState();
    expect(colors.opacity).toBe("1");
    expect(
      contrastRatio(
        parseCssColor(colors.color),
        parseCssColor(colors.background),
      ),
    ).toBeGreaterThanOrEqual(4.5);
  };

  const exerciseTheme = async (theme: "light" | "dark") => {
    // The theme is applied on the client, so wait for the document to carry
    // one before the current theme is read.
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      /^(light|dark)$/,
    );
    const currentTheme = await page.locator("html").getAttribute("data-theme");
    if (currentTheme !== theme) {
      await page
        .getByRole("button", { name: "Switch to " + theme + " mode" })
        .click();
    }

    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

    // Park the pointer away from the action so the idle treatment is the
    // one that gets measured.
    await page.mouse.move(0, 0);
    const idle = await readState();
    await expect
      .poll(async () => (await readState()).background)
      .toBe(toRgbString(parseCssColor(idle.idleBackgroundToken)));
    await expect
      .poll(async () => (await readState()).color)
      .toBe(toRgbString(parseCssColor(idle.idleTextToken)));
    await assertPrimaryContrast();

    await add.hover();
    // The hover treatment is transitioned, so wait for it to settle before
    // the colours are compared.
    await expect
      .poll(async () => (await readState()).background)
      .toBe(toRgbString(parseCssColor(idle.hoverBackgroundToken)));
    await expect
      .poll(async () => (await readState()).color)
      .toBe(toRgbString(parseCssColor(idle.hoverTextToken)));
    await assertPrimaryContrast();
  };

  await exerciseTheme("light");
  await exerciseTheme("dark");
});

test("renders the point edit action as a compact tertiary control with a pencil icon", async ({
  page,
}) => {
  const point = page.locator(".library-point").first();
  const edit = point.getByRole("button", { name: "Edit" });

  await expect(edit).toBeVisible();
  await expect(edit).toHaveText("Edit");
  await expect(edit.locator("svg")).toHaveCount(1);
  await expect(edit.locator("svg")).toHaveAttribute("aria-hidden", "true");

  const styles = await edit.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      borderStyle: style.borderTopStyle,
      borderWidth: style.borderTopWidth,
      minHeight: style.minHeight,
    };
  });

  // A tertiary control keeps a thin border on a transparent surface.
  expect(styles.background).toBe("rgba(0, 0, 0, 0)");
  expect(styles.borderStyle).toBe("solid");
  expect(styles.borderWidth).toBe("1px");
  // The compact tier keeps the shared 40-44px visual button height.
  expect(Number.parseInt(styles.minHeight, 10)).toBeGreaterThanOrEqual(40);
  expect(Number.parseInt(styles.minHeight, 10)).toBeLessThanOrEqual(44);
});

test("shows a visible violet focus ring on the library actions", async ({
  page,
}) => {
  const add = page.getByRole("button", {
    name: "Add achievement",
    exact: true,
  });
  await add.focus();

  const focus = await add.evaluate((button) => {
    const style = getComputedStyle(button);
    const rootStyle = getComputedStyle(document.documentElement);

    return {
      color: style.outlineColor,
      offset: style.outlineOffset,
      style: style.outlineStyle,
      surface: rootStyle.getPropertyValue("--color-surface").trim(),
      width: style.outlineWidth,
      token: rootStyle.getPropertyValue("--color-focus-ring").trim(),
    };
  });

  expect(focus.style).toBe("solid");
  expect(focus.width).toBe("2px");
  expect(focus.offset).toBe("2px");
  expect(parseCssColor(focus.color)).toEqual(parseCssColor(focus.token));

  const ringContrast = contrastRatio(
    parseCssColor(focus.color),
    parseCssColor(focus.surface),
  );
  expect(ringContrast).toBeGreaterThanOrEqual(3);
});

test("presses an action without resizing it or moving its neighbours", async ({
  page,
}) => {
  const add = page.getByRole("button", {
    name: "Add achievement",
    exact: true,
  });
  const detailed = page.getByRole("button", { name: "Detailed entry" });

  const layout = await add.evaluate((element) => ({
    width: (element as HTMLElement).offsetWidth,
    height: (element as HTMLElement).offsetHeight,
  }));
  const detailedBefore = await detailed.boundingBox();
  expect(detailedBefore).not.toBeNull();

  await add.hover();
  await page.mouse.down();
  await expect
    .poll(() => add.evaluate((element) => getComputedStyle(element).transform))
    .not.toBe("none");

  const pressed = await add.evaluate((element) => ({
    width: (element as HTMLElement).offsetWidth,
    height: (element as HTMLElement).offsetHeight,
    transform: getComputedStyle(element).transform,
  }));
  // The pressed state scales the control visually, but the layout box keeps
  // its size so nothing around it shifts.
  expect(pressed.width).toBe(layout.width);
  expect(pressed.height).toBe(layout.height);
  expect(pressed.transform).toContain("0.98");

  const detailedWhilePressed = await detailed.boundingBox();
  expect(detailedWhilePressed!.x).toBeCloseTo(detailedBefore!.x, 1);
  expect(detailedWhilePressed!.y).toBeCloseTo(detailedBefore!.y, 1);

  // Release the pointer away from the button so the press does not open the
  // flow this action names.
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await expect
    .poll(() => add.evaluate((element) => getComputedStyle(element).transform))
    .toBe("none");

  const detailedAfter = await detailed.boundingBox();
  expect(detailedAfter!.x).toBeCloseTo(detailedBefore!.x, 1);
  expect(detailedAfter!.y).toBeCloseTo(detailedBefore!.y, 1);
});

test("gives the icon-only editor control an accessible name and a tooltip", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Detailed entry" }).click();

  const close = page.getByRole("button", { name: "Cancel editing" });
  await expect(close).toBeVisible();
  await expect(close).toHaveAttribute("title", "Cancel editing");
  await expect(close.locator("svg")).toHaveCount(1);
  await expect(close.locator("svg")).toHaveAttribute("aria-hidden", "true");
  await expect(close).toHaveText("");

  const closeBox = await close.boundingBox();
  expect(closeBox).not.toBeNull();
  expect(closeBox!.width).toBeGreaterThanOrEqual(40);
  expect(closeBox!.height).toBeGreaterThanOrEqual(40);
});

test("keeps the save action honestly disabled while the save is pending", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Detailed entry" }).click();
  await page.getByLabel("Achievement ID").fill("achievement-actions-pending");
  await page
    .getByLabel("Achievement text")
    .fill("Synthetic pending save state.");

  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/api\/library\/points$/, async (route) => {
    await gate;
    await route.continue();
  });

  await page.getByRole("button", { name: "Save achievement" }).click();

  const pending = page.getByRole("button", { name: "Saving…" });
  await expect(pending).toBeDisabled();
  // A pending action must not keep the enabled primary treatment.
  await expect(pending).not.toHaveCSS("background-color", "rgb(249, 115, 22)");
  await expect(pending).toHaveCSS("background-color", "rgb(241, 245, 249)");

  release();
  await expect(page.getByText("Saved to your local library.")).toBeVisible();
});

test("opens the flow each library action names", async ({ page }) => {
  await page.getByRole("button", { name: "Detailed entry" }).click();
  await expect(
    page.getByRole("heading", { name: "Add achievement" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel editing" }).click();

  const point = page.locator(".library-point").first();
  await point.getByRole("button", { name: "Edit" }).click();
  await expect(
    page.getByRole("heading", { name: "Edit achievement" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel editing" }).click();

  await page
    .getByRole("button", { name: "Add achievement", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Imagination Canvas" }),
  ).toBeVisible();
});

test("does not offer favorite, delete, or unlabelled library controls", async ({
  page,
}) => {
  await expect(page.getByRole("button", { name: /favorite/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /delete/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /heart/i })).toHaveCount(0);

  // Every library button carries a visible text label, so no control is
  // announced only by an icon.
  const unlabelled = await page
    .locator(".library-page button")
    .evaluateAll((buttons) =>
      buttons
        .filter(
          (button) =>
            !(button.textContent ?? "").trim() &&
            !button.getAttribute("aria-label"),
        )
        .map((button) => button.className),
    );
  expect(unlabelled).toEqual([]);
});

test("keeps the library actions inside a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.reload();

  for (const name of ["Detailed entry", "Add achievement"]) {
    const button = page.getByRole("button", { name });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  }

  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(0);
});

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
