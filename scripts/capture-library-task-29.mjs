/**
 * Capture the achievement library for the final visual acceptance.
 *
 * The script serves a production build from an isolated data root, so the
 * capture never reads real user data. The fictional sample library is
 * copied into that root, which is the only way the personal route is
 * reachable.
 *
 * Usage:
 *   node scripts/capture-library-task-29.mjs
 *
 * Environment:
 *   CAPTURE_PORT    port for the temporary server (default 3049)
 *   CAPTURE_OUTPUT  output folder (default docs/ui-review/library-task-29)
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const projectRoot = process.cwd();
const port = Number(process.env.CAPTURE_PORT ?? 3049);
const distDir = process.env.NEXT_DIST_DIR ?? ".next-test";
const tsconfig = process.env.NEXT_TSCONFIG ?? "tsconfig.e2e.json";
const outputDir = resolve(
  process.env.CAPTURE_OUTPUT ??
    join(projectRoot, "docs", "ui-review", "library-task-29"),
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
        const page = await openLibrary(context, theme, "/library?source=demo");
        await page.screenshot({
          path: join(outputDir, `${theme}-${viewport.name}.png`),
          animations: "disabled",
        });
        await context.close();
      }
    }

    /*
     * The parts of the page that sit below the fold, captured on their own
     * so the review can look at them at a readable scale.
     */
    for (const theme of themes) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
        colorScheme: theme,
      });
      const page = await openLibrary(context, theme, "/library?source=demo");

      await page.locator(".library-overview").screenshot({
        path: join(outputDir, `${theme}-summary.png`),
        animations: "disabled",
      });
      await page.locator(".library-controls").screenshot({
        path: join(outputDir, `${theme}-controls.png`),
        animations: "disabled",
      });
      await page
        .locator(".experience-group")
        .first()
        .screenshot({
          path: join(outputDir, `${theme}-group.png`),
          animations: "disabled",
        });
      await page
        .locator(".library-point")
        .filter({ hasText: "achievement-service-capacity-design" })
        .screenshot({
          path: join(outputDir, `${theme}-card.png`),
          animations: "disabled",
        });

      /*
       * The skills and the credentials sit behind a disclosure, so the
       * capture opens them first.
       */
      await page
        .getByRole("region", { name: "Skills and credentials" })
        .locator("summary")
        .first()
        .click();
      await page
        .getByRole("region", { name: "Skills and credentials" })
        .screenshot({
          path: join(outputDir, `${theme}-secondary.png`),
          animations: "disabled",
        });

      await context.close();
    }

    /* The empty result, which is a state of its own. */
    for (const theme of themes) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
        colorScheme: theme,
      });
      const page = await openLibrary(context, theme, "/library?source=demo");
      await page
        .getByRole("searchbox", { name: "Search library" })
        .fill("no matching library content");
      await page.waitForSelector(".library-empty");
      await page.screenshot({
        path: join(outputDir, `${theme}-empty.png`),
        animations: "disabled",
      });
      await context.close();
    }

    /*
     * The failure state. The personal library file is broken on purpose, so
     * the route has to report it and offer the demo library instead. The
     * file is put back before the script leaves.
     */
    for (const theme of themes) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
        colorScheme: theme,
      });
      await writeFile(
        join(dataRoot, "data", "resume-library.json"),
        "{ this is not valid json",
        "utf8",
      );
      const page = await openLibrary(context, theme, "/library");
      await page.waitForSelector(".library-error");
      await page.screenshot({
        path: join(outputDir, `${theme}-error.png`),
        animations: "disabled",
      });
      await context.close();
    }
    await copyFile(
      join(projectRoot, "examples", "sample-resume-library.json"),
      join(dataRoot, "data", "resume-library.json"),
    );
  } finally {
    await browser.close();
    server.kill();
    await rm(dataRoot, { recursive: true, force: true });
  }

  console.log(`Screenshots: ${outputDir}`);
}

await main();
