import {
  SCREENSHOT_LIMITS,
  type ProcessedScreenshot,
  type ScreenshotMediaType,
  type ScreenshotResult,
} from "./contracts";
import { sha256Hex } from "./crypto";
import { sniffImageHeader } from "./formats";

type EncodedImage = {
  mediaType: ScreenshotMediaType;
  width: number;
  height: number;
  blob: Blob;
};

function failure<T>(
  code:
    | "invalid-input"
    | "unsupported-image"
    | "invalid-image"
    | "animated-image"
    | "limit-exceeded"
    | "cancelled"
    | "unavailable",
  message: string,
): ScreenshotResult<T> {
  return { ok: false, error: { code, message } };
}

function abortError(signal: AbortSignal): boolean {
  return signal.aborted;
}

function objectId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `screenshot-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function canvasBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Screenshot encoding failed.")),
      type,
      quality,
    );
  });
}

async function encodeOnMainThread(
  source: Blob,
  originalType: ScreenshotMediaType,
  signal: AbortSignal,
): Promise<EncodedImage> {
  if (typeof createImageBitmap !== "function")
    throw new Error("This browser cannot safely decode screenshots.");
  const bitmap = await createImageBitmap(source, {
    imageOrientation: "from-image",
  });
  let canvas: HTMLCanvasElement | undefined;
  try {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const pixelCount = bitmap.width * bitmap.height;
    if (
      pixelCount > SCREENSHOT_LIMITS.maxPixelsPerImage ||
      bitmap.width < 1 ||
      bitmap.height < 1
    )
      throw Object.assign(
        new Error("The decoded screenshot exceeds the pixel limit."),
        {
          code: "limit-exceeded",
        },
      );

    const maxSide = Math.max(bitmap.width, bitmap.height);
    const dimensionPairs = [1280, 1024, 800, 640, 512]
      .map((limit) => Math.min(1, limit / maxSide))
      .map(
        (scale) =>
          [
            Math.max(1, Math.round(bitmap.width * scale)),
            Math.max(1, Math.round(bitmap.height * scale)),
          ] as const,
      )
      .filter(
        (pair, index, all) =>
          all.findIndex(
            ([width, height]) => width === pair[0] && height === pair[1],
          ) === index,
      );
    const preferredType = "image/webp";
    let encoded: Blob | undefined;
    let encodedWidth = 0;
    let encodedHeight = 0;
    let encodedType: ScreenshotMediaType = "image/webp";

    canvas = document.createElement("canvas");
    for (const [width, height] of dimensionPairs) {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("Screenshot processing is unavailable.");
      context.clearRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);

      for (const quality of [0.9, 0.82, 0.74]) {
        if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
        const candidate = await canvasBlob(canvas, preferredType, quality);
        if (
          candidate.type === preferredType &&
          candidate.size <= SCREENSHOT_LIMITS.targetBytesPerImage
        ) {
          encoded = candidate;
          encodedWidth = width;
          encodedHeight = height;
          encodedType = "image/webp";
          break;
        }
      }
      if (!encoded) {
        const fallbackType =
          originalType === "image/png" ? "image/png" : originalType;
        for (const quality of [0.9, 0.82, 0.74]) {
          if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
          const candidate = await canvasBlob(canvas, fallbackType, quality);
          if (
            candidate.type === fallbackType &&
            candidate.size <= SCREENSHOT_LIMITS.targetBytesPerImage
          ) {
            encoded = candidate;
            encodedWidth = width;
            encodedHeight = height;
            encodedType = fallbackType;
            break;
          }
        }
      }
      if (encoded) break;
    }
    if (!encoded)
      throw Object.assign(
        new Error(
          "This image remains above 200 KiB after safe resizing. Remove it or choose a smaller crop to preserve readable labels.",
        ),
        { code: "limit-exceeded" },
      );
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    return {
      mediaType: encodedType,
      width: encodedWidth,
      height: encodedHeight,
      blob: encoded,
    };
  } finally {
    bitmap.close();
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
  }
}

async function encodeInWorker(
  bytes: ArrayBuffer,
  signal: AbortSignal,
): Promise<EncodedImage> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./compression.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      reject(new Error("Screenshot worker is unavailable."));
      return;
    }
    const id = objectId();
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      worker.terminate();
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    worker.onerror = () => {
      cleanup();
      reject(new Error("Screenshot worker failed."));
    };
    worker.onmessage = (event: MessageEvent) => {
      const result = event.data as
        | {
            id: string;
            ok: true;
            mediaType: ScreenshotMediaType;
            width: number;
            height: number;
            bytes: ArrayBuffer;
          }
        | { id: string; ok: false; code: string; message: string };
      if (result.id !== id) return;
      cleanup();
      if (!result.ok) {
        reject(Object.assign(new Error(result.message), { code: result.code }));
        return;
      }
      resolve({
        mediaType: result.mediaType,
        width: result.width,
        height: result.height,
        blob: new Blob([result.bytes], { type: result.mediaType }),
      });
    };
    const transferableCopy = bytes.slice(0);
    worker.postMessage({ id, bytes: transferableCopy }, [transferableCopy]);
  });
}

function errorCode(
  error: unknown,
):
  | "invalid-image"
  | "animated-image"
  | "limit-exceeded"
  | "cancelled"
  | "unavailable" {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (
      code === "animated-image" ||
      code === "limit-exceeded" ||
      code === "cancelled"
    )
      return code;
  }
  return error instanceof DOMException && error.name === "AbortError"
    ? "cancelled"
    : "invalid-image";
}

/** Decode, strip metadata by re-encoding, downscale without upscaling, and hash. */
export async function processScreenshotFile(
  file: File,
  signal: AbortSignal,
): Promise<ScreenshotResult<ProcessedScreenshot>> {
  if (!(file instanceof Blob) || file.size < 1)
    return failure("invalid-input", "Choose a non-empty image file.");
  if (file.size > SCREENSHOT_LIMITS.maxInputBytesPerImage)
    return failure(
      "limit-exceeded",
      "Each original screenshot must be 8 MiB or smaller.",
    );

  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    return failure(
      "invalid-image",
      "The selected screenshot could not be read.",
    );
  }
  if (signal.aborted)
    return failure("cancelled", "Screenshot processing was cancelled.");

  let header;
  try {
    header = sniffImageHeader(new Uint8Array(bytes));
  } catch {
    return failure(
      "unsupported-image",
      "Choose a valid JPEG, PNG, or WebP image. SVG and animated images are not accepted.",
    );
  }
  if (file.type && file.type !== header.mediaType)
    return failure(
      "unsupported-image",
      "The file type does not match its image data. Choose a JPEG, PNG, or WebP screenshot.",
    );
  if (header.animated)
    return failure("animated-image", "Animated screenshots are not accepted.");
  if (header.width * header.height > SCREENSHOT_LIMITS.maxPixelsPerImage)
    return failure(
      "limit-exceeded",
      "Each screenshot must be 16 megapixels or smaller.",
    );

  let encoded: EncodedImage;
  const workerAvailable =
    typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof createImageBitmap === "function";
  try {
    encoded = workerAvailable
      ? await encodeInWorker(bytes, signal)
      : await encodeOnMainThread(
          new Blob([bytes], { type: header.mediaType }),
          header.mediaType,
          signal,
        );
  } catch (error) {
    if (signal.aborted || errorCode(error) === "cancelled")
      return failure("cancelled", "Screenshot processing was cancelled.");
    if (workerAvailable && errorCode(error) === "invalid-image") {
      try {
        encoded = await encodeOnMainThread(
          new Blob([bytes], { type: header.mediaType }),
          header.mediaType,
          signal,
        );
      } catch (fallbackError) {
        const code = errorCode(fallbackError);
        return failure(
          code,
          fallbackError instanceof Error
            ? fallbackError.message
            : "The screenshot could not be processed.",
        );
      }
    } else {
      const code = errorCode(error);
      return failure(
        code,
        error instanceof Error
          ? error.message
          : "The screenshot could not be processed.",
      );
    }
  }

  if (
    signal.aborted ||
    encoded.blob.size > SCREENSHOT_LIMITS.targetBytesPerImage ||
    encoded.width > SCREENSHOT_LIMITS.maxDimension ||
    encoded.height > SCREENSHOT_LIMITS.maxDimension
  )
    return failure(
      signal.aborted ? "cancelled" : "limit-exceeded",
      signal.aborted
        ? "Screenshot processing was cancelled."
        : "The processed screenshot exceeds its size or dimension limit.",
    );

  const processedBytes = new Uint8Array(await encoded.blob.arrayBuffer());
  const digest = await sha256Hex(processedBytes);
  if (!digest.ok) return digest;
  const extension = encoded.mediaType.split("/")[1].replace("jpeg", "jpg");
  return {
    ok: true,
    value: {
      id: objectId(),
      fileName: `screenshot.${extension}`,
      mediaType: encoded.mediaType,
      width: encoded.width,
      height: encoded.height,
      byteLength: processedBytes.byteLength,
      sha256: digest.value,
      blob: encoded.blob,
    },
  };
}
