import { expect, test } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createPersonalLibraryGuard,
  exampleLibraryPath,
  libraryRoot,
  personalLibraryPath,
} from "./support/personal-library";

type ProfileFixture = {
  fullName: string;
  headline?: string;
};

const personalLibrary = createPersonalLibraryGuard();

test.beforeAll(async () => {
  await personalLibrary.capture();
});

test.afterAll(async () => {
  await personalLibrary.restore();
});

/**
 * Writes an isolated personal library so the summary can be checked against a
 * known profile. The demo library is fictional, and the real personal file on
 * this machine must never be read or replaced.
 */
async function writePersonalLibrary(profile: ProfileFixture) {
  const example = JSON.parse(await readFile(exampleLibraryPath, "utf8"));
  const nextProfile = { ...example.profile, ...profile };
  if (profile.headline === undefined) {
    delete nextProfile.headline;
  }
  const library = { ...example, profile: nextProfile };
  await mkdir(join(libraryRoot, "data"), { recursive: true });
  await writeFile(
    personalLibraryPath,
    JSON.stringify(library, null, 2),
    "utf8",
  );
}

test.describe("library summary identity", () => {
  test("labels the demo summary as fictional and shows its identity", async ({
    page,
  }) => {
    await page.goto("/library?source=demo");

    const summary = page.getByRole("region", { name: "Library summary" });
    await expect(summary.getByText("Fictional demo data")).toBeVisible();
    await expect(
      summary.getByRole("heading", { name: "Jordan Example" }),
    ).toBeVisible();
    await expect(
      summary.getByText("Software Engineer | Cloud Platforms"),
    ).toBeVisible();
  });

  test("labels the personal summary and shows the saved identity", async ({
    page,
  }) => {
    await writePersonalLibrary({
      fullName: "Riley Fixture",
      headline: "Reliability Engineer",
    });
    await page.goto("/library");

    const summary = page.getByRole("region", { name: "Library summary" });
    await expect(summary.getByText("My resume data")).toBeVisible();
    await expect(
      summary.getByRole("heading", { name: "Riley Fixture" }),
    ).toBeVisible();
    await expect(summary.getByText("Reliability Engineer")).toBeVisible();
  });

  test("omits an absent headline instead of leaving an empty row", async ({
    page,
  }) => {
    await writePersonalLibrary({ fullName: "Riley Fixture" });
    await page.goto("/library");

    const summary = page.getByRole("region", { name: "Library summary" });
    await expect(
      summary.getByRole("heading", { name: "Riley Fixture" }),
    ).toBeVisible();
    await expect(summary.locator(".library-owner p")).toHaveCount(0);
    await expect(summary.getByText("My resume data")).toBeVisible();
  });

  test("offers no profile action while no destination exists", async ({
    page,
  }) => {
    // The board's "View details" action needs a real profile or settings
    // destination. The workspace settings route is still a placeholder, so
    // the summary must not offer a link that leads nowhere.
    await page.goto("/library?source=demo");

    const summary = page.getByRole("region", { name: "Library summary" });
    await expect(summary.getByText("View details")).toHaveCount(0);
    await expect(summary.locator("a, button")).toHaveCount(0);
  });

  test("keeps the source label in step with the loaded library", async ({
    page,
  }) => {
    await writePersonalLibrary({ fullName: "Riley Fixture" });
    await page.goto("/library");

    const summary = page.getByRole("region", { name: "Library summary" });
    await expect(summary.getByText("My resume data")).toBeVisible();
    await expect(
      summary.getByRole("heading", { name: "Riley Fixture" }),
    ).toBeVisible();

    await page.getByRole("link", { name: "Demo data" }).click();

    await expect(summary.getByText("Fictional demo data")).toBeVisible();
    await expect(
      summary.getByRole("heading", { name: "Jordan Example" }),
    ).toBeVisible();
    await expect(summary.getByText("My resume data")).toHaveCount(0);
  });

  test("keeps the summary counts tied to the whole library while searching", async ({
    page,
  }) => {
    await page.goto("/library?source=demo");

    const summary = page.locator(".library-counts");
    const before = await summary.locator("dd").allTextContents();
    expect(before.length).toBe(5);

    const resultSummary = page.locator(".library-filter-summary span");
    await expect(resultSummary).toHaveText(/^13 of 13 achievement points$/);

    await page.getByRole("searchbox", { name: "Search library" }).fill("queue");
    await expect(resultSummary).toHaveText(/^\d+ of 13 achievement points$/);

    const visible = Number(
      (await resultSummary.textContent())?.match(/^(\d+)/)?.[1],
    );
    expect(visible).toBeGreaterThan(0);
    expect(visible).toBeLessThan(13);

    // The library totals must not follow the search result.
    expect(await summary.locator("dd").allTextContents()).toEqual(before);
  });
});
