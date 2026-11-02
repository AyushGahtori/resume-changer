import { SCREENSHOT_LIMITS, type ScreenshotMediaType } from "./contracts";
import { sniffImageHeader } from "./formats";

type WorkerRequest = {
  id: string;
  bytes: ArrayBuffer;
};

type WorkerResponse =
  | {
      id: string;
      ok: true;
      mediaType: ScreenshotMediaType;
      width: number;
      height: number;
      bytes: ArrayBuffer;
    }
  | { id: string; ok: false; message: string; code: string };

type WorkerScope = {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<WorkerRequest>) => void,
  ): void;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
};

const worker = globalThis as unknown as WorkerScope;

worker.addEventListener("message", async (event) => {
  const { id, bytes: buffer } = event.data;
  let bitmap: ImageBitmap | undefined;
  try {
    const bytes = new Uint8Array(buffer);
    const header = sniffImageHeader(bytes);
    if (header.animated)
      throw Object.assign(new Error("Animated screenshots are not accepted."), {
        code: "animated-image",
      });
    if (header.width * header.height > SCREENSHOT_LIMITS.maxPixelsPerImage)
      throw Object.assign(
        new Error("The screenshot exceeds the pixel limit."),
        {
          code: "limit-exceeded",
        },
      );
    bitmap = await createImageBitmap(
      new Blob([bytes], { type: header.mediaType }),
      { imageOrientation: "from-image" },
    );
    if (bitmap.width * bitmap.height > SCREENSHOT_LIMITS.maxPixelsPerImage)
      throw Object.assign(
        new Error("The decoded screenshot exceeds the pixel limit."),
        {
          code: "limit-exceeded",
        },
      );

    const target = Math.min(
      1,
      SCREENSHOT_LIMITS.maxDimension / Math.max(bitmap.width, bitmap.height),
    );
    const firstWidth = Math.max(1, Math.round(bitmap.width * target));
    const firstHeight = Math.max(1, Math.round(bitmap.height * target));
    const dimensionPairs = [
      [firstWidth, firstHeight],
      [
        Math.max(
          1,
          Math.round(
            bitmap.width *
              Math.min(target, 1024 / Math.max(bitmap.width, bitmap.height)),
          ),
        ),
        Math.max(
          1,
          Math.round(
            bitmap.height *
              Math.min(target, 1024 / Math.max(bitmap.width, bitmap.height)),
          ),
        ),
      ],
      [
        Math.max(
          1,
          Math.round(
            bitmap.width *
              Math.min(target, 800 / Math.max(bitmap.width, bitmap.height)),
          ),
        ),
        Math.max(
          1,
          Math.round(
            bitmap.height *
              Math.min(target, 800 / Math.max(bitmap.width, bitmap.height)),
          ),
        ),
      ],
      [
        Math.max(
          1,
          Math.round(
            bitmap.width *
              Math.min(target, 640 / Math.max(bitmap.width, bitmap.height)),
          ),
        ),
        Math.max(
          1,
          Math.round(
            bitmap.height *
              Math.min(target, 640 / Math.max(bitmap.width, bitmap.height)),
          ),
        ),
      ],
      [
        Math.max(
          1,
          Math.round(
            bitmap.width *
              Math.min(target, 512 / Math.max(bitmap.width, bitmap.height)),
          ),
        ),
        Math.max(
          1,
          Math.round(
            bitmap.height *
              Math.min(target, 512 / Math.max(bitmap.width, bitmap.height)),
          ),
        ),
      ],
    ].filter(
      (pair, index, all) =>
        all.findIndex(
          ([width, height]) => width === pair[0] && height === pair[1],
        ) === index,
    );
    const canvasType = "image/webp";
    let output: Blob | undefined;
    let outputWidth = firstWidth;
    let outputHeight = firstHeight;
    for (const [width, height] of dimensionPairs) {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("Screenshot processing is unavailable.");
      context.drawImage(bitmap, 0, 0, width, height);
      for (const quality of [0.9, 0.82, 0.74]) {
        const candidate = await canvas.convertToBlob({
          type: canvasType,
          quality,
        });
        if (
          candidate.type === canvasType &&
          candidate.size <= SCREENSHOT_LIMITS.targetBytesPerImage
        ) {
          output = candidate;
          outputWidth = width;
          outputHeight = height;
          break;
        }
      }
      if (!output) {
        const fallbackType =
          header.mediaType === "image/png" ? "image/png" : header.mediaType;
        for (const quality of [0.9, 0.82, 0.74]) {
          const candidate = await canvas.convertToBlob({
            type: fallbackType,
            quality,
          });
          if (
            candidate.type === fallbackType &&
            candidate.size <= SCREENSHOT_LIMITS.targetBytesPerImage
          ) {
            output = candidate;
            outputWidth = width;
            outputHeight = height;
            break;
          }
        }
      }
      canvas.width = 1;
      canvas.height = 1;
      if (output) break;
    }
    if (!output)
      throw Object.assign(
        new Error(
          "This image could not be compressed to 200 KiB without a smaller crop. Remove it or choose a smaller image.",
        ),
        { code: "limit-exceeded" },
      );

    const outputBytes = await output.arrayBuffer();
    worker.postMessage(
      {
        id,
        ok: true,
        mediaType: output.type as ScreenshotMediaType,
        width: outputWidth,
        height: outputHeight,
        bytes: outputBytes,
      } satisfies WorkerResponse,
      [outputBytes],
    );
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : "invalid-image";
    const message =
      error instanceof Error
        ? error.message
        : "The screenshot could not be processed.";
    worker.postMessage({ id, ok: false, code, message });
  } finally {
    bitmap?.close();
  }
});
