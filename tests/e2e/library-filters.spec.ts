import { expect, test } from "@playwright/test";
import { contrastRatio } from "./support/color";
import { chooseLibraryOption } from "./support/library-select";

/**
 * The library counts the achievement points that are actually visible and
 * offers a real sort. Both are read from the loaded library, so they describe
 * the current data and never hide or lose a record.
 */
const libraryRoute = "/library?source=demo";

async function groupLabels(page: import("@playwright/test").Page) {
  return page
    .locator(".experience-group")
    .evaluateAll((groups) =>
      groups.map((group) => group.getAttribute("aria-label")),
    );
}

test.beforeEach(async ({ page }) => {
  await page.goto(libraryRoute);
});

test("shows the matching point count apart from the summary metrics", async ({
  page,
}) => {
  const resultCount = page.locator(".library-result-count");

  await expect(resultCount).toHaveText("13 of 13 achievement points");

  // The total in the summary card stays the size of the whole library.
  await expect(page.locator(".library-counts dd").nth(2)).toHaveText("13");

  await chooseLibraryOption(page, "Tag", "automation");
  await expect(resultCount).toHaveText("3 of 13 achievement points");
  await expect(page.locator(".library-counts dd").nth(2)).toHaveText("13");

  await chooseLibraryOption(page, "Tag", "geospatial");
  await expect(resultCount).toHaveText("1 of 13 achievement points");
  await expect(page.locator(".library-point")).toHaveCount(1);
});

test("uses singular copy when a single point matches", async ({ page }) => {
  const resultCount = page.locator(".library-result-count");

  await chooseLibraryOption(page, "Tag", "geospatial");
  await expect(resultCount).toHaveText("1 of 13 achievement points");

  await chooseLibraryOption(page, "Tag", "");
  await page
    .getByRole("searchbox", { name: "Search library" })
    .fill("no matching library content");
  await expect(resultCount).toHaveText("0 of 13 achievement points");
  await expect(page.getByRole("status")).toHaveText(
    "None of the 13 achievements in this library match the current search and filters.",
  );
});

test("reorders the groups for every sort option", async ({ page }) => {
  const sort = page.getByRole("combobox", { name: "Sort" });
  await expect(sort).toHaveAttribute("data-value", "most-recent");

  // The most recent order puts the ongoing role first and the finished
  // roles in the order they ended.
  expect(await groupLabels(page)).toEqual([
    "Job: Platform Engineer",
    "Job: Software Engineer",
    "Project: QueueBoard",
    "Project: FieldNotes",
  ]);

  await chooseLibraryOption(page, "Sort", "oldest");
  expect(await groupLabels(page)).toEqual([
    "Job: Software Engineer",
    "Job: Platform Engineer",
    "Project: FieldNotes",
    "Project: QueueBoard",
  ]);

  await chooseLibraryOption(page, "Sort", "alphabetical");
  expect(await groupLabels(page)).toEqual([
    "Job: Platform Engineer",
    "Job: Software Engineer",
    "Project: FieldNotes",
    "Project: QueueBoard",
  ]);
});

test("sorts the points inside a group and keeps the count", async ({
  page,
}) => {
  await chooseLibraryOption(page, "Sort", "alphabetical");

  const firstGroupPoints = page
    .locator(".experience-group")
    .first()
    .locator(".library-point-text");
  const texts = await firstGroupPoints.evaluateAll((nodes) =>
    nodes.map((node) => node.textContent ?? ""),
  );
  expect(texts).toEqual(
    [...texts].sort((left, right) => left.localeCompare(right)),
  );

  await expect(page.locator(".library-result-count")).toHaveText(
    "13 of 13 achievement points",
  );
  await expect(page.locator(".library-point")).toHaveCount(13);
});

test("keeps the sort and the count while the filters change", async ({
  page,
}) => {
  await chooseLibraryOption(page, "Sort", "oldest");
  await chooseLibraryOption(page, "Tag", "automation");

  await expect(page.locator(".library-result-count")).toHaveText(
    "3 of 13 achievement points",
  );
  expect(await groupLabels(page)).toEqual([
    "Job: Software Engineer",
    "Job: Platform Engineer",
    "Project: FieldNotes",
  ]);

  await chooseLibraryOption(page, "Sort", "most-recent");
  await expect(page.locator(".library-result-count")).toHaveText(
    "3 of 13 achievement points",
  );
  expect(await groupLabels(page)).toEqual([
    "Job: Platform Engineer",
    "Job: Software Engineer",
    "Project: FieldNotes",
  ]);
});

test("shows the reset action only while the filters are not default", async ({
  page,
}) => {
  const reset = page.getByRole("button", { name: "Reset filters" });
  await expect(reset).toHaveCount(0);

  await page
    .getByRole("searchbox", { name: "Search library" })
    .fill("automation");
  await expect(reset).toBeVisible();

  await chooseLibraryOption(page, "Point status", "enabled");
  await expect(reset).toBeVisible();

  await reset.click();
  await expect(reset).toHaveCount(0);
  await expect(
    page.getByRole("searchbox", { name: "Search library" }),
  ).toHaveValue("");
  await expect(
    page.getByRole("combobox", { name: "Point status" }),
  ).toHaveAttribute("data-value", "all");
  await expect(page.locator(".library-result-count")).toHaveText(
    "13 of 13 achievement points",
  );
});

test("keeps the data source and the theme when the filters are reset", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await chooseLibraryOption(page, "Tag", "automation");
  await page.getByRole("button", { name: "Reset filters" }).click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page).toHaveURL(/source=demo/);
  await expect(page.getByText("Fictional demo data")).toBeVisible();
});

test("backs every advanced facet with real choices and current results", async ({
  page,
}) => {
  const count = page.locator(".library-result-count");
  const experience = await page
    .getByRole("combobox", { name: "Job or project" })
    .locator("xpath=..")
    .locator(".library-select-option")
    .evaluateAll((options) =>
      options.map((option) => option.getAttribute("data-value")),
    );
  expect(experience).toEqual([
    "",
    "job:job-example-cloud-labs",
    "job:job-sampleworks-studio",
    "project:project-queueboard",
    "project:project-fieldnotes",
  ]);

  const sourceValues = await page
    .getByRole("combobox", { name: "Point source" })
    .locator("xpath=..")
    .locator(".library-select-option")
    .evaluateAll((options) =>
      options.map((option) => option.getAttribute("data-value")),
    );
  expect(sourceValues).toEqual(["", "project-document", "user-notes"]);

  const statusValues = await page
    .getByRole("combobox", { name: "Point status" })
    .locator("xpath=..")
    .locator(".library-select-option")
    .evaluateAll((options) =>
      options.map((option) => option.getAttribute("data-value")),
    );
  expect(statusValues).toEqual(["all", "enabled", "disabled"]);

  await expect(page.locator(".library-point")).toHaveCount(13);
  const cases = [
    {
      label: "Job or project",
      value: "job:job-example-cloud-labs",
      zero: false,
    },
    { label: "Point source", value: "project-document", zero: false },
    { label: "Point status", value: "disabled", zero: true },
    { label: "Linked skill", value: "skill-automation", zero: false },
    { label: "Tag", value: "automation", zero: false },
  ];

  for (const facet of cases) {
    await chooseLibraryOption(page, facet.label, facet.value);
    const visiblePointCount = await page.locator(".library-point").count();
    expect(visiblePointCount).toBeLessThan(13);
    expect(visiblePointCount === 0).toBe(facet.zero);
    await expect(count).toHaveText(
      `${visiblePointCount} of 13 achievement points`,
    );
    await expect(
      page
        .getByRole("region", { name: "Search and filter library" })
        .getByRole("button", { name: "Reset filters" }),
    ).toBeVisible();
    if (facet.zero) {
      await expect(page.getByRole("status")).toHaveText(
        "None of the 13 achievements in this library match the current search and filters.",
      );
    }
    await page
      .getByRole("region", { name: "Search and filter library" })
      .getByRole("button", { name: "Reset filters" })
      .click();
    await expect(count).toHaveText("13 of 13 achievement points");
  }
});

test("keeps long selected facet values usable on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.reload();

  await chooseLibraryOption(
    page,
    "Job or project",
    "job:job-sampleworks-studio",
  );
  await chooseLibraryOption(
    page,
    "Linked skill",
    "skill-infrastructure-as-code",
  );
  await chooseLibraryOption(page, "Tag", "developer-experience");

  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(
    dimensions.viewportWidth,
  );
  await expect(
    page.getByRole("combobox", { name: "Job or project" }),
  ).toHaveAttribute("data-value", "job:job-sampleworks-studio");
  await expect(
    page.getByRole("combobox", { name: "Linked skill" }),
  ).toHaveAttribute("data-value", "skill-infrastructure-as-code");
  await expect(page.getByRole("combobox", { name: "Tag" })).toHaveAttribute(
    "data-value",
    "developer-experience",
  );
});

test("keeps active facets visibly distinct in both themes after focus leaves", async ({
  page,
}) => {
  const tag = page.getByRole("combobox", { name: "Tag" });
  const status = page.getByRole("combobox", { name: "Point status" });

  async function colors(select: import("@playwright/test").Locator) {
    return select.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        border: style.borderColor,
        text: style.color,
      };
    });
  }

  async function waitForStableColors(
    select: import("@playwright/test").Locator,
  ) {
    let previous: string | undefined;
    let stableSamples = 0;
    await expect
      .poll(
        async () => {
          const current = JSON.stringify(await colors(select));
          stableSamples = current === previous ? stableSamples + 1 : 0;
          previous = current;
          return stableSamples;
        },
        { intervals: [100, 100, 100, 150, 200], timeout: 3000 },
      )
      .toBeGreaterThanOrEqual(2);
  }

  for (const theme of ["light", "dark"] as const) {
    if (theme === "dark") {
      await page.getByRole("button", { name: "Switch to dark mode" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await waitForStableColors(tag);
    }

    const neutral = await colors(tag);
    const inactive = await colors(status);
    await chooseLibraryOption(page, "Tag", "automation");
    await tag.blur();

    const active = await colors(tag);
    expect(await tag.getAttribute("data-active")).toBe("true");
    expect(active.background).not.toBe(neutral.background);
    expect(active.border).not.toBe(neutral.border);
    expect(
      contrastRatio(active.text, active.background),
    ).toBeGreaterThanOrEqual(4.5);
    expect(await colors(status)).toEqual(inactive);

    await page
      .getByRole("region", { name: "Search and filter library" })
      .getByRole("button", { name: "Reset filters" })
      .click();
    expect(await tag.getAttribute("data-active")).toBeNull();
    await expect.poll(() => colors(tag)).toEqual(neutral);

    if (theme === "dark") {
      await page.getByRole("button", { name: "Switch to light mode" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    }
  }
});
