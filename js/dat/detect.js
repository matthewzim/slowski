/**
 * Format detection from magic bytes.
 * Identifies common Wii container/resource formats.
 */
import { BinaryReader } from './reader.js';

/** Known format identifiers */
export const Format = {
  YAZ0:    'yaz0',
  U8:      'u8',
  RARC:    'rarc',
  BRRES:   'brres',
  BMD:     'bmd',
  TPL:     'tpl',
  UNKNOWN: 'unknown',
};

/**
 * Detect the format of a binary buffer.
 * @param {ArrayBuffer} buffer
 * @returns {{ format: string, reader: BinaryReader }}
 */
export function detectFormat(buffer) {
  const reader = new BinaryReader(buffer);

  if (reader.length < 4) {
    return { format: Format.UNKNOWN, reader };
  }

  const magic32 = reader.peekU32();
  const magic4 = reader.readString(4);
  reader.seek(0);

  // Yaz0 compression
  if (magic4 === 'Yaz0') {
    return { format: Format.YAZ0, reader };
  }

  // U8 archive
  if (magic32 === 0x55AA382D) {
    return { format: Format.U8, reader };
  }

  // RARC archive
  if (magic4 === 'RARC') {
    return { format: Format.RARC, reader };
  }

  // BRRES resource archive
  if (magic4 === 'bres') {
    return { format: Format.BRRES, reader };
  }

  // BMD model (J3D2bmd3)
  if (magic4 === 'J3D2') {
    return { format: Format.BMD, reader };
  }

  // TPL texture (0x0020AF30)
  if (magic32 === 0x0020AF30) {
    return { format: Format.TPL, reader };
  }

  return { format: Format.UNKNOWN, reader };
}

/**
 * Scan a buffer for embedded known format signatures at aligned offsets.
 * Returns array of { offset, format }.
 */
export function scanForEmbeddedFormats(buffer, alignment = 4) {
  const view = new DataView(buffer);
  const results = [];
  const len = buffer.byteLength - 4;

  for (let off = 0; off <= len; off += alignment) {
    const magic32 = view.getUint32(off);
    let fmt = null;

    if (magic32 === 0x59617A30) fmt = Format.YAZ0;        // 'Yaz0'
    else if (magic32 === 0x55AA382D) fmt = Format.U8;
    else if (magic32 === 0x52415243) fmt = Format.RARC;    // 'RARC'
    else if (magic32 === 0x62726573) fmt = Format.BRRES;   // 'bres'
    else if (magic32 === 0x4A334432) fmt = Format.BMD;     // 'J3D2'
    else if (magic32 === 0x0020AF30) fmt = Format.TPL;

    if (fmt) {
      results.push({ offset: off, format: fmt });
    }
  }

  return results;
}
