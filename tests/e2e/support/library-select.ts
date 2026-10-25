import { expect, type Page } from "@playwright/test";

/** Choose a value from the library's custom, keyboard-accessible select. */
export async function chooseLibraryOption(
  page: Page,
  label: string,
  value: string,
) {
  const control = page.getByRole("combobox", { name: label });
  await control.click();
  await control
    .locator("xpath=..")
    .locator(`.library-select-option[data-value="${value}"]`)
    .click();
  await expect(control).toHaveAttribute("data-value", value);
}
