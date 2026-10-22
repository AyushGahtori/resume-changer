import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createPersonalLibraryGuard,
  exampleLibraryPath,
  libraryRoot,
  personalLibraryPath,
} from "./support/personal-library";

type LibraryFixture = {
  fullName?: string;
  headline?: string | null;
  /** Replaces the text of the first achievement, keeping its identifier. */
  point?: { text: string; sourceType?: string; sourceLabel?: string };
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
  await expect(group.getByText("Jan 2023 – Present")).toBeVisible();

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

  const empty = page.getByText("No achievement points match these filters.", {
    exact: true,
  });
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
