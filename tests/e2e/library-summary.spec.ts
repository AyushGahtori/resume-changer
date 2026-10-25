import { expect, test, type Page } from "@playwright/test";
import { chooseLibraryOption } from "./support/library-select";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createPersonalLibraryGuard,
  exampleLibraryPath,
  libraryRoot,
  personalLibraryPath,
} from "./support/personal-library";
import type { ResumeLibrary } from "../../src/lib/schemas/resume-data";

/**
 * The summary reports the loaded library, so its tests need libraries the
 * loader accepts. The personal library is read from the same fixture folder
 * the browser suite already isolates, and each test writes its own synthetic
 * library there before the page loads it.
 */
const personalLibrary = createPersonalLibraryGuard();

type SyntheticPoint = {
  id: string;
  text: string;
  tags: string[];
  skillIds: string[];
  metrics: never[];
  source: { type: "resume"; label: string };
  enabled: boolean;
};

function point(id: string): SyntheticPoint {
  return {
    id,
    text: `Synthetic achievement ${id}.`,
    tags: [],
    skillIds: [],
    metrics: [],
    source: { type: "resume", label: "Synthetic source" },
    enabled: true,
  };
}

function syntheticLibrary(
  overrides: Partial<ResumeLibrary> = {},
): ResumeLibrary {
  return {
    schemaVersion: 1,
    profile: {
      id: "profile-synthetic",
      fullName: "Synthetic Summary Person",
      headline: "Synthetic headline",
      links: [],
      education: [],
    },
    jobs: [
      {
        id: "job-synthetic",
        company: "Synthetic Company",
        title: "Synthetic Engineer",
        employmentType: "full-time",
        startDate: "2024-01",
        endDate: null,
        description: "Synthetic role.",
        points: [
          point("achievement-synthetic-1"),
          point("achievement-synthetic-2"),
        ],
      },
    ],
    projects: [
      {
        id: "project-synthetic",
        name: "Synthetic Project",
        startDate: "2024-03",
        endDate: null,
        description: "Synthetic project.",
        points: [point("achievement-synthetic-3")],
      },
    ],
    skills: [
      {
        id: "skill-synthetic",
        name: "Synthetic Skill",
        category: "Engineering",
        aliases: [],
        sources: ["user-notes"],
        isListedOnCurrentResume: true,
        evidenceAchievementIds: [],
      },
    ],
    credentials: [
      {
        id: "certificate-synthetic",
        kind: "certificate",
        name: "Synthetic Credential",
        issuer: "Synthetic Issuer",
        issuedDate: "2024-05-15",
      },
    ],
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
    ...overrides,
  };
}

async function writePersonalLibrary(library: ResumeLibrary) {
  await mkdir(join(libraryRoot, "data"), { recursive: true });
  await writeFile(personalLibraryPath, JSON.stringify(library), "utf8");
}

const metrics = (page: Page) => page.locator(".library-metric");

type ProfileFixture = {
  fullName: string;
  headline?: string;
};

async function writeIdentityLibrary(profile: ProfileFixture) {
  const example = JSON.parse(await readFile(exampleLibraryPath, "utf8"));
  const nextProfile = { ...example.profile, ...profile };
  if (profile.headline === undefined) {
    delete nextProfile.headline;
  }
  await writePersonalLibrary({ ...example, profile: nextProfile });
}

test.beforeAll(async () => {
  await personalLibrary.capture();
});

test.afterAll(async () => {
  await personalLibrary.restore();
});

test.beforeEach(async () => {
  // Every test starts from the shipped sample so a synthetic library from an
  // earlier test can never leak into the next one.
  await mkdir(join(libraryRoot, "data"), { recursive: true });
  await copyFile(
    join(process.cwd(), "examples", "sample-resume-library.json"),
    personalLibraryPath,
  );
});

test("labels the demo source and reports the loaded library counts", async ({
  page,
}) => {
  await page.goto("/library?source=demo");

  const summary = page.getByRole("region", { name: "Library summary" });
  await expect(summary).toBeVisible();
  await expect(summary.getByText("Fictional demo data")).toBeVisible();
  await expect(
    summary.getByRole("heading", { name: "Jordan Example" }),
  ).toBeVisible();

  await expect(metrics(page)).toHaveCount(5);
  const labels = await metrics(page).locator("dt span").allTextContents();
  expect(labels).toEqual([
    "Jobs",
    "Projects",
    "Points",
    "Skills",
    "Credentials",
  ]);

  const counts = await metrics(page).locator("dd").allTextContents();
  expect(counts).toEqual(["2", "2", "13", "14", "2"]);
});

test("labels the personal source and shows the optional headline", async ({
  page,
}) => {
  await page.goto("/library");

  const summary = page.getByRole("region", { name: "Library summary" });
  await expect(summary.getByText("My resume data")).toBeVisible();
  await expect(
    summary.getByRole("heading", { name: "Jordan Example" }),
  ).toBeVisible();
  await expect(
    summary.getByText("Software Engineer | Cloud Platforms"),
  ).toBeVisible();
});

test("omits the headline entirely when the profile has none", async ({
  page,
}) => {
  await writePersonalLibrary(
    syntheticLibrary({
      profile: {
        id: "profile-synthetic",
        fullName: "Headline Free Person",
        links: [],
        education: [],
      },
    }),
  );
  await page.goto("/library");

  const summary = page.getByRole("region", { name: "Library summary" });
  await expect(
    summary.getByRole("heading", { name: "Headline Free Person" }),
  ).toBeVisible();
  // No empty placeholder paragraph is left where the headline would be.
  await expect(summary.locator(".library-headline")).toHaveCount(0);
  await expect(summary.locator("p")).toHaveCount(1);
});

test("reports zero counts for an empty library", async ({ page }) => {
  await writePersonalLibrary(
    syntheticLibrary({ jobs: [], projects: [], skills: [], credentials: [] }),
  );
  await page.goto("/library");

  const counts = await metrics(page).locator("dd").allTextContents();
  expect(counts).toEqual(["0", "0", "0", "0", "0"]);
});

test("reports large counts without clipping them", async ({ page }) => {
  const skills = Array.from({ length: 250 }, (_, index) => ({
    id: `skill-bulk-${index}`,
    name: `Bulk Skill ${index}`,
    category: "Engineering",
    aliases: [] as string[],
    sources: ["user-notes" as const],
    isListedOnCurrentResume: true,
    evidenceAchievementIds: [] as string[],
  }));

  await writePersonalLibrary(syntheticLibrary({ skills }));
  await page.goto("/library");

  const counts = await metrics(page).locator("dd").allTextContents();
  expect(counts).toEqual(["1", "1", "3", "250", "1"]);

  const skillsValue = metrics(page).nth(3).locator("dd");
  await expect(skillsValue).toHaveText("250");
  // The value is not truncated or clipped by the tile.
  const clipped = await skillsValue.evaluate(
    (node) => node.scrollWidth > node.clientWidth + 1,
  );
  expect(clipped).toBe(false);
});

test("keeps the total counts when a search facet hides results", async ({
  page,
}) => {
  await page.goto("/library?source=demo");

  const before = await metrics(page).locator("dd").allTextContents();
  expect(before).toEqual(["2", "2", "13", "14", "2"]);

  await chooseLibraryOption(
    page,
    "Job or project",
    "job:job-example-cloud-labs",
  );

  // The workbench reports the narrowed result set.
  await expect(page.locator(".library-filter-summary")).toContainText(
    "4 of 13 achievement points",
  );
  // The summary still reports the library the user owns.
  const after = await metrics(page).locator("dd").allTextContents();
  expect(after).toEqual(before);
});

test("stacks the identity above a two-column metric grid on a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/library?source=demo");

  await expect(
    page.getByRole("region", { name: "Library summary" }),
  ).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  const layout = await page.evaluate(() => {
    const identity = document.querySelector(".library-identity")!;
    const grid = document.querySelector(".library-metrics")!;
    const tiles = Array.from(
      document.querySelectorAll(".library-metric"),
    ) as HTMLElement[];
    const columns = getComputedStyle(grid)
      .gridTemplateColumns.split(" ")
      .filter(Boolean).length;
    return {
      identityBottom: identity.getBoundingClientRect().bottom,
      gridTop: grid.getBoundingClientRect().top,
      columns,
      clippedLabels: tiles.filter((tile) => {
        const label = tile.querySelector("dt span")!;
        return label.scrollWidth > label.clientWidth + 1;
      }).length,
    };
  });

  // The identity reads first and the metrics follow below it.
  expect(layout.identityBottom).toBeLessThanOrEqual(layout.gridTop);
  expect(layout.columns).toBe(2);
  expect(layout.clippedLabels).toBe(0);
});

test("keeps every metric label and value visible in both themes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/library?source=demo");

  for (const theme of ["light", "dark"] as const) {
    // Wait for the client to restore the stored theme before toggling.
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      /^(light|dark)$/,
    );
    if ((await page.locator("html").getAttribute("data-theme")) !== theme) {
      await page
        .getByRole("button", { name: `Switch to ${theme} mode` })
        .click();
    }
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

    for (const label of [
      "Jobs",
      "Projects",
      "Points",
      "Skills",
      "Credentials",
    ]) {
      const tile = page
        .locator(".library-metric")
        .filter({ has: page.locator("dt span", { hasText: label }) })
        .first();
      await expect(tile).toBeVisible();
      await expect(tile.locator("dd")).toBeVisible();
    }
  }
});

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
    await writeIdentityLibrary({
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
    await writeIdentityLibrary({ fullName: "Riley Fixture" });
    await page.goto("/library");

    const summary = page.getByRole("region", { name: "Library summary" });
    await expect(
      summary.getByRole("heading", { name: "Riley Fixture" }),
    ).toBeVisible();
    await expect(summary.locator(".library-headline")).toHaveCount(0);
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
    await writeIdentityLibrary({ fullName: "Riley Fixture" });
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

async function tokenColor(page: Page, token: string) {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}

type MetricTile = {
  category: string | null;
  label: string | null;
  value: string | null;
  iconColor: string;
  background: string;
  iconSize: number;
  width: number;
  height: number;
  top: number;
  left: number;
  focusable: boolean;
  links: number;
};

async function readMetricTiles(page: Page): Promise<MetricTile[]> {
  return page.locator(".library-metric").evaluateAll((nodes) =>
    nodes.map((node) => {
      const tile = node as HTMLElement;
      const icon = tile.querySelector("dt svg") as SVGElement;
      const box = tile.getBoundingClientRect();
      return {
        category: tile.getAttribute("data-category"),
        label: tile.querySelector("dt span")?.textContent ?? null,
        value: tile.querySelector("dd")?.textContent ?? null,
        iconColor: getComputedStyle(icon).color,
        background: getComputedStyle(tile).backgroundColor,
        iconSize: icon.getBoundingClientRect().width,
        width: box.width,
        height: box.height,
        top: Math.round(box.top),
        left: Math.round(box.left),
        focusable: tile.hasAttribute("tabindex"),
        links: tile.querySelectorAll("a").length,
      };
    }),
  );
}

test("gives every metric its own restrained category accent", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/library?source=demo");

  const tiles = await readMetricTiles(page);
  expect(tiles.map((tile) => tile.category)).toEqual([
    "job",
    "project",
    "points",
    "skills",
    "credentials",
  ]);

  for (const tile of tiles) {
    const category = tile.category!;
    // The label and the icon read in the text safe step of the category hue.
    expect(tile.iconColor).toBe(
      await tokenColor(page, `--color-category-${category}-text`),
    );
    // The tile is a tint of that hue, not the saturated category colour.
    expect(tile.background).not.toBe(
      await tokenColor(page, `--color-category-${category}`),
    );
  }

  // Every category keeps its own colour, so the tiles are told apart.
  expect(new Set(tiles.map((tile) => tile.iconColor)).size).toBe(5);
});

test("states every count as text next to an icon and a label", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/library?source=demo");

  const tiles = await readMetricTiles(page);
  expect(tiles.map((tile) => tile.label)).toEqual([
    "Jobs",
    "Projects",
    "Points",
    "Skills",
    "Credentials",
  ]);
  // The count is real text, not a number carried by the icon or the colour.
  for (const tile of tiles) {
    expect(tile.value).toMatch(/^\d[\d,]*$/);
  }

  // The icons belong to the agreed 18px to 20px range.
  for (const tile of tiles) {
    expect(tile.iconSize).toBeGreaterThanOrEqual(18);
    expect(tile.iconSize).toBeLessThanOrEqual(20);
  }

  // A metric that is not a link stays out of the tab order.
  for (const tile of tiles) {
    expect(tile.focusable).toBe(false);
    expect(tile.links).toBe(0);
  }
});

test("sets the metric label and value in the agreed type scale", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/library?source=demo");

  const scale = await page
    .locator(".library-metric")
    .first()
    .evaluate((tile) => {
      const label = getComputedStyle(tile.querySelector("dt")!);
      const value = getComputedStyle(tile.querySelector("dd")!);
      return {
        labelSize: label.fontSize,
        labelLineHeight: label.lineHeight,
        valueSize: value.fontSize,
        valueLineHeight: value.lineHeight,
        valueWeight: value.fontWeight,
      };
    });

  expect(scale.labelSize).toBe("12px");
  expect(scale.labelLineHeight).toBe("16px");
  expect(scale.valueSize).toBe("26px");
  expect(scale.valueLineHeight).toBe("32px");
  expect(scale.valueWeight).toBe("700");
});

test("lays the metric row out in equal columns that wrap when they must", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/library?source=demo");

  const wide = await page.evaluate(() => {
    const grid = document.querySelector(".library-metrics") as HTMLElement;
    const tiles = Array.from(
      document.querySelectorAll(".library-metric"),
    ) as HTMLElement[];
    return {
      columns: getComputedStyle(grid)
        .gridTemplateColumns.split(" ")
        .filter(Boolean).length,
      rows: new Set(
        tiles.map((tile) => Math.round(tile.getBoundingClientRect().top)),
      ).size,
      widths: tiles.map((tile) =>
        Math.round(tile.getBoundingClientRect().width),
      ),
    };
  });

  // A wide screen holds the five metrics in one row of equal columns.
  expect(wide.columns).toBe(5);
  expect(wide.rows).toBe(1);
  expect(new Set(wide.widths).size).toBe(1);

  // A tablet keeps the same tiles but wraps them onto a second row.
  await page.setViewportSize({ width: 768, height: 1024 });
  const tablet = await page.evaluate(() => {
    const grid = document.querySelector(".library-metrics") as HTMLElement;
    const tiles = Array.from(
      document.querySelectorAll(".library-metric"),
    ) as HTMLElement[];
    const rowWidths = new Map<number, Set<number>>();
    for (const tile of tiles) {
      const box = tile.getBoundingClientRect();
      const row = Math.round(box.top);
      const widths = rowWidths.get(row) ?? new Set<number>();
      widths.add(Math.round(box.width));
      rowWidths.set(row, widths);
    }
    return {
      columns: getComputedStyle(grid)
        .gridTemplateColumns.split(" ")
        .filter(Boolean).length,
      rows: rowWidths.size,
      equalWithinRow: Array.from(rowWidths.values()).every((widths) => {
        const values = [...widths];
        return Math.max(...values) - Math.min(...values) <= 1;
      }),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });

  expect(tablet.rows).toBeGreaterThan(1);
  expect(tablet.equalWithinRow).toBe(true);
  expect(tablet.overflow).toBeLessThanOrEqual(0);
});

test("uses two columns and a full width final tile on a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/library?source=demo");

  const layout = await page.evaluate(() => {
    const grid = document.querySelector(".library-metrics") as HTMLElement;
    const tiles = Array.from(
      document.querySelectorAll(".library-metric"),
    ) as HTMLElement[];
    const first = tiles[0].getBoundingClientRect();
    const second = tiles[1].getBoundingClientRect();
    const last = tiles[tiles.length - 1].getBoundingClientRect();
    return {
      columns: getComputedStyle(grid)
        .gridTemplateColumns.split(" ")
        .filter(Boolean).length,
      lastSpansRow:
        Math.abs(last.width - (second.left - first.left + second.width)) < 2,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });

  expect(layout.columns).toBe(2);
  // The fifth tile has no partner, so it takes the whole row.
  expect(layout.lastSpansRow).toBe(true);
  expect(layout.overflow).toBeLessThanOrEqual(0);
});

test("keeps a large count inside the tile and groups it readably", async ({
  page,
}) => {
  const skills = Array.from({ length: 1200 }, (_, index) => ({
    id: `skill-bulk-${index}`,
    name: `Bulk Skill ${index}`,
    category: "Engineering",
    aliases: [] as string[],
    sources: ["user-notes" as const],
    isListedOnCurrentResume: true,
    evidenceAchievementIds: [] as string[],
  }));

  await writePersonalLibrary(syntheticLibrary({ skills }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/library");

  const tiles = await readMetricTiles(page);
  const skillsTile = tiles[3];
  expect(skillsTile.value).toBe("1,200");

  // The tile keeps the size of its neighbours, the count only steps down.
  expect(skillsTile.width).toBe(tiles[0].width);
  expect(skillsTile.height).toBe(tiles[0].height);

  const value = await page
    .locator(".library-metric")
    .nth(3)
    .locator("dd")
    .evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        size: style.fontSize,
        lineHeight: style.lineHeight,
        clipped: node.scrollWidth > node.clientWidth + 1,
      };
    });

  expect(value.size).toBe("24px");
  expect(value.lineHeight).toBe("32px");
  expect(value.clipped).toBe(false);
});
