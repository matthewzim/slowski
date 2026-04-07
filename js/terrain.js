/**
 * Terrain system for Jamboree Snow Resort
 * Generates heightmap from control points and creates displaced PlaneGeometry.
 *
 * The terrain is based on the Jamboree Snow Resort trail map:
 * - Summit peak: ~2450m (lifts 6,8,9 top)
 * - Upper ridges: ~2200-2350m
 * - Mid-mountain bowls: ~1600-2000m
 * - Base village: ~680m
 * - 9 numbered chairlifts
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
 * Control points for the Jamboree Snow Resort terrain.
 * Coordinates are in normalized space (0-1).
 * ny=0 is the bottom (base village), ny=1 is the top (summit).
 */
const CONTROL_POINTS = [
  // === Summit & Upper Mountain ===
  // Main summit peak (lifts 6,8,9 top)
  { nx: 0.42, ny: 0.88, elevation: 2450, radius: 0.10, falloff: 1.3 },
  // Summit ridge extending right
  { nx: 0.52, ny: 0.86, elevation: 2380, radius: 0.08, falloff: 1.1 },
  // Secondary summit bump
  { nx: 0.36, ny: 0.92, elevation: 2350, radius: 0.07, falloff: 1.2 },
  // Upper cliff face (steep area between summit and upper-right)
  { nx: 0.56, ny: 0.82, elevation: 2320, radius: 0.06, falloff: 1.4 },

  // === Upper Ridges ===
  // Upper right ridge (lift 4 top area)
  { nx: 0.62, ny: 0.76, elevation: 2280, radius: 0.12, falloff: 1.0 },
  // Upper left ridge
  { nx: 0.28, ny: 0.78, elevation: 2150, radius: 0.10, falloff: 0.9 },
  // Lift 6/8/9 bottom station area
  { nx: 0.43, ny: 0.73, elevation: 2080, radius: 0.10, falloff: 0.8 },

  // === Mid-Mountain ===
  // Center bowl (lift 7 top area)
  { nx: 0.48, ny: 0.63, elevation: 1950, radius: 0.14, falloff: 0.8 },
  // Right shoulder (lift 2 top area)
  { nx: 0.72, ny: 0.56, elevation: 1800, radius: 0.12, falloff: 0.8 },
  // Left shoulder (lift 5 top area)
  { nx: 0.18, ny: 0.56, elevation: 1700, radius: 0.12, falloff: 0.7 },
  // Bowl between center and left
  { nx: 0.32, ny: 0.60, elevation: 1820, radius: 0.10, falloff: 0.7 },
  // Right approach ridge
  { nx: 0.65, ny: 0.48, elevation: 1650, radius: 0.12, falloff: 0.7 },

  // === Lower Mountain ===
  // Mid-mountain center (lift 7 bottom / lift 1 top)
  { nx: 0.46, ny: 0.38, elevation: 1350, radius: 0.15, falloff: 0.6 },
  // Right mid (lift 3 top / lift 2 bottom)
  { nx: 0.75, ny: 0.32, elevation: 1200, radius: 0.12, falloff: 0.7 },
  // Left mid (lift 5 bottom area)
  { nx: 0.12, ny: 0.40, elevation: 1100, radius: 0.10, falloff: 0.6 },
  // Lower center transition
  { nx: 0.48, ny: 0.26, elevation: 1000, radius: 0.14, falloff: 0.5 },

  // === Base Area ===
  // Base village center
  { nx: 0.48, ny: 0.10, elevation: 680, radius: 0.12, falloff: 0.4 },
  // Right base (lift 3 bottom)
  { nx: 0.82, ny: 0.12, elevation: 710, radius: 0.10, falloff: 0.4 },
  // Left base approach
  { nx: 0.15, ny: 0.15, elevation: 720, radius: 0.10, falloff: 0.4 },

  // === Edge Lowlands (force low elevation at map edges) ===
  { nx: 0.05, ny: 0.05, elevation: 640, radius: 0.10, falloff: 0.3 },
  { nx: 0.95, ny: 0.05, elevation: 640, radius: 0.10, falloff: 0.3 },
  { nx: 0.05, ny: 0.95, elevation: 700, radius: 0.10, falloff: 0.3 },
  { nx: 0.95, ny: 0.95, elevation: 700, radius: 0.10, falloff: 0.3 },
  { nx: 0.95, ny: 0.50, elevation: 660, radius: 0.12, falloff: 0.3 },
  { nx: 0.05, ny: 0.50, elevation: 660, radius: 0.12, falloff: 0.3 },
];

/**
 * Generate procedural heightmap for Jamboree Snow Resort.
 * Returns a Float32Array of resolution*resolution elevation values.
 */
export function generateProceduralHeightmap(resolution = TERRAIN_CONFIG.resolution) {
  const heightmap = new Float32Array(resolution * resolution);

  for (let iy = 0; iy < resolution; iy++) {
    for (let ix = 0; ix < resolution; ix++) {
      const nx = ix / (resolution - 1);
      const ny = iy / (resolution - 1);

      // Base elevation gradient: rises from bottom to top, centered horizontally
      let elevation = 650 + ny * 1100;

      // Taper edges to create mountain shape (lower at sides)
      const distFromCenterX = Math.abs(nx - 0.48);
      if (distFromCenterX > 0.25) {
        const taper = (distFromCenterX - 0.25) / 0.25;
        elevation -= taper * taper * 500;
      }

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
      elevation += (noise1 - 0.5) * 160;
      // Smaller ridges and gullies
      elevation += (noise2 - 0.5) * 50;

      // Add ridge-like features at high elevation
      if (elevation > 1800) {
        const ridgeNoise = fbm(ix * 0.02 + 50, iy * 0.02 + 50, 3);
        const ridgeStrength = Math.min(1, (elevation - 1800) / 400) * 70;
        elevation += (ridgeNoise - 0.5) * ridgeStrength;
      }

      // Add cliff bands in upper mountain
      if (elevation > 2000 && elevation < 2300) {
        const cliffNoise = fbm(ix * 0.03 + 200, iy * 0.005 + 200, 2);
        if (cliffNoise > 0.55) {
          elevation += 40; // Sharp step for cliff effect
        }
      }

      // Flatten base village area
      const villageDist = Math.sqrt(Math.pow(nx - 0.48, 2) + Math.pow(ny - 0.10, 2));
      if (villageDist < 0.06) {
        const flattenT = 1 - villageDist / 0.06;
        elevation = elevation * (1 - flattenT * 0.7) + 680 * (flattenT * 0.7);
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

// -- Terrain mesh creation --

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
