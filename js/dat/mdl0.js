/**
 * MDL0 model parser (BRRES sub-format).
 * Extracts vertex positions, normals, UVs, and face indices from
 * Nintendo GX display-list-based 3D models.
 *
 * MDL0 structure:
 *   Header (variable, version-dependent)
 *   Sections indexed by offset table:
 *     0:  Definitions/Draw ops (byte-code for draw order)
 *     1:  Bones
 *     2:  Vertex position arrays
 *     3:  Vertex normal arrays
 *     4:  Vertex color arrays
 *     5:  UV coordinate arrays
 *     6:  (Fur) - rare
 *     7:  (Fur) - rare
 *     8:  Materials
 *     9:  TEV/Shaders
 *     10: Objects/Polygons (contain GX display lists)
 *     11: Texture links
 *
 * Reference: noclip.website BRRES.ts, BrawlBox documentation
 */
import { BinaryReader } from './reader.js';

// GX draw opcodes
const GX_NOP             = 0x00;
const GX_DRAW_QUADS      = 0x80;
const GX_DRAW_TRIANGLES  = 0x90;
const GX_DRAW_TRISTRIP   = 0x98;
const GX_DRAW_TRIFAN     = 0xA0;
const GX_DRAW_LINES      = 0xA8;
const GX_DRAW_LINESTRIP  = 0xB0;
const GX_DRAW_POINTS     = 0xB8;

// GX vertex attribute IDs
const GX_VA_PNMTXIDX  = 0;
const GX_VA_TEX0MTXIDX = 1;
const GX_VA_POS        = 9;
const GX_VA_NRM        = 10;
const GX_VA_CLR0       = 11;
const GX_VA_CLR1       = 12;
const GX_VA_TEX0       = 13;
const GX_VA_TEX1       = 14;
const GX_VA_TEX2       = 15;
const GX_VA_TEX3       = 16;
const GX_VA_TEX4       = 17;
const GX_VA_TEX5       = 18;
const GX_VA_TEX6       = 19;
const GX_VA_TEX7       = 20;

// Attribute data types for index size
const INDEX_NONE   = 0;
const INDEX_DIRECT = 1;
const INDEX_U8     = 2;
const INDEX_U16    = 3;

/**
 * @typedef {Object} ParsedModel
 * @property {string} name
 * @property {Float32Array} vertices - flat xyz positions
 * @property {Float32Array} normals - flat xyz normals (may be empty)
 * @property {Float32Array} uvs - flat st coords (may be empty)
 * @property {Uint32Array} indices - triangle indices
 * @property {string[]} textureRefs - referenced texture names
 */

/**
 * Parse an MDL0 model resource.
 * @param {ArrayBuffer} buffer - MDL0 data
 * @param {string} [name='model']
 * @returns {ParsedModel}
 */
export function parseMDL0(buffer, name = 'model') {
  const reader = new BinaryReader(buffer);

  // -- MDL0 header --
  const length = reader.readU32();
  const version = reader.readU32();
  const brresOffset = reader.readI32();

  // Section offsets (relative to MDL0 start)
  // Number of sections varies by version
  const sectionOffsets = [];
  const numSections = version >= 11 ? 14 : version >= 10 ? 12 : 11;

  // Skip to section offset table
  reader.seek(0x10);
  for (let i = 0; i < numSections; i++) {
    sectionOffsets.push(reader.readI32());
  }

  // Read string from name offset
  const nameOffset = reader.readI32();

  // -- Parse vertex position arrays (section 2) --
  const posArrays = parseSectionGroup(reader, sectionOffsets[2], parseVertexArray);

  // -- Parse normal arrays (section 3) --
  const nrmArrays = parseSectionGroup(reader, sectionOffsets[3], parseNormalArray);

  // -- Parse UV arrays (section 5) --
  const uvArrays = parseSectionGroup(reader, sectionOffsets[5], parseUVArray);

  // -- Parse objects/polygons (section 10) to get display lists --
  const objects = parseSectionGroup(reader, sectionOffsets[10], (r, off) => parseObject(r, off, buffer));

  // -- Parse texture links (section 11) for texture names --
  const textureRefs = [];
  if (sectionOffsets[11]) {
    const texLinks = parseSectionGroup(reader, sectionOffsets[11], parseTextureLink);
    for (const link of texLinks) {
      if (link && link.name) textureRefs.push(link.name);
    }
  }

  // -- Parse materials (section 8) --
  const materials = parseSectionGroup(reader, sectionOffsets[8], parseMaterial);

  // -- Convert display lists to triangle soup --
  const allPositions = [];
  const allNormals = [];
  const allUVs = [];
  const allIndices = [];
  let vertexOffset = 0;

  for (const obj of objects) {
    if (!obj) continue;

    const posArr = posArrays[obj.posIdx] || posArrays[0];
    const nrmArr = obj.nrmIdx >= 0 ? (nrmArrays[obj.nrmIdx] || nrmArrays[0]) : null;
    const uvArr = obj.uvIdx >= 0 ? (uvArrays[obj.uvIdx] || uvArrays[0]) : null;

    const result = decodeDisplayList(obj.displayListData, obj.vatEntries, posArr, nrmArr, uvArr);

    for (let i = 0; i < result.positions.length; i++) {
      allPositions.push(result.positions[i]);
    }
    for (let i = 0; i < result.normals.length; i++) {
      allNormals.push(result.normals[i]);
    }
    for (let i = 0; i < result.uvs.length; i++) {
      allUVs.push(result.uvs[i]);
    }
    for (let i = 0; i < result.indices.length; i++) {
      allIndices.push(result.indices[i] + vertexOffset);
    }

    vertexOffset += result.positions.length / 3;
  }

  return {
    name,
    vertices: new Float32Array(allPositions),
    normals: new Float32Array(allNormals),
    uvs: new Float32Array(allUVs),
    indices: new Uint32Array(allIndices),
    textureRefs,
  };
}

// ===========================================================
// Section group parsing (BRRES index group / resource group)
// ===========================================================

/**
 * Parse a BRRES index group (resource group).
 * A group contains entries, each pointing to a sub-resource.
 */
function parseSectionGroup(reader, offset, parseFunc) {
  const results = [];
  if (!offset || offset === 0) return results;

  reader.seek(offset);
  const groupSize = reader.readU32();
  const numEntries = reader.readU32();

  // Skip root entry (reference node)
  reader.skip(16); // id(2) + pad(2) + leftIdx(2) + rightIdx(2) + stringOff(4) + dataOff(4)

  for (let i = 0; i < numEntries; i++) {
    const id = reader.readU16();
    const flag = reader.readU16();
    const leftIdx = reader.readU16();
    const rightIdx = reader.readU16();
    const stringOff = reader.readI32();
    const dataOff = reader.readI32();

    // dataOff is relative to the group start
    const absOffset = offset + dataOff;
    const savedPos = reader.tell();

    // Read name from string offset (relative to the entry's string offset field position)
    const entryName = stringOff ? reader.readStringAt(reader.tell() - 4 + stringOff) : `entry_${i}`;

    try {
      const parsed = parseFunc(reader, absOffset);
      if (parsed) {
        parsed.name = parsed.name || entryName;
        results.push(parsed);
      }
    } catch (e) {
      console.warn(`Failed to parse entry ${i} at offset 0x${absOffset.toString(16)}:`, e.message);
      results.push(null);
    }

    reader.seek(savedPos);
  }

  return results;
}

// ===========================================================
// Vertex data array parsers
// ===========================================================

function parseVertexArray(reader, offset) {
  reader.seek(offset);
  const length = reader.readU32();
  const mdl0Off = reader.readI32();
  const dataOff = reader.readI32();
  const nameOff = reader.readI32();
  const index = reader.readU32();
  const compCnt = reader.readU32(); // 0=xy, 1=xyz
  const compType = reader.readU32(); // 0=u8, 1=i8, 2=u16, 3=i16, 4=f32
  const divisor = reader.readU8();
  const stride = reader.readU8();
  const numVertices = reader.readU16();

  // Bounds
  const minX = reader.readF32(), minY = reader.readF32(), minZ = reader.readF32();
  const maxX = reader.readF32(), maxY = reader.readF32(), maxZ = reader.readF32();

  // Data starts at dataOff relative to the vertex array start
  const dataAbsOff = offset + dataOff;
  reader.seek(dataAbsOff);

  const components = compCnt === 0 ? 2 : 3;
  const scale = Math.pow(2, -divisor);
  const data = new Float32Array(numVertices * 3);

  for (let i = 0; i < numVertices; i++) {
    let x, y, z = 0;
    switch (compType) {
      case 0: x = reader.readU8(); y = reader.readU8(); if (components === 3) z = reader.readU8(); break;
      case 1: x = reader.readI8(); y = reader.readI8(); if (components === 3) z = reader.readI8(); break;
      case 2: x = reader.readU16(); y = reader.readU16(); if (components === 3) z = reader.readU16(); break;
      case 3: x = reader.readI16(); y = reader.readI16(); if (components === 3) z = reader.readI16(); break;
      case 4: x = reader.readF32(); y = reader.readF32(); if (components === 3) z = reader.readF32(); break;
      default: x = 0; y = 0; z = 0;
    }
    data[i * 3] = x * scale;
    data[i * 3 + 1] = y * scale;
    data[i * 3 + 2] = z * scale;
  }

  return { data, numVertices };
}

function parseNormalArray(reader, offset) {
  reader.seek(offset);
  const length = reader.readU32();
  const mdl0Off = reader.readI32();
  const dataOff = reader.readI32();
  const nameOff = reader.readI32();
  const index = reader.readU32();
  const compCnt = reader.readU32(); // 0=xyz, 1=nbt, 2=nbt3
  const compType = reader.readU32();
  const divisor = reader.readU8();
  const stride = reader.readU8();
  const numNormals = reader.readU16();

  const dataAbsOff = offset + dataOff;
  reader.seek(dataAbsOff);

  const scale = Math.pow(2, -divisor);
  const data = new Float32Array(numNormals * 3);

  for (let i = 0; i < numNormals; i++) {
    let x, y, z;
    switch (compType) {
      case 1: x = reader.readI8(); y = reader.readI8(); z = reader.readI8(); break;
      case 3: x = reader.readI16(); y = reader.readI16(); z = reader.readI16(); break;
      case 4: x = reader.readF32(); y = reader.readF32(); z = reader.readF32(); break;
      default: x = 0; y = 1; z = 0;
    }
    data[i * 3] = x * scale;
    data[i * 3 + 1] = y * scale;
    data[i * 3 + 2] = z * scale;
  }

  return { data, numNormals };
}

function parseUVArray(reader, offset) {
  reader.seek(offset);
  const length = reader.readU32();
  const mdl0Off = reader.readI32();
  const dataOff = reader.readI32();
  const nameOff = reader.readI32();
  const index = reader.readU32();
  const compCnt = reader.readU32(); // 0=s, 1=st
  const compType = reader.readU32();
  const divisor = reader.readU8();
  const stride = reader.readU8();
  const numUVs = reader.readU16();

  // Bounds
  const minS = reader.readF32(), minT = reader.readF32();
  const maxS = reader.readF32(), maxT = reader.readF32();

  const dataAbsOff = offset + dataOff;
  reader.seek(dataAbsOff);

  const components = compCnt === 0 ? 1 : 2;
  const scale = Math.pow(2, -divisor);
  const data = new Float32Array(numUVs * 2);

  for (let i = 0; i < numUVs; i++) {
    let s, t = 0;
    switch (compType) {
      case 0: s = reader.readU8(); if (components === 2) t = reader.readU8(); break;
      case 1: s = reader.readI8(); if (components === 2) t = reader.readI8(); break;
      case 2: s = reader.readU16(); if (components === 2) t = reader.readU16(); break;
      case 3: s = reader.readI16(); if (components === 2) t = reader.readI16(); break;
      case 4: s = reader.readF32(); if (components === 2) t = reader.readF32(); break;
      default: s = 0; t = 0;
    }
    data[i * 2] = s * scale;
    data[i * 2 + 1] = t * scale;
  }

  return { data, numUVs };
}

// ===========================================================
// Object/Polygon parser (contains display lists)
// ===========================================================

function parseObject(reader, offset, fullBuffer) {
  reader.seek(offset);
  const length = reader.readU32();
  const mdl0Off = reader.readI32();
  const boneIdx = reader.readI32();

  // CP vertex format descriptor (tells us which attributes are present)
  reader.seek(offset + 0x18);
  const cp_vtxFmtLo = reader.readU32();
  const cp_vtxFmtHi = reader.readU32();

  // XF vertex specs
  reader.seek(offset + 0x20);
  const xf_vtxSpecs = reader.readU32();

  // Vertex attribute table flags
  reader.seek(offset + 0x0C);
  const vertexFlags = reader.readU32();

  // Object-specific data
  reader.seek(offset + 0x24);
  const setFlag = reader.readU32();
  const numVerticesObj = reader.readU32();
  const numFaces = reader.readU32();

  // Vertex array references
  reader.seek(offset + 0x30);
  const posIdx = reader.readI16();
  const nrmIdx = reader.readI16();
  reader.skip(4); // color indices
  const uvIdx = reader.readI16();
  reader.skip(14); // other uv indices

  // Display list locations
  reader.seek(offset + 0x50);
  const dlSize0 = reader.readU32();
  const dlOff0 = reader.readU32();
  const dlSize1 = reader.readU32();
  const dlOff1 = reader.readU32();

  // Build VAT entries from CP vertex format registers
  const vatEntries = buildVATFromCPFormat(cp_vtxFmtLo, cp_vtxFmtHi);

  // Read display list data
  let displayListData = null;
  if (dlOff0 && dlSize0) {
    const absOff = offset + dlOff0;
    displayListData = new Uint8Array(fullBuffer, absOff, dlSize0);
  }

  return {
    posIdx,
    nrmIdx,
    uvIdx,
    vatEntries,
    displayListData,
  };
}

/**
 * Build vertex attribute table from CP register format values.
 */
function buildVATFromCPFormat(lo, hi) {
  // VTX_FMT_LO register bits:
  // 0:    PNMTXIDX   (1 bit)
  // 1:    TEX0MTXIDX  (1 bit)
  // 2-8:  TEX1-7MTXIDX (1 bit each)
  // 9-10: POS (2 bits: 0=none, 1=direct, 2=idx8, 3=idx16)
  // 11-12: NRM (2 bits)
  // 13-14: CLR0 (2 bits)
  // 15-16: CLR1 (2 bits)
  // 17-18: TEX0 (2 bits)
  // ...etc

  const attrs = [];

  // Position/normal matrix index
  if (lo & 0x001) attrs.push({ id: GX_VA_PNMTXIDX, type: INDEX_DIRECT, size: 1 });
  // Tex0 matrix index
  if (lo & 0x002) attrs.push({ id: GX_VA_TEX0MTXIDX, type: INDEX_DIRECT, size: 1 });

  // Skip TEX1-7 matrix indices (bits 2-8)
  for (let i = 2; i <= 8; i++) {
    if (lo & (1 << i)) attrs.push({ id: GX_VA_TEX0MTXIDX + i - 1, type: INDEX_DIRECT, size: 1 });
  }

  // Position (bits 9-10)
  const posType = (lo >> 9) & 0x03;
  if (posType) attrs.push({ id: GX_VA_POS, type: posType, size: posType === INDEX_U16 ? 2 : posType === INDEX_U8 ? 1 : 0 });

  // Normal (bits 11-12)
  const nrmType = (lo >> 11) & 0x03;
  if (nrmType) attrs.push({ id: GX_VA_NRM, type: nrmType, size: nrmType === INDEX_U16 ? 2 : nrmType === INDEX_U8 ? 1 : 0 });

  // Color0 (bits 13-14)
  const clr0Type = (lo >> 13) & 0x03;
  if (clr0Type) attrs.push({ id: GX_VA_CLR0, type: clr0Type, size: clr0Type === INDEX_U16 ? 2 : clr0Type === INDEX_U8 ? 1 : 0 });

  // Color1 (bits 15-16)
  const clr1Type = (lo >> 15) & 0x03;
  if (clr1Type) attrs.push({ id: GX_VA_CLR1, type: clr1Type, size: clr1Type === INDEX_U16 ? 2 : clr1Type === INDEX_U8 ? 1 : 0 });

  // Tex0 (bits 17-18)
  const tex0Type = (lo >> 17) & 0x03;
  if (tex0Type) attrs.push({ id: GX_VA_TEX0, type: tex0Type, size: tex0Type === INDEX_U16 ? 2 : tex0Type === INDEX_U8 ? 1 : 0 });

  // Tex1-7 from high register bits
  for (let i = 1; i <= 7; i++) {
    const shift = (i - 1) * 2;
    const texType = (hi >> shift) & 0x03;
    if (texType) attrs.push({ id: GX_VA_TEX0 + i, type: texType, size: texType === INDEX_U16 ? 2 : texType === INDEX_U8 ? 1 : 0 });
  }

  return attrs;
}

// ===========================================================
// Display list decoder
// ===========================================================

function decodeDisplayList(dlData, vatEntries, posArr, nrmArr, uvArr) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  if (!dlData || !posArr) {
    return { positions, normals, uvs, indices };
  }

  const view = new DataView(dlData.buffer, dlData.byteOffset, dlData.byteLength);
  let cursor = 0;

  // Calculate vertex stride (total bytes per vertex in display list)
  let vertexStride = 0;
  for (const attr of vatEntries) {
    if (attr.type === INDEX_DIRECT) vertexStride += attr.size;
    else if (attr.type === INDEX_U8) vertexStride += 1;
    else if (attr.type === INDEX_U16) vertexStride += 2;
  }

  let vertexCount = 0;

  while (cursor < dlData.length) {
    const opcode = dlData[cursor++];
    if (opcode === GX_NOP || opcode === 0) continue;

    const primType = opcode & 0xF8;
    if (primType !== GX_DRAW_TRIANGLES &&
        primType !== GX_DRAW_TRISTRIP &&
        primType !== GX_DRAW_TRIFAN &&
        primType !== GX_DRAW_QUADS &&
        primType !== GX_DRAW_LINES &&
        primType !== GX_DRAW_LINESTRIP &&
        primType !== GX_DRAW_POINTS) {
      continue; // Skip unknown opcodes
    }

    if (cursor + 1 >= dlData.length) break;
    const count = view.getUint16(cursor, false);
    cursor += 2;

    const baseVertex = vertexCount;
    const primVertices = [];

    for (let v = 0; v < count; v++) {
      let posIdx = -1, nrmIdx2 = -1, uvIdx2 = -1;

      for (const attr of vatEntries) {
        let val;
        if (attr.type === INDEX_DIRECT) {
          val = dlData[cursor++];
        } else if (attr.type === INDEX_U8) {
          val = dlData[cursor++];
        } else if (attr.type === INDEX_U16) {
          val = view.getUint16(cursor, false);
          cursor += 2;
        } else {
          continue;
        }

        switch (attr.id) {
          case GX_VA_POS: posIdx = val; break;
          case GX_VA_NRM: nrmIdx2 = val; break;
          case GX_VA_TEX0: uvIdx2 = val; break;
          // Other attributes are read but not used for geometry
        }
      }

      // Emit vertex data
      if (posIdx >= 0 && posIdx < posArr.numVertices) {
        positions.push(
          posArr.data[posIdx * 3],
          posArr.data[posIdx * 3 + 1],
          posArr.data[posIdx * 3 + 2]
        );
      } else {
        positions.push(0, 0, 0);
      }

      if (nrmArr && nrmIdx2 >= 0 && nrmIdx2 < nrmArr.numNormals) {
        normals.push(
          nrmArr.data[nrmIdx2 * 3],
          nrmArr.data[nrmIdx2 * 3 + 1],
          nrmArr.data[nrmIdx2 * 3 + 2]
        );
      } else {
        normals.push(0, 1, 0);
      }

      if (uvArr && uvIdx2 >= 0 && uvIdx2 < uvArr.numUVs) {
        uvs.push(
          uvArr.data[uvIdx2 * 2],
          uvArr.data[uvIdx2 * 2 + 1]
        );
      } else {
        uvs.push(0, 0);
      }

      primVertices.push(vertexCount++);
    }

    // Convert primitive to triangles
    triangulate(primType, primVertices, indices);
  }

  return { positions, normals, uvs, indices };
}

/**
 * Convert a GX primitive to triangles.
 */
function triangulate(primType, verts, outIndices) {
  switch (primType) {
    case GX_DRAW_TRIANGLES:
      for (let i = 0; i + 2 < verts.length; i += 3) {
        outIndices.push(verts[i], verts[i+1], verts[i+2]);
      }
      break;

    case GX_DRAW_TRISTRIP:
      for (let i = 0; i + 2 < verts.length; i++) {
        if (i % 2 === 0) {
          outIndices.push(verts[i], verts[i+1], verts[i+2]);
        } else {
          outIndices.push(verts[i+1], verts[i], verts[i+2]);
        }
      }
      break;

    case GX_DRAW_TRIFAN:
      for (let i = 1; i + 1 < verts.length; i++) {
        outIndices.push(verts[0], verts[i], verts[i+1]);
      }
      break;

    case GX_DRAW_QUADS:
      for (let i = 0; i + 3 < verts.length; i += 4) {
        outIndices.push(verts[i], verts[i+1], verts[i+2]);
        outIndices.push(verts[i], verts[i+2], verts[i+3]);
      }
      break;

    // Lines/points - skip for 3D terrain rendering
    default:
      break;
  }
}

// ===========================================================
// Material / Texture link parsers (minimal)
// ===========================================================

function parseMaterial(reader, offset) {
  reader.seek(offset);
  const length = reader.readU32();
  const mdl0Off = reader.readI32();
  const nameOff = reader.readI32();

  // Read material name
  const name = nameOff ? reader.readStringAt(offset + 0x0C + nameOff) : 'material';

  return { name };
}

function parseTextureLink(reader, offset) {
  reader.seek(offset);
  const length = reader.readU32();
  const mdl0Off = reader.readI32();
  const nameOff = reader.readI32();

  // Read texture name
  const name = nameOff ? reader.readStringAt(offset + 0x08 + nameOff) : null;

  return { name };
}
