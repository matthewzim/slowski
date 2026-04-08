/**
 * Yaz0 decompression.
 * Standard Nintendo LZ77 variant used across GameCube/Wii titles.
 *
 * Header (16 bytes):
 *   magic:    4 bytes  'Yaz0'
 *   decSize:  4 bytes  decompressed size
 *   padding:  8 bytes  (unused)
 *
 * Body: code-byte driven literal/back-reference stream.
 */
import { BinaryReader } from './reader.js';

/**
 * Decompress a Yaz0-compressed ArrayBuffer.
 * @param {ArrayBuffer} buffer
 * @returns {ArrayBuffer} decompressed data
 */
export function decompressYaz0(buffer) {
  const reader = new BinaryReader(buffer);

  // Verify magic
  const magic = reader.readString(4);
  if (magic !== 'Yaz0') {
    throw new Error(`Not a Yaz0 file (magic: ${magic})`);
  }

  const decompressedSize = reader.readU32();
  reader.skip(8); // padding

  const src = new Uint8Array(buffer);
  const dst = new Uint8Array(decompressedSize);
  let srcPos = 16; // past header
  let dstPos = 0;
  let codeByte = 0;
  let codeCount = 0;

  while (dstPos < decompressedSize) {
    // Read next code byte when we've used all 8 bits
    if (codeCount === 0) {
      codeByte = src[srcPos++];
      codeCount = 8;
    }

    if (codeByte & 0x80) {
      // Bit = 1: literal byte copy
      dst[dstPos++] = src[srcPos++];
    } else {
      // Bit = 0: back-reference
      const b1 = src[srcPos++];
      const b2 = src[srcPos++];

      const dist = ((b1 & 0x0F) << 8) | b2;
      const copyPos = dstPos - dist - 1;

      let count;
      if ((b1 >> 4) === 0) {
        // Three-byte encoding: count in next byte + 0x12
        count = src[srcPos++] + 0x12;
      } else {
        // Two-byte encoding: count = upper nibble + 2
        count = (b1 >> 4) + 2;
      }

      for (let i = 0; i < count; i++) {
        dst[dstPos++] = dst[copyPos + i];
      }
    }

    codeByte <<= 1;
    codeCount--;
  }

  return dst.buffer;
}
