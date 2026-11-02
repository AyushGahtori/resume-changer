import type { ScreenshotResult } from "./contracts";

export async function sha256Hex(
  bytes: Uint8Array,
): Promise<ScreenshotResult<string>> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle)
    return {
      ok: false,
      error: {
        code: "unavailable",
        message: "Secure image hashing is unavailable in this session.",
      },
    };

  try {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const digest = await subtle.digest("SHA-256", copy.buffer);
    return {
      ok: true,
      value: [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""),
    };
  } catch {
    return {
      ok: false,
      error: {
        code: "unavailable",
        message: "Secure image hashing could not complete.",
      },
    };
  }
}

export function encodeBase64(bytes: Uint8Array): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const hasB = index + 1 < bytes.length;
    const hasC = index + 2 < bytes.length;
    const b = hasB ? bytes[index + 1] : 0;
    const c = hasC ? bytes[index + 2] : 0;
    result +=
      alphabet[a >> 2] +
      alphabet[((a & 0x03) << 4) | (b >> 4)] +
      (hasB ? alphabet[((b & 0x0f) << 2) | (c >> 6)] : "=") +
      (hasC ? alphabet[c & 0x3f] : "=");
  }
  return result;
}

export function decodeBase64(value: string): Uint8Array | null {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    return null;
  try {
    const binary = globalThis.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
      bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}
