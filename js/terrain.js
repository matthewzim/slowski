/**
 * Terrain system for Jamboree Snow Resort
 * Loads whistlerblackcomb3.glb as the terrain mesh and extracts a heightmap
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
      'whistlerblackcomb3.glb',
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
 * Build a heightmap by reading vertex positions directly from the mesh
 * geometry. This is O(vertices) instead of O(resolution² × triangles).
 */
async function buildHeightmapFromMesh(terrainGroup, resolution, onProgress) {
  const { worldWidth, worldDepth, baseElevation, minElevation } = TERRAIN_CONFIG;
  const heightmap = new Float32Array(resolution * resolution);
  const filled = new Uint8Array(resolution * resolution);
  heightmap.fill(minElevation);

  terrainGroup.updateMatrixWorld(true);
  const v = new THREE.Vector3();

  // Scatter vertex heights onto the grid
  terrainGroup.traverse((child) => {
    if (!child.isMesh) return;
    const pos = child.geometry.attributes.position;
    const mat = child.matrixWorld;

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      v.applyMatrix4(mat);

      const gx = ((v.x / worldWidth) + 0.5) * (resolution - 1);
      const gz = ((v.z / worldDepth) + 0.5) * (resolution - 1);
      const x0 = Math.floor(gx), z0 = Math.floor(gz);
      const elevation = v.y + baseElevation;

      // Write to nearest grid cells
      for (let dz = 0; dz <= 1; dz++) {
        for (let dx = 0; dx <= 1; dx++) {
          const cx = x0 + dx, cz = z0 + dz;
          if (cx < 0 || cx >= resolution || cz < 0 || cz >= resolution) continue;
          const idx = cz * resolution + cx;
          if (!filled[idx] || elevation > heightmap[idx]) {
            heightmap[idx] = elevation;
            filled[idx] = 1;
          }
        }
      }
    }
  });

  if (onProgress) onProgress(60, 'Interpolating heightmap...');

  // Fill empty cells by iterative neighbor averaging
  let emptyCount;
  do {
    emptyCount = 0;
    for (let z = 0; z < resolution; z++) {
      for (let x = 0; x < resolution; x++) {
        const idx = z * resolution + x;
        if (filled[idx]) continue;
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
          heightmap[idx] = sum / count;
          filled[idx] = 1;
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
