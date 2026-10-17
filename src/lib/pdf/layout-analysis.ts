export type PdfLayout = {
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
  contentTop: number;
  contentBottom: number;
  usableHeight: number;
  bottomGap: number;
  utilization: number;
  visibleWordCount: number;
  clipped: boolean;
};

export type TextBox = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** PDF coordinates are bottom-left based; measurements use top-left coordinates. */
export function layoutFromTextBoxes(
  boxes: TextBox[],
  width: number,
  height: number,
  pageCount = 1,
): PdfLayout {
  const visible = boxes.filter((box) => box.text.trim());
  if (!visible.length)
    throw new Error(
      "PDF contains no readable text; layout cannot be verified.",
    );
  const margin = 0.45 * 72;
  const horizontalMargin = 0.55 * 72;
  const contentTop = Math.min(
    ...visible.map((box) => height - box.y - box.height),
  );
  const contentBottom = Math.max(
    ...visible.map((box) => height - box.y + box.height * 0.2),
  );
  const usableHeight = height - margin * 2;
  return {
    pageCount,
    pageWidth: width,
    pageHeight: height,
    contentTop,
    contentBottom,
    usableHeight,
    bottomGap: Math.max(0, height - margin - contentBottom),
    utilization: Math.max(
      0,
      Math.min(1, (contentBottom - margin) / usableHeight),
    ),
    visibleWordCount: visible
      .map((box) => box.text)
      .join(" ")
      .split(/\s+/)
      .filter(Boolean).length,
    // Allow 3pt for glyph extents at the approved template margins.
    clipped:
      contentTop < margin - 4 ||
      contentBottom > height - margin + 3 ||
      visible.some(
        (box) =>
          box.x < horizontalMargin - 4 ||
          box.x + box.width > width - horizontalMargin + 4,
      ),
  };
}

export function layoutFromPageTextBoxes(
  boxesByPage: TextBox[][],
  width: number,
  height: number,
): {
  layout: PdfLayout;
  text: string;
  firstPageText: string;
  overflowText: string;
  overflowWordCount: number;
} {
  const firstPage = boxesByPage[0] ?? [];
  const firstPageText = firstPage.map((box) => box.text).join(" ");
  const overflowText = boxesByPage
    .slice(1)
    .flatMap((boxes) => boxes.map((box) => box.text))
    .join(" ");
  return {
    layout: layoutFromTextBoxes(firstPage, width, height, boxesByPage.length),
    text: boxesByPage
      .flatMap((boxes) => boxes.map((box) => box.text))
      .join(" "),
    firstPageText,
    overflowText,
    overflowWordCount: overflowText.split(/\s+/).filter(Boolean).length,
  };
}

export async function analyzePdfLayout(pdf: Uint8Array): Promise<{
  layout: PdfLayout;
  text: string;
  firstPageText: string;
  overflowText: string;
  overflowWordCount: number;
}> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(pdf), useSystemFonts: true });
  const document = await task.promise;
  try {
    const boxesByPage: TextBox[][] = [];
    let firstPageViewport: { width: number; height: number } | undefined;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      boxesByPage.push(
        content.items.flatMap((item) =>
          "str" in item
            ? [
                {
                  text: item.str,
                  x: item.transform[4],
                  y: item.transform[5],
                  width: item.width,
                  height: Math.max(
                    item.height *
                      (content.styles[item.fontName]?.ascent ?? 0.8),
                    1,
                  ),
                },
              ]
            : [],
        ),
      );
      if (pageNumber === 1) {
        firstPageViewport = page.getViewport({ scale: 1 });
      }
      page.cleanup();
    }
    if (!firstPageViewport) throw new Error("PDF contains no first page.");
    return layoutFromPageTextBoxes(
      boxesByPage,
      firstPageViewport.width,
      firstPageViewport.height,
    );
  } finally {
    await task.destroy();
  }
}
