import { expect, test, type Page } from "@playwright/test";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createPersonalLibraryGuard,
  exampleLibraryPath,
  libraryRoot as personalLibraryRoot,
  personalLibraryPath,
} from "./support/personal-library";

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
      name: "Enterprise Platform Modernisation And Reliability Engineering Programme",
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

const libraryGuard = createPersonalLibraryGuard();

test.beforeAll(async () => {
  await libraryGuard.capture();
});

test.afterAll(async () => {
  await libraryGuard.restore();
});

async function writeFixtureLibrary() {
  const dataFolder = join(personalLibraryRoot, "data");
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
  const dataFolder = join(personalLibraryRoot, "data");
  await mkdir(dataFolder, { recursive: true });
  await copyFile(exampleLibraryPath, join(dataFolder, "resume-library.json"));
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
      const topbar = document.querySelector(".topbar");
      const workbench = document.querySelector(".library-workbench");
      if (header) {
        const reservedTop =
          (topbar?.getBoundingClientRect().height ?? 0) +
          (workbench?.getBoundingClientRect().height ?? 0) +
          24;
        window.scrollTo(
          0,
          header.getBoundingClientRect().top + window.scrollY - reservedTop,
        );
      }
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

test.describe("integrated card details and editor", () => {
  test.beforeEach(async ({ page }) => {
    await copyFile(exampleLibraryPath, personalLibraryPath);
    await page.goto("/library");
  });

  test("keeps the full achievement detail set visible in its card", async ({
    page,
  }) => {
    const point = page
      .locator(".library-point")
      .filter({ hasText: "achievement-service-capacity-design" });

    await expect(point.locator(".library-point-id")).toHaveText(
      "achievement-service-capacity-design",
    );
    await expect(point.locator(".point-status")).toHaveText("Enabled");
    await expect(point.locator(".point-metric-label")).toHaveText(
      "Throughput improvement",
    );
    await expect(point.locator(".point-metric-number")).toHaveText("28");
    await expect(point.locator(".point-metric-unit")).toHaveText("%");
    await expect(point.locator(".point-metric-evidence")).toContainText(
      "fictional demo benchmark",
    );
    await expect(point.locator(".point-metric-context")).toContainText(
      "Synthetic benchmark scenario",
    );
    await expect(point.locator(".point-provenance")).toContainText(
      "Source: project-document · Synthetic demo scenario",
    );
    for (const name of [
      "Filter by #system-design",
      "Filter by #scalability",
      "Filter by skill System Design",
      "Filter by skill Amazon Web Services",
    ]) {
      await expect(point.getByRole("button", { name })).toBeVisible();
    }
  });

  test("opens the editor in the achievement card it belongs to", async ({
    page,
  }) => {
    const point = page
      .locator(".library-point")
      .filter({ hasText: "achievement-service-capacity-design" });
    await point.getByRole("button", { name: "Edit", exact: true }).click();

    const editor = point.locator(".point-editor");
    await expect(editor).toBeVisible();
    await expect(
      editor.getByRole("heading", { name: "Edit achievement" }),
    ).toBeVisible();
    await expect(page.locator(".library-point .point-editor")).toHaveCount(1);
    await expect(editor.getByLabel("Achievement ID")).toHaveCount(0);
    await expect(editor.getByLabel("Achievement text")).toHaveValue(
      "Redesigned service boundaries and capacity planning for a multi-tenant processing platform.",
    );
    await expect(editor.getByLabel("Achievement text")).toBeFocused();
  });

  test("keeps an inline editor on the existing card surface", async ({
    page,
  }) => {
    const point = page
      .locator(".library-point")
      .filter({ hasText: "achievement-service-capacity-design" });
    await point.getByRole("button", { name: "Edit", exact: true }).click();

    const styles = await point.locator(".point-editor").evaluate((element) => {
      const editor = getComputedStyle(element);
      const card = getComputedStyle(element.closest(".library-point")!);
      return {
        inline: element.classList.contains("is-inline"),
        editorBackground: editor.backgroundColor,
        editorShadow: editor.boxShadow,
        editorBorderTop: editor.borderTopWidth,
        cardBackground: card.backgroundColor,
      };
    });
    expect(styles.inline).toBe(true);
    expect(styles.editorBackground).toBe("rgba(0, 0, 0, 0)");
    expect(styles.editorShadow).toBe("none");
    expect(styles.editorBorderTop).toBe("1px");
    expect(styles.cardBackground).not.toBe("rgba(0, 0, 0, 0)");
  });

  test("opens the inline editor by keyboard and returns focus on cancel", async ({
    page,
  }) => {
    const point = page
      .locator(".library-point")
      .filter({ hasText: "achievement-ci-cd-pipeline" });
    const edit = point.getByRole("button", { name: "Edit", exact: true });

    await edit.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Achievement text")).toBeFocused();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();

    await expect(point.locator(".point-editor")).toHaveCount(0);
    await expect(edit).toBeFocused();
  });

  test("keeps demo achievements detailed and read-only", async ({ page }) => {
    await page.goto("/library?source=demo");

    await expect(page.locator(".source-indicator")).toHaveText(
      "Fictional demo data",
    );
    await expect(
      page.getByRole("button", { name: "Edit", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Add achievement", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Detailed entry" }),
    ).toHaveCount(0);
    await expect(page.locator(".point-editor")).toHaveCount(0);
    await expect(page.locator(".library-point")).toHaveCount(13);
    await expect(page.locator(".point-provenance").first()).toContainText(
      "Source: project-document",
    );
  });
});
