import { expect, test } from "@playwright/test";
import { waitForAnimationsToSettle } from "../helpers/animations";

/**
 * The Achievement Library board prints its active navigation row with orange
 * text on a pale orange surface in light mode and with orange text on a warm
 * deep-brown surface in dark mode. The home board keeps a violet surface for
 * the active row in dark mode, so the library treatment is scoped to the
 * library route and every other route keeps the treatment it already had.
 */
const libraryRoute = "/library";

const libraryActiveRow = {
  light: {
    color: "rgb(178, 60, 12)",
    background: "rgb(255, 233, 224)",
  },
  dark: {
    color: "rgb(255, 138, 61)",
    background: "rgb(42, 31, 23)",
    border: "rgb(79, 49, 34)",
  },
} as const;

const homeActiveRow = {
  light: {
    color: "rgb(178, 60, 12)",
    background: "rgb(255, 233, 224)",
  },
  dark: {
    color: "rgb(167, 139, 250)",
    background: "rgb(48, 35, 66)",
  },
} as const;

function parseRgb(color: string) {
  const channels = color
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number);
  if (!channels || channels.length !== 3) {
    throw new Error("Expected an RGB color, received: " + color);
  }

  return channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
}

function contrastRatio(foreground: string, background: string) {
  const luminance = (color: string) => {
    const [red, green, blue] = parseRgb(color);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };

  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function readRowStyles(link: import("@playwright/test").Locator) {
  return link.evaluate((element) => {
    const style = getComputedStyle(element);
    const icon = element.querySelector<HTMLElement>(".nav-icon");
    const iconStyle = icon ? getComputedStyle(icon) : null;
    return {
      color: style.color,
      backgroundColor: style.backgroundColor,
      borderColor: style.borderTopColor,
      borderWidth: Number.parseFloat(style.borderTopWidth),
      fontWeight: Number(style.fontWeight),
      iconColor: iconStyle?.color ?? null,
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("marks the library destination as the current route", async ({ page }) => {
  await page.goto(`${libraryRoute}?source=demo`);

  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  const libraryLink = navigation.getByRole("link", {
    name: "Achievement library",
  });

  await expect(libraryLink).toHaveAttribute("aria-current", "page");
  await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(navigation.getByRole("link")).toHaveCount(5);

  await page.reload();
  await expect(libraryLink).toHaveAttribute("aria-current", "page");
  await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);

  // The personal source renders the same route, so the active destination
  // must not depend on which library is loaded.
  await page.goto(libraryRoute);
  await expect(libraryLink).toHaveAttribute("aria-current", "page");
  await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);

  // Leaving the library hands the active state to the new route.
  await navigation.getByRole("link", { name: "Job description" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(libraryLink).not.toHaveAttribute("aria-current", "page");
  await expect(
    navigation.getByRole("link", { name: "Job description" }),
  ).toHaveAttribute("aria-current", "page");
});

test("shows the library active row with the board's orange treatment", async ({
  page,
}) => {
  await page.goto(`${libraryRoute}?source=demo`);

  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  const libraryLink = navigation.getByRole("link", {
    name: "Achievement library",
  });

  await waitForAnimationsToSettle(libraryLink);

  const lightStyles = await readRowStyles(libraryLink);
  expect(lightStyles.color).toBe(libraryActiveRow.light.color);
  expect(lightStyles.backgroundColor).toBe(libraryActiveRow.light.background);
  expect(lightStyles.iconColor).toBe(libraryActiveRow.light.color);
  expect(lightStyles.fontWeight).toBeGreaterThanOrEqual(600);
  expect(
    contrastRatio(lightStyles.color, lightStyles.backgroundColor),
  ).toBeGreaterThanOrEqual(4.5);

  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await waitForAnimationsToSettle(libraryLink);

  const darkStyles = await readRowStyles(libraryLink);
  expect(darkStyles.color).toBe(libraryActiveRow.dark.color);
  expect(darkStyles.backgroundColor).toBe(libraryActiveRow.dark.background);
  expect(darkStyles.iconColor).toBe(libraryActiveRow.dark.color);
  expect(darkStyles.borderColor).toBe(libraryActiveRow.dark.border);
  expect(darkStyles.borderWidth).toBe(1);
  expect(
    contrastRatio(darkStyles.color, darkStyles.backgroundColor),
  ).toBeGreaterThanOrEqual(4.5);
});

test("leaves the other routes' active treatment unchanged", async ({
  page,
}) => {
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  const jobDescriptionLink = navigation.getByRole("link", {
    name: "Job description",
  });

  await page.goto("/");
  await waitForAnimationsToSettle(jobDescriptionLink);

  const lightStyles = await readRowStyles(jobDescriptionLink);
  expect(lightStyles.color).toBe(homeActiveRow.light.color);
  expect(lightStyles.backgroundColor).toBe(homeActiveRow.light.background);

  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await waitForAnimationsToSettle(jobDescriptionLink);

  const darkStyles = await readRowStyles(jobDescriptionLink);
  expect(darkStyles.color).toBe(homeActiveRow.dark.color);
  expect(darkStyles.backgroundColor).toBe(homeActiveRow.dark.background);
});

test("keeps the library row focusable and visibly focused", async ({
  page,
}) => {
  await page.goto(`${libraryRoute}?source=demo`);

  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  const libraryLink = navigation.getByRole("link", {
    name: "Achievement library",
  });

  await libraryLink.focus();
  await expect(libraryLink).toBeFocused();

  const focusStyles = await libraryLink.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      outlineColor: style.outlineColor,
      backgroundColor: style.backgroundColor,
    };
  });
  expect(focusStyles.outlineStyle).toBe("solid");
  expect(focusStyles.outlineWidth).toBeGreaterThanOrEqual(3);
  expect(
    contrastRatio(focusStyles.outlineColor, focusStyles.backgroundColor),
  ).toBeGreaterThanOrEqual(3);

  // The active row stays the only current page in the navigation.
  await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
});

test("keeps the library destination reachable in the collapsed rail", async ({
  page,
}) => {
  await page.goto(`${libraryRoute}?source=demo`);

  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  const libraryLink = navigation.getByRole("link", {
    name: "Achievement library",
  });

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.locator("#workspace-sidebar")).toHaveCSS("width", "72px");

  await expect(libraryLink).toHaveAttribute("aria-current", "page");
  await expect(libraryLink).toHaveAttribute(
    "aria-label",
    "Achievement library",
  );
  await expect(libraryLink).toHaveAttribute("title", "Achievement library");
  await expect(libraryLink.locator(".nav-link-label")).toHaveText(
    "Achievement library",
  );

  await waitForAnimationsToSettle(libraryLink);
  const collapsedStyles = await readRowStyles(libraryLink);
  expect(collapsedStyles.backgroundColor).toBe(
    libraryActiveRow.light.background,
  );
  expect(collapsedStyles.color).toBe(libraryActiveRow.light.color);
});

test("keeps the library destination in the mobile navigation drawer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${libraryRoute}?source=demo`);

  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation menu" });
  await expect(drawer).toBeVisible();

  const libraryLink = drawer.getByRole("link", { name: "Achievement library" });
  await expect(libraryLink).toHaveAttribute("aria-current", "page");
  await expect(libraryLink).toBeVisible();

  const drawerStyles = await readRowStyles(libraryLink);
  expect(drawerStyles.backgroundColor).toBe(libraryActiveRow.light.background);
  expect(drawerStyles.color).toBe(libraryActiveRow.light.color);
});
