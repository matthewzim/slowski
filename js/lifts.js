/**
 * Chairlift System for Whistler Blackcomb
 * Creates terrain-following lift lines with towers, cables, and moving chairs.
 *
 * Lift paths derived from the red lines on the Google Maps reference.
 */

import * as THREE from 'three';
import { normalizedToWorld, getHeightAt, TERRAIN_CONFIG } from './terrain.js';

// -- Lift definitions --
// Each lift is defined by start/end in normalized coords, plus metadata
const LIFT_DEFS = [
  {
    name: 'Excalibur Gondola',
    points: [[0.06, 0.14], [0.12, 0.20], [0.18, 0.28], [0.24, 0.34]],
    type: 'gondola',
    towerSpacing: 80,
    cableHeight: 8,
  },
  {
    name: 'Blackcomb Gondola',
    points: [[0.16, 0.34], [0.22, 0.40], [0.28, 0.48], [0.34, 0.54]],
    type: 'gondola',
    towerSpacing: 90,
    cableHeight: 10,
  },
  {
    name: 'Excelerator Express',
    points: [[0.30, 0.24], [0.35, 0.30], [0.40, 0.38], [0.44, 0.44]],
    type: 'quad',
    towerSpacing: 70,
    cableHeight: 7,
  },
  {
    name: 'Crystal Ridge Express',
    points: [[0.52, 0.06], [0.54, 0.12], [0.55, 0.20], [0.56, 0.26]],
    type: 'quad',
    towerSpacing: 65,
    cableHeight: 7,
  },
  {
    name: 'Glacier Express',
    points: [[0.56, 0.34], [0.58, 0.40], [0.60, 0.46], [0.62, 0.54]],
    type: 'quad',
    towerSpacing: 70,
    cableHeight: 7,
  },
  {
    name: 'Catskinner Express',
    points: [[0.22, 0.56], [0.26, 0.52], [0.30, 0.50], [0.36, 0.46], [0.40, 0.44]],
    type: 'quad',
    towerSpacing: 65,
    cableHeight: 6,
  },
  {
    name: '7th Heaven Express',
    points: [[0.64, 0.58], [0.66, 0.64], [0.68, 0.72], [0.70, 0.82]],
    type: 'quad',
    towerSpacing: 75,
    cableHeight: 8,
  },
];

// -- Tower geometry (reusable) --
function createTowerGeometry() {
  const group = new THREE.Group();

  // Main pole
  const poleGeo = new THREE.CylinderGeometry(0.3, 0.4, 12, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.7, roughness: 0.3 });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.y = 6;
  pole.castShadow = true;
  group.add(pole);

  // Cross arm
  const armGeo = new THREE.BoxGeometry(4, 0.3, 0.3);
  const arm = new THREE.Mesh(armGeo, poleMat);
  arm.position.y = 12;
  arm.castShadow = true;
  group.add(arm);

  // Sheaves (wheels at top)
  const sheaveGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.2, 8);
  const sheaveMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.8, roughness: 0.2 });

  const sheaveL = new THREE.Mesh(sheaveGeo, sheaveMat);
  sheaveL.rotation.z = Math.PI / 2;
  sheaveL.position.set(-1.8, 12.2, 0);
  group.add(sheaveL);

  const sheaveR = new THREE.Mesh(sheaveGeo, sheaveMat);
  sheaveR.rotation.z = Math.PI / 2;
  sheaveR.position.set(1.8, 12.2, 0);
  group.add(sheaveR);

  return group;
}

// -- Chair geometry --
function createChairGeometry(type) {
  const group = new THREE.Group();

  if (type === 'gondola') {
    // Gondola cabin
    const cabinGeo = new THREE.BoxGeometry(1.5, 2.2, 1.5);
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0xcc2222, metalness: 0.3, roughness: 0.5 });
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.y = -1.5;
    cabin.castShadow = true;
    group.add(cabin);

    // Hanger bar
    const hangerGeo = new THREE.CylinderGeometry(0.05, 0.05, 2, 4);
    const hangerMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.8 });
    const hanger = new THREE.Mesh(hangerGeo, hangerMat);
    hanger.position.y = -0.2;
    group.add(hanger);
  } else {
    // Quad chair
    const seatGeo = new THREE.BoxGeometry(2.5, 0.1, 0.7);
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x2244aa, metalness: 0.2, roughness: 0.6 });
    const seat = new THREE.Mesh(seatGeo, seatMat);
    seat.position.y = -2.0;
    seat.castShadow = true;
    group.add(seat);

    // Back rest
    const backGeo = new THREE.BoxGeometry(2.5, 1.0, 0.1);
    const back = new THREE.Mesh(backGeo, seatMat);
    back.position.set(0, -1.5, -0.35);
    group.add(back);

    // Hanger
    const hangerGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.2, 4);
    const hangerMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.8 });
    const hanger = new THREE.Mesh(hangerGeo, hangerMat);
    hanger.position.y = -0.9;
    group.add(hanger);

    // Foot rest
    const footGeo = new THREE.BoxGeometry(2.2, 0.05, 0.3);
    const foot = new THREE.Mesh(footGeo, new THREE.MeshStandardMaterial({ color: 0x333333 }));
    foot.position.set(0, -2.8, 0.3);
    group.add(foot);
  }

  return group;
}

/**
 * Build the full lift line from a definition.
 * Returns { group, chairs, curve, speed } for animation.
 */
function buildLift(def, heightmap, resolution) {
  const group = new THREE.Group();
  group.name = def.name;

  // Convert points to world space with terrain height
  const worldPoints = def.points.map(([nx, ny]) => {
    const { x, z } = normalizedToWorld(nx, ny);
    const y = getHeightAt(x, z, heightmap, resolution);
    return new THREE.Vector3(x, y + def.cableHeight, z);
  });

  // Create smooth curve through points
  const curve = new THREE.CatmullRomCurve3(worldPoints, false, 'catmullrom', 0.3);
  const curvePoints = curve.getPoints(200);

  // Cable line
  const cableGeo = new THREE.BufferGeometry().setFromPoints(curvePoints);
  const cableMat = new THREE.LineBasicMaterial({ color: 0x222222, linewidth: 2 });
  const cableLine = new THREE.Line(cableGeo, cableMat);
  group.add(cableLine);

  // Second cable (offset for up/down lines)
  const returnPoints = curvePoints.map(p => {
    const offset = new THREE.Vector3(3, 0, 0);
    return p.clone().add(offset);
  });
  const returnGeo = new THREE.BufferGeometry().setFromPoints(returnPoints);
  const returnLine = new THREE.Line(returnGeo, cableMat);
  group.add(returnLine);

  // Place towers
  const totalLength = curve.getLength();
  const numTowers = Math.floor(totalLength / def.towerSpacing);

  for (let i = 0; i <= numTowers; i++) {
    const t = i / numTowers;
    const pos = curve.getPointAt(t);
    const terrainY = getHeightAt(pos.x, pos.z, heightmap, resolution);

    const tower = createTowerGeometry();
    tower.position.set(pos.x, terrainY, pos.z);

    // Orient tower to face along the cable
    const tangent = curve.getTangentAt(t);
    const angle = Math.atan2(tangent.x, tangent.z);
    tower.rotation.y = angle;

    group.add(tower);
  }

  // Create chairs along the cable
  const chairs = [];
  const chairSpacing = 30; // meters between chairs
  const numChairs = Math.floor(totalLength / chairSpacing);

  for (let i = 0; i < numChairs; i++) {
    const chair = createChairGeometry(def.type);
    chair.userData.t = i / numChairs; // position along curve (0-1)
    chair.userData.direction = i % 2 === 0 ? 1 : -1; // alternate up/down
    chairs.push(chair);
    group.add(chair);
  }

  return {
    group,
    chairs,
    curve,
    speed: def.type === 'gondola' ? 4.5 : 3.5, // m/s
    totalLength,
    type: def.type,
  };
}

/**
 * Generate the complete lift system.
 * Returns { group, lifts } where lifts is an array for animation.
 */
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

/**
 * Update chair positions along cables (call each frame).
 */
export function updateLifts(lifts, deltaTime) {
  for (const lift of lifts) {
    const speedT = (lift.speed * deltaTime) / lift.totalLength;

    for (const chair of lift.chairs) {
      // Move along curve
      chair.userData.t += speedT * 0.3;
      if (chair.userData.t > 1) chair.userData.t -= 1;
      if (chair.userData.t < 0) chair.userData.t += 1;

      const t = chair.userData.t;
      const pos = lift.curve.getPointAt(t);

      // Offset alternate chairs to simulate up/down lines
      if (chair.userData.direction < 0) {
        pos.x += 3;
      }

      chair.position.copy(pos);

      // Orient chair along cable
      const tangent = lift.curve.getTangentAt(t);
      const angle = Math.atan2(tangent.x, tangent.z);
      chair.rotation.y = angle;
    }
  }
}
