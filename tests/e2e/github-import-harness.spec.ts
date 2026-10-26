import { expect, test } from "@playwright/test";

test("the explicit E2E harness registers fixed GitHub import UI cases", async ({
  page,
}) => {
  await page.goto("/e2e/github-import");

  await expect(page.getByTestId("github-import-harness-root")).toBeVisible();
  await expect(
    page.getByText(
      "Synthetic fixtures only. No GitHub, provider, filesystem, or approval calls.",
    ),
  ).toBeVisible();

  const selector = page.getByRole("combobox", {
    name: "Choose GitHub import fixture",
  });
  await expect(selector.locator("option")).toHaveCount(26);

  for (const caseId of [
    "setup-private-denied",
    "evidence-blocked",
    "review-needs-context",
    "measurement-target",
    "status-interrupted",
    "notifications-expired",
    "layout-review",
  ]) {
    await selector.selectOption(caseId);
    await expect(
      page.getByTestId("github-import-harness-case"),
    ).toHaveAttribute("data-case-id", caseId);
    await expect(page.getByTestId("github-import-placeholder")).toBeVisible();
  }
});
