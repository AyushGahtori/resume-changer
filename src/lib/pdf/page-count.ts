export async function readPdfPageCount(pdf: Uint8Array): Promise<number> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(pdf),
    disableFontFace: true,
    useSystemFonts: false,
  });
  try {
    const document = await task.promise;
    if (!Number.isSafeInteger(document.numPages) || document.numPages < 1)
      throw new Error("The PDF contains no valid pages.");
    return document.numPages;
  } finally {
    await task.destroy();
  }
}
