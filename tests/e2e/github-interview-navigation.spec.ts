import { expect, test, type Page } from "@playwright/test";

const card = (page: Page) =>
  page.locator("article:has(#context-question-title)");
const title = (page: Page) => page.locator("#context-question-title");
const notes = "Keep my project notes while I revisit answers.";

async function advance(page: Page) {
  const previous = await title(page).textContent();
  await card(page).getByRole("group").locator("input").first().check();
  await card(page)
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect
    .poll(() =>
      title(page).evaluateAll((nodes) => nodes[0]?.textContent ?? null),
    )
    .not.toBe(previous);
}

for (const depth of [1, 3, 6]) {
  for (const navigation of ["interview button", "browser history"] as const) {
    test(`Back after ${depth} answers using ${navigation} keeps the real interview usable`, async ({
      page,
    }) => {
      test.skip(process.env.GITHUB_IMPORT_E2E_BACKEND !== "1");
      await page.context().addCookies([
        {
          name: "github_session",
          value: "a".repeat(43),
          url: "http://127.0.0.1:" + (process.env.PLAYWRIGHT_PORT ?? "3010"),
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
      await page.goto("/library/github/new");
      await page
        .getByRole("combobox", { name: "Repository", exact: true })
        .selectOption("42");
      const notesInput = page.getByRole("textbox", {
        name: "Anything else about your project or contribution?",
        exact: true,
      });
      await notesInput.fill(notes);
      const seen: string[] = [];
      for (let index = 0; index < depth; index++) {
        seen.push((await title(page).textContent())!);
        await advance(page);
      }
      const unansweredTitle = await title(page).textContent();
      const back = card(page).getByRole("button", {
        name: "Back",
        exact: true,
      });
      if (navigation === "browser history") await page.goBack();
      else await back.click();
      await expect(title(page)).toHaveText(seen.at(-1)!);
      await expect(
        card(page).getByRole("group").locator("input").first(),
      ).toBeChecked();
      await expect(notesInput).toHaveValue(notes);
      await expect(
        page.getByText(/We couldn't update the interview/),
      ).toHaveCount(0);
      if (depth === 1) await expect(back).toBeDisabled();

      // Forward restores the real adapter too, not just a scripted UI fixture.
      await page.goForward();
      await expect(title(page)).toHaveText(unansweredTitle!);
      await back.click();
      await expect(title(page)).toHaveText(seen.at(-1)!);
      await advance(page);
      await expect(title(page)).toHaveText(unansweredTitle!);
      await card(page)
        .getByRole("button", { name: "Not sure / Skip", exact: true })
        .click();
      await expect
        .poll(() =>
          title(page).evaluateAll((nodes) => nodes[0]?.textContent ?? null),
        )
        .not.toBe(unansweredTitle);
      await expect(
        page.getByText(/We couldn't update the interview/),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", {
          name: "Retry without losing this answer",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(notesInput).toHaveValue(notes);
      await back.click();
      await expect(title(page)).toHaveText(unansweredTitle!);
      await advance(page);
      await expect(
        page.getByText(/We couldn't update the interview/),
      ).toHaveCount(0);
    });
  }
}
