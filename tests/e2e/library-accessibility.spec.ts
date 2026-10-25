import { expect, test } from "@playwright/test";
import { copyFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The library has to be usable with a keyboard and readable with a screen
 * reader. These tests cover the parts of the page a pointer user never
 * notices: where the focus goes, what the landmarks are, and whether any
 * information only appears on hover.
 */
const libraryRoot =
  process.env.RESUME_LIBRARY_ROOT ??
  join(tmpdir(), "resume-changer-playwright-data-3010");
const personalLibraryPath = join(libraryRoot, "data", "resume-library.json");
const sampleLibraryPath = join(
  process.cwd(),
  "examples",
  "sample-resume-library.json",
);

test.beforeEach(async () => {
  await mkdir(join(libraryRoot, "data"), { recursive: true });
  await copyFile(sampleLibraryPath, personalLibraryPath);
});

/**
 * A computed duration is written in seconds or in milliseconds, so it is
 * read with its unit rather than as a bare number.
 */
function toSeconds(value: string) {
  const match = /^([\d.e+-]+)(ms|s)$/.exec(value.trim());
  if (!match) return Number.parseFloat(value) || 0;
  const amount = Number.parseFloat(match[1]);
  return match[2] === "ms" ? amount / 1000 : amount;
}

test("moves the keyboard into the editor and back out again", async ({
  page,
}) => {
  await page.goto("/library");

  const trigger = page.getByRole("button", { name: "Detailed entry" });
  await trigger.click();

  // The editor takes the keyboard, on its first field.
  await expect(page.getByLabel("Achievement ID")).toBeFocused();

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Add achievement" }),
  ).toHaveCount(0);

  // Cancelling returns the keyboard to the control that opened the editor.
  await expect(trigger).toBeFocused();
});

test("returns the keyboard to the edit action that opened the editor", async ({
  page,
}) => {
  await page.goto("/library");

  const edit = page
    .locator("article.library-point")
    .first()
    .getByRole("button", { name: "Edit" });
  await edit.click();

  await expect(page.getByLabel("Achievement text")).toBeFocused();

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(edit).toBeFocused();
});

test("moves from search to the first custom filter with a visible focus ring", async ({
  page,
}) => {
  await page.goto("/library");

  const search = page.getByRole("searchbox", { name: "Search library" });
  await search.focus();
  await search.press("Tab");

  const focused = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return null;
    const computed = getComputedStyle(active);
    return {
      outlineStyle: computed.outlineStyle,
      outlineWidth: computed.outlineWidth,
      tag: active.tagName,
      role: active.getAttribute("role"),
    };
  });

  expect(focused?.tag).toBe("BUTTON");
  expect(focused?.role).toBe("combobox");
  expect(focused?.outlineStyle).not.toBe("none");
  expect(Number.parseFloat(focused?.outlineWidth ?? "0")).toBeGreaterThan(0);
});

test("marks the current route in the navigation and the source switch", async ({
  page,
}) => {
  await page.goto("/library");

  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", {
        name: "Achievement library",
      }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "My data" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page.getByRole("link", { name: "Demo data" }),
  ).not.toHaveAttribute("aria-current", "page");
});

test("names the card category icons", async ({ page }) => {
  await page.goto("/library");

  await expect(
    page.getByRole("img", { name: "Job achievement" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Project achievement" }).first(),
  ).toBeVisible();
});

test("keeps the card information visible without a hover", async ({ page }) => {
  await page.goto("/library");

  const card = page.locator("article.library-point").first();
  await expect(card.locator(".library-point-text")).toBeVisible();
  await expect(card.locator(".point-provenance")).toBeVisible();
  await expect(card.locator(".point-status")).toBeVisible();

  // The state is carried by words, not by a colour alone.
  await expect(card.locator(".point-status")).toHaveText(/Enabled|Disabled/);
});

test("announces the result count while filtering", async ({ page }) => {
  await page.goto("/library");

  const summary = page.locator(".library-filter-summary");
  await expect(summary).toHaveAttribute("aria-live", "polite");
  await expect(summary).toContainText("13 of 13 achievement points");

  await page
    .getByRole("searchbox", { name: "Search library" })
    .fill("no matching library content");
  await expect(summary).toContainText("0 of 13 achievement points");
});

test("gives the library's own controls a thumb-sized target on a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/library");

  const chip = page.locator(".facet-chip").first();
  await expect(chip).toBeVisible();

  const height = await chip.evaluate(
    (node) => node.getBoundingClientRect().height,
  );
  expect(height).toBeGreaterThanOrEqual(44);
});

test("keeps the page still when reduced motion is asked for", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/library");

  const duration = await page
    .locator(".facet-chip")
    .first()
    .evaluate((node) => getComputedStyle(node).transitionDuration);

  // The reduced-motion rule collapses every transition to a hair.
  expect(toSeconds(duration)).toBeLessThan(0.05);
});

test("keeps inline editor focus below the sticky workbench", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/library");

  const card = page.locator("article.library-point").first();
  await card.getByRole("button", { name: "Edit" }).click();
  const field = page.getByLabel("Achievement text");
  await expect(field).toBeFocused();

  const position = await page.evaluate(() => {
    const focused = document.activeElement?.getBoundingClientRect();
    const workbench = document
      .querySelector(".library-workbench")!
      .getBoundingClientRect();
    return {
      focusedTop: focused?.top ?? -1,
      workbenchBottom: workbench.bottom,
    };
  });

  expect(position.focusedTop).toBeGreaterThanOrEqual(position.workbenchBottom);
});
