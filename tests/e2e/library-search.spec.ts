import { expect, test, type Page } from "@playwright/test";

/**
 * Task 14 "The sticky search and filter workbench".
 *
 * The suite covers the workbench contract: the order of its parts, the
 * sticky offset against the shared topbar, the opaque theme-aware surface,
 * the focus and anchor offsets that keep the sticky surface from covering
 * content, and the narrow-viewport fallback.
 */

function toRgbString(value: string) {
  const match = value.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (!match) throw new Error("Unsupported CSS color: " + value);

  const hex =
    match[1].length === 3
      ? [...match[1]].map((digit) => digit + digit).join("")
      : match[1];

  return `rgb(${Number.parseInt(hex.slice(0, 2), 16)}, ${Number.parseInt(
    hex.slice(2, 4),
    16,
  )}, ${Number.parseInt(hex.slice(4, 6), 16)})`;
}

/** Scrolls far enough for the workbench to reach its sticky position. */
async function scrollIntoStickyRange(page: Page) {
  await page.evaluate(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, Math.min(700, Math.max(0, max - 700)));
  });
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(0);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/library?source=demo");
});

test("keeps the search, the filters, and the result summary in order", async ({
  page,
}) => {
  const pageOrder = await page.evaluate(() => {
    const children = Array.from(
      document.querySelectorAll(".library-page > *"),
    ) as HTMLElement[];
    const indexOf = (selector: string) =>
      children.findIndex((child) => child.matches(selector));

    return {
      content: indexOf(".library-content"),
      overview: indexOf(".library-overview"),
      workbench: indexOf(".library-workbench"),
    };
  });

  // The workbench sits below the profile summary and above the content it
  // filters.
  expect(pageOrder.overview).toBeGreaterThanOrEqual(0);
  expect(pageOrder.overview).toBeLessThan(pageOrder.workbench);
  expect(pageOrder.workbench).toBeLessThan(pageOrder.content);

  const workbenchOrder = await page.evaluate(() =>
    Array.from(document.querySelector(".library-workbench")!.children).map(
      (child) => child.className,
    ),
  );

  expect(workbenchOrder[0]).toContain("library-search");
  expect(workbenchOrder[1]).toContain("library-filter-row");
  await expect(
    page.locator(".library-filter-row .library-filter-grid"),
  ).toBeVisible();
  expect(workbenchOrder[2]).toContain("library-workbench-footer");
  await expect(
    page.getByRole("navigation", { name: "Library sections" }),
  ).toBeVisible();
  await expect(
    page.locator(".library-workbench-footer .library-filter-summary"),
  ).toBeVisible();
});

test("pins the workbench directly below the shared topbar", async ({
  page,
}) => {
  const topbar = page.locator(".topbar");
  const workbench = page.locator(".library-workbench");

  const topbarBox = await topbar.boundingBox();
  expect(topbarBox).not.toBeNull();
  expect(topbarBox!.height).toBe(60);

  await scrollIntoStickyRange(page);

  // The shared header stays put and the workbench stacks under it rather
  // than covering it.
  await expect
    .poll(async () => Math.round((await topbar.boundingBox())!.y))
    .toBe(0);
  await expect
    .poll(async () => Math.round((await workbench.boundingBox())!.y))
    .toBe(Math.round(topbarBox!.height));

  const pinnedTopbar = await topbar.boundingBox();
  const pinnedWorkbench = await workbench.boundingBox();
  expect(pinnedWorkbench!.y).toBeGreaterThanOrEqual(pinnedTopbar!.y);
  expect(pinnedWorkbench!.y + pinnedWorkbench!.height).toBeGreaterThan(
    pinnedTopbar!.y + pinnedTopbar!.height,
  );
});

test("uses an opaque theme-aware surface with a hairline border", async ({
  page,
}) => {
  const workbench = page.locator(".library-workbench");

  const readSurface = () =>
    workbench.evaluate((element) => {
      const style = getComputedStyle(element);
      const root = getComputedStyle(document.documentElement);
      return {
        background: style.backgroundColor,
        borderColor: style.borderTopColor,
        borderStyle: style.borderTopStyle,
        borderWidth: style.borderTopWidth,
        boxShadow: style.boxShadow,
        borderToken: root.getPropertyValue("--color-border").trim(),
        surfaceToken: root.getPropertyValue("--color-surface").trim(),
      };
    });

  const light = await readSurface();
  expect(light.background).toBe(toRgbString(light.surfaceToken));
  expect(light.borderWidth).toBe("1px");
  expect(light.borderStyle).toBe("solid");
  expect(light.borderColor).toBe(toRgbString(light.borderToken));
  // A border separates the surface from the content behind it, so the
  // workbench never needs a heavy shadow.
  expect(light.boxShadow).toBe("none");

  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    /^(light|dark)$/,
  );
  const currentTheme = await page.locator("html").getAttribute("data-theme");
  if (currentTheme !== "dark") {
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const dark = await readSurface();
  expect(dark.surfaceToken).not.toBe(light.surfaceToken);
  expect(dark.background).toBe(toRgbString(dark.surfaceToken));
  expect(dark.borderColor).toBe(toRgbString(dark.borderToken));
  expect(dark.boxShadow).toBe("none");
});

test("keeps the sticky surface from covering content and focus", async ({
  page,
}) => {
  await scrollIntoStickyRange(page);

  const workbench = page.locator(".library-workbench");

  // The focused search control stays whole and below the pinned header.
  const search = page.getByRole("searchbox", { name: "Search library" });
  await search.focus();
  const searchBox = await search.boundingBox();
  const workbenchBox = await workbench.boundingBox();
  expect(searchBox).not.toBeNull();
  expect(searchBox!.y).toBeGreaterThanOrEqual(60);
  expect(searchBox!.y).toBeGreaterThanOrEqual(workbenchBox!.y - 1);

  // The destination sections carry the scroll offset that matches the
  // measured height of the pinned header and the workbench.
  await expect
    .poll(async () =>
      page.evaluate(() =>
        Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--library-workbench-height",
          ),
        ),
      ),
    )
    .toBeGreaterThan(0);

  const offsets = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const margin = getComputedStyle(
      document.querySelector(".library-section")!,
    ).scrollMarginTop;
    return {
      margin,
      topbar: Number.parseFloat(
        root.getPropertyValue("--library-topbar-height"),
      ),
      workbench: Number.parseFloat(
        root.getPropertyValue("--library-workbench-height"),
      ),
    };
  });
  expect(offsets.topbar).toBe(60);
  expect(offsets.workbench).toBeGreaterThan(0);
  expect(Number.parseFloat(offsets.margin)).toBeCloseTo(
    offsets.topbar + offsets.workbench,
    1,
  );

  // Scrolling a section into view leaves its heading below the workbench.
  const placement = await page.evaluate(() => {
    const groups = Array.from(
      document.querySelectorAll(".library-section"),
    ) as HTMLElement[];
    const limit = document.documentElement.scrollHeight * 0.6;
    const group =
      groups.find(
        (node) => node.getBoundingClientRect().top + window.scrollY < limit,
      ) ?? groups[0];
    group.scrollIntoView();

    const workbench = document.querySelector(".library-workbench")!;
    const heading = group.querySelector("h2")!;
    return {
      headingTop: heading.getBoundingClientRect().top,
      workbenchBottom: workbench.getBoundingClientRect().bottom,
    };
  });

  expect(placement.headingTop).toBeGreaterThanOrEqual(
    placement.workbenchBottom - 1,
  );
});

test("keeps the filter dropdowns on top of the sticky surface", async ({
  page,
}) => {
  await scrollIntoStickyRange(page);

  const workbench = page.locator(".library-workbench");
  const tag = page.getByLabel("Tag");

  const overflow = await workbench.evaluate(
    (element) => getComputedStyle(element).overflow,
  );
  // A clipped surface would cut the native dropdown off.
  expect(overflow).toBe("visible");

  const box = await tag.boundingBox();
  expect(box).not.toBeNull();
  const topElement = await page.evaluate(
    ({ x, y }) => {
      const node = document.elementFromPoint(x, y);
      return node ? node.tagName.toLowerCase() : "";
    },
    { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
  );
  expect(topElement).toBe("select");

  // The native select keeps its own keyboard behaviour while it is stuck.
  const before = await tag.inputValue();
  await tag.focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => tag.inputValue()).not.toBe(before);
});

test("keeps every control in the normal flow on a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();

  const position = await page
    .locator(".library-workbench")
    .evaluate((element) => getComputedStyle(element).position);
  // A sticky surface would crowd the content on a small screen.
  expect(position).toBe("static");

  await expect(
    page.getByRole("searchbox", { name: "Search library" }),
  ).toBeVisible();
  for (const label of [
    "Job or project",
    "Point source",
    "Point status",
    "Linked skill",
    "Tag",
  ]) {
    await expect(page.getByLabel(label)).toBeVisible();
  }
  await expect(page.locator(".library-result-count")).toBeVisible();
});

test("reports the matching result count while the query changes", async ({
  page,
}) => {
  const count = page.locator(".library-result-count");
  // The count lives in a polite live region so a filter change is announced.
  await expect(page.locator(".library-filter-summary")).toHaveAttribute(
    "aria-live",
    "polite",
  );

  await expect(count).toHaveText("13 of 13 achievement points");

  await page
    .getByRole("searchbox", { name: "Search library" })
    .fill("no matching library content");
  await expect(count).toHaveText("0 of 13 achievement points");

  await page
    .getByRole("region", { name: "Search and filter library" })
    .getByRole("button", { name: "Reset filters" })
    .click();
  await expect(count).toHaveText("13 of 13 achievement points");
});

/**
 * Task 15 "Style global search and its input states".
 *
 * The suite covers the search control: the accessible name and the board
 * placeholder, the magnifier and the conditional clear action, the neutral
 * and focused field treatments, the immediate and composable result, the
 * narrow-screen behaviour, and the empty state that stays distinct from a
 * load failure.
 */

/** Reads the search field together with the tokens it is styled from. */
async function readSearchField(page: Page) {
  return page.locator(".library-search").evaluate((element) => {
    const style = getComputedStyle(element);
    const root = getComputedStyle(document.documentElement);
    return {
      background: style.backgroundColor,
      borderColor: style.borderTopColor,
      borderRadius: style.borderTopLeftRadius,
      borderWidth: style.borderTopWidth,
      boxShadow: style.boxShadow,
      height: Math.round(element.getBoundingClientRect().height),
      tokens: {
        focusBorder: root.getPropertyValue("--color-focus-ring").trim(),
        neutralBorder: root.getPropertyValue("--color-border-strong").trim(),
        violet: root.getPropertyValue("--color-violet").trim(),
        violetLight: root.getPropertyValue("--color-violet-light").trim(),
      },
    };
  });
}

test("keeps the search name and adds the magnifier and a conditional clear action", async ({
  page,
}) => {
  const search = page.getByRole("searchbox", { name: "Search library" });
  await expect(search).toBeVisible();
  await expect(search).toHaveAttribute(
    "placeholder",
    "Search achievements... (points, skills, tags, jobs, projects, credentials)",
  );

  // The magnifier sits inside the field, before the text.
  await expect(
    page.locator(".library-search .library-search-icon"),
  ).toBeVisible();

  // The clear action only appears when there is something to clear.
  const clear = page.getByRole("button", { name: "Clear search" });
  await expect(clear).toHaveCount(0);

  await search.fill("docker");
  await expect(clear).toBeVisible();
  const clearBounds = await clear.boundingBox();
  expect(clearBounds?.width).toBeGreaterThanOrEqual(44);
  expect(clearBounds?.height).toBeGreaterThanOrEqual(44);

  await page.keyboard.press("Tab");
  await expect(clear).toBeFocused();
  await clear.click();
  await expect(search).toHaveValue("");
  await expect(clear).toHaveCount(0);
});

test("clears the query without clearing the other facets", async ({ page }) => {
  const search = page.getByRole("searchbox", { name: "Search library" });
  await page.getByLabel("Tag").selectOption({ label: "aws" });
  await search.fill("python");
  await expect(page.locator(".library-result-count")).toContainText("0 of 13");

  await page.getByRole("button", { name: "Clear search" }).click();

  await expect(search).toHaveValue("");
  // The facet that was chosen is untouched.
  await expect(page.getByLabel("Tag")).toHaveValue("aws");
  await expect(page.locator(".library-result-count")).toContainText("1 of 13");
});

test("keeps a neutral border at rest and a 2px violet ring on focus", async ({
  page,
}) => {
  const rest = await readSearchField(page);
  expect(rest.borderWidth).toBe("1px");
  expect(rest.borderColor).toBe(toRgbString(rest.tokens.neutralBorder));
  expect(rest.borderRadius).toBe("6px");
  expect(rest.boxShadow).toBe("none");
  expect(rest.height).toBe(44);

  const search = page.getByRole("searchbox", { name: "Search library" });
  await search.focus();

  const focused = await readSearchField(page);
  expect(focused.borderColor).toBe(toRgbString(focused.tokens.focusBorder));
  expect(focused.boxShadow).toContain(toRgbString(focused.tokens.violet));
  expect(focused.boxShadow).toContain("2px");

  // A filled field that is not focused keeps the neutral border.
  await search.fill("docker");
  await page.locator(".library-heading h1").click();

  const filled = await readSearchField(page);
  expect(filled.borderColor).toBe(toRgbString(filled.tokens.neutralBorder));
  expect(filled.boxShadow).toBe("none");
});

test("keeps the field treatment in the dark theme", async ({ page }) => {
  const theme = await page.locator("html").getAttribute("data-theme");
  if (theme !== "dark") {
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const rest = await readSearchField(page);
  expect(rest.borderColor).toBe(toRgbString(rest.tokens.neutralBorder));
  expect(rest.boxShadow).toBe("none");

  await page.getByRole("searchbox", { name: "Search library" }).focus();

  const focused = await readSearchField(page);
  expect(focused.boxShadow).not.toBe("none");
  expect(focused.boxShadow).toContain(toRgbString(focused.tokens.violetLight));
  expect(focused.boxShadow).toContain("2px");
});

test("updates the results as the query is typed, with no hidden delay", async ({
  page,
}) => {
  const count = page.locator(".library-result-count");
  const before = await count.textContent();

  await page.getByRole("searchbox", { name: "Search library" }).fill("python");

  // The count is read straight after the input event, so a debounced
  // implementation would still show the previous number here.
  const immediate = await page.evaluate(
    () => document.querySelector(".library-result-count")?.textContent ?? "",
  );
  expect(immediate).not.toBe(before);
  expect(immediate).toContain("2 of 13");
});

test("composes the query with the other facets", async ({ page }) => {
  const count = page.locator(".library-result-count");

  await page.getByLabel("Linked skill").selectOption({ label: "Python" });
  await expect(count).toContainText("2 of 13");

  await page.getByRole("searchbox", { name: "Search library" }).fill("python");
  await expect(count).toContainText("2 of 13");

  await page.getByLabel("Tag").selectOption({ label: "aws" });
  await expect(count).toContainText("0 of 13");
});

test("keeps a long query on one line inside the field on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();

  const search = page.getByRole("searchbox", { name: "Search library" });
  await search.fill(
    "a very long query that will not fit inside the field on a small screen",
  );

  const state = await page.evaluate(() => {
    const input = document.querySelector(
      ".library-search input",
    ) as HTMLInputElement;
    const field = document.querySelector(".library-search") as HTMLElement;
    return {
      clientWidth: input.clientWidth,
      fieldHeight: Math.round(field.getBoundingClientRect().height),
      pageOverflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      scrollWidth: input.scrollWidth,
    };
  });

  // The entered text stays on one line and scrolls inside the input.
  expect(state.fieldHeight).toBe(44);
  expect(state.scrollWidth).toBeGreaterThan(state.clientWidth);
  // The page itself does not scroll sideways.
  expect(state.pageOverflow).toBeLessThanOrEqual(1);
});

test("keeps the no-results state distinct from a load failure and keeps the query editable", async ({
  page,
}) => {
  const search = page.getByRole("searchbox", { name: "Search library" });
  await search.fill("no matching library content");

  const emptyState = page.locator(".library-state");
  await expect(emptyState).toBeVisible();
  await expect(
    emptyState.getByRole("heading", {
      name: "No achievements match these filters",
    }),
  ).toBeVisible();
  await expect(emptyState.getByRole("status")).toHaveText(
    "None of the 13 achievements in this library match the current search and filters.",
  );

  // A library that cannot be read is rendered as a separate, announced
  // failure, so the two states never look like each other.
  await expect(page.locator(".library-error")).toHaveCount(0);

  // The query stays in the field so it can be edited.
  await expect(search).toHaveValue("no matching library content");
});
