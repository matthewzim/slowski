/**
 * Ski Run System for Jamboree Snow Resort
 * Defines run paths branching naturally from each of the 9 lifts.
 * Runs have varying difficulty: green (beginner), blue (intermediate), black (expert).
 *
 * Run paths are defined in normalized coordinates (0-1).
 */

import * as THREE from 'three';
import { normalizedToWorld, getHeightAt, TERRAIN_CONFIG } from './terrain.js';

// -- Run path definitions --
// Each run: array of [nx, ny] waypoints, plus difficulty for visual color

const RUN_PATHS = {
  // =========================================
  // FROM LIFT 1 TOP (0.46, 0.35) - Beginner/Intermediate
  // =========================================
  'Main Street': {
    difficulty: 'green',
    points: [
      [0.46, 0.35], [0.45, 0.30], [0.44, 0.26], [0.44, 0.22],
      [0.45, 0.18], [0.46, 0.14], [0.47, 0.12],
    ],
  },
  'Homerun': {
    difficulty: 'blue',
    points: [
      [0.46, 0.35], [0.48, 0.30], [0.50, 0.26], [0.51, 0.22],
      [0.50, 0.18], [0.49, 0.14], [0.48, 0.12],
    ],
  },
  'Meadow Lane': {
    difficulty: 'green',
    points: [
      [0.46, 0.35], [0.43, 0.32], [0.40, 0.28], [0.38, 0.24],
      [0.40, 0.20], [0.42, 0.16], [0.45, 0.12],
    ],
  },

  // =========================================
  // FROM LIFT 2 TOP (0.72, 0.55) - Intermediate/Advanced
  // =========================================
  'Ridge Run': {
    difficulty: 'blue',
    points: [
      [0.72, 0.55], [0.73, 0.50], [0.74, 0.46], [0.74, 0.42],
      [0.73, 0.38],
    ],
  },
  'Cliffside': {
    difficulty: 'black',
    points: [
      [0.72, 0.55], [0.70, 0.50], [0.68, 0.46], [0.67, 0.42],
      [0.68, 0.38],
    ],
  },
  'Outback': {
    difficulty: 'blue',
    points: [
      [0.72, 0.55], [0.74, 0.52], [0.76, 0.48], [0.77, 0.44],
      [0.76, 0.40], [0.74, 0.38],
    ],
  },

  // =========================================
  // FROM LIFT 3 TOP (0.75, 0.30) - Beginner/Intermediate
  // =========================================
  'Easy Street': {
    difficulty: 'green',
    points: [
      [0.75, 0.30], [0.76, 0.26], [0.78, 0.22], [0.80, 0.18],
      [0.81, 0.14], [0.82, 0.12],
    ],
  },
  'Sidewinder': {
    difficulty: 'blue',
    points: [
      [0.75, 0.30], [0.73, 0.26], [0.72, 0.22], [0.74, 0.18],
      [0.76, 0.14], [0.78, 0.12],
    ],
  },
  'East Traverse': {
    difficulty: 'green',
    points: [
      [0.75, 0.30], [0.72, 0.32], [0.68, 0.34], [0.64, 0.35],
      [0.60, 0.36], [0.56, 0.37], [0.52, 0.36], [0.48, 0.36],
    ],
  },

  // =========================================
  // FROM LIFT 4 TOP (0.62, 0.75) - Advanced/Expert
  // =========================================
  'Summit Plunge': {
    difficulty: 'black',
    points: [
      [0.62, 0.75], [0.63, 0.70], [0.64, 0.66], [0.64, 0.62],
      [0.64, 0.58], [0.64, 0.54],
    ],
  },
  'Powder Bowl': {
    difficulty: 'black',
    points: [
      [0.62, 0.75], [0.59, 0.70], [0.56, 0.66], [0.54, 0.62],
      [0.52, 0.58], [0.50, 0.55],
    ],
  },
  'Skyline': {
    difficulty: 'blue',
    points: [
      [0.62, 0.75], [0.60, 0.72], [0.58, 0.68], [0.55, 0.64],
      [0.52, 0.60], [0.50, 0.56], [0.48, 0.54],
    ],
  },

  // =========================================
  // FROM LIFT 5 TOP (0.18, 0.55) - Mixed
  // =========================================
  'Timberline Trail': {
    difficulty: 'blue',
    points: [
      [0.18, 0.55], [0.17, 0.50], [0.15, 0.46], [0.14, 0.42],
      [0.13, 0.38], [0.13, 0.36],
    ],
  },
  'Glade Run': {
    difficulty: 'black',
    points: [
      [0.18, 0.55], [0.20, 0.50], [0.22, 0.46], [0.21, 0.42],
      [0.19, 0.38], [0.17, 0.36],
    ],
  },
  'Forest Path': {
    difficulty: 'green',
    points: [
      [0.18, 0.55], [0.16, 0.52], [0.15, 0.48], [0.16, 0.44],
      [0.18, 0.40], [0.16, 0.38], [0.14, 0.36],
    ],
  },

  // =========================================
  // FROM LIFTS 6/8/9 TOP (~0.42, 0.88) - Expert
  // =========================================
  'Peak Run': {
    difficulty: 'black',
    points: [
      [0.41, 0.88], [0.39, 0.84], [0.38, 0.80], [0.37, 0.76],
      [0.38, 0.73],
    ],
  },
  'North Face': {
    difficulty: 'black',
    points: [
      [0.43, 0.88], [0.45, 0.84], [0.47, 0.80], [0.48, 0.76],
      [0.47, 0.73],
    ],
  },
  'Summit Ridge': {
    difficulty: 'blue',
    points: [
      [0.42, 0.88], [0.38, 0.85], [0.34, 0.82], [0.31, 0.79],
      [0.30, 0.76], [0.32, 0.73],
    ],
  },
  'Alpine Chute': {
    difficulty: 'black',
    points: [
      [0.49, 0.88], [0.50, 0.84], [0.52, 0.80], [0.53, 0.77],
      [0.52, 0.74],
    ],
  },

  // =========================================
  // FROM LIFT 7 TOP (0.48, 0.62) - Intermediate
  // =========================================
  'Cruiser': {
    difficulty: 'blue',
    points: [
      [0.48, 0.62], [0.47, 0.58], [0.46, 0.54], [0.45, 0.50],
      [0.45, 0.46], [0.46, 0.42],
    ],
  },
  'Panorama': {
    difficulty: 'blue',
    points: [
      [0.48, 0.62], [0.50, 0.58], [0.52, 0.54], [0.52, 0.50],
      [0.50, 0.46], [0.48, 0.42],
    ],
  },
  'Powder Stash': {
    difficulty: 'black',
    points: [
      [0.48, 0.62], [0.44, 0.58], [0.40, 0.54], [0.38, 0.50],
      [0.37, 0.46], [0.38, 0.42],
    ],
  },
  'Bowl Traverse': {
    difficulty: 'green',
    points: [
      [0.48, 0.62], [0.45, 0.60], [0.42, 0.58], [0.40, 0.56],
      [0.38, 0.54], [0.35, 0.52], [0.32, 0.50],
    ],
  },

  // =========================================
  // CONNECTING RUNS
  // =========================================
  'Village Traverse': {
    difficulty: 'green',
    points: [
      [0.65, 0.20], [0.60, 0.18], [0.55, 0.16], [0.50, 0.14],
      [0.48, 0.12],
    ],
  },
  'Cross Mountain': {
    difficulty: 'green',
    points: [
      [0.65, 0.40], [0.60, 0.38], [0.55, 0.37], [0.50, 0.36],
      [0.46, 0.36],
    ],
  },
  'Link Up': {
    difficulty: 'green',
    points: [
      [0.32, 0.50], [0.35, 0.46], [0.38, 0.43], [0.42, 0.42],
      [0.46, 0.42],
    ],
  },
};

// Run corridor width in world units
const RUN_WIDTH = 175;
const RUN_WIDTH_SQ = RUN_WIDTH * RUN_WIDTH;

function buildWorldPaths() {
  const worldPaths = {};
  for (const [name, run] of Object.entries(RUN_PATHS)) {
    worldPaths[name] = {
      difficulty: run.difficulty,
      points: run.points.map(([nx, ny]) => {
        const { x, z } = normalizedToWorld(nx, ny);
        return new THREE.Vector2(x, z);
      }),
    };
  }
  return worldPaths;
}

let _worldPaths = null;

function getWorldPaths() {
  if (!_worldPaths) _worldPaths = buildWorldPaths();
  return _worldPaths;
}

let _runGrid = null;
const GRID_CELL_SIZE = 250;

function buildRunGrid() {
  if (_runGrid) return _runGrid;

  const worldPaths = getWorldPaths();
  const halfW = TERRAIN_CONFIG.worldWidth / 2;
  const halfD = TERRAIN_CONFIG.worldDepth / 2;
  const gridW = Math.ceil(TERRAIN_CONFIG.worldWidth / GRID_CELL_SIZE);
  const gridD = Math.ceil(TERRAIN_CONFIG.worldDepth / GRID_CELL_SIZE);

  _runGrid = new Uint8Array(gridW * gridD);

  for (const [name, run] of Object.entries(worldPaths)) {
    const points = run.points;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];

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

export function distanceToNearestRun(x, z) {
  const worldPaths = getWorldPaths();
  let minDist = Infinity;

  for (const run of Object.values(worldPaths)) {
    const points = run.points;
    for (let i = 0; i < points.length - 1; i++) {
      const d = Math.sqrt(distToSegmentSq(x, z, points[i].x, points[i].y, points[i + 1].x, points[i + 1].y));
      if (d < minDist) minDist = d;
    }
  }

  return Math.max(0, minDist - RUN_WIDTH);
}

export function getRunPaths() {
  return getWorldPaths();
}

export function getRunPaths3D(heightmap, resolution) {
  const worldPaths = getWorldPaths();
  const paths3D = {};

  for (const [name, run] of Object.entries(worldPaths)) {
    paths3D[name] = {
      difficulty: run.difficulty,
      points: run.points.map(p => {
        const y = getHeightAt(p.x, p.y, heightmap, resolution);
        return new THREE.Vector3(p.x, y + 0.3, p.y);
      }),
    };
  }

  return paths3D;
}

// Difficulty colors
const DIFFICULTY_COLORS = {
  green: 0x44bb44,
  blue: 0x4488ff,
  black: 0x222222,
};

export function createRunVisuals(heightmap, resolution) {
  const group = new THREE.Group();
  const paths3D = getRunPaths3D(heightmap, resolution);

  for (const [name, run] of Object.entries(paths3D)) {
    if (run.points.length < 2) continue;

    const curve = new THREE.CatmullRomCurve3(run.points);
    const curvePoints = curve.getPoints(run.points.length * 8);
    const geometry = new THREE.BufferGeometry().setFromPoints(curvePoints);
    const color = DIFFICULTY_COLORS[run.difficulty] || 0x4488ff;
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: run.difficulty === 'green' ? 0.5 : 0.4,
    });
    const line = new THREE.Line(geometry, material);
    group.add(line);
  }

  return group;
}
