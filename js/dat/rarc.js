/**
 * RARC archive extraction.
 * Another Nintendo archive format with node-based directory structure.
 *
 * Header:
 *   magic:       4 bytes  'RARC'
 *   fileSize:    4 bytes
 *   headerSize:  4 bytes  (0x20)
 *   dataOffset:  4 bytes  offset to file data (relative to header end)
 *   dataSize:    4 bytes
 *   mramSize:    4 bytes
 *   aramSize:    4 bytes
 *   padding:     4 bytes
 *
 * Info block (at 0x20):
 *   numNodes:    4 bytes
 *   nodeOffset:  4 bytes  (relative to start of info block)
 *   numEntries:  4 bytes
 *   entryOffset: 4 bytes  (relative to start of info block)
 *   stringTableSize: 4 bytes
 *   stringTableOffset: 4 bytes (relative to start of info block)
 *   ... etc
 */
import { BinaryReader } from './reader.js';

/**
 * Extract files from a RARC archive.
 * @param {ArrayBuffer} buffer
 * @returns {{ path: string, data: ArrayBuffer }[]}
 */
export function extractRARC(buffer) {
  const reader = new BinaryReader(buffer);

  const magic = reader.readString(4);
  if (magic !== 'RARC') {
    throw new Error(`Not a RARC archive (magic: ${magic})`);
  }

  const fileSize = reader.readU32();
  const headerSize = reader.readU32(); // usually 0x20
  const dataOffsetRel = reader.readU32(); // relative to headerSize
  const dataOffset = headerSize + dataOffsetRel;

  reader.skip(16); // dataSize, mramSize, aramSize, padding

  // Info block at 0x20
  const infoStart = 0x20;
  reader.seek(infoStart);

  const numNodes = reader.readU32();
  const nodeOffsetRel = reader.readU32();
  const numEntries = reader.readU32();
  const entryOffsetRel = reader.readU32();
  const stringTableSize = reader.readU32();
  const stringTableOffsetRel = reader.readU32();

  const nodeOffset = infoStart + nodeOffsetRel;
  const entryOffset = infoStart + entryOffsetRel;
  const stringTableOffset = infoStart + stringTableOffsetRel;

  // Read directory nodes (20 bytes each)
  const dirNodes = [];
  reader.seek(nodeOffset);
  for (let i = 0; i < numNodes; i++) {
    const id = reader.readString(4);
    const nameOffset = reader.readU32();
    const nameHash = reader.readU16();
    const entryCount = reader.readU16();
    const firstEntry = reader.readU32();
    const name = reader.readStringAt(stringTableOffset + nameOffset);
    dirNodes.push({ id, name, firstEntry, entryCount });
  }

  // Read file entries (20 bytes each)
  const entries = [];
  reader.seek(entryOffset);
  for (let i = 0; i < numEntries; i++) {
    const id = reader.readU16();
    const nameHash = reader.readU16();
    const type = reader.readU16();
    const nameOff = reader.readU16();
    const entryDataOff = reader.readU32();
    const entryDataSize = reader.readU32();
    reader.skip(4); // padding
    const name = reader.readStringAt(stringTableOffset + nameOff);

    entries.push({
      id,
      type, // 0x0200 = directory, 0x1100 = file (typically)
      name,
      dataOff: entryDataOff,
      dataSize: entryDataSize,
      isDir: (type & 0x0200) !== 0,
    });
  }

  // Walk directory tree to build full paths
  const results = [];

  function walkDir(dirIndex, pathPrefix) {
    const dir = dirNodes[dirIndex];
    for (let i = dir.firstEntry; i < dir.firstEntry + dir.entryCount; i++) {
      const entry = entries[i];
      if (!entry || entry.name === '.' || entry.name === '..') continue;

      const fullPath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;

      if (entry.isDir) {
        // entry.dataOff is the index of the child directory node
        walkDir(entry.dataOff, fullPath);
      } else {
        const absOffset = dataOffset + entry.dataOff;
        results.push({
          path: fullPath,
          data: buffer.slice(absOffset, absOffset + entry.dataSize),
        });
      }
    }
  }

  if (dirNodes.length > 0) {
    walkDir(0, '');
  }

  return results;
}
