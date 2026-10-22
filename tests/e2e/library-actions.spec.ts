import { expect, test } from "@playwright/test";
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
