/**
 * Tree Placement System for Jamboree Snow Resort
 * Uses instanced meshes for performance. Places trees based on elevation,
 * slope, and position matching the trail map - dense forests on lower portions
 * and sides, thinning toward treeline, alpine above.
 */

import * as THREE from 'three';
import { getHeightAt, getSlopeAt, TERRAIN_CONFIG } from './terrain.js';
import { isOnRun } from './runs.js';

const TREE_CONFIG = {
  maxTrees: 20000,
  minElevation: 650,
  maxElevation: 1950,
  treeline: 1800,
  maxSlope: 0.85,
  minSpacing: 38,
  runBuffer: 50,
};

function seededRandom(seed) {
  let s = seed;
  return function() {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

/**
 * Check if position is in a heavy-forest zone based on the Jamboree map.
 * The map shows dense forests on the lower sides and bottom portions.
 */
function getForestDensity(nx, ny, elevation) {
  let density = 1.0;

  // Dense forest in lower-left (lift 5 area)
  const distLL = Math.sqrt(Math.pow(nx - 0.15, 2) + Math.pow(ny - 0.45, 2));
  if (distLL < 0.20) density *= 1.5;

  // Dense forest in lower-right (lift 3 area)
  const distLR = Math.sqrt(Math.pow(nx - 0.78, 2) + Math.pow(ny - 0.22, 2));
  if (distLR < 0.18) density *= 1.4;

  // Dense forest flanking the main runs (lower mountain)
  if (ny < 0.35 && ny > 0.10) {
    if (nx < 0.38 || nx > 0.58) density *= 1.3;
  }

  // Forest on left side of mountain
  if (nx < 0.25 && ny > 0.30 && ny < 0.60) density *= 1.4;

  // Forest on right side of mountain
  if (nx > 0.65 && ny > 0.25 && ny < 0.50) density *= 1.3;

  // Less forest in base village area
  const distVillage = Math.sqrt(Math.pow(nx - 0.48, 2) + Math.pow(ny - 0.10, 2));
  if (distVillage < 0.08) density *= 0.15;

  // Less forest in alpine zones (center-top of mountain)
  if (ny > 0.65 && nx > 0.30 && nx < 0.65) {
    density *= 0.3;
  }

  // Thin out near treeline
  if (elevation > TREE_CONFIG.treeline) {
    density *= 1.0 - (elevation - TREE_CONFIG.treeline) / (TREE_CONFIG.maxElevation - TREE_CONFIG.treeline);
    density = Math.max(0, density);
  }

  // No trees above treeline
  if (elevation > TREE_CONFIG.maxElevation) density = 0;

  // Lower density at very low elevations (flats near village)
  if (elevation < 730) density *= 0.2;

  return density;
}

function generateTreePositions(heightmap, resolution) {
  const positions = [];
  const rand = seededRandom(42);
  const halfW = TERRAIN_CONFIG.worldWidth / 2;
  const halfD = TERRAIN_CONFIG.worldDepth / 2;

  const cellSize = TREE_CONFIG.minSpacing;
  const gridW = Math.floor(TERRAIN_CONFIG.worldWidth / cellSize);
  const gridD = Math.floor(TERRAIN_CONFIG.worldDepth / cellSize);

  for (let gz = 0; gz < gridD; gz++) {
    for (let gx = 0; gx < gridW; gx++) {
      if (positions.length >= TREE_CONFIG.maxTrees) break;

      const x = (gx + rand()) * cellSize - halfW;
      const z = (gz + rand()) * cellSize - halfD;

      // Skip if on a run
      if (isOnRun(x, z)) continue;

      const elevation = getHeightAt(x, z, heightmap, resolution) + TERRAIN_CONFIG.baseElevation;
      const slope = getSlopeAt(x, z, heightmap, resolution);

      if (elevation < TREE_CONFIG.minElevation || elevation > TREE_CONFIG.maxElevation) continue;
      if (slope > TREE_CONFIG.maxSlope) continue;

      // Get normalized position for forest density lookup
      const nx = x / TERRAIN_CONFIG.worldWidth + 0.5;
      const ny = z / TERRAIN_CONFIG.worldDepth + 0.5;
      const density = getForestDensity(nx, ny, elevation);

      // Use noise for natural clustering
      const noiseVal = rand();
      if (noiseVal > density * 0.4) continue;

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

export function generateTrees(heightmap, resolution) {
  const positions = generateTreePositions(heightmap, resolution);
  const count = positions.length;

  if (count === 0) {
    return new THREE.Group();
  }

  const trunkGeo = new THREE.CylinderGeometry(0.75, 1.25, 10, 5);
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x4a3520,
    roughness: 0.9,
  });

  const foliageMat = new THREE.MeshStandardMaterial({
    color: 0x1a5a2a,
    roughness: 0.8,
  });

  const cone1Geo = new THREE.ConeGeometry(11.0, 17.5, 6);
  const cone2Geo = new THREE.ConeGeometry(8.5, 15.0, 6);
  const cone3Geo = new THREE.ConeGeometry(5.5, 12.5, 6);

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
  const color = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const tree = positions[i];
    euler.set(0, tree.rotation, 0);
    quaternion.setFromEuler(euler);
    const s = tree.scale;

    position.set(tree.x, tree.y + 5 * s, tree.z);
    scale.set(s, s, s);
    matrix.compose(position, quaternion, scale);
    trunkMesh.setMatrixAt(i, matrix);

    position.set(tree.x, tree.y + 17.5 * s, tree.z);
    matrix.compose(position, quaternion, scale);
    cone1Mesh.setMatrixAt(i, matrix);

    position.set(tree.x, tree.y + 27.5 * s, tree.z);
    matrix.compose(position, quaternion, scale);
    cone2Mesh.setMatrixAt(i, matrix);

    position.set(tree.x, tree.y + 36.0 * s, tree.z);
    matrix.compose(position, quaternion, scale);
    cone3Mesh.setMatrixAt(i, matrix);

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
