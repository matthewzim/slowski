/**
 * Third-person follow camera system.
 * Smooth lag, slight downward tilt, speed-based zoom.
 * Inspired by the Wii ski game reference screenshot.
 */

import * as THREE from 'three';
import { getHeightAt } from './terrain.js';

const CAM_CONFIG = {
  // Base distance behind player (closer framing so player occupies ~25% of screen).
  baseDistance: 10.5,
  // Height above player
  baseHeight: 4.2,
  // Look-ahead offset (how far ahead of player to look)
  lookAheadDist: 6,
  lookSmoothing: 0.08,
  // Speed zoom (disabled - player stays same size on screen)
  speedZoomFactor: 0,
  maxSpeedZoom: 0,
  // Minimum height above terrain
  minTerrainClearance: 3.5,
  // Downward tilt (radians)
  baseTilt: 0.15,
};

export class FollowCamera {
  constructor(camera, heightmap, resolution) {
    this.camera = camera;
    this.heightmap = heightmap;
    this.resolution = resolution;

    // Smoothed values
    this.currentPosition = new THREE.Vector3();
    this.currentLookAt = new THREE.Vector3();
    this.initialized = false;
  }

  update(playerPosition, playerHeading, playerSpeed, deltaTime) {
    const speedFactor = Math.min(playerSpeed * CAM_CONFIG.speedZoomFactor, CAM_CONFIG.maxSpeedZoom);
    const distance = CAM_CONFIG.baseDistance + speedFactor;
    const height = CAM_CONFIG.baseHeight + speedFactor * 0.3;

    // Calculate ideal camera position (behind and above player)
    const behindX = -Math.sin(playerHeading) * distance;
    const behindZ = -Math.cos(playerHeading) * distance;

    const idealPos = new THREE.Vector3(
      playerPosition.x + behindX,
      playerPosition.y + height,
      playerPosition.z + behindZ
    );

    // Ensure camera doesn't go below terrain
    const terrainAtCam = getHeightAt(idealPos.x, idealPos.z, this.heightmap, this.resolution);
    idealPos.y = Math.max(idealPos.y, terrainAtCam + CAM_CONFIG.minTerrainClearance);

    // Calculate look-at point (ahead of player)
    const aheadX = Math.sin(playerHeading) * CAM_CONFIG.lookAheadDist;
    const aheadZ = Math.cos(playerHeading) * CAM_CONFIG.lookAheadDist;

    const idealLookAt = new THREE.Vector3(
      playerPosition.x + aheadX,
      playerPosition.y - CAM_CONFIG.baseTilt * 10,
      playerPosition.z + aheadZ
    );

    // Initialize or smooth
    if (!this.initialized) {
      this.currentPosition.copy(idealPos);
      this.currentLookAt.copy(idealLookAt);
      this.initialized = true;
    } else {
      // Smooth follow with frame-rate independent lerp
      const lookFactor = 1 - Math.pow(1 - CAM_CONFIG.lookSmoothing, deltaTime * 60);

      // Keep camera-to-player distance stable regardless of speed.
      this.currentPosition.copy(idealPos);
      this.currentLookAt.lerp(idealLookAt, lookFactor);
    }

    // Final terrain clearance check on smoothed position
    const finalTerrainY = getHeightAt(
      this.currentPosition.x,
      this.currentPosition.z,
      this.heightmap,
      this.resolution
    );
    this.currentPosition.y = Math.max(
      this.currentPosition.y,
      finalTerrainY + CAM_CONFIG.minTerrainClearance
    );

    // Apply to camera
    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(this.currentLookAt);
  }

  reset(playerPosition, playerHeading) {
    this.initialized = false;
    this.update(playerPosition, playerHeading, 0, 1/60);
  }
}
