/**
 * Tree Placement System
 * Uses instanced meshes for performance. Places trees based on elevation,
 * slope, and noise, avoiding ski runs.
 */

import * as THREE from 'three';
import { getHeightAt, getSlopeAt, TERRAIN_CONFIG } from './terrain.js';
import { isOnRun } from './runs.js';

// Tree placement parameters
const TREE_CONFIG = {
  maxTrees: 18000,
  // Elevation bounds for tree placement (treeline)
  minElevation: 650,
  maxElevation: 2000, // Above this = alpine, no trees
  treeline: 1900, // Trees thin out above this
  // Slope limits (radians)
  maxSlope: 0.85, // ~49 degrees - too steep for trees
  // Spacing
  minSpacing: 8,
  // Run buffer (extra distance from runs to keep clear)
  runBuffer: 10,
};

// Simple pseudo-random for deterministic placement
function seededRandom(seed) {
  let s = seed;
  return function() {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

/**
 * Create a stylized low-poly tree mesh (for instancing template).
 */
function createTreeTemplate() {
  const group = new THREE.Group();

  // Trunk
  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.25, 2, 5);
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x4a3520,
    roughness: 0.9,
  });
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 1;

  // Foliage layers (3 cones stacked)
  const foliageMat = new THREE.MeshStandardMaterial({
    color: 0x1a4a2a,
    roughness: 0.8,
  });

  const cone1Geo = new THREE.ConeGeometry(2.2, 3.5, 6);
  const cone1 = new THREE.Mesh(cone1Geo, foliageMat);
  cone1.position.y = 3.5;

  const cone2Geo = new THREE.ConeGeometry(1.7, 3.0, 6);
  const cone2 = new THREE.Mesh(cone2Geo, foliageMat);
  cone2.position.y = 5.5;

  const cone3Geo = new THREE.ConeGeometry(1.1, 2.5, 6);
  const cone3 = new THREE.Mesh(cone3Geo, foliageMat);
  cone3.position.y = 7.2;

  // Merge into single geometry for instancing
  group.add(trunk, cone1, cone2, cone3);
  return { group, trunkGeo, trunkMat, foliageMat, coneGeos: [cone1Geo, cone2Geo, cone3Geo] };
}

/**
 * Generate tree positions based on terrain data.
 * Returns array of { x, y, z, scale, rotation }.
 */
function generateTreePositions(heightmap, resolution) {
  const positions = [];
  const rand = seededRandom(42);
  const halfW = TERRAIN_CONFIG.worldWidth / 2;
  const halfD = TERRAIN_CONFIG.worldDepth / 2;

  // Grid-based placement with jitter
  const cellSize = TREE_CONFIG.minSpacing;
  const gridW = Math.floor(TERRAIN_CONFIG.worldWidth / cellSize);
  const gridD = Math.floor(TERRAIN_CONFIG.worldDepth / cellSize);

  for (let gz = 0; gz < gridD; gz++) {
    for (let gx = 0; gx < gridW; gx++) {
      if (positions.length >= TREE_CONFIG.maxTrees) break;

      // Random jitter within cell
      const x = (gx + rand()) * cellSize - halfW;
      const z = (gz + rand()) * cellSize - halfD;

      // Skip if on a run (with buffer)
      if (isOnRun(x, z)) continue;

      // Get terrain data
      const elevation = getHeightAt(x, z, heightmap, resolution) + TERRAIN_CONFIG.baseElevation;
      const slope = getSlopeAt(x, z, heightmap, resolution);

      // Check elevation bounds
      if (elevation < TREE_CONFIG.minElevation || elevation > TREE_CONFIG.maxElevation) continue;

      // Check slope
      if (slope > TREE_CONFIG.maxSlope) continue;

      // Density based on elevation (thin out near treeline)
      let density = 1.0;
      if (elevation > TREE_CONFIG.treeline) {
        density = 1.0 - (elevation - TREE_CONFIG.treeline) / (TREE_CONFIG.maxElevation - TREE_CONFIG.treeline);
        density = Math.max(0, density);
      }

      // Lower density at very low elevations (village area)
      if (elevation < 750) {
        density *= 0.3;
      }

      // Use noise for natural clustering
      const noiseVal = rand();
      if (noiseVal > density * 0.45) continue;

      // Tree scale varies with elevation
      const baseScale = 0.6 + rand() * 0.6;
      const elevFactor = elevation > 1600 ? 0.6 + 0.4 * (1 - (elevation - 1600) / 400) : 1.0;
      const scale = baseScale * elevFactor;

      const y = getHeightAt(x, z, heightmap, resolution);

      positions.push({
        x, y, z,
        scale,
        rotation: rand() * Math.PI * 2,
      });
    }
    if (positions.length >= TREE_CONFIG.maxTrees) break;
  }

  return positions;
}

/**
 * Generate the tree system using InstancedMesh for performance.
 * Returns a THREE.Group containing instanced tree meshes.
 */
export function generateTrees(heightmap, resolution) {
  const positions = generateTreePositions(heightmap, resolution);
  const count = positions.length;

  if (count === 0) {
    return new THREE.Group();
  }

  // Create instanced meshes for trunk and foliage
  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.25, 2, 5);
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x4a3520,
    roughness: 0.9,
  });

  const foliageMat = new THREE.MeshStandardMaterial({
    color: 0x1a5a2a,
    roughness: 0.8,
  });

  // We'll use three cone layers merged concept via separate InstancedMeshes
  const cone1Geo = new THREE.ConeGeometry(2.2, 3.5, 6);
  const cone2Geo = new THREE.ConeGeometry(1.7, 3.0, 6);
  const cone3Geo = new THREE.ConeGeometry(1.1, 2.5, 6);

  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
  const cone1Mesh = new THREE.InstancedMesh(cone1Geo, foliageMat, count);
  const cone2Mesh = new THREE.InstancedMesh(cone2Geo, foliageMat, count);
  const cone3Mesh = new THREE.InstancedMesh(cone3Geo, foliageMat, count);

  trunkMesh.castShadow = true;
  cone1Mesh.castShadow = true;
  cone2Mesh.castShadow = true;
  cone3Mesh.castShadow = true;

  trunkMesh.receiveShadow = true;
  cone1Mesh.receiveShadow = true;

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();

  // Color variation
  const color = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const tree = positions[i];
    euler.set(0, tree.rotation, 0);
    quaternion.setFromEuler(euler);
    const s = tree.scale;

    // Trunk
    position.set(tree.x, tree.y + 1 * s, tree.z);
    scale.set(s, s, s);
    matrix.compose(position, quaternion, scale);
    trunkMesh.setMatrixAt(i, matrix);

    // Cone 1 (bottom)
    position.set(tree.x, tree.y + 3.5 * s, tree.z);
    matrix.compose(position, quaternion, scale);
    cone1Mesh.setMatrixAt(i, matrix);

    // Cone 2 (middle)
    position.set(tree.x, tree.y + 5.5 * s, tree.z);
    matrix.compose(position, quaternion, scale);
    cone2Mesh.setMatrixAt(i, matrix);

    // Cone 3 (top)
    position.set(tree.x, tree.y + 7.2 * s, tree.z);
    matrix.compose(position, quaternion, scale);
    cone3Mesh.setMatrixAt(i, matrix);

    // Slight color variation per tree
    const hue = 0.33 + (Math.random() - 0.5) * 0.05;
    const sat = 0.5 + Math.random() * 0.3;
    const lit = 0.15 + Math.random() * 0.1;
    color.setHSL(hue, sat, lit);
    cone1Mesh.setColorAt(i, color);
    cone2Mesh.setColorAt(i, color);
    cone3Mesh.setColorAt(i, color);
  }

  trunkMesh.instanceMatrix.needsUpdate = true;
  cone1Mesh.instanceMatrix.needsUpdate = true;
  cone2Mesh.instanceMatrix.needsUpdate = true;
  cone3Mesh.instanceMatrix.needsUpdate = true;

  if (cone1Mesh.instanceColor) cone1Mesh.instanceColor.needsUpdate = true;
  if (cone2Mesh.instanceColor) cone2Mesh.instanceColor.needsUpdate = true;
  if (cone3Mesh.instanceColor) cone3Mesh.instanceColor.needsUpdate = true;

  const group = new THREE.Group();
  group.name = 'Trees';
  group.add(trunkMesh, cone1Mesh, cone2Mesh, cone3Mesh);

  return group;
}
