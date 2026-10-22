import { expect, test, type Page } from "@playwright/test";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AchievementPoint,
  ResumeLibrary,
} from "../../src/lib/schemas/resume-data";
import { createPersonalLibraryGuard } from "./support/personal-library";

/**
 * The card renders real library data, so the tests build their own libraries
 * and write them into the isolated folder the browser suite already uses.
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
const libraryGuard = createPersonalLibraryGuard();

const LONG_REFERENCE =
  "Section 4.2 of the platform reliability review, covering the migration " +
  "from the legacy scheduler to the queue-backed orchestrator, with the " +
  "incident timeline and the post-incident actions";
const PUNCTUATED_LABEL = "Quarterly plan, 2nd edition (rev. 3)";
const PUNCTUATED_REFERENCE = "Page 1, Bullet 1 — “quoted” & annotated";
const PROVENANCE_SOURCES: Record<string, AchievementPoint["source"]> = {
  "achievement-service-capacity-design": {
    type: "resume",
    label: "Ayush resume PDF",
    reference: "Page 1, Bullet 1",
  },
  "achievement-cloud-deployment-platform": { type: "linkedin" },
  "achievement-ci-cd-pipeline": { type: "user-notes", label: "Weekly notes" },
  "achievement-service-observability": {
    type: "project-document",
    reference: "Section 3",
  },
  "achievement-orders-api": { type: "direct-user" },
  "achievement-accessible-admin-ui": {
    type: "resume",
    label: "Ayush resume PDF",
    reference: LONG_REFERENCE,
  },
  "achievement-release-check-automation": {
    type: "resume",
    label: PUNCTUATED_LABEL,
    reference: PUNCTUATED_REFERENCE,
  },
};

type SyntheticPoint = {
  id: string;
  text: string;
  tags: string[];
  skillIds: string[];
  metrics: {
    id: string;
    label: string;
    value: string;
    unit?: string;
    context?: string;
    evidence: string;
  }[];
  source: { type: "resume"; label?: string; reference?: string };
  enabled: boolean;
};

function point(
  id: string,
  overrides: Partial<SyntheticPoint> = {},
): SyntheticPoint {
  return {
    id,
    text: "Delivered a measurable improvement to the platform.",
    tags: [],
    skillIds: [],
    metrics: [],
    source: { type: "resume" },
    enabled: true,
    ...overrides,
  };
}

function syntheticLibrary(
  overrides: Partial<ResumeLibrary> = {},
): ResumeLibrary {
  return {
    schemaVersion: 1,
    profile: {
      id: "profile-card-synthetic",
      fullName: "Card Synthetic Person",
      links: [],
      education: [],
    },
    jobs: [
      {
        id: "job-card-synthetic",
        company: "Synthetic Company",
        title: "Synthetic Engineer",
        employmentType: "full-time",
        startDate: "2024-01",
        endDate: null,
        points: [
          point("achievement-card-bare"),
          point("achievement-card-one-metric", {
            metrics: [
              {
                id: "metric-card-one",
                label: "Server efficiency",
                value: "+28%",
                evidence: "Synthetic evidence",
              },
            ],
          }),
          point("achievement-card-many-metrics", {
            metrics: [
              {
                id: "metric-card-many-a",
                label: "Server efficiency",
                value: "+28%",
                evidence: "Synthetic evidence",
              },
              {
                id: "metric-card-many-b",
                label: "Response time",
                value: "-20",
                unit: "ms",
                context: "Synthetic context",
                evidence: "Synthetic evidence",
              },
              {
                id: "metric-card-many-c",
                label: "Cost per request",
                value: "-12%",
                evidence: "Synthetic evidence",
              },
            ],
          }),
          point("achievement-card-long", {
            text:
              "Rebuilt the billing pipeline that previously took four engineers " +
              "a full release cycle to change and that silently dropped every " +
              "invoice raised during a partial outage, which is a sentence that " +
              "keeps going well past the point where a card would normally cut " +
              "it off so the whole value stays on the page.",
            tags: ["reliability"],
            skillIds: ["skill-card-synthetic"],
            metrics: [
              {
                id: "metric-card-long",
                label: "Recovered invoices",
                value: "100%",
                evidence: "Synthetic evidence",
              },
            ],
            source: {
              type: "resume",
              label: "Synthetic resume PDF",
              reference: "Page 4, Bullet 2",
            },
            enabled: false,
          }),
        ],
      },
    ],
    projects: [
      {
        id: "project-card-synthetic",
        name: "Synthetic Project",
        startDate: "2024-03",
        endDate: null,
        points: [
          point("achievement-card-project", {
            tags: ["platform"],
            skillIds: ["skill-card-synthetic"],
          }),
        ],
      },
    ],
    skills: [
      {
        id: "skill-card-synthetic",
        name: "Synthetic Skill",
        category: "Engineering",
        aliases: [],
        sources: ["user-notes"],
        isListedOnCurrentResume: true,
        evidenceAchievementIds: ["achievement-card-long"],
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
    ...overrides,
  };
}

function libraryWithMetrics(metrics: SyntheticPoint["metrics"]): ResumeLibrary {
  const library = syntheticLibrary();
  library.jobs[0].points[0].metrics = metrics;
  return library;
}

function libraryWithChips(
  tags: string[],
  skillIds: string[] = [],
): ResumeLibrary {
  const library = syntheticLibrary();
  for (const job of library.jobs) {
    for (const point of job.points) {
      point.tags = [];
      point.skillIds = [];
    }
  }
  for (const project of library.projects) {
    for (const point of project.points) {
      point.tags = [];
      point.skillIds = [];
    }
  }
  library.jobs[0].points[0].tags = tags;
  library.jobs[0].points[0].skillIds = skillIds;
  return library;
}

async function writePersonalLibrary(library: ResumeLibrary) {
  await mkdir(join(libraryRoot, "data"), { recursive: true });
  await writeFile(personalLibraryPath, JSON.stringify(library), "utf8");
}

const cards = (page: Page) => page.locator("article.library-point");
const pointCard = (page: Page, pointId: string) =>
  cards(page).filter({ hasText: pointId });

async function writeLibraryWithSources() {
  const library = JSON.parse(
    await readFile(sampleLibraryPath, "utf8"),
  ) as ResumeLibrary;
  for (const job of library.jobs) {
    for (const point of job.points) {
      const source = PROVENANCE_SOURCES[point.id];
      if (source) point.source = source;
    }
  }
  await writePersonalLibrary(library);
}

function relativeLuminance(color: string) {
  const [red, green, blue] = color
    .match(/[\d.]+/g)!
    .map(Number)
    .map((value) => {
      const channel = value / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

test.beforeEach(async () => {
  await libraryGuard.capture();
  await mkdir(join(libraryRoot, "data"), { recursive: true });
  await copyFile(
    join(process.cwd(), "examples", "sample-resume-library.json"),
    personalLibraryPath,
  );
});

test.afterEach(async () => {
  await libraryGuard.restore();
});

test("renders one card per achievement with a unique accessible name", async ({
  page,
}) => {
  await page.goto("/library?source=demo");

  await expect(cards(page)).toHaveCount(13);

  const names = await page
    .locator("article.library-point")
    .evaluateAll((nodes) =>
      nodes.map((node) =>
        node.getAttribute("aria-labelledby")
          ? document.getElementById(node.getAttribute("aria-labelledby")!)
              ?.textContent
          : null,
      ),
    );
  expect(names.every((name) => Boolean(name && name.length > 0))).toBe(true);
  expect(new Set(names).size).toBe(names.length);

  // Every card keeps a heading element for its achievement text.
  await expect(page.locator("article.library-point h4")).toHaveCount(13);
});

test("reads the card in the board's order", async ({ page }) => {
  await writePersonalLibrary(syntheticLibrary());
  await page.goto("/library");

  const order = await page
    .locator("article.library-point")
    .filter({ hasText: "achievement-card-long" })
    .evaluate((node) =>
      Array.from(node.children).map((child) => child.className),
    );

  expect(order).toEqual([
    "library-point-header",
    "point-metrics",
    "point-facets",
    "point-provenance",
  ]);

  // The header holds the text, the state, and the edit action.
  const header = await page
    .locator("article.library-point")
    .filter({ hasText: "achievement-card-long" })
    .locator(".library-point-header")
    .evaluate((node) =>
      Array.from(node.children).map((child) => child.className),
    );
  expect(header).toEqual([
    "library-point-icon",
    "library-point-intro",
    "point-row-actions",
  ]);
});

test("omits absent fields instead of leaving empty placeholders", async ({
  page,
}) => {
  await writePersonalLibrary(syntheticLibrary());
  await page.goto("/library");

  const bare = page
    .locator("article.library-point")
    .filter({ hasText: "achievement-card-bare" });

  await expect(bare.locator(".point-metrics")).toHaveCount(0);
  await expect(bare.locator(".point-facets")).toHaveCount(0);
  await expect(bare.locator(".point-provenance")).toHaveText("Source: resume");
  // Nothing reserves a row for data that is not there.
  await expect(bare.locator(".library-point-text")).toHaveText(
    "Delivered a measurable improvement to the platform.",
  );
  await expect(bare.locator(".point-status")).toHaveText("Enabled");
});

test("keeps a long achievement and its source details in full", async ({
  page,
}) => {
  await writePersonalLibrary(syntheticLibrary());
  await page.goto("/library");

  const card = page
    .locator("article.library-point")
    .filter({ hasText: "achievement-card-long" });

  const text = card.locator(".library-point-text");
  const value = await text.innerText();
  expect(value.length).toBeGreaterThan(280);
  expect(value).toContain("keeps going well past the point");

  // The value is shown, not clamped or clipped.
  const style = await text.evaluate((node) => {
    const computed = getComputedStyle(node);
    return {
      lineClamp: computed.webkitLineClamp,
      overflow: computed.overflow,
      overflowWrap: computed.overflowWrap,
    };
  });
  expect(style.lineClamp).toBe("none");
  expect(style.overflow).not.toBe("hidden");
  expect(style.overflowWrap).toBe("anywhere");

  await expect(card.locator(".point-provenance")).toHaveText(
    "Source: resume · Synthetic resume PDF · Page 4, Bullet 2",
  );
});

test("keeps the header the same height for zero, one, and many metrics", async ({
  page,
}) => {
  await writePersonalLibrary(syntheticLibrary());
  await page.goto("/library");

  const heights = await page
    .locator("article.library-point")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const header = node.querySelector(".library-point-header")!;
        return {
          id: node.getAttribute("aria-labelledby"),
          height: Math.round(header.getBoundingClientRect().height),
          metrics: node.querySelectorAll(".point-metric").length,
        };
      }),
    );

  const bare = heights.find((entry) =>
    entry.id?.includes("achievement-card-bare"),
  );
  const one = heights.find((entry) =>
    entry.id?.includes("achievement-card-one-metric"),
  );
  const many = heights.find((entry) =>
    entry.id?.includes("achievement-card-many-metrics"),
  );

  expect(bare?.metrics).toBe(0);
  expect(one?.metrics).toBe(1);
  expect(many?.metrics).toBe(3);
  // Adding metrics changes the card, not the header that holds the state and
  // the edit action.
  expect(bare?.height).toBe(one?.height);
  expect(one?.height).toBe(many?.height);
});

test("shows the metric values, evidence, and context", async ({ page }) => {
  await writePersonalLibrary(syntheticLibrary());
  await page.goto("/library");

  const metrics = page
    .locator("article.library-point")
    .filter({ hasText: "achievement-card-many-metrics" })
    .locator(".point-metric");

  await expect(metrics).toHaveCount(3);
  await expect(metrics.nth(0).locator(".point-metric-label")).toHaveText(
    "Server efficiency",
  );
  await expect(metrics.nth(0).locator(".point-metric-value")).toHaveText(
    "+28%",
  );
  await expect(metrics.nth(1).locator(".point-metric-value")).toHaveText(
    "-20 ms",
  );
  await expect(metrics.nth(1).locator(".point-metric-evidence")).toHaveText(
    "Synthetic evidence",
  );
  await expect(metrics.nth(1).locator(".point-metric-context")).toHaveText(
    "Context Synthetic context",
  );
});

test("shows the enabled state and the edit action for personal data", async ({
  page,
}) => {
  await writePersonalLibrary(syntheticLibrary());
  await page.goto("/library");

  const card = page
    .locator("article.library-point")
    .filter({ hasText: "achievement-card-long" });
  await expect(card.locator(".point-status")).toHaveText("Disabled");
  await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();
  await expect(card.locator(".point-status svg")).toHaveCount(1);
});

test("keeps demo data read-only", async ({ page }) => {
  await page.goto("/library?source=demo");

  await expect(cards(page)).toHaveCount(13);
  await expect(
    page.locator("article.library-point").getByRole("button", { name: "Edit" }),
  ).toHaveCount(0);
  // The state is still reported, because it is information and not an action.
  await expect(page.locator(".point-status")).toHaveCount(13);
});

test("gives each experience kind its own category tile", async ({ page }) => {
  await writePersonalLibrary(syntheticLibrary());
  await page.goto("/library");

  const job = page
    .locator("article.library-point")
    .filter({ hasText: "achievement-card-bare" });
  const project = page
    .locator("article.library-point")
    .filter({ hasText: "achievement-card-project" });

  await expect(job.locator(".library-point-icon")).toHaveAttribute(
    "data-kind",
    "job",
  );
  await expect(project.locator(".library-point-icon")).toHaveAttribute(
    "data-kind",
    "project",
  );

  const colors = await page
    .locator(".library-point-icon")
    .evaluateAll((nodes) =>
      nodes.map((node) => getComputedStyle(node).backgroundColor),
    );
  expect(new Set(colors).size).toBe(2);
});

test("keeps the card readable in both themes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await writePersonalLibrary(syntheticLibrary());
  await page.goto("/library");

  for (const theme of ["light", "dark"] as const) {
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

    const card = page.locator("article.library-point").first();
    await expect(card).toBeVisible();
    await expect(card.locator(".library-point-text")).toBeVisible();

    // The card is separated from the page by a visible border.
    const border = await card.evaluate((node) => {
      const computed = getComputedStyle(node);
      return {
        width: computed.borderTopWidth,
        style: computed.borderTopStyle,
        color: computed.borderTopColor,
        background: computed.backgroundColor,
      };
    });
    expect(border.width).toBe("1px");
    expect(border.style).toBe("solid");
    expect(border.color).not.toBe(border.background);
  }
});

test("keeps the card inside a narrow viewport without hiding the actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await writePersonalLibrary(syntheticLibrary());
  await page.goto("/library");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  const card = page
    .locator("article.library-point")
    .filter({ hasText: "achievement-card-long" });
  await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();
  await expect(card.locator(".point-status")).toBeVisible();

  // On a phone the actions move onto their own row instead of squeezing the
  // achievement text.
  const layout = await card.evaluate((node) => {
    const header = node.querySelector(".library-point-header")!;
    const actions = node.querySelector(".point-row-actions")!;
    const text = node.querySelector(".library-point-text")!;
    return {
      actionsBottom: actions.getBoundingClientRect().bottom,
      headerBottom: header.getBoundingClientRect().bottom,
      textRight: text.getBoundingClientRect().right,
      cardRight: node.getBoundingClientRect().right,
    };
  });
  expect(layout.actionsBottom).toBeLessThanOrEqual(layout.headerBottom + 1);
  expect(layout.textRight).toBeLessThanOrEqual(layout.cardRight);
});

test("shows the label, value, unit, evidence and context of a metric", async ({
  page,
}) => {
  await writePersonalLibrary(
    libraryWithMetrics([
      {
        id: "metric-fixture-main",
        label: "Throughput improvement",
        value: "28",
        unit: "%",
        evidence: "Recorded by the synthetic benchmark.",
        context: "Synthetic benchmark scenario",
      },
    ]),
  );
  await page.goto("/library");

  const metric = page.locator(".point-metric").first();
  await expect(metric).toHaveAttribute("data-metric-id", "metric-fixture-main");
  await expect(metric.locator(".point-metric-label")).toHaveText(
    "Throughput improvement",
  );
  await expect(metric.locator(".point-metric-number")).toHaveText("28");
  await expect(metric.locator(".point-metric-unit")).toHaveText("%");
  // The number and its unit read as one figure.
  await expect(metric.locator(".point-metric-value")).toHaveText("28%");
  await expect(metric.locator(".point-metric-evidence")).toHaveText(
    "Recorded by the synthetic benchmark.",
  );
  await expect(metric.locator(".point-metric-context")).toContainText(
    "Synthetic benchmark scenario",
  );
});

test("keeps the evidence in the card without a hover", async ({ page }) => {
  await writePersonalLibrary(
    libraryWithMetrics([
      {
        id: "metric-fixture-evidence",
        label: "Throughput",
        value: "28",
        evidence: "Synthetic evidence",
      },
    ]),
  );
  await page.goto("/library");

  const evidence = page.locator(".point-metric-evidence").first();
  await expect(evidence).toBeVisible();

  const state = await evidence.evaluate((node) => {
    const style = getComputedStyle(node);
    const details = node.closest("details");
    return {
      visibility: style.visibility,
      display: style.display,
      opacity: style.opacity,
      inClosedDetails: Boolean(details && !details.open),
      title: node.getAttribute("title"),
    };
  });

  expect(state.visibility).toBe("visible");
  expect(state.display).not.toBe("none");
  expect(state.opacity).toBe("1");
  // The evidence is not parked in a closed disclosure or a tooltip.
  expect(state.inClosedDetails).toBe(false);
  expect(state.title).toBeNull();
});

test("does not present a metric value as a positive score", async ({
  page,
}) => {
  await writePersonalLibrary(
    libraryWithMetrics([
      {
        id: "metric-fixture-color",
        label: "Throughput",
        value: "28",
        evidence: "Synthetic evidence",
      },
    ]),
  );
  await page.goto("/library");

  const value = page.locator(".point-metric-value").first();
  const color = await value.evaluate((node) => getComputedStyle(node).color);
  const statusColor = await page
    .locator(".point-status.is-enabled")
    .first()
    .evaluate((node) => getComputedStyle(node).color);

  expect(color).not.toBe(statusColor);

  // No trend arrow is added to a figure that only states a number.
  expect(await value.locator("svg").count()).toBe(0);

  const iconColor = await page
    .locator(".point-metric-icon")
    .first()
    .evaluate((node) => getComputedStyle(node).color);
  expect(iconColor).not.toBe(statusColor);
});

test("puts two metrics in two columns and stacks them on a phone", async ({
  page,
}) => {
  await writePersonalLibrary(
    libraryWithMetrics([
      {
        id: "metric-fixture-one",
        label: "Throughput improvement",
        value: "28",
        unit: "%",
        evidence: "Recorded by the fictional benchmark.",
      },
      {
        id: "metric-fixture-two",
        label: "Investigation time reduction",
        value: "20",
        unit: "%",
        evidence: "Recorded by the fictional usability exercise.",
      },
    ]),
  );

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/library");

  const card = page.locator(".library-point").first();
  await expect(card.locator(".point-metric")).toHaveCount(2);

  const wide = await page.evaluate(() => {
    const grid = document.querySelector(".point-metrics") as HTMLElement;
    const metrics = Array.from(
      document.querySelectorAll(".library-point .point-metric"),
    ) as HTMLElement[];
    return {
      columns: getComputedStyle(grid)
        .gridTemplateColumns.split(" ")
        .filter(Boolean).length,
      tops: metrics.map((metric) =>
        Math.round(metric.getBoundingClientRect().top),
      ),
    };
  });

  expect(wide.columns).toBe(2);
  // Both metrics share the row.
  expect(wide.tops[0]).toBe(wide.tops[1]);

  await page.setViewportSize({ width: 390, height: 844 });

  const narrow = await page.evaluate(() => {
    const grid = document.querySelector(".point-metrics") as HTMLElement;
    const metrics = Array.from(
      document.querySelectorAll(".library-point .point-metric"),
    ) as HTMLElement[];
    return {
      columns: getComputedStyle(grid)
        .gridTemplateColumns.split(" ")
        .filter(Boolean).length,
      tops: metrics.map((metric) =>
        Math.round(metric.getBoundingClientRect().top),
      ),
    };
  });

  expect(narrow.columns).toBe(1);
  // The metrics are stacked instead of squeezed side by side.
  expect(narrow.tops[0]).not.toBe(narrow.tops[1]);
});

test("omits a unit and a context the metric does not have", async ({
  page,
}) => {
  await writePersonalLibrary(
    libraryWithMetrics([
      {
        id: "metric-fixture-plain",
        label: "Servers migrated",
        value: "12",
        evidence: "Recorded during the migration window.",
      },
    ]),
  );
  await page.goto("/library");

  const metric = page
    .locator(".library-point")
    .first()
    .locator(".point-metric");
  await expect(metric.locator(".point-metric-label")).toHaveText(
    "Servers migrated",
  );
  await expect(metric.locator(".point-metric-number")).toHaveText("12");
  await expect(metric.locator(".point-metric-value")).toHaveText("12");
  // Nothing is invented for the fields the metric does not carry.
  await expect(metric.locator(".point-metric-unit")).toHaveCount(0);
  await expect(metric.locator(".point-metric-context")).toHaveCount(0);
  await expect(metric.locator(".point-metric-evidence")).toHaveText(
    "Recorded during the migration window.",
  );
});

test("renders every metric once and keeps its identifier", async ({ page }) => {
  await writePersonalLibrary(
    libraryWithMetrics([
      {
        id: "metric-fixture-one",
        label: "Throughput improvement",
        value: "28",
        unit: "%",
        evidence: "Recorded by the fictional benchmark.",
      },
      {
        id: "metric-fixture-two",
        label: "Investigation time reduction",
        value: "20",
        unit: "%",
        evidence: "Recorded by the fictional usability exercise.",
      },
    ]),
  );
  await page.goto("/library");

  const card = page.locator(".library-point").first();
  const metrics = card.locator(".point-metric");
  await expect(metrics).toHaveCount(2);

  const ids = await metrics.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-metric-id")),
  );
  expect(ids).toEqual(["metric-fixture-one", "metric-fixture-two"]);

  // No metric is rendered twice, so no figure is counted twice.
  const text = (await card.textContent()) ?? "";
  expect(text.split("Throughput improvement").length - 1).toBe(1);
  expect(text.split("Investigation time reduction").length - 1).toBe(1);
});

test("keeps long metric text inside the card", async ({ page }) => {
  await writePersonalLibrary(
    libraryWithMetrics([
      {
        id: "metric-fixture-long",
        label:
          "A very long metric label that keeps going well past the width of a card column",
        value: "1234567890123456789",
        unit: "requests per second",
        context:
          "A long context sentence that also has to find a home inside the card without pushing the page sideways.",
        evidence:
          "A long evidence sentence that explains where the figure comes from and has to stay readable at every width.",
      },
    ]),
  );
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/library");

  const layout = await page.evaluate(() => {
    const metric = document.querySelector(".point-metric") as HTMLElement;
    const value = metric.querySelector(".point-metric-value") as HTMLElement;
    const evidence = metric.querySelector(
      ".point-metric-evidence",
    ) as HTMLElement;
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      metricWidth: metric.scrollWidth,
      metricClientWidth: metric.clientWidth,
      valueWidth: value.scrollWidth,
      valueClientWidth: value.clientWidth,
      evidenceWidth: evidence.scrollWidth,
      evidenceClientWidth: evidence.clientWidth,
    };
  });

  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.metricWidth).toBeLessThanOrEqual(layout.metricClientWidth + 1);
  expect(layout.valueWidth).toBeLessThanOrEqual(layout.valueClientWidth + 1);
  expect(layout.evidenceWidth).toBeLessThanOrEqual(
    layout.evidenceClientWidth + 1,
  );

  // The figure itself is still complete.
  await expect(page.locator(".point-metric-number").first()).toHaveText(
    "1234567890123456789",
  );
});

test("renders tags and linked skills as distinct, duplicate-free chips", async ({
  page,
}) => {
  await writePersonalLibrary(
    libraryWithChips(
      ["backend", "backend", "api-design", "api-design"],
      ["skill-card-synthetic"],
    ),
  );
  await page.goto("/library");

  const card = cards(page).first();
  await expect(card.locator(".facet-chip.is-tag")).toHaveCount(2);
  await expect(card.locator(".facet-chip.is-skill")).toHaveCount(1);
  await expect(
    card.getByRole("button", { name: "Filter by #backend" }),
  ).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Filter by skill Synthetic Skill" }),
  ).toBeVisible();
  await expect(card.getByText("skill-card-synthetic")).toHaveCount(0);
});

test("filters by tag and exposes the selected chip state", async ({ page }) => {
  await writePersonalLibrary(libraryWithChips(["only-this-point"], []));
  await page.goto("/library");

  const card = cards(page).first();
  const chip = card.getByRole("button", { name: "Filter by #only-this-point" });
  await chip.click();

  await expect(page.getByLabel("Tag")).toHaveValue("only-this-point");
  await expect(page.locator(".library-result-count")).toContainText(
    "1 result of",
  );
  await expect(chip).toHaveAttribute("aria-pressed", "true");
});

test("filters by a linked skill and supports keyboard activation", async ({
  page,
}) => {
  await writePersonalLibrary(libraryWithChips([], ["skill-card-synthetic"]));
  await page.goto("/library");

  const card = cards(page).first();
  const chip = card.getByRole("button", {
    name: "Filter by skill Synthetic Skill",
  });
  await chip.focus();
  await chip.press("Enter");

  await expect(page.getByLabel("Linked skill")).toHaveValue(
    "skill-card-synthetic",
  );
  await expect(page.locator(".library-result-count")).toContainText(
    "1 result of",
  );
  await expect(chip).toHaveAttribute("aria-pressed", "true");
});

test("reveals all overflow chips and can collapse them again", async ({
  page,
}) => {
  const tags = [
    "backend",
    "api-design",
    "cloud",
    "operations",
    "platform",
    "observability",
    "release-engineering",
    "backend",
  ];
  await writePersonalLibrary(libraryWithChips(tags, ["skill-card-synthetic"]));
  await page.goto("/library");

  const card = cards(page).first();
  const visibleChips = card.locator(".facet-chip:not(.is-more)");
  const more = card.locator(".facet-chip.is-more");
  await expect(visibleChips).toHaveCount(6);
  await expect(more).toHaveText("+2");
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(
    card.getByRole("button", { name: "Filter by #release-engineering" }),
  ).toHaveCount(0);

  await more.click();
  await expect(visibleChips).toHaveCount(8);
  await expect(
    card.getByRole("button", { name: "Filter by #release-engineering" }),
  ).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Filter by #backend" }),
  ).toHaveCount(1);
  await expect(more).toHaveText("Show less");
  await expect(more).toHaveAttribute("aria-expanded", "true");

  await more.click();
  await expect(visibleChips).toHaveCount(6);
  await expect(more).toHaveText("+2");
});

test("keeps an active filtered chip visible when it exceeds the collapsed limit", async ({
  page,
}) => {
  const tags = Array.from({ length: 7 }, (_, index) => `tag-${index}`);
  await writePersonalLibrary(libraryWithChips(tags, ["skill-card-synthetic"]));
  await page.goto("/library");
  await page.getByRole("combobox", { name: "Tag" }).selectOption("tag-6");

  const card = cards(page).first();
  const selected = card.getByRole("button", { name: "Filter by #tag-6" });
  await expect(selected).toBeVisible();
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  await expect(card.locator(".facet-chip.is-more")).toHaveText("+1");
});

test("wraps a long tag label at 320px without horizontal overflow", async ({
  page,
}) => {
  const longTag = "service-boundary-" + "very-long-label-".repeat(5);
  await writePersonalLibrary(libraryWithChips([longTag]));
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/library");

  const chip = cards(page)
    .first()
    .getByRole("button", {
      name: `Filter by #${longTag}`,
    });
  await expect(chip).toContainText(longTag);
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(
    dimensions.viewportWidth,
  );
});

test("keeps card chips interactive and free of remove/delete actions", async ({
  page,
}) => {
  await writePersonalLibrary(
    libraryWithChips(["actionable"], ["skill-card-synthetic"]),
  );
  await page.goto("/library");

  const card = cards(page).first();
  await expect(card.getByRole("button", { name: /remove/i })).toHaveCount(0);
  await expect(card.getByRole("button", { name: /delete/i })).toHaveCount(0);
  await expect(card.locator(".point-facets button")).toHaveCount(2);
});

test("uses compact tag and skill chips with comfortable keyboard targets", async ({
  page,
}) => {
  await writePersonalLibrary(
    libraryWithChips(["backend"], ["skill-card-synthetic"]),
  );
  await page.goto("/library");

  const card = cards(page).first();
  const metrics = await card
    .locator(".facet-chip.is-tag")
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        height: element.getBoundingClientRect().height,
        radius: parseFloat(style.borderTopLeftRadius),
        fontSize: parseFloat(style.fontSize),
        paddingLeft: parseFloat(style.paddingLeft),
        paddingRight: parseFloat(style.paddingRight),
      };
    });
  expect(metrics.height).toBeGreaterThanOrEqual(24);
  expect(metrics.height).toBeLessThanOrEqual(30);
  expect(metrics.radius).toBeGreaterThanOrEqual(metrics.height / 2);
  expect(metrics.fontSize).toBeGreaterThanOrEqual(11);
  expect(metrics.fontSize).toBeLessThanOrEqual(12);
  expect(metrics.paddingLeft).toBeCloseTo(8, 0);
  expect(metrics.paddingRight).toBeCloseTo(8, 0);

  const gap = await card.locator(".point-facets").evaluate((row) => {
    const chips = row.querySelectorAll(".facet-chip");
    const first = chips[0].getBoundingClientRect();
    const second = chips[1].getBoundingClientRect();
    return second.left - first.right;
  });
  expect(gap).toBeGreaterThanOrEqual(6);
  expect(gap).toBeLessThanOrEqual(8);
});

test("keeps chip text readable in both themes", async ({ page }) => {
  await writePersonalLibrary(
    libraryWithChips(["backend"], ["skill-card-synthetic"]),
  );
  await page.goto("/library");

  const card = cards(page).first();
  const readColors = () =>
    card.evaluate((element) => {
      const tag = element.querySelector(".facet-chip.is-tag")!;
      const skill = element.querySelector(".facet-chip.is-skill")!;
      return {
        tagBackground: getComputedStyle(tag).backgroundColor,
        tagText: getComputedStyle(tag).color,
        skillBackground: getComputedStyle(skill).backgroundColor,
        skillText: getComputedStyle(skill).color,
      };
    });

  const light = await readColors();
  expect(
    contrastRatio(light.tagText, light.tagBackground),
  ).toBeGreaterThanOrEqual(4.5);
  expect(
    contrastRatio(light.skillText, light.skillBackground),
  ).toBeGreaterThanOrEqual(4.5);

  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.waitForTimeout(350);
  const dark = await readColors();
  expect(
    contrastRatio(dark.tagText, dark.tagBackground),
  ).toBeGreaterThanOrEqual(4.5);
  expect(
    contrastRatio(dark.skillText, dark.skillBackground),
  ).toBeGreaterThanOrEqual(4.5);
  expect(dark.tagBackground).not.toBe(dark.skillBackground);
});

test.describe("achievement point provenance", () => {
  test.beforeEach(async ({ page }) => {
    await writeLibraryWithSources();
    await page.goto("/library");
  });

  test("shows each source type and only the available details", async ({
    page,
  }) => {
    const expected = [
      [
        "achievement-service-capacity-design",
        "Source: resume · Ayush resume PDF · Page 1, Bullet 1",
      ],
      ["achievement-cloud-deployment-platform", "Source: linkedin"],
      ["achievement-ci-cd-pipeline", "Source: user-notes · Weekly notes"],
      [
        "achievement-service-observability",
        "Source: project-document · Section 3",
      ],
      ["achievement-orders-api", "Source: direct-user"],
    ] as const;

    for (const [pointId, text] of expected) {
      await expect(
        pointCard(page, pointId).locator(".point-provenance"),
      ).toHaveText(text);
    }
  });

  test("omits missing optional fields without dangling punctuation", async ({
    page,
  }) => {
    const typeOnly = await pointCard(page, "achievement-orders-api")
      .locator(".point-provenance")
      .innerText();
    expect(typeOnly).toBe("Source: direct-user");
    expect(typeOnly).not.toContain("·");
    expect(typeOnly).not.toMatch(/page|bullet|line|section/i);

    const labelOnly = await pointCard(page, "achievement-ci-cd-pipeline")
      .locator(".point-provenance")
      .innerText();
    expect(labelOnly).toBe("Source: user-notes · Weekly notes");
    expect(labelOnly.split("·")).toHaveLength(2);
    expect(labelOnly.trim().endsWith("·")).toBe(false);

    const referenceOnly = await pointCard(
      page,
      "achievement-service-observability",
    )
      .locator(".point-provenance")
      .innerText();
    expect(referenceOnly).toBe("Source: project-document · Section 3");
    expect(referenceOnly.split("·")).toHaveLength(2);
  });

  test("keeps provenance visible without hover or disclosure", async ({
    page,
  }) => {
    const provenance = pointCard(page, "achievement-orders-api").locator(
      ".point-provenance",
    );
    await expect(provenance).toBeVisible();

    const state = await provenance.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        opacity: style.opacity,
        visibility: style.visibility,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
        insideDetails: Boolean(element.closest("details")),
        ariaExpanded: element.getAttribute("aria-expanded"),
      };
    });
    expect(state.opacity).toBe("1");
    expect(state.visibility).toBe("visible");
    expect(state.textOverflow).not.toBe("ellipsis");
    expect(state.whiteSpace).not.toBe("nowrap");
    expect(state.insideDetails).toBe(false);
    expect(state.ariaExpanded).toBeNull();
  });

  test("places provenance after metrics and chips", async ({ page }) => {
    const card = pointCard(page, "achievement-service-capacity-design");
    const order = await card.evaluate((element) => {
      const provenance = element.querySelector(".point-provenance")!;
      const metrics = element.querySelector(".point-metrics");
      const facets = element.querySelector(".point-facets");
      const follows = (previous: Element | null) =>
        previous
          ? Boolean(
              previous.compareDocumentPosition(provenance) &
              Node.DOCUMENT_POSITION_FOLLOWING,
            )
          : true;
      return {
        afterMetrics: follows(metrics),
        afterFacets: follows(facets),
      };
    });
    expect(order.afterMetrics).toBe(true);
    expect(order.afterFacets).toBe(true);

    const boxes = await card.evaluate((element) => {
      const provenance = element
        .querySelector(".point-provenance")!
        .getBoundingClientRect();
      const facets = element
        .querySelector(".point-facets")!
        .getBoundingClientRect();
      return { provenanceTop: provenance.top, facetsBottom: facets.bottom };
    });
    expect(boxes.provenanceTop).toBeGreaterThanOrEqual(boxes.facetsBottom);
  });

  test("gives the source type more weight than its prefix", async ({
    page,
  }) => {
    const weights = await pointCard(page, "achievement-service-capacity-design")
      .locator(".point-provenance")
      .evaluate((element) => {
        const prefix = element.querySelector(".point-provenance-prefix")!;
        const type = element.querySelector(".point-provenance-type")!;
        return {
          prefix: Number(getComputedStyle(prefix).fontWeight),
          type: Number(getComputedStyle(type).fontWeight),
          prefixText: prefix.textContent,
          typeText: type.textContent,
        };
      });

    expect(weights.prefixText).toBe("Source:");
    expect(weights.typeText).toBe("resume");
    expect(weights.type).toBeGreaterThan(weights.prefix);
  });

  test("keeps provenance readable in light and dark themes", async ({
    page,
  }) => {
    const provenance = pointCard(
      page,
      "achievement-service-capacity-design",
    ).locator(".point-provenance");
    const readColors = () =>
      provenance.evaluate((element) => {
        const prefix = element.querySelector(".point-provenance-prefix")!;
        const type = element.querySelector(".point-provenance-type")!;
        const background = (node: Element): string => {
          let current: Element | null = node;
          while (current) {
            const color = getComputedStyle(current).backgroundColor;
            const alpha = color.match(/rgba?\([^)]*,\s*([\d.]+)\)/);
            const opaque =
              color !== "transparent" &&
              color !== "rgba(0, 0, 0, 0)" &&
              (!alpha || Number(alpha[1]) > 0);
            if (opaque) return color;
            current = current.parentElement;
          }
          return getComputedStyle(document.body).backgroundColor;
        };
        return {
          prefix: getComputedStyle(prefix).color,
          type: getComputedStyle(type).color,
          background: background(element),
          fontSize: parseFloat(getComputedStyle(element).fontSize),
          lineHeight: parseFloat(getComputedStyle(element).lineHeight),
        };
      });

    const light = await readColors();
    expect(
      contrastRatio(light.prefix, light.background),
    ).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(light.type, light.background)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(light.fontSize).toBeGreaterThanOrEqual(11);
    expect(light.fontSize).toBeLessThanOrEqual(12);
    expect(light.lineHeight).toBeGreaterThanOrEqual(16);

    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect
      .poll(async () => {
        const dark = await readColors();
        return Math.min(
          contrastRatio(dark.prefix, dark.background),
          contrastRatio(dark.type, dark.background),
        );
      })
      .toBeGreaterThanOrEqual(4.5);
  });

  test("wraps long references at 320px without clipping or overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.reload();

    const provenance = pointCard(
      page,
      "achievement-accessible-admin-ui",
    ).locator(".point-provenance");
    await expect(provenance).toContainText(LONG_REFERENCE);

    const metrics = await provenance.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        height: element.getBoundingClientRect().height,
        lineHeight: parseFloat(style.lineHeight),
        textOverflow: style.textOverflow,
        overflowWrap: style.overflowWrap,
      };
    });
    expect(metrics.height).toBeGreaterThan(metrics.lineHeight);
    expect(metrics.textOverflow).not.toBe("ellipsis");
    expect(metrics.overflowWrap).toBe("anywhere");

    const widths = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(widths.documentWidth).toBeLessThanOrEqual(widths.viewportWidth);
  });

  test("preserves punctuation in the source label and reference", async ({
    page,
  }) => {
    const provenance = pointCard(
      page,
      "achievement-release-check-automation",
    ).locator(".point-provenance");
    await expect(provenance).toHaveText(
      `Source: resume · ${PUNCTUATED_LABEL} · ${PUNCTUATED_REFERENCE}`,
    );
    await expect(provenance).toContainText(PUNCTUATED_LABEL);
    await expect(provenance).toContainText(PUNCTUATED_REFERENCE);
  });

  test("never exposes a personal file path in provenance", async ({ page }) => {
    const texts = await page.locator(".point-provenance").allTextContents();
    expect(texts.length).toBeGreaterThan(0);

    for (const text of texts) {
      expect(text).not.toContain(libraryRoot);
      expect(text).not.toMatch(/[A-Za-z]:[\\/]/);
      expect(text).not.toMatch(/(^|\s)(\/|~)\//);
      expect(text).not.toContain("resume-library.json");
    }
  });
});
