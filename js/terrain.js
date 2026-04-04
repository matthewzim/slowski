/**
 * Terrain system for Whistler Blackcomb
 * Generates heightmap from elevation data and creates displaced PlaneGeometry.
 *
 * The terrain is based on real elevation data from the Blackcomb Mountain area:
 * - Blackcomb Peak: 2436m
 * - The Spearhead: 2457m
 * - Phalanx Mountain: 2441m
 * - Village base: ~650m
 * - Horstman Glacier: ~2200m
 */

import * as THREE from 'three';

// -- Elevation color legend from heatmap (color → meters) --
// Colors sampled from the heatmap legend, ordered high to low
const ELEVATION_LEGEND = [
  { r: 255, g: 255, b: 255, elevation: 2464 }, // white - highest
  { r: 255, g: 230, b: 230, elevation: 2348 }, // very light pink
  { r: 255, g: 200, b: 200, elevation: 2232 }, // light pink
  { r: 255, g: 170, b: 170, elevation: 2119 }, // pink
  { r: 255, g: 130, b: 130, elevation: 2007 }, // salmon
  { r: 255, g: 100, b: 80,  elevation: 1896 }, // orange-red
  { r: 255, g: 140, b: 50,  elevation: 1787 }, // orange
  { r: 255, g: 170, b: 30,  elevation: 1680 }, // dark yellow-orange
  { r: 255, g: 200, b: 50,  elevation: 1575 }, // yellow-orange
  { r: 255, g: 230, b: 80,  elevation: 1472 }, // yellow
  { r: 220, g: 240, b: 60,  elevation: 1371 }, // yellow-green
  { r: 180, g: 230, b: 70,  elevation: 1272 }, // light green
  { r: 130, g: 210, b: 80,  elevation: 1176 }, // green
  { r: 80,  g: 190, b: 90,  elevation: 1083 }, // medium green
  { r: 50,  g: 180, b: 100, elevation: 993  }, // teal-green
  { r: 40,  g: 190, b: 140, elevation: 907  }, // teal
  { r: 60,  g: 200, b: 180, elevation: 826  }, // light teal
  { r: 100, g: 200, b: 220, elevation: 750  }, // light blue
  { r: 80,  g: 170, b: 230, elevation: 682  }, // blue
  { r: 60,  g: 130, b: 200, elevation: 631  }, // dark blue - lowest
];

// -- World configuration --
export const TERRAIN_CONFIG = {
  // World dimensions in Three.js units (1 unit ≈ 1 meter)
  worldWidth: 3000,
  worldDepth: 3000,
  // Heightmap resolution
  resolution: 256,
  // Elevation range
  minElevation: 630,
  maxElevation: 2470,
  // The base elevation (sea level offset) - we subtract this so village is near y=0
  baseElevation: 630,
  // Vertical scale factor
  verticalScale: 1.0,
};

/**
 * Convert an RGB color to an elevation value using the heatmap legend.
 * Uses nearest-color matching with interpolation.
 */
export function getElevationFromColor(r, g, b) {
  let bestDist = Infinity;
  let bestIdx = 0;

  for (let i = 0; i < ELEVATION_LEGEND.length; i++) {
    const c = ELEVATION_LEGEND[i];
    const dr = r - c.r;
    const dg = g - c.g;
    const db = b - c.b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }

  // Try to interpolate with neighbor for smoother results
  const best = ELEVATION_LEGEND[bestIdx];
  const bestD = Math.sqrt(bestDist);

  if (bestD < 5) return best.elevation;

  // Find second best for interpolation
  let secondIdx = bestIdx > 0 ? bestIdx - 1 : bestIdx + 1;
  if (secondIdx >= ELEVATION_LEGEND.length) secondIdx = ELEVATION_LEGEND.length - 1;

  const second = ELEVATION_LEGEND[secondIdx];
  const dr2 = r - second.r, dg2 = g - second.g, db2 = b - second.b;
  const secondD = Math.sqrt(dr2 * dr2 + dg2 * dg2 + db2 * db2);

  const total = bestD + secondD;
  if (total < 0.001) return best.elevation;

  const t = bestD / total;
  return best.elevation * (1 - t) + second.elevation * t;
}

/**
 * Generate a heightmap array from an image element (heatmap).
 * Returns Float32Array of dimensions resolution x resolution.
 */
export function generateHeightmapFromImage(image, resolution = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = resolution;
  canvas.height = resolution;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, resolution, resolution);
  const imageData = ctx.getImageData(0, 0, resolution, resolution);
  const data = imageData.data;

  const heightmap = new Float32Array(resolution * resolution);

  for (let i = 0; i < resolution * resolution; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    heightmap[i] = getElevationFromColor(r, g, b);
  }

  return heightmap;
}

// -- Procedural terrain generation based on reference data --

// Simple 2D noise implementation
function hash(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return h;
}

function smoothNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const n00 = (hash(ix, iy) & 0xffff) / 65535;
  const n10 = (hash(ix + 1, iy) & 0xffff) / 65535;
  const n01 = (hash(ix, iy + 1) & 0xffff) / 65535;
  const n11 = (hash(ix + 1, iy + 1) & 0xffff) / 65535;

  const nx0 = n00 * (1 - sx) + n10 * sx;
  const nx1 = n01 * (1 - sx) + n11 * sx;

  return nx0 * (1 - sy) + nx1 * sy;
}

function fbm(x, y, octaves = 6) {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxVal = 0;

  for (let i = 0; i < octaves; i++) {
    value += smoothNoise(x * frequency, y * frequency) * amplitude;
    maxVal += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return value / maxVal;
}

/**
 * Control points for the Blackcomb terrain.
 * Coordinates are in normalized space (0-1) matching the heatmap image.
 * Format: { nx, ny, elevation, radius, falloff }
 */
const CONTROL_POINTS = [
  // Blackcomb Peak (south-center of map)
  { nx: 0.45, ny: 0.88, elevation: 2436, radius: 0.15, falloff: 1.2 },
  // The Spearhead (south-east)
  { nx: 0.55, ny: 0.82, elevation: 2457, radius: 0.12, falloff: 1.0 },
  // Phalanx Mountain (east)
  { nx: 0.65, ny: 0.55, elevation: 2441, radius: 0.12, falloff: 1.1 },
  // Blackcomb Glacier area
  { nx: 0.50, ny: 0.70, elevation: 2300, radius: 0.15, falloff: 0.8 },
  // Horstman Glacier
  { nx: 0.38, ny: 0.72, elevation: 2200, radius: 0.12, falloff: 0.9 },
  // Crystal Ridge area (upper mountain)
  { nx: 0.55, ny: 0.35, elevation: 1900, radius: 0.18, falloff: 0.7 },
  // Mid-mountain (Excelerator area)
  { nx: 0.35, ny: 0.40, elevation: 1650, radius: 0.15, falloff: 0.6 },
  // Catskinner area
  { nx: 0.30, ny: 0.55, elevation: 1500, radius: 0.12, falloff: 0.7 },
  // 7th Heaven area
  { nx: 0.60, ny: 0.65, elevation: 2100, radius: 0.15, falloff: 0.8 },
  // Spearhead Glacier (far east)
  { nx: 0.80, ny: 0.60, elevation: 2200, radius: 0.18, falloff: 1.0 },
  // Village base area (northwest)
  { nx: 0.08, ny: 0.12, elevation: 670, radius: 0.12, falloff: 0.5 },
  // Blackcomb base
  { nx: 0.10, ny: 0.18, elevation: 680, radius: 0.10, falloff: 0.5 },
  // Lower mountain transition
  { nx: 0.20, ny: 0.25, elevation: 1100, radius: 0.15, falloff: 0.6 },
  // Decker Glacier (far southeast)
  { nx: 0.85, ny: 0.90, elevation: 2100, radius: 0.15, falloff: 1.0 },
  // Ridge between peaks
  { nx: 0.50, ny: 0.78, elevation: 2350, radius: 0.10, falloff: 1.0 },
  // Northwest slopes
  { nx: 0.15, ny: 0.35, elevation: 1200, radius: 0.12, falloff: 0.6 },
  // Glacier Express top
  { nx: 0.55, ny: 0.50, elevation: 1850, radius: 0.10, falloff: 0.7 },
];

/**
 * Generate procedural heightmap based on Whistler Blackcomb reference data.
 * Returns a Float32Array of resolution*resolution elevation values.
 */
export function generateProceduralHeightmap(resolution = TERRAIN_CONFIG.resolution) {
  const heightmap = new Float32Array(resolution * resolution);

  for (let iy = 0; iy < resolution; iy++) {
    for (let ix = 0; ix < resolution; ix++) {
      const nx = ix / (resolution - 1);
      const ny = iy / (resolution - 1);

      // Base elevation gradient: rises from NW to SE
      let elevation = 650 + (nx + ny) * 0.5 * 900;

      // Apply control points using inverse distance weighting
      let totalWeight = 0;
      let weightedElev = 0;

      for (const cp of CONTROL_POINTS) {
        const dx = nx - cp.nx;
        const dy = ny - cp.ny;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < cp.radius * 2.5) {
          const t = Math.max(0, 1 - dist / (cp.radius * 2.5));
          const weight = Math.pow(t, cp.falloff) * 3.0;
          weightedElev += cp.elevation * weight;
          totalWeight += weight;
        }
      }

      // Broader IDW pass for overall shape
      let idwElev = 0;
      let idwWeight = 0;
      for (const cp of CONTROL_POINTS) {
        const dx = nx - cp.nx;
        const dy = ny - cp.ny;
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const w = 1 / (dist * dist * dist);
        idwElev += cp.elevation * w;
        idwWeight += w;
      }

      if (idwWeight > 0) {
        elevation = idwElev / idwWeight;
      }

      // Blend with local control points for sharper features
      if (totalWeight > 0.5) {
        const localElev = weightedElev / totalWeight;
        const blendFactor = Math.min(1, (totalWeight - 0.5) * 0.8);
        elevation = elevation * (1 - blendFactor) + localElev * blendFactor;
      }

      // Add fractal noise for terrain detail
      const noiseScale = 0.008;
      const noise1 = fbm(ix * noiseScale, iy * noiseScale, 6);
      const noise2 = fbm(ix * noiseScale * 2.7 + 100, iy * noiseScale * 2.7 + 100, 4);

      // Larger features
      elevation += (noise1 - 0.5) * 180;
      // Smaller ridges and gullies
      elevation += (noise2 - 0.5) * 60;

      // Add some ridge-like features at high elevation
      if (elevation > 1800) {
        const ridgeNoise = fbm(ix * 0.02 + 50, iy * 0.02 + 50, 3);
        const ridgeStrength = Math.min(1, (elevation - 1800) / 400) * 80;
        elevation += (ridgeNoise - 0.5) * ridgeStrength;
      }

      // Clamp
      elevation = Math.max(TERRAIN_CONFIG.minElevation, Math.min(TERRAIN_CONFIG.maxElevation, elevation));

      heightmap[iy * resolution + ix] = elevation;
    }
  }

  // Smooth the heightmap slightly to reduce harsh transitions
  return smoothHeightmap(heightmap, resolution, 2);
}

function smoothHeightmap(heightmap, resolution, passes) {
  const temp = new Float32Array(heightmap.length);
  let src = heightmap;
  let dst = temp;

  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < resolution && ny >= 0 && ny < resolution) {
              sum += src[ny * resolution + nx];
              count++;
            }
          }
        }
        dst[y * resolution + x] = sum / count;
      }
    }
    [src, dst] = [dst, src];
  }

  if (src !== heightmap) heightmap.set(src);
  return heightmap;
}

// -- Coordinate conversion --

/**
 * Convert image pixel coordinates to world (x, z) coordinates.
 * Image space: (0,0) top-left, (width, height) bottom-right
 * World space: centered on terrain
 */
export function imageToWorld(xPixel, yPixel, imageWidth = TERRAIN_CONFIG.resolution, imageHeight = TERRAIN_CONFIG.resolution) {
  const nx = xPixel / imageWidth;
  const ny = yPixel / imageHeight;

  const x = (nx - 0.5) * TERRAIN_CONFIG.worldWidth;
  const z = (ny - 0.5) * TERRAIN_CONFIG.worldDepth;

  return { x, z };
}

/**
 * Convert normalized (0-1) coordinates to world coordinates.
 */
export function normalizedToWorld(nx, ny) {
  return {
    x: (nx - 0.5) * TERRAIN_CONFIG.worldWidth,
    z: (ny - 0.5) * TERRAIN_CONFIG.worldDepth,
  };
}

/**
 * Convert world coordinates to normalized (0-1) coordinates.
 */
export function worldToNormalized(x, z) {
  return {
    nx: x / TERRAIN_CONFIG.worldWidth + 0.5,
    ny: z / TERRAIN_CONFIG.worldDepth + 0.5,
  };
}

// -- Terrain mesh creation --

/**
 * Create the terrain mesh from a heightmap.
 */
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

  // Convert world coords to heightmap indices
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

/**
 * Get terrain normal at world position.
 */
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

/**
 * Get slope angle in radians at world position.
 */
export function getSlopeAt(x, z, heightmap, resolution = TERRAIN_CONFIG.resolution) {
  const normal = getNormalAt(x, z, heightmap, resolution);
  return Math.acos(normal.y);
}

/**
 * Get raw elevation in meters at world position.
 */
export function getElevationAt(x, z, heightmap, resolution = TERRAIN_CONFIG.resolution) {
  return getHeightAt(x, z, heightmap, resolution) + TERRAIN_CONFIG.baseElevation;
}
