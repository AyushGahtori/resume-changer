import { expect, test, type Page } from "@playwright/test";
import { JD_URL_EXTRACTION_ROUTE } from "../../src/lib/jd-url-extraction";

/**
 * Task 17 of docs/UI_Tasks_home.md - the available path.
 *
 * The shipped build has no approved extraction service, so the control is
 * hidden. The interaction itself still has to be correct and tested, because
 * enabling the service is a backend change rather than new UI work.
 *
 * These tests drive the control by flipping the server-resolved capability in
 * the server-rendered payload before the page hydrates. That keeps the
 * production code path honest - the component still decides what to render
 * from the `available` prop it is given - without adding a test-only route or
 * a query flag to the shipped app.
 */

/** Relative luminance of a `rgb()`/`rgba()` colour string. */
function relativeLuminance(color: string): number {
  const match = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (!match) throw new Error(`Unsupported colour: ${color}`);
  const channels = [match[1], match[2], match[3]].map((value) => {
    const channel = Number(value) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG contrast ratio between two painted colours. */
function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const [lighter, darker] =
    firstLuminance > secondLuminance
      ? [firstLuminance, secondLuminance]
      : [secondLuminance, firstLuminance];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Enables the capability in the server-rendered RSC payload. */
async function enableExtractionCapability(page: Page) {
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({
      response,
      body: body.replace(
        /(\\?"pasteFromUrlAvailable\\?"\s*:\s*)false/,
        "$1true",
      ),
    });
  });
}

/**
 * Records any request to the extraction route.
 *
 * Playwright applies the most recently registered route first, so this must be
 * registered before the capability patch in order to observe the requests.
 */
async function recordExtractionRequests(page: Page): Promise<string[]> {
  const requests: string[] = [];
  await page.route("**/*", async (route) => {
    if (route.request().url().includes(JD_URL_EXTRACTION_ROUTE)) {
      requests.push(route.request().url());
    }
    await route.continue();
  });
  return requests;
}

async function openControl(page: Page) {
  const trigger = page.getByRole("button", { name: "Paste from URL" });
  await trigger.waitFor();
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  return trigger;
}

/**
 * Waits for the control's colour transition to finish.
 *
 * The theme is applied after hydration and the label animates its colour, so
 * a read taken straight after the page settles can land mid-transition and
 * measure a colour the control is only passing through.
 */
async function settleTriggerColor(page: Page, selector: string) {
  await page.locator(selector).evaluate(async (element) => {
    const running = () =>
      element
        .getAnimations()
        .filter(
          (animation) =>
            animation.constructor.name === "CSSTransition" &&
            animation.playState === "running",
        );

    // Give a transition that is about to start a chance to register.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (running().length === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  });
}

test.beforeEach(async ({ page }) => {
  // The recorder is registered first so it runs before the capability patch.
  extractionRequests = await recordExtractionRequests(page);
  await enableExtractionCapability(page);
});

let extractionRequests: string[] = [];

for (const theme of ["light", "dark"] as const) {
  test(`shows the URL action at the end of the metrics row in ${theme} mode`, async ({
    page,
  }) => {
    await page.addInitScript((value) => {
      localStorage.setItem("resume-changer.theme.v1", value);
    }, theme);
    await page.goto("/");

    const trigger = page.getByRole("button", { name: "Paste from URL" });
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    // The label is preceded by the 16px chain-link icon.
    const icon = trigger.locator("svg");
    await expect(icon).toBeVisible();
    const iconSize = await icon.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    expect(iconSize.width).toBeCloseTo(16, 0);
    expect(iconSize.height).toBeCloseTo(16, 0);

    // A text button, not a filled control, in a violet accent that stays
    // readable against the surface it sits on.
    await expect(trigger).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await settleTriggerColor(page, ".paste-from-url-trigger");
    const painted = await trigger.evaluate((element) => {
      const style = getComputedStyle(element);
      let node: Element | null = element;
      let background = "rgb(255, 255, 255)";
      while (node) {
        const candidate = getComputedStyle(node).backgroundColor;
        if (candidate && candidate !== "rgba(0, 0, 0, 0)") {
          background = candidate;
          break;
        }
        node = node.parentElement;
      }
      return { color: style.color, background };
    });
    expect(
      contrastRatio(painted.color, painted.background),
    ).toBeGreaterThanOrEqual(4.5);

    // It sits to the right of the metrics on the same row.
    const geometry = await page.evaluate(() => {
      const metrics = document
        .querySelector(".input-metrics")!
        .getBoundingClientRect();
      const button = document
        .querySelector(".paste-from-url-trigger")!
        .getBoundingClientRect();
      const row = document
        .querySelector(".form-metrics-row")!
        .getBoundingClientRect();
      return {
        metricsRight: metrics.right,
        buttonLeft: button.left,
        buttonTop: button.top,
        buttonHeight: button.height,
        metricsTop: metrics.top,
        metricsBottom: metrics.bottom,
        rowRight: row.right,
        buttonRight: button.right,
      };
    });

    expect(geometry.buttonLeft).toBeGreaterThanOrEqual(geometry.metricsRight);
    expect(geometry.buttonRight).toBeLessThanOrEqual(geometry.rowRight + 1);
    // 36-40px minimum hit height, vertically centred on the metrics row.
    expect(geometry.buttonHeight).toBeGreaterThanOrEqual(36);
    expect(geometry.buttonHeight).toBeLessThanOrEqual(40);
    expect(geometry.buttonTop).toBeLessThan(geometry.metricsBottom);
    expect(geometry.buttonTop).toBeGreaterThanOrEqual(geometry.metricsTop - 20);
  });
}

test("keeps the hit target and focus ring usable", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Paste from URL" });

  await expect(trigger).toHaveCSS("min-height", "38px");

  await trigger.focus();
  await expect(trigger).toBeFocused();
  const outline = await trigger.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: style.outlineWidth, style: style.outlineStyle };
  });
  expect(outline.style).not.toBe("none");
  expect(Number.parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
});

test("rejects an invalid URL without contacting the service", async ({
  page,
}) => {
  await page.goto("/");
  await openControl(page);

  const field = page.getByLabel("Job description link");
  await field.fill("not a url");
  await page.getByRole("button", { name: "Fetch" }).click();

  await expect(page.locator(".paste-from-url-message.is-error")).toHaveText(
    "Enter a valid job link.",
  );
  await expect(field).toHaveAttribute("aria-invalid", "true");
  expect(extractionRequests).toEqual([]);
});

test("rejects a non-HTTP scheme without contacting the service", async ({
  page,
}) => {
  await page.goto("/");
  await openControl(page);

  await page.getByLabel("Job description link").fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Fetch" }).click();

  await expect(page.locator(".paste-from-url-message.is-error")).toHaveText(
    "Enter an HTTP or HTTPS link.",
  );
  expect(extractionRequests).toEqual([]);
});

test("shows a loading state and then replaces the draft on success", async ({
  page,
}) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route("**/api/jd/extract", async (route) => {
    await gate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jobDescription: "Extracted synthetic job text." }),
    });
  });

  await page.goto("/");
  const description = page.getByRole("textbox", {
    name: "Job description",
    exact: true,
  });
  await description.fill("The draft the user already typed.");
  await openControl(page);

  await page.getByLabel("Job description link").fill("https://example.com/job");
  await page.getByRole("button", { name: "Fetch" }).click();

  // The loading state stays labelled and announces itself.
  const loading = page.getByRole("button", { name: "Fetching..." });
  await expect(loading).toBeVisible();
  await expect(loading).toBeDisabled();
  await expect(loading).toHaveAttribute("aria-busy", "true");

  // The draft survives until the extraction succeeds.
  await expect(description).toHaveValue("The draft the user already typed.");

  release();

  await expect(page.locator(".paste-from-url-message")).toHaveText(
    "Job description replaced from the link.",
  );
  await expect(description).toHaveValue("Extracted synthetic job text.");
});

test("keeps the draft and reports the failure when the service fails", async ({
  page,
}) => {
  await page.route("**/api/jd/extract", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "The extraction service failed." }),
    });
  });

  await page.goto("/");
  const description = page.getByRole("textbox", {
    name: "Job description",
    exact: true,
  });
  await description.fill("The draft the user already typed.");
  await openControl(page);

  await page.getByLabel("Job description link").fill("https://example.com/job");
  await page.getByRole("button", { name: "Fetch" }).click();

  await expect(page.locator(".paste-from-url-message.is-error")).toHaveText(
    "The extraction service failed.",
  );
  // The draft is untouched, and the control is usable again.
  await expect(description).toHaveValue("The draft the user already typed.");
  await expect(page.getByRole("button", { name: "Fetch" })).toBeEnabled();
});

test("cancels without contacting the service or changing the draft", async ({
  page,
}) => {
  await page.goto("/");
  const description = page.getByRole("textbox", {
    name: "Job description",
    exact: true,
  });
  await description.fill("The draft the user already typed.");
  await openControl(page);

  await page.getByLabel("Job description link").fill("https://example.com/job");
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(
    page.getByRole("button", { name: "Paste from URL" }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByLabel("Job description link")).toHaveCount(0);
  await expect(description).toHaveValue("The draft the user already typed.");
  expect(extractionRequests).toEqual([]);
});

test("pre-fills the entry field with the job link already entered", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Job link", exact: true })
    .fill("https://careers.example.com/job/42");
  await openControl(page);

  await expect(page.getByLabel("Job description link")).toHaveValue(
    "https://careers.example.com/job/42",
  );
});
