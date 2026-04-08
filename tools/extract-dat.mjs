#!/usr/bin/env node
/**
 * extract-dat.mjs
 *
 * Offline extraction tool for Wii .dat game files.
 * Reads ski.dat, parses Wii binary formats (Yaz0, U8, RARC, BRRES, MDL0, TEX0),
 * and outputs Three.js-compatible .glb and .png files.
 *
 * Usage:
 *   npm install
 *   node tools/extract-dat.mjs [path-to-ski.dat]
 *
 * Default input:  ./ski.dat
 * Output:         ./extracted/  (terrain.glb, textures/*.png, manifest.json)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, basename } from 'path';

// -- Import our parsers (pure JS, no browser deps) --
import { BinaryReader } from '../js/dat/reader.js';
import { detectFormat, Format, scanForEmbeddedFormats } from '../js/dat/detect.js';
import { decompressYaz0 } from '../js/dat/yaz0.js';
import { extractU8 } from '../js/dat/u8.js';
import { extractRARC } from '../js/dat/rarc.js';
import { parseBRRES } from '../js/dat/brres.js';
import { parseMDL0 } from '../js/dat/mdl0.js';
import { parseTEX0, parseTPL } from '../js/dat/tex0.js';
import { handleUnknownFormat, rawVerticesToModel } from '../js/dat/fallback.js';

// -- Import Three.js for GLB construction --
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

// ============================================================
// Main
// ============================================================

const inputPath = process.argv[2] || 'ski.dat';
const outputDir = resolve('extracted');

console.log('=== Wii .dat Extraction Tool ===');
console.log(`Input:  ${resolve(inputPath)}`);
console.log(`Output: ${outputDir}`);
console.log('');

if (!existsSync(inputPath)) {
  console.error(`Error: File not found: ${inputPath}`);
  console.error('Usage: node tools/extract-dat.mjs [path-to-ski.dat]');
  process.exit(1);
}

// Create output directories
mkdirSync(outputDir, { recursive: true });
mkdirSync(join(outputDir, 'textures'), { recursive: true });
mkdirSync(join(outputDir, 'raw'), { recursive: true });

// Read file
console.log('Reading file...');
let buffer = readFileSync(inputPath).buffer;
console.log(`File size: ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB`);

// -- Step 1: Detect and decompress --
let { format } = detectFormat(buffer);
console.log(`Detected format: ${format}`);

if (format === Format.YAZ0) {
  console.log('Decompressing Yaz0...');
  buffer = decompressYaz0(buffer);
  console.log(`Decompressed size: ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB`);
  const redetect = detectFormat(buffer);
  format = redetect.format;
  console.log(`Inner format: ${format}`);
}

// -- Step 2: Extract --
let extractedFiles = [];
let models = [];
let textures = [];

switch (format) {
  case Format.BRRES: {
    console.log('Parsing BRRES archive...');
    const brres = parseBRRES(buffer);
    models = brres.models;
    textures = brres.textures;
    break;
  }
  case Format.U8: {
    console.log('Extracting U8 archive...');
    extractedFiles = extractU8(buffer);
    break;
  }
  case Format.RARC: {
    console.log('Extracting RARC archive...');
    extractedFiles = extractRARC(buffer);
    break;
  }
  case Format.UNKNOWN:
  default: {
    console.log('Unknown format, running heuristic analysis...');
    const fallback = handleUnknownFormat(buffer);
    console.log(`Fallback method: ${fallback.method}`);
    for (const d of fallback.diagnostics) console.log(`  ${d}`);
    extractedFiles = fallback.files;
    break;
  }
}

// -- Step 3: Process extracted files --
if (extractedFiles.length > 0) {
  console.log(`\nExtracted ${extractedFiles.length} file(s):`);
  for (const f of extractedFiles) {
    console.log(`  ${f.path} (${(f.data.byteLength / 1024).toFixed(1)} KB)`);
  }

  // Save raw extracted files for inspection
  for (const f of extractedFiles) {
    const safeName = f.path.replace(/[/\\]/g, '_');
    writeFileSync(join(outputDir, 'raw', safeName), Buffer.from(f.data));
  }
  console.log(`\nRaw files saved to ${join(outputDir, 'raw')}/`);

  // Try parsing each extracted file
  if (models.length === 0) {
    console.log('\nParsing extracted files...');
    for (const file of extractedFiles) {
      let fileBuffer = file.data;
      let { format: subFormat } = detectFormat(fileBuffer);

      // Decompress if Yaz0
      if (subFormat === Format.YAZ0) {
        try {
          fileBuffer = decompressYaz0(fileBuffer);
          subFormat = detectFormat(fileBuffer).format;
          console.log(`  ${file.path}: Yaz0 → ${subFormat}`);
        } catch (e) {
          console.warn(`  ${file.path}: Yaz0 decompression failed: ${e.message}`);
          continue;
        }
      }

      try {
        switch (subFormat) {
          case Format.BRRES: {
            const brres = parseBRRES(fileBuffer);
            models.push(...brres.models);
            textures.push(...brres.textures);
            console.log(`  ${file.path}: BRRES → ${brres.models.length} model(s), ${brres.textures.length} texture(s)`);
            break;
          }
          case Format.TPL: {
            const tpls = parseTPL(fileBuffer);
            textures.push(...tpls);
            console.log(`  ${file.path}: TPL → ${tpls.length} texture(s)`);
            break;
          }
          default: {
            // Try BRRES by filename
            const name = file.path.toLowerCase();
            if (name.endsWith('.brres') || name.endsWith('.mdl0')) {
              try {
                const brres = parseBRRES(fileBuffer);
                models.push(...brres.models);
                textures.push(...brres.textures);
                console.log(`  ${file.path}: BRRES (by name) → ${brres.models.length} model(s)`);
              } catch {
                try {
                  const model = parseMDL0(fileBuffer, file.path);
                  if (model.vertices.length > 0) {
                    models.push(model);
                    console.log(`  ${file.path}: MDL0 → ${model.vertices.length / 3} vertices`);
                  }
                } catch {}
              }
            }
            break;
          }
        }
      } catch (e) {
        console.warn(`  ${file.path}: Parse failed: ${e.message}`);
      }
    }
  }
}

// -- Step 4: Raw vertex scan fallback --
if (models.length === 0) {
  console.log('\nNo models found, scanning for raw vertex data...');
  const view = new DataView(buffer);
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
    console.log(`Found ${bestCount} vertices at offset 0x${bestOffset.toString(16)}`);
    models.push(rawVerticesToModel(buffer, { offset: bestOffset, count: bestCount }));
  }
}

// -- Summary --
console.log(`\n=== Results ===`);
console.log(`Models:   ${models.length}`);
console.log(`Textures: ${textures.length}`);

if (models.length === 0) {
  console.error('\nNo 3D model data could be extracted.');
  console.log('\nThe raw extracted files have been saved to extracted/raw/');
  console.log('You can inspect them with a hex editor to determine the format.');

  // Write a hex dump of the first 512 bytes for debugging
  const headerBytes = new Uint8Array(buffer, 0, Math.min(512, buffer.byteLength));
  const hexLines = [];
  for (let i = 0; i < headerBytes.length; i += 16) {
    const hex = Array.from(headerBytes.slice(i, i + 16))
      .map(b => b.toString(16).padStart(2, '0'))
      .join(' ');
    const ascii = Array.from(headerBytes.slice(i, i + 16))
      .map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.')
      .join('');
    hexLines.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(48)}  ${ascii}`);
  }
  writeFileSync(join(outputDir, 'header-dump.txt'), hexLines.join('\n'));
  console.log(`Header hex dump saved to ${join(outputDir, 'header-dump.txt')}`);

  // Also scan for embedded known formats
  const embedded = scanForEmbeddedFormats(buffer);
  if (embedded.length > 0) {
    console.log(`\nEmbedded format signatures found:`);
    for (const e of embedded) {
      console.log(`  ${e.format} at offset 0x${e.offset.toString(16)}`);
    }
    writeFileSync(join(outputDir, 'embedded-formats.json'), JSON.stringify(embedded, null, 2));
  }

  process.exit(1);
}

// -- Step 5: Export textures as PNG --
console.log('\nExporting textures...');
for (let i = 0; i < textures.length; i++) {
  const tex = textures[i];
  if (!tex || !tex.pixels) continue;

  // Write raw RGBA data (can be converted to PNG with ImageMagick or similar)
  const name = (tex.name || `texture_${i}`).replace(/[^a-zA-Z0-9_.-]/g, '_');
  const rawPath = join(outputDir, 'textures', `${name}.rgba`);
  writeFileSync(rawPath, Buffer.from(tex.pixels));

  // Write a metadata file so we know the dimensions
  const metaPath = join(outputDir, 'textures', `${name}.json`);
  writeFileSync(metaPath, JSON.stringify({
    name: tex.name,
    width: tex.width,
    height: tex.height,
    format: tex.format,
    file: `${name}.rgba`,
  }, null, 2));

  console.log(`  ${name}: ${tex.width}x${tex.height}`);
}

// -- Step 6: Build Three.js scene and export GLB --
console.log('\nBuilding Three.js geometry...');

const scene = new THREE.Scene();

for (const model of models) {
  if (!model || model.vertices.length === 0) continue;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(model.vertices, 3));

  if (model.normals.length === model.vertices.length) {
    geometry.setAttribute('normal', new THREE.BufferAttribute(model.normals, 3));
  } else {
    geometry.computeVertexNormals();
  }

  if (model.uvs.length > 0) {
    geometry.setAttribute('uv', new THREE.BufferAttribute(model.uvs, 2));
  }

  if (model.indices.length > 0) {
    geometry.setIndex(new THREE.BufferAttribute(model.indices, 1));
  }

  // Try to find matching texture and embed as material
  let material;
  const texRef = model.textureRefs?.[0];
  const matchedTex = texRef ? textures.find(t => t.name === texRef || t.name === texRef.replace(/\.\w+$/, '')) : null;

  if (matchedTex && matchedTex.pixels) {
    const tex = new THREE.DataTexture(
      matchedTex.pixels,
      matchedTex.width,
      matchedTex.height,
      THREE.RGBAFormat
    );
    tex.needsUpdate = true;
    material = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide });
  } else {
    material = new THREE.MeshStandardMaterial({ color: 0xcccccc, side: THREE.DoubleSide });
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = model.name || 'mesh';
  scene.add(mesh);

  const vtxCount = model.vertices.length / 3;
  const triCount = model.indices.length / 3;
  console.log(`  ${mesh.name}: ${vtxCount} vertices, ${triCount} triangles`);
}

// Export to GLB
console.log('\nExporting GLB...');
const exporter = new GLTFExporter();

try {
  const glbData = await new Promise((resolve, reject) => {
    exporter.parse(scene, resolve, reject, { binary: true });
  });

  const glbBuffer = Buffer.from(glbData);
  const glbPath = join(outputDir, 'terrain.glb');
  writeFileSync(glbPath, glbBuffer);
  console.log(`GLB saved: ${glbPath} (${(glbBuffer.length / 1024 / 1024).toFixed(1)} MB)`);

  // Also copy to repo root for the game to load
  const repoGlbPath = resolve('ski-terrain.glb');
  writeFileSync(repoGlbPath, glbBuffer);
  console.log(`GLB copied to: ${repoGlbPath}`);
} catch (e) {
  console.error('GLB export failed:', e.message);
  console.log('Falling back to raw geometry export...');

  // Save raw geometry as JSON
  const geoData = models.map(m => ({
    name: m.name,
    vertexCount: m.vertices.length / 3,
    triangleCount: m.indices.length / 3,
    vertices: Array.from(m.vertices),
    normals: Array.from(m.normals),
    uvs: Array.from(m.uvs),
    indices: Array.from(m.indices),
  }));
  writeFileSync(join(outputDir, 'geometry.json'), JSON.stringify(geoData));
  console.log(`Raw geometry saved to ${join(outputDir, 'geometry.json')}`);
}

// -- Step 7: Write manifest --
const manifest = {
  source: basename(inputPath),
  sourceSize: buffer.byteLength,
  formatDetected: format,
  models: models.map(m => ({
    name: m.name,
    vertices: m.vertices.length / 3,
    triangles: m.indices.length / 3,
    hasNormals: m.normals.length > 0,
    hasUVs: m.uvs.length > 0,
    textureRefs: m.textureRefs,
  })),
  textures: textures.map(t => ({
    name: t.name,
    width: t.width,
    height: t.height,
    format: t.format,
  })),
  extractedFiles: extractedFiles.map(f => ({
    path: f.path,
    size: f.data.byteLength,
  })),
};

writeFileSync(join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log('\n=== Done ===');
console.log(`Output directory: ${outputDir}`);
console.log(`\nNext steps:`);
console.log(`  1. Check that ski-terrain.glb looks correct`);
console.log(`  2. The game will auto-load it on next page load`);
console.log(`  3. Commit ski-terrain.glb to the repo`);
