import type { Page } from "@playwright/test";
import { resolve } from "node:path";

/** Reuse axe-core already locked through eslint-plugin-jsx-a11y. */
export async function auditHome(page: Page) {
  await page.addScriptTag({
    path: resolve("node_modules/axe-core/axe.min.js"),
  });
  return page.evaluate(async () => {
    const axe = (window as typeof window & { axe: typeof import("axe-core") })
      .axe;
    const result = await axe.run(document.querySelector(".app-frame")!, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    });
    return result.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      nodes: nodes.map(({ target, failureSummary }) => ({
        target,
        failureSummary,
      })),
    }));
  });
}
