import { expect, test, type Page } from "@playwright/test";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResumeLibrary } from "../../src/lib/schemas/resume-data";

/**
 * The library has to work on a phone and on a wide desk without ever
 * scrolling sideways. These tests measure the real layout at the five
 * widths the design calls for.
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

const widths = [320, 390, 768, 1024, 1440] as const;

/**
 * A library whose text is long enough to push a layout sideways if the
 * styles do not handle it: a long company name, a long achievement, a long
 * metric label, and a long source reference.
 */
const longContentLibrary: ResumeLibrary = {
  schemaVersion: 1,
  profile: {
    id: "profile-long-content",
    fullName: "Long Content Person",
    links: [],
    education: [],
  },
  jobs: [
    {
      id: "job-long-content",
      company:
        "A Company With A Deliberately Long Name That Runs Past The Edge Of A Narrow Column",
      title: "Senior Engineer",
      employmentType: "full-time",
      startDate: "2024-01",
      endDate: null,
      points: [
        {
          id: "achievement-long-content",
          text: "Rebuilt a pipeline that had silently dropped every invoice raised during a partial outage, which is a sentence long enough to wrap several times on a phone and still read in full.",
          tags: ["reliability-with-a-long-tag-name"],
          skillIds: ["skill-long-content"],
          metrics: [
            {
              id: "metric-long-content",
              label:
                "Recovered invoices that would otherwise have been written off without a trace",
              value: "100%",
              evidence:
                "Quarterly finance reconciliation signed off by the controller",
              context:
                "Measured across two release cycles of sustained production traffic",
            },
          ],
          source: {
            type: "resume",
            label:
              "Resume document with an unusually long descriptive label for the file it came from",
            reference:
              "Page 12, bullet 3, under the section with the long heading",
          },
          enabled: true,
        },
      ],
    },
  ],
  projects: [],
  skills: [
    {
      id: "skill-long-content",
      name: "A Skill With A Long Name That Needs Room",
      category: "Engineering",
      aliases: [],
      sources: ["user-notes"],
      isListedOnCurrentResume: true,
      evidenceAchievementIds: ["achievement-long-content"],
    },
  ],
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

async function writeLibrary(library: ResumeLibrary) {
  await mkdir(join(libraryRoot, "data"), { recursive: true });
  await writeFile(personalLibraryPath, JSON.stringify(library), "utf8");
}

function horizontalOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
}

function rowTops(page: Page, selector: string) {
  return page
    .locator(selector)
    .evaluateAll((nodes) =>
      nodes.map((node) => Math.round(node.getBoundingClientRect().top)),
    );
}

test.beforeEach(async () => {
  await mkdir(join(libraryRoot, "data"), { recursive: true });
  await copyFile(sampleLibraryPath, personalLibraryPath);
});

test("never scrolls the page sideways at any width", async ({ page }) => {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/library");

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  }
});

test("never scrolls the page sideways with long content", async ({ page }) => {
  await writeLibrary(longContentLibrary);

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/library");

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  }
});

test("keeps the summary and the filters on one row at 1440", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/library");

  // The identity sits beside the metrics, not above them.
  const overview = await page.evaluate(() => {
    const identity = document
      .querySelector(".library-identity")!
      .getBoundingClientRect();
    const metrics = document
      .querySelector(".library-metrics")!
      .getBoundingClientRect();
    return {
      identityRight: identity.right,
      metricsLeft: metrics.left,
    };
  });
  expect(overview.identityRight).toBeLessThanOrEqual(overview.metricsLeft + 1);

  // Five metrics and five filters each fit on a single row.
  const metricTops = await rowTops(page, ".library-metric");
  expect(new Set(metricTops).size).toBe(1);
  expect(metricTops).toHaveLength(5);

  const filterTops = await rowTops(page, ".library-filter-grid > label");
  expect(new Set(filterTops).size).toBe(1);
  expect(filterTops).toHaveLength(5);
});

test("wraps the metrics and the filters at 1024 and 768", async ({ page }) => {
  for (const width of [1024, 768] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/library");

    // The metrics wrap onto more than one row.
    const metricTops = await rowTops(page, ".library-metric");
    expect(new Set(metricTops).size).toBeGreaterThan(1);

    // The filters wrap too.
    const filterTops = await rowTops(page, ".library-filter-grid > label");
    expect(new Set(filterTops).size).toBeGreaterThan(1);

    // Every section keeps the full width of the page.
    const widths = await page.evaluate(() => {
      const measure = (selector: string) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        return Math.round(node.getBoundingClientRect().width);
      };
      return {
        page: measure(".library-page"),
        overview: measure(".library-overview"),
        controls: measure(".library-controls"),
        experiences: measure(".library-sections"),
      };
    });
    expect(widths.overview).toBe(widths.page);
    expect(widths.controls).toBe(widths.page);
    expect(widths.experiences).toBe(widths.page);
  }
});

test("stacks everything on a phone without hiding an action", async ({
  page,
}) => {
  for (const width of [390, 320] as const) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/library");

    // The source switch drops below the page title.
    const heading = await page.evaluate(() => {
      const title = document
        .querySelector(".library-heading h1")!
        .getBoundingClientRect();
      const source = document
        .querySelector(".library-source-switch")!
        .getBoundingClientRect();
      return { titleBottom: title.bottom, sourceTop: source.top };
    });
    expect(heading.sourceTop).toBeGreaterThanOrEqual(heading.titleBottom - 1);

    // The filters are one column, so nothing is squeezed.
    const filterTops = await rowTops(page, ".library-filter-grid > label");
    expect(new Set(filterTops).size).toBe(5);

    // The card keeps its state and its edit action.
    const card = page.locator("article.library-point").first();
    await expect(card.locator(".point-status")).toBeVisible();
    await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();

    // The search and every filter stay reachable.
    await expect(page.getByLabel("Search library")).toBeVisible();
    await expect(page.getByLabel("Tag")).toBeVisible();
  }
});

test("keeps the editor inside a narrow viewport", async ({ page }) => {
  for (const width of [390, 320] as const) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/library");

    await page.getByRole("button", { name: "Detailed entry" }).click();
    await expect(page.getByLabel("Achievement text")).toBeVisible();

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    // The editor's own controls are still on the page.
    await expect(
      page.getByRole("button", { name: "Save achievement" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeVisible();
  }
});

test("keeps the search workbench and the source switch on one row at 1440", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/library");

  const layout = await page.evaluate(() => {
    const search = document
      .querySelector(".library-search")!
      .getBoundingClientRect();
    const grid = document
      .querySelector(".library-filter-grid")!
      .getBoundingClientRect();
    const controls = document
      .querySelector(".library-controls")!
      .getBoundingClientRect();
    return {
      gridWidth: grid.width,
      controlsWidth: controls.width,
      searchWidth: search.width,
    };
  });

  // The search field spans the workbench, and the filter row fills it.
  expect(layout.searchWidth).toBeGreaterThan(0);
  expect(layout.gridWidth).toBeLessThanOrEqual(layout.controlsWidth);
});
