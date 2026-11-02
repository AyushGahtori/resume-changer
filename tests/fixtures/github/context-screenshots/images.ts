import { deflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength);
  const crcInput = Buffer.concat([typeBytes, Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([length, typeBytes, Buffer.from(data), crc]);
}

export function pngFixture(
  options: {
    width?: number;
    height?: number;
    animated?: boolean;
    paddingBytes?: number;
  } = {},
): Uint8Array {
  const width = options.width ?? 32;
  const height = options.height ?? 16;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const row = Buffer.alloc(Math.max(1, width * 4) + 1);
  for (let index = 1; index < row.length; index += 4) {
    row[index] = 40;
    row[index + 1] = 90;
    row[index + 2] = 180;
    row[index + 3] = 255;
  }
  const raw = Buffer.concat(
    Array.from({ length: Math.min(height, 128) }, () => row),
  );
  const chunks = [chunk("IHDR", ihdr)];
  if (options.animated) {
    const animation = Buffer.alloc(8);
    animation.writeUInt32BE(1, 0);
    chunks.push(chunk("acTL", animation));
  }
  if (options.paddingBytes) {
    const text = Buffer.concat([
      Buffer.from("Synthetic\0", "ascii"),
      Buffer.alloc(Math.max(0, options.paddingBytes)),
    ]);
    chunks.push(chunk("tEXt", text));
  }
  chunks.push(chunk("IDAT", deflateSync(raw)));
  chunks.push(chunk("IEND", Buffer.alloc(0)));
  return new Uint8Array(Buffer.concat([SIGNATURE, ...chunks]));
}
