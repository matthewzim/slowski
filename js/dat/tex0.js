/**
 * TEX0 texture parser (inside BRRES).
 *
 * Header:
 *   magic:      4 bytes  (within BRRES sub-file, may not have own magic)
 *   size:       4 bytes
 *   version:    4 bytes
 *   brresOff:   4 bytes  (offset back to BRRES)
 *   ... sections
 *
 * TEX0-specific header (after generic BRRES sub-file header):
 *   dataOffset: 4 bytes  (0x10 at offset 0x00 relative to TEX0 start)
 *   ... or:
 *   At offset 0x00: length
 *   At offset 0x04: padding/version
 *   At offset 0x08: reserved
 *   At offset 0x0C: stringOffset
 *   At offset 0x10: hasAlpha
 *   At offset 0x14: width
 *   At offset 0x16: height
 *   At offset 0x18: format
 *   At offset 0x1C: numImages (mip levels)
 *   At offset 0x20: minLOD
 *   At offset 0x24: maxLOD
 *   At offset 0x28: reserved2
 *   At offset 0x2C: headerSize
 *   Image data follows at offset = headerSize (usually 0x40)
 */
import { BinaryReader } from './reader.js';
import { decodeTexture, GXTexFmt } from './gx-texture.js';

/**
 * @typedef {Object} ParsedTexture
 * @property {string} name
 * @property {number} width
 * @property {number} height
 * @property {number} format
 * @property {Uint8Array} pixels - RGBA8 pixel data
 */

/**
 * Parse a TEX0 resource.
 * @param {ArrayBuffer} buffer - TEX0 data
 * @param {string} [name='texture'] - resource name
 * @returns {ParsedTexture}
 */
export function parseTEX0(buffer, name = 'texture') {
  const reader = new BinaryReader(buffer);

  // TEX0 header
  const length = reader.readU32();
  const version = reader.readU32();
  const brresOffset = reader.readI32();
  const stringOffset = reader.readI32();
  const hasAlpha = reader.readU32();
  const width = reader.readU16();
  const height = reader.readU16();
  const format = reader.readU32();
  const numImages = reader.readU32(); // mip levels
  const minLOD = reader.readF32();
  const maxLOD = reader.readF32();
  reader.skip(4); // reserved

  // Image data typically starts at 0x40
  const headerSize = reader.tell();
  const dataOffset = Math.max(headerSize, 0x40);
  reader.seek(dataOffset);

  const dataSize = buffer.byteLength - dataOffset;
  const data = new Uint8Array(buffer, dataOffset, dataSize);

  // Decode the texture pixels
  const pixels = decodeTexture(data, width, height, format);

  return { name, width, height, format, pixels };
}

/**
 * Parse a standalone TPL texture file.
 * TPL Header:
 *   magic:     4 bytes  0x0020AF30
 *   numImages: 4 bytes
 *   imgTableOff: 4 bytes (usually 0x0C)
 *
 * Image table entry (8 bytes each):
 *   imageOffset:   4 bytes
 *   paletteOffset: 4 bytes (0 = no palette)
 *
 * Image header (at imageOffset):
 *   height:    2 bytes
 *   width:     2 bytes
 *   format:    4 bytes
 *   dataOff:   4 bytes (absolute offset to pixel data)
 *   wrapS:     4 bytes
 *   wrapT:     4 bytes
 *   minFilter: 4 bytes
 *   magFilter: 4 bytes
 *   lodBias:   4 bytes
 *   edgeLod:   1 byte
 *   minLod:    1 byte
 *   maxLod:    1 byte
 *   unpacked:  1 byte
 */
export function parseTPL(buffer) {
  const reader = new BinaryReader(buffer);

  const magic = reader.readU32();
  if (magic !== 0x0020AF30) {
    throw new Error(`Not a TPL file (magic: 0x${magic.toString(16)})`);
  }

  const numImages = reader.readU32();
  const imgTableOff = reader.readU32();

  const textures = [];

  reader.seek(imgTableOff);
  const entries = [];
  for (let i = 0; i < numImages; i++) {
    entries.push({
      imageOffset: reader.readU32(),
      paletteOffset: reader.readU32(),
    });
  }

  for (let i = 0; i < numImages; i++) {
    const entry = entries[i];
    reader.seek(entry.imageOffset);

    const height = reader.readU16();
    const width = reader.readU16();
    const format = reader.readU32();
    const dataOff = reader.readU32();

    // Read palette if present
    let palette = null;
    let palFmt = 0;
    if (entry.paletteOffset !== 0) {
      reader.seek(entry.paletteOffset);
      const palCount = reader.readU16();
      reader.skip(2); // unpacked
      palFmt = reader.readU32();
      const palDataOff = reader.readU32();
      reader.seek(palDataOff);
      palette = reader.readBytes(palCount * 2);
    }

    // Read image data
    reader.seek(dataOff);
    const dataSize = calcTextureSize(width, height, format);
    const data = reader.readBytes(dataSize);

    const pixels = decodeTexture(data, width, height, format, palette, palFmt);

    textures.push({
      name: `texture_${i}`,
      width,
      height,
      format,
      pixels,
    });
  }

  return textures;
}

/**
 * Calculate the byte size of a GX texture at given dimensions.
 */
function calcTextureSize(width, height, format) {
  // Round up to tile dimensions
  switch (format) {
    case GXTexFmt.I4:     return Math.ceil(width / 8) * 8 * Math.ceil(height / 8) * 8 / 2;
    case GXTexFmt.I8:     return Math.ceil(width / 8) * 8 * Math.ceil(height / 4) * 4;
    case GXTexFmt.IA4:    return Math.ceil(width / 8) * 8 * Math.ceil(height / 4) * 4;
    case GXTexFmt.IA8:    return Math.ceil(width / 4) * 4 * Math.ceil(height / 4) * 4 * 2;
    case GXTexFmt.RGB565: return Math.ceil(width / 4) * 4 * Math.ceil(height / 4) * 4 * 2;
    case GXTexFmt.RGB5A3: return Math.ceil(width / 4) * 4 * Math.ceil(height / 4) * 4 * 2;
    case GXTexFmt.RGBA32: return Math.ceil(width / 4) * 4 * Math.ceil(height / 4) * 4 * 4;
    case GXTexFmt.C4:     return Math.ceil(width / 8) * 8 * Math.ceil(height / 8) * 8 / 2;
    case GXTexFmt.C8:     return Math.ceil(width / 8) * 8 * Math.ceil(height / 4) * 4;
    case GXTexFmt.C14X2:  return Math.ceil(width / 4) * 4 * Math.ceil(height / 4) * 4 * 2;
    case GXTexFmt.CMPR:   return Math.ceil(width / 8) * 8 * Math.ceil(height / 8) * 8 / 2;
    default:              return width * height * 4; // fallback
  }
}
