/**
 * Third-person follow camera system.
 * Smooth lag, slight downward tilt, speed-based zoom.
 * Inspired by the Wii ski game reference screenshot.
 */

import * as THREE from 'three';
import { getHeightAt } from './terrain.js';

const CAM_CONFIG = {
  // Base distance behind player
  baseDistance: 12,
  // Height above player
  baseHeight: 5,
  // Look-ahead offset (how far ahead of player to look)
  lookAheadDist: 8,
  // Smoothing factors (0-1, lower = smoother)
  positionSmoothing: 0.04,
  lookSmoothing: 0.08,
  // Speed zoom (camera pulls back at higher speeds)
  speedZoomFactor: 0.15,
  maxSpeedZoom: 8,
  // Minimum height above terrain
  minTerrainClearance: 2.5,
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
      const posFactor = 1 - Math.pow(1 - CAM_CONFIG.positionSmoothing, deltaTime * 60);
      const lookFactor = 1 - Math.pow(1 - CAM_CONFIG.lookSmoothing, deltaTime * 60);

      this.currentPosition.lerp(idealPos, posFactor);
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
