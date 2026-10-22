/**
 * Capture the Task 10 creation actions for visual review.
 *
 * The script serves a production build from an isolated data root, so the
 * capture never reads real user data. The fictional sample library is
 * copied into that root, which is the only way the personal route and its
 * two creation actions are reachable.
 *
 * Usage:
 *   node scripts/capture-library-task-10.mjs
 *
 * Environment:
 *   CAPTURE_PORT    port for the temporary server (default 3031)
 *   CAPTURE_OUTPUT  output folder (default docs/ui-review/library-task-10)
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const projectRoot = process.cwd();
const port = Number(process.env.CAPTURE_PORT ?? 3031);
const distDir = process.env.NEXT_DIST_DIR ?? ".next-test";
const tsconfig = process.env.NEXT_TSCONFIG ?? "tsconfig.e2e.json";
const outputDir = resolve(
  process.env.CAPTURE_OUTPUT ??
    join(projectRoot, "docs", "ui-review", "library-task-10"),
);
/*
 * The data root follows the same naming rule the browser suite uses, so a
 * capture never reads or writes a real workspace library.
 */
const dataRoot = join(tmpdir(), `resume-changer-playwright-data-${port}`);
const baseUrl = `http://127.0.0.1:${port}`;

const viewports = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
  { name: "320", width: 320, height: 740 },
];

const themes = ["light", "dark"];

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
      const response = await fetch(`${baseUrl}/library`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`The capture server did not answer on ${baseUrl}.`);
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
        const page = await openLibrary(context, theme, "/library");
        await page.screenshot({
          path: join(outputDir, `${theme}-${viewport.name}.png`),
          animations: "disabled",
        });
        await context.close();
      }
    }

    // The manual editor open over the header, in both themes.
    for (const theme of themes) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
        colorScheme: theme,
      });
      const page = await openLibrary(context, theme, "/library");
      await page.getByRole("button", { name: "Detailed entry" }).click();
      await page.waitForSelector(".point-editor");
      await page.screenshot({
        path: join(outputDir, `${theme}-editor-1440.png`),
        animations: "disabled",
      });
      await context.close();
    }

    /*
     * The action row on its own, in the states the reference board shows:
     * default, hover and disabled.
     *
     * The disabled capture disables the primary control in the DOM. The
     * real path that disables it is the open Imagination Canvas, which
     * covers the toolbar with its modal backdrop; the browser suite covers
     * that real path, and the rendering here is the same one the `:disabled`
     * rule produces.
     */
    for (const theme of themes) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
        colorScheme: theme,
      });
      const page = await openLibrary(context, theme, "/library");
      const actions = page.locator(".library-edit-actions");

      await actions.screenshot({
        path: join(outputDir, `${theme}-action-default.png`),
        animations: "disabled",
      });

      await page.getByRole("button", { name: "Add achievement" }).hover();
      await actions.screenshot({
        path: join(outputDir, `${theme}-action-hover.png`),
        animations: "disabled",
      });

      await page.evaluate(() => {
        const button = document.querySelector(".library-action--primary");
        if (button instanceof HTMLButtonElement) button.disabled = true;
      });
      await actions.screenshot({
        path: join(outputDir, `${theme}-action-disabled.png`),
        animations: "disabled",
      });
      await context.close();
    }

    /*
     * The secondary action is disabled for real while the manual editor is
     * open. The editor is rendered inline, so the action row stays visible
     * next to it.
     */
    for (const theme of themes) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
        colorScheme: theme,
      });
      const page = await openLibrary(context, theme, "/library");
      await page.getByRole("button", { name: "Detailed entry" }).click();
      await page.waitForSelector(".point-editor");
      await page.locator(".library-edit-actions").screenshot({
        path: join(outputDir, `${theme}-action-secondary-disabled.png`),
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
