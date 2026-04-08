/**
 * U8 archive extraction.
 * Nintendo's standard Wii archive format.
 *
 * Header (32 bytes):
 *   magic:       4 bytes  0x55AA382D
 *   rootOffset:  4 bytes  offset to root node
 *   dataSize:    4 bytes  total header+nodes size
 *   dataOffset:  4 bytes  offset to file data
 *   padding:     16 bytes
 *
 * Node (12 bytes each):
 *   type:        1 byte   0x00=file, 0x01=directory
 *   nameOff:     3 bytes  offset into string table (24-bit)
 *   dataOff:     4 bytes  file: offset to data; dir: parent index
 *   size:        4 bytes  file: byte size; dir: index of next node outside dir
 */
import { BinaryReader } from './reader.js';

/**
 * @typedef {Object} U8Entry
 * @property {string} path - full path including name
 * @property {ArrayBuffer} data - file contents
 */

/**
 * Extract files from a U8 archive.
 * @param {ArrayBuffer} buffer
 * @returns {U8Entry[]}
 */
export function extractU8(buffer) {
  const reader = new BinaryReader(buffer);

  const magic = reader.readU32();
  if (magic !== 0x55AA382D) {
    throw new Error(`Not a U8 archive (magic: 0x${magic.toString(16)})`);
  }

  const rootOffset = reader.readU32();
  reader.skip(8); // dataSize, dataOffset, skip padding is handled by rootOffset

  // Read root node to determine total node count
  reader.seek(rootOffset);
  const rootType = reader.readU8();
  const rootNameOff = (reader.readU8() << 16) | reader.readU16();
  const rootDataOff = reader.readU32();
  const totalNodes = reader.readU32();

  // String table starts right after all nodes
  const stringTableOffset = rootOffset + totalNodes * 12;

  // Read all nodes
  reader.seek(rootOffset);
  const nodes = [];
  for (let i = 0; i < totalNodes; i++) {
    const typeByte = reader.readU8();
    const nameOff = (reader.readU8() << 16) | reader.readU16();
    const dataOff = reader.readU32();
    const size = reader.readU32();
    const name = reader.readStringAt(stringTableOffset + nameOff);

    nodes.push({
      type: typeByte === 0x01 ? 'dir' : 'file',
      name,
      dataOff,
      size,
    });
  }

  // Build file list with full paths
  const results = [];
  const dirStack = []; // stack of { name, endIndex }

  for (let i = 0; i < totalNodes; i++) {
    const node = nodes[i];

    // Pop directories whose scope has ended
    while (dirStack.length > 0 && i >= dirStack[dirStack.length - 1].endIndex) {
      dirStack.pop();
    }

    if (i === 0) {
      // Root node
      dirStack.push({ name: '', endIndex: node.size });
      continue;
    }

    const pathPrefix = dirStack.map(d => d.name).filter(n => n).join('/');
    const fullPath = pathPrefix ? `${pathPrefix}/${node.name}` : node.name;

    if (node.type === 'dir') {
      dirStack.push({ name: node.name, endIndex: node.size });
    } else {
      results.push({
        path: fullPath,
        data: buffer.slice(node.dataOff, node.dataOff + node.size),
      });
    }
  }

  return results;
}
