import { expect, test } from "@playwright/test";

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

type Rgb = readonly [number, number, number];

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

  const rgbMatch = normalized.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);

  if (rgbMatch) {
    return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
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

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("No saved draft");
});

test("keeps Save text and keyboard focus contrasted in both themes", async ({
  page,
}) => {
  const save = page.getByRole("button", { name: "Save draft" });
  const jobDescription = page.getByRole("textbox", {
    name: "Job description",
    exact: true,
  });

  await jobDescription.fill("Synthetic engineering role description.");

  const assertSaveTextContrast = async () => {
    const colors = await save.evaluate((button) => {
      const style = getComputedStyle(button);
      return {
        foreground: style.color,
        background: style.backgroundColor,
        opacity: style.opacity,
      };
    });

    expect(colors.opacity).toBe("1");
    expect(
      contrastRatio(
        parseCssColor(colors.foreground),
        parseCssColor(colors.background),
      ),
    ).toBeGreaterThanOrEqual(4.5);
  };

  const assertFocusContrast = async () => {
    const focus = await save.evaluate((button) => {
      const style = getComputedStyle(button);
      const rootStyle = getComputedStyle(document.documentElement);

      return {
        color: style.outlineColor,
        style: style.outlineStyle,
        width: style.outlineWidth,
        token: rootStyle.getPropertyValue("--color-focus-ring").trim(),
        surfaces: [
          rootStyle.getPropertyValue("--color-surface").trim(),
          rootStyle.getPropertyValue("--color-canvas").trim(),
        ],
      };
    });

    expect(focus.style).toBe("solid");
    expect(focus.width).toBe("2px");
    expect(parseCssColor(focus.color)).toEqual(parseCssColor(focus.token));

    for (const surface of focus.surfaces) {
      expect(
        contrastRatio(parseCssColor(focus.color), parseCssColor(surface)),
      ).toBeGreaterThanOrEqual(3);
    }
  };

  const exerciseTheme = async (theme: "light" | "dark") => {
    const currentTheme = await page.locator("html").getAttribute("data-theme");

    if (currentTheme !== theme) {
      await page
        .getByRole("button", { name: "Switch to " + theme + " mode" })
        .click();
    }

    const ink = theme === "light" ? "rgb(15, 23, 42)" : "rgb(23, 20, 33)";
    const hoverBackground =
      theme === "light" ? "rgb(194, 65, 12)" : "rgb(253, 186, 116)";
    const hoverText =
      theme === "light" ? "rgb(255, 255, 255)" : "rgb(23, 20, 33)";

    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(save).toHaveCSS("background-color", "rgb(249, 115, 22)");
    await expect(save).toHaveCSS("color", ink);
    await assertSaveTextContrast();

    await save.hover();
    await expect(save).toHaveCSS("background-color", hoverBackground);
    await expect(save).toHaveCSS("color", hoverText);
    await assertSaveTextContrast();

    await jobDescription.focus();
    for (let index = 0; index < 3; index += 1) {
      await page.keyboard.press("Tab");
    }
    await expect(save).toBeFocused();
    await assertFocusContrast();
  };

  await exerciseTheme("light");
  await exerciseTheme("dark");
});

test("shows distinct labeled action variants and keyboard focus", async ({
  page,
}) => {
  const clear = page.getByRole("button", { name: "Clear draft" });
  const analyze = page.getByRole("button", {
    name: "Analyze job description",
  });
  const save = page.getByRole("button", { name: "Save draft" });

  await expect(clear).toBeVisible();
  await expect(analyze).toBeEnabled();
  await expect(save).toBeEnabled();
  await expect(save).toHaveCSS("background-color", "rgb(249, 115, 22)");
  await expect(analyze.locator("svg")).toHaveCount(1);
  await expect(save.locator("svg")).toHaveCount(1);
  await expect(clear.locator("svg")).toHaveCount(0);

  for (const button of [clear, analyze, save]) {
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  const analyzeDefault = await analyze.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await analyze.hover();
  // The AI action deepens to a stronger violet on hover.
  await expect(analyze).toHaveCSS("background-color", "rgb(221, 214, 254)");
  expect(
    await analyze.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
  ).not.toBe(analyzeDefault);

  const clearBox = await clear.boundingBox();
  expect(clearBox).not.toBeNull();
  await page.mouse.move(
    clearBox!.x + clearBox!.width / 2,
    clearBox!.y + clearBox!.height / 2,
  );
  await page.mouse.down();
  await expect
    .poll(() =>
      clear.evaluate((element) => getComputedStyle(element).transform),
    )
    .not.toBe("none");
  await page.mouse.up();

  await clear.focus();
  await page.keyboard.press("Tab");
  await expect(analyze).toBeFocused();
  await expect
    .poll(() =>
      analyze.evaluate((element) => getComputedStyle(element).outlineWidth),
    )
    .toBe("2px");
});

test("saves and clears a draft through the primary and ghost actions", async ({
  page,
}) => {
  await page.getByLabel("Company").fill("Example Systems");
  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill("Build dependable services for customers.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(
    page.getByText(
      "Draft saved in this browser. You can open Resume builder now.",
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Clear draft" }).click();
  await expect(page.getByLabel("Company")).toHaveValue("");
  await expect(
    page.getByRole("textbox", { name: "Job description", exact: true }),
  ).toHaveValue("");
});

test("keeps the AI action disabled and the same size while analysis loads", async ({
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

  const analyze = page.getByRole("button", {
    name: "Analyze job description",
  });
  const idleBox = await analyze.boundingBox();
  expect(idleBox).not.toBeNull();
  await analyze.click();

  const loading = page
    .getByRole("form", { name: "Role details" })
    .getByRole("button", { name: "Analyzing..." });
  await expect(loading).toBeDisabled();
  await expect(loading).toHaveAttribute("aria-busy", "true");
  await expect(loading.locator(".home-action-spinner")).toBeVisible();
  const loadingBox = await loading.boundingBox();
  expect(loadingBox).not.toBeNull();
  expect(loadingBox!.width).toBeCloseTo(idleBox!.width, 1);
  expect(loadingBox!.height).toBeCloseTo(idleBox!.height, 1);

  releaseResponse();
  await expect(
    page.getByRole("region", { name: "Job description analysis" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Analyze job description" }),
  ).toBeEnabled();
});

test("keeps action buttons within tablet and narrow dark viewports", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("button", { name: "Analyze job description" }),
  ).toHaveCSS("background-color", "rgb(124, 58, 237)");
  await expect(page.getByRole("button", { name: "Save draft" })).toHaveCSS(
    "background-color",
    "rgb(249, 115, 22)",
  );

  for (const width of [950, 900, 768, 720, 390, 320]) {
    await page.setViewportSize({
      width,
      height: width < 500 ? 844 : 900,
    });
    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(pageOverflow).toBeLessThanOrEqual(0);

    for (const name of [
      "Clear draft",
      "Analyze job description",
      "Save draft",
    ]) {
      const button = page.getByRole("button", { name });
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  }
});

test("shows disabled actions before hydration without JavaScript", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(baseURL!);
    const save = page.getByRole("button", { name: "Save draft" });
    const analyze = page.getByRole("button", {
      name: "Analyze job description",
    });
    await expect(save).toBeDisabled();
    await expect(analyze).toBeDisabled();
    await expect(save).toHaveCSS("background-color", "rgb(253, 186, 116)");
    await expect(save).toHaveCSS("color", "rgb(15, 23, 42)");
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
