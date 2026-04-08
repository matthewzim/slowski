/**
 * BRRES resource archive parser.
 * Nintendo's top-level resource container for Wii games.
 *
 * Structure:
 *   Header (16 bytes):
 *     magic:    4 bytes  'bres'
 *     bom:      2 bytes  0xFEFF (byte order mark)
 *     version:  2 bytes
 *     fileSize: 4 bytes
 *     rootOff:  2 bytes  (offset to root section, usually 0x10)
 *     numSects: 2 bytes
 *
 *   Root section:
 *     magic:    4 bytes  'root'
 *     size:     4 bytes
 *     Followed by an index group (resource group)
 *
 *   Index group:
 *     size:       4 bytes
 *     numEntries: 4 bytes
 *     [entries...] 16 bytes each (id, flag, left, right, nameOff, dataOff)
 *
 *   Each entry points to either another group (folder) or a resource (MDL0, TEX0, etc.)
 */
import { BinaryReader } from './reader.js';
import { parseMDL0 } from './mdl0.js';
import { parseTEX0 } from './tex0.js';

/**
 * @typedef {Object} BRRESResult
 * @property {import('./mdl0.js').ParsedModel[]} models
 * @property {import('./tex0.js').ParsedTexture[]} textures
 */

/**
 * Parse a BRRES resource archive.
 * @param {ArrayBuffer} buffer
 * @returns {BRRESResult}
 */
export function parseBRRES(buffer) {
  const reader = new BinaryReader(buffer);

  const magic = reader.readString(4);
  if (magic !== 'bres') {
    throw new Error(`Not a BRRES file (magic: ${magic})`);
  }

  const bom = reader.readU16();
  const version = reader.readU16();
  const fileSize = reader.readU32();
  const rootOffset = reader.readU16();
  const numSections = reader.readU16();

  const models = [];
  const textures = [];

  // Read root section
  reader.seek(rootOffset);
  const rootMagic = reader.readString(4);
  const rootSize = reader.readU32();

  // Root contains an index group of sub-folders
  const folders = parseIndexGroup(reader, rootOffset + 8);

  for (const folder of folders) {
    const folderName = folder.name.toLowerCase();

    // Each folder contains another index group of resources
    const resources = parseIndexGroup(reader, folder.absOffset);

    for (const res of resources) {
      // Determine resource type from folder name or magic bytes
      const resBuffer = buffer.slice(res.absOffset);

      try {
        if (folderName.includes('3dmodel') || folderName.includes('mdl')) {
          const model = parseMDL0(resBuffer, res.name);
          models.push(model);
        } else if (folderName.includes('texture') || folderName.includes('tex')) {
          const tex = parseTEX0(resBuffer, res.name);
          textures.push(tex);
        } else if (folderName.includes('anmchr') || folderName.includes('anm')) {
          // Animation - skip for now
        } else {
          // Try to detect by reading magic bytes
          const subReader = new BinaryReader(resBuffer);
          // MDL0 starts with its length (u32) then version
          // TEX0 also starts with length
          // We need to guess based on context
          // For now, try both and see which works
          try {
            const model = parseMDL0(resBuffer, res.name);
            if (model.vertices.length > 0) {
              models.push(model);
              continue;
            }
          } catch {}
          try {
            const tex = parseTEX0(resBuffer, res.name);
            if (tex.pixels && tex.pixels.length > 0) {
              textures.push(tex);
            }
          } catch {}
        }
      } catch (e) {
        console.warn(`Failed to parse BRRES resource "${res.name}" in "${folder.name}":`, e.message);
      }
    }
  }

  return { models, textures };
}

/**
 * Parse a BRRES index group (resource group).
 * Returns array of { name, absOffset }.
 */
function parseIndexGroup(reader, offset) {
  reader.seek(offset);
  const groupSize = reader.readU32();
  const numEntries = reader.readU32();

  const results = [];

  // Skip root/reference entry
  reader.skip(16);

  for (let i = 0; i < numEntries; i++) {
    const id = reader.readU16();
    const flag = reader.readU16();
    const leftIdx = reader.readU16();
    const rightIdx = reader.readU16();

    const nameOffPos = reader.tell();
    const nameOff = reader.readI32();
    const dataOffPos = reader.tell();
    const dataOff = reader.readI32();

    // Name is relative to the nameOff field position
    const name = nameOff ? reader.readStringAt(nameOffPos + nameOff) : `resource_${i}`;
    // Data offset is relative to the group start
    const absOffset = offset + dataOff;

    results.push({ name, absOffset });
  }

  return results;
}
