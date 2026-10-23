import { expect, test } from "@playwright/test";

/**
 * The job context card states the job the user is applying for. It has to be
 * traceable to the restored draft: the role, the company and the description
 * length are shown only when the draft holds them, a missing draft points to
 * the place where it can be provided, and nothing is ever filled in from a
 * sample.
 */

const DRAFT_STORAGE_KEY = "resume-changer.jd-draft.v1";

type Draft = {
  jobDescription: string;
  company: string;
  roleTitle: string;
  jobUrl: string;
};

function emptyDraft(): Draft {
  return { jobDescription: "", company: "", roleTitle: "", jobUrl: "" };
}

async function writeDraft(
  page: import("@playwright/test").Page,
  draft: Partial<Draft>,
) {
  await page.evaluate(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [
      DRAFT_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, ...emptyDraft(), ...draft }),
    ] as const,
  );
}

async function openBuilder(page: import("@playwright/test").Page) {
  await page.goto("/generate");
  await expect(page.locator(".generation-draft")).toBeVisible();
}

test("shows the restored role, company, and description length", async ({
  page,
}) => {
  const description = "Build reliable platform services. ".repeat(40);
  await page.goto("/");
  await writeDraft(page, {
    roleTitle: "Platform Engineer",
    company: "Example Systems",
    jobDescription: description,
  });
  await openBuilder(page);

  const card = page.locator(".generation-draft");
  await expect(card).toContainText("Platform Engineer");
  await expect(card).toContainText("Example Systems");
  await expect(card).toContainText(
    `${description.length.toLocaleString()} description characters`,
  );

  const role = card.locator(".generation-draft-role");
  await expect(role).toHaveText("Platform Engineer");
  await expect(role).toHaveCSS("font-size", "16px");
  await expect(card.locator(".generation-draft-meta")).toHaveCSS(
    "font-size",
    "12px",
  );
});

test("keeps the context empty and points to the job description page", async ({
  page,
}) => {
  await openBuilder(page);

  const card = page.locator(".generation-draft");
  await expect(card).toContainText("No saved job description.");
  await expect(card).not.toContainText("description characters");
  await expect(
    card.getByRole("link", { name: "Add job details" }),
  ).toHaveAttribute("href", "/");
});

test("never fills the context in from a sample", async ({ page }) => {
  const description = "Maintain internal tooling for the data platform team.";
  await page.goto("/");
  await writeDraft(page, { jobDescription: description });
  await openBuilder(page);

  const card = page.locator(".generation-draft");
  await expect(card).not.toContainText("ML engineer");
  await expect(card).not.toContainText("Google");
  await expect(card).not.toContainText("2,736");
  await expect(card).toContainText("Role not specified");
  await expect(card).toContainText(
    `${description.length.toLocaleString()} description characters`,
  );
  await expect(card.locator(".generation-draft-role.is-empty")).toBeVisible();
});

test("keeps a long role title and company inside the card", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await writeDraft(page, {
    roleTitle:
      "Senior Staff Software Engineer, Distributed Systems and Developer Platform Infrastructure",
    company:
      "Example Systems International Group Holdings and Operations Limited Partnership",
    jobDescription: "Build reliable platform services. ".repeat(40),
  });
  await openBuilder(page);

  const card = page.locator(".generation-draft");
  await expect(card).toContainText("Senior Staff Software Engineer");

  const measurements = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>(".generation-draft");
    const role = document.querySelector<HTMLElement>(".generation-draft-role");
    if (!card || !role) return null;
    return {
      cardWidth: card.clientWidth,
      cardScrollWidth: card.scrollWidth,
      roleRight: role.getBoundingClientRect().right,
      cardRight: card.getBoundingClientRect().right,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    };
  });

  expect(measurements).not.toBeNull();
  expect(measurements!.cardScrollWidth).toBeLessThanOrEqual(
    measurements!.cardWidth,
  );
  expect(measurements!.roleRight).toBeLessThanOrEqual(measurements!.cardRight);
  expect(measurements!.documentWidth).toBeLessThanOrEqual(
    measurements!.viewportWidth,
  );
});

test("follows the draft when the job context changes", async ({ page }) => {
  await page.goto("/");
  await writeDraft(page, {
    roleTitle: "Platform Engineer",
    company: "Example Systems",
    jobDescription: "Build reliable platform services.",
  });
  await openBuilder(page);

  const card = page.locator(".generation-draft");
  await expect(card).toContainText("Platform Engineer");
  await expect(card).toContainText("Example Systems");

  await writeDraft(page, {
    roleTitle: "Site Reliability Engineer",
    company: "Other Systems",
    jobDescription: "A different job description.",
  });
  await page.reload();

  await expect(card).toContainText("Site Reliability Engineer");
  await expect(card).toContainText("Other Systems");
  await expect(card).not.toContainText("Platform Engineer");
});
