import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const longBullet =
  "Rebuilt the multi-region deployment pipeline so that a single reviewed pull request now rolls out to every availability zone, cutting the release window from four hours to twenty minutes while keeping a documented rollback path for every migration.";

const duplicateBullet = "Reduced build times by half.";

const fixtureLibrary = {
  schemaVersion: 1,
  profile: {
    id: "profile-fixture",
    fullName: "Riley Fixture",
    education: [],
    links: [],
  },
  jobs: [
    {
      id: "job-fixture-platform",
      company: "Fixture Systems",
      title: "Platform Engineer",
      employmentType: "full-time",
      startDate: "2021-02",
      endDate: null,
      points: [
        {
          id: "achievement-fixture-long",
          text: longBullet,
          tags: [],
          skillIds: [],
          metrics: [],
          source: { type: "resume" },
          enabled: true,
        },
        {
          id: "achievement-fixture-short",
          text: "Shipped a fix.",
          tags: [],
          skillIds: [],
          metrics: [],
          source: { type: "resume" },
          enabled: true,
        },
        {
          id: "achievement-fixture-duplicate-a",
          text: duplicateBullet,
          tags: [],
          skillIds: [],
          metrics: [],
          source: { type: "user-notes" },
          enabled: true,
        },
        {
          id: "achievement-fixture-duplicate-b",
          text: duplicateBullet,
          tags: [],
          skillIds: [],
          metrics: [],
          source: { type: "user-notes" },
          enabled: true,
        },
        {
          id: "achievement-fixture-disabled",
          text: "Retired the legacy pipeline.",
          tags: [],
          skillIds: [],
          metrics: [],
          source: { type: "resume" },
          enabled: false,
        },
      ],
    },
  ],
  projects: [
    {
      id: "project-fixture-toolkit",
      name: "Open Source Toolkit",
      points: [
        {
          id: "achievement-fixture-project",
          text: "Published an internal CLI.",
          tags: [],
          skillIds: [],
          metrics: [],
          source: { type: "project-document" },
          enabled: true,
        },
      ],
    },
  ],
  skills: [],
  credentials: [],
  preferences: {
    sectionOrder: ["experience", "projects", "education", "skills"],
    maxPages: 1,
  },
};

const dataRoot =
  process.env.RESUME_LIBRARY_ROOT ??
  join(
    tmpdir(),
    `resume-changer-playwright-data-${process.env.PLAYWRIGHT_PORT ?? "3010"}`,
  );

if (!/resume-changer-playwright-data(?:-\d+)?$/.test(dataRoot)) {
  throw new Error(
    `Refusing to write fixtures outside the isolated e2e data root: ${dataRoot}`,
  );
}

const libraryPath = join(dataRoot, "data", "resume-library.json");
let originalLibrary = "";

test.beforeAll(async () => {
  originalLibrary = await readFile(libraryPath, "utf8");
  await writeFile(libraryPath, JSON.stringify(fixtureLibrary), "utf8");
});

test.afterAll(async () => {
  await writeFile(libraryPath, originalLibrary, "utf8");
});

async function openBuilder(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("Company").fill("Fixture Systems");
  await page.getByLabel("Role title").fill("Platform Engineer");
  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill("Keep the deployment pipeline reliable.");
  await expect(page.getByRole("status")).toContainText("Saved on this device");
  await page.goto("/generate");
  await expect(
    page.getByRole("heading", { name: "Choose achievements" }),
  ).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await openBuilder(page);
});

test("keeps the real achievement text with the experience context", async ({
  page,
}) => {
  const legend = page.locator(".generation-group legend").first();
  await expect(legend).toContainText("Platform Engineer");
  await expect(legend).toContainText("Fixture Systems");

  const longRow = page
    .locator(".generation-point")
    .filter({ hasText: "Rebuilt the multi-region" });
  const shortRow = page
    .locator(".generation-point")
    .filter({ hasText: "Shipped a fix." });

  await expect(longRow).toContainText(
    "cutting the release window from four hours to twenty minutes",
  );
  await expect(shortRow).toBeVisible();

  const longBox = await longRow.boundingBox();
  const shortBox = await shortRow.boundingBox();
  expect(longBox).not.toBeNull();
  expect(shortBox).not.toBeNull();
  // The long bullet wraps onto several lines instead of being clipped.
  expect(longBox!.height).toBeGreaterThan(shortBox!.height * 1.5);

  const overflow = await longRow.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
});

test("names each checkbox after the text it controls", async ({ page }) => {
  const shortCheckbox = page.getByLabel(
    "Select achievement achievement-fixture-short",
  );
  await expect(shortCheckbox).toHaveAccessibleName(/Shipped a fix\./);
  await expect(shortCheckbox).toHaveAccessibleName(
    /achievement-fixture-short/,
  );

  const longCheckbox = page.getByLabel(
    "Select achievement achievement-fixture-long",
  );
  await expect(longCheckbox).toHaveAccessibleName(
    /cutting the release window from four hours to twenty minutes/,
  );
});

test("keeps achievements that share the same text apart", async ({ page }) => {
  const first = page.getByLabel(
    "Select achievement achievement-fixture-duplicate-a",
  );
  const second = page.getByLabel(
    "Select achievement achievement-fixture-duplicate-b",
  );

  await expect(page.locator(".generation-point")).toHaveCount(5);
  await first.check();
  await expect(first).toBeChecked();
  await expect(second).not.toBeChecked();
  await second.check();
  await expect(second).toBeChecked();
  await expect(first).toBeChecked();
});

test("offers only the achievements that are enabled in the library", async ({
  page,
}) => {
  await expect(
    page
      .locator(".generation-point")
      .filter({ hasText: "Retired the legacy pipeline" }),
  ).toHaveCount(0);
  await expect(page.getByLabel(/Retired the legacy pipeline/)).toHaveCount(0);
  await expect(
    page.locator(".generation-section-heading p").first(),
  ).toContainText("5 enabled");
});

test("renders a group without optional context cleanly", async ({ page }) => {
  const projectLegend = page.locator(".generation-group legend").nth(1);
  await expect(projectLegend).toContainText("PROJECT");
  await expect(projectLegend).toContainText("Open Source Toolkit");
  await expect(projectLegend.locator("small")).toHaveCount(0);

  const projectRow = page
    .locator(".generation-point")
    .filter({ hasText: "Published an internal CLI." });
  await expect(projectRow).toBeVisible();
});

test("keeps the selected achievements when the workspace is re-rendered", async ({
  page,
}) => {
  await page
    .getByLabel("Select achievement achievement-fixture-short")
    .check();
  await page.getByRole("button", { name: "Generate LaTeX" }).click();
  await expect(page.getByLabel("Generated LaTeX")).toContainText(
    "Riley Fixture",
  );

  await page.getByRole("button", { name: "Generation settings" }).click();
  await expect(
    page.getByLabel("Select achievement achievement-fixture-short"),
  ).toBeChecked();
  await expect(
    page.getByLabel("Select achievement achievement-fixture-duplicate-a"),
  ).not.toBeChecked();
});
