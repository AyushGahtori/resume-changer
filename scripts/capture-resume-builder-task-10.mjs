/**
 * Capture the resume builder for the source-choice visual acceptance.
 *
 * The script serves a production build from an isolated data root, so the
 * capture never reads real user data. The fictional sample library is copied
 * into that root, which is the only way the personal route is reachable.
 *
 * Usage:
 *   node scripts/capture-resume-builder-task-10.mjs
 *
 * Environment:
 *   CAPTURE_PORT    port for the temporary server (default 3052)
 *   CAPTURE_OUTPUT  output folder (default docs/ui-review/resume-builder-task-10)
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const projectRoot = process.cwd();
const port = Number(process.env.CAPTURE_PORT ?? 3052);
const distDir = process.env.NEXT_DIST_DIR ?? ".next-test";
const tsconfig = process.env.NEXT_TSCONFIG ?? "tsconfig.e2e.json";
const outputDir = resolve(
  process.env.CAPTURE_OUTPUT ??
    join(projectRoot, "docs", "ui-review", "resume-builder-task-10"),
);
/*
 * The data root follows the same naming rule the browser suite uses, so a
 * capture never reads or writes a real workspace library.
 */
const dataRoot = join(tmpdir(), `resume-changer-playwright-data-${port}`);
const baseUrl = `http://127.0.0.1:${port}`;

const viewports = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "390x844", width: 390, height: 844 },
  { name: "320x740", width: 320, height: 740 },
];

const themes = ["light", "dark"];

/*
 * A synthetic job description, so the job context card shows a real row
 * without loading anybody's saved draft.
 */
const syntheticDraft = {
  schemaVersion: 1,
  jobDescription:
    "Build reliable AWS platform services. Standardize deployment checks across teams. Design capacity planning for multi-tenant workloads.",
  company: "Example Cloud",
  roleTitle: "Platform Engineer",
  jobUrl: "",
};

async function startServer() {
  const nextCli = join(
    projectRoot,
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );
  /*
   * The capture runs against a production build of the current source, the
   * same way the browser suite does, so the screenshots show what a reader
   * would actually be served.
   */
  const build = spawnSync(process.execPath, [nextCli, "build"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NEXT_DIST_DIR: distDir,
      NEXT_TSCONFIG: tsconfig,
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });
  if (build.status !== 0) {
    throw new Error(`The capture build failed with status ${build.status}.`);
  }
  return spawn(process.execPath, [nextCli, "start", "--port", String(port)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      RESUME_LIBRARY_ROOT: dataRoot,
      NEXT_DIST_DIR: distDir,
      NEXT_TSCONFIG: tsconfig,
      NEXT_TELEMETRY_DISABLED: "1",
      AI_PROVIDER: "mock",
      GEMINI_API_KEY: "capture-placeholder-key-not-a-real-credential",
    },
    stdio: "inherit",
    windowsHide: true,
  });
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/generate?source=demo`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`The capture server did not answer on ${baseUrl}.`);
}

async function openBuilder(context, theme, path) {
  const page = await context.newPage();
  await page.addInitScript(
    ({ selected, draft }) => {
      try {
        window.localStorage.setItem("resume-changer.theme.v1", selected);
        window.localStorage.setItem(
          "resume-changer.jd-draft.v1",
          JSON.stringify(draft),
        );
      } catch {
        // The page still renders in the default theme and the empty state.
      }
    },
    { selected: theme, draft: syntheticDraft },
  );
  await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".generation-page, .generation-error");
  /*
   * The shell reads the stored theme after it mounts, so the capture waits
   * for the attribute before it takes a picture.
   */
  await page.waitForSelector(`html[data-theme="${theme}"]`);
  return page;
}

async function main() {
  await rm(dataRoot, { recursive: true, force: true });
  await mkdir(join(dataRoot, "data"), { recursive: true });
  await copyFile(
    join(projectRoot, "examples", "sample-resume-library.json"),
    join(dataRoot, "data", "resume-library.json"),
  );
  await mkdir(outputDir, { recursive: true });

  const server = await startServer();
  const browser = await chromium.launch();

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
        const page = await openBuilder(context, theme, "/generate?source=demo");
        await page.screenshot({
          path: join(outputDir, `${theme}-${viewport.name}.png`),
          animations: "disabled",
        });
        await context.close();
      }
    }

    /*
     * The job context card on its own, with the source choice inside it, in
     * both source states, so the selected segment can be compared directly.
     */
    for (const theme of themes) {
      for (const route of [
        { name: "personal", path: "/generate" },
        { name: "demo", path: "/generate?source=demo" },
      ]) {
        const context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
          deviceScaleFactor: 1,
          reducedMotion: "reduce",
          colorScheme: theme,
        });
        const page = await openBuilder(context, theme, route.path);
        await page.locator(".generation-draft").screenshot({
          path: join(outputDir, `${theme}-job-context-${route.name}.png`),
          animations: "disabled",
        });
        await context.close();
      }
    }

    /* The source choice on its own, at the narrowest supported width. */
    for (const theme of themes) {
      const context = await browser.newContext({
        viewport: { width: 320, height: 740 },
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
        colorScheme: theme,
      });
      const page = await openBuilder(context, theme, "/generate?source=demo");
      await page.locator(".generation-draft").screenshot({
        path: join(outputDir, `${theme}-job-context-320.png`),
        animations: "disabled",
      });
      await context.close();
    }
  } finally {
    await browser.close();
    server.kill();
    await rm(dataRoot, { recursive: true, force: true });
  }

  console.log(`Screenshots: ${outputDir}`);
}

await main();
