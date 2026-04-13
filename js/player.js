/**
 * Player Controller
 * Gravity-based downhill skiing with turning/carving and slope-influenced speed.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getHeightAt, getNormalAt, getSlopeAt, TERRAIN_CONFIG } from './terrain.js';

const TRAIL_DURATION = 10; // seconds trails last
const TRAIL_MAX_POINTS = 600;
const PLAYER_MODEL_PATH = 'cartoon+skier+3d+model (1).glb';
const PLAYER_MODEL_YAW_OFFSET = -Math.PI / 2; // Rotate imported GLB so skier faces downhill (away from camera).

const PLAYER_CONFIG = {
  // Physics
  gravity: 9.81,
  maxSpeed: 45, // m/s (~162 km/h)
  minSpeed: 0.5,
  friction: 0.012,
  airDrag: 0.0015,
  brakeFriction: 0.35,
  skateForce: 8.0, // Forward push acceleration (m/s²)
  // Turning
  turnSpeed: 0.524,  // ~30 deg/s → 90° in 3 seconds
  carveFactor: 0.97, // How much speed is preserved in turns (gentle initial slowdown)
  carveBlendMin: 0.03,  // Initial lerp factor when turn begins
  carveBlendMax: 0.12,  // Max lerp factor after sustained turn
  carveBlendRampTime: 1.5, // Seconds to reach max blend
  // Player dimensions
  height: 1.6,
  radius: 0.3,
  groundClearance: 0.1, // Small offset to keep skier just above terrain surface
};

export class Player {
  constructor(heightmap, resolution) {
    this.heightmap = heightmap;
    this.resolution = resolution;

    // State
    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.speed = 0;
    this.heading = Math.PI; // Face downhill initially
    this.onGround = true;
    this.turnDuration = 0; // Track how long player has been turning

    // Input state
    this.input = { left: false, right: false, brake: false };

    // Chairlift state
    this.onLift = false;
    this.currentLift = null;
    this.liftT = 0;

    // Create visual mesh
    this.mesh = this._createMesh();
    this.visualRoot = new THREE.Group();
    this.mesh.add(this.visualRoot);
    this.skiTrackHalfWidth = 0.45;

    // Animation/model state
    this.modelMixer = null;
    this.modelActions = {};
    this.modelActionWeights = {};
    this.modelRig = null;
    this.modelRigBase = new Map();
    this.animTime = 0;

    // Create placeholder, then load final skier model
    this._setVisual(this._createFallbackVisual(), 6.0);
    this._loadPlayerModel().catch((err) => {
      console.warn('Could not load skier GLB; using fallback stick figure.', err);
    });

    // Ski trails
    this.trailHistory = []; // { pos: Vector3, time: number }
    this.trailLineL = null;
    this.trailLineR = null;
    this.trailGroup = new THREE.Group();
    this._initTrails();

    // Spawn position
    this.spawn();
  }

  _createMesh() {
    return new THREE.Group();
  }

  _createFallbackVisual() {
    const group = new THREE.Group();

    const bodyGeo = new THREE.CapsuleGeometry(0.2, 0.8, 4, 8);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.0;
    body.castShadow = true;
    group.add(body);

    const headGeo = new THREE.SphereGeometry(0.2, 8, 8);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffdd44 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.7;
    head.castShadow = true;
    group.add(head);

    const skiGeo = new THREE.BoxGeometry(0.08, 0.03, 1.6);
    const skiMat = new THREE.MeshStandardMaterial({ color: 0x2255cc, metalness: 0.5 });
    const skiL = new THREE.Mesh(skiGeo, skiMat);
    skiL.position.set(-0.15, 0.02, 0);
    group.add(skiL);
    const skiR = new THREE.Mesh(skiGeo, skiMat);
    skiR.position.set(0.15, 0.02, 0);
    group.add(skiR);

    const poleGeo = new THREE.CylinderGeometry(0.015, 0.015, 1.2, 4);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x44cc44, metalness: 0.4 });
    const poleL = new THREE.Mesh(poleGeo, poleMat);
    poleL.position.set(-0.35, 0.8, -0.1);
    poleL.rotation.x = 0.3;
    group.add(poleL);
    const poleR = new THREE.Mesh(poleGeo, poleMat);
    poleR.position.set(0.35, 0.8, -0.1);
    poleR.rotation.x = 0.3;
    group.add(poleR);

    return group;
  }

  _setVisual(object3d, scale = 1.0) {
    this.visualRoot.clear();
    this.visualRoot.add(object3d);
    this.visualRoot.scale.setScalar(scale);
    this.skiTrackHalfWidth = 0.15 * scale;
  }

  async _loadPlayerModel() {
    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) => {
      loader.load(PLAYER_MODEL_PATH, resolve, undefined, reject);
    });

    const model = gltf.scene;
    model.rotation.y = PLAYER_MODEL_YAW_OFFSET;
    model.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });

    // Significantly larger skier so they occupy much more of the screen.
    this._setVisual(model, 3.8);
    this._bindModelAnimations(model, gltf.animations || []);
  }

  _bindModelAnimations(model, clips) {
    this.modelMixer = null;
    this.modelActions = {};
    this.modelActionWeights = {};
    this.modelRig = this._extractRig(model);
    this.modelRigBase.clear();

    if (this.modelRig) {
      Object.entries(this.modelRig).forEach(([key, bone]) => {
        if (bone) this.modelRigBase.set(key, bone.quaternion.clone());
      });
    }

    if (!clips.length) return;

    this.modelMixer = new THREE.AnimationMixer(model);
    clips.forEach((clip) => {
      const action = this.modelMixer.clipAction(clip);
      action.play();
      action.enabled = true;
      action.setEffectiveWeight(0);
      action.setLoop(THREE.LoopRepeat, Infinity);
      this.modelActions[clip.name.toLowerCase()] = action;
      this.modelActionWeights[clip.name.toLowerCase()] = 0;
    });
  }

  _extractRig(model) {
    const bones = [];
    model.traverse((obj) => {
      if (obj.isBone) bones.push(obj);
    });
    if (!bones.length) return null;

    const findBone = (patterns) => bones.find((bone) => patterns.some((p) => p.test(bone.name.toLowerCase())));
    return {
      spine: findBone([/spine/, /chest/]),
      hip: findBone([/hip/, /pelvis/]),
      armL: findBone([/leftarm/, /arm_l/, /upperarm.*l/, /l.*upperarm/]),
      armR: findBone([/rightarm/, /arm_r/, /upperarm.*r/, /r.*upperarm/]),
      forearmL: findBone([/leftforearm/, /forearm_l/, /lowerarm.*l/]),
      forearmR: findBone([/rightforearm/, /forearm_r/, /lowerarm.*r/]),
      thighL: findBone([/leftupleg/, /thigh_l/, /upleg.*l/]),
      thighR: findBone([/rightupleg/, /thigh_r/, /upleg.*r/]),
      footL: findBone([/leftfoot/, /foot_l/]),
      footR: findBone([/rightfoot/, /foot_r/]),
    };
  }

  _initTrails() {
    const trailMat = new THREE.LineBasicMaterial({
      color: 0x8899bb,
      transparent: true,
      opacity: 0.6,
      linewidth: 2,
    });

    // Left ski trail
    const geoL = new THREE.BufferGeometry();
    geoL.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(TRAIL_MAX_POINTS * 3), 3));
    geoL.setDrawRange(0, 0);
    this.trailLineL = new THREE.Line(geoL, trailMat);
    this.trailLineL.frustumCulled = false;
    this.trailGroup.add(this.trailLineL);

    // Right ski trail
    const geoR = new THREE.BufferGeometry();
    geoR.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(TRAIL_MAX_POINTS * 3), 3));
    geoR.setDrawRange(0, 0);
    this.trailLineR = new THREE.Line(geoR, trailMat.clone());
    this.trailLineR.frustumCulled = false;
    this.trailGroup.add(this.trailLineR);
  }

  _updateTrails(gameTime) {
    // Only record trails when on ground and moving
    if (this.onGround && this.speed > 0.5 && !this.onLift) {
      const skiOffsetLocal = this.skiTrackHalfWidth;
      const sinH = Math.sin(this.heading);
      const cosH = Math.cos(this.heading);
      // Perpendicular to heading for left/right ski offset
      const perpX = cosH;
      const perpZ = -sinH;

      const baseY = this.position.y + 0.05;

      this.trailHistory.push({
        lx: this.position.x - perpX * skiOffsetLocal,
        lz: this.position.z - perpZ * skiOffsetLocal,
        rx: this.position.x + perpX * skiOffsetLocal,
        rz: this.position.z + perpZ * skiOffsetLocal,
        y: baseY,
        time: gameTime,
      });

      if (this.trailHistory.length > TRAIL_MAX_POINTS) {
        this.trailHistory.shift();
      }
    }

    // Remove old trail points
    const cutoff = gameTime - TRAIL_DURATION;
    while (this.trailHistory.length > 0 && this.trailHistory[0].time < cutoff) {
      this.trailHistory.shift();
    }

    // Update trail line geometries
    const count = this.trailHistory.length;
    if (count < 2) {
      this.trailLineL.geometry.setDrawRange(0, 0);
      this.trailLineR.geometry.setDrawRange(0, 0);
      return;
    }

    const posL = this.trailLineL.geometry.attributes.position.array;
    const posR = this.trailLineR.geometry.attributes.position.array;

    for (let i = 0; i < count; i++) {
      const h = this.trailHistory[i];
      posL[i * 3] = h.lx;
      posL[i * 3 + 1] = h.y;
      posL[i * 3 + 2] = h.lz;
      posR[i * 3] = h.rx;
      posR[i * 3 + 1] = h.y;
      posR[i * 3 + 2] = h.rz;
    }

    this.trailLineL.geometry.attributes.position.needsUpdate = true;
    this.trailLineR.geometry.attributes.position.needsUpdate = true;
    this.trailLineL.geometry.setDrawRange(0, count);
    this.trailLineR.geometry.setDrawRange(0, count);
  }

  spawn() {
    // Start at top of Excalibur Gondola (lower mid-mountain)
    // Normalized (0.19, 0.22) -> world coords
    const startX = (0.19 - 0.5) * TERRAIN_CONFIG.worldWidth;
    const startZ = (0.22 - 0.5) * TERRAIN_CONFIG.worldDepth;
    const startY = getHeightAt(startX, startZ, this.heightmap, this.resolution);

    this.position.set(startX, startY + PLAYER_CONFIG.groundClearance, startZ);
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this.heading = Math.PI; // Pointing downhill (toward base village)
    this.onLift = false;
    this.currentLift = null;
    this.mesh.position.copy(this.position);
    this.mesh.position.y += PLAYER_CONFIG.height * 0.1;
  }

  // Board a chairlift
  boardLift(lift) {
    this.onLift = true;
    this.currentLift = lift;
    this.liftT = 0.0; // Start at bottom of curve
    this.velocity.set(0, 0, 0);
    this.speed = 0;
  }

  // Skip to top of chairlift
  skipToLiftTop() {
    if (!this.onLift || !this.currentLift) return;
    const topPoint = this.currentLift.curve.getPointAt(0.98);
    const terrainY = getHeightAt(topPoint.x, topPoint.z, this.heightmap, this.resolution);
    this.position.set(topPoint.x, terrainY + PLAYER_CONFIG.groundClearance, topPoint.z);
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this.onLift = false;
    this.currentLift = null;
  }

  update(deltaTime, input, gameTime) {
    if (deltaTime > 0.1) deltaTime = 0.1; // Cap dt to prevent physics explosions

    this.input = input;

    // If riding a chairlift, move along the curve
    if (this.onLift && this.currentLift) {
      const lift = this.currentLift;
      const speedT = (lift.speed * deltaTime) / lift.totalLength;
      this.liftT += speedT;

      if (this.liftT >= 0.98) {
        // Reached the top
        this.skipToLiftTop();
      } else {
        const pos = lift.curve.getPointAt(this.liftT);
        this.position.copy(pos);
        this.position.y -= 10.0; // Sit below cable (5x scale)
        const tangent = lift.curve.getTangentAt(this.liftT);
        this.heading = Math.atan2(tangent.x, tangent.z);

        this.mesh.position.copy(this.position);
        this.mesh.rotation.y = this.heading;
        this.mesh.rotation.x = 0;
        this.mesh.rotation.z = 0;
      }

      this._updateCharacterAnimation(deltaTime, {
        turn: 0,
        accelerating: false,
        braking: false,
        speedRatio: 0,
      });

      this._updateTrails(gameTime || 0);
      return {
        speed: 0,
        speedKmh: 0,
        elevation: this.position.y + TERRAIN_CONFIG.baseElevation,
        slope: 0,
        onGround: false,
        onLift: true,
        liftName: lift.name,
      };
    }

    // Get terrain info at current position
    const terrainHeight = getHeightAt(this.position.x, this.position.z, this.heightmap, this.resolution);
    const terrainNormal = getNormalAt(this.position.x, this.position.z, this.heightmap, this.resolution);
    const slope = getSlopeAt(this.position.x, this.position.z, this.heightmap, this.resolution);

    // -- Turning (disabled while braking) --
    let turnAmount = 0;
    if (!input.brake) {
      if (input.left) turnAmount += PLAYER_CONFIG.turnSpeed;
      if (input.right) turnAmount -= PLAYER_CONFIG.turnSpeed;
    }

    this.heading += turnAmount * deltaTime;

    // Direction vector from heading
    const dir = new THREE.Vector3(
      Math.sin(this.heading),
      0,
      Math.cos(this.heading)
    );

    // -- Gravity on slope --
    // Project gravity onto the slope surface
    const gravityVec = new THREE.Vector3(0, -PLAYER_CONFIG.gravity, 0);

    // Remove the normal component to get the along-slope gravity
    const normalComponent = terrainNormal.clone().multiplyScalar(gravityVec.dot(terrainNormal));
    const slopeGravity = gravityVec.clone().sub(normalComponent);

    // Apply slope gravity
    this.velocity.add(slopeGravity.multiplyScalar(deltaTime));

    // -- Skating (forward push) --
    if (input.skate && this.onGround) {
      const skateDir = dir.clone().multiplyScalar(PLAYER_CONFIG.skateForce * deltaTime);
      this.velocity.add(skateDir);
    }

    // -- Friction --
    let frictionCoeff = PLAYER_CONFIG.friction;
    if (input.brake) {
      frictionCoeff = PLAYER_CONFIG.brakeFriction;
    }

    // Apply friction opposing velocity
    const speed = this.velocity.length();
    if (speed > 0.01) {
      const frictionForce = frictionCoeff * PLAYER_CONFIG.gravity;
      const frictionDecel = Math.min(frictionForce * deltaTime, speed);
      const frictionDir = this.velocity.clone().normalize().multiplyScalar(-frictionDecel);
      this.velocity.add(frictionDir);
    }

    // Air drag (quadratic)
    if (speed > 1) {
      const dragForce = PLAYER_CONFIG.airDrag * speed * speed;
      const dragDecel = Math.min(dragForce * deltaTime, speed * 0.5);
      this.velocity.add(this.velocity.clone().normalize().multiplyScalar(-dragDecel));
    }

    // -- Carving: redirect velocity towards heading --
    const currentSpeed = this.velocity.length();
    if (currentSpeed > PLAYER_CONFIG.minSpeed && (input.left || input.right)) {
      // Track turn duration for progressive braking
      this.turnDuration += deltaTime;
      const turnT = Math.min(this.turnDuration / PLAYER_CONFIG.carveBlendRampTime, 1.0);
      const carveBlend = PLAYER_CONFIG.carveBlendMin + turnT * (PLAYER_CONFIG.carveBlendMax - PLAYER_CONFIG.carveBlendMin);
      // Blend velocity direction toward heading
      const desiredVel = dir.clone().multiplyScalar(currentSpeed * PLAYER_CONFIG.carveFactor);
      this.velocity.lerp(desiredVel, carveBlend);
    } else if (currentSpeed > PLAYER_CONFIG.minSpeed) {
      this.turnDuration = 0;
      // Auto-align heading to velocity when not turning
      const velDir = this.velocity.clone().normalize();
      const targetHeading = Math.atan2(velDir.x, velDir.z);

      // Smooth heading alignment
      let headingDiff = targetHeading - this.heading;
      while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;
      while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;
      this.heading += headingDiff * 2.0 * deltaTime;
    }

    // Clamp speed
    this.speed = this.velocity.length();
    if (this.speed > PLAYER_CONFIG.maxSpeed) {
      this.velocity.multiplyScalar(PLAYER_CONFIG.maxSpeed / this.speed);
      this.speed = PLAYER_CONFIG.maxSpeed;
    }

    // -- Update position --
    this.position.add(this.velocity.clone().multiplyScalar(deltaTime));

    // -- Ground collision --
    const groundY = getHeightAt(this.position.x, this.position.z, this.heightmap, this.resolution);
    const gc = PLAYER_CONFIG.groundClearance;
    const heightAboveGround = this.position.y - groundY;

    if (heightAboveGround <= gc) {
      // Below or at ground - snap up
      this.position.y = groundY + gc;
      this.onGround = true;
      if (this.velocity.y < 0) {
        this.velocity.y = 0;
      }
    } else if (this.onGround && heightAboveGround < gc + 5.0) {
      // Was on ground and still close - stay grounded (prevents floating on slopes)
      this.position.y = groundY + gc;
      this.onGround = true;
      // Project velocity onto terrain surface so Y doesn't accumulate
      const projDot = this.velocity.dot(terrainNormal);
      if (projDot < 0) {
        this.velocity.sub(terrainNormal.clone().multiplyScalar(projDot));
      }
    } else {
      // Genuinely airborne
      this.onGround = false;
      // Apply freefall gravity when airborne
      this.velocity.y -= PLAYER_CONFIG.gravity * deltaTime;
    }

    // -- World bounds --
    const halfW = TERRAIN_CONFIG.worldWidth / 2 - 20;
    const halfD = TERRAIN_CONFIG.worldDepth / 2 - 20;
    this.position.x = Math.max(-halfW, Math.min(halfW, this.position.x));
    this.position.z = Math.max(-halfD, Math.min(halfD, this.position.z));

    // -- Update mesh --
    this.mesh.position.copy(this.position);
    this.mesh.position.y += PLAYER_CONFIG.height * 0.1;
    this.mesh.rotation.y = this.heading;

    // Lean into turns
    const leanAngle = turnAmount * 0.15;
    this.mesh.rotation.z = -leanAngle;

    // Tilt with slope
    const forward = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const slopeAngle = Math.asin(Math.max(-1, Math.min(1,
      -(terrainNormal.x * forward.x + terrainNormal.z * forward.z)
    )));
    this.mesh.rotation.x = slopeAngle * 0.5;

    this._updateCharacterAnimation(deltaTime, {
      turn: input.left ? 1 : (input.right ? -1 : 0),
      accelerating: !!(input.skate && this.onGround),
      braking: !!input.brake,
      speedRatio: Math.min(1, this.speed / PLAYER_CONFIG.maxSpeed),
    });

    // Update ski trails
    this._updateTrails(gameTime || 0);

    return {
      speed: this.speed,
      speedKmh: this.speed * 3.6,
      elevation: groundY + TERRAIN_CONFIG.baseElevation,
      slope: slope * (180 / Math.PI),
      onGround: this.onGround,
      onLift: false,
    };
  }

  _updateCharacterAnimation(deltaTime, state) {
    this.animTime += deltaTime;

    if (this.modelMixer && Object.keys(this.modelActions).length) {
      this._updateClipAnimation(deltaTime, state);
      return;
    }

    if (this.modelRig) {
      this._updateProceduralRigAnimation(state);
    }
  }

  _updateClipAnimation(deltaTime, state) {
    const targets = {};
    const entries = Object.keys(this.modelActions);
    entries.forEach((name) => { targets[name] = 0; });

    const chooseByKeywords = (keywords) => entries.find((n) => keywords.some((k) => n.includes(k)));
    const turnLeft = chooseByKeywords(['turn_left', 'left', 'carve_left']);
    const turnRight = chooseByKeywords(['turn_right', 'right', 'carve_right']);
    const push = chooseByKeywords(['speed', 'push', 'pole', 'skate', 'acceler']);
    const brake = chooseByKeywords(['brake', 'slow', 'snowplow', 'wedge']);
    const idle = chooseByKeywords(['idle', 'ski', 'base']) || entries[0];

    targets[idle] = 0.35 + state.speedRatio * 0.65;
    if (turnLeft && state.turn > 0) targets[turnLeft] = Math.abs(state.turn);
    if (turnRight && state.turn < 0) targets[turnRight] = Math.abs(state.turn);
    if (push && state.accelerating) targets[push] = 1.0;
    if (brake && state.braking) targets[brake] = 1.0;

    entries.forEach((name) => {
      const action = this.modelActions[name];
      const current = this.modelActionWeights[name] || 0;
      const next = THREE.MathUtils.lerp(current, targets[name] || 0, Math.min(1, deltaTime * 8));
      this.modelActionWeights[name] = next;
      action.setEffectiveWeight(next);
      action.setEffectiveTimeScale(0.8 + state.speedRatio * 0.8);
    });

    this.modelMixer.update(deltaTime);
  }

  _updateProceduralRigAnimation(state) {
    const rig = this.modelRig;
    if (!rig) return;

    const polePunch = state.accelerating ? Math.sin(this.animTime * 14) * 0.8 : 0;
    const sway = Math.sin(this.animTime * (2 + state.speedRatio * 5)) * 0.05;
    const turn = state.turn;
    const brake = state.braking ? 1 : 0;

    this._applyBonePose('spine', new THREE.Euler(-0.1 - brake * 0.2, -turn * 0.2 + sway, turn * 0.15));
    this._applyBonePose('armL', new THREE.Euler(0.35 + polePunch, 0.1, 0.35));
    this._applyBonePose('armR', new THREE.Euler(0.35 - polePunch, -0.1, -0.35));
    this._applyBonePose('forearmL', new THREE.Euler(-0.3 - polePunch * 0.5, 0, 0));
    this._applyBonePose('forearmR', new THREE.Euler(-0.3 + polePunch * 0.5, 0, 0));
    this._applyBonePose('thighL', new THREE.Euler(-0.05 + brake * 0.15, 0, 0.12 + turn * 0.25));
    this._applyBonePose('thighR', new THREE.Euler(-0.05 + brake * 0.15, 0, -0.12 + turn * 0.25));
    this._applyBonePose('footL', new THREE.Euler(brake * 0.25, 0, 0.1 + brake * 0.35 + turn * 0.15));
    this._applyBonePose('footR', new THREE.Euler(brake * 0.25, 0, -0.1 - brake * 0.35 + turn * 0.15));
  }

  _applyBonePose(key, eulerOffset) {
    const bone = this.modelRig?.[key];
    const base = this.modelRigBase.get(key);
    if (!bone || !base) return;

    const target = base.clone().multiply(new THREE.Quaternion().setFromEuler(eulerOffset));
    bone.quaternion.slerp(target, 0.16);
  }

  getSpeedKmh() {
    return this.speed * 3.6;
  }
}
