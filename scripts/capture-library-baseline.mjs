/**
 * Capture the Task 01 Achievement Library baseline.
 *
 * The script serves a production build from an isolated data root, so the
 * capture never reads real user data. The personal library is left empty on
 * purpose: that is the state the loader error describes. Every content
 * screenshot therefore uses the fictional demo library.
 *
 * Usage:
 *   node scripts/capture-library-baseline.mjs
 *
 * Environment:
 *   BASELINE_PORT    port for the temporary server (default 3021)
 *   BASELINE_OUTPUT  output folder (default docs/ui-baseline/library-task-01)
 */
import { spawn } from "node:child_process";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const projectRoot = process.cwd();
const port = Number(process.env.BASELINE_PORT ?? 3021);
const distDir = process.env.NEXT_DIST_DIR ?? ".next-test";
const tsconfig = process.env.NEXT_TSCONFIG ?? "tsconfig.e2e.json";
const outputDir = resolve(
  process.env.BASELINE_OUTPUT ??
    join(projectRoot, "docs", "ui-baseline", "library-task-01"),
);
const screenshotDir = join(outputDir, "screenshots");
const dataRoot = join(tmpdir(), "resume-changer-library-baseline-data");
const baseUrl = `http://127.0.0.1:${port}`;

const viewports = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "390x844", width: 390, height: 844 },
  { name: "320x740", width: 320, height: 740 },
];

const themes = ["light", "dark"];

/** Zoom-equivalent widths used only for overflow and wrapping checks. */
const zoomChecks = [
  { name: "1152x720", width: 1152, height: 720, zoom: "125%" },
  { name: "1800x1125", width: 1800, height: 1125, zoom: "80%" },
];

const tokenNames = [
  "--color-canvas",
  "--color-sidebar",
  "--color-surface",
  "--color-surface-alt",
  "--color-text-primary",
  "--color-text-secondary",
  "--color-text-muted",
  "--color-border",
  "--color-border-strong",
  "--color-orange",
  "--color-orange-subtle",
  "--color-violet",
  "--color-violet-subtle",
  "--color-success",
  "--color-warning",
  "--color-error",
  "--color-info",
  "--color-focus-ring",
];

async function startServer() {
  const nextCli = join(
    projectRoot,
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );
  const server = spawn(
    process.execPath,
    [nextCli, "start", "--port", String(port)],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        RESUME_LIBRARY_ROOT: dataRoot,
        NEXT_DIST_DIR: distDir,
        NEXT_TSCONFIG: tsconfig,
        NEXT_TELEMETRY_DISABLED: "1",
        AI_PROVIDER: "mock",
        GEMINI_API_KEY: "baseline-placeholder-key-not-a-real-credential",
      },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  return server;
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/library?source=demo`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`The baseline server did not answer on ${baseUrl}.`);
}

async function measure(page) {
  return page.evaluate((tokenList) => {
    const round = (value) => Math.round(value * 100) / 100;
    const box = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        x: round(rect.x),
        y: round(rect.y),
        width: round(rect.width),
        height: round(rect.height),
        bottom: round(rect.bottom),
      };
    };
    const pick = (selector) => document.querySelector(selector);
    const styleOf = (selector, properties) => {
      const element = pick(selector);
      if (!element) return null;
      const computed = getComputedStyle(element);
      const result = {};
      for (const property of properties) {
        result[property] = computed.getPropertyValue(property);
      }
      return result;
    };
    const overflowing = Array.from(document.querySelectorAll("body *"))
      .filter(
        (element) =>
          element.scrollWidth > element.clientWidth + 1 &&
          getComputedStyle(element).overflowX === "visible",
      )
      .slice(0, 12)
      .map((element) => ({
        element: `${element.tagName.toLowerCase()}.${String(element.className)}`
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 90),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }));

    const tokens = {};
    const rootStyle = getComputedStyle(document.documentElement);
    for (const token of tokenList)
      tokens[token] = rootStyle.getPropertyValue(token).trim();

    return {
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollHeight: document.documentElement.scrollHeight,
        horizontalOverflow:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      },
      tokens,
      geometry: {
        sidebar: box(pick(".sidebar")),
        topbar: box(pick(".topbar")),
        pageContent: box(pick(".page-content")),
        libraryPage: box(pick(".library-page")),
        libraryHeading: box(pick(".library-heading")),
        sourceSwitch: box(pick(".library-source-switch")),
        editToolbar: box(pick(".library-edit-toolbar")),
        overview: box(pick(".library-overview")),
        owner: box(pick(".library-owner")),
        counts: box(pick(".library-counts")),
        controls: box(pick(".library-controls")),
        search: box(pick(".library-search")),
        filterGrid: box(pick(".library-filter-grid")),
        filterSummary: box(pick(".library-filter-summary")),
        experiences: box(pick(".library-experiences")),
        firstGroup: box(pick(".experience-group")),
        firstPoint: box(pick(".library-point")),
        secondary: box(pick(".library-secondary")),
        error: box(pick(".library-error")),
      },
      typography: {
        pageTitle: styleOf(".library-heading h1", [
          "font-family",
          "font-size",
          "line-height",
          "font-weight",
          "color",
        ]),
        eyebrow: styleOf(".library-heading .eyebrow", [
          "font-family",
          "font-size",
          "line-height",
          "font-weight",
          "color",
        ]),
        intro: styleOf(".library-heading .page-intro", [
          "font-size",
          "line-height",
          "color",
        ]),
        profileName: styleOf(".library-owner h2", [
          "font-family",
          "font-size",
          "line-height",
          "font-weight",
        ]),
        metricLabel: styleOf(".library-counts dt", [
          "font-size",
          "line-height",
          "color",
        ]),
        metricValue: styleOf(".library-counts dd", [
          "font-size",
          "line-height",
          "font-weight",
        ]),
        groupTitle: styleOf(".experience-heading h3", [
          "font-family",
          "font-size",
          "line-height",
          "font-weight",
        ]),
        pointText: styleOf(".library-point-text", [
          "font-size",
          "line-height",
          "color",
        ]),
        pointId: styleOf(".library-point-heading code", [
          "font-size",
          "line-height",
        ]),
        provenance: styleOf(".point-provenance", [
          "font-size",
          "line-height",
          "color",
        ]),
        metricStrong: styleOf(".point-metrics strong", [
          "font-size",
          "line-height",
        ]),
        chip: styleOf(".facet-chip", [
          "font-size",
          "line-height",
          "border-radius",
          "padding",
        ]),
        status: styleOf(".point-status", [
          "font-size",
          "line-height",
          "border-radius",
        ]),
        searchInput: styleOf(".library-search input", [
          "height",
          "border-radius",
          "border",
          "padding",
          "font-size",
        ]),
        facetSelect: styleOf(".library-filter-grid select", [
          "height",
          "border-radius",
          "border",
          "font-size",
        ]),
      },
      structure: {
        pageChildren: Array.from(
          document.querySelectorAll(".library-page > *"),
        ).map((element) => String(element.className).split(" ")[0]),
        headings: Array.from(document.querySelectorAll("h1, h2, h3")).map(
          (element) => ({
            level: element.tagName.toLowerCase(),
            text: (element.textContent ?? "").trim().slice(0, 80),
          }),
        ),
        landmarks: Array.from(
          document.querySelectorAll(
            "main, aside, header, nav, section, article",
          ),
        ).map((element) => ({
          tag: element.tagName.toLowerCase(),
          className: String(element.className).split(" ")[0],
          label:
            element.getAttribute("aria-label") ??
            element.getAttribute("aria-labelledby") ??
            null,
        })),
      },
      counts: {
        experienceGroups: document.querySelectorAll(".experience-group").length,
        jobGroups: document.querySelectorAll(
          ".experience-group[aria-label^='Job:']",
        ).length,
        projectGroups: document.querySelectorAll(
          ".experience-group[aria-label^='Project:']",
        ).length,
        points: document.querySelectorAll(".library-point").length,
        provenanceRows: document.querySelectorAll(".point-provenance").length,
        metricItems: document.querySelectorAll(".point-metrics li").length,
        facetChips: document.querySelectorAll(".facet-chip").length,
        tagChips: document.querySelectorAll(".facet-chip:not(.is-skill)")
          .length,
        skillChips: document.querySelectorAll(".facet-chip.is-skill").length,
        enabledPills: document.querySelectorAll(".point-status.is-enabled")
          .length,
        disabledPills: document.querySelectorAll(".point-status.is-disabled")
          .length,
        skillRows: document.querySelectorAll(".skill-list li").length,
        credentialRows: document.querySelectorAll(".credential-list li").length,
        filterSelects: document.querySelectorAll(".library-filter-grid select")
          .length,
      },
      overflowing,
    };
  }, tokenNames);
}

async function capture(page, path, options = {}) {
  await page.screenshot({ path, animations: "disabled", ...options });
}

async function openLibrary(context, theme, path) {
  const page = await context.newPage();
  await page.addInitScript((selected) => {
    try {
      window.localStorage.setItem("resume-changer.theme.v1", selected);
    } catch {
      // The page still renders in the default theme.
    }
  }, theme);
  await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".library-page, .library-error");
  await page
    .waitForFunction(
      (selected) => document.documentElement.dataset.theme === selected,
      theme,
    )
    .catch(() => undefined);
  return page;
}

async function main() {
  await rm(dataRoot, { recursive: true, force: true });
  await mkdir(dataRoot, { recursive: true });
  await mkdir(screenshotDir, { recursive: true });

  const server = await startServer();
  const browser = await chromium.launch();
  const measurements = [];

  try {
    await waitForServer();

    for (const viewport of viewports) {
      for (const theme of themes) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: 1,
          reducedMotion: "reduce",
          colorScheme: theme,
        });
        const page = await openLibrary(context, theme, "/library?source=demo");
        await capture(
          page,
          join(screenshotDir, `library-${viewport.name}-${theme}.png`),
        );
        measurements.push({
          viewport,
          theme,
          surface: "demo",
          ...(await measure(page)),
        });
        if (viewport.name === "1440x900") {
          await capture(
            page,
            join(screenshotDir, `library-${viewport.name}-${theme}-full.png`),
            { fullPage: true },
          );
        }
        await context.close();
      }
    }

    // The personal library is empty in this isolated data root, so the route
    // shows the loader error and the alternate-source link.
    for (const theme of themes) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
        colorScheme: theme,
      });
      const page = await openLibrary(context, theme, "/library");
      await capture(
        page,
        join(screenshotDir, `library-error-1440x900-${theme}.png`),
      );
      measurements.push({
        viewport: { name: "1440x900", width: 1440, height: 900 },
        theme,
        surface: "personal-error",
        ...(await measure(page)),
      });
      await context.close();
    }

    // The personal route is captured with the fictional fixture copied into
    // the isolated data root, so the editable surface and the point editor
    // are recorded without touching real user data.
    await mkdir(join(dataRoot, "data"), { recursive: true });
    await copyFile(
      join(projectRoot, "examples", "sample-resume-library.json"),
      join(dataRoot, "data", "resume-library.json"),
    );
    for (const theme of themes) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
        colorScheme: theme,
      });
      const page = await openLibrary(context, theme, "/library");
      await capture(
        page,
        join(screenshotDir, `library-personal-1440x900-${theme}.png`),
      );
      measurements.push({
        viewport: { name: "1440x900", width: 1440, height: 900 },
        theme,
        surface: "personal",
        ...(await measure(page)),
      });

      await page.getByRole("button", { name: "Detailed entry" }).click();
      await page.waitForSelector(".point-editor");
      await capture(
        page,
        join(screenshotDir, `library-editor-1440x900-${theme}.png`),
      );
      await context.close();
    }

    for (const zoom of zoomChecks) {
      const context = await browser.newContext({
        viewport: { width: zoom.width, height: zoom.height },
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
      });
      const page = await openLibrary(context, "light", "/library?source=demo");
      measurements.push({
        viewport: { name: zoom.name, width: zoom.width, height: zoom.height },
        theme: "light",
        surface: "demo",
        zoom: zoom.zoom,
        ...(await measure(page)),
      });
      await context.close();
    }
  } finally {
    await browser.close();
    server.kill();
    await rm(dataRoot, { recursive: true, force: true });
  }

  await writeFile(
    join(outputDir, "measurements.json"),
    `${JSON.stringify({ measurements }, null, 2)}\n`,
    "utf8",
  );
  console.log(`Captured ${measurements.length} measurements.`);
  console.log(`Screenshots: ${screenshotDir}`);
}

await main();
