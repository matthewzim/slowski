/**
 * Player Controller
 * Gravity-based downhill skiing with turning/carving and slope-influenced speed.
 */

import * as THREE from 'three';
import { getHeightAt, getNormalAt, getSlopeAt, TERRAIN_CONFIG } from './terrain.js';

const PLAYER_CONFIG = {
  // Physics
  gravity: 9.81,
  maxSpeed: 35, // m/s (~126 km/h)
  minSpeed: 0.5,
  friction: 0.015,
  airDrag: 0.002,
  brakeFriction: 0.08,
  // Turning
  turnSpeed: 2.2,
  carveFactor: 0.85, // How much speed is preserved in turns
  // Player dimensions
  height: 1.6,
  radius: 0.3,
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

    // Input state
    this.input = { left: false, right: false, brake: false };

    // Create visual mesh
    this.mesh = this._createMesh();

    // Spawn position
    this.spawn();
  }

  _createMesh() {
    const group = new THREE.Group();

    // Body
    const bodyGeo = new THREE.CapsuleGeometry(0.2, 0.8, 4, 8);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.0;
    body.castShadow = true;
    group.add(body);

    // Head
    const headGeo = new THREE.SphereGeometry(0.2, 8, 8);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffdd44 }); // Yellow hair like reference
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.7;
    head.castShadow = true;
    group.add(head);

    // Skis
    const skiGeo = new THREE.BoxGeometry(0.08, 0.03, 1.6);
    const skiMat = new THREE.MeshStandardMaterial({ color: 0x2255cc, metalness: 0.5 });
    const skiL = new THREE.Mesh(skiGeo, skiMat);
    skiL.position.set(-0.15, 0.02, 0);
    group.add(skiL);

    const skiR = new THREE.Mesh(skiGeo, skiMat);
    skiR.position.set(0.15, 0.02, 0);
    group.add(skiR);

    // Poles
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

  spawn() {
    // Start at top of a run (Crystal Ridge area)
    const startX = -50;
    const startZ = -500;
    const startY = getHeightAt(startX, startZ, this.heightmap, this.resolution);

    this.position.set(startX, startY, startZ);
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this.heading = Math.PI * 0.7; // Pointing roughly downhill
    this.mesh.position.copy(this.position);
    this.mesh.position.y += PLAYER_CONFIG.height * 0.1;
  }

  update(deltaTime, input) {
    if (deltaTime > 0.1) deltaTime = 0.1; // Cap dt to prevent physics explosions

    this.input = input;

    // Get terrain info at current position
    const terrainHeight = getHeightAt(this.position.x, this.position.z, this.heightmap, this.resolution);
    const terrainNormal = getNormalAt(this.position.x, this.position.z, this.heightmap, this.resolution);
    const slope = getSlopeAt(this.position.x, this.position.z, this.heightmap, this.resolution);

    // -- Turning --
    let turnAmount = 0;
    if (input.left) turnAmount += PLAYER_CONFIG.turnSpeed;
    if (input.right) turnAmount -= PLAYER_CONFIG.turnSpeed;

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
      // Blend velocity direction toward heading
      const desiredVel = dir.clone().multiplyScalar(currentSpeed * PLAYER_CONFIG.carveFactor);
      this.velocity.lerp(desiredVel, 0.1);
    } else if (currentSpeed > PLAYER_CONFIG.minSpeed) {
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
    const heightAboveGround = this.position.y - groundY;

    if (heightAboveGround <= 0) {
      // Below or at ground - snap up
      this.position.y = groundY;
      this.onGround = true;
      if (this.velocity.y < 0) {
        this.velocity.y = 0;
      }
    } else if (this.onGround && heightAboveGround < 2.0) {
      // Was on ground and still close - stay grounded (prevents floating on slopes)
      this.position.y = groundY;
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

    return {
      speed: this.speed,
      speedKmh: this.speed * 3.6,
      elevation: groundY + TERRAIN_CONFIG.baseElevation,
      slope: slope * (180 / Math.PI),
      onGround: this.onGround,
    };
  }

  getSpeedKmh() {
    return this.speed * 3.6;
  }
}
