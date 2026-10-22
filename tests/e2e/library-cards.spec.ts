import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createPersonalLibraryGuard,
  exampleLibraryPath,
  libraryRoot,
  personalLibraryPath,
} from "./support/personal-library";

type MetricFixture = {
  id: string;
  label: string;
  value: string;
  unit?: string;
  context?: string;
  evidence: string;
};

type LibraryFixture = {
  fullName?: string;
  headline?: string | null;
  /** Replaces the text of the first achievement, keeping its identifier. */
  point?: {
    text: string;
    sourceType?: string;
    sourceLabel?: string;
    /** Replaces the metrics of the first achievement. */
    metrics?: MetricFixture[];
  };
  /** Removes every achievement, so the library renders its empty state. */
  empty?: boolean;
};

const personalLibrary = createPersonalLibraryGuard();

test.beforeAll(async () => {
  await personalLibrary.capture();
});

test.afterAll(async () => {
  await personalLibrary.restore();
});

/**
 * Writes an isolated personal library so the card can be checked against
 * known content. The real personal file on this machine is never read or
 * replaced: the suite points `RESUME_LIBRARY_ROOT` at a temporary folder.
 */
async function writePersonalLibrary(fixture: LibraryFixture) {
  const example = JSON.parse(await readFile(exampleLibraryPath, "utf8"));
  const jobs = example.jobs.map((job: { points: unknown[] }) => ({
    ...job,
    points: [...job.points],
  }));
  const projects = example.projects.map((project: { points: unknown[] }) => ({
    ...project,
    points: [...project.points],
  }));

  if (fixture.empty) {
    for (const item of [...jobs, ...projects]) item.points = [];
  } else if (fixture.point) {
    const [firstJob] = jobs;
    const [firstPoint] = firstJob.points;
    firstJob.points[0] = {
      ...firstPoint,
      text: fixture.point.text,
      ...(fixture.point.metrics
        ? { metrics: fixture.point.metrics }
        : {}),
      source: {
        type: fixture.point.sourceType ?? "user-notes",
        label: fixture.point.sourceLabel ?? "Fixture entry",
      },
    };
  }

  // The schema rejects skills that cite achievements the library no longer
  // holds, so the references are trimmed to the surviving identifiers.
  const achievementIds = new Set(
    [...jobs, ...projects].flatMap((item) =>
      item.points.map((point: { id: string }) => point.id),
    ),
  );
  const skills = example.skills.map(
    (skill: { evidenceAchievementIds: string[] }) => ({
      ...skill,
      evidenceAchievementIds: skill.evidenceAchievementIds.filter((id) =>
        achievementIds.has(id),
      ),
    }),
  );

  const library = {
    ...example,
    profile: {
      ...example.profile,
      fullName: fixture.fullName ?? example.profile.fullName,
      headline:
        fixture.headline === undefined
          ? example.profile.headline
          : fixture.headline,
    },
    jobs,
    projects,
    skills,
  };
  await mkdir(join(libraryRoot, "data"), { recursive: true });
  await writeFile(
    personalLibraryPath,
    JSON.stringify(library, null, 2),
    "utf8",
  );
}

function parseColor(value: string): [number, number, number] {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) throw new Error(`Unsupported color value: ${value}`);
  const [red, green, blue] = match[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  return [red, green, blue];
}

function relativeLuminance([red, green, blue]: [number, number, number]) {
  const channel = (value: number) => {
    const srgb = value / 255;
    return srgb <= 0.03928
      ? srgb / 12.92
      : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
  );
}

function contrastRatio(foreground: string, background: string) {
  const first = relativeLuminance(parseColor(foreground));
  const second = relativeLuminance(parseColor(background));
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Waits until the theme transition has finished, so colours are not read mid-flight. */
async function waitForSettledTheme(page: Page) {
  await page.waitForFunction(() => {
    const probe = window as unknown as { __backgroundProbe?: string };
    const current = getComputedStyle(document.body).backgroundColor;
    const settled = probe.__backgroundProbe === current;
    probe.__backgroundProbe = current;
    return settled;
  });
}

async function readNarrative(page: Page, index = 0) {
  return page.evaluate((position) => {
    const element = document.querySelectorAll(".library-point-text")[position];
    if (!element) return null;
    const style = getComputedStyle(element);
    return {
      text: element.textContent ?? "",
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      fontWeight: style.fontWeight,
      color: style.color,
      borderLeftWidth: style.borderLeftWidth,
      borderLeftColor: style.borderLeftColor,
      overflow: style.overflow,
      webkitLineClamp: style.webkitLineClamp,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight,
    };
  }, index);
}

/** Resolves a colour token to the value the browser paints it with. */
async function resolveToken(page: Page, token: string) {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}

/** Finds the painted surface behind an element, walking up the backgrounds. */
async function readSurface(page: Page, selector: string) {
  return page.evaluate((target) => {
    const element = document.querySelector(target);
    if (!element) return "";
    let node: HTMLElement | null = element as HTMLElement;
    while (node) {
      const background = getComputedStyle(node).backgroundColor;
      const transparent =
        background === "transparent" || background === "rgba(0, 0, 0, 0)";
      if (background && !transparent) return background;
      node = node.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  }, selector);
}

test("keeps the achievement sentence apart from the job context", async ({
  page,
}) => {
  await page.goto("/library?source=demo");

  const group = page.getByRole("region", { name: "Job: Platform Engineer" });
  await expect(
    group.getByRole("heading", { name: "Platform Engineer" }),
  ).toBeVisible();
  await expect(group.getByText("Example Cloud Labs")).toBeVisible();
  await expect(group.getByText("01/2023 – Present")).toBeVisible();

  const narrative = await readNarrative(page);
  expect(narrative?.text).toBe(
    "Redesigned service boundaries and capacity planning for a multi-tenant processing platform.",
  );
  expect(narrative?.text).not.toContain("Platform Engineer");
  expect(narrative?.text).not.toContain("Example Cloud Labs");
});

test("renders the achievement text as the most prominent body content", async ({
  page,
}) => {
  await page.goto("/library?source=demo");

  const narrative = await readNarrative(page);
  expect(narrative).toMatchObject({
    fontSize: "14px",
    lineHeight: "20px",
    fontWeight: "400",
  });

  const provenance = await page.evaluate(() => {
    const element = document.querySelector(".point-provenance");
    if (!element) return null;
    return { fontSize: getComputedStyle(element).fontSize };
  });
  expect(provenance?.fontSize).toBe("12px");

  // The narrative uses the primary text colour, not a muted one.
  const ink = await resolveToken(page, "--color-text-primary");
  expect(narrative?.color).toBe(ink);
});

test("marks the narrative with a neutral rule visible in both themes", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/library?source=demo");

  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => {
      localStorage.setItem("resume-changer.theme.v1", value);
    }, theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await waitForSettledTheme(page);

    const narrative = await readNarrative(page);
    expect(narrative?.borderLeftWidth).toBe("2px");

    const surface = await readSurface(page, ".library-point");
    expect(surface).not.toBe("");
    expect(
      contrastRatio(narrative?.borderLeftColor ?? "", surface),
      `narrative rule against the card in ${theme} mode`,
    ).toBeGreaterThanOrEqual(3);

    // The rule must not read as a success or a failure state.
    const success = await resolveToken(page, "--color-success-strong");
    const failure = await resolveToken(page, "--color-error-strong");
    expect(narrative?.borderLeftColor).not.toBe(success);
    expect(narrative?.borderLeftColor).not.toBe(failure);
  }
});

test("keeps multiline and punctuated text intact", async ({ page }) => {
  const text =
    "Rebuilt the release pipeline — replacing the legacy runner — so that every merge ships an auditable artifact, and kept the rollback path documented for on-call engineers.";
  await writePersonalLibrary({ point: { text } });
  await page.setViewportSize({ width: 520, height: 900 });
  await page.goto("/library");

  const narrative = await readNarrative(page);
  expect(narrative?.text).toBe(text);
  expect(narrative?.overflow).not.toBe("hidden");
  expect(narrative?.webkitLineClamp).toBe("none");

  const lineHeight = Number.parseFloat(narrative?.lineHeight ?? "0");
  const lines = Math.round((narrative?.scrollHeight ?? 0) / lineHeight);
  expect(lines).toBeGreaterThanOrEqual(2);

  // The source line follows the point's own source, not the demo's.
  await expect(page.locator(".point-provenance").first()).toHaveText(
    "Source: user-notes · Fixture entry",
  );
});

test("wraps unusually long tokens instead of clipping them", async ({
  page,
}) => {
  await page.goto("/library?source=demo");

  const measurement = await page.evaluate(() => {
    const element = document.querySelector(".library-point-text");
    if (!element) return null;
    const original = element.textContent ?? "";
    element.textContent = `${original} https://example.com/achievements/verylongresourceidentifier`;
    const result = {
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      text: element.textContent ?? "",
    };
    element.textContent = original;
    return result;
  });

  expect(measurement).not.toBeNull();
  expect(measurement?.scrollWidth).toBeLessThanOrEqual(
    (measurement?.clientWidth ?? 0) + 1,
  );
  expect(measurement?.text).toContain("verylongresourceidentifier");
});

test("shows the source each achievement came from", async ({ page }) => {
  await page.goto("/library?source=demo");

  const sources = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".point-provenance")).map(
      (element) => element.textContent ?? "",
    ),
  );
  expect(sources.length).toBe(13);
  expect(sources.some((source) => source.includes("project-document"))).toBe(
    true,
  );
  expect(sources.some((source) => source.includes("user-notes"))).toBe(true);
});

test("keeps demo copy out of the personal library", async ({ page }) => {
  await writePersonalLibrary({
    fullName: "Sam Rivera",
    headline: "Platform Engineer",
    empty: true,
  });
  await page.goto("/library");

  const summary = page.getByRole("region", { name: "Library summary" });
  await expect(summary).toContainText("My resume data");
  await expect(summary).not.toContainText("Fictional demo data");
  await expect(summary.getByRole("heading")).toHaveText("Sam Rivera");

  await expect(page.getByText("Jordan Example")).toHaveCount(0);
  await expect(page.getByText("Synthetic demo scenario")).toHaveCount(0);

  const empty = page.getByRole("status");
  await expect(empty).toHaveText("No achievement points match these filters.");
  await expect(empty).not.toContainText("demo");
  await expect(empty).not.toContainText("Jordan Example");
});

test("keeps the narrative readable at narrow widths", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/library?source=demo");

  const layout = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);

  const narrative = await readNarrative(page);
  expect(narrative?.scrollWidth).toBeLessThanOrEqual(
    (narrative?.clientWidth ?? 0) + 1,
  );
  await expect(
    page.getByText(
      "Redesigned service boundaries and capacity planning for a multi-tenant processing platform.",
    ),
  ).toBeVisible();
});

test("shows the label, value, unit, evidence and context of a metric", async ({
  page,
}) => {
  await page.goto("/library?source=demo");

  const metric = page.locator(".point-metric").first();
  await expect(metric).toHaveAttribute(
    "data-metric-id",
    "metric-demo-throughput-gain",
  );
  await expect(metric.locator(".point-metric-label")).toHaveText(
    "Throughput improvement",
  );
  await expect(metric.locator(".point-metric-number")).toHaveText("28");
  await expect(metric.locator(".point-metric-unit")).toHaveText("%");
  // The number and its unit read as one figure.
  await expect(metric.locator(".point-metric-value")).toHaveText("28%");
  await expect(metric.locator(".point-metric-evidence")).toHaveText(
    "The fictional demo benchmark records 28% higher throughput after the service-boundary redesign.",
  );
  await expect(metric.locator(".point-metric-context")).toContainText(
    "Synthetic benchmark scenario",
  );
});

test("keeps the evidence in the card without a hover", async ({ page }) => {
  await page.goto("/library?source=demo");

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

test("does not present a metric value as a positive score", async ({ page }) => {
  await page.goto("/library?source=demo");

  const value = page.locator(".point-metric-value").first();
  const color = await value.evaluate((node) => getComputedStyle(node).color);
  const success = await resolveToken(page, "--color-success-strong");
  const successSoft = await resolveToken(page, "--color-success");

  expect(color).not.toBe(success);
  expect(color).not.toBe(successSoft);

  // No trend arrow is added to a figure that only states a number.
  expect(await value.locator("svg").count()).toBe(0);

  const iconColor = await page
    .locator(".point-metric-icon")
    .first()
    .evaluate((node) => getComputedStyle(node).color);
  expect(iconColor).not.toBe(success);
});

test("puts two metrics in two columns and stacks them on a phone", async ({
  page,
}) => {
  await writePersonalLibrary({
    point: {
      text: "Two measured outcomes.",
      metrics: [
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
      ],
    },
  });

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
      columns: getComputedStyle(grid).gridTemplateColumns.split(" ")
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
      columns: getComputedStyle(grid).gridTemplateColumns.split(" ")
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

test("omits a unit and a context the metric does not have", async ({ page }) => {
  await writePersonalLibrary({
    point: {
      text: "A plain outcome.",
      metrics: [
        {
          id: "metric-fixture-plain",
          label: "Servers migrated",
          value: "12",
          evidence: "Recorded during the migration window.",
        },
      ],
    },
  });
  await page.goto("/library");

  const metric = page.locator(".library-point").first().locator(".point-metric");
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
  await writePersonalLibrary({
    point: {
      text: "Two measured outcomes.",
      metrics: [
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
      ],
    },
  });
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
  await writePersonalLibrary({
    point: {
      text: "A measured outcome.",
      metrics: [
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
      ],
    },
  });
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
  await expect(
    page.locator(".point-metric-number").first(),
  ).toHaveText("1234567890123456789");
});
