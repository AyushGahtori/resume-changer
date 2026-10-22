import { expect, test, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Task 24 "Style tags, linked skills, and overflow chips".
 *
 * The card chips are the fastest way into a filtered library, so they have
 * to stay readable, stay distinguishable from each other, and never hide a
 * label behind a count that cannot be opened.
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

const LONG_TAG = "cross-functional-platform-reliability-and-observability";

/**
 * Ten distinct chips once the repeated `backend` tag is removed, which is
 * more than the card shows at once.
 */
const OVERFLOW_TAGS = [
  "backend",
  "backend",
  "api-design",
  LONG_TAG,
  "documentation",
  "distributed-systems",
  "data-pipeline",
  "quality",
  "release-engineering",
];

const OVERFLOW_SKILLS = ["skill-typescript", "skill-rest-apis"];

async function writeLibraryWithOverflowPoint() {
  const library = JSON.parse(await readFile(sampleLibraryPath, "utf8"));
  const job = library.jobs.find(
    (item: { id: string }) => item.id === "job-sampleworks-studio",
  );
  const point = job.points.find(
    (item: { id: string }) => item.id === "achievement-orders-api",
  );
  point.tags = OVERFLOW_TAGS;
  point.skillIds = OVERFLOW_SKILLS;
  await writeFile(personalLibraryPath, JSON.stringify(library, null, 2));
}

function pointCard(page: Page, pointId: string) {
  return page.locator(".library-point").filter({ hasText: pointId });
}

function relativeLuminance(color: string) {
  const channels = color
    .match(/\d+(\.\d+)?/g)
    ?.slice(0, 3)
    .map(Number);
  if (!channels || channels.length < 3) {
    throw new Error(`Unsupported color value: ${color}`);
  }
  const linear = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground: string, background: string) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

test("renders tags and linked skills as distinct chips", async ({ page }) => {
  await page.goto("/library?source=demo");

  const card = pointCard(page, "achievement-cloud-deployment-platform");
  await expect(
    card.getByRole("button", { name: "Filter by #aws" }),
  ).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Filter by skill Amazon Web Services" }),
  ).toBeVisible();
  await expect(
    card.getByRole("button", {
      name: "Filter by skill Infrastructure as Code",
    }),
  ).toBeVisible();

  // The skill name is shown, never the skill ID.
  await expect(card.getByText("skill-aws")).toHaveCount(0);
  await expect(card.locator(".facet-chip.is-skill")).toHaveCount(2);
  await expect(card.locator(".facet-chip.is-tag")).toHaveCount(3);

  const colors = await card.evaluate((element) => {
    const tag = element.querySelector(".facet-chip.is-tag")!;
    const skill = element.querySelector(".facet-chip.is-skill")!;
    return {
      tagBackground: getComputedStyle(tag).backgroundColor,
      tagText: getComputedStyle(tag).color,
      skillBackground: getComputedStyle(skill).backgroundColor,
      skillText: getComputedStyle(skill).color,
    };
  });
  expect(colors.tagBackground).not.toBe(colors.skillBackground);
  expect(colors.tagText).not.toBe(colors.skillText);
});

test("filters the library from a tag chip and shows the selected state", async ({
  page,
}) => {
  await page.goto("/library?source=demo");

  const card = pointCard(page, "achievement-ci-cd-pipeline");
  const chip = card.getByRole("button", { name: "Filter by #automation" });
  await chip.click();

  await expect(page.getByLabel("Tag")).toHaveValue("automation");
  await expect(page.locator(".library-filter-summary")).toContainText(
    "3 of 13 achievement points",
  );
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(chip).toHaveAttribute("aria-label", "Filter by #automation");
});

test("filters the library from a linked skill chip", async ({ page }) => {
  await page.goto("/library?source=demo");

  const card = pointCard(page, "achievement-orders-api");
  const chip = card.getByRole("button", { name: "Filter by skill TypeScript" });
  await chip.click();

  await expect(page.getByLabel("Linked skill")).toHaveValue("skill-typescript");
  await expect(page.locator(".library-filter-summary")).toContainText(
    "2 of 13 achievement points",
  );
  await expect(chip).toHaveAttribute("aria-pressed", "true");
});

test("activates a chip with the keyboard", async ({ page }) => {
  await page.goto("/library?source=demo");

  const card = pointCard(page, "achievement-orders-api");
  const chip = card.getByRole("button", {
    name: "Filter by skill REST API Design",
  });
  await chip.press("Enter");

  await expect(page.getByLabel("Linked skill")).toHaveValue("skill-rest-apis");
  await expect(chip).toHaveAttribute("aria-pressed", "true");
});

test("reveals every hidden chip through the overflow disclosure", async ({
  page,
}) => {
  await writeLibraryWithOverflowPoint();
  await page.goto("/library");

  const card = pointCard(page, "achievement-orders-api");
  const chips = card.locator(".facet-chip:not(.is-more)");
  const more = card.locator(".facet-chip.is-more");

  await expect(chips).toHaveCount(6);
  await expect(more).toHaveText("+4");
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(more).toHaveAttribute("aria-label", "+4 more filters");
  await expect(
    card.getByRole("button", { name: "Filter by #release-engineering" }),
  ).toHaveCount(0);

  await more.click();

  // Every hidden label is now readable, and the repeated tag is still
  // shown only once.
  await expect(chips).toHaveCount(10);
  await expect(
    card.getByRole("button", { name: "Filter by #release-engineering" }),
  ).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Filter by #backend" }),
  ).toHaveCount(1);
  await expect(more).toHaveText("Show less");
  await expect(more).toHaveAttribute("aria-expanded", "true");

  await more.click();
  await expect(chips).toHaveCount(6);
  await expect(more).toHaveText("+4");
});

test("keeps a long tag label readable on a narrow viewport", async ({
  page,
}) => {
  await writeLibraryWithOverflowPoint();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/library");

  const card = pointCard(page, "achievement-orders-api");
  const chip = card.getByRole("button", { name: `Filter by #${LONG_TAG}` });
  await expect(chip).toBeVisible();
  await expect(chip).toContainText(LONG_TAG);

  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(
    dimensions.viewportWidth,
  );

  const chipBox = await chip.boundingBox();
  expect(chipBox!.x).toBeGreaterThanOrEqual(0);
  expect(chipBox!.x + chipBox!.width).toBeLessThanOrEqual(390);
});

test("keeps the card chips free of removable affordances", async ({ page }) => {
  await page.goto("/library?source=demo");

  const card = pointCard(page, "achievement-orders-api");
  const chipCount = await card.locator(".facet-chip").count();
  const buttonCount = await card.locator(".point-facets button").count();
  expect(buttonCount).toBe(chipCount);
  await expect(card.getByRole("button", { name: /remove/i })).toHaveCount(0);
  await expect(card.getByRole("button", { name: /delete/i })).toHaveCount(0);
});

test("renders chips with the compact chip treatment", async ({ page }) => {
  await page.goto("/library?source=demo");

  const card = pointCard(page, "achievement-orders-api");
  const metrics = await card
    .locator(".facet-chip.is-tag")
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        height: element.getBoundingClientRect().height,
        radius: parseFloat(style.borderTopLeftRadius),
        fontSize: parseFloat(style.fontSize),
        paddingLeft: parseFloat(style.paddingLeft),
        paddingRight: parseFloat(style.paddingRight),
      };
    });

  expect(metrics.height).toBeGreaterThanOrEqual(24);
  expect(metrics.height).toBeLessThanOrEqual(30);
  expect(metrics.radius).toBeGreaterThanOrEqual(metrics.height / 2);
  expect(metrics.fontSize).toBeGreaterThanOrEqual(11);
  expect(metrics.fontSize).toBeLessThanOrEqual(12);
  expect(metrics.paddingLeft).toBeCloseTo(8, 0);
  expect(metrics.paddingRight).toBeCloseTo(8, 0);

  const gap = await card.locator(".point-facets").evaluate((row) => {
    const chips = row.querySelectorAll(".facet-chip");
    const first = chips[0].getBoundingClientRect();
    const second = chips[1].getBoundingClientRect();
    return second.left - first.right;
  });
  expect(gap).toBeGreaterThanOrEqual(6);
  expect(gap).toBeLessThanOrEqual(8);
});

test("keeps the chip contrast readable in both themes", async ({ page }) => {
  await page.goto("/library?source=demo");

  const card = pointCard(page, "achievement-orders-api");

  const readColors = () =>
    card.evaluate((element) => {
      const tag = element.querySelector(".facet-chip.is-tag")!;
      const skill = element.querySelector(".facet-chip.is-skill")!;
      return {
        tagBackground: getComputedStyle(tag).backgroundColor,
        tagText: getComputedStyle(tag).color,
        skillBackground: getComputedStyle(skill).backgroundColor,
        skillText: getComputedStyle(skill).color,
      };
    });

  const light = await readColors();
  expect(
    contrastRatio(light.tagText, light.tagBackground),
  ).toBeGreaterThanOrEqual(4.5);
  expect(
    contrastRatio(light.skillText, light.skillBackground),
  ).toBeGreaterThanOrEqual(4.5);

  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const dark = await readColors();
  expect(
    contrastRatio(dark.tagText, dark.tagBackground),
  ).toBeGreaterThanOrEqual(4.5);
  expect(
    contrastRatio(dark.skillText, dark.skillBackground),
  ).toBeGreaterThanOrEqual(4.5);
  expect(dark.tagBackground).not.toBe(dark.skillBackground);
});
