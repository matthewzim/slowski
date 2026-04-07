/**
 * Chairlift System for Jamboree Snow Resort
 * Creates terrain-following lift lines with towers, cables, and moving chairs.
 *
 * 9 chairlifts matching the Jamboree Snow Resort trail map:
 * 1 - Base village to lower mid-mountain (green, beginner)
 * 2 - Right mid to right shoulder (orange)
 * 3 - Right base to right lower mountain (orange)
 * 4 - Right center to upper right ridge (orange)
 * 5 - Left base to left shoulder (green)
 * 6 - Upper mountain to summit (orange)
 * 7 - Mid center to center bowl (yellow)
 * 8 - Upper mountain to summit (orange, parallel to 6)
 * 9 - Upper mountain to summit (orange, parallel to 6,8)
 */

import * as THREE from 'three';
import { normalizedToWorld, getHeightAt, TERRAIN_CONFIG } from './terrain.js';

// -- Lift definitions --
export const LIFT_DEFS = [
  {
    name: 'Lift 1 - Village Express',
    number: 1,
    points: [[0.48, 0.12], [0.47, 0.18], [0.46, 0.26], [0.46, 0.35]],
    type: 'gondola',
    towerSpacing: 400,
    cableHeight: 40,
    color: 0x44cc44,
  },
  {
    name: 'Lift 2 - Ridge Runner',
    number: 2,
    points: [[0.73, 0.38], [0.72, 0.44], [0.72, 0.50], [0.72, 0.55]],
    type: 'quad',
    towerSpacing: 350,
    cableHeight: 35,
    color: 0xff8800,
  },
  {
    name: 'Lift 3 - East Side Express',
    number: 3,
    points: [[0.82, 0.12], [0.80, 0.18], [0.78, 0.24], [0.75, 0.30]],
    type: 'quad',
    towerSpacing: 350,
    cableHeight: 35,
    color: 0xff8800,
  },
  {
    name: 'Lift 4 - Summit Rider',
    number: 4,
    points: [[0.64, 0.54], [0.63, 0.60], [0.62, 0.68], [0.62, 0.75]],
    type: 'quad',
    towerSpacing: 375,
    cableHeight: 40,
    color: 0xff8800,
  },
  {
    name: 'Lift 5 - Timberline',
    number: 5,
    points: [[0.13, 0.36], [0.14, 0.42], [0.16, 0.48], [0.18, 0.55]],
    type: 'quad',
    towerSpacing: 325,
    cableHeight: 30,
    color: 0x44cc44,
  },
  {
    name: 'Lift 6 - Peak Express',
    number: 6,
    points: [[0.40, 0.73], [0.40, 0.78], [0.41, 0.83], [0.41, 0.88]],
    type: 'quad',
    towerSpacing: 350,
    cableHeight: 35,
    color: 0xff8800,
  },
  {
    name: 'Lift 7 - Bowl Cruiser',
    number: 7,
    points: [[0.46, 0.42], [0.47, 0.48], [0.48, 0.55], [0.48, 0.62]],
    type: 'quad',
    towerSpacing: 350,
    cableHeight: 35,
    color: 0xffcc00,
  },
  {
    name: 'Lift 8 - Alpine Express',
    number: 8,
    points: [[0.44, 0.73], [0.45, 0.78], [0.44, 0.83], [0.43, 0.88]],
    type: 'quad',
    towerSpacing: 350,
    cableHeight: 35,
    color: 0xff8800,
  },
  {
    name: 'Lift 9 - Glacier Chair',
    number: 9,
    points: [[0.48, 0.73], [0.50, 0.78], [0.50, 0.83], [0.49, 0.88]],
    type: 'quad',
    towerSpacing: 350,
    cableHeight: 35,
    color: 0xff8800,
  },
];

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

// -- Chair geometry --
function createChairGeometry(type, color) {
  const group = new THREE.Group();

  if (type === 'gondola') {
    const cabinGeo = new THREE.BoxGeometry(7.5, 11.0, 7.5);
    const cabinMat = new THREE.MeshStandardMaterial({ color: color || 0xcc2222, metalness: 0.3, roughness: 0.5 });
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.y = -7.5;
    cabin.castShadow = true;
    group.add(cabin);

    const hangerGeo = new THREE.CylinderGeometry(0.25, 0.25, 10, 4);
    const hangerMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.8 });
    const hanger = new THREE.Mesh(hangerGeo, hangerMat);
    hanger.position.y = -1.0;
    group.add(hanger);
  } else {
    const seatGeo = new THREE.BoxGeometry(12.5, 0.5, 3.5);
    const seatMat = new THREE.MeshStandardMaterial({ color: color || 0x2244aa, metalness: 0.2, roughness: 0.6 });
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

    const footGeo = new THREE.BoxGeometry(11.0, 0.25, 1.5);
    const foot = new THREE.Mesh(footGeo, new THREE.MeshStandardMaterial({ color: 0x333333 }));
    foot.position.set(0, -14.0, 1.5);
    group.add(foot);
  }

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

    const tower = createTowerGeometry(towerHeight);
    tower.position.set(cablePos.x, terrainY, cablePos.z);

    const tangent = correctedCurve.getTangentAt(t);
    const angle = Math.atan2(tangent.x, tangent.z);
    tower.rotation.y = angle;

    group.add(tower);
  }

  // Chairs
  const chairs = [];
  const chairSpacing = 150;
  const numChairs = Math.floor(totalLength / chairSpacing);

  for (let i = 0; i < numChairs; i++) {
    const chair = createChairGeometry(def.type, def.color);
    chair.userData.t = i / numChairs;
    chair.userData.direction = i % 2 === 0 ? 1 : -1;
    chairs.push(chair);
    group.add(chair);
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

export function generateLiftSystem(heightmap, resolution) {
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
