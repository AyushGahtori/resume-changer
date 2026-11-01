import { expect, test, type Page, type TestInfo } from "@playwright/test";
import transcripts from "../fixtures/github/context-interview-ui/transcripts.json";

const targetWidths = [320, 390, 768, 1024, 1440];

async function answerCurrentQuestion(page: Page) {
  const radios = page.getByRole("radio");
  const checkboxes = page.getByRole("checkbox");
  if ((await radios.count()) > 0) {
    await radios.first().check();
  } else {
    await checkboxes.first().check();
    await checkboxes.nth(1).check();
  }
  await page.getByRole("button", { name: "Continue" }).click();
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({
    path: testInfo.outputPath(`${name}.png`),
    fullPage: true,
  });
}

async function finishRoute(page: Page, testInfo: TestInfo, routeName: string) {
  let count = 1;
  while (
    !(await page
      .getByRole("heading", { name: "Check your answers" })
      .isVisible()
      .catch(() => false))
  ) {
    if (count === 2) await capture(page, testInfo, `${routeName}-mid-branch`);
    await answerCurrentQuestion(page);
    count += 1;
    if (count > 10)
      throw new Error("Fixture route exceeded the interview question cap");
  }
  await capture(page, testInfo, `${routeName}-review`);
  return count;
}

test.describe("GitHub project context interview UI", () => {
  test("starts with truthful progress, a separate notes card, and ownership as a structured answer", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/e2e/github-context-interview?route=adaptive");
    await expect(
      page.getByRole("heading", { name: "What is this project for?" }),
    ).toBeVisible();
    await expect(page.getByText("Question 1 · up to 10")).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Anything else about your project or contribution?",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: "Something else" }),
    ).toHaveCount(1);
    await capture(page, testInfo, "opening-light-1440");

    await page
      .getByRole("radio", { name: "A web application or website" })
      .check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(
      page.getByRole("heading", {
        name: "How did you contribute to the project?",
      }),
    ).toBeFocused();
    await expect(
      page.getByRole("radio", {
        name: "I built the whole project from scratch",
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Question 2 · 7 currently planned"),
    ).toBeVisible();
    await expect(
      page.getByText(/Evidence preparation is a separate step/),
    ).toBeVisible();
  });

  for (const route of transcripts.routes) {
    test(`supports the ${route.routeLength}-question ${route.name}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 960 });
      await page.goto(
        `/e2e/github-context-interview?route=${route.routeLength}`,
      );
      await capture(page, testInfo, `route-${route.routeLength}-opening`);
      await page
        .getByRole("radio", {
          name: new RegExp(
            route.projectKindOption === "kind-tool"
              ? "developer or automation tool"
              : route.projectKindOption === "kind-data"
                ? "data or machine learning system"
                : "web application or website",
          ),
        })
        .check();
      await page.getByRole("button", { name: "Continue" }).click();
      const visited = await finishRoute(
        page,
        testInfo,
        `route-${route.routeLength}`,
      );
      expect(visited).toBe(route.routeLength);
      await expect(
        page.getByText(
          `${route.routeLength} applicable question${route.routeLength === 1 ? "" : "s"} completed · 0 remaining`,
        ),
      ).toBeVisible();
      await expect(
        page.getByTestId("context-interview-fixture-state"),
      ).toHaveAttribute("data-provider-call-count", "0");
    });
  }

  test("supports custom answers, multi-select, bounded notes, skip, and answer editing", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto("/e2e/github-context-interview?route=5");

    const notes = page.getByRole("textbox", {
      name: "Anything else about your project or contribution?",
    });
    await notes.fill("😀".repeat(501));
    await expect(page.getByText("500 / 500 code points").first()).toBeVisible();
    const notesValue = await notes.inputValue();
    expect(Array.from(notesValue)).toHaveLength(500);
    await capture(page, testInfo, "notes-light-1024");

    await page.getByRole("radio", { name: "Something else" }).check();
    const custom = page.getByRole("textbox", { name: "Your answer" });
    await custom.fill("a".repeat(501));
    await expect(page.getByText("500 / 500 code points").first()).toBeVisible();
    expect((await custom.inputValue()).length).toBe(500);
    await page.getByRole("button", { name: "Continue" }).click();

    await page
      .getByRole("radio", { name: "I built the whole project from scratch" })
      .check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("radio", { name: "I worked on it by myself" }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    const capabilityChecks = page.getByRole("checkbox");
    await capabilityChecks.nth(0).check();
    await capabilityChecks.nth(1).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Not sure / Skip" }).click();
    await expect(
      page.getByRole("heading", { name: "Check your answers" }),
    ).toBeVisible();
    await expect(page.getByText(/1 skipped/)).toBeVisible();
    await expect(
      page.getByText("Show a user interface, Use AI or machine learning"),
    ).toBeVisible();
    await expect(
      page.getByTestId("context-interview-fixture-state"),
    ).toHaveAttribute("data-revision-event-count", /[1-9]/);

    const firstAnswer = page.getByRole("list").getByRole("listitem").first();
    await firstAnswer.getByRole("button", { name: "Edit answer" }).click();
    await expect(
      page.getByRole("heading", { name: "What is this project for?" }),
    ).toBeFocused();
    await expect(
      page.getByRole("radio", { name: "Something else" }),
    ).toBeChecked();
    await expect(notes).toHaveValue("😀".repeat(500));
  });

  test("adapts branch length, prunes stale follow-ups, and extends again", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto("/e2e/github-context-interview?route=adaptive");
    await page
      .getByRole("radio", { name: "A web application or website" })
      .check();
    await page.getByRole("button", { name: "Continue" }).click();
    while (
      !(await page
        .getByRole("heading", { name: "Check your answers" })
        .isVisible()
        .catch(() => false))
    ) {
      await answerCurrentQuestion(page);
    }
    await capture(page, testInfo, "review-before-branch-edit");

    const purposeAnswer = page.getByRole("list").getByRole("listitem").first();
    await purposeAnswer.getByRole("button", { name: "Edit answer" }).click();
    await page
      .getByRole("radio", { name: "A developer or automation tool" })
      .check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(
      page.getByRole("heading", { name: "Check your answers" }),
    ).toBeVisible();
    await expect(
      page.getByText(/2 follow-up answers no longer apply/),
    ).toBeVisible();
    await expect(
      page.getByText("5 applicable questions completed · 0 remaining"),
    ).toBeVisible();

    await page
      .getByRole("list")
      .getByRole("listitem")
      .first()
      .getByRole("button", { name: "Edit answer" })
      .click();
    await page
      .getByRole("radio", { name: "A data or machine learning system" })
      .check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(
      page.getByRole("heading", {
        name: "What happens in the data or model workflow?",
      }),
    ).toBeFocused();
    await expect(
      page.getByText("Question 6 · 10 currently planned"),
    ).toBeVisible();
  });

  test("browser Back and Forward preserve the answer history", async ({
    page,
  }) => {
    await page.goto("/e2e/github-context-interview?route=7");
    await page
      .getByRole("radio", { name: "A web application or website" })
      .check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(
      page.getByRole("heading", {
        name: "How did you contribute to the project?",
      }),
    ).toBeVisible();
    await page.goBack();
    await expect(
      page.getByRole("heading", { name: "What is this project for?" }),
    ).toBeFocused();
    await expect(
      page.getByRole("radio", { name: "A web application or website" }),
    ).toBeChecked();
    await page.goForward();
    await expect(
      page.getByRole("heading", {
        name: "How did you contribute to the project?",
      }),
    ).toBeFocused();
  });

  test("ignores accidental duplicate submit clicks", async ({ page }) => {
    await page.goto("/e2e/github-context-interview?route=7&slow=250");
    await page
      .getByRole("radio", { name: "A web application or website" })
      .check();
    const continueButton = page.getByRole("button", { name: "Continue" });
    await continueButton.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect(
      page.getByRole("heading", {
        name: "How did you contribute to the project?",
      }),
    ).toBeFocused();
    await expect(
      page.getByTestId("context-interview-fixture-state"),
    ).toHaveAttribute("data-answer-submission-count", "1");
  });

  test("supports reduced motion, keyboard controls, all target widths, themes, and 200% zoom", async ({
    page,
  }) => {
    await page.goto("/e2e/github-context-interview?route=adaptive");
    for (const width of targetWidths) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"] as const) {
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
        }, theme);
        await expect(
          page.getByRole("heading", { name: "What is this project for?" }),
        ).toBeVisible();
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        );
        expect(
          overflow,
          `${theme} theme at ${width}px should reflow without horizontal scrolling`,
        ).toBe(false);
      }
    }

    await page.emulateMedia({ reducedMotion: "reduce" });
    const motion = await page
      .getByTestId("context-question-content")
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          animationName: style.animationName,
          transform: style.transform,
        };
      });
    expect(motion.animationName).toBe("none");
    expect(motion.transform).toBe("none");

    const first = page.getByRole("radio").first();
    const second = page.getByRole("radio").nth(1);
    await first.focus();
    await page.keyboard.press("ArrowDown");
    await expect(second).toBeChecked();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(
      page.getByRole("heading", {
        name: "How did you contribute to the project?",
      }),
    ).toBeFocused();

    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    const zoomOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(zoomOverflow).toBe(false);
  });

  test("keeps selections through a slow retry and resumes an expired tab session", async ({
    page,
  }) => {
    await page.goto(
      "/e2e/github-context-interview?route=adaptive&slow=250&fail=1",
      { waitUntil: "domcontentloaded" },
    );
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Loading your project interview" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "What is this project for?" }),
    ).toBeVisible();
    await page
      .getByRole("radio", { name: "A web application or website" })
      .check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(
      page.getByRole("button", { name: "Retry without losing this answer" }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: "A web application or website" }),
    ).toBeChecked();
    await page
      .getByRole("button", { name: "Retry without losing this answer" })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "How did you contribute to the project?",
      }),
    ).toBeVisible();
    await expect(
      page.getByTestId("context-interview-fixture-state"),
    ).toHaveAttribute("data-provider-call-count", "0");

    await page.goto("/e2e/github-context-interview?route=adaptive&drop=1");
    await page
      .getByRole("radio", { name: "A web application or website" })
      .check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(
      page.getByRole("button", { name: "Retry without losing this answer" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Retry without losing this answer" })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "How did you contribute to the project?",
      }),
    ).toBeFocused();
    await expect(
      page.getByTestId("context-interview-fixture-state"),
    ).toHaveAttribute("data-answer-submission-count", "1");
    await expect(
      page.getByTestId("context-interview-fixture-state"),
    ).toHaveAttribute("data-provider-call-count", "0");

    await page.goto(
      "/e2e/github-context-interview?phase=expired&route=adaptive",
    );
    await expect(
      page.getByRole("heading", { name: "This interview session expired" }),
    ).toBeVisible();
    await expect(page.getByText("A web application or website")).toBeVisible();
    const retainedNotes = page.getByRole("textbox", {
      name: "Anything else about your project or contribution?",
    });
    await expect(retainedNotes).toHaveValue(
      "Keep this note while reconnecting.",
    );
    await page.getByRole("button", { name: "Retry session" }).click();
    await expect(
      page.getByRole("heading", {
        name: "How did you contribute to the project?",
      }),
    ).toBeFocused();
    await expect(
      page.getByRole("textbox", {
        name: "Anything else about your project or contribution?",
      }),
    ).toHaveValue("Keep this note while reconnecting.");
    await expect(
      page.getByTestId("context-interview-fixture-state"),
    ).toHaveAttribute("data-provider-call-count", "0");
    const persistentStorage = await page.evaluate(
      () => localStorage.length + sessionStorage.length,
    );
    expect(persistentStorage).toBe(0);
  });

  test("explains an empty route and allows an honest empty review", async ({
    page,
  }) => {
    await page.goto("/e2e/github-context-interview?phase=empty");
    await expect(
      page.getByRole("heading", { name: "No more relevant questions" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Review answers" }).click();
    await expect(
      page.getByRole("heading", { name: "Check your answers" }),
    ).toBeVisible();
    await expect(
      page.getByText("0 applicable questions completed · 0 remaining"),
    ).toBeVisible();
  });
});
