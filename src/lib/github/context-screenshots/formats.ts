import {
  SCREENSHOT_MEDIA_TYPES,
  type DecodedImageMetadata,
  type ScreenshotMediaType,
} from "./contracts";

export type ImageHeader = DecodedImageMetadata;

function invalid(): never {
  throw new Error("Image bytes are invalid or unsupported.");
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function u32le(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] +
    (bytes[offset + 1] << 8) +
    (bytes[offset + 2] << 16) +
    bytes[offset + 3] * 0x1000000
  );
}

function pngHeader(bytes: Uint8Array): ImageHeader {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.length < 33 ||
    signature.some((byte, index) => bytes[index] !== byte) ||
    u32be(bytes, 8) !== 13 ||
    ascii(bytes, 12, 4) !== "IHDR"
  )
    return invalid();

  const width = u32be(bytes, 16);
  const height = u32be(bytes, 20);
  if (!width || !height) return invalid();

  let offset = 8;
  let animated = false;
  let sawEnd = false;
  let chunks = 0;
  while (offset + 12 <= bytes.length && chunks < 100_000) {
    const length = u32be(bytes, offset);
    const end = offset + 12 + length;
    if (end > bytes.length) return invalid();
    const type = ascii(bytes, offset + 4, 4);
    if (type === "acTL" || type === "fcTL" || type === "fdAT") animated = true;
    if (type === "IEND") {
      if (length !== 0 || end !== bytes.length) return invalid();
      sawEnd = true;
      break;
    }
    offset = end;
    chunks += 1;
  }
  if (!sawEnd) return invalid();
  return { mediaType: "image/png", width, height, animated };
}

function webpHeader(bytes: Uint8Array): ImageHeader {
  if (
    bytes.length < 30 ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 4) !== "WEBP" ||
    u32le(bytes, 4) + 8 !== bytes.length
  )
    return invalid();

  let offset = 12;
  let width = 0;
  let height = 0;
  let animated = false;
  let chunks = 0;
  while (offset + 8 <= bytes.length && chunks < 100_000) {
    const type = ascii(bytes, offset, 4);
    const length = u32le(bytes, offset + 4);
    const data = offset + 8;
    const end = data + length + (length % 2);
    if (end > bytes.length) return invalid();

    if (type === "ANIM" || type === "ANMF") animated = true;
    if (type === "VP8X") {
      if (length < 10) return invalid();
      animated ||= (bytes[data] & 0x02) !== 0;
      width =
        1 + bytes[data + 4] + (bytes[data + 5] << 8) + (bytes[data + 6] << 16);
      height =
        1 + bytes[data + 7] + (bytes[data + 8] << 8) + (bytes[data + 9] << 16);
    } else if (type === "VP8 ") {
      if (length < 10) return invalid();
      if (
        bytes[data + 3] === 0x9d &&
        bytes[data + 4] === 0x01 &&
        bytes[data + 5] === 0x2a
      ) {
        width = (bytes[data + 6] | (bytes[data + 7] << 8)) & 0x3fff;
        height = (bytes[data + 8] | (bytes[data + 9] << 8)) & 0x3fff;
      }
    } else if (type === "VP8L") {
      if (length < 5 || bytes[data] !== 0x2f) return invalid();
      width = 1 + bytes[data + 1] + ((bytes[data + 2] & 0x3f) << 8);
      height =
        1 +
        (bytes[data + 2] >> 6) +
        (bytes[data + 3] << 2) +
        ((bytes[data + 4] & 0x0f) << 10);
    }

    offset = end;
    chunks += 1;
  }
  if (offset !== bytes.length || !width || !height) return invalid();
  return { mediaType: "image/webp", width, height, animated };
}

function jpegHeader(bytes: Uint8Array): ImageHeader {
  if (
    bytes.length < 12 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff ||
    bytes[bytes.length - 1] !== 0xd9
  )
    return invalid();

  const startOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);
  let offset = 2;
  let width = 0;
  let height = 0;
  let markers = 0;
  while (offset < bytes.length - 2 && markers < 100_000) {
    if (bytes[offset] !== 0xff) return invalid();
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      markers += 1;
      continue;
    }
    if (offset + 2 > bytes.length) return invalid();
    const length = (bytes[offset] << 8) + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return invalid();
    if (startOfFrame.has(marker)) {
      if (length < 7) return invalid();
      height = (bytes[offset + 3] << 8) + bytes[offset + 4];
      width = (bytes[offset + 5] << 8) + bytes[offset + 6];
    }
    offset += length;
    markers += 1;
  }
  if (!width || !height) return invalid();
  return { mediaType: "image/jpeg", width, height, animated: false };
}

export function sniffImageHeader(bytes: Uint8Array): ImageHeader {
  if (bytes.length >= 8 && bytes[0] === 137 && ascii(bytes, 1, 3) === "PNG")
    return pngHeader(bytes);
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF")
    return webpHeader(bytes);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8)
    return jpegHeader(bytes);
  return invalid();
}

export function isScreenshotMediaType(
  value: unknown,
): value is ScreenshotMediaType {
  return (
    typeof value === "string" &&
    SCREENSHOT_MEDIA_TYPES.includes(value as ScreenshotMediaType)
  );
}

export function assertImageDimensions(width: number, height: number): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  )
    throw new Error("Image dimensions are invalid.");
}

export function isSupportedImageType(
  value: unknown,
): value is ScreenshotMediaType {
  return isScreenshotMediaType(value);
}
