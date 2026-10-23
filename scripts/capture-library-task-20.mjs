/**
 * Capture the Task 20 group headers for visual review.
 *
 * The script serves a production build from an isolated data root, so the
 * capture never reads real user data. The fictional sample library is
 * copied into that root, which is the only way the personal route is
 * reachable.
 *
 * Usage:
 *   node scripts/capture-library-task-20.mjs
 *
 * Environment:
 *   CAPTURE_PORT    port for the temporary server (default 3045)
 *   CAPTURE_OUTPUT  output folder (default docs/ui-review/library-task-20)
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const projectRoot = process.cwd();
const port = Number(process.env.CAPTURE_PORT ?? 3045);
const distDir = process.env.NEXT_DIST_DIR ?? ".next-test";
const tsconfig = process.env.NEXT_TSCONFIG ?? "tsconfig.e2e.json";
const outputDir = resolve(
  process.env.CAPTURE_OUTPUT ??
    join(projectRoot, "docs", "ui-review", "library-task-20"),
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
        const page = await openLibrary(context, theme, "/library?source=demo");
        await page.screenshot({
          path: join(outputDir, `${theme}-${viewport.name}.png`),
          animations: "disabled",
        });
        /*
         * The group headers sit below the filters, so the narrow captures
         * also show them in place.
         */
        await page
          .locator(".experience-group")
          .first()
          .scrollIntoViewIfNeeded();
        await page.screenshot({
          path: join(outputDir, `${theme}-${viewport.name}-groups.png`),
          animations: "disabled",
        });
        await context.close();
      }
    }

    /*
     * The header on its own, in the expanded and the collapsed state, and
     * with the keyboard focus on the disclosure.
     */
    for (const theme of themes) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
        colorScheme: theme,
      });
      const page = await openLibrary(context, theme, "/library?source=demo");

      await page
        .locator(".experience-group")
        .first()
        .screenshot({
          path: join(outputDir, `${theme}-header-expanded.png`),
          animations: "disabled",
        });

      await page.getByRole("button", { name: /Platform Engineer/ }).click();
      await page
        .locator(".experience-group")
        .first()
        .screenshot({
          path: join(outputDir, `${theme}-header-collapsed.png`),
          animations: "disabled",
        });

      await page.getByRole("button", { name: /Platform Engineer/ }).click();
      /*
       * A key press puts the browser in keyboard mode, so the focus that
       * follows is a visible focus and the outline shows in the capture.
       */
      await page.keyboard.press("Shift");
      await page.getByRole("button", { name: /Platform Engineer/ }).focus();
      await page
        .locator(".experience-group")
        .first()
        .screenshot({
          path: join(outputDir, `${theme}-header-focus.png`),
          animations: "disabled",
        });
      await context.close();
    }

    /* The narrow stack rule, with the first group collapsed. */
    for (const theme of themes) {
      const context = await browser.newContext({
        viewport: { width: 320, height: 740 },
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
        colorScheme: theme,
      });
      const page = await openLibrary(context, theme, "/library?source=demo");
      await page.getByRole("button", { name: /Platform Engineer/ }).click();
      await page.screenshot({
        path: join(outputDir, `${theme}-320-collapsed.png`),
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
