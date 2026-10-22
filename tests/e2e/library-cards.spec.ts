import { expect, test, type Page } from "@playwright/test";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResumeLibrary } from "../../src/lib/schemas/resume-data";

/**
 * The card renders real library data, so the tests build their own libraries
 * and write them into the isolated folder the browser suite already uses.
 */
const libraryRoot =
  process.env.RESUME_LIBRARY_ROOT ??
  join(tmpdir(), "resume-changer-playwright-data-3010");
const personalLibraryPath = join(libraryRoot, "data", "resume-library.json");

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

async function writePersonalLibrary(library: ResumeLibrary) {
  await mkdir(join(libraryRoot, "data"), { recursive: true });
  await writeFile(personalLibraryPath, JSON.stringify(library), "utf8");
}

const cards = (page: Page) => page.locator("article.library-point");

test.beforeEach(async () => {
  await mkdir(join(libraryRoot, "data"), { recursive: true });
  await copyFile(
    join(process.cwd(), "examples", "sample-resume-library.json"),
    personalLibraryPath,
  );
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
          metrics: node.querySelectorAll(".point-metrics li").length,
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
    .locator(".point-metrics li");

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
  await expect(metrics.nth(1).locator(".point-metric-note").nth(0)).toHaveText(
    "Synthetic evidence",
  );
  await expect(metrics.nth(1).locator(".point-metric-note").nth(1)).toHaveText(
    "Synthetic context",
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
