/**
 * Terrain system for Jamboree Snow Resort
 * Loads WeTest.glb as the terrain mesh and extracts a heightmap
 * from it via raycasting so that physics queries (getHeightAt, etc.) still work.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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

/**
 * Load the GLB terrain model, scale it to fit the world, apply snow material,
 * and build a heightmap by raycasting downward on a grid.
 *
 * Returns { mesh, heightmap, resolution }.
 */
export async function loadTerrainFromGLB(snowMaterial, onProgress) {
  const loader = new GLTFLoader();

  if (onProgress) onProgress(10, 'Loading terrain model...');

  const gltf = await new Promise((resolve, reject) => {
    loader.load(
      'WeTest.glb',
      resolve,
      (xhr) => {
        if (onProgress && xhr.total > 0) {
          const pct = Math.round((xhr.loaded / xhr.total) * 20) + 10;
          onProgress(pct, 'Loading terrain model...');
        }
      },
      reject
    );
  });

  if (onProgress) onProgress(30, 'Processing terrain geometry...');

  // Find all meshes in the loaded scene and remove stray objects (e.g. unit
  // cubes with huge translations) that would blow up the bounding box.
  const meshes = [];
  const toRemove = [];
  gltf.scene.traverse((child) => {
    if (child.isMesh) {
      meshes.push(child);
    }
  });

  if (meshes.length === 0) {
    throw new Error('No meshes found in GLB file');
  }

  // Identify meshes that are stray artifacts (tiny geometry far from origin)
  for (const m of meshes) {
    const geoBbox = m.geometry.boundingBox || (() => { m.geometry.computeBoundingBox(); return m.geometry.boundingBox; })();
    const geoSize = new THREE.Vector3();
    geoBbox.getSize(geoSize);
    const maxDim = Math.max(geoSize.x, geoSize.y, geoSize.z);
    // If the mesh's own geometry is tiny (< 10 units), it's likely an artifact
    if (maxDim < 10) {
      toRemove.push(m);
    }
  }

  for (const m of toRemove) {
    m.removeFromParent();
  }

  // Merge everything into a single group and compute its bounding box
  const terrainGroup = gltf.scene;
  const bbox = new THREE.Box3().setFromObject(terrainGroup);
  const modelSize = new THREE.Vector3();
  bbox.getSize(modelSize);
  const modelCenter = new THREE.Vector3();
  bbox.getCenter(modelCenter);

  // Scale the model to fit our world dimensions
  const scaleX = TERRAIN_CONFIG.worldWidth / modelSize.x;
  const scaleZ = TERRAIN_CONFIG.worldDepth / modelSize.z;
  const scale = Math.min(scaleX, scaleZ);

  // We want the vertical scale to produce elevations in our expected range
  const modelHeightRange = modelSize.y;
  const desiredHeightRange = TERRAIN_CONFIG.maxElevation - TERRAIN_CONFIG.minElevation;
  const scaleY = desiredHeightRange / modelHeightRange;

  terrainGroup.scale.set(scale, scaleY, scale);

  // Re-center: put model center at world origin horizontally,
  // and base at elevation 0 (which maps to baseElevation in world terms)
  terrainGroup.updateMatrixWorld(true);
  const scaledBbox = new THREE.Box3().setFromObject(terrainGroup);
  const scaledCenter = new THREE.Vector3();
  scaledBbox.getCenter(scaledCenter);

  terrainGroup.position.set(
    -scaledCenter.x,
    -scaledBbox.min.y,  // Put the bottom of the model at y=0
    -scaledCenter.z
  );
  terrainGroup.updateMatrixWorld(true);

  // Apply snow material to all meshes
  terrainGroup.traverse((child) => {
    if (child.isMesh) {
      child.material = snowMaterial;
      child.receiveShadow = true;
      child.castShadow = true;
    }
  });

  if (onProgress) onProgress(40, 'Building heightmap from terrain...');

  // Build heightmap by raycasting downward
  const resolution = TERRAIN_CONFIG.resolution;
  const heightmap = await buildHeightmapFromMesh(terrainGroup, resolution, onProgress);

  return { mesh: terrainGroup, heightmap, resolution };
}

/**
 * Get the Y coordinate on a triangle at world position (px, pz)
 * using barycentric interpolation. Returns null if point is outside triangle.
 */
function barycentricY(px, pz, v0, v1, v2) {
  const e1x = v1.x - v0.x, e1z = v1.z - v0.z;
  const e2x = v2.x - v0.x, e2z = v2.z - v0.z;
  const dpx = px - v0.x, dpz = pz - v0.z;

  const d00 = e1x * e1x + e1z * e1z;
  const d01 = e1x * e2x + e1z * e2z;
  const d11 = e2x * e2x + e2z * e2z;
  const d20 = dpx * e1x + dpz * e1z;
  const d21 = dpx * e2x + dpz * e2z;

  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-10) return null;

  const u = (d11 * d20 - d01 * d21) / denom;
  const v = (d00 * d21 - d01 * d20) / denom;

  if (u < -0.001 || v < -0.001 || u + v > 1.001) return null;

  return v0.y + u * (v1.y - v0.y) + v * (v2.y - v0.y);
}

/**
 * Build a heightmap by rasterizing mesh triangles onto the grid.
 * For each triangle, we compute the exact surface height at every grid cell
 * that falls within it, giving pixel-perfect terrain following.
 */
async function buildHeightmapFromMesh(terrainGroup, resolution, onProgress) {
  const { worldWidth, worldDepth, baseElevation, minElevation } = TERRAIN_CONFIG;
  const heightmap = new Float32Array(resolution * resolution);
  const filled = new Uint8Array(resolution * resolution);
  heightmap.fill(minElevation);

  terrainGroup.updateMatrixWorld(true);
  const _v0 = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();

  const toGx = (wx) => ((wx / worldWidth) + 0.5) * (resolution - 1);
  const toGz = (wz) => ((wz / worldDepth) + 0.5) * (resolution - 1);
  const toWx = (gx) => (gx / (resolution - 1) - 0.5) * worldWidth;
  const toWz = (gz) => (gz / (resolution - 1) - 0.5) * worldDepth;

  // Rasterize each triangle onto the heightmap grid
  let triProcessed = 0;
  terrainGroup.traverse((child) => {
    if (!child.isMesh) return;
    const geo = child.geometry;
    const pos = geo.attributes.position;
    const idx = geo.index;
    const mat = child.matrixWorld;

    const triCount = idx ? idx.count / 3 : Math.floor(pos.count / 3);

    for (let t = 0; t < triCount; t++) {
      if (idx) {
        _v0.fromBufferAttribute(pos, idx.getX(t * 3)).applyMatrix4(mat);
        _v1.fromBufferAttribute(pos, idx.getX(t * 3 + 1)).applyMatrix4(mat);
        _v2.fromBufferAttribute(pos, idx.getX(t * 3 + 2)).applyMatrix4(mat);
      } else {
        _v0.fromBufferAttribute(pos, t * 3).applyMatrix4(mat);
        _v1.fromBufferAttribute(pos, t * 3 + 1).applyMatrix4(mat);
        _v2.fromBufferAttribute(pos, t * 3 + 2).applyMatrix4(mat);
      }

      // Grid bounding box of triangle
      const gx0 = toGx(_v0.x), gx1 = toGx(_v1.x), gx2 = toGx(_v2.x);
      const gz0 = toGz(_v0.z), gz1 = toGz(_v1.z), gz2 = toGz(_v2.z);

      const minGx = Math.max(0, Math.floor(Math.min(gx0, gx1, gx2)));
      const maxGx = Math.min(resolution - 1, Math.ceil(Math.max(gx0, gx1, gx2)));
      const minGz = Math.max(0, Math.floor(Math.min(gz0, gz1, gz2)));
      const maxGz = Math.min(resolution - 1, Math.ceil(Math.max(gz0, gz1, gz2)));

      for (let gz = minGz; gz <= maxGz; gz++) {
        for (let gx = minGx; gx <= maxGx; gx++) {
          const wx = toWx(gx);
          const wz = toWz(gz);

          const y = barycentricY(wx, wz, _v0, _v1, _v2);
          if (y === null) continue;

          const elevation = y + baseElevation;
          const hIdx = gz * resolution + gx;
          if (!filled[hIdx] || elevation > heightmap[hIdx]) {
            heightmap[hIdx] = elevation;
            filled[hIdx] = 1;
          }
        }
      }

      triProcessed++;
    }
  });

  if (onProgress) onProgress(60, 'Interpolating heightmap...');

  // Fill empty cells by iterative neighbor averaging
  let emptyCount;
  do {
    emptyCount = 0;
    for (let z = 0; z < resolution; z++) {
      for (let x = 0; x < resolution; x++) {
        const hmIdx = z * resolution + x;
        if (filled[hmIdx]) continue;
        let sum = 0, count = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dz === 0) continue;
            const nx = x + dx, nz = z + dz;
            if (nx >= 0 && nx < resolution && nz >= 0 && nz < resolution) {
              const nIdx = nz * resolution + nx;
              if (filled[nIdx]) { sum += heightmap[nIdx]; count++; }
            }
          }
        }
        if (count > 0) {
          heightmap[hmIdx] = sum / count;
          filled[hmIdx] = 1;
        } else {
          emptyCount++;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 0));
  } while (emptyCount > 0);

  return heightmap;
}

/**
 * Generate procedural heightmap (legacy fallback).
 */
export function generateProceduralHeightmap(resolution = TERRAIN_CONFIG.resolution) {
  // Minimal fallback - flat terrain
  const heightmap = new Float32Array(resolution * resolution);
  for (let i = 0; i < heightmap.length; i++) {
    heightmap[i] = TERRAIN_CONFIG.minElevation;
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

/**
 * Build a heightmap from any Three.js Group (used by the .dat loader).
 * Reuses the same triangle rasterization as GLB terrain loading.
 * @param {THREE.Group} group - already scaled and positioned terrain group
 * @param {number} [res] - heightmap resolution
 * @param {Function} [onProgress] - progress callback
 * @returns {Promise<Float32Array>}
 */
export async function buildHeightmapFromGroup(group, res, onProgress) {
  const resolution = res || TERRAIN_CONFIG.resolution;
  return buildHeightmapFromMesh(group, resolution, onProgress);
}
