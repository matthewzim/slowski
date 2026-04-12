/**
 * Jamboree Snow Resort - Ski Simulator
 * Main entry point - scene setup, game loop, minimap, village, and system integration.
 */

import * as THREE from 'three';
import {
  loadTerrainFromGLB,
  getHeightAt,
  getElevationAt,
  TERRAIN_CONFIG,
  normalizedToWorld,
  worldToNormalized,
  buildHeightmapFromGroup,
} from './terrain.js';
import { createSnowMaterial, createSnowParticles, updateSnowParticles, createSprayParticles, updateSprayParticles } from './snow.js';
import { isOnRun, createRunVisuals } from './runs.js';
import { Player } from './player.js';
import { FollowCamera } from './camera.js';
import { loadFromDat } from './dat/loader.js';
import { scaleToWorld } from './dat/converter.js';

// -- Globals --
let scene, camera, renderer;
let heightmap, resolution;
let player, followCam;
let snowParticles, sprayParticles;
let snowMat;
let clock;
let gameTime = 0;
let pendingDatFile = null; // ArrayBuffer from user upload

const input = { left: false, right: false, brake: false, skate: false };

// -- Loading progress --
function setLoadProgress(percent, message) {
  const bar = document.getElementById('load-bar');
  const status = document.getElementById('load-status');
  if (bar) bar.style.width = percent + '%';
  if (status) status.textContent = message;
}

// ============================================================
// MINIMAP - Blackcomb Mountain map
// ============================================================

// -- Minimap background image (Blackcomb Mountain map) --
let minimapImage = null;
let minimapImageLoaded = false;

function loadMinimapImage() {
  const img = new Image();
  img.onload = () => {
    minimapImage = img;
    minimapImageLoaded = true;
  };
  img.onerror = () => {
    console.warn('Could not load minimap image (blackcomb-map.png), using terrain fallback');
    minimapImageLoaded = false;
  };
  img.src = 'blackcomb-map.png';
}

/**
 * Draw the minimap with the Blackcomb Mountain map as background.
 * Falls back to terrain-based rendering if image not available.
 */
function drawMinimapSilhouette(playerX, playerZ) {
  const canvas = document.getElementById('minimap-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  if (minimapImageLoaded && minimapImage) {
    // Draw the map image as background
    ctx.drawImage(minimapImage, 0, 0, w, h);
  } else {
    // Fallback: draw terrain-based minimap
    drawMinimapTerrain(ctx, w, h);
  }

  // Draw player position
  if (player) {
    const { nx, ny } = worldToNormalized(playerX, playerZ);
    const dotX = nx * w;
    const dotY = ny * h;

    ctx.fillStyle = '#ff3344';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Subtle border
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, w, h);
}

/**
 * Fallback terrain-based minimap rendering (Google Maps terrain style).
 */
function drawMinimapTerrain(ctx, w, h) {
  // Dark background
  ctx.fillStyle = 'rgba(20, 25, 40, 0.85)';
  ctx.fillRect(0, 0, w, h);

  if (!heightmap) return;

  // Draw terrain with Google Maps-like colors
  const step = 4;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const nx = x / w;
      const ny = y / h;
      const worldX = (nx - 0.5) * TERRAIN_CONFIG.worldWidth;
      const worldZ = (ny - 0.5) * TERRAIN_CONFIG.worldDepth;
      const elev = getHeightAt(worldX, worldZ, heightmap, resolution);

      if (elev <= 1) continue; // Skip flat/empty areas

      // Google Maps terrain color scheme
      const t = Math.min(elev / 1800, 1.0);
      let r, g, b;
      if (t < 0.3) {
        // Low elevation: green
        r = Math.floor(120 + t * 80);
        g = Math.floor(160 + t * 60);
        b = Math.floor(90 + t * 40);
      } else if (t < 0.6) {
        // Mid elevation: tan/beige
        const mt = (t - 0.3) / 0.3;
        r = Math.floor(160 + mt * 60);
        g = Math.floor(175 + mt * 40);
        b = Math.floor(120 + mt * 40);
      } else {
        // High elevation: light gray/white (snow)
        const ht = (t - 0.6) / 0.4;
        r = Math.floor(210 + ht * 40);
        g = Math.floor(215 + ht * 35);
        b = Math.floor(200 + ht * 45);
      }

      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(x, y, step, step);
    }
  }
}

// -- Expanded Trail Map --

function drawTerrainMap() {
  const canvas = document.getElementById('terrain-map-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

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

  // Instruction text
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('Click anywhere to travel', w / 2, h - 8);
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

  // Show elevation tooltip on hover
  mapCanvas.addEventListener('mousemove', (e) => {
    const rect = mapCanvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (mapCanvas.width / rect.width);
    const my = (e.clientY - rect.top) * (mapCanvas.height / rect.height);

    const worldX = (mx / mapCanvas.width - 0.5) * TERRAIN_CONFIG.worldWidth;
    const worldZ = (my / mapCanvas.height - 0.5) * TERRAIN_CONFIG.worldDepth;
    const elev = getHeightAt(worldX, worldZ, heightmap, resolution) + TERRAIN_CONFIG.baseElevation;

    if (elev > TERRAIN_CONFIG.baseElevation + 5) {
      tooltip.style.display = 'block';
      tooltip.textContent = `Elev: ${Math.round(elev)}m (click to travel)`;
      tooltip.style.left = (e.clientX - overlay.getBoundingClientRect().left + 12) + 'px';
      tooltip.style.top = (e.clientY - overlay.getBoundingClientRect().top - 30) + 'px';
      mapCanvas.style.cursor = 'pointer';
    } else {
      tooltip.style.display = 'none';
      mapCanvas.style.cursor = 'default';
    }
  });

  // Click anywhere on the map to fast travel
  mapCanvas.addEventListener('click', (e) => {
    const rect = mapCanvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (mapCanvas.width / rect.width);
    const my = (e.clientY - rect.top) * (mapCanvas.height / rect.height);

    const worldX = (mx / mapCanvas.width - 0.5) * TERRAIN_CONFIG.worldWidth;
    const worldZ = (my / mapCanvas.height - 0.5) * TERRAIN_CONFIG.worldDepth;
    const y = getHeightAt(worldX, worldZ, heightmap, resolution);

    // Only teleport if there's actual terrain at this position
    if (y > 1) {
      player.position.set(worldX, y, worldZ);
      player.velocity.set(0, 0, 0);
      player.speed = 0;
      followCam.reset(player.position, player.heading);
      overlay.classList.remove('open');
    }
  });
}

// ============================================================
// BASE VILLAGE
// ============================================================

function createBaseVillage(heightmap, resolution) {
  const group = new THREE.Group();
  group.name = 'BaseVillage';

  const { x: villageX, z: villageZ } = normalizedToWorld(0.10, 0.10);
  const villageY = getHeightAt(villageX, villageZ, heightmap, resolution);

  // Main lodge
  const lodgeGeo = new THREE.BoxGeometry(80, 30, 50);
  const lodgeMat = new THREE.MeshStandardMaterial({ color: 0x8B6914, roughness: 0.8 });
  const lodge = new THREE.Mesh(lodgeGeo, lodgeMat);
  lodge.position.set(villageX, villageY + 15, villageZ);
  lodge.castShadow = true;
  lodge.receiveShadow = true;
  group.add(lodge);

  // Lodge roof (A-frame)
  const roofGeo = new THREE.ConeGeometry(55, 20, 4);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x8B2500, roughness: 0.7 });
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.set(villageX, villageY + 40, villageZ);
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  group.add(roof);

  // Smaller buildings around the lodge
  const buildingDefs = [
    { dx: -120, dz: 30, w: 40, h: 20, d: 30, color: 0x9B7653 },
    { dx: 100, dz: -20, w: 35, h: 18, d: 25, color: 0x8B7355 },
    { dx: -80, dz: -60, w: 30, h: 15, d: 25, color: 0xA0856C },
    { dx: 60, dz: 50, w: 45, h: 22, d: 30, color: 0x8B6914 },
    { dx: 150, dz: 40, w: 30, h: 16, d: 20, color: 0x9B8B6C },
    { dx: -160, dz: -20, w: 25, h: 14, d: 20, color: 0x8B7355 },
  ];

  for (const bd of buildingDefs) {
    const bx = villageX + bd.dx;
    const bz = villageZ + bd.dz;
    const by = getHeightAt(bx, bz, heightmap, resolution);

    const bGeo = new THREE.BoxGeometry(bd.w, bd.h, bd.d);
    const bMat = new THREE.MeshStandardMaterial({ color: bd.color, roughness: 0.8 });
    const building = new THREE.Mesh(bGeo, bMat);
    building.position.set(bx, by + bd.h / 2, bz);
    building.castShadow = true;
    building.receiveShadow = true;
    group.add(building);

    // Small roof
    const rGeo = new THREE.ConeGeometry(Math.max(bd.w, bd.d) * 0.6, bd.h * 0.5, 4);
    const rMat = new THREE.MeshStandardMaterial({ color: 0x6B3A2A, roughness: 0.7 });
    const r = new THREE.Mesh(rGeo, rMat);
    r.position.set(bx, by + bd.h + bd.h * 0.25, bz);
    r.rotation.y = Math.PI / 4;
    r.castShadow = true;
    group.add(r);
  }

  return group;
}

// ============================================================
// CLIFF / ROCK FEATURES
// ============================================================

function createCliffFeatures(heightmap, resolution) {
  const group = new THREE.Group();
  group.name = 'Cliffs';

  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x666677,
    roughness: 0.95,
    metalness: 0.1,
  });

  // Place rock outcrops at steep areas on upper mountain
  const cliffLocations = [
    // Upper mountain cliffs
    { nx: 0.56, ny: 0.82, scale: 1.2 },
    { nx: 0.58, ny: 0.78, scale: 0.8 },
    { nx: 0.35, ny: 0.85, scale: 1.0 },
    // Right side cliffs near lift 4
    { nx: 0.66, ny: 0.72, scale: 0.9 },
    { nx: 0.68, ny: 0.68, scale: 0.7 },
    // Left ridge rocks
    { nx: 0.25, ny: 0.75, scale: 0.8 },
    // Summit rocks
    { nx: 0.45, ny: 0.90, scale: 1.1 },
    { nx: 0.50, ny: 0.87, scale: 0.9 },
  ];

  for (const cliff of cliffLocations) {
    const { x, z } = normalizedToWorld(cliff.nx, cliff.ny);
    const y = getHeightAt(x, z, heightmap, resolution);

    // Irregular rock formation from multiple boxes
    const s = cliff.scale * 25;
    for (let i = 0; i < 3; i++) {
      const rw = (10 + Math.random() * 20) * s / 25;
      const rh = (15 + Math.random() * 30) * s / 25;
      const rd = (8 + Math.random() * 15) * s / 25;
      const geo = new THREE.BoxGeometry(rw, rh, rd);
      const rock = new THREE.Mesh(geo, rockMat);
      rock.position.set(
        x + (Math.random() - 0.5) * s * 1.5,
        y + rh / 2 - 5,
        z + (Math.random() - 0.5) * s * 1.5
      );
      rock.rotation.set(
        (Math.random() - 0.5) * 0.3,
        Math.random() * Math.PI,
        (Math.random() - 0.5) * 0.2
      );
      rock.castShadow = true;
      rock.receiveShadow = true;
      group.add(rock);
    }
  }

  return group;
}

// -- Scene setup --
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd0ddf0);
  scene.fog = new THREE.Fog(0xd0ddf0, 2000, 9000);

  camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.5, 15000);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  document.body.appendChild(renderer.domElement);

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

  // Ambient
  const ambientLight = new THREE.AmbientLight(0x8eaacc, 0.6);
  scene.add(ambientLight);

  // Hemisphere
  const hemiLight = new THREE.HemisphereLight(0xaaccff, 0xd4c5a9, 0.4);
  scene.add(hemiLight);

  // Sky gradient
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
  loadMinimapImage();
  initScene();

  setLoadProgress(10, 'Loading terrain model...');
  snowMat = createSnowMaterial();

  let terrainMesh;
  if (pendingDatFile) {
    // Load terrain from uploaded .dat file
    const datResult = await loadFromDat(pendingDatFile, setLoadProgress, snowMat);
    const terrainGroup = datResult.terrainGroup;

    // Scale to world dimensions
    scaleToWorld(terrainGroup, TERRAIN_CONFIG);

    // Keep original materials; just enable shadows
    terrainGroup.traverse((child) => {
      if (child.isMesh) {
        child.receiveShadow = true;
        child.castShadow = true;
      }
    });

    setLoadProgress(78, 'Building heightmap from extracted terrain...');
    heightmap = await buildHeightmapFromGroup(terrainGroup, TERRAIN_CONFIG.resolution, setLoadProgress);
    resolution = TERRAIN_CONFIG.resolution;
    terrainMesh = terrainGroup;
    pendingDatFile = null; // free memory
  } else {
    // Default: load WeTest.glb terrain
    const terrainResult = await loadTerrainFromGLB(snowMat, setLoadProgress);
    heightmap = terrainResult.heightmap;
    resolution = terrainResult.resolution;
    terrainMesh = terrainResult.mesh;
  }
  scene.add(terrainMesh);

  setLoadProgress(82, 'Placing ski runs...');
  await nextFrame();

  const runVisuals = createRunVisuals(heightmap, resolution);
  scene.add(runVisuals);

  setLoadProgress(88, 'Building base village...');
  await nextFrame();

  const village = createBaseVillage(heightmap, resolution);
  scene.add(village);

  setLoadProgress(90, 'Adding cliff features...');
  await nextFrame();

  const cliffs = createCliffFeatures(heightmap, resolution);
  scene.add(cliffs);

  setLoadProgress(92, 'Setting up player...');
  await nextFrame();

  player = new Player(heightmap, resolution);
  scene.add(player.mesh);
  scene.add(player.trailGroup);

  followCam = new FollowCamera(camera, heightmap, resolution);
  followCam.reset(player.position, player.heading);

  snowParticles = createSnowParticles();
  scene.add(snowParticles);

  sprayParticles = createSprayParticles();
  scene.add(sprayParticles);

  setLoadProgress(95, 'Almost ready...');
  await nextFrame();

  const sunLight = scene.children.find(c => c instanceof THREE.DirectionalLight);
  if (sunLight) {
    sunLight.target = player.mesh;
    scene.add(sunLight.target);
  }

  setupInput();
  setupTerrainMap();

  window.addEventListener('resize', onResize);

  setLoadProgress(100, 'Ready!');
  await nextFrame();

  setTimeout(() => {
    const loading = document.getElementById('loading');
    if (loading) loading.style.display = 'none';
  }, 300);

  exposeGameAPI();

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
      case 'ArrowLeft': case 'KeyA': input.left = true; break;
      case 'ArrowRight': case 'KeyD': input.right = true; break;
      case 'Space': input.skate = true; e.preventDefault(); break;
      case 'ArrowDown': case 'KeyS': input.brake = true; break;
      case 'KeyR': player.spawn(); followCam.reset(player.position, player.heading); break;
      case 'KeyE': {
        // No chairlifts - use the map (M) to travel around the mountain
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
      case 'ArrowLeft': case 'KeyA': input.left = false; break;
      case 'ArrowRight': case 'KeyD': input.right = false; break;
      case 'Space': input.skate = false; break;
      case 'ArrowDown': case 'KeyS': input.brake = false; break;
    }
  });

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

  const liftPrompt = document.getElementById('lift-prompt');
  if (liftPrompt) {
    liftPrompt.style.display = 'none';
  }
}

// -- Game loop --
let minimapTimer = 0;

function animate() {
  requestAnimationFrame(animate);

  const deltaTime = clock.getDelta();
  gameTime += deltaTime;

  const stats = player.update(deltaTime, input, gameTime);

  followCam.update(player.position, player.heading, player.speed, deltaTime);

  updateSnowParticles(snowParticles, player.position, deltaTime);
  updateSprayParticles(sprayParticles, player.position, player.heading, player.speed, deltaTime);

  const sunLight = scene.children.find(c => c instanceof THREE.DirectionalLight);
  if (sunLight) {
    sunLight.position.set(
      player.position.x + 300,
      player.position.y + 500,
      player.position.z + 200
    );
  }

  // Update snow material time uniform on all terrain meshes
  if (snowMat && snowMat.uniforms && snowMat.uniforms.uTime) {
    snowMat.uniforms.uTime.value = gameTime;
  }

  updateHUD(stats);

  // Update minimap silhouette
  minimapTimer += deltaTime;
  if (minimapTimer > 0.2) {
    minimapTimer = 0;
    drawMinimapSilhouette(player.position.x, player.position.z);
  }

  renderer.render(scene, camera);
}

// -- Exported API --
function exposeGameAPI() {
  window.gameAPI = {
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

// -- .dat file auto-loading --
// Attempts to fetch ski.dat from the repo directory. If found, loads terrain
// from the extracted Wii game data. If not found (404), falls back to the
// default Whistler Blackcomb GLB terrain.
async function tryLoadDatFile() {
  setLoadProgress(2, 'Checking for ski.dat...');
  try {
    const response = await fetch('ski.dat');
    if (!response.ok) {
      // No ski.dat found — use default terrain
      console.log('No ski.dat found, using default terrain.');
      init().catch(handleInitError);
      return;
    }
    setLoadProgress(3, 'Reading ski.dat...');
    pendingDatFile = await response.arrayBuffer();
    console.log(`Loaded ski.dat (${(pendingDatFile.byteLength / 1024 / 1024).toFixed(1)} MB)`);
    init().catch(handleInitError);
  } catch (e) {
    // Network error or CORS issue — fall back to default
    console.log('Could not fetch ski.dat, using default terrain:', e.message);
    init().catch(handleInitError);
  }
}

function handleInitError(err) {
  console.error('Failed to initialize:', err);
  setLoadProgress(0, 'Error: ' + err.message);
}

// Start
tryLoadDatFile();
