/**
 * Fallback handler for unknown .dat formats.
 * When standard format detection fails, uses heuristics to find usable data.
 */
import { BinaryReader } from './reader.js';
import { scanForEmbeddedFormats, Format } from './detect.js';

/**
 * Analyze an unknown binary file and attempt to extract usable data.
 * @param {ArrayBuffer} buffer
 * @returns {{ method: string, files: { path: string, data: ArrayBuffer }[], diagnostics: string[] }}
 */
export function handleUnknownFormat(buffer) {
  const diagnostics = [];
  const files = [];

  diagnostics.push(`File size: ${buffer.byteLength} bytes (${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB)`);

  // -- Tier 2: Scan for embedded known format signatures --
  const embedded = scanForEmbeddedFormats(buffer);
  if (embedded.length > 0) {
    diagnostics.push(`Found ${embedded.length} embedded format signature(s):`);
    for (const e of embedded) {
      diagnostics.push(`  - ${e.format} at offset 0x${e.offset.toString(16)}`);
    }

    // Extract each embedded resource
    for (let i = 0; i < embedded.length; i++) {
      const entry = embedded[i];
      const nextOffset = i + 1 < embedded.length ? embedded[i + 1].offset : buffer.byteLength;
      const size = nextOffset - entry.offset;

      files.push({
        path: `embedded_${i}.${entry.format}`,
        data: buffer.slice(entry.offset, entry.offset + size),
      });
    }

    if (files.length > 0) {
      return { method: 'embedded_scan', files, diagnostics };
    }
  }

  // -- Tier 3: File table heuristic --
  const tableResult = detectFileTable(buffer);
  if (tableResult) {
    diagnostics.push(`Detected file table: ${tableResult.entries.length} entries`);
    for (const entry of tableResult.entries) {
      files.push({
        path: entry.name || `file_${files.length}`,
        data: buffer.slice(entry.offset, entry.offset + entry.size),
      });
    }
    if (files.length > 0) {
      return { method: 'file_table', files, diagnostics };
    }
  }

  // -- Tier 4: Raw vertex data scanning --
  const vertexResult = scanForVertexData(buffer);
  if (vertexResult) {
    diagnostics.push(`Found potential vertex data: ${vertexResult.count} vertices at offset 0x${vertexResult.offset.toString(16)}`);
    files.push({
      path: 'raw_vertices.bin',
      data: buffer.slice(vertexResult.offset, vertexResult.offset + vertexResult.count * 12),
    });
    return { method: 'vertex_scan', files, diagnostics };
  }

  diagnostics.push('No recognizable data structures found.');
  return { method: 'unknown', files, diagnostics };
}

/**
 * Detect a file table at the start of the buffer.
 * Common pattern: {count: u32, entries: [{offset: u32, size: u32}, ...]}
 */
function detectFileTable(buffer) {
  if (buffer.byteLength < 8) return null;
  const view = new DataView(buffer);

  // Try big-endian first (Wii native)
  for (const le of [false, true]) {
    const count = view.getUint32(0, le);

    // Reasonable file count (1-10000)
    if (count < 1 || count > 10000) continue;

    // Check if there's enough room for a file table
    const headerSize = 4; // just count
    const entrySize = 8;  // offset + size
    const tableEnd = headerSize + count * entrySize;

    if (tableEnd > buffer.byteLength) continue;

    const entries = [];
    let valid = true;

    for (let i = 0; i < count; i++) {
      const off = headerSize + i * entrySize;
      const fileOffset = view.getUint32(off, le);
      const fileSize = view.getUint32(off + 4, le);

      // Validate: offset + size must be within buffer
      if (fileOffset >= buffer.byteLength || fileOffset + fileSize > buffer.byteLength || fileSize === 0) {
        valid = false;
        break;
      }

      entries.push({ offset: fileOffset, size: fileSize, name: `file_${i}` });
    }

    if (valid && entries.length > 0) {
      return { entries };
    }

    // Also try with names (offset + size + nameOffset pattern)
    const entrySize2 = 12;
    const tableEnd2 = headerSize + count * entrySize2;
    if (tableEnd2 <= buffer.byteLength) {
      const entries2 = [];
      let valid2 = true;

      for (let i = 0; i < count; i++) {
        const off = headerSize + i * entrySize2;
        const fileOffset = view.getUint32(off, le);
        const fileSize = view.getUint32(off + 4, le);
        const nameOff = view.getUint32(off + 8, le);

        if (fileOffset >= buffer.byteLength || fileOffset + fileSize > buffer.byteLength || fileSize === 0) {
          valid2 = false;
          break;
        }

        // Try to read name from nameOff
        let name = `file_${i}`;
        if (nameOff > 0 && nameOff < buffer.byteLength) {
          const reader = new BinaryReader(buffer);
          const readName = reader.readStringAt(nameOff);
          if (readName && readName.length > 0 && readName.length < 256) {
            name = readName;
          }
        }

        entries2.push({ offset: fileOffset, size: fileSize, name });
      }

      if (valid2 && entries2.length > 0) {
        return { entries: entries2 };
      }
    }
  }

  return null;
}

/**
 * Scan for contiguous float triples that look like 3D vertex data.
 */
function scanForVertexData(buffer) {
  const view = new DataView(buffer);
  const floatCount = Math.floor(buffer.byteLength / 4);

  let bestOffset = -1;
  let bestCount = 0;
  let currentStart = -1;
  let currentCount = 0;

  for (let i = 0; i + 2 < floatCount; i += 3) {
    const off = i * 4;
    const x = view.getFloat32(off, false);
    const y = view.getFloat32(off + 4, false);
    const z = view.getFloat32(off + 8, false);

    // Check if these look like valid 3D coordinates
    if (isFinite(x) && isFinite(y) && isFinite(z) &&
        Math.abs(x) < 100000 && Math.abs(y) < 100000 && Math.abs(z) < 100000 &&
        (Math.abs(x) > 0.001 || Math.abs(y) > 0.001 || Math.abs(z) > 0.001)) {
      if (currentStart < 0) currentStart = off;
      currentCount++;
    } else {
      if (currentCount > bestCount) {
        bestOffset = currentStart;
        bestCount = currentCount;
      }
      currentStart = -1;
      currentCount = 0;
    }
  }

  if (currentCount > bestCount) {
    bestOffset = currentStart;
    bestCount = currentCount;
  }

  // Require at least 100 vertices to be useful as terrain
  if (bestCount >= 100) {
    return { offset: bestOffset, count: bestCount };
  }

  return null;
}

/**
 * Convert raw vertex data scan results to a ParsedModel-like object.
 * @param {ArrayBuffer} buffer
 * @param {{ offset: number, count: number }} scanResult
 * @returns {import('./mdl0.js').ParsedModel}
 */
export function rawVerticesToModel(buffer, scanResult) {
  const view = new DataView(buffer);
  const vertices = new Float32Array(scanResult.count * 3);
  const indices = [];

  for (let i = 0; i < scanResult.count; i++) {
    const off = scanResult.offset + i * 12;
    vertices[i * 3] = view.getFloat32(off, false);
    vertices[i * 3 + 1] = view.getFloat32(off + 4, false);
    vertices[i * 3 + 2] = view.getFloat32(off + 8, false);
  }

  // Generate triangle indices assuming triangle list
  for (let i = 0; i + 2 < scanResult.count; i += 3) {
    indices.push(i, i + 1, i + 2);
  }

  return {
    name: 'raw_terrain',
    vertices,
    normals: new Float32Array(0),
    uvs: new Float32Array(0),
    indices: new Uint32Array(indices),
    textureRefs: [],
  };
}
