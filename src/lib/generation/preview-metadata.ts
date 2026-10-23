/**
 * The facts the preview can state about a compiled PDF.
 *
 * Every value comes from a real response: the page count from the compile
 * response headers, and the page fill from the layout analysis of the
 * compiled document. A value the response does not provide is omitted from
 * the sentence rather than replaced with an estimate.
 */

export function formatPageCount(pages: number | null | undefined) {
  if (typeof pages !== "number" || !Number.isInteger(pages) || pages < 1)
    return "";
  return pages === 1 ? "1 page" : `${pages} pages`;
}

/**
 * The page count reported by the compile response, or null when the response
 * did not report a usable one.
 */
export function readPageCount(header: string | null | undefined) {
  if (!header) return null;
  const pages = Number(header);
  return Number.isInteger(pages) && pages > 0 ? pages : null;
}

export function formatPageFill(utilization: number | null | undefined) {
  if (typeof utilization !== "number" || !Number.isFinite(utilization))
    return "";
  const percent = Math.round(Math.min(1, Math.max(0, utilization)) * 100);
  if (percent <= 0) return "";
  return `${percent}% page fill`;
}

/**
 * The status sentence for a compiled PDF. It names the page count and the page
 * fill only when the real response supplied them.
 */
export function describeCompiledPdf(input: {
  pageCount?: number | null;
  utilization?: number | null;
}) {
  const parts = ["PDF ready"];
  const pages = formatPageCount(input.pageCount);
  if (pages) parts.push(pages);
  const fill = formatPageFill(input.utilization);
  if (fill) parts.push(fill);
  return `${parts.join(" · ")}.`;
}
