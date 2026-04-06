/**
 * Whistler Blackcomb Ski Simulator
 * Main entry point - scene setup, game loop, and system integration.
 */

import * as THREE from 'three';
import {
  generateProceduralHeightmap,
  createTerrainMesh,
  getHeightAt,
  getElevationAt,
  getElevationFromColor,
  TERRAIN_CONFIG,
  generateHeightmapFromImage,
  imageToWorld,
  normalizedToWorld,
} from './terrain.js';
import { createSnowMaterial, createSnowParticles, updateSnowParticles, createSprayParticles, updateSprayParticles } from './snow.js';
import { generateLiftSystem, updateLifts, findNearestLiftBottom, LIFT_DEFS } from './lifts.js';
import { generateTrees } from './trees.js';
import { isOnRun, createRunVisuals } from './runs.js';
import { Player } from './player.js';
import { FollowCamera } from './camera.js';

// -- Globals --
let scene, camera, renderer;
let heightmap, resolution;
let player, followCam;
let lifts = [];
let snowParticles, sprayParticles;
let clock;
let gameTime = 0;

// Input state
const input = { left: false, right: false, brake: false, skate: false };
let nearbyLift = null; // Track lift bottom station proximity

// -- Loading progress --
function setLoadProgress(percent, message) {
  const bar = document.getElementById('load-bar');
  const status = document.getElementById('load-status');
  if (bar) bar.style.width = percent + '%';
  if (status) status.textContent = message;
}

// -- Minimap --
function drawMinimap(playerX, playerZ, playerHeading) {
  const canvas = document.getElementById('minimap-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  // Draw terrain elevation as background
  const halfWorld = TERRAIN_CONFIG.worldWidth / 2;
  const scale = w / 200; // 200m radius view

  // Background
  ctx.fillStyle = 'rgba(200, 210, 230, 0.6)';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
  ctx.fill();

  // Simple terrain color based on elevation
  const step = 10;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const worldX = playerX + (x - w / 2) / scale;
      const worldZ = playerZ + (y - h / 2) / scale;
      const elev = getHeightAt(worldX, worldZ, heightmap, resolution);
      const run = isOnRun(worldX, worldZ);

      if (run) {
        ctx.fillStyle = 'rgba(220, 230, 255, 0.8)';
      } else {
        const brightness = Math.floor(80 + (elev / 1800) * 100);
        ctx.fillStyle = `rgb(${brightness - 20}, ${brightness + 10}, ${brightness - 10})`;
      }
      ctx.fillRect(x, y, step, step);
    }
  }

  // Clip to circle
  ctx.globalCompositeOperation = 'destination-in';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  // Player indicator
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-playerHeading + Math.PI);

  ctx.fillStyle = '#ff3344';
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(-4, 4);
  ctx.lineTo(4, 4);
  ctx.closePath();
  ctx.fill();

  ctx.restore();

  // Border
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w / 2 - 1, 0, Math.PI * 2);
  ctx.stroke();
}

// -- Terrain Map (expanded minimap) --
let terrainMapDrawn = false;
let liftTopPositions = []; // { name, worldX, worldZ, canvasX, canvasY }

function drawTerrainMap() {
  const canvas = document.getElementById('terrain-map-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const halfWorld = TERRAIN_CONFIG.worldWidth / 2;

  ctx.clearRect(0, 0, w, h);

  // Draw terrain elevation
  const step = 4;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const worldX = (x / w - 0.5) * TERRAIN_CONFIG.worldWidth;
      const worldZ = (y / h - 0.5) * TERRAIN_CONFIG.worldDepth;
      const elev = getHeightAt(worldX, worldZ, heightmap, resolution);
      const run = isOnRun(worldX, worldZ);

      if (run) {
        const b = Math.floor(140 + (elev / 1800) * 80);
        ctx.fillStyle = `rgb(${b - 10}, ${b + 10}, ${b + 40})`;
      } else {
        const b = Math.floor(60 + (elev / 1800) * 130);
        ctx.fillStyle = `rgb(${b - 15}, ${b + 15}, ${b - 5})`;
      }
      ctx.fillRect(x, y, step, step);
    }
  }

  // Draw lift lines
  liftTopPositions = [];
  for (const def of LIFT_DEFS) {
    ctx.strokeStyle = 'rgba(220, 50, 50, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < def.points.length; i++) {
      const cx = def.points[i][0] * w;
      const cy = def.points[i][1] * h;
      if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
    }
    ctx.stroke();

    // Mark top station (last point) with a clickable circle
    const topPt = def.points[def.points.length - 1];
    const topCx = topPt[0] * w;
    const topCy = topPt[1] * h;
    const { x: topWorldX, z: topWorldZ } = normalizedToWorld(topPt[0], topPt[1]);

    liftTopPositions.push({
      name: def.name,
      worldX: topWorldX,
      worldZ: topWorldZ,
      canvasX: topCx,
      canvasY: topCy,
    });

    // Draw top station marker
    ctx.fillStyle = 'rgba(255, 80, 80, 0.9)';
    ctx.beginPath();
    ctx.arc(topCx, topCy, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Draw bottom station marker (smaller)
    const botPt = def.points[0];
    ctx.fillStyle = 'rgba(200, 200, 200, 0.6)';
    ctx.beginPath();
    ctx.arc(botPt[0] * w, botPt[1] * h, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw player position
  if (player) {
    const px = (player.position.x / TERRAIN_CONFIG.worldWidth + 0.5) * w;
    const pz = (player.position.z / TERRAIN_CONFIG.worldDepth + 0.5) * h;
    ctx.fillStyle = '#00ff66';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, pz, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  terrainMapDrawn = true;
}

function setupTerrainMap() {
  const minimap = document.getElementById('minimap');
  const overlay = document.getElementById('terrain-map-overlay');
  const closeBtn = document.getElementById('terrain-map-close');
  const mapCanvas = document.getElementById('terrain-map-canvas');
  const tooltip = document.getElementById('terrain-map-tooltip');

  if (!minimap || !overlay) return;

  minimap.addEventListener('click', () => {
    drawTerrainMap();
    overlay.classList.add('open');
  });

  closeBtn.addEventListener('click', () => {
    overlay.classList.remove('open');
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('open');
  });

  // Hover tooltip for lift stations
  mapCanvas.addEventListener('mousemove', (e) => {
    const rect = mapCanvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (mapCanvas.width / rect.width);
    const my = (e.clientY - rect.top) * (mapCanvas.height / rect.height);

    let hoveredLift = null;
    for (const ltp of liftTopPositions) {
      const dx = mx - ltp.canvasX;
      const dy = my - ltp.canvasY;
      if (dx * dx + dy * dy < 12 * 12) {
        hoveredLift = ltp;
        break;
      }
    }

    if (hoveredLift) {
      tooltip.style.display = 'block';
      tooltip.textContent = `${hoveredLift.name} (click to travel)`;
      tooltip.style.left = (e.clientX - overlay.getBoundingClientRect().left + 12) + 'px';
      tooltip.style.top = (e.clientY - overlay.getBoundingClientRect().top - 30) + 'px';
      mapCanvas.style.cursor = 'pointer';
    } else {
      tooltip.style.display = 'none';
      mapCanvas.style.cursor = 'crosshair';
    }
  });

  // Click to fast travel to lift top
  mapCanvas.addEventListener('click', (e) => {
    const rect = mapCanvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (mapCanvas.width / rect.width);
    const my = (e.clientY - rect.top) * (mapCanvas.height / rect.height);

    for (const ltp of liftTopPositions) {
      const dx = mx - ltp.canvasX;
      const dy = my - ltp.canvasY;
      if (dx * dx + dy * dy < 12 * 12) {
        // Teleport player to the top of this lift
        const y = getHeightAt(ltp.worldX, ltp.worldZ, heightmap, resolution);
        player.position.set(ltp.worldX, y, ltp.worldZ);
        player.velocity.set(0, 0, 0);
        player.speed = 0;
        followCam.reset(player.position, player.heading);
        overlay.classList.remove('open');
        break;
      }
    }
  });
}

// -- Scene setup --
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd0ddf0);

  // Fog for distance fade
  scene.fog = new THREE.Fog(0xd0ddf0, 2000, 9000);

  // Camera
  camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.5, 15000);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  document.body.appendChild(renderer.domElement);

  // -- Lighting --
  // Sun
  const sunLight = new THREE.DirectionalLight(0xfff5e0, 1.8);
  sunLight.position.set(1500, 2500, 1000);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 7500;
  sunLight.shadow.camera.left = -2000;
  sunLight.shadow.camera.right = 2000;
  sunLight.shadow.camera.top = 2000;
  sunLight.shadow.camera.bottom = -2000;
  sunLight.shadow.bias = -0.001;
  scene.add(sunLight);

  // Ambient (sky fill)
  const ambientLight = new THREE.AmbientLight(0x8eaacc, 0.6);
  scene.add(ambientLight);

  // Hemisphere light (sky/ground)
  const hemiLight = new THREE.HemisphereLight(0xaaccff, 0xd4c5a9, 0.4);
  scene.add(hemiLight);

  // -- Sky gradient (simple mesh behind everything) --
  const skyGeo = new THREE.SphereGeometry(12500, 16, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      uTopColor: { value: new THREE.Color(0x4488cc) },
      uBottomColor: { value: new THREE.Color(0xd0ddf0) },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uTopColor;
      uniform vec3 uBottomColor;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition).y;
        float t = max(0.0, h);
        gl_FragColor = vec4(mix(uBottomColor, uTopColor, t), 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);
}

// -- Main initialization --
async function init() {
  setLoadProgress(5, 'Initializing renderer...');
  initScene();

  setLoadProgress(15, 'Generating terrain heightmap...');
  resolution = TERRAIN_CONFIG.resolution;

  // Generate heightmap - try loading image first, fall back to procedural
  heightmap = generateProceduralHeightmap(resolution);

  setLoadProgress(35, 'Creating terrain mesh...');
  await nextFrame();

  // Create terrain
  const snowMat = createSnowMaterial();
  const terrainMesh = createTerrainMesh(heightmap, resolution, snowMat);
  scene.add(terrainMesh);

  setLoadProgress(45, 'Placing ski runs...');
  await nextFrame();

  // Run visuals (subtle markers)
  const runVisuals = createRunVisuals(heightmap, resolution);
  scene.add(runVisuals);

  setLoadProgress(55, 'Building chairlifts...');
  await nextFrame();

  // Lift system
  const liftSystem = generateLiftSystem(heightmap, resolution);
  scene.add(liftSystem.group);
  lifts = liftSystem.lifts;

  setLoadProgress(70, 'Growing trees...');
  await nextFrame();

  // Trees
  const trees = generateTrees(heightmap, resolution);
  scene.add(trees);

  setLoadProgress(85, 'Setting up player...');
  await nextFrame();

  // Player
  player = new Player(heightmap, resolution);
  scene.add(player.mesh);
  scene.add(player.trailGroup);

  // Camera
  followCam = new FollowCamera(camera, heightmap, resolution);
  followCam.reset(player.position, player.heading);

  // Snow particles
  snowParticles = createSnowParticles();
  scene.add(snowParticles);

  sprayParticles = createSprayParticles();
  scene.add(sprayParticles);

  setLoadProgress(95, 'Almost ready...');
  await nextFrame();

  // Update shadow camera to follow player
  const sunLight = scene.children.find(c => c instanceof THREE.DirectionalLight);
  if (sunLight) {
    sunLight.target = player.mesh;
    scene.add(sunLight.target);
  }

  // Input handlers
  setupInput();

  // Terrain map (expanded minimap)
  setupTerrainMap();

  // Resize handler
  window.addEventListener('resize', onResize);

  setLoadProgress(100, 'Ready!');
  await nextFrame();

  // Hide loading screen
  setTimeout(() => {
    const loading = document.getElementById('loading');
    if (loading) loading.style.display = 'none';
  }, 300);

  // Expose API
  exposeGameAPI();

  // Start game loop
  clock = new THREE.Clock();
  animate();
}

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(resolve));
}

// -- Input --
function setupInput() {
  window.addEventListener('keydown', (e) => {
    switch (e.code) {
      case 'ArrowLeft': input.left = true; break;
      case 'ArrowRight': case 'KeyD': input.right = true; break;
      case 'Space': input.skate = true; e.preventDefault(); break;
      case 'ArrowDown': case 'KeyA': input.brake = true; break;
      case 'KeyR': player.spawn(); followCam.reset(player.position, player.heading); break;
      case 'KeyE': {
        if (player.onLift) {
          // Skip to top of lift
          player.skipToLiftTop();
          followCam.reset(player.position, player.heading);
        } else if (nearbyLift) {
          // Board the nearby lift
          player.boardLift(nearbyLift.lift);
        }
        break;
      }
      case 'KeyM': {
        const overlay = document.getElementById('terrain-map-overlay');
        if (overlay && !overlay.classList.contains('open')) {
          drawTerrainMap();
          overlay.classList.add('open');
        }
        break;
      }
      case 'Escape': {
        const overlay = document.getElementById('terrain-map-overlay');
        if (overlay) overlay.classList.remove('open');
        break;
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    switch (e.code) {
      case 'ArrowLeft': input.left = false; break;
      case 'ArrowRight': case 'KeyD': input.right = false; break;
      case 'Space': input.skate = false; break;
      case 'ArrowDown': case 'KeyA': input.brake = false; break;
    }
  });

  // Touch controls for mobile
  let touchStartX = 0;
  window.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    const screenThird = window.innerWidth / 3;
    if (touchStartX < screenThird) {
      input.left = true;
    } else if (touchStartX > screenThird * 2) {
      input.right = true;
    } else {
      input.brake = true;
    }
  });

  window.addEventListener('touchend', () => {
    input.left = false;
    input.right = false;
    input.brake = false;
  });
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// -- HUD --
function updateHUD(stats) {
  const timerEl = document.getElementById('timer');
  const speedEl = document.getElementById('speed-display');
  const elevEl = document.getElementById('elev-display');

  if (timerEl) {
    const mins = Math.floor(gameTime / 60);
    const secs = Math.floor(gameTime % 60);
    const centis = Math.floor((gameTime % 1) * 100);
    timerEl.textContent = `${String(mins).padStart(2, '0')}'${String(secs).padStart(2, '0')}"${String(centis).padStart(2, '0')}`;
  }

  if (speedEl) {
    speedEl.textContent = `${Math.round(stats.speedKmh)} km/h`;
  }

  if (elevEl) {
    elevEl.textContent = `Elev: ${Math.round(stats.elevation)}m`;
  }

  // Lift prompt
  const liftPrompt = document.getElementById('lift-prompt');
  if (liftPrompt) {
    if (stats.onLift) {
      liftPrompt.textContent = `Riding ${stats.liftName} - Press E to skip to top`;
      liftPrompt.style.display = 'block';
    } else if (nearbyLift) {
      liftPrompt.textContent = `Press E to board ${nearbyLift.lift.name}`;
      liftPrompt.style.display = 'block';
    } else {
      liftPrompt.style.display = 'none';
    }
  }
}

// -- Game loop --
let minimapTimer = 0;

function animate() {
  requestAnimationFrame(animate);

  const deltaTime = clock.getDelta();
  gameTime += deltaTime;

  // Check lift proximity
  if (!player.onLift) {
    nearbyLift = findNearestLiftBottom(lifts, player.position, 30);
  } else {
    nearbyLift = null;
  }

  // Update player
  const stats = player.update(deltaTime, input, gameTime);

  // Update camera
  followCam.update(player.position, player.heading, player.speed, deltaTime);

  // Update lifts
  updateLifts(lifts, deltaTime);

  // Update snow particles
  updateSnowParticles(snowParticles, player.position, deltaTime);
  updateSprayParticles(sprayParticles, player.position, player.heading, player.speed, deltaTime);

  // Update shadow light to follow player
  const sunLight = scene.children.find(c => c instanceof THREE.DirectionalLight);
  if (sunLight) {
    sunLight.position.set(
      player.position.x + 300,
      player.position.y + 500,
      player.position.z + 200
    );
  }

  // Update snow material time
  const terrainMesh = scene.children.find(c => c instanceof THREE.Mesh && c.material.uniforms);
  if (terrainMesh && terrainMesh.material.uniforms.uTime) {
    terrainMesh.material.uniforms.uTime.value = gameTime;
  }

  // Update HUD
  updateHUD(stats);

  // Update minimap (less frequently)
  minimapTimer += deltaTime;
  if (minimapTimer > 0.2) {
    minimapTimer = 0;
    drawMinimap(player.position.x, player.position.z, player.heading);
  }

  // Render
  renderer.render(scene, camera);
}

// -- Exported core functions (for external use / console) --

// Make key functions available globally for testing/debugging
function exposeGameAPI() {
  window.gameAPI = {
    getElevationFromColor,
    generateHeightmapFromImage,
    imageToWorld,
    getHeightAt: (x, z) => getHeightAt(x, z, heightmap, resolution),
    isOnRun,
    getElevationAt: (x, z) => getElevationAt(x, z, heightmap, resolution),
    teleportPlayer: (x, z) => {
      const y = getHeightAt(x, z, heightmap, resolution);
      player.position.set(x, y, z);
      player.velocity.set(0, 0, 0);
      player.speed = 0;
      followCam.reset(player.position, player.heading);
    },
    resetPlayer: () => {
      player.spawn();
      followCam.reset(player.position, player.heading);
    },
  };
}

// Start
init().catch(err => {
  console.error('Failed to initialize:', err);
  setLoadProgress(0, 'Error: ' + err.message);
});
