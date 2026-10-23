import { expect, test } from "@playwright/test";

/**
 * The Resume Builder must use the shared application color tokens in both
 * themes. The boards print their own palette, so this spec pins the builder
 * to the app-wide tokens instead of a private builder palette, and checks
 * that the roles the boards assign to each color are the roles the product
 * uses:
 *
 * - orange carries the main resume action,
 * - violet carries AI actions, selected states, and focus,
 * - success, warning, and error carry truthful status only.
 */

type Rgb = readonly [number, number, number];

const DRAFT = {
  schemaVersion: 1,
  jobDescription:
    "You will build and operate platform services that other engineering teams depend on every day. The role owns service boundaries, capacity planning, and safe rollout for a multi-tenant runtime.",
  company: "Example Systems",
  roleTitle: "Platform Engineer",
  jobUrl: "",
};

const ANALYSIS = {
  schemaVersion: 1,
  company: DRAFT.company,
  roleTitle: DRAFT.roleTitle,
  jobDescription: DRAFT.jobDescription,
  analysis: {
    targetTitle: "Platform Engineer",
    seniority: "Mid-level",
    requiredQualifications: ["Platform engineering", "Continuous delivery"],
    preferredQualifications: ["Distributed systems"],
    responsibilities: ["Own service boundaries and capacity planning"],
    toolsAndPlatforms: ["Docker", "Kubernetes", "Terraform"],
    domainConcepts: ["Multi-tenant runtime", "Safe rollout"],
    atsTerms: ["platform services", "continuous delivery"],
    inferredContext: ["Internal developer platform"],
    terminology: [
      { term: "platform services", alternatives: ["internal platform"] },
    ],
  },
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
    if (values.length >= 3 && values.slice(0, 3).every(Number.isFinite)) {
      return [values[0], values[1], values[2]];
    }
  }

  throw new Error("Unsupported CSS color: " + color);
}

function normalizeCssColor(color: string): string {
  const [red, green, blue] = parseCssColor(color);
  return (
    "#" +
    [red, green, blue]
      .map((channel) => channel.toString(16).padStart(2, "0"))
      .join("")
  );
}

/**
 * Playwright compares a computed style with the literal string the browser
 * reports, so a token is compared in its `rgb()` spelling.
 */
function rgbString(color: string): string {
  const [red, green, blue] = parseCssColor(color);
  return `rgb(${red}, ${green}, ${blue})`;
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

const SHARED_COLOR_TOKENS = [
  "--color-canvas",
  "--color-sidebar",
  "--color-surface",
  "--color-surface-alt",
  "--color-surface-hover",
  "--color-text-primary",
  "--color-text-secondary",
  "--color-text-muted",
  "--color-text-on-orange",
  "--color-border",
  "--color-border-strong",
  "--color-violet",
  "--color-violet-light",
  "--color-violet-subtle",
  "--color-violet-strong",
  "--color-orange",
  "--color-orange-light",
  "--color-orange-subtle",
  "--color-orange-strong",
  "--color-success",
  "--color-success-strong",
  "--color-success-subtle",
  "--color-warning",
  "--color-warning-strong",
  "--color-warning-subtle",
  "--color-error",
  "--color-error-strong",
  "--color-error-subtle",
  "--color-focus-ring",
];

async function sharedTokens(page: import("@playwright/test").Page) {
  return page.evaluate((names) => {
    const styles = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      names.map((name) => [name, styles.getPropertyValue(name).trim()]),
    );
  }, SHARED_COLOR_TOKENS);
}

async function seedDraft(page: import("@playwright/test").Page) {
  await page.addInitScript(
    ([draft, analysis]) => {
      try {
        window.localStorage.setItem(
          "resume-changer.jd-draft.v1",
          JSON.stringify(draft),
        );
        window.localStorage.setItem(
          "resume-changer.jd-analysis.v1",
          JSON.stringify(analysis),
        );
      } catch {
        /* The spec only asserts what the page renders. */
      }
    },
    [DRAFT, ANALYSIS] as const,
  );
}

test.beforeEach(async ({ page }) => {
  await seedDraft(page);
  await page.goto("/generate?source=demo");
  await expect(
    page.getByRole("button", { name: "Suggest points" }),
  ).toBeEnabled();
});

test("maps the builder palette onto the shared app-wide tokens", async ({
  page,
}) => {
  const tokens = await sharedTokens(page);
  const normalized = Object.fromEntries(
    Object.entries(tokens).map(([name, value]) => [
      name,
      normalizeCssColor(value),
    ]),
  );

  // The shared tokens keep the app-wide values that the home, library, and
  // builder already agree on. The boards print slightly different hex
  // values; the delta is recorded in the review instead of forking a
  // builder-only palette.
  expect(normalized["--color-violet"]).toBe("#7c3aed");
  expect(normalized["--color-violet-light"]).toBe("#a78bfa");
  expect(normalized["--color-orange"]).toBe("#ff7a45");
  expect(normalized["--color-border"]).toBe("#cbd5e1");
  expect(normalized["--color-text-primary"]).toBe("#0f172a");
  expect(normalized["--color-error"]).toBe("#ef4444");
  expect(normalized["--color-warning"]).toBe("#f59e0b");

  // The main resume action carries the shared orange.
  const primary = page.getByRole("button", { name: "Generate LaTeX" });
  await expect(primary).toHaveCSS(
    "background-color",
    rgbString(normalized["--color-orange"]),
  );
  await expect(primary).toHaveCSS(
    "color",
    rgbString(normalized["--color-text-on-orange"]),
  );

  // AI actions carry the shared violet.
  const aiAction = page.getByRole("button", { name: "Suggest points" });
  await expect(aiAction).toHaveCSS(
    "background-color",
    rgbString(normalized["--color-violet-subtle"]),
  );
  await expect(aiAction).toHaveCSS(
    "color",
    rgbString(normalized["--color-violet-strong"]),
  );

  // The selected state of an achievement row carries the shared violet
  // rather than the primary-action orange or a status color.
  const checkbox = page
    .locator('.generation-point input[type="checkbox"]')
    .first();
  await expect(checkbox).toHaveCSS(
    "accent-color",
    rgbString(normalized["--color-violet"]),
  );
  await checkbox.check();
  await expect(checkbox).toBeChecked();

  // Focus carries the shared focus ring.
  await page.keyboard.press("Tab");
  await primary.focus();
  const outline = await primary.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      color: style.outlineColor,
      style: style.outlineStyle,
      width: style.outlineWidth,
    };
  });
  expect(outline.style).toBe("solid");
  expect(normalizeCssColor(outline.color)).toBe(
    normalized["--color-focus-ring"],
  );
});

test("keeps the builder palette in the dark theme on the same tokens", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const tokens = await sharedTokens(page);
  const normalized = Object.fromEntries(
    Object.entries(tokens).map(([name, value]) => [
      name,
      normalizeCssColor(value),
    ]),
  );

  const primary = page.getByRole("button", { name: "Generate LaTeX" });
  await expect(primary).toHaveCSS(
    "background-color",
    rgbString(normalized["--color-orange"]),
  );
  await expect(primary).toHaveCSS(
    "color",
    rgbString(normalized["--color-text-on-orange"]),
  );

  const aiAction = page.getByRole("button", { name: "Suggest points" });
  await expect(aiAction).toHaveCSS(
    "background-color",
    rgbString(normalized["--color-violet-subtle"]),
  );
  await expect(aiAction).toHaveCSS(
    "color",
    rgbString(normalized["--color-violet-strong"]),
  );

  const checkbox = page
    .locator('.generation-point input[type="checkbox"]')
    .first();
  await expect(checkbox).toHaveCSS(
    "accent-color",
    rgbString(normalized["--color-violet"]),
  );

  await page.keyboard.press("Tab");
  await primary.focus();
  const outline = await primary.evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.outlineColor, style: style.outlineStyle };
  });
  expect(outline.style).toBe("solid");
  expect(normalizeCssColor(outline.color)).toBe(
    normalized["--color-focus-ring"],
  );
});

test("uses no builder-only color outside the shared token set", async ({
  page,
}) => {
  const tokens = await sharedTokens(page);
  const shared = new Set(
    Object.values(tokens).map((value) => normalizeCssColor(value)),
  );

  const controls = [
    ".generation-page",
    ".generation-heading",
    ".generation-draft",
    ".generation-form",
    ".generation-selection",
    ".generation-preview",
    ".generation-preview-empty",
    ".generation-output-tabs",
    ".generation-section-heading",
    ".generation-footer",
  ];

  const observed = await page.evaluate((selectors) => {
    return selectors.flatMap((selector) => {
      const element = document.querySelector(selector);
      if (!element) return [];
      const style = getComputedStyle(element);
      return [
        {
          selector,
          property: "background-color",
          value: style.backgroundColor,
        },
        { selector, property: "color", value: style.color },
        { selector, property: "border-top-color", value: style.borderTopColor },
        {
          selector,
          property: "border-left-color",
          value: style.borderLeftColor,
        },
      ];
    });
  }, controls);

  expect(observed.length).toBeGreaterThan(0);
  for (const { selector, property, value } of observed) {
    if (value === "rgba(0, 0, 0, 0)") continue;
    expect(
      shared.has(normalizeCssColor(value)),
      `${selector} ${property} uses ${value}, which is not a shared token`,
    ).toBe(true);
  }
});

test("keeps the builder labels legible on their token surfaces", async ({
  page,
}) => {
  const pairs = await page.evaluate(() => {
    const rootStyle = getComputedStyle(document.documentElement);
    const token = (name: string) => rootStyle.getPropertyValue(name).trim();

    const primary = document.querySelector(
      ".generation-footer .primary-button",
    ) as HTMLElement | null;
    const aiAction = document.querySelector(
      ".generation-selection-actions .generation-ai-button",
    ) as HTMLElement | null;
    if (!primary || !aiAction) return null;

    return {
      primary: {
        background: getComputedStyle(primary).backgroundColor,
        color: getComputedStyle(primary).color,
      },
      ai: {
        background: getComputedStyle(aiAction).backgroundColor,
        color: getComputedStyle(aiAction).color,
      },
      surface: token("--color-surface"),
    };
  });

  expect(pairs).not.toBeNull();
  const primaryContrast = contrastRatio(
    parseCssColor(pairs!.primary.color),
    parseCssColor(pairs!.primary.background),
  );
  const aiContrast = contrastRatio(
    parseCssColor(pairs!.ai.color),
    parseCssColor(pairs!.ai.background),
  );

  expect(primaryContrast).toBeGreaterThanOrEqual(4.5);
  expect(aiContrast).toBeGreaterThanOrEqual(4.5);
});
