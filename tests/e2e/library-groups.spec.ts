import { expect, test, type Page } from "@playwright/test";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Task 20 coverage for the group headers, their counts, their date ranges
 * and their disclosure.
 *
 * Every fixture here is fictional. The demo library is the shipped sample
 * data, and the second fixture is a small synthetic library written into
 * the isolated test data root so the absent-end-date rule can be checked
 * on a rendered header.
 */

const group = (page: Page, title: string) =>
  page.locator(".experience-group").filter({ hasText: title });

const toggle = (page: Page, title: string) =>
  group(page, title).locator(".experience-toggle");

/** A fictional library with an open-ended project and an undated project. */
const OPEN_ENDED_LIBRARY = {
  schemaVersion: 1,
  profile: {
    id: "profile-group-fixture",
    fullName: "Robin Fixture",
    headline: "Fictional fixture for the group header tests",
    links: [],
    education: [],
  },
  jobs: [
    {
      id: "job-ongoing-fixture",
      company: "Fixture Works",
      title: "Staff Engineer",
      employmentType: "full-time",
      startDate: "2023-03",
      endDate: null,
      points: [
        {
          id: "achievement-fixture-ongoing",
          text: "Shipped a fictional internal tool.",
          tags: [],
          skillIds: [],
          metrics: [],
          source: { type: "user-notes", label: "Fictional note" },
          enabled: true,
        },
      ],
    },
  ],
  projects: [
    {
      id: "project-open-ended-fixture",
      name: "Open Ended",
      role: "Builder",
      startDate: "2024-05",
      /*
       * The end date is absent on purpose. An absent end date is an
       * unknown end, not an ongoing project.
       */
      points: [
        {
          id: "achievement-fixture-open-ended",
          text: "Kept a fictional project running without an end date.",
          tags: [],
          skillIds: [],
          metrics: [],
          source: { type: "user-notes", label: "Fictional note" },
          enabled: true,
        },
      ],
    },
    {
      id: "project-undated-fixture",
      name: "Undated",
      role: "Builder",
      points: [
        {
          id: "achievement-fixture-undated",
          text: "Recorded a fictional project without any dates.",
          tags: [],
          skillIds: [],
          metrics: [],
          source: { type: "user-notes", label: "Fictional note" },
          enabled: true,
        },
      ],
    },
    {
      id: "project-long-name-fixture",
      name:
        "Enterprise Platform Modernisation And Reliability Engineering Programme",
      role: "Principal Engineer, Cross Team Reliability Working Group",
      startDate: "2021-06",
      endDate: "2023-11",
      points: [
        {
          id: "achievement-fixture-long-name",
          text: "Ran a fictional programme with a deliberately long name.",
          tags: [],
          skillIds: [],
          metrics: [],
          source: { type: "user-notes", label: "Fictional note" },
          enabled: true,
        },
      ],
    },
  ],
  skills: [],
  credentials: [],
  preferences: {
    sectionOrder: ["experience", "projects", "skills", "credentials"],
    maxPages: 1,
  },
};

function libraryRoot() {
  return (
    process.env.RESUME_LIBRARY_ROOT ??
    join(tmpdir(), "resume-changer-playwright-data-3010")
  );
}

async function writeFixtureLibrary() {
  const dataFolder = join(libraryRoot(), "data");
  await mkdir(dataFolder, { recursive: true });
  await writeFile(
    join(dataFolder, "resume-library.json"),
    `${JSON.stringify(OPEN_ENDED_LIBRARY, null, 2)}\n`,
    "utf8",
  );
}

/**
 * Puts the sample library back.
 *
 * The suite shares one data folder, so a fixture left behind would reach the
 * specs that run after this one and change what they find. The sample
 * library is the one the server seeded the folder with.
 */
async function restoreSampleLibrary() {
  const dataFolder = join(libraryRoot(), "data");
  await mkdir(dataFolder, { recursive: true });
  await copyFile(
    join(process.cwd(), "examples", "sample-resume-library.json"),
    join(dataFolder, "resume-library.json"),
  );
}

test.describe("achievement library group headers", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/library?source=demo");
  });

  test("shows the group type, title, context, count and date range", async ({
    page,
  }) => {
    const job = group(page, "Platform Engineer");

    await expect(job).toHaveAttribute("aria-label", "Job: Platform Engineer");
    await expect(
      job.getByRole("heading", { name: "Platform Engineer" }),
    ).toBeVisible();
    await expect(job.locator(".experience-kind")).toHaveText("JOB");
    await expect(job.locator(".experience-subtitle")).toHaveText(
      "Example Cloud Labs",
    );
    await expect(job.locator(".experience-count")).toHaveText("4 achievements");
    await expect(job.locator(".experience-dates")).toHaveText(
      "Jan 2023 – Present",
    );
    await expect(job.locator(".experience-dates time").first()).toHaveAttribute(
      "datetime",
      "2023-01",
    );

    const project = group(page, "QueueBoard");
    await expect(project).toHaveAttribute("aria-label", "Project: QueueBoard");
    await expect(project.locator(".experience-kind")).toHaveText("PROJECT");
    await expect(project.locator(".experience-count")).toHaveText(
      "3 achievements",
    );
    await expect(project.locator(".experience-dates")).toHaveText(
      "Feb 2024 – Aug 2024",
    );
  });

  test("marks a finished role with its end month instead of Present", async ({
    page,
  }) => {
    const job = group(page, "Software Engineer");

    await expect(job.locator(".experience-dates")).toHaveText(
      "Jun 2021 – Dec 2022",
    );
    await expect(job.locator(".experience-dates")).not.toContainText("Present");
  });

  test("counts only the points a filter leaves visible", async ({ page }) => {
    const job = group(page, "Platform Engineer");
    await expect(job.locator(".experience-count")).toHaveText("4 achievements");

    await page.getByLabel("Point source").selectOption("project-document");

    const remaining = group(page, "Platform Engineer");
    await expect(remaining.locator(".experience-count")).toHaveText(
      "2 achievements",
    );
  });

  test("omits a group that has no matching point", async ({ page }) => {
    await page
      .getByLabel("Job or project")
      .selectOption("project:project-queueboard");

    await expect(page.locator(".experience-group")).toHaveCount(1);
    await expect(page.locator(".experience-group")).toContainText("QueueBoard");
  });

  test("collapses and expands a group with a real disclosure button", async ({
    page,
  }) => {
    const button = toggle(page, "Platform Engineer");
    await expect(button).toHaveAttribute("aria-expanded", "true");

    const panelId = await button.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    const panel = page.locator(`#${panelId}`);
    await expect(panel).toBeVisible();

    const expandedChevron = await button
      .locator(".experience-chevron")
      .evaluate((element) => getComputedStyle(element).transform);

    await button.click();

    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toBeHidden();
    await expect(button).toBeFocused();

    const collapsedChevron = await button
      .locator(".experience-chevron")
      .evaluate((element) => getComputedStyle(element).transform);
    expect(collapsedChevron).not.toBe(expandedChevron);

    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(panel).toBeVisible();
  });

  test("operates the disclosure from the keyboard and keeps the focus", async ({
    page,
  }) => {
    const button = toggle(page, "Platform Engineer");
    await button.focus();
    await expect(button).toBeFocused();

    await page.keyboard.press("Enter");

    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toBeFocused();
    expect(
      await button.evaluate((element) => element.matches(":focus-visible")),
    ).toBe(true);

    await page.keyboard.press("Space");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(button).toBeFocused();
  });

  test("keeps a collapsed group collapsed when the filters change", async ({
    page,
  }) => {
    const button = toggle(page, "QueueBoard");
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "false");

    /*
     * The filter hides the group completely, so the group is unmounted and
     * mounted again when the filter is cleared. The state the reader gave
     * it has to survive that.
     */
    await page
      .getByLabel("Job or project")
      .selectOption("job:job-example-cloud-labs");
    await expect(page.locator(".experience-group")).toHaveCount(1);

    await page.getByRole("button", { name: "Reset filters" }).click();
    await expect(toggle(page, "QueueBoard")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(button).toBeVisible();
  });

  test("keeps the reader's place when a group is opened and closed", async ({
    page,
  }) => {
    const button = toggle(page, "Platform Engineer");
    await button.scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      const header = document.querySelector(".experience-toggle");
      if (header)
        window.scrollTo(0, header.getBoundingClientRect().top + window.scrollY);
    });

    const before = await button.boundingBox();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    expect(before).not.toBeNull();

    await button.click();

    const after = await button.boundingBox();
    expect(after).not.toBeNull();
    expect(after!.y).toBeCloseTo(before!.y, 0);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  });

  test("keeps the content below a collapsed group in place", async ({
    page,
  }) => {
    /*
     * The group is toggled with a scripted click, so the page is not
     * scrolled to it first. The group ends up above the viewport, and the
     * content the reader is looking at has to stay where it is.
     */
    await page.evaluate(() => {
      const headers = document.querySelectorAll(".experience-toggle");
      const second = headers[1];
      if (second) {
        window.scrollTo(0, second.getBoundingClientRect().top + window.scrollY);
      }
    });

    const reference = await page
      .locator(".experience-group")
      .nth(1)
      .locator(".experience-heading")
      .boundingBox();
    expect(reference).not.toBeNull();

    await page.evaluate(() => {
      const first = document.querySelectorAll(".experience-toggle")[0];
      if (first instanceof HTMLElement) first.click();
    });

    const after = await page
      .locator(".experience-group")
      .nth(1)
      .locator(".experience-heading")
      .boundingBox();
    expect(after).not.toBeNull();
    expect(after!.y).toBeCloseTo(reference!.y, 0);
  });

  test("keeps the header readable on a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.reload();

    const job = group(page, "Platform Engineer");
    const count = job.locator(".experience-count");
    const chevron = job.locator(".experience-chevron");
    const dates = job.locator(".experience-dates");
    await expect(count).toBeVisible();
    await expect(chevron).toBeVisible();
    await expect(dates).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(
      dimensions.viewportWidth,
    );

    const countBox = await count.boundingBox();
    const chevronBox = await chevron.boundingBox();
    const headingBox = await job
      .locator(".experience-heading-text")
      .boundingBox();
    const dateBox = await dates.boundingBox();
    expect(countBox).not.toBeNull();
    expect(chevronBox).not.toBeNull();
    expect(headingBox).not.toBeNull();
    expect(dateBox).not.toBeNull();

    // The count is never squeezed behind the chevron.
    expect(countBox!.x + countBox!.width).toBeLessThanOrEqual(
      chevronBox!.x + 1,
    );
    // The date range moves below the title on a narrow viewport.
    expect(dateBox!.y).toBeGreaterThan(headingBox!.y + headingBox!.height - 1);
  });
});

test.describe("achievement library group headers without a known end", () => {
  test.beforeEach(async ({ page }) => {
    await writeFixtureLibrary();
    await page.goto("/library");
  });

  test.afterEach(async () => {
    await restoreSampleLibrary();
  });

  test("never shows Present for an absent end date", async ({ page }) => {
    const project = group(page, "Open Ended");

    await expect(project.locator(".experience-dates")).toHaveText("May 2024");
    await expect(project.locator(".experience-dates")).not.toContainText(
      "Present",
    );
  });

  test("omits the date range when the source holds no date", async ({
    page,
  }) => {
    const project = group(page, "Undated");

    await expect(project.locator(".experience-dates")).toHaveCount(0);
    await expect(project.locator(".experience-count")).toHaveText(
      "1 achievement",
    );
  });

  test("shows Present for a role whose end date is null", async ({ page }) => {
    const job = group(page, "Staff Engineer");

    await expect(job.locator(".experience-dates")).toHaveText(
      "Mar 2023 – Present",
    );
  });

  test("keeps a long title and context readable on a narrow viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.reload();

    const project = group(
      page,
      "Enterprise Platform Modernisation And Reliability Engineering Programme",
    );
    const title = project.locator(".experience-title");
    const subtitle = project.locator(".experience-subtitle");
    await expect(title).toBeVisible();
    await expect(subtitle).toBeVisible();

    /*
     * The long title wraps inside the header instead of pushing the row
     * past the edge of the viewport.
     */
    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(
      dimensions.viewportWidth,
    );

    const titleBox = await title.boundingBox();
    const subtitleBox = await subtitle.boundingBox();
    const chevronBox = await project
      .locator(".experience-chevron")
      .boundingBox();
    expect(titleBox).not.toBeNull();
    expect(subtitleBox).not.toBeNull();
    expect(chevronBox).not.toBeNull();

    // The title wraps onto a second line instead of running under the chevron.
    expect(titleBox!.width).toBeLessThanOrEqual(chevronBox!.x + 1);
    expect(titleBox!.height).toBeGreaterThan(24);
    expect(subtitleBox!.y).toBeGreaterThan(titleBox!.y);
  });
});
