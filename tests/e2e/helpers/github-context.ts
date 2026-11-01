import { expect, type Page } from "@playwright/test";

export async function completeProjectInterview(page: Page, notes: string) {
  await expect(
    page.getByRole("heading", {
      name: "What is this project mainly for?",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("textbox", {
      name: "Anything else about your project or contribution?",
      exact: true,
    })
    .fill(notes);
  let answered = 0;
  while (await page.locator("#context-question-title").count()) {
    const heading = page.locator("#context-question-title");
    const previous = await heading.textContent();
    const ownership = page.getByRole("radio", {
      name: "I built the whole project",
      exact: true,
    });
    if (await ownership.count()) await ownership.check();
    else
      await page
        .locator("#context-question-title")
        .locator("..")
        .getByRole("group")
        .locator("input")
        .first()
        .check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect
      .poll(() =>
        page
          .locator("#context-question-title")
          .evaluateAll((nodes) => nodes[0]?.textContent ?? null),
      )
      .not.toBe(previous);
    answered++;
    expect(answered).toBeLessThanOrEqual(10);
  }
  expect(answered).toBeGreaterThanOrEqual(5);
  await expect(
    page.getByRole("heading", { name: "Check your answers", exact: true }),
  ).toBeVisible();
}
