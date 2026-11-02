import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { expect, test } from "@playwright/test";

let fixtureServer: ViteDevServer;
let fixtureUrl: string;

test.beforeAll(async () => {
  fixtureServer = await createServer({
    configFile: false,
    root: process.cwd(),
    appType: "spa",
    logLevel: "error",
    esbuild: { jsx: "automatic", jsxImportSource: "react" },
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
      hmr: false,
    },
  });
  await fixtureServer.listen();

  const address = fixtureServer.httpServer?.address();
  if (!address || typeof address === "string") {
    throw new Error("The Task 21 component fixture server did not start.");
  }

  fixtureUrl =
    "http://127.0.0.1:" +
    address.port +
    "/tests/e2e/support/github-task-21/index.html";
});

test.afterAll(async () => {
  await fixtureServer?.close();
});

test("renders the primitives through the registered Gate 0 harness", async ({
  page,
}) => {
  await page.goto("/e2e/github-import");

  await expect(page.getByTestId("github-import-harness-root")).toBeVisible();
  const selector = page.getByRole("combobox", {
    name: "Choose GitHub import fixture",
  });
  await selector.selectOption("primitives-ready");

  await expect(
    page.getByTestId("github-import-harness-case-content"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect GitHub" }),
  ).toBeVisible();
  await expect(page.getByText("ready-to-review")).toBeVisible();
  await expect(page.getByText("Review before sharing")).toBeVisible();
  await expect(page.getByText("summary.ts")).toBeVisible();
});

test("supports keyboard activation, focus, pending, disabled, and error states", async ({
  page,
}) => {
  await page.goto(fixtureUrl);

  const saveButton = page.getByRole("button", {
    name: "Save selected achievements",
  });
  const saveCount = page.getByTestId("save-count");

  await saveButton.focus();
  await expect(saveButton).toBeFocused();
  await expect(saveButton).toHaveCSS("outline-width", "2px");
  await page.keyboard.press("Enter");
  await expect(saveCount).toHaveText("Saved activation count: 1");

  const pendingButton = page.getByRole("button", {
    name: "Analyze repository",
  });
  await expect(pendingButton).toBeDisabled();
  await expect(pendingButton).toHaveAttribute("aria-busy", "true");
  await expect(pendingButton).toContainText("Analyze repository");

  const disabledButton = page.getByRole("button", {
    name: "Continue without PRs",
  });
  await expect(disabledButton).toBeDisabled();

  await pendingButton.click({ force: true });
  await disabledButton.click({ force: true });
  await expect(saveCount).toHaveText("Saved activation count: 1");

  const transitionButton = page.getByRole("button", {
    name: "Refresh repository snapshot",
  });
  const idleDimensions = await transitionButton.boundingBox();
  await transitionButton.click();
  await expect(transitionButton).toBeDisabled();
  await expect(transitionButton).toHaveAttribute("aria-busy", "true");
  const pendingDimensions = await transitionButton.boundingBox();
  expect(pendingDimensions?.width).toBe(idleDimensions?.width);
  expect(pendingDimensions?.height).toBe(idleDimensions?.height);
  await transitionButton.click({ force: true });
  await expect(saveCount).toHaveText("Saved activation count: 1");

  const errorButton = page.getByRole("button", { name: "Retry analysis" });
  await expect(errorButton).toHaveAttribute("aria-describedby");
  const descriptionId = await errorButton.getAttribute("aria-describedby");
  await expect(page.locator('[id="' + descriptionId + '"]')).toHaveText(
    "This action needs attention.",
  );
  await expect(errorButton).toHaveAttribute("data-state", "error");
});

test("keeps control geometry and readable status contrast in both themes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(fixtureUrl);

  const saveButton = page.getByRole("button", {
    name: "Save selected achievements",
  });
  const before = await saveButton.boundingBox();
  await saveButton.focus();
  const focused = await saveButton.boundingBox();
  expect(focused?.width).toBe(before?.width);
  expect(focused?.height).toBe(before?.height);
  expect(focused?.height).toBeGreaterThanOrEqual(44);

  const focusWidth = await saveButton.evaluate(
    (element) => getComputedStyle(element).outlineWidth,
  );
  expect(focusWidth).toBe("2px");

  for (const theme of ["light", "dark"] as const) {
    if (theme === "dark") {
      await page.getByRole("button", { name: "Dark theme" }).click();
    }

    const contrast = await page.evaluate(() => {
      const luminance = (color: string) => {
        const values = color
          .match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number) ?? [0, 0, 0];
        const channel = (value: number) => {
          const normalized = value / 255;
          return normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        };
        const [red, green, blue] = values.map(channel);
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      };
      const ratio = (element: Element | null) => {
        if (!element) return 0;
        const style = getComputedStyle(element);
        const foreground = luminance(style.color);
        const background = luminance(style.backgroundColor);
        return (
          (Math.max(foreground, background) + 0.05) /
          (Math.min(foreground, background) + 0.05)
        );
      };
      return {
        status: ratio(document.querySelector('[data-status="supported"]')),
        disabled: ratio(
          document.querySelector('button[data-state="disabled"]'),
        ),
      };
    });
    expect(contrast.status).toBeGreaterThanOrEqual(4.5);
    expect(contrast.disabled).toBeGreaterThanOrEqual(4.5);
  }
});

test("captures review states at desktop, mobile, and minimum width", async ({
  page,
}) => {
  const evidenceDirectory = resolve(
    process.cwd(),
    "docs/ui-review/github/task-21",
  );
  await mkdir(evidenceDirectory, { recursive: true });

  for (const theme of ["light", "dark"] as const) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(fixtureUrl);
      if (theme === "dark") {
        await page.getByRole("button", { name: "Dark theme" }).click();
      }

      const primary = page.getByRole("button", {
        name: "Save selected achievements",
      });
      const stateTargets = {
        default: primary,
        focus: primary,
        pressed: primary,
        pending: page.locator('button[data-state="pending"]'),
        disabled: page.locator('button[data-state="disabled"]'),
      } as const;

      for (const state of [
        "default",
        "focus",
        "pressed",
        "pending",
        "disabled",
      ] as const) {
        const target = stateTargets[state];
        await target.scrollIntoViewIfNeeded();
        if (state === "focus") {
          await target.focus();
        }
        if (state === "pressed") {
          await target.hover();
          await page.mouse.down();
        }

        await page.screenshot({
          path: resolve(
            evidenceDirectory,
            "t21-" + theme + "-" + width + "-" + state + ".png",
          ),
          fullPage: true,
          animations: "disabled",
        });

        if (state === "pressed") {
          await page.mouse.up();
        }
      }
    }

    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(fixtureUrl);
    if (theme === "dark") {
      await page.getByRole("button", { name: "Dark theme" }).click();
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: resolve(evidenceDirectory, "t21-" + theme + "-320-default.png"),
      fullPage: true,
      animations: "disabled",
    });
  }
});

test("respects reduced motion for pending actions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(fixtureUrl);

  const spinner = page.locator('button[data-pending="true"] svg');
  await expect(spinner).toBeVisible();
  await expect(spinner).toHaveCSS("animation-name", "none");
});
