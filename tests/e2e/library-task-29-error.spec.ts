import { expect, test } from "@playwright/test";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Task 29 coverage for the library error state.
 *
 * A library file that cannot be read must not leave the reader on a blank
 * page. The route has to say what went wrong and offer the other source, so
 * a broken personal file never blocks the demo library.
 *
 * The browser suite shares one data folder, so the spec puts the fictional
 * sample library back after every test it breaks.
 */

const dataRoot =
  process.env.RESUME_LIBRARY_ROOT ??
  join(tmpdir(), "resume-changer-playwright-data-3010");

const libraryFile = join(dataRoot, "data", "resume-library.json");

async function writeBrokenLibrary() {
  await mkdir(join(dataRoot, "data"), { recursive: true });
  await writeFile(libraryFile, "{ this is not valid json", "utf8");
}

async function restoreSampleLibrary() {
  await mkdir(join(dataRoot, "data"), { recursive: true });
  await copyFile(
    join(process.cwd(), "examples", "sample-resume-library.json"),
    libraryFile,
  );
}

test.describe("a library file that cannot be loaded", () => {
  test.beforeEach(async () => {
    await writeBrokenLibrary();
  });

  test.afterEach(async () => {
    await restoreSampleLibrary();
  });

  test("reports the failure instead of showing a blank page", async ({
    page,
  }) => {
    await page.goto("/library");

    /*
     * The Next.js route announcer also carries an alert role, so the
     * locator names the section the library renders.
     */
    const error = page.locator(".library-error");
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute("role", "alert");
    await expect(error).toContainText("LIBRARY UNAVAILABLE");
    await expect(error).toContainText("Could not load your library.");
    await expect(error).toContainText("is not valid JSON");
    await expect(page.locator(".library-page")).toHaveCount(0);
  });

  test("offers the demo library as the way out", async ({ page }) => {
    await page.goto("/library");

    const link = page.getByRole("link", {
      name: "Open fictional demo data",
    });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/library?source=demo");

    await link.click();

    await expect(
      page.getByRole("heading", { name: "Jordan Example" }),
    ).toBeVisible();
    await expect(page.getByText("Fictional demo data")).toBeVisible();
  });
});
