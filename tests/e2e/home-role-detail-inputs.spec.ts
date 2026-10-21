import { expect, test } from "@playwright/test";
import { ROLE_FIELDS } from "../../src/lib/ui/role-fields";

type Rgb = readonly [number, number, number];

function parseRgb(color: string): Rgb {
  const channels = color
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number);
  if (!channels || channels.length !== 3) {
    throw new Error("Expected an RGB color, received: " + color);
  }
  return [channels[0], channels[1], channels[2]];
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

function contrastRatio(foreground: string, background: string) {
  const first = relativeLuminance(parseRgb(foreground));
  const second = relativeLuminance(parseRgb(background));
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  // The draft state starts as "Loading draft" until localStorage is read.
  await expect(page.getByRole("status")).not.toContainText("Loading draft");
  await expect(page.getByRole("status")).toContainText("No saved draft");
});

test("lays the role details fields out in three aligned desktop columns", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  const groups = page.locator(".metadata-fields > .field-group");
  await expect(groups).toHaveCount(3);

  const labels = await groups.locator("label").allTextContents();
  expect(labels).toEqual(["Company", "Role title", "Job link"]);

  const metrics = await page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>(".metadata-fields")!;
    const items = Array.from(
      grid.querySelectorAll<HTMLElement>(".field-group"),
    ).map((group) => {
      const label = group.querySelector<HTMLElement>("label")!;
      const input = group.querySelector<HTMLInputElement>("input")!;
      const icon = group.querySelector<SVGSVGElement>(".field-icon svg")!;
      const labelBounds = label.getBoundingClientRect();
      const inputBounds = input.getBoundingClientRect();
      const iconBounds = icon.getBoundingClientRect();
      const style = getComputedStyle(input);

      return {
        labelBottom: labelBounds.bottom,
        inputTop: inputBounds.top,
        inputLeft: inputBounds.left,
        inputRight: inputBounds.right,
        inputHeight: inputBounds.height,
        inputWidth: inputBounds.width,
        iconLeft: iconBounds.left,
        iconWidth: iconBounds.width,
        iconHeight: iconBounds.height,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        paddingLeft: Number.parseFloat(style.paddingLeft),
        borderRadius: style.borderRadius,
        borderColor: style.borderColor,
        borderWidth: style.borderTopWidth,
        backgroundColor: style.backgroundColor,
        color: style.color,
      };
    });

    return {
      items,
      columns: getComputedStyle(grid).gridTemplateColumns,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });

  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.columns.split(" ").length).toBe(3);

  for (const item of metrics.items) {
    // A 44px control with the label 6-8px above it.
    expect(item.inputHeight).toBe(44);
    expect(item.inputTop - item.labelBottom).toBeGreaterThanOrEqual(6);
    expect(item.inputTop - item.labelBottom).toBeLessThanOrEqual(8);

    // 14px/20px body text on a 6px radius control.
    expect(item.fontSize).toBe("14px");
    expect(item.lineHeight).toBe("20px");
    expect(item.borderRadius).toBe("6px");
    expect(item.borderWidth).toBe("1px");

    // The icon is a leading adornment inset 12px from the left edge, and the
    // input reserves matching padding so text starts at one shared offset.
    expect(item.iconLeft - item.inputLeft).toBe(12);
    expect(item.iconWidth).toBe(17);
    expect(item.iconHeight).toBe(17);
    expect(item.paddingLeft).toBeGreaterThanOrEqual(
      item.iconLeft - item.inputLeft + item.iconWidth,
    );
  }

  // Equal-width columns with a consistent gap, all on one row.
  const widths = metrics.items.map((item) => Math.round(item.inputWidth));
  expect(new Set(widths).size).toBe(1);
  const tops = metrics.items.map((item) => item.inputTop);
  expect(new Set(tops).size).toBe(1);
});

test("keeps the leading icons decorative so fields announce their label", async ({
  page,
}) => {
  for (const descriptor of ROLE_FIELDS) {
    const input = page.getByLabel(descriptor.label, { exact: true });
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute("id", descriptor.id);
    await expect(input).toHaveAttribute("name", descriptor.name);
    await expect(input).toHaveAttribute(
      "autocomplete",
      descriptor.autoComplete,
    );
    await expect(input).toHaveAttribute("placeholder", descriptor.placeholder);
  }

  // The icons are present but hidden from assistive technology.
  await expect(page.locator(".metadata-fields .field-icon")).toHaveCount(3);
  for (const icon of await page.locator(".metadata-fields .field-icon").all()) {
    await expect(icon).toHaveAttribute("aria-hidden", "true");
  }

  // The job link advertises a URL keyboard.
  await expect(page.getByLabel("Job link", { exact: true })).toHaveAttribute(
    "inputmode",
    "url",
  );
});

test("preserves typed values and the existing validation contract", async ({
  page,
}) => {
  const company = page.getByLabel("Company", { exact: true });
  const roleTitle = page.getByLabel("Role title", { exact: true });
  const jobUrl = page.getByLabel("Job link", { exact: true });

  await company.fill("Example Systems");
  await roleTitle.fill("Backend Engineer");
  await jobUrl.fill("https://jobs.example/role");

  await expect(company).toHaveValue("Example Systems");
  await expect(roleTitle).toHaveValue("Backend Engineer");
  await expect(jobUrl).toHaveValue("https://jobs.example/role");

  // Company and role title are optional; only a malformed link fails.
  await jobUrl.fill("not-a-url");
  await page.getByRole("button", { name: "Save draft" }).click();

  const urlError = page.locator("#job-url-error");
  await expect(urlError).toBeVisible();
  await expect(urlError).toContainText("Enter a valid job link.");
  await expect(jobUrl).toHaveAttribute("aria-invalid", "true");
  await expect(jobUrl).toHaveAttribute("aria-describedby", "job-url-error");

  // The message is paired with an icon, so the failure is not color-only.
  await expect(urlError.locator("svg")).toHaveCount(1);

  // Correcting the value clears the error state.
  await jobUrl.fill("https://jobs.example/role");
  await expect(urlError).toBeHidden();
  await expect(jobUrl).not.toHaveAttribute("aria-invalid", "true");
});

test("marks a non-HTTP job link invalid with a red border", async ({
  page,
}) => {
  const jobUrl = page.getByLabel("Job link", { exact: true });
  await jobUrl.fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Save draft" }).click();

  const error = page.locator("#job-url-error");
  await expect(error).toContainText("Enter an HTTP or HTTPS link.");

  // The border transitions, so wait for the settled color.
  await expect
    .poll(() =>
      jobUrl.evaluate((element) => getComputedStyle(element).borderTopColor),
    )
    .toBe("rgb(239, 68, 68)");

  // The error sits below the control as a 12px helper line.
  const errorStyle = await error.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      color: style.color,
    };
  });
  expect(errorStyle.fontSize).toBe("12px");
  expect(errorStyle.lineHeight).toBe("16px");

  // The error line sits under the input it belongs to.
  const positions = await error.evaluate((element) => {
    const input = document.getElementById("job-url")!;
    return {
      inputBottom: input.getBoundingClientRect().bottom,
      errorTop: element.getBoundingClientRect().top,
    };
  });
  expect(positions.errorTop).toBeGreaterThanOrEqual(positions.inputBottom);
});

test("shows a violet focus ring on the field and keeps the text readable", async ({
  page,
}) => {
  const company = page.getByLabel("Company", { exact: true });
  await company.focus();

  await expect(company).toHaveCSS("outline-color", "rgb(124, 58, 237)");
  await expect(company).toHaveCSS("outline-style", "solid");
  await expect(company).toHaveCSS("outline-width", "2px");
  await expect(company).toHaveCSS("outline-offset", "2px");

  const focusStyles = await company.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineColor: style.outlineColor,
      outlineWidth: style.outlineWidth,
      backgroundColor: style.backgroundColor,
      color: style.color,
    };
  });

  // A 2px violet ring sits outside the control, not over the entered text.
  expect(focusStyles.outlineColor).toBe("rgb(124, 58, 237)");
  expect(focusStyles.outlineWidth).toBe("2px");
  expect(
    contrastRatio(focusStyles.color, focusStyles.backgroundColor),
  ).toBeGreaterThanOrEqual(4.5);
});

test("renders legible placeholders and entered text in both themes", async ({
  page,
}) => {
  const company = page.getByLabel("Company", { exact: true });

  const readContrast = () =>
    company.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        color: style.color,
        backgroundColor: style.backgroundColor,
        placeholderColor: getComputedStyle(element, "::placeholder").color,
      };
    });

  const light = await readContrast();
  expect(
    contrastRatio(light.color, light.backgroundColor),
  ).toBeGreaterThanOrEqual(4.5);
  expect(
    contrastRatio(light.placeholderColor, light.backgroundColor),
  ).toBeGreaterThanOrEqual(4.5);

  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const dark = await readContrast();
  expect(dark.color).not.toBe(light.color);
  expect(
    contrastRatio(dark.color, dark.backgroundColor),
  ).toBeGreaterThanOrEqual(4.5);
  expect(
    contrastRatio(dark.placeholderColor, dark.backgroundColor),
  ).toBeGreaterThanOrEqual(4.5);
});

test("keeps a disabled control legible against the alternate surface", async ({
  page,
}) => {
  // The product does not disable these fields today, so the disabled
  // treatment is verified by exercising the shipped rule directly.
  const company = page.getByLabel("Company", { exact: true });
  await company.evaluate((element) => {
    (element as HTMLInputElement).disabled = true;
  });

  const styles = await company.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      borderColor: style.borderTopColor,
      cursor: style.cursor,
    };
  });

  // Disabled uses the alternate surface, not a faded one, and the label text
  // stays readable against it.
  expect(styles.backgroundColor).toBe("rgb(241, 245, 249)");
  expect(styles.cursor).toBe("not-allowed");
  expect(
    contrastRatio(styles.color, styles.backgroundColor),
  ).toBeGreaterThanOrEqual(4.5);
});

test("gives a hovered field a distinct treatment and keeps the default quiet", async ({
  page,
}) => {
  const company = page.getByLabel("Company", { exact: true });

  const resting = await company.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderTopColor,
    };
  });

  await company.hover();
  await expect
    .poll(() =>
      company.evaluate((element) => getComputedStyle(element).borderTopColor),
    )
    .not.toBe(resting.borderColor);

  const hovered = await company.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderTopColor,
    };
  });

  expect(hovered.backgroundColor).not.toBe(resting.backgroundColor);
});

test("stacks the role fields with full error text on narrow viewports", async ({
  page,
}) => {
  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(50);

    const layout = await page.evaluate(() => {
      const grid = document.querySelector<HTMLElement>(".metadata-fields")!;
      const groups = Array.from(
        grid.querySelectorAll<HTMLElement>(".field-group"),
      ).map((group) => {
        const input = group.querySelector<HTMLInputElement>("input")!;
        const label = group.querySelector<HTMLElement>("label")!;
        const inputBounds = input.getBoundingClientRect();
        const labelBounds = label.getBoundingClientRect();
        return {
          inputLeft: inputBounds.left,
          inputWidth: inputBounds.width,
          labelLeft: labelBounds.left,
          labelBottom: labelBounds.bottom,
          inputTop: inputBounds.top,
          inputRight: inputBounds.right,
        };
      });

      return {
        groups,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });

    expect(
      layout.documentWidth,
      "horizontal overflow at " + width + "px",
    ).toBeLessThanOrEqual(layout.viewportWidth);

    for (const group of layout.groups) {
      // The label stays above the control and the control stays in bounds.
      expect(group.labelBottom).toBeLessThanOrEqual(group.inputTop);
      expect(group.labelLeft).toBe(group.inputLeft);
      expect(group.inputRight).toBeLessThanOrEqual(width);
    }

    if (width <= 700) {
      // One column: every field starts at the same left edge and the rows
      // do not overlap.
      const lefts = new Set(layout.groups.map((group) => group.inputLeft));
      expect(lefts.size).toBe(1);
      const tops = layout.groups.map((group) => group.inputTop);
      expect(new Set(tops).size).toBe(3);
    }
  }
});

test("keeps the full job-link error message visible on a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });

  const jobUrl = page.getByLabel("Job link", { exact: true });
  await jobUrl.fill("not-a-url");
  await page.getByRole("button", { name: "Save draft" }).click();

  const error = page.locator("#job-url-error");
  await expect(error).toBeVisible();

  const metrics = await error.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      left: bounds.left,
      right: bounds.right,
      width: bounds.width,
      height: bounds.height,
      text: element.textContent ?? "",
    };
  });

  expect(metrics.text).toContain("Enter a valid job link.");
  expect(metrics.height).toBeGreaterThan(0);
  expect(metrics.right).toBeLessThanOrEqual(320);
  expect(metrics.left).toBeGreaterThanOrEqual(0);
});
