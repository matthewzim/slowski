/**
 * Ski Run System for Whistler Blackcomb
 * Defines run paths from the trail map, creates corridors, and provides isOnRun().
 *
 * Run paths are defined in normalized image coordinates (0-1) based on the
 * dotted lines visible in the Google Maps reference image.
 */

import * as THREE from 'three';
import { normalizedToWorld, getHeightAt, TERRAIN_CONFIG } from './terrain.js';

// -- Run path definitions --
// Each run is an array of [nx, ny] normalized coordinates (0-1)
// traced from the dotted lines on the trail map

const RUN_PATHS = {
  // Upper mountain runs (from Crystal Ridge area down)
  'Crystal Traverse': [
    [0.50, 0.10], [0.48, 0.14], [0.45, 0.18], [0.42, 0.22],
    [0.40, 0.26], [0.38, 0.28],
  ],
  'Springboard': [
    [0.55, 0.12], [0.53, 0.16], [0.50, 0.22], [0.48, 0.26],
    [0.46, 0.30], [0.44, 0.33],
  ],
  'Countdown': [
    [0.58, 0.18], [0.55, 0.22], [0.52, 0.26], [0.50, 0.30],
    [0.48, 0.34], [0.45, 0.38],
  ],
  // Mid-mountain runs (Excelerator/Catskinner area)
  'Cruiser': [
    [0.42, 0.30], [0.40, 0.34], [0.38, 0.38], [0.36, 0.42],
    [0.34, 0.46], [0.32, 0.50], [0.30, 0.54],
  ],
  'Expressway': [
    [0.45, 0.28], [0.42, 0.32], [0.40, 0.36], [0.37, 0.40],
    [0.35, 0.44], [0.33, 0.48], [0.30, 0.52],
  ],
  'Stoker': [
    [0.48, 0.32], [0.46, 0.36], [0.43, 0.40], [0.40, 0.44],
    [0.38, 0.48], [0.36, 0.52], [0.34, 0.56],
  ],
  'Catskinner Run': [
    [0.35, 0.45], [0.33, 0.48], [0.30, 0.52], [0.28, 0.56],
    [0.25, 0.60], [0.22, 0.62],
  ],
  // Glacier Express area runs
  'Glacier Drive': [
    [0.58, 0.35], [0.56, 0.40], [0.54, 0.44], [0.52, 0.48],
    [0.50, 0.52], [0.48, 0.55],
  ],
  'Blackcomb Glacier Road': [
    [0.55, 0.50], [0.52, 0.54], [0.50, 0.58], [0.48, 0.62],
    [0.46, 0.66], [0.44, 0.70],
  ],
  // 7th Heaven area runs
  'Cloud Nine': [
    [0.62, 0.58], [0.60, 0.62], [0.58, 0.66], [0.55, 0.70],
    [0.52, 0.72], [0.50, 0.74],
  ],
  'Seventhheaven': [
    [0.65, 0.60], [0.62, 0.64], [0.58, 0.68], [0.55, 0.72],
    [0.52, 0.76], [0.50, 0.78],
  ],
  // Lower mountain (Gondola area to base)
  'Green Line': [
    [0.30, 0.30], [0.28, 0.28], [0.25, 0.25], [0.22, 0.22],
    [0.20, 0.20], [0.18, 0.18], [0.15, 0.16], [0.12, 0.15],
  ],
  'Easy Out': [
    [0.28, 0.35], [0.25, 0.32], [0.22, 0.28], [0.20, 0.25],
    [0.17, 0.22], [0.14, 0.19], [0.12, 0.16],
  ],
  'Village Run': [
    [0.20, 0.24], [0.18, 0.22], [0.16, 0.20], [0.14, 0.18],
    [0.12, 0.16], [0.10, 0.14],
  ],
  // Horstman area
  'Horstman Glacier': [
    [0.42, 0.68], [0.40, 0.65], [0.38, 0.62], [0.36, 0.58],
    [0.35, 0.55],
  ],
};

// Run corridor width in world units
const RUN_WIDTH = 35;
const RUN_WIDTH_SQ = RUN_WIDTH * RUN_WIDTH;

/**
 * Convert run paths from normalized coords to world-space point arrays.
 */
function buildWorldPaths() {
  const worldPaths = {};
  for (const [name, points] of Object.entries(RUN_PATHS)) {
    worldPaths[name] = points.map(([nx, ny]) => {
      const { x, z } = normalizedToWorld(nx, ny);
      return new THREE.Vector2(x, z);
    });
  }
  return worldPaths;
}

// Precomputed world paths
let _worldPaths = null;

function getWorldPaths() {
  if (!_worldPaths) _worldPaths = buildWorldPaths();
  return _worldPaths;
}

/**
 * Build a spatial grid for fast run proximity queries.
 */
let _runGrid = null;
const GRID_CELL_SIZE = 50;

function buildRunGrid() {
  if (_runGrid) return _runGrid;

  const worldPaths = getWorldPaths();
  const halfW = TERRAIN_CONFIG.worldWidth / 2;
  const halfD = TERRAIN_CONFIG.worldDepth / 2;
  const gridW = Math.ceil(TERRAIN_CONFIG.worldWidth / GRID_CELL_SIZE);
  const gridD = Math.ceil(TERRAIN_CONFIG.worldDepth / GRID_CELL_SIZE);

  // For each cell, store which run segments are nearby
  _runGrid = new Uint8Array(gridW * gridD); // 1 = on run, 0 = not

  for (const [name, points] of Object.entries(worldPaths)) {
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];

      // Rasterize the segment with buffer
      const minX = Math.min(p0.x, p1.x) - RUN_WIDTH;
      const maxX = Math.max(p0.x, p1.x) + RUN_WIDTH;
      const minZ = Math.min(p0.y, p1.y) - RUN_WIDTH;
      const maxZ = Math.max(p0.y, p1.y) + RUN_WIDTH;

      const gx0 = Math.max(0, Math.floor((minX + halfW) / GRID_CELL_SIZE));
      const gx1 = Math.min(gridW - 1, Math.floor((maxX + halfW) / GRID_CELL_SIZE));
      const gz0 = Math.max(0, Math.floor((minZ + halfD) / GRID_CELL_SIZE));
      const gz1 = Math.min(gridD - 1, Math.floor((maxZ + halfD) / GRID_CELL_SIZE));

      for (let gz = gz0; gz <= gz1; gz++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const cx = gx * GRID_CELL_SIZE - halfW + GRID_CELL_SIZE / 2;
          const cz = gz * GRID_CELL_SIZE - halfD + GRID_CELL_SIZE / 2;

          if (distToSegmentSq(cx, cz, p0.x, p0.y, p1.x, p1.y) < RUN_WIDTH_SQ) {
            _runGrid[gz * gridW + gx] = 1;
          }
        }
      }
    }
  }

  return _runGrid;
}

function distToSegmentSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq < 0.001) {
    const ex = px - ax;
    const ey = py - ay;
    return ex * ex + ey * ey;
  }

  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey;
}

/**
 * Check if a world position (x, z) is on a ski run.
 * Uses spatial grid for fast lookups.
 */
export function isOnRun(x, z) {
  const grid = buildRunGrid();
  const halfW = TERRAIN_CONFIG.worldWidth / 2;
  const halfD = TERRAIN_CONFIG.worldDepth / 2;
  const gridW = Math.ceil(TERRAIN_CONFIG.worldWidth / GRID_CELL_SIZE);

  const gx = Math.floor((x + halfW) / GRID_CELL_SIZE);
  const gz = Math.floor((z + halfD) / GRID_CELL_SIZE);

  if (gx < 0 || gx >= gridW || gz < 0 || gz >= Math.ceil(TERRAIN_CONFIG.worldDepth / GRID_CELL_SIZE)) {
    return false;
  }

  return grid[gz * gridW + gx] === 1;
}

/**
 * Get the distance from (x, z) to the nearest run center.
 * Returns 0 if on a run, positive distance otherwise.
 */
export function distanceToNearestRun(x, z) {
  const worldPaths = getWorldPaths();
  let minDist = Infinity;

  for (const points of Object.values(worldPaths)) {
    for (let i = 0; i < points.length - 1; i++) {
      const d = Math.sqrt(distToSegmentSq(x, z, points[i].x, points[i].y, points[i + 1].x, points[i + 1].y));
      if (d < minDist) minDist = d;
    }
  }

  return Math.max(0, minDist - RUN_WIDTH);
}

/**
 * Get all run paths in world space.
 */
export function getRunPaths() {
  return getWorldPaths();
}

/**
 * Get run paths as 3D points (with terrain height).
 */
export function getRunPaths3D(heightmap, resolution) {
  const worldPaths = getWorldPaths();
  const paths3D = {};

  for (const [name, points] of Object.entries(worldPaths)) {
    paths3D[name] = points.map(p => {
      const y = getHeightAt(p.x, p.y, heightmap, resolution);
      return new THREE.Vector3(p.x, y + 0.3, p.y);
    });
  }

  return paths3D;
}

/**
 * Create visual run markers/ribbons for debugging or visual enhancement.
 */
export function createRunVisuals(heightmap, resolution) {
  const group = new THREE.Group();
  const paths3D = getRunPaths3D(heightmap, resolution);

  for (const [name, points] of Object.entries(paths3D)) {
    if (points.length < 2) continue;

    // Create a simple line for each run
    const curve = new THREE.CatmullRomCurve3(points);
    const curvePoints = curve.getPoints(points.length * 8);
    const geometry = new THREE.BufferGeometry().setFromPoints(curvePoints);
    const material = new THREE.LineBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.4,
    });
    const line = new THREE.Line(geometry, material);
    group.add(line);
  }

  return group;
}
