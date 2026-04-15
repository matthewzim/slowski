/**
 * Tree Placement System for Jamboree Snow Resort
 * Loads GLB tree models and places them in natural-looking clusters.
 * Snowy pines on middle/upper mountain, normal pines on lower third.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getHeightAt, getSlopeAt, TERRAIN_CONFIG } from './terrain.js';
import { isOnRun } from './runs.js';

const NORMAL_PINE_PATH = 'pine+tree+3d+model.glb';
const SNOWY_PINE_PATH = 'snowy+pine+tree+3d+model.glb';

const TREE_CONFIG = {
  targetHeight: 40,          // Base height in world units
  heightVariation: 0.35,     // ±35% random size variation
  minSpacing: 25,            // Minimum distance between trees in a cluster
  maxSlope: 0.8,             // Max slope angle (radians) for placement
  maxElevation: 1950,        // Absolute elevation cap (treeline)
  minElevation: 650,         // Absolute elevation floor
  lowerThirdCeiling: 1300,   // Normal pines go up to here
  middleFloor: 1050,         // Snowy pines start from here
};

// ── Snowy pine clusters: middle and upper mountain ──────────────────
const SNOWY_CLUSTERS = [
  // Mid-mountain west side — dense forest patches
  { nx: 0.16, ny: 0.42, radius: 160, count: 35 },
  { nx: 0.13, ny: 0.52, radius: 140, count: 28 },
  // Mid-mountain center
  { nx: 0.30, ny: 0.46, radius: 170, count: 32 },
  { nx: 0.48, ny: 0.43, radius: 155, count: 30 },
  // Mid-mountain east
  { nx: 0.63, ny: 0.40, radius: 165, count: 32 },
  { nx: 0.73, ny: 0.46, radius: 145, count: 26 },
  // Upper mountain groves
  { nx: 0.25, ny: 0.60, radius: 130, count: 22 },
  { nx: 0.40, ny: 0.56, radius: 145, count: 25 },
  { nx: 0.56, ny: 0.54, radius: 140, count: 24 },
  { nx: 0.36, ny: 0.68, radius: 120, count: 18 },
  { nx: 0.50, ny: 0.64, radius: 125, count: 20 },
  { nx: 0.64, ny: 0.58, radius: 115, count: 16 },
  // Near treeline — sparse clusters
  { nx: 0.33, ny: 0.75, radius: 100, count: 10 },
  { nx: 0.48, ny: 0.72, radius: 110, count: 12 },
];

// ── Normal pine clusters: lower third of mountain ───────────────────
const NORMAL_CLUSTERS = [
  // Near base village
  { nx: 0.14, ny: 0.14, radius: 170, count: 35 },
  { nx: 0.28, ny: 0.11, radius: 180, count: 32 },
  // Lower west slopes
  { nx: 0.10, ny: 0.26, radius: 155, count: 28 },
  { nx: 0.22, ny: 0.22, radius: 160, count: 30 },
  // Lower center
  { nx: 0.40, ny: 0.15, radius: 165, count: 30 },
  { nx: 0.50, ny: 0.20, radius: 150, count: 26 },
  // Lower east
  { nx: 0.60, ny: 0.14, radius: 175, count: 32 },
  { nx: 0.73, ny: 0.22, radius: 160, count: 28 },
  { nx: 0.82, ny: 0.30, radius: 140, count: 22 },
  // Flanks
  { nx: 0.08, ny: 0.35, radius: 130, count: 20 },
  // Mid-lower transitional
  { nx: 0.33, ny: 0.28, radius: 145, count: 24 },
  { nx: 0.55, ny: 0.26, radius: 150, count: 25 },
];

// ── Helpers ─────────────────────────────────────────────────────────

function seededRandom(seed) {
  let s = seed;
  return function () {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

/**
 * Load a GLB tree model, extract its meshes, and normalize them so the
 * whole model is 1 unit tall with its base at y = 0, centred on x/z.
 * Returns an array of { geometry, material } ready for InstancedMesh.
 */
async function loadTreeModelMeshes(path) {
  const loader = new GLTFLoader();
  const gltf = await new Promise((resolve, reject) => {
    loader.load(path, resolve, undefined, reject);
  });

  const model = gltf.scene;
  model.updateWorldMatrix(true, true);

  // Overall bounding box of the loaded model
  const bbox = new THREE.Box3().setFromObject(model);
  const modelHeight = Math.max(bbox.max.y - bbox.min.y, 0.01);
  const centerX = (bbox.min.x + bbox.max.x) / 2;
  const centerZ = (bbox.min.z + bbox.max.z) / 2;
  const baseY = bbox.min.y;
  const invH = 1 / modelHeight;

  const meshDataList = [];

  model.traverse((child) => {
    if (!child.isMesh) return;

    const geo = child.geometry.clone();
    // Bake the mesh's full world transform into the vertices
    geo.applyMatrix4(child.matrixWorld);
    // Centre on x/z, base at y = 0
    geo.translate(-centerX, -baseY, -centerZ);
    // Normalise to unit height
    geo.scale(invH, invH, invH);

    meshDataList.push({
      geometry: geo,
      material: child.material.clone(),
    });
  });

  return meshDataList;
}

/**
 * Generate tree positions within the given cluster definitions.
 * Each position is checked against elevation, slope, and ski-run constraints.
 */
function generateClusterPositions(clusters, heightmap, resolution, elevMin, elevMax, rand) {
  const allPositions = [];

  for (const cluster of clusters) {
    const cx = (cluster.nx - 0.5) * TERRAIN_CONFIG.worldWidth;
    const cz = (cluster.ny - 0.5) * TERRAIN_CONFIG.worldDepth;
    const clusterPositions = [];
    let placed = 0;
    let attempts = 0;
    const maxAttempts = cluster.count * 8;

    while (placed < cluster.count && attempts < maxAttempts) {
      attempts++;

      // Random position within cluster radius (sqrt for uniform circle area)
      const angle = rand() * Math.PI * 2;
      const dist = cluster.radius * Math.sqrt(rand()) * 0.85;
      const x = cx + Math.cos(angle) * dist;
      const z = cz + Math.sin(angle) * dist;

      // World bounds check
      const halfW = TERRAIN_CONFIG.worldWidth / 2 - 50;
      const halfD = TERRAIN_CONFIG.worldDepth / 2 - 50;
      if (Math.abs(x) > halfW || Math.abs(z) > halfD) continue;

      // Skip ski runs
      if (isOnRun(x, z)) continue;

      const height = getHeightAt(x, z, heightmap, resolution);
      if (height < 1) continue; // no terrain

      const elevation = height + TERRAIN_CONFIG.baseElevation;
      if (elevation < elevMin || elevation > elevMax) continue;

      const slope = getSlopeAt(x, z, heightmap, resolution);
      if (slope > TREE_CONFIG.maxSlope) continue;

      // Minimum spacing within this cluster
      let tooClose = false;
      for (const p of clusterPositions) {
        const dx = x - p.x;
        const dz = z - p.z;
        if (dx * dx + dz * dz < TREE_CONFIG.minSpacing * TREE_CONFIG.minSpacing) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      const scale = 1.0 + (rand() - 0.5) * TREE_CONFIG.heightVariation * 2;
      const rotation = rand() * Math.PI * 2;

      const pos = { x, y: height, z, scale, rotation };
      clusterPositions.push(pos);
      allPositions.push(pos);
      placed++;
    }
  }

  return allPositions;
}

/**
 * Build a Three.js Group of InstancedMesh objects from pre-normalised
 * mesh data and an array of world-space positions.
 */
function createInstancedTreeGroup(meshDataList, positions, targetHeight) {
  const group = new THREE.Group();
  if (positions.length === 0 || meshDataList.length === 0) return group;

  const matrix = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const euler = new THREE.Euler();

  for (const { geometry, material } of meshDataList) {
    const instMesh = new THREE.InstancedMesh(geometry, material, positions.length);
    instMesh.castShadow = true;
    instMesh.receiveShadow = true;

    for (let i = 0; i < positions.length; i++) {
      const tree = positions[i];
      pos.set(tree.x, tree.y, tree.z);
      euler.set(0, tree.rotation, 0);
      quat.setFromEuler(euler);
      const s = tree.scale * targetHeight;
      scl.set(s, s, s);
      matrix.compose(pos, quat, scl);
      instMesh.setMatrixAt(i, matrix);
    }

    instMesh.instanceMatrix.needsUpdate = true;
    group.add(instMesh);
  }

  return group;
}

// ── Public API ──────────────────────────────────────────────────────

export async function generateTrees(heightmap, resolution) {
  const group = new THREE.Group();
  group.name = 'Trees';

  const rand = seededRandom(42);

  // Load both GLB tree models in parallel
  const [snowyMeshes, normalMeshes] = await Promise.all([
    loadTreeModelMeshes(SNOWY_PINE_PATH),
    loadTreeModelMeshes(NORMAL_PINE_PATH),
  ]);

  // Generate clustered positions for each tree type
  const snowyPositions = generateClusterPositions(
    SNOWY_CLUSTERS, heightmap, resolution,
    TREE_CONFIG.middleFloor, TREE_CONFIG.maxElevation, rand,
  );

  const normalPositions = generateClusterPositions(
    NORMAL_CLUSTERS, heightmap, resolution,
    TREE_CONFIG.minElevation, TREE_CONFIG.lowerThirdCeiling, rand,
  );

  // Build instanced mesh groups
  const snowyGroup = createInstancedTreeGroup(snowyMeshes, snowyPositions, TREE_CONFIG.targetHeight);
  snowyGroup.name = 'SnowyPines';
  group.add(snowyGroup);

  const normalGroup = createInstancedTreeGroup(normalMeshes, normalPositions, TREE_CONFIG.targetHeight);
  normalGroup.name = 'NormalPines';
  group.add(normalGroup);

  console.log(`Trees placed — ${snowyPositions.length} snowy pines, ${normalPositions.length} normal pines`);

  return group;
}
