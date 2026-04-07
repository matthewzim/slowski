/**
 * Terrain system for Jamboree Snow Resort
 * Generates procedural mountain terrain with realistic Whistler Blackcomb-style
 * topography and builds a heightmap for physics queries.
 */

import * as THREE from 'three';

// -- World configuration --
export const TERRAIN_CONFIG = {
  worldWidth: 15000,
  worldDepth: 15000,
  resolution: 512,
  minElevation: 630,
  maxElevation: 2470,
  baseElevation: 630,
  verticalScale: 1.0,
};

// -- Coordinate conversion --

export function normalizedToWorld(nx, ny) {
  return {
    x: (nx - 0.5) * TERRAIN_CONFIG.worldWidth,
    z: (ny - 0.5) * TERRAIN_CONFIG.worldDepth,
  };
}

export function worldToNormalized(x, z) {
  return {
    nx: x / TERRAIN_CONFIG.worldWidth + 0.5,
    ny: z / TERRAIN_CONFIG.worldDepth + 0.5,
  };
}

// -- Simplex-style noise helpers --

function _hash(x, y) {
  let h = (x * 374761393 + y * 668265263 + 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h = Math.imul(h ^ (h >>> 16), 2654435769);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function _smoothNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  // Quintic interpolation for smoother results
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = _hash(ix, iz);
  const b = _hash(ix + 1, iz);
  const c = _hash(ix, iz + 1);
  const d = _hash(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

function fbmNoise(x, z, octaves, lacunarity, gain) {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxVal = 0;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * _smoothNoise(x * frequency, z * frequency);
    maxVal += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return value / maxVal;
}

function ridgeNoise(x, z, octaves, lacunarity, gain) {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxVal = 0;
  for (let i = 0; i < octaves; i++) {
    let n = _smoothNoise(x * frequency, z * frequency);
    n = 1.0 - Math.abs(n * 2 - 1); // Ridge transform
    n = n * n; // Sharpen ridges
    value += amplitude * n;
    maxVal += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return value / maxVal;
}

/**
 * Generate mountain-terrain elevation for a given normalized position (0-1).
 * Returns elevation in meters (minElevation..maxElevation).
 */
function terrainElevation(nx, nz) {
  const { minElevation, maxElevation } = TERRAIN_CONFIG;
  const range = maxElevation - minElevation;

  // Large-scale mountain shape: peaks toward centre-top, valley at bottom
  // nx,nz in [0,1] - nz=0 is north (top of mountain), nz=1 is south (base)
  const cx = nx - 0.5;
  const cz = nz - 0.5;

  // Base gradient: higher in the north, lower in the south (ski-resort style)
  const gradientNS = 1.0 - nz; // 1 at north, 0 at south

  // Two main peaks (Whistler + Blackcomb style)
  const peak1x = 0.35, peak1z = 0.2;
  const peak2x = 0.65, peak2z = 0.25;
  const d1 = Math.sqrt((nx - peak1x) ** 2 + (nz - peak1z) ** 2);
  const d2 = Math.sqrt((nx - peak2x) ** 2 + (nz - peak2z) ** 2);
  const peakInfluence1 = Math.max(0, 1.0 - d1 * 3.0);
  const peakInfluence2 = Math.max(0, 1.0 - d2 * 3.0);
  const peaks = Math.max(peakInfluence1, peakInfluence2);

  // Broad mountain envelope
  const distFromCenter = Math.sqrt(cx * cx + cz * cz) * 2;
  const envelope = Math.max(0, 1.0 - distFromCenter * 0.8);

  // Combine large-scale features
  const macro = gradientNS * 0.5 + peaks * 0.35 + envelope * 0.15;

  // Multi-octave noise for terrain detail
  const baseFreq = 4.0;
  const n1 = fbmNoise(nx * baseFreq + 7.3, nz * baseFreq + 2.1, 6, 2.0, 0.5);
  const n2 = ridgeNoise(nx * baseFreq * 0.7 + 13.7, nz * baseFreq * 0.7 + 5.3, 5, 2.2, 0.45);

  // Valley/drainage channels running roughly north-south
  const valleyFreq = 2.5;
  const valleyNoise = fbmNoise(nx * valleyFreq + 31.2, nz * valleyFreq * 0.5 + 11.7, 3, 2.0, 0.5);
  const valley = Math.pow(Math.abs(valleyNoise * 2 - 1), 1.5) * 0.15;

  // Combine everything
  let h = macro * 0.65 + n1 * 0.15 + n2 * 0.15 - valley;

  // Clamp and map to elevation range
  h = Math.max(0, Math.min(1, h));

  // Apply power curve for more dramatic peaks
  h = Math.pow(h, 1.3);

  return minElevation + h * range;
}

/**
 * Load the GLB terrain model, apply procedural elevation to its geometry
 * (the GLB is a flat satellite-image export), apply snow material,
 * and build a heightmap.
 *
 * Returns { mesh, heightmap, resolution }.
 */
export async function loadTerrainFromGLB(snowMaterial, onProgress) {
  if (onProgress) onProgress(10, 'Loading terrain model...');

  // The GLB model is flat (no elevation data) so we generate a proper
  // displaced terrain mesh procedurally.
  const { worldWidth, worldDepth } = TERRAIN_CONFIG;
  const gridRes = 512; // subdivision for the terrain mesh

  if (onProgress) onProgress(20, 'Generating terrain geometry...');

  const geometry = new THREE.PlaneGeometry(worldWidth, worldDepth, gridRes - 1, gridRes - 1);
  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.attributes.position.array;
  const vertCount = gridRes * gridRes;

  for (let i = 0; i < vertCount; i++) {
    const x = positions[i * 3];
    const z = positions[i * 3 + 2];
    // Convert world position to normalized [0,1]
    const nx = x / worldWidth + 0.5;
    const nz = z / worldDepth + 0.5;
    const elev = terrainElevation(nx, nz);
    positions[i * 3 + 1] = elev - TERRAIN_CONFIG.baseElevation;
  }

  geometry.computeVertexNormals();
  geometry.attributes.position.needsUpdate = true;

  if (onProgress) onProgress(40, 'Building heightmap...');

  const terrainMesh = new THREE.Mesh(geometry, snowMaterial);
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = true;

  // Build heightmap directly from the elevation function (faster than raycasting)
  const resolution = TERRAIN_CONFIG.resolution;
  const heightmap = new Float32Array(resolution * resolution);
  for (let iy = 0; iy < resolution; iy++) {
    for (let ix = 0; ix < resolution; ix++) {
      const nx = ix / (resolution - 1);
      const nz = iy / (resolution - 1);
      heightmap[iy * resolution + ix] = terrainElevation(nx, nz);
    }
    if (onProgress && iy % 64 === 0) {
      const pct = 40 + Math.round((iy / resolution) * 40);
      onProgress(pct, 'Building heightmap...');
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  if (onProgress) onProgress(80, 'Terrain ready');

  return { mesh: terrainMesh, heightmap, resolution };
}

/**
 * Generate procedural heightmap (legacy fallback).
 */
export function generateProceduralHeightmap(resolution = TERRAIN_CONFIG.resolution) {
  const heightmap = new Float32Array(resolution * resolution);
  for (let iy = 0; iy < resolution; iy++) {
    for (let ix = 0; ix < resolution; ix++) {
      const nx = ix / (resolution - 1);
      const nz = iy / (resolution - 1);
      heightmap[iy * resolution + ix] = terrainElevation(nx, nz);
    }
  }
  return heightmap;
}

// -- Terrain mesh creation (legacy, kept for API compatibility) --

export function createTerrainMesh(heightmap, resolution, material) {
  const { worldWidth, worldDepth, baseElevation, verticalScale } = TERRAIN_CONFIG;

  const geometry = new THREE.PlaneGeometry(
    worldWidth, worldDepth,
    resolution - 1, resolution - 1
  );
  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.attributes.position.array;

  for (let i = 0; i < resolution * resolution; i++) {
    const elevation = (heightmap[i] - baseElevation) * verticalScale;
    positions[i * 3 + 1] = elevation;
  }

  geometry.computeVertexNormals();
  geometry.attributes.position.needsUpdate = true;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Get terrain height at world position (x, z) by bilinear interpolation.
 */
export function getHeightAt(x, z, heightmap, resolution = TERRAIN_CONFIG.resolution) {
  const { worldWidth, worldDepth, baseElevation, verticalScale } = TERRAIN_CONFIG;

  const nx = (x / worldWidth + 0.5) * (resolution - 1);
  const ny = (z / worldDepth + 0.5) * (resolution - 1);

  const ix = Math.floor(nx);
  const iy = Math.floor(ny);

  if (ix < 0 || ix >= resolution - 1 || iy < 0 || iy >= resolution - 1) {
    return 0;
  }

  const fx = nx - ix;
  const fy = ny - iy;

  const h00 = heightmap[iy * resolution + ix];
  const h10 = heightmap[iy * resolution + ix + 1];
  const h01 = heightmap[(iy + 1) * resolution + ix];
  const h11 = heightmap[(iy + 1) * resolution + ix + 1];

  const h0 = h00 * (1 - fx) + h10 * fx;
  const h1 = h01 * (1 - fx) + h11 * fx;
  const h = h0 * (1 - fy) + h1 * fy;

  return (h - baseElevation) * verticalScale;
}

export function getNormalAt(x, z, heightmap, resolution = TERRAIN_CONFIG.resolution) {
  const delta = TERRAIN_CONFIG.worldWidth / resolution;
  const hL = getHeightAt(x - delta, z, heightmap, resolution);
  const hR = getHeightAt(x + delta, z, heightmap, resolution);
  const hU = getHeightAt(x, z - delta, heightmap, resolution);
  const hD = getHeightAt(x, z + delta, heightmap, resolution);

  const normal = new THREE.Vector3(hL - hR, 2 * delta, hU - hD);
  normal.normalize();
  return normal;
}

export function getSlopeAt(x, z, heightmap, resolution = TERRAIN_CONFIG.resolution) {
  const normal = getNormalAt(x, z, heightmap, resolution);
  return Math.acos(normal.y);
}

export function getElevationAt(x, z, heightmap, resolution = TERRAIN_CONFIG.resolution) {
  return getHeightAt(x, z, heightmap, resolution) + TERRAIN_CONFIG.baseElevation;
}
