/**
 * Top-level orchestrator for .dat file loading.
 * Coordinates format detection, decompression, extraction, parsing,
 * and conversion to Three.js objects.
 */
import * as THREE from 'three';
import { BinaryReader } from './reader.js';
import { detectFormat, Format, scanForEmbeddedFormats } from './detect.js';
import { decompressYaz0 } from './yaz0.js';
import { extractU8 } from './u8.js';
import { extractRARC } from './rarc.js';
import { parseBRRES } from './brres.js';
import { parseMDL0 } from './mdl0.js';
import { parseTEX0, parseTPL } from './tex0.js';
import { convertToThreeJS, scaleToWorld } from './converter.js';
import { extractCourseData } from './course.js';
import { handleUnknownFormat, rawVerticesToModel } from './fallback.js';

/**
 * @typedef {Object} DatLoadResult
 * @property {THREE.Group} terrainGroup - the terrain mesh group
 * @property {string[]} diagnostics - diagnostic messages
 * @property {{ lifts: Object[]|null, runs: Object|null }} courseData
 */

/**
 * Load and parse a .dat file, returning Three.js objects.
 * @param {ArrayBuffer} buffer - the raw .dat file contents
 * @param {Function} [onProgress] - (percent, message) callback
 * @param {THREE.Material} [snowMaterial] - optional material for terrain
 * @returns {Promise<DatLoadResult>}
 */
export async function loadFromDat(buffer, onProgress, snowMaterial) {
  const progress = onProgress || (() => {});
  const diagnostics = [];

  diagnostics.push(`File size: ${buffer.byteLength} bytes`);
  progress(5, 'Detecting file format...');
  await yieldFrame();

  // -- Step 1: Format detection --
  let { format, reader } = detectFormat(buffer);
  diagnostics.push(`Detected format: ${format}`);

  // -- Step 2: Decompress if Yaz0 --
  if (format === Format.YAZ0) {
    progress(8, 'Decompressing Yaz0...');
    await yieldFrame();
    buffer = decompressYaz0(buffer);
    diagnostics.push(`Decompressed to ${buffer.byteLength} bytes`);
    const redetect = detectFormat(buffer);
    format = redetect.format;
    reader = redetect.reader;
    diagnostics.push(`Inner format: ${format}`);
  }

  progress(10, 'Extracting archive...');
  await yieldFrame();

  // -- Step 3: Extract files from archive --
  let extractedFiles = [];
  let models = [];
  let textures = [];

  switch (format) {
    case Format.BRRES: {
      progress(15, 'Parsing BRRES archive...');
      await yieldFrame();
      const brres = parseBRRES(buffer);
      models = brres.models;
      textures = brres.textures;
      diagnostics.push(`BRRES: ${models.length} model(s), ${textures.length} texture(s)`);
      break;
    }

    case Format.U8: {
      progress(15, 'Extracting U8 archive...');
      await yieldFrame();
      extractedFiles = extractU8(buffer);
      diagnostics.push(`U8 archive: ${extractedFiles.length} file(s)`);
      break;
    }

    case Format.RARC: {
      progress(15, 'Extracting RARC archive...');
      await yieldFrame();
      extractedFiles = extractRARC(buffer);
      diagnostics.push(`RARC archive: ${extractedFiles.length} file(s)`);
      break;
    }

    case Format.BMD: {
      progress(15, 'Parsing BMD model...');
      await yieldFrame();
      // BMD is similar to MDL0 but with different structure
      // For now, try MDL0 parser as fallback
      try {
        const model = parseMDL0(buffer);
        models.push(model);
      } catch (e) {
        diagnostics.push(`BMD parse failed: ${e.message}`);
      }
      break;
    }

    case Format.TPL: {
      progress(15, 'Parsing TPL textures...');
      await yieldFrame();
      try {
        const tpls = parseTPL(buffer);
        textures.push(...tpls);
      } catch (e) {
        diagnostics.push(`TPL parse failed: ${e.message}`);
      }
      break;
    }

    case Format.UNKNOWN:
    default: {
      progress(15, 'Analyzing unknown format...');
      await yieldFrame();
      const fallback = handleUnknownFormat(buffer);
      diagnostics.push(`Fallback method: ${fallback.method}`);
      diagnostics.push(...fallback.diagnostics);
      extractedFiles = fallback.files;
      break;
    }
  }

  // -- Step 4: Process extracted files (for archive formats) --
  if (extractedFiles.length > 0 && models.length === 0) {
    progress(25, `Processing ${extractedFiles.length} extracted files...`);
    await yieldFrame();

    diagnostics.push('Extracted files:');
    for (const f of extractedFiles) {
      diagnostics.push(`  - ${f.path} (${f.data.byteLength} bytes)`);
    }

    for (let i = 0; i < extractedFiles.length; i++) {
      const file = extractedFiles[i];
      const pct = 25 + (i / extractedFiles.length) * 20;
      progress(pct, `Parsing: ${file.path}`);

      const { format: subFormat } = detectFormat(file.data);

      try {
        switch (subFormat) {
          case Format.YAZ0: {
            const decompressed = decompressYaz0(file.data);
            const { format: innerFormat } = detectFormat(decompressed);
            if (innerFormat === Format.BRRES) {
              const brres = parseBRRES(decompressed);
              models.push(...brres.models);
              textures.push(...brres.textures);
            }
            break;
          }
          case Format.BRRES: {
            const brres = parseBRRES(file.data);
            models.push(...brres.models);
            textures.push(...brres.textures);
            break;
          }
          case Format.TPL: {
            const tpls = parseTPL(file.data);
            textures.push(...tpls);
            break;
          }
          default: {
            // Check if filename hints at type
            const name = file.path.toLowerCase();
            if (name.endsWith('.brres') || name.endsWith('.mdl0')) {
              try {
                const brres = parseBRRES(file.data);
                models.push(...brres.models);
                textures.push(...brres.textures);
              } catch {
                try {
                  const model = parseMDL0(file.data, file.path);
                  models.push(model);
                } catch {}
              }
            } else if (name.endsWith('.tpl')) {
              try {
                const tpls = parseTPL(file.data);
                textures.push(...tpls);
              } catch {}
            }
            break;
          }
        }
      } catch (e) {
        diagnostics.push(`  Failed to parse ${file.path}: ${e.message}`);
      }
    }
  }

  // If we still have no models, try raw vertex scanning on the original buffer
  if (models.length === 0) {
    progress(45, 'Scanning for raw vertex data...');
    await yieldFrame();

    const { scanForVertexData } = await import('./fallback.js');
    const view = new DataView(buffer);
    // Simple inline vertex scan
    let bestOffset = -1, bestCount = 0, curStart = -1, curCount = 0;
    const floatCount = Math.floor(buffer.byteLength / 4);
    for (let i = 0; i + 2 < floatCount; i += 3) {
      const off = i * 4;
      const x = view.getFloat32(off, false);
      const y = view.getFloat32(off + 4, false);
      const z = view.getFloat32(off + 8, false);
      if (isFinite(x) && isFinite(y) && isFinite(z) &&
          Math.abs(x) < 100000 && Math.abs(y) < 100000 && Math.abs(z) < 100000 &&
          (Math.abs(x) > 0.001 || Math.abs(y) > 0.001 || Math.abs(z) > 0.001)) {
        if (curStart < 0) curStart = off;
        curCount++;
      } else {
        if (curCount > bestCount) { bestOffset = curStart; bestCount = curCount; }
        curStart = -1; curCount = 0;
      }
    }
    if (curCount > bestCount) { bestOffset = curStart; bestCount = curCount; }

    if (bestCount >= 100) {
      diagnostics.push(`Raw vertex scan: ${bestCount} vertices at offset 0x${bestOffset.toString(16)}`);
      const rawModel = rawVerticesToModel(buffer, { offset: bestOffset, count: bestCount });
      models.push(rawModel);
    }
  }

  diagnostics.push(`Total: ${models.length} model(s), ${textures.length} texture(s)`);

  // -- Step 5: Convert to Three.js --
  progress(60, 'Building 3D geometry...');
  await yieldFrame();

  if (models.length === 0) {
    diagnostics.push('ERROR: No 3D model data could be extracted.');
    console.error('DAT Loader Diagnostics:', diagnostics);
    throw new Error('No 3D model data found in file. Check console for diagnostics.');
  }

  const terrainGroup = convertToThreeJS(models, textures, snowMaterial);
  diagnostics.push(`Three.js group: ${terrainGroup.children.length} mesh(es)`);

  // -- Step 6: Extract course data --
  progress(70, 'Looking for course data...');
  await yieldFrame();
  const courseData = extractCourseData(extractedFiles);

  // Log diagnostics
  console.log('=== DAT Loader Diagnostics ===');
  for (const d of diagnostics) console.log(d);
  console.log('==============================');

  progress(75, 'Terrain extraction complete');

  return {
    terrainGroup,
    diagnostics,
    courseData,
  };
}

function yieldFrame() {
  return new Promise(resolve => setTimeout(resolve, 0));
}
