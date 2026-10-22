import { expect, test, type Page } from "@playwright/test";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Task 25 "Keep source and provenance visible and inspectable".
 *
 * The provenance line is the audit trail of an achievement card: it says
 * where the point came from, it must not invent a location, and it must not
 * leak a path from the local workspace.
 */

const libraryRoot =
  process.env.RESUME_LIBRARY_ROOT ??
  join(tmpdir(), "resume-changer-playwright-data-3010");
const personalLibraryPath = join(libraryRoot, "data", "resume-library.json");
const sampleLibraryPath = join(
  process.cwd(),
  "examples",
  "sample-resume-library.json",
);

const LONG_REFERENCE =
  "Section 4.2 of the platform reliability review, covering the migration " +
  "from the legacy scheduler to the queue-backed orchestrator, with the " +
  "incident timeline and the post-incident actions";

const PUNCTUATED_LABEL = "Quarterly plan, 2nd edition (rev. 3)";
const PUNCTUATED_REFERENCE = "Page 1, Bullet 1 — “quoted” & annotated";

/**
 * One point per source type, and one point per combination of the optional
 * label and reference.
 */
const SOURCES: Record<
  string,
  { type: string; label?: string; reference?: string }
> = {
  "achievement-service-capacity-design": {
    type: "resume",
    label: "Ayush resume PDF",
    reference: "Page 1, Bullet 1",
  },
  "achievement-cloud-deployment-platform": { type: "linkedin" },
  "achievement-ci-cd-pipeline": { type: "user-notes", label: "Weekly notes" },
  "achievement-service-observability": {
    type: "project-document",
    reference: "Section 3",
  },
  "achievement-orders-api": { type: "direct-user" },
  "achievement-accessible-admin-ui": {
    type: "resume",
    label: "Ayush resume PDF",
    reference: LONG_REFERENCE,
  },
  "achievement-release-check-automation": {
    type: "resume",
    label: PUNCTUATED_LABEL,
    reference: PUNCTUATED_REFERENCE,
  },
};

async function writeLibraryWithSources() {
  await copyFile(sampleLibraryPath, personalLibraryPath);
  const library = JSON.parse(await readFile(sampleLibraryPath, "utf8"));
  for (const job of library.jobs) {
    for (const point of job.points) {
      const source = SOURCES[point.id];
      if (source) {
        point.source = source;
      }
    }
  }
  await writeFile(personalLibraryPath, JSON.stringify(library, null, 2));
}

function pointCard(page: Page, pointId: string) {
  return page.locator(".library-point").filter({ hasText: pointId });
}

function relativeLuminance(color: string) {
  const channels = color
    .match(/\d+(\.\d+)?/g)
    ?.slice(0, 3)
    .map(Number);
  if (!channels || channels.length < 3) {
    throw new Error(`Unsupported color value: ${color}`);
  }
  const linear = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground: string, background: string) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

test.beforeEach(async ({ page }) => {
  await writeLibraryWithSources();
  await page.goto("/library");
});

test("shows the source type, label, and reference for every source type", async ({
  page,
}) => {
  const expectations = [
    {
      pointId: "achievement-service-capacity-design",
      text: "Source: resume · Ayush resume PDF · Page 1, Bullet 1",
    },
    {
      pointId: "achievement-cloud-deployment-platform",
      text: "Source: linkedin",
    },
    {
      pointId: "achievement-ci-cd-pipeline",
      text: "Source: user-notes · Weekly notes",
    },
    {
      pointId: "achievement-service-observability",
      text: "Source: project-document · Section 3",
    },
    {
      pointId: "achievement-orders-api",
      text: "Source: direct-user",
    },
  ];

  for (const { pointId, text } of expectations) {
    await expect(
      pointCard(page, pointId).locator(".point-provenance"),
    ).toHaveText(text);
  }
});

test("omits the optional segments the library does not have", async ({
  page,
}) => {
  const typeOnly = await pointCard(page, "achievement-orders-api")
    .locator(".point-provenance")
    .innerText();
  expect(typeOnly).toBe("Source: direct-user");
  expect(typeOnly).not.toContain("·");
  expect(typeOnly).not.toMatch(/page|bullet|line|section/i);

  const labelOnly = await pointCard(page, "achievement-ci-cd-pipeline")
    .locator(".point-provenance")
    .innerText();
  expect(labelOnly).toBe("Source: user-notes · Weekly notes");
  expect(labelOnly.split("·")).toHaveLength(2);
  expect(labelOnly.trim().endsWith("·")).toBe(false);

  const referenceOnly = await pointCard(
    page,
    "achievement-service-observability",
  )
    .locator(".point-provenance")
    .innerText();
  expect(referenceOnly).toBe("Source: project-document · Section 3");
  expect(referenceOnly.split("·")).toHaveLength(2);
});

test("keeps the provenance visible without a hover or a disclosure", async ({
  page,
}) => {
  const provenance = pointCard(page, "achievement-orders-api").locator(
    ".point-provenance",
  );
  await expect(provenance).toBeVisible();

  const state = await provenance.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      opacity: style.opacity,
      visibility: style.visibility,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
      insideDetails: Boolean(element.closest("details")),
      ariaExpanded: element.getAttribute("aria-expanded"),
    };
  });
  expect(state.opacity).toBe("1");
  expect(state.visibility).toBe("visible");
  expect(state.textOverflow).not.toBe("ellipsis");
  expect(state.whiteSpace).not.toBe("nowrap");
  expect(state.insideDetails).toBe(false);
  expect(state.ariaExpanded).toBeNull();
});

test("places the provenance after the metrics and the tag row", async ({
  page,
}) => {
  const card = pointCard(page, "achievement-service-capacity-design");
  const order = await card.evaluate((element) => {
    const provenance = element.querySelector(".point-provenance")!;
    const metrics = element.querySelector(".point-metrics");
    const facets = element.querySelector(".point-facets");
    return {
      afterMetrics: metrics
        ? Boolean(
            metrics.compareDocumentPosition(provenance) &
            Node.DOCUMENT_POSITION_FOLLOWING,
          )
        : true,
      afterFacets: facets
        ? Boolean(
            facets.compareDocumentPosition(provenance) &
            Node.DOCUMENT_POSITION_FOLLOWING,
          )
        : true,
    };
  });
  expect(order.afterMetrics).toBe(true);
  expect(order.afterFacets).toBe(true);

  const boxes = await card.evaluate((element) => {
    const provenance = element
      .querySelector(".point-provenance")!
      .getBoundingClientRect();
    const facets = element
      .querySelector(".point-facets")!
      .getBoundingClientRect();
    return { provenanceTop: provenance.top, facetsBottom: facets.bottom };
  });
  expect(boxes.provenanceTop).toBeGreaterThanOrEqual(boxes.facetsBottom);
});

test("keeps the source type distinguishable from the prefix by weight", async ({
  page,
}) => {
  const weights = await pointCard(page, "achievement-service-capacity-design")
    .locator(".point-provenance")
    .evaluate((element) => {
      const prefix = element.querySelector(".point-provenance-prefix")!;
      const type = element.querySelector(".point-provenance-type")!;
      return {
        prefix: Number(getComputedStyle(prefix).fontWeight),
        type: Number(getComputedStyle(type).fontWeight),
        prefixText: prefix.textContent,
        typeText: type.textContent,
      };
    });

  expect(weights.prefixText).toBe("Source:");
  expect(weights.typeText).toBe("resume");
  expect(weights.type).toBeGreaterThan(weights.prefix);
});

test("keeps the provenance readable in both themes", async ({ page }) => {
  const card = pointCard(page, "achievement-service-capacity-design");

  const readColors = () =>
    card.locator(".point-provenance").evaluate((element) => {
      const prefix = element.querySelector(".point-provenance-prefix")!;
      const type = element.querySelector(".point-provenance-type")!;
      const background = (node: Element): string => {
        let current: Element | null = node;
        while (current) {
          const color = getComputedStyle(current).backgroundColor;
          const alpha = color.match(/rgba?\([^)]*,\s*([\d.]+)\)/);
          const opaque =
            color !== "transparent" &&
            color !== "rgba(0, 0, 0, 0)" &&
            (!alpha || Number(alpha[1]) > 0);
          if (opaque) {
            return color;
          }
          current = current.parentElement;
        }
        return getComputedStyle(document.body).backgroundColor;
      };
      return {
        prefix: getComputedStyle(prefix).color,
        type: getComputedStyle(type).color,
        background: background(element),
        fontSize: parseFloat(getComputedStyle(element).fontSize),
        lineHeight: parseFloat(getComputedStyle(element).lineHeight),
      };
    });

  const light = await readColors();
  expect(contrastRatio(light.prefix, light.background)).toBeGreaterThanOrEqual(
    4.5,
  );
  expect(contrastRatio(light.type, light.background)).toBeGreaterThanOrEqual(
    4.5,
  );
  expect(light.fontSize).toBeGreaterThanOrEqual(11);
  expect(light.fontSize).toBeLessThanOrEqual(12);
  expect(light.lineHeight).toBeGreaterThanOrEqual(16);

  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  /**
   * The theme switch animates the surfaces and the text, so the colors are
   * only final once the transition has settled. Polling for the contrast
   * waits for that, and still fails when the resting contrast is too low.
   */
  const darkContrast = async () => {
    const colors = await readColors();
    return Math.min(
      contrastRatio(colors.prefix, colors.background),
      contrastRatio(colors.type, colors.background),
    );
  };
  await expect
    .poll(darkContrast, {
      timeout: 5000,
      message: "the provenance text should settle on a readable contrast",
    })
    .toBeGreaterThanOrEqual(4.5);
});

test("wraps a long reference instead of cutting the audit trail short", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.reload();

  const provenance = pointCard(page, "achievement-accessible-admin-ui").locator(
    ".point-provenance",
  );
  await expect(provenance).toContainText(LONG_REFERENCE);

  const metrics = await provenance.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      height: element.getBoundingClientRect().height,
      lineHeight: parseFloat(style.lineHeight),
      textOverflow: style.textOverflow,
      overflowWrap: style.overflowWrap,
    };
  });
  // A wrapped reference needs more than a single line.
  expect(metrics.height).toBeGreaterThan(metrics.lineHeight);
  expect(metrics.textOverflow).not.toBe("ellipsis");

  const widths = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(widths.documentWidth).toBeLessThanOrEqual(widths.viewportWidth);
});

test("keeps the punctuation and the content of the source as written", async ({
  page,
}) => {
  const provenance = pointCard(
    page,
    "achievement-release-check-automation",
  ).locator(".point-provenance");
  await expect(provenance).toHaveText(
    `Source: resume · ${PUNCTUATED_LABEL} · ${PUNCTUATED_REFERENCE}`,
  );
  await expect(provenance).toContainText(PUNCTUATED_LABEL);
  await expect(provenance).toContainText(PUNCTUATED_REFERENCE);
});

test("does not expose a local file path in the provenance", async ({
  page,
}) => {
  const texts = await page.locator(".point-provenance").allTextContents();
  expect(texts.length).toBeGreaterThan(0);

  for (const text of texts) {
    expect(text).not.toContain(libraryRoot);
    expect(text).not.toMatch(/[A-Za-z]:[\\/]/);
    expect(text).not.toMatch(/(^|\s)(\/|~)\//);
    expect(text).not.toContain("resume-library.json");
  }
});
