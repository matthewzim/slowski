/**
 * Chairlift System for Blackcomb Mountain
 * Creates terrain-following lift lines with towers, cables, and moving chairs
 * using the 1379_chairlift.glb model.
 *
 * 7 chairlifts matching the Blackcomb Mountain trail map:
 * 1 - Excalibur Gondola (base to lower mid-mountain)
 * 2 - Blackcomb Gondola (base area to mid-mountain)
 * 3 - Excelerator Express (mid-mountain express)
 * 4 - Crystal Ridge Express (upper mountain)
 * 5 - Glacier Express (right side, mid to upper)
 * 6 - Catskinner Express (mid-mountain center)
 * 7 - 7th Heaven Express (lower-right to near summit)
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { normalizedToWorld, getHeightAt, TERRAIN_CONFIG } from './terrain.js';

// -- Lift definitions (positions from Blackcomb Mountain map) --
// Leftmost point = start (bottom station), rightmost = end (top station)
export const LIFT_DEFS = [
  {
    name: 'Excalibur Gondola',
    number: 1,
    points: [[0.10, 0.12], [0.13, 0.16], [0.16, 0.19], [0.19, 0.22]],
    type: 'gondola',
    towerSpacing: 400,
    cableHeight: 40,
    color: 0xcc2222,
  },
  {
    name: 'Blackcomb Gondola',
    number: 2,
    points: [[0.20, 0.28], [0.26, 0.33], [0.32, 0.37], [0.38, 0.42]],
    type: 'gondola',
    towerSpacing: 400,
    cableHeight: 40,
    color: 0xcc2222,
  },
  {
    name: 'Excelerator Express',
    number: 3,
    points: [[0.34, 0.30], [0.38, 0.34], [0.42, 0.38], [0.46, 0.42]],
    type: 'quad',
    towerSpacing: 350,
    cableHeight: 35,
    color: 0xff8800,
  },
  {
    name: 'Crystal Ridge Express',
    number: 4,
    points: [[0.42, 0.16], [0.48, 0.20], [0.54, 0.24], [0.60, 0.28]],
    type: 'quad',
    towerSpacing: 350,
    cableHeight: 35,
    color: 0xff8800,
  },
  {
    name: 'Glacier Express',
    number: 5,
    points: [[0.54, 0.40], [0.58, 0.44], [0.63, 0.48], [0.68, 0.52]],
    type: 'quad',
    towerSpacing: 375,
    cableHeight: 35,
    color: 0xff8800,
  },
  {
    name: 'Catskinner Express',
    number: 6,
    points: [[0.36, 0.44], [0.42, 0.47], [0.47, 0.50], [0.52, 0.53]],
    type: 'quad',
    towerSpacing: 350,
    cableHeight: 35,
    color: 0xffcc00,
  },
  {
    name: '7th Heaven Express',
    number: 7,
    points: [[0.58, 0.60], [0.61, 0.66], [0.64, 0.72], [0.67, 0.78]],
    type: 'quad',
    towerSpacing: 375,
    cableHeight: 40,
    color: 0xff8800,
  },
];

// -- GLB model caches --
let chairliftModelTemplate = null;
let liftPoleModelTemplate = null;
let liftBaseModelTemplate = null;

/**
 * Load the 1379_chairlift.glb model for use as chair geometry.
 */
async function loadChairliftModel() {
  const loader = new GLTFLoader();
  const gltf = await new Promise((resolve, reject) => {
    loader.load('1379_chairlift.glb', resolve, undefined, reject);
  });

  const model = gltf.scene;

  // Compute bounding box to normalize scale
  const bbox = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const center = new THREE.Vector3();
  bbox.getCenter(center);

  // Scale model so it's approximately 12 units tall (matching previous chair size)
  const targetHeight = 12;
  const scaleFactor = targetHeight / Math.max(size.y, 0.01);
  model.scale.multiplyScalar(scaleFactor);

  // Center horizontally, position so the top (hanger point) is at y=0
  model.position.set(
    -center.x * scaleFactor,
    -bbox.max.y * scaleFactor,
    -center.z * scaleFactor
  );

  // Enable shadows on all meshes
  model.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
    }
  });

  // Wrap in a group for consistent handling
  const wrapper = new THREE.Group();
  wrapper.add(model);

  chairliftModelTemplate = wrapper;
  return wrapper;
}

/**
 * Load the ski_lift_pole.glb model for lift towers.
 * Normalized to 1 unit tall with bottom at y=0.
 */
async function loadLiftPoleModel() {
  const loader = new GLTFLoader();
  const gltf = await new Promise((resolve, reject) => {
    loader.load('ski_lift_pole.glb', resolve, undefined, reject);
  });

  const model = gltf.scene;
  const bbox = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const center = new THREE.Vector3();
  bbox.getCenter(center);

  // Normalize to 1 unit tall
  const scaleFactor = 1.0 / Math.max(size.y, 0.01);
  model.scale.multiplyScalar(scaleFactor);

  // Position so bottom is at y=0, centered horizontally
  model.position.set(
    -center.x * scaleFactor,
    -bbox.min.y * scaleFactor,
    -center.z * scaleFactor
  );

  model.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });

  const wrapper = new THREE.Group();
  wrapper.add(model);
  liftPoleModelTemplate = wrapper;
}

/**
 * Load the ski_lift_base.glb model for top/bottom stations.
 * Scaled to a reasonable station size with bottom at y=0.
 */
async function loadLiftBaseModel() {
  const loader = new GLTFLoader();
  const gltf = await new Promise((resolve, reject) => {
    loader.load('ski_lift_base.glb', resolve, undefined, reject);
  });

  const model = gltf.scene;
  const bbox = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const center = new THREE.Vector3();
  bbox.getCenter(center);

  // Scale to ~40 units tall for a lift base station
  const targetHeight = 40;
  const scaleFactor = targetHeight / Math.max(size.y, 0.01);
  model.scale.multiplyScalar(scaleFactor);

  // Position so bottom is at y=0, centered horizontally
  model.position.set(
    -center.x * scaleFactor,
    -bbox.min.y * scaleFactor,
    -center.z * scaleFactor
  );

  model.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  const wrapper = new THREE.Group();
  wrapper.add(model);
  liftBaseModelTemplate = wrapper;
}

/**
 * Create a tower from the GLB pole model, scaled to the desired height.
 */
function createTowerFromModel(height) {
  const tower = liftPoleModelTemplate.clone();
  // Template is 1 unit tall; scale uniformly to desired height
  tower.scale.setScalar(height);
  return tower;
}

/**
 * Create a chair instance from the loaded GLB model.
 */
function createChairFromModel() {
  if (!chairliftModelTemplate) {
    // Fallback to simple geometry if model failed to load
    return createFallbackChair();
  }
  return chairliftModelTemplate.clone();
}

/**
 * Simple fallback chair geometry (used if GLB fails to load).
 */
function createFallbackChair() {
  const group = new THREE.Group();

  const seatGeo = new THREE.BoxGeometry(12.5, 0.5, 3.5);
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x2244aa, metalness: 0.2, roughness: 0.6 });
  const seat = new THREE.Mesh(seatGeo, seatMat);
  seat.position.y = -10.0;
  seat.castShadow = true;
  group.add(seat);

  const backGeo = new THREE.BoxGeometry(12.5, 5.0, 0.5);
  const back = new THREE.Mesh(backGeo, seatMat);
  back.position.set(0, -7.5, -1.75);
  group.add(back);

  const hangerGeo = new THREE.CylinderGeometry(0.2, 0.2, 11.0, 4);
  const hangerMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.8 });
  const hanger = new THREE.Mesh(hangerGeo, hangerMat);
  hanger.position.y = -4.5;
  group.add(hanger);

  return group;
}

// -- Tower geometry (dynamic height) --
function createTowerGeometry(height = 12) {
  const group = new THREE.Group();

  const poleGeo = new THREE.CylinderGeometry(1.5, 2.0, height, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.7, roughness: 0.3 });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.y = height / 2;
  pole.castShadow = true;
  group.add(pole);

  const armGeo = new THREE.BoxGeometry(20, 1.5, 1.5);
  const arm = new THREE.Mesh(armGeo, poleMat);
  arm.position.y = height;
  arm.castShadow = true;
  group.add(arm);

  const sheaveGeo = new THREE.CylinderGeometry(2.5, 2.5, 1.0, 8);
  const sheaveMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.8, roughness: 0.2 });

  const sheaveL = new THREE.Mesh(sheaveGeo, sheaveMat);
  sheaveL.rotation.z = Math.PI / 2;
  sheaveL.position.set(-9, height + 1.0, 0);
  group.add(sheaveL);

  const sheaveR = new THREE.Mesh(sheaveGeo, sheaveMat);
  sheaveR.rotation.z = Math.PI / 2;
  sheaveR.position.set(9, height + 1.0, 0);
  group.add(sheaveR);

  return group;
}

/**
 * Build the full lift line from a definition.
 */
function buildLift(def, heightmap, resolution) {
  const group = new THREE.Group();
  group.name = def.name;

  const rawWorldPoints = def.points.map(([nx, ny]) => {
    const { x, z } = normalizedToWorld(nx, ny);
    return { x, z };
  });

  const densePoints = [];
  const segmentsPerLeg = 20;

  for (let i = 0; i < rawWorldPoints.length - 1; i++) {
    const p0 = rawWorldPoints[i];
    const p1 = rawWorldPoints[i + 1];
    for (let s = 0; s <= (i === rawWorldPoints.length - 2 ? segmentsPerLeg : segmentsPerLeg - 1); s++) {
      const t = s / segmentsPerLeg;
      const x = p0.x + (p1.x - p0.x) * t;
      const z = p0.z + (p1.z - p0.z) * t;
      const terrainY = getHeightAt(x, z, heightmap, resolution);
      densePoints.push(new THREE.Vector3(x, terrainY + def.cableHeight, z));
    }
  }

  const curve = new THREE.CatmullRomCurve3(densePoints, false, 'catmullrom', 0.3);
  const curvePoints = curve.getPoints(200);

  for (const pt of curvePoints) {
    const terrainY = getHeightAt(pt.x, pt.z, heightmap, resolution);
    if (pt.y < terrainY + def.cableHeight * 0.7) {
      pt.y = terrainY + def.cableHeight * 0.7;
    }
  }

  const correctedCurve = new THREE.CatmullRomCurve3(curvePoints, false, 'catmullrom', 0.1);

  // Cable line
  const cableGeo = new THREE.BufferGeometry().setFromPoints(curvePoints);
  const cableMat = new THREE.LineBasicMaterial({ color: 0x222222, linewidth: 2 });
  const cableLine = new THREE.Line(cableGeo, cableMat);
  group.add(cableLine);

  // Return cable (offset perpendicular)
  const returnPoints = curvePoints.map((p, i) => {
    const next = curvePoints[Math.min(i + 1, curvePoints.length - 1)];
    const prev = curvePoints[Math.max(i - 1, 0)];
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const perpX = -dz / len * 15;
    const perpZ = dx / len * 15;
    return p.clone().add(new THREE.Vector3(perpX, 0, perpZ));
  });
  const returnGeo = new THREE.BufferGeometry().setFromPoints(returnPoints);
  const returnLine = new THREE.Line(returnGeo, cableMat);
  group.add(returnLine);

  // Towers
  const totalLength = correctedCurve.getLength();
  const numTowers = Math.floor(totalLength / def.towerSpacing);

  for (let i = 0; i <= numTowers; i++) {
    const t = i / numTowers;
    const cablePos = correctedCurve.getPointAt(t);
    const terrainY = getHeightAt(cablePos.x, cablePos.z, heightmap, resolution);
    const towerHeight = cablePos.y - terrainY;

    if (towerHeight < 2) continue;

    const tower = liftPoleModelTemplate
      ? createTowerFromModel(towerHeight)
      : createTowerGeometry(towerHeight);
    tower.position.set(cablePos.x, terrainY, cablePos.z);

    const tangent = correctedCurve.getTangentAt(t);
    const angle = Math.atan2(tangent.x, tangent.z);
    tower.rotation.y = angle;

    group.add(tower);
  }

  // Chairs (using GLB model)
  const chairs = [];
  const chairSpacing = 150;
  const numChairs = Math.floor(totalLength / chairSpacing);

  for (let i = 0; i < numChairs; i++) {
    const chair = createChairFromModel();
    chair.userData.t = i / numChairs;
    chair.userData.direction = i % 2 === 0 ? 1 : -1;
    chairs.push(chair);
    group.add(chair);
  }

  // Base stations (top and bottom)
  if (liftBaseModelTemplate) {
    // Bottom station
    const bottomBase = liftBaseModelTemplate.clone();
    const bottomTerrainY = getHeightAt(densePoints[0].x, densePoints[0].z, heightmap, resolution);
    bottomBase.position.set(densePoints[0].x, bottomTerrainY, densePoints[0].z);
    const tangentBottom = correctedCurve.getTangentAt(0);
    bottomBase.rotation.y = Math.atan2(tangentBottom.x, tangentBottom.z);
    group.add(bottomBase);

    // Top station
    const topBase = liftBaseModelTemplate.clone();
    const lastPt = densePoints[densePoints.length - 1];
    const topTerrainY = getHeightAt(lastPt.x, lastPt.z, heightmap, resolution);
    topBase.position.set(lastPt.x, topTerrainY, lastPt.z);
    const tangentTop = correctedCurve.getTangentAt(1);
    topBase.rotation.y = Math.atan2(tangentTop.x, tangentTop.z);
    group.add(topBase);
  }

  const bottomPoint = densePoints[0].clone();

  return {
    group,
    chairs,
    curve: correctedCurve,
    speed: def.type === 'gondola' ? 9.0 : 7.0,
    totalLength,
    type: def.type,
    name: def.name,
    number: def.number,
    topPoint: densePoints[densePoints.length - 1].clone(),
    bottomPoint,
  };
}

/**
 * Build the full lift system. Loads the chairlift GLB model first.
 */
export async function generateLiftSystem(heightmap, resolution) {
  // Load all lift models in parallel before building lifts
  const modelLoaders = [
    loadChairliftModel().catch(err => console.warn('Failed to load chairlift model:', err)),
    loadLiftPoleModel().catch(err => console.warn('Failed to load lift pole model:', err)),
    loadLiftBaseModel().catch(err => console.warn('Failed to load lift base model:', err)),
  ];
  await Promise.all(modelLoaders);

  const mainGroup = new THREE.Group();
  mainGroup.name = 'LiftSystem';

  const lifts = [];

  for (const def of LIFT_DEFS) {
    const lift = buildLift(def, heightmap, resolution);
    mainGroup.add(lift.group);
    lifts.push(lift);
  }

  return { group: mainGroup, lifts };
}

export function updateLifts(lifts, deltaTime) {
  for (const lift of lifts) {
    const speedT = (lift.speed * deltaTime) / lift.totalLength;

    for (const chair of lift.chairs) {
      const isUphill = chair.userData.direction > 0;

      if (isUphill) {
        chair.userData.t += speedT;
      } else {
        chair.userData.t -= speedT;
      }
      if (chair.userData.t > 1) chair.userData.t -= 1;
      if (chair.userData.t < 0) chair.userData.t += 1;

      const t = chair.userData.t;
      const pos = lift.curve.getPointAt(t);

      const tangent = lift.curve.getTangentAt(t);

      if (!isUphill) {
        const perpX = -tangent.z;
        const perpZ = tangent.x;
        const len = Math.sqrt(perpX * perpX + perpZ * perpZ) || 1;
        pos.x += (perpX / len) * 15;
        pos.z += (perpZ / len) * 15;
      }

      chair.position.copy(pos);

      let angle = Math.atan2(tangent.x, tangent.z);
      if (!isUphill) angle += Math.PI;
      chair.rotation.y = angle;
    }
  }
}

export function findNearestLiftBottom(lifts, position, maxDistance = 150) {
  let nearest = null;
  let nearestDist = maxDistance;

  for (const lift of lifts) {
    const bp = lift.bottomPoint;
    const dx = position.x - bp.x;
    const dz = position.z - bp.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = { lift, distance: dist };
    }
  }

  return nearest;
}
