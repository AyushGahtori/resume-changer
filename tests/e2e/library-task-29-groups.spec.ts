import { expect, test } from "@playwright/test";
import { chooseLibraryOption } from "./support/library-select";

/**
 * Task 29 coverage for the way the library groups its points.
 *
 * A job and a project are different kinds of thing, and the reader has to
 * be able to tell them apart and to see what belongs to each one. The
 * date range is checked for its presence and for the months it holds, not
 * for one exact rendering, so the check survives a change of date format.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/library?source=demo");
});

test("tells a job group and a project group apart", async ({ page }) => {
  const job = page
    .locator(".experience-group")
    .filter({ hasText: "Platform Engineer" });
  const project = page
    .locator(".experience-group")
    .filter({ hasText: "QueueBoard" });

  await expect(job.locator(".experience-kind")).toHaveText("JOB");
  await expect(
    job.getByRole("heading", { name: "Platform Engineer" }),
  ).toBeVisible();
  await expect(job.locator(".experience-subtitle")).toHaveText(
    "Example Cloud Labs",
  );

  await expect(project.locator(".experience-kind")).toHaveText("PROJECT");
  await expect(
    project.getByRole("heading", { name: "QueueBoard" }),
  ).toBeVisible();
  await expect(project.locator(".experience-subtitle")).toHaveText(
    "Backend and platform developer",
  );
});

test("keeps the points of a group inside that group", async ({ page }) => {
  const job = page
    .locator(".experience-group")
    .filter({ hasText: "Platform Engineer" });

  await expect(job.locator(".library-point")).toHaveCount(4);
  await expect(
    job.getByText("achievement-service-capacity-design"),
  ).toBeVisible();
  await expect(job.getByText("achievement-orders-api")).toHaveCount(0);
});

test("shows a date range for a group that has dates", async ({ page }) => {
  const job = page
    .locator(".experience-group")
    .filter({ hasText: "Platform Engineer" });
  const dates = job.locator(".experience-dates");

  await expect(dates).toBeVisible();
  /*
   * The months come from the stored data. The rendering of the range is a
   * separate concern, so only the months it holds are checked here.
   */
  await expect(dates).toContainText("2023");
  await expect(dates).toContainText("Present");
});

test("shows a finished role with the month it ended", async ({ page }) => {
  const job = page
    .locator(".experience-group")
    .filter({ hasText: "Software Engineer" });
  const dates = job.locator(".experience-dates");

  await expect(dates).toBeVisible();
  await expect(dates).toContainText("2021");
  await expect(dates).toContainText("2022");
  await expect(dates).not.toContainText("Present");
});

test("leaves out a group that has no matching point", async ({ page }) => {
  await chooseLibraryOption(
    page,
    "Job or project",
    "project:project-queueboard",
  );

  await expect(page.locator(".experience-group")).toHaveCount(1);
  await expect(
    page.locator(".experience-group").filter({ hasText: "QueueBoard" }),
  ).toBeVisible();
});

test("keeps the group order stable and jobs before projects", async ({
  page,
}) => {
  const groups = page.locator(".experience-group");
  const kinds = await groups.locator(".experience-kind").allTextContents();

  expect(kinds).toEqual(["JOB", "JOB", "PROJECT", "PROJECT"]);
});
