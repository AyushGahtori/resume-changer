import { expect, test, type Page } from "@playwright/test";

type Rgb = readonly [number, number, number];

const analysis = {
  targetTitle: "Software Engineer, ML Platform",
  seniority: "New graduate",
  requiredQualifications: ["Expected 2025 or 2026 graduate"],
  preferredQualifications: ["Familiarity with Python, Go, or C++"],
  responsibilities: ["Optimize GPU model serving"],
  toolsAndPlatforms: ["Python", "Go", "C++"],
  domainConcepts: ["Distributed systems"],
  atsTerms: ["GPU serving", "feature store"],
  inferredContext: ["The role likely supports production ML workloads."],
  terminology: [{ term: "machine learning", alternatives: ["ML"] }],
};

function parseCssColor(color: string): Rgb {
  const normalized = color.trim();
  const hexMatch = normalized.match(/^#([\da-f]{3}|[\da-f]{6})$/i);

  if (hexMatch) {
    const hex =
      hexMatch[1].length === 3
        ? [...hexMatch[1]].map((digit) => digit + digit).join("")
        : hexMatch[1];
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }

  const rgbMatch = normalized.match(/^rgba?\(([^)]+)\)$/i);

  if (rgbMatch) {
    const values = rgbMatch[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    if (values.length >= 3) return [values[0], values[1], values[2]];
  }

  throw new Error("Unsupported CSS color: " + color);
}

function relativeLuminance([red, green, blue]: Rgb) {
  const linearize = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };

  return (
    0.2126 * linearize(red) +
    0.7152 * linearize(green) +
    0.0722 * linearize(blue)
  );
}

function contrastRatio(first: Rgb, second: Rgb) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);

  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

async function readSurface(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      color: style.color,
      border: style.borderTopColor,
      opacity: style.opacity,
    };
  });
}

/**
 * The controls animate their surface and label together, so a colour read
 * taken straight after an interaction can land mid-transition. Wait for any
 * running transition to finish, then confirm the computed style holds
 * steady before asserting on it.
 */
async function settleSurface(page: Page, selector: string) {
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

  let previous: string | null = null;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const current = await page.locator(selector).evaluate((element) => {
      const style = getComputedStyle(element);
      return `${style.backgroundColor}|${style.color}`;
    });

    if (current === previous) break;
    previous = current;
    await page.waitForTimeout(60);
  }

  return readSurface(page, selector);
}

async function assertLabelContrast(page: Page, selector: string) {
  const surface = await settleSurface(page, selector);
  expect(surface.opacity).toBe("1");
  expect(
    contrastRatio(
      parseCssColor(surface.color),
      parseCssColor(surface.background),
    ),
  ).toBeGreaterThanOrEqual(4.5);
}

async function setTheme(page: Page, theme: "light" | "dark") {
  const current = await page.locator("html").getAttribute("data-theme");
  if (current === theme) return;
  await page.getByRole("button", { name: `Switch to ${theme} mode` }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("No saved draft");
});

test("gives every action a distinct default, hover, and pressed surface", async ({
  page,
}) => {
  const clear = page.getByRole("button", { name: "Clear draft" });
  const analyze = page.getByRole("button", { name: "Analyze job description" });
  const save = page.getByRole("button", { name: "Save draft" });

  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);

    const clearDefault = await settleSurface(
      page,
      ".home-action-button--ghost",
    );
    const analyzeDefault = await settleSurface(
      page,
      ".home-action-button--secondary",
    );
    const saveDefault = await settleSurface(
      page,
      ".home-action-button--primary",
    );

    // Each variant keeps its own identity rather than sharing a surface.
    expect(clearDefault.background).not.toBe(analyzeDefault.background);
    expect(analyzeDefault.background).not.toBe(saveDefault.background);

    await assertLabelContrast(page, ".home-action-button--ghost");
    await assertLabelContrast(page, ".home-action-button--secondary");
    await assertLabelContrast(page, ".home-action-button--primary");

    // Hover shifts each control away from its own default.
    const defaults: Record<string, string> = {
      ".home-action-button--ghost": clearDefault.background,
      ".home-action-button--secondary": analyzeDefault.background,
      ".home-action-button--primary": saveDefault.background,
    };

    for (const [button, selector] of [
      [clear, ".home-action-button--ghost"],
      [analyze, ".home-action-button--secondary"],
      [save, ".home-action-button--primary"],
    ] as const) {
      await button.hover();
      // Wait for the hover surface to actually replace the resting one.
      await expect
        .poll(
          () =>
            page
              .locator(selector)
              .evaluate((element) => getComputedStyle(element).backgroundColor),
          { timeout: 5_000 },
        )
        .not.toBe(defaults[selector]);
      const hovered = await settleSurface(page, selector);
      expect(hovered.background).not.toBe(defaults[selector]);
      await assertLabelContrast(page, selector);
      await page.mouse.move(2, 2);
    }
  }
});

test("shows a visibly pressed surface for each action", async ({ page }) => {
  const targets = [
    { name: "Clear draft", selector: ".home-action-button--ghost" },
    {
      name: "Analyze job description",
      selector: ".home-action-button--secondary",
    },
    { name: "Save draft", selector: ".home-action-button--primary" },
  ];

  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);

    for (const target of targets) {
      const button = page.getByRole("button", { name: target.name });
      const box = await button.boundingBox();
      expect(box).not.toBeNull();

      const resting = await settleSurface(page, target.selector);

      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.mouse.down();

      // Pressing applies both the pressed surface and the scale feedback.
      await expect
        .poll(
          () =>
            page
              .locator(target.selector)
              .evaluate((element) => getComputedStyle(element).backgroundColor),
          { timeout: 5_000 },
        )
        .not.toBe(resting.background);
      const pressed = await settleSurface(page, target.selector);
      expect(pressed.background).not.toBe(resting.background);
      await expect
        .poll(() =>
          page
            .locator(target.selector)
            .evaluate((element) => getComputedStyle(element).transform),
        )
        .not.toBe("none");
      await assertLabelContrast(page, target.selector);

      // Release outside the control so this visual-state check does not
      // trigger Clear/Analyze and move the following target during measurement.
      await page.mouse.move(2, 2);
      await page.mouse.up();
    }
  }
});

test("muted disabled actions stay readable and distinguishable", async ({
  page,
}) => {
  const clear = page.getByRole("button", { name: "Clear draft" });
  const analyze = page.getByRole("button", { name: "Analyze job description" });
  const save = page.getByRole("button", { name: "Save draft" });

  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);

    const enabledSave = await settleSurface(
      page,
      ".home-action-button--primary",
    );

    // Disabling the controls must not rely on opacity alone to read as off.
    await page.evaluate(() => {
      document
        .querySelectorAll<HTMLButtonElement>(".form-actions button")
        .forEach((button) => {
          button.disabled = true;
        });
    });

    await expect(clear).toBeDisabled();
    await expect(analyze).toBeDisabled();
    await expect(save).toBeDisabled();

    await assertLabelContrast(page, ".home-action-button--ghost");
    await assertLabelContrast(page, ".home-action-button--secondary");
    await assertLabelContrast(page, ".home-action-button--primary");

    // A disabled action is dimmer than its own enabled surface.
    const disabledSave = await settleSurface(
      page,
      ".home-action-button--primary",
    );
    expect(disabledSave.background).not.toBe(enabledSave.background);

    await page.evaluate(() => {
      document
        .querySelectorAll<HTMLButtonElement>(".form-actions button")
        .forEach((button) => {
          button.disabled = false;
        });
    });
  }
});

test("keeps the analyzing button the same size with a live spinner", async ({
  page,
}) => {
  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill("Build reliable services.");

  let releaseResponse: () => void = () => {};
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route("**/api/ai/analyze-job-description", async (route) => {
    await responseGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ analysis }),
    });
  });

  const analyze = page.getByRole("button", { name: "Analyze job description" });
  const idleBox = await analyze.boundingBox();
  expect(idleBox).not.toBeNull();

  await analyze.click();

  const loading = page.getByRole("button", { name: "Analyzing..." });
  await expect(loading).toBeDisabled();
  await expect(loading).toHaveAttribute("aria-busy", "true");

  const spinner = loading.locator("svg.home-action-spinner");
  await expect(spinner).toBeVisible();
  // A rotating element reports an enlarged visual box, so measure the
  // layout size the spinner actually occupies.
  const spinnerSize = await spinner.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      width: Number.parseFloat(style.width),
      height: Number.parseFloat(style.height),
      rectWidth: rect.width,
    };
  });
  expect(spinnerSize.width).toBeCloseTo(16, 0);
  expect(spinnerSize.height).toBeCloseTo(16, 0);

  const loadingBox = await loading.boundingBox();
  expect(loadingBox).not.toBeNull();
  expect(loadingBox!.width).toBeCloseTo(idleBox!.width, 1);
  expect(loadingBox!.height).toBeCloseTo(idleBox!.height, 1);

  // The busy control keeps its live surface instead of the muted one.
  const busySurface = await settleSurface(
    page,
    ".home-action-button--secondary",
  );
  expect(busySurface.opacity).toBe("1");
  expect(busySurface.background).toBe("rgb(239, 235, 255)");
  await assertLabelContrast(page, ".home-action-button--secondary");

  releaseResponse();
  await expect(
    page.getByRole("region", { name: "Job description analysis" }),
  ).toBeVisible();
});

test("shows Saving only while a save is actually pending", async ({ page }) => {
  const jobDescription = page.getByRole("textbox", {
    name: "Job description",
    exact: true,
  });
  const save = page.getByRole("button", { name: "Save draft" });

  // An explicit save writes locally, so it resolves without a spinner.
  await jobDescription.fill("Build dependable services.");
  await save.click();
  await expect(
    page.getByText(
      "Draft saved in this browser. You can open Resume builder now.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Saving..." })).toHaveCount(0);
  await expect(save).toBeEnabled();

  // The debounced autosave is the pending save, and it is announced.
  await jobDescription.fill("Build dependable services for customers.");
  const saving = page.getByRole("button", { name: "Saving..." });
  await expect(saving).toBeVisible();
  await expect(saving).toHaveAttribute("aria-busy", "true");
  await expect(saving.locator("svg.home-action-spinner")).toBeVisible();

  const savingBox = await saving.boundingBox();
  const idleBox = await save.boundingBox();
  expect(savingBox).not.toBeNull();
  expect(idleBox).not.toBeNull();
  expect(savingBox!.width).toBeCloseTo(idleBox!.width, 1);
  expect(savingBox!.height).toBeCloseTo(idleBox!.height, 1);

  await expect(save).toBeEnabled();
  await expect(page.locator(".draft-state")).toContainText(
    "Saved on this device",
  );
});

test("keeps a visible focus ring and 44px target in every state", async ({
  page,
}) => {
  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);

    const names = ["Clear draft", "Analyze job description", "Save draft"];

    for (const name of names) {
      const button = page.getByRole("button", { name });
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }

    // Keyboard traversal is what reveals the focus ring, so walk the row
    // with Tab and check each control as it takes focus.
    await page
      .getByRole("textbox", { name: "Job description", exact: true })
      .focus();

    for (const name of names) {
      let focused = false;
      for (let step = 0; step < 12 && !focused; step += 1) {
        await page.keyboard.press("Tab");
        focused = await page
          .getByRole("button", { name })
          .evaluate((element) => element === document.activeElement)
          .catch(() => false);
      }
      expect(focused, `${name} should be reachable with Tab`).toBe(true);

      const button = page.getByRole("button", { name });
      await expect(button).toBeFocused();
      await expect
        .poll(() =>
          button.evaluate((element) => getComputedStyle(element).outlineWidth),
        )
        .toBe("3px");

      // The focus ring stays visible against the surrounding surfaces.
      const ring = await button.evaluate((element) => {
        const style = getComputedStyle(element);
        const root = getComputedStyle(document.documentElement);
        return {
          color: style.outlineColor,
          style: style.outlineStyle,
          surfaces: [
            root.getPropertyValue("--color-canvas").trim(),
            root.getPropertyValue("--color-surface").trim(),
            root.getPropertyValue("--color-surface-alt").trim(),
          ],
        };
      });

      expect(ring.style).toBe("solid");

      for (const surface of ring.surfaces) {
        expect(
          contrastRatio(parseCssColor(ring.color), parseCssColor(surface)),
        ).toBeGreaterThanOrEqual(3);
      }
    }
  }
});

test("honors reduced motion for the loading spinner", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill("Build reliable services.");

  await page.route("**/api/ai/analyze-job-description", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 8000));
    await route.abort();
  });

  await page.getByRole("button", { name: "Analyze job description" }).click();

  const loading = page.getByRole("button", { name: "Analyzing..." });
  await expect(loading).toBeVisible();
  const animation = await loading
    .locator("svg.home-action-spinner")
    .evaluate((element) => getComputedStyle(element).animationName);
  expect(animation).toBe("none");
});
