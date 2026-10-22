import { expect, test, type Page } from "@playwright/test";

type TypeReading = {
  fontFamily: string;
  fontSize: string;
  lineHeight: string;
  letterSpacing: string;
  fontWeight: string;
  fontVariantNumeric: string;
  overflowWrap: string;
};

const LIBRARY_URL = "/library?source=demo";

async function readType(
  page: Page,
  selector: string,
): Promise<TypeReading | null> {
  return page.evaluate((target) => {
    const element = document.querySelector(target);
    if (!element) return null;
    const style = getComputedStyle(element);
    return {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      fontWeight: style.fontWeight,
      fontVariantNumeric: style.fontVariantNumeric,
      overflowWrap: style.overflowWrap,
    };
  }, selector);
}

async function readToken(page: Page, token: string): Promise<string> {
  return page.evaluate(
    (name) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    token,
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

type ContrastPair = {
  color: string;
  background: string;
};

/**
 * Reads the text colour and the surface it is actually painted on in a single
 * style resolution, so both values describe the same frame. Translucent
 * ancestor surfaces are composited instead of being taken at face value.
 */
async function readContrastPair(
  page: Page,
  selector: string,
): Promise<ContrastPair | null> {
  return page.evaluate((target) => {
    const element = document.querySelector(target);
    if (!element) return null;

    const color = getComputedStyle(element).color;

    const layers: string[] = [];
    let node: HTMLElement | null = element as HTMLElement;
    while (node) {
      layers.push(getComputedStyle(node).backgroundColor);
      node = node.parentElement;
    }
    layers.push(getComputedStyle(document.body).backgroundColor);

    const parse = (value: string) => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1]
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number);
      return {
        red: parts[0],
        green: parts[1],
        blue: parts[2],
        alpha: parts.length > 3 ? parts[3] : 1,
      };
    };

    // Paint the stack from the root down, so the last layer is the one the
    // text sits on.
    let base = { red: 255, green: 255, blue: 255, alpha: 1 };
    for (const layer of layers.reverse()) {
      const parsed = parse(layer);
      if (!parsed || parsed.alpha === 0) continue;
      const alpha = parsed.alpha + base.alpha * (1 - parsed.alpha);
      base = {
        red:
          (parsed.red * parsed.alpha +
            base.red * base.alpha * (1 - parsed.alpha)) /
          alpha,
        green:
          (parsed.green * parsed.alpha +
            base.green * base.alpha * (1 - parsed.alpha)) /
          alpha,
        blue:
          (parsed.blue * parsed.alpha +
            base.blue * base.alpha * (1 - parsed.alpha)) /
          alpha,
        alpha,
      };
    }

    return {
      color,
      background: `rgb(${base.red}, ${base.green}, ${base.blue})`,
    };
  }, selector);
}

/**
 * The shell animates the body colours for 160ms after a theme change. Wait
 * until the painted background stops moving so contrast is measured against a
 * settled theme rather than a frame in the middle of the transition.
 */
async function waitForSettledTheme(page: Page) {
  await page.waitForFunction(() => {
    const probe = window as unknown as { __backgroundProbe?: string };
    const current = getComputedStyle(document.body).backgroundColor;
    const settled = probe.__backgroundProbe === current;
    probe.__backgroundProbe = current;
    return settled;
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto(LIBRARY_URL);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("applies the shared type scale to the library hierarchy", async ({
  page,
}) => {
  const title = await readType(page, ".library-heading h1");
  const eyebrow = await readType(page, ".library-page .eyebrow");
  const intro = await readType(page, ".library-page .page-intro");
  const profileName = await readType(page, ".library-owner h2");
  const headline = await readType(page, ".library-owner p");
  const metricLabel = await readType(page, ".library-counts dt");
  const metricValue = await readType(page, ".library-counts dd");
  const experienceKind = await readType(page, ".experience-kind");
  const experienceTitle = await readType(page, ".experience-heading h3");
  const experienceMeta = await readType(page, ".experience-subtitle");
  const pointId = await readType(page, ".library-point-heading code");
  const pointStatus = await readType(page, ".point-status");
  const pointText = await readType(page, ".library-point-text");
  const provenance = await readType(page, ".point-provenance");
  const metricLabelInCard = await readType(page, ".point-metric-label");
  const metricEvidence = await readType(page, ".point-metric-evidence");
  const chip = await readType(page, ".facet-chip");
  const sectionTitle = await readType(page, ".library-detail summary");
  const searchLabel = await readType(page, ".library-search > span");
  const searchInput = await readType(page, ".library-search input");
  const filterLabel = await readType(page, ".library-filter-grid label > span");

  // The serif title treatment and the sans-serif UI treatment are preserved.
  expect(title?.fontFamily).toContain("Georgia");
  expect(profileName?.fontFamily).toContain("Georgia");
  expect(intro?.fontFamily).toContain("Arial");
  expect(pointText?.fontFamily).toContain("Arial");

  expect(title).toMatchObject({ fontSize: "40px", lineHeight: "48px" });
  expect(eyebrow).toMatchObject({ fontSize: "12px", lineHeight: "16px" });
  expect(intro).toMatchObject({ fontSize: "14px", lineHeight: "20px" });
  expect(profileName).toMatchObject({ fontSize: "30px", lineHeight: "38px" });
  expect(headline).toMatchObject({ fontSize: "14px", lineHeight: "20px" });
  expect(metricLabel).toMatchObject({ fontSize: "12px", lineHeight: "16px" });
  expect(metricValue).toMatchObject({ fontSize: "26px", lineHeight: "32px" });
  expect(experienceKind).toMatchObject({
    fontSize: "11px",
    lineHeight: "14px",
  });
  expect(experienceTitle).toMatchObject({
    fontSize: "18px",
    lineHeight: "24px",
  });
  expect(experienceMeta).toMatchObject({
    fontSize: "12px",
    lineHeight: "16px",
  });
  expect(pointId).toMatchObject({ fontSize: "12px", lineHeight: "16px" });
  expect(pointStatus).toMatchObject({ fontSize: "12px", lineHeight: "16px" });
  expect(pointText).toMatchObject({ fontSize: "14px", lineHeight: "20px" });
  expect(provenance).toMatchObject({ fontSize: "12px", lineHeight: "16px" });
  expect(metricLabelInCard).toMatchObject({
    fontSize: "14px",
    lineHeight: "20px",
  });
  expect(metricEvidence).toMatchObject({
    fontSize: "12px",
    lineHeight: "16px",
  });
  expect(chip).toMatchObject({ fontSize: "12px", lineHeight: "16px" });
  expect(sectionTitle).toMatchObject({ fontSize: "24px", lineHeight: "32px" });
  expect(searchLabel).toMatchObject({ fontSize: "12px", lineHeight: "16px" });
  expect(searchInput).toMatchObject({ fontSize: "14px", lineHeight: "20px" });
  expect(filterLabel).toMatchObject({ fontSize: "12px", lineHeight: "16px" });

  // Counts and metric values compare by column, so they use tabular numerals.
  expect(metricValue?.fontVariantNumeric).toContain("tabular-nums");

  // Letter spacing stays at zero and no size is viewport scaled.
  for (const reading of [title, intro, pointText, chip, metricValue]) {
    expect(["normal", "0px"]).toContain(reading?.letterSpacing);
  }
});

test("consumes the shared tokens instead of a second scale", async ({
  page,
}) => {
  const tokens = {
    pageTitle: await readToken(page, "--type-page-title-size"),
    pageTitleLine: await readToken(page, "--type-page-title-line-height"),
    profileName: await readToken(page, "--type-profile-name-size"),
    profileNameLine: await readToken(page, "--type-profile-name-line-height"),
    experienceTitle: await readToken(page, "--type-experience-title-size"),
    experienceTitleLine: await readToken(
      page,
      "--type-experience-title-line-height",
    ),
    body: await readToken(page, "--type-body-size"),
    bodyLine: await readToken(page, "--type-body-line-height"),
    label: await readToken(page, "--type-label-size"),
    metadata: await readToken(page, "--type-metadata-size"),
    microLabel: await readToken(page, "--type-micro-label-size"),
    metricValue: await readToken(page, "--type-metric-value-size"),
  };

  const title = await readType(page, ".library-heading h1");
  const profileName = await readType(page, ".library-owner h2");
  const experienceTitle = await readType(page, ".experience-heading h3");
  const pointText = await readType(page, ".library-point-text");
  const chip = await readType(page, ".facet-chip");
  const provenance = await readType(page, ".point-provenance");
  const experienceKind = await readType(page, ".experience-kind");
  const metricValue = await readType(page, ".library-counts dd");

  expect(title?.fontSize).toBe(tokens.pageTitle);
  expect(title?.lineHeight).toBe(tokens.pageTitleLine);
  expect(profileName?.fontSize).toBe(tokens.profileName);
  expect(profileName?.lineHeight).toBe(tokens.profileNameLine);
  expect(experienceTitle?.fontSize).toBe(tokens.experienceTitle);
  expect(experienceTitle?.lineHeight).toBe(tokens.experienceTitleLine);
  expect(pointText?.fontSize).toBe(tokens.body);
  expect(chip?.fontSize).toBe(tokens.label);
  expect(provenance?.fontSize).toBe(tokens.metadata);
  expect(experienceKind?.fontSize).toBe(tokens.microLabel);
  expect(metricValue?.fontSize).toBe(tokens.metricValue);
});

test("keeps the compact title on mobile and never clips content", async ({
  page,
}) => {
  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();

    const title = await readType(page, ".library-heading h1");
    const profileName = await readType(page, ".library-owner h2");
    const expectedTitle =
      width <= 700
        ? { fontSize: "32px", lineHeight: "40px" }
        : { fontSize: "40px", lineHeight: "48px" };
    const expectedProfile =
      width <= 700
        ? { fontSize: "28px", lineHeight: "36px" }
        : { fontSize: "30px", lineHeight: "38px" };

    expect(title).toMatchObject(expectedTitle);
    expect(profileName).toMatchObject(expectedProfile);

    const layout = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);

    await expect(
      page.getByRole("heading", { name: "Achievement library" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Jordan Example" }),
    ).toBeVisible();
  }
});

test("wraps long headings, values, and achievement text", async ({ page }) => {
  const overflow = await page.evaluate(() => {
    const results: Record<
      string,
      { scrollWidth: number; clientWidth: number }
    > = {};
    const targets: [string, string][] = [
      [".library-owner h2", "KonstantinopolouFitzgeraldWilliams"],
      [".experience-heading h3", "PrincipalInfrastructureReliabilityEngineer"],
      [
        ".library-point-text",
        "https://example.com/achievements/verylongresourceidentifier",
      ],
    ];
    for (const [selector, replacement] of targets) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const original = element.textContent;
      element.textContent = original + " " + replacement;
      results[selector] = {
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      };
      element.textContent = original;
    }
    return results;
  });

  expect(Object.keys(overflow).length).toBe(3);
  for (const [selector, measurement] of Object.entries(overflow)) {
    expect(
      measurement.scrollWidth,
      `${selector} overflowed its own box`,
    ).toBeLessThanOrEqual(measurement.clientWidth + 1);
  }
});

test("keeps muted metadata readable in both themes", async ({ page }) => {
  // Honour the reduced-motion preference so the theme switch does not animate
  // the page colours while they are being measured.
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => {
      localStorage.setItem("resume-changer.theme.v1", value);
    }, theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await waitForSettledTheme(page);

    const samples = [
      ".point-provenance",
      ".library-counts dt",
      ".experience-subtitle",
      ".library-point-text",
    ];

    for (const selector of samples) {
      const reading = await readContrastPair(page, selector);
      expect(reading, `${selector} is missing in ${theme} mode`).not.toBeNull();
      expect(reading?.color, `${selector} has no color`).not.toBe("");
      expect(reading?.background, `${selector} has no background`).not.toBe("");
      const ratio = contrastRatio(
        reading?.color ?? "",
        reading?.background ?? "",
      );
      expect(
        ratio,
        `${selector} contrast in ${theme} mode`,
      ).toBeGreaterThanOrEqual(4.5);
    }

    // Muted metadata must not be painted with the disabled/error color, which
    // would make real content look unavailable.
    const [muted, disabled] = await Promise.all([
      page.evaluate(() => {
        const element = document.querySelector(".point-provenance");
        return element ? getComputedStyle(element).color : "";
      }),
      page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = getComputedStyle(document.documentElement)
          .getPropertyValue("--danger")
          .trim();
        document.body.appendChild(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      }),
    ]);
    expect(muted).not.toBe(disabled);
  }
});
