import { expect, test, type Locator, type Page } from "@playwright/test";
import { openStudio } from "../helpers/studio-browser";
import { studioLibrary } from "../helpers/studio-fixtures";

/**
 * The manual overrides a user applies after reviewing a generated resume:
 * reordering a point, revealing its evidence, reverting edited wording, and
 * removing a point from the resume.
 */

const firstId = studioLibrary.jobs[0].points[0].id;
const secondId = studioLibrary.jobs[0].points[1].id;
const firstText = studioLibrary.jobs[0].points[0].text;
const secondText = studioLibrary.jobs[0].points[1].text;

function cardFor(page: Page, id: string): Locator {
  return page
    .locator(".studio-achievement-card")
    .filter({ has: page.locator(`[aria-label='Edit achievement ${id}']`) });
}

function moreActionsFor(page: Page, id: string): Locator {
  return page.getByRole("button", { name: "More actions for " + id });
}

test("keeps the action menu visible outside the scroll area and closes with Escape", async ({
  page,
}) => {
  await openStudio(page, false);
  const trigger = moreActionsFor(page, firstId);
  await trigger.click();

  const menu = page.getByRole("group", {
    name: "Actions for achievement " + firstId,
  });
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(
    menu.getByRole("button", { name: "View original" }),
  ).toBeVisible();
  expect(
    await menu.evaluate((element) => element.parentElement === document.body),
  ).toBe(true);

  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  const mobileBounds = await menu.boundingBox();
  expect(mobileBounds?.x).toBeGreaterThanOrEqual(0);
  expect(mobileBounds!.x + mobileBounds!.width).toBeLessThanOrEqual(390);
  expect(mobileBounds?.y).toBeGreaterThanOrEqual(0);
  expect(mobileBounds!.y + mobileBounds!.height).toBeLessThanOrEqual(844);
});

function cardOrder(page: Page): Promise<string[]> {
  return page
    .locator(".studio-achievement-card")
    .evaluateAll((cards) =>
      cards.map(
        (card) =>
          card
            .querySelector<HTMLElement>("[aria-label^='Edit achievement ']")
            ?.getAttribute("aria-label")
            ?.replace("Edit achievement ", "") ?? "",
      ),
    );
}

test("reorders a point within its destination and keeps the change staged", async ({
  page,
}) => {
  await openStudio(page);
  await expect(cardOrder(page)).resolves.toEqual([firstId, secondId]);

  // The first point cannot move up any further.
  await expect(
    page.getByRole("button", { name: `Move bullet up: ${firstId}` }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: `Move bullet down: ${secondId}` }),
  ).toBeDisabled();

  await page
    .getByRole("button", { name: `Move bullet down: ${firstId}` })
    .click();
  await expect(cardOrder(page)).resolves.toEqual([secondId, firstId]);
  // The moved point is now first, so it can no longer move up.
  await expect(
    page.getByRole("button", { name: `Move bullet up: ${secondId}` }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: `Move bullet up: ${firstId}` }),
  ).toBeEnabled();

  // The reordering is a staged change that has not been applied yet.
  await expect(
    page.getByRole("button", { name: "Apply changes →", exact: true }),
  ).toBeEnabled();
  const request = page.waitForRequest((candidate) =>
    candidate.url().endsWith("/api/resume/edit"),
  );
  await page
    .getByRole("button", { name: "Apply changes →", exact: true })
    .click();
  const body = (await request).postDataJSON();
  expect(
    body.document.bullets.map((bullet: { id: string }) => bullet.id),
  ).toEqual([secondId, firstId]);
});

test("reveals the original wording and its source evidence for an edited point", async ({
  page,
}) => {
  await openStudio(page);
  const card = cardFor(page, firstId);
  await expect(card).toContainText(firstText);
  await expect(card).toContainText("Original wording");

  await page
    .getByRole("button", { name: `Edit achievement ${firstId}`, exact: true })
    .click();
  await page
    .getByLabel("Achievement text")
    .fill("Rewritten wording that the user typed by hand.");
  await page.getByRole("button", { name: "Save draft" }).click();

  const edited = cardFor(page, firstId);
  await expect(edited).toContainText(
    "Rewritten wording that the user typed by hand.",
  );
  await expect(edited).toContainText("Edited draft");

  // The evidence panel holds the untouched source text and the source IDs.
  const evidence = edited.locator(".studio-evidence");
  await expect(evidence).toContainText(firstText);
  await expect(evidence).toContainText(firstId);

  // "View original" opens that panel for the reviewer.
  await moreActionsFor(page, firstId).click();
  await page.getByRole("button", { name: "View original" }).click();
  await expect(evidence).toHaveJSProperty("open", true);
});

test("reverts an edited point to its original wording", async ({ page }) => {
  await openStudio(page);
  await page
    .getByRole("button", { name: `Edit achievement ${firstId}`, exact: true })
    .click();
  await page
    .getByLabel("Achievement text")
    .fill("Temporary wording that should be reverted.");
  await page.getByRole("button", { name: "Save draft" }).click();

  const card = cardFor(page, firstId);
  await expect(card).toContainText(
    "Temporary wording that should be reverted.",
  );

  await moreActionsFor(page, firstId).click();
  const revert = page.getByRole("button", { name: "Revert wording" });
  await expect(revert).toBeEnabled();
  await revert.click();

  await expect(card).toContainText(firstText);
  await expect(card).toContainText("Original wording");
  await expect(
    card.getByText("Temporary wording that should be reverted."),
  ).toHaveCount(0);
});

test("removes a point from the resume and keeps the remaining point", async ({
  page,
}) => {
  await openStudio(page);
  await expect(page.locator(".studio-achievement-card")).toHaveCount(2);

  const card = cardFor(page, firstId);
  await moreActionsFor(page, firstId).click();
  await page.getByRole("button", { name: "Remove from resume" }).click();

  await expect(page.locator(".studio-achievement-card")).toHaveCount(1);
  await expect(cardFor(page, firstId)).toHaveCount(0);
  await expect(cardFor(page, secondId)).toContainText(secondText);

  // The removal is applied with the rest of the draft, and the removed point
  // never reaches the generated resume.
  const request = page.waitForRequest((candidate) =>
    candidate.url().endsWith("/api/resume/edit"),
  );
  await page
    .getByRole("button", { name: "Apply changes →", exact: true })
    .click();
  const body = (await request).postDataJSON();
  expect(
    body.document.bullets.map((bullet: { id: string }) => bullet.id),
  ).toEqual([secondId]);
});
