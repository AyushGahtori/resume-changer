import { expect, test } from "@playwright/test";

/**
 * The Resume Builder must follow the shared type scale in both themes.
 *
 * The boards print their own scale, so this spec pins the builder to the
 * shared tokens instead of a private builder scale, and checks that long
 * company names, job titles, and counts wrap instead of being clipped.
 */

const DRAFT = {
  schemaVersion: 1,
  jobDescription:
    "You will build and operate platform services that other engineering teams depend on every day. The role owns service boundaries, capacity planning, and safe rollout for a multi-tenant runtime.",
  company:
    "Northwind Example Global Infrastructure and Cloud Services Incorporated",
  roleTitle:
    "Senior Platform Engineer, Distributed Systems and Site Reliability",
  jobUrl: "",
};

const ANALYSIS = {
  schemaVersion: 1,
  company: DRAFT.company,
  roleTitle: DRAFT.roleTitle,
  jobDescription: DRAFT.jobDescription,
  analysis: {
    targetTitle: "Platform Engineer",
    seniority: "Senior",
    requiredQualifications: ["Platform engineering", "Reliability"],
    preferredQualifications: ["Distributed systems"],
    responsibilities: ["Own service boundaries and capacity planning"],
    toolsAndPlatforms: ["Kubernetes", "Terraform"],
    domainConcepts: ["Multi-tenant runtime", "Safe rollout"],
    atsTerms: ["platform services", "site reliability"],
    inferredContext: ["Internal developer platform"],
    terminology: [{ term: "platform services", alternatives: ["platform"] }],
  },
};

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

test("keeps the builder heading hierarchy on the shared type scale", async ({
  page,
}) => {
  // Page title: 40/48 on the desktop, in the existing serif treatment.
  const title = page.locator(".generation-heading h1");
  await expect(title).toHaveCSS("font-size", "40px");
  await expect(title).toHaveCSS("line-height", "48px");
  await expect(title).toHaveCSS("font-family", /Georgia/);

  // Section title: 24/32, semibold.
  const sectionTitle = page.locator(".generation-section-heading h2").first();
  await expect(sectionTitle).toHaveCSS("font-size", "24px");
  await expect(sectionTitle).toHaveCSS("line-height", "32px");
  await expect(sectionTitle).toHaveCSS("font-weight", "600");

  // Card title: 16/24, semibold.
  const cardTitle = page.locator(".generation-draft-role");
  await expect(cardTitle).toHaveCSS("font-size", "16px");
  await expect(cardTitle).toHaveCSS("line-height", "24px");
  await expect(cardTitle).toHaveCSS("font-weight", "600");

  // Body text: 14/20.
  const achievement = page.locator(".generation-point").first();
  await expect(achievement).toHaveCSS("font-size", "14px");
  await expect(achievement).toHaveCSS("line-height", "20px");

  // Label: 12/16, semibold.
  const label = page.locator(".generation-label").first();
  await expect(label).toHaveCSS("font-size", "12px");
  await expect(label).toHaveCSS("line-height", "16px");
  await expect(label).toHaveCSS("font-weight", "600");
});

test("scales the page title down on the mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const title = page.locator(".generation-heading h1");
  await expect(title).toHaveCSS("font-size", "32px");
  await expect(title).toHaveCSS("line-height", "40px");
});

test("keeps letter spacing at zero and the counts tabular", async ({
  page,
}) => {
  const letterSpacing = await page.evaluate(() => {
    const selectors = [
      ".generation-heading .eyebrow",
      ".generation-label",
      ".generation-section-heading h2",
      ".generation-section-heading p",
      ".generation-draft",
      ".generation-point",
    ];
    return selectors.flatMap((selector) => {
      const element = document.querySelector(selector);
      if (!element) return [];
      return [
        {
          selector,
          value: getComputedStyle(element).letterSpacing,
        },
      ];
    });
  });

  expect(letterSpacing.length).toBeGreaterThan(0);
  for (const { selector, value } of letterSpacing) {
    expect(
      value === "normal" || value === "0px",
      `${selector} uses letter spacing ${value}`,
    ).toBe(true);
  }

  // Numeric comparisons keep a stable width.
  const counts = await page.evaluate(() => {
    const selectors = [
      ".generation-draft-count",
      ".generation-section-heading p",
    ];
    return selectors.map((selector) => {
      const element = document.querySelector(selector);
      return {
        selector,
        value: element
          ? getComputedStyle(element).fontVariantNumeric
          : "missing",
      };
    });
  });

  for (const { selector, value } of counts) {
    expect(value, `${selector} count style`).toContain("tabular-nums");
  }
});

test("wraps long company names and job titles without clipping", async ({
  page,
}) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);

    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        window.localStorage.setItem("resume-changer.theme.v1", value);
      }, theme);
      await page.reload();
      await expect(
        page.getByRole("button", { name: "Suggest points" }),
      ).toBeEnabled();

      const layout = await page.evaluate(() => {
        const root = document.documentElement;
        const clipped = Array.from(
          document.querySelectorAll(
            ".generation-draft strong, .generation-draft span, .generation-point span, .generation-label, .generation-section-heading h2, .generation-section-heading p",
          ),
        )
          .filter((element) => element.scrollWidth > element.clientWidth + 1)
          .map((element) => element.className || element.tagName);

        return {
          documentOverflow: root.scrollWidth - root.clientWidth,
          clipped,
        };
      });

      expect(
        layout.documentOverflow,
        `the page scrolls sideways at ${viewport.width} in ${theme}`,
      ).toBeLessThanOrEqual(1);
      expect(
        layout.clipped,
        `clipped builder text at ${viewport.width} in ${theme}`,
      ).toEqual([]);
    }
  }
});
