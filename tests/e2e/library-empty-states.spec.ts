import { expect, test } from "@playwright/test";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The library has four states that look empty but mean different things: a
 * library with no data, a library whose data is all filtered away, a personal
 * file that could not be loaded, and the read-only demo library. These tests
 * build the state they need and check that the page says the right thing.
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

const emptyLibrary = {
  schemaVersion: 1,
  profile: {
    id: "profile-empty-state",
    fullName: "Empty State Person",
    links: [],
    education: [],
  },
  jobs: [],
  projects: [],
  skills: [],
  credentials: [],
  preferences: {
    sectionOrder: [
      "experience",
      "projects",
      "education",
      "skills",
      "credentials",
    ],
    maxPages: 1,
  },
};

async function writeLibrary(library: unknown) {
  await mkdir(join(libraryRoot, "data"), { recursive: true });
  await writeFile(personalLibraryPath, JSON.stringify(library), "utf8");
}

test.beforeEach(async () => {
  await mkdir(join(libraryRoot, "data"), { recursive: true });
  await copyFile(sampleLibraryPath, personalLibraryPath);
});

test.afterEach(async () => {
  /**
   * The suite shares one fixture folder, so every test puts the sample
   * library back. A test that empties or removes the personal file cannot
   * leak its state into the next spec file.
   */
  await mkdir(join(libraryRoot, "data"), { recursive: true });
  await copyFile(sampleLibraryPath, personalLibraryPath);
});

test("says a library with no data is empty, not filtered", async ({ page }) => {
  await writeLibrary(emptyLibrary);
  await page.goto("/library");

  await expect(
    page.getByRole("heading", { name: "No achievements saved yet" }),
  ).toBeVisible();
  await expect(page.locator(".library-state-message")).toHaveText(
    "This library is empty. Add an achievement to start filling it, or open the demo library to see a full one.",
  );

  // The filtered message is not shown, because nothing was filtered.
  await expect(
    page.getByRole("heading", { name: "No achievements match these filters" }),
  ).toHaveCount(0);
  await expect(page.locator("article.library-point")).toHaveCount(0);
});

test("offers the first achievement from an empty personal library", async ({
  page,
}) => {
  await writeLibrary(emptyLibrary);
  await page.goto("/library");

  await page
    .locator(".library-state")
    .getByRole("button", { name: "Add achievement" })
    .click();

  await expect(
    page.getByRole("heading", { name: "Add achievement" }),
  ).toBeVisible();
  await expect(page.getByLabel("Achievement ID")).toBeFocused();
});

test("says a filtered library matched nothing and offers the way back", async ({
  page,
}) => {
  await page.goto("/library");

  await page
    .getByRole("searchbox", { name: "Search library" })
    .fill("no matching library content");

  await expect(
    page.getByRole("heading", { name: "No achievements match these filters" }),
  ).toBeVisible();
  await expect(page.locator(".library-state-message")).toHaveText(
    "None of the 13 achievements in this library match the current search and filters.",
  );

  // The empty library message is not shown, because the library has data.
  await expect(
    page.getByRole("heading", { name: "No achievements saved yet" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Reset filters" }).last().click();
  await expect(page.locator("article.library-point")).toHaveCount(13);
});

test("keeps the demo library read-only and says so", async ({ page }) => {
  await page.goto("/library?source=demo");

  await expect(page.getByText("Demo data is read-only.")).toBeVisible();
  await expect(
    page.locator("article.library-point").getByRole("button", { name: "Edit" }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "My data" })).toBeVisible();
});

test("explains a personal library that cannot be loaded", async ({ page }) => {
  await rm(personalLibraryPath, { force: true });
  await page.goto("/library");

  const alert = page.locator(".library-error");
  await expect(alert).toHaveAttribute("role", "alert");
  await expect(alert).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Could not load your library." }),
  ).toBeVisible();
  await expect(alert).toContainText("resume-library.json was not found");

  // The other source stays reachable, so the reader is never stuck.
  const alternate = page.getByRole("link", {
    name: "Open fictional demo data",
  });
  await expect(alternate).toBeVisible();
  await alternate.click();
  await expect(
    page.getByRole("heading", { name: "Achievement library" }),
  ).toBeVisible();
  await expect(page.locator("article.library-point")).toHaveCount(13);
});
