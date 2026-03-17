// ============================================================================
// SLOWSKI — Infinite Downhill Skiing Simulation
// Built with Three.js + Vanilla JS
// ============================================================================

// ---------------------------------------------------------------------------
// 1. NOISE IMPLEMENTATION (self-contained simplex noise)
// ---------------------------------------------------------------------------

/**
 * Simplex 2D noise implementation.
 * Based on Stefan Gustavson's work. Provides smooth, continuous noise values.
 */
const SimplexNoise2D = (() => {
    const GRAD2 = [
        [1, 1], [-1, 1], [1, -1], [-1, -1],
        [1, 0], [-1, 0], [0, 1], [0, -1]
    ];

    class Simplex {
        constructor(seed = Math.random()) {
            this.perm = new Uint8Array(512);
            this.permMod8 = new Uint8Array(512);
            const p = new Uint8Array(256);
            for (let i = 0; i < 256; i++) p[i] = i;

            // Fisher-Yates shuffle with seed
            let s = seed * 2147483647;
            for (let i = 255; i > 0; i--) {
                s = (s * 16807) % 2147483647;
                const j = s % (i + 1);
                [p[i], p[j]] = [p[j], p[i]];
            }
            for (let i = 0; i < 512; i++) {
                this.perm[i] = p[i & 255];
                this.permMod8[i] = this.perm[i] % 8;
            }
        }

        noise2D(x, y) {
            const F2 = 0.5 * (Math.sqrt(3) - 1);
            const G2 = (3 - Math.sqrt(3)) / 6;

            const s = (x + y) * F2;
            const i = Math.floor(x + s);
            const j = Math.floor(y + s);
            const t = (i + j) * G2;
            const X0 = i - t;
            const Y0 = j - t;
            const x0 = x - X0;
            const y0 = y - Y0;

            let i1, j1;
            if (x0 > y0) { i1 = 1; j1 = 0; }
            else { i1 = 0; j1 = 1; }

            const x1 = x0 - i1 + G2;
            const y1 = y0 - j1 + G2;
            const x2 = x0 - 1.0 + 2.0 * G2;
            const y2 = y0 - 1.0 + 2.0 * G2;

            const ii = i & 255;
            const jj = j & 255;

            let n0 = 0, n1 = 0, n2 = 0;

            let t0 = 0.5 - x0 * x0 - y0 * y0;
            if (t0 >= 0) {
                t0 *= t0;
                const g = GRAD2[this.permMod8[ii + this.perm[jj]]];
                n0 = t0 * t0 * (g[0] * x0 + g[1] * y0);
            }

            let t1 = 0.5 - x1 * x1 - y1 * y1;
            if (t1 >= 0) {
                t1 *= t1;
                const g = GRAD2[this.permMod8[ii + i1 + this.perm[jj + j1]]];
                n1 = t1 * t1 * (g[0] * x1 + g[1] * y1);
            }

            let t2 = 0.5 - x2 * x2 - y2 * y2;
            if (t2 >= 0) {
                t2 *= t2;
                const g = GRAD2[this.permMod8[ii + 1 + this.perm[jj + 1]]];
                n2 = t2 * t2 * (g[0] * x2 + g[1] * y2);
            }

            return 70.0 * (n0 + n1 + n2);
        }
    }

    return Simplex;
})();

// ---------------------------------------------------------------------------
// 2. CONSTANTS & CONFIGURATION
// ---------------------------------------------------------------------------

const CONFIG = {
    // Terrain — steeper slope, reduced noise so it's always downhill
    chunkSize: 60,
    chunkSegments: 90,
    slope: 0.35,
    noiseScale: 0.012,
    noiseAmplitude: 3.0,
    detailNoiseScale: 0.06,
    detailNoiseAmplitude: 0.8,
    microNoiseScale: 0.25,
    microNoiseAmplitude: 0.15,
    chunksAhead: 4,
    chunksBehind: 1,
    chunksLeft: 2,
    chunksRight: 2,

    // Player
    initialSpeed: 20,
    maxSpeed: 60,
    acceleration: 1.0,
    turnSpeed: 2.2,
    turnDamping: 0.92,
    steerReturnSpeed: 4.0,
    jumpImpulse: 8,
    gravity: 22,

    // Camera
    cameraOffset: new THREE.Vector3(0, 8, 14),
    cameraLookAhead: 8,
    cameraLerpSpeed: 3.5,
    cameraTiltAmount: 0.04,
    cameraShakeIntensity: 0.12,

    // Trees
    treesPerChunk: 18,
    treeMinDistance: 4,
    treeClearRadius: 5,

    // Snow particles
    snowParticleCount: 1500,
    snowAreaSize: 90,
    snowFallSpeed: 8,

    // Visuals
    fogNear: 30,
    fogFar: 200,
    skyColor: 0xc8dff5,
    fogColor: 0xd6e8f5,
    snowColor: 0xf0f4f8,
    sunDirection: new THREE.Vector3(0.5, 0.8, -0.3).normalize(),
};

// ---------------------------------------------------------------------------
// 2b. TIME-OF-DAY PRESETS
// ---------------------------------------------------------------------------

const TIME_PRESETS = {
    morning: {
        skyColor: 0xc8dff5,
        fogColor: 0xd6e8f5,
        sunColor: 0xfff5e0,
        sunIntensity: 1.0,
        ambientSkyColor: 0xc8dff5,
        ambientGroundColor: 0x8fa4b8,
        ambientIntensity: 0.6,
        sunDirection: new THREE.Vector3(0.5, 0.8, -0.3).normalize(),
        exposure: 1.1,
    },
    midday: {
        skyColor: 0x87ceeb,
        fogColor: 0xa8d8ea,
        sunColor: 0xffffff,
        sunIntensity: 1.3,
        ambientSkyColor: 0x9dd5f0,
        ambientGroundColor: 0xa0b8c8,
        ambientIntensity: 0.75,
        sunDirection: new THREE.Vector3(0.1, 1.0, -0.1).normalize(),
        exposure: 1.2,
    },
    sunset: {
        skyColor: 0x2d1b4e,
        fogColor: 0x4a2545,
        sunColor: 0xff6030,
        sunIntensity: 0.8,
        ambientSkyColor: 0x4a3060,
        ambientGroundColor: 0x3a2040,
        ambientIntensity: 0.4,
        sunDirection: new THREE.Vector3(-0.8, 0.15, -0.3).normalize(),
        exposure: 0.85,
    },
};

let currentTimePreset = 'morning';
let timeTransition = { active: false, from: {}, to: {}, progress: 0 };

function lerpColor(a, b, t) {
    const ca = new THREE.Color(a);
    const cb = new THREE.Color(b);
    return ca.lerp(cb, t);
}

function applyTimePreset(presetName, animate) {
    const preset = TIME_PRESETS[presetName];
    if (!preset) return;
    currentTimePreset = presetName;

    if (!scene) return;

    if (animate) {
        // Capture current values for smooth transition
        const sun = findSunLight();
        const ambient = findAmbientLight();
        timeTransition = {
            active: true,
            from: {
                skyColor: scene.background.clone(),
                fogColor: scene.fog.color.clone(),
                sunColor: sun ? sun.color.clone() : new THREE.Color(0xffffff),
                sunIntensity: sun ? sun.intensity : 1.0,
                ambientSkyColor: ambient ? ambient.color.clone() : new THREE.Color(0xffffff),
                ambientGroundColor: ambient ? ambient.groundColor.clone() : new THREE.Color(0x888888),
                ambientIntensity: ambient ? ambient.intensity : 0.6,
                sunDirection: sun ? sun.position.clone().normalize() : new THREE.Vector3(0, 1, 0),
                exposure: renderer.toneMappingExposure,
            },
            to: preset,
            progress: 0,
        };
    } else {
        applyPresetImmediate(preset);
    }
}

function applyPresetImmediate(preset) {
    scene.background = new THREE.Color(preset.skyColor);
    scene.fog.color.set(preset.fogColor);
    renderer.toneMappingExposure = preset.exposure;

    scene.traverse((obj) => {
        if (obj.isDirectionalLight && obj.userData.isSun) {
            obj.color.set(preset.sunColor);
            obj.intensity = preset.sunIntensity;
        }
        if (obj.isHemisphereLight) {
            obj.color.set(preset.ambientSkyColor);
            obj.groundColor.set(preset.ambientGroundColor);
            obj.intensity = preset.ambientIntensity;
        }
    });

    CONFIG.sunDirection.copy(preset.sunDirection);
}

function findSunLight() {
    let sun = null;
    scene.traverse((obj) => {
        if (obj.isDirectionalLight && obj.userData.isSun) sun = obj;
    });
    return sun;
}

function findAmbientLight() {
    let ambient = null;
    scene.traverse((obj) => {
        if (obj.isHemisphereLight) ambient = obj;
    });
    return ambient;
}

function updateTimeTransition(dt) {
    if (!timeTransition.active) return;

    timeTransition.progress += dt * 1.5; // ~0.67s transition
    const t = Math.min(timeTransition.progress, 1);
    const ease = t * t * (3 - 2 * t); // smoothstep

    const from = timeTransition.from;
    const to = timeTransition.to;

    scene.background.copy(lerpColor(from.skyColor, to.skyColor, ease));
    scene.fog.color.copy(lerpColor(from.fogColor, to.fogColor, ease));
    renderer.toneMappingExposure = from.exposure + (to.exposure - from.exposure) * ease;

    const sun = findSunLight();
    if (sun) {
        sun.color.copy(lerpColor(from.sunColor, to.sunColor, ease));
        sun.intensity = from.sunIntensity + (to.sunIntensity - from.sunIntensity) * ease;
    }

    const ambient = findAmbientLight();
    if (ambient) {
        ambient.color.copy(lerpColor(from.ambientSkyColor, to.ambientSkyColor, ease));
        ambient.groundColor.copy(lerpColor(from.ambientGroundColor, to.ambientGroundColor, ease));
        ambient.intensity = from.ambientIntensity + (to.ambientIntensity - from.ambientIntensity) * ease;
    }

    CONFIG.sunDirection.copy(from.sunDirection).lerp(to.sunDirection, ease).normalize();

    if (t >= 1) {
        timeTransition.active = false;
    }
}

// ---------------------------------------------------------------------------
// 3. GLOBAL STATE
// ---------------------------------------------------------------------------

let scene, camera, renderer;
let clock;
let noise;
let player;
let chunks = new Map();
let treePool = [];
let snowParticles;
let gameStarted = false;

const input = {
    left: false,
    right: false,
    jump: false,
};

const playerState = {
    position: new THREE.Vector3(0, 5, 0),
    velocity: new THREE.Vector3(0, 0, -CONFIG.initialSpeed),
    turnAngle: 0,
    verticalVelocity: 0,
    isGrounded: true,
    speed: CONFIG.initialSpeed,
    distanceTraveled: 0,
    currentSteer: 0,
};

const cameraState = {
    currentPosition: new THREE.Vector3(0, 13, 14),
    currentLookAt: new THREE.Vector3(0, 3, -8),
    shake: new THREE.Vector3(),
};

// ---------------------------------------------------------------------------
// 4. SCENE SETUP
// ---------------------------------------------------------------------------

function initScene() {
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(CONFIG.fogColor, CONFIG.fogNear, CONFIG.fogFar);
    scene.background = new THREE.Color(CONFIG.skyColor);

    // Camera
    camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.5, 300);
    camera.position.copy(cameraState.currentPosition);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    document.body.appendChild(renderer.domElement);

    // Lights
    const ambientLight = new THREE.HemisphereLight(0xc8dff5, 0x8fa4b8, 0.6);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfff5e0, 1.0);
    sunLight.position.copy(CONFIG.sunDirection).multiplyScalar(100);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 200;
    sunLight.shadow.camera.left = -60;
    sunLight.shadow.camera.right = 60;
    sunLight.shadow.camera.top = 60;
    sunLight.shadow.camera.bottom = -60;
    sunLight.shadow.bias = -0.001;
    scene.add(sunLight);

    // Keep the shadow camera following the player
    sunLight.userData.isSun = true;

    clock = new THREE.Clock();
    noise = new SimplexNoise2D(42);
}

// ---------------------------------------------------------------------------
// 5. TERRAIN SYSTEM
// ---------------------------------------------------------------------------

/**
 * Compute terrain height at world coordinates (x, z).
 * The terrain always slopes downhill in negative Z.
 * Multiple noise octaves add natural variation.
 */
function getTerrainHeight(x, z) {
    const base = -z * CONFIG.slope;
    const n1 = noise.noise2D(x * CONFIG.noiseScale, z * CONFIG.noiseScale) * CONFIG.noiseAmplitude;
    const n2 = noise.noise2D(x * CONFIG.detailNoiseScale, z * CONFIG.detailNoiseScale) * CONFIG.detailNoiseAmplitude;
    // Micro-detail noise for snow texture bumps
    const n3 = noise.noise2D(x * CONFIG.microNoiseScale, z * CONFIG.microNoiseScale) * CONFIG.microNoiseAmplitude;
    // Gentle lateral valley shape — higher at the edges
    const lateralDist = Math.abs(x) * 0.003;
    const valley = lateralDist * lateralDist * 2;

    const raw = base + n1 + n2 + n3 + valley;

    // Clamp so terrain never goes uphill — ensure the derivative along Z stays downhill.
    // We do this by ensuring noise never exceeds the base slope contribution.
    // The base drops by slope per unit Z. We allow noise to reduce the drop but never reverse it.
    // Effectively: cap total noise contribution so it doesn't exceed base slope locally.
    const maxUphillNoise = Math.abs(z) * CONFIG.slope * 0.4;
    const noiseContrib = n1 + n2 + n3;
    if (noiseContrib > maxUphillNoise) {
        return base + maxUphillNoise + valley;
    }
    return raw;
}

/**
 * Get terrain normal at a point (via central differences).
 */
function getTerrainNormal(x, z) {
    const eps = 0.5;
    const hL = getTerrainHeight(x - eps, z);
    const hR = getTerrainHeight(x + eps, z);
    const hU = getTerrainHeight(x, z - eps);
    const hD = getTerrainHeight(x, z + eps);
    const normal = new THREE.Vector3(hL - hR, 2 * eps, hU - hD);
    normal.normalize();
    return normal;
}

// Snow material with subtle vertex color variation — more textured
const snowMaterial = new THREE.MeshStandardMaterial({
    color: CONFIG.snowColor,
    roughness: 0.78,
    metalness: 0.05,
    flatShading: false,
    vertexColors: true,
});

/**
 * Create a single terrain chunk at grid position (cx, cz).
 * cx/cz are chunk indices; world offset = index * chunkSize.
 */
function createChunk(cx, cz) {
    const key = `${cx},${cz}`;
    if (chunks.has(key)) return;

    const size = CONFIG.chunkSize;
    const segs = CONFIG.chunkSegments;
    const geometry = new THREE.BufferGeometry();

    const vertCount = (segs + 1) * (segs + 1);
    const positions = new Float32Array(vertCount * 3);
    const colors = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);

    const offsetX = cx * size;
    const offsetZ = cz * size;

    // Fill vertex positions and colors
    for (let iz = 0; iz <= segs; iz++) {
        for (let ix = 0; ix <= segs; ix++) {
            const idx = (iz * (segs + 1) + ix) * 3;
            const wx = offsetX + (ix / segs) * size - size / 2;
            const wz = offsetZ + (iz / segs) * size - size / 2;
            const h = getTerrainHeight(wx, wz);

            positions[idx] = wx;
            positions[idx + 1] = h;
            positions[idx + 2] = wz;

            // Compute normal via central differences
            const n = getTerrainNormal(wx, wz);
            normals[idx] = n.x;
            normals[idx + 1] = n.y;
            normals[idx + 2] = n.z;

            // Rich snow color with multiple noise layers for texture
            const steepness = 1.0 - n.y;
            const colorNoise1 = noise.noise2D(wx * 0.05, wz * 0.05) * 0.03;
            const colorNoise2 = noise.noise2D(wx * 0.15, wz * 0.15) * 0.02;
            const colorNoise3 = noise.noise2D(wx * 0.6, wz * 0.6) * 0.015;
            // Sparkle effect — bright spots at fine frequency
            const sparkle = Math.max(0, noise.noise2D(wx * 2.0, wz * 2.0) - 0.6) * 0.15;
            const shade = 0.90 + colorNoise1 + colorNoise2 + colorNoise3 + sparkle - steepness * 0.2;
            // Bluer in shadows/steep areas, warmer on lit slopes
            const warmth = Math.max(0, n.y - 0.7) * 0.04;
            colors[idx] = shade * 0.93 + warmth;
            colors[idx + 1] = shade * 0.96;
            colors[idx + 2] = shade * 1.01;
        }
    }

    // Build index buffer
    const indexCount = segs * segs * 6;
    const indices = new Uint32Array(indexCount);
    let ii = 0;
    for (let iz = 0; iz < segs; iz++) {
        for (let ix = 0; ix < segs; ix++) {
            const a = iz * (segs + 1) + ix;
            const b = a + 1;
            const c = a + (segs + 1);
            const d = c + 1;
            indices[ii++] = a; indices[ii++] = c; indices[ii++] = b;
            indices[ii++] = b; indices[ii++] = c; indices[ii++] = d;
        }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    const mesh = new THREE.Mesh(geometry, snowMaterial);
    mesh.receiveShadow = true;
    scene.add(mesh);

    // Spawn trees for this chunk
    const trees = spawnTrees(cx, cz);

    chunks.set(key, { mesh, trees, cx, cz });
}

/**
 * Remove a chunk and dispose its resources.
 */
function removeChunk(key) {
    const chunk = chunks.get(key);
    if (!chunk) return;

    chunk.mesh.geometry.dispose();
    scene.remove(chunk.mesh);

    for (const tree of chunk.trees) {
        scene.remove(tree);
        // Return trunk and foliage geometries to pool if desired
    }

    chunks.delete(key);
}

/**
 * Update which chunks are loaded based on player position.
 */
function updateChunks() {
    const px = playerState.position.x;
    const pz = playerState.position.z;
    const size = CONFIG.chunkSize;

    // Current chunk the player is in
    const ccx = Math.round(px / size);
    const ccz = Math.round(pz / size);

    // Determine which chunks should exist
    const needed = new Set();
    for (let dz = -CONFIG.chunksBehind; dz <= CONFIG.chunksAhead; dz++) {
        for (let dx = -CONFIG.chunksLeft; dx <= CONFIG.chunksRight; dx++) {
            const key = `${ccx + dx},${ccz + dz}`;
            needed.add(key);
        }
    }

    // Remove chunks that are no longer needed
    for (const [key] of chunks) {
        if (!needed.has(key)) {
            removeChunk(key);
        }
    }

    // Create new chunks that are needed
    for (const key of needed) {
        if (!chunks.has(key)) {
            const [cx, cz] = key.split(',').map(Number);
            createChunk(cx, cz);
        }
    }
}

// ---------------------------------------------------------------------------
// 6. TREE SYSTEM
// ---------------------------------------------------------------------------

// Shared geometries and materials for trees — higher detail
const trunkGeometry = new THREE.CylinderBufferGeometry(0.18, 0.32, 2.8, 10);
const foliageGeometryLarge = new THREE.ConeBufferGeometry(2.2, 4.0, 12);
const foliageGeometryMed = new THREE.ConeBufferGeometry(1.7, 3.2, 12);
const foliageGeometrySmall = new THREE.ConeBufferGeometry(1.2, 2.5, 10);
const foliageGeometryTip = new THREE.ConeBufferGeometry(0.7, 1.8, 8);
const snowCapGeometryLarge = new THREE.ConeBufferGeometry(2.3, 0.6, 12);
const snowCapGeometryMed = new THREE.ConeBufferGeometry(1.8, 0.5, 12);
const snowCapGeometrySmall = new THREE.ConeBufferGeometry(1.3, 0.4, 10);
const snowCapGeometryTip = new THREE.ConeBufferGeometry(0.75, 0.35, 8);

const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x4a2e12, roughness: 0.95 });
const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0x2d5a27, roughness: 0.8 });
const snowCapMaterial = new THREE.MeshStandardMaterial({ color: 0xeef4f8, roughness: 0.7, metalness: 0.05 });

// Darker/lighter foliage variants for visual variety
const foliageMaterials = [
    foliageMaterial,
    new THREE.MeshStandardMaterial({ color: 0x1e4a1e, roughness: 0.85 }),
    new THREE.MeshStandardMaterial({ color: 0x3a6b30, roughness: 0.75 }),
    new THREE.MeshStandardMaterial({ color: 0x264f20, roughness: 0.82 }),
];

/**
 * Seeded random for deterministic tree placement per chunk.
 */
function seededRandom(seed) {
    let s = seed;
    return () => {
        s = (s * 16807 + 7) % 2147483647;
        return (s - 1) / 2147483646;
    };
}

/**
 * Spawn trees in a chunk. Returns array of tree group objects.
 */
function spawnTrees(cx, cz) {
    const trees = [];
    const size = CONFIG.chunkSize;
    const offsetX = cx * size;
    const offsetZ = cz * size;
    const rng = seededRandom(cx * 73856093 ^ cz * 19349663);

    for (let i = 0; i < CONFIG.treesPerChunk; i++) {
        const lx = (rng() - 0.5) * size;
        const lz = (rng() - 0.5) * size;
        const wx = offsetX + lx;
        const wz = offsetZ + lz;

        // Skip if too close to center path (player spawn corridor)
        if (Math.abs(wx) < CONFIG.treeClearRadius && cz >= -1 && cz <= 1) continue;

        const h = getTerrainHeight(wx, wz);
        const scale = 0.7 + rng() * 0.6;

        const group = new THREE.Group();
        group.position.set(wx, h, wz);

        // Slight random rotation for variety
        group.rotation.y = rng() * Math.PI * 2;

        // Trunk with slight taper
        const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
        trunk.position.y = 1.4 * scale;
        trunk.scale.set(scale, scale, scale);
        trunk.castShadow = true;
        group.add(trunk);

        const mat = foliageMaterials[Math.floor(rng() * foliageMaterials.length)];

        // Bottom foliage tier (widest)
        const f1 = new THREE.Mesh(foliageGeometryLarge, mat);
        f1.position.y = 3.2 * scale;
        f1.scale.set(scale, scale * (0.85 + rng() * 0.3), scale);
        f1.castShadow = true;
        group.add(f1);

        // Snow cap on bottom tier
        const sc1 = new THREE.Mesh(snowCapGeometryLarge, snowCapMaterial);
        sc1.position.y = (3.2 + 2.0) * scale;
        sc1.scale.set(scale, scale, scale);
        group.add(sc1);

        // Middle foliage tier
        const f2 = new THREE.Mesh(foliageGeometryMed, mat);
        f2.position.y = 5.0 * scale;
        f2.scale.set(scale * 0.85, scale * (0.8 + rng() * 0.3), scale * 0.85);
        f2.castShadow = true;
        group.add(f2);

        // Snow cap on middle tier
        const sc2 = new THREE.Mesh(snowCapGeometryMed, snowCapMaterial);
        sc2.position.y = (5.0 + 1.6) * scale;
        sc2.scale.set(scale * 0.85, scale, scale * 0.85);
        group.add(sc2);

        // Upper foliage tier
        const f3 = new THREE.Mesh(foliageGeometrySmall, mat);
        f3.position.y = 6.5 * scale;
        f3.scale.set(scale * 0.7, scale * (0.75 + rng() * 0.3), scale * 0.7);
        f3.castShadow = true;
        group.add(f3);

        // Snow cap on upper tier
        const sc3 = new THREE.Mesh(snowCapGeometrySmall, snowCapMaterial);
        sc3.position.y = (6.5 + 1.25) * scale;
        sc3.scale.set(scale * 0.7, scale, scale * 0.7);
        group.add(sc3);

        // Tip
        const f4 = new THREE.Mesh(foliageGeometryTip, mat);
        f4.position.y = 7.8 * scale;
        f4.scale.set(scale * 0.5, scale * (0.7 + rng() * 0.3), scale * 0.5);
        f4.castShadow = true;
        group.add(f4);

        // Snow cap on tip
        const sc4 = new THREE.Mesh(snowCapGeometryTip, snowCapMaterial);
        sc4.position.y = (7.8 + 0.9) * scale;
        sc4.scale.set(scale * 0.5, scale, scale * 0.5);
        group.add(sc4);

        // Store world position for collision detection
        group.userData.worldX = wx;
        group.userData.worldZ = wz;
        group.userData.radius = 1.0 * scale;

        scene.add(group);
        trees.push(group);
    }

    return trees;
}

// ---------------------------------------------------------------------------
// 7. PLAYER (SKIER)
// ---------------------------------------------------------------------------

function createPlayer() {
    player = new THREE.Group();

    // --- Legs (two cylinders) ---
    const legGeo = new THREE.CylinderBufferGeometry(0.1, 0.12, 0.7, 8);
    const pantsMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.7 });
    const legL = new THREE.Mesh(legGeo, pantsMat);
    legL.position.set(-0.15, 0.5, 0);
    legL.castShadow = true;
    player.add(legL);
    const legR = new THREE.Mesh(legGeo, pantsMat);
    legR.position.set(0.15, 0.5, 0);
    legR.castShadow = true;
    player.add(legR);

    // --- Boots ---
    const bootGeo = new THREE.BoxBufferGeometry(0.16, 0.12, 0.28);
    const bootMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
    const bootL = new THREE.Mesh(bootGeo, bootMat);
    bootL.position.set(-0.15, 0.12, 0.02);
    player.add(bootL);
    const bootR = new THREE.Mesh(bootGeo, bootMat);
    bootR.position.set(0.15, 0.12, 0.02);
    player.add(bootR);

    // --- Body / Jacket (tapered cylinder) ---
    const bodyGeo = new THREE.CylinderBufferGeometry(0.28, 0.22, 1.0, 10);
    const jacketMat = new THREE.MeshStandardMaterial({ color: 0xcc2233, roughness: 0.45 });
    const body = new THREE.Mesh(bodyGeo, jacketMat);
    body.position.y = 1.15;
    body.castShadow = true;
    player.add(body);

    // Jacket collar
    const collarGeo = new THREE.CylinderBufferGeometry(0.29, 0.28, 0.1, 10);
    const collarMat = new THREE.MeshStandardMaterial({ color: 0xaa1a28, roughness: 0.5 });
    const collar = new THREE.Mesh(collarGeo, collarMat);
    collar.position.y = 1.65;
    player.add(collar);

    // --- Arms ---
    const armGeo = new THREE.CylinderBufferGeometry(0.07, 0.06, 0.75, 8);
    const armL = new THREE.Mesh(armGeo, jacketMat);
    armL.position.set(-0.38, 1.2, 0.05);
    armL.rotation.z = 0.3;
    armL.rotation.x = -0.2;
    armL.castShadow = true;
    player.add(armL);
    const armR = new THREE.Mesh(armGeo, jacketMat);
    armR.position.set(0.38, 1.2, 0.05);
    armR.rotation.z = -0.3;
    armR.rotation.x = -0.2;
    armR.castShadow = true;
    player.add(armR);

    // --- Gloves ---
    const gloveGeo = new THREE.SphereBufferGeometry(0.07, 6, 6);
    const gloveMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });
    const gloveL = new THREE.Mesh(gloveGeo, gloveMat);
    gloveL.position.set(-0.48, 0.85, 0.12);
    player.add(gloveL);
    const gloveR = new THREE.Mesh(gloveGeo, gloveMat);
    gloveR.position.set(0.48, 0.85, 0.12);
    player.add(gloveR);

    // --- Ski Poles ---
    const poleGeo = new THREE.CylinderBufferGeometry(0.015, 0.015, 1.6, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.3, metalness: 0.7 });
    const poleL = new THREE.Mesh(poleGeo, poleMat);
    poleL.position.set(-0.48, 0.45, 0.12);
    poleL.rotation.x = -0.15;
    player.add(poleL);
    const poleR = new THREE.Mesh(poleGeo, poleMat);
    poleR.position.set(0.48, 0.45, 0.12);
    poleR.rotation.x = -0.15;
    player.add(poleR);

    // Pole baskets (small discs)
    const basketGeo = new THREE.CylinderBufferGeometry(0.06, 0.06, 0.01, 8);
    const basketL = new THREE.Mesh(basketGeo, poleMat);
    basketL.position.set(-0.48, -0.15, 0.2);
    player.add(basketL);
    const basketR = new THREE.Mesh(basketGeo, poleMat);
    basketR.position.set(0.48, -0.15, 0.2);
    player.add(basketR);

    // --- Head ---
    const headGeo = new THREE.SphereBufferGeometry(0.22, 12, 12);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xf5d0a9, roughness: 0.6 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.88;
    head.castShadow = true;
    player.add(head);

    // --- Beanie / Hat ---
    const hatGeo = new THREE.SphereBufferGeometry(0.24, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const hatMat = new THREE.MeshStandardMaterial({ color: 0x2255aa, roughness: 0.6 });
    const hat = new THREE.Mesh(hatGeo, hatMat);
    hat.position.y = 1.92;
    player.add(hat);

    // Hat pom-pom
    const pomGeo = new THREE.SphereBufferGeometry(0.06, 6, 6);
    const pom = new THREE.Mesh(pomGeo, hatMat);
    pom.position.y = 2.16;
    player.add(pom);

    // --- Goggles ---
    const goggleGeo = new THREE.TorusBufferGeometry(0.1, 0.025, 6, 12);
    const goggleMat = new THREE.MeshStandardMaterial({ color: 0xff8800, roughness: 0.2, metalness: 0.3 });
    const goggleL = new THREE.Mesh(goggleGeo, goggleMat);
    goggleL.position.set(-0.08, 1.9, -0.19);
    goggleL.rotation.y = Math.PI / 2;
    player.add(goggleL);
    const goggleR = new THREE.Mesh(goggleGeo, goggleMat);
    goggleR.position.set(0.08, 1.9, -0.19);
    goggleR.rotation.y = Math.PI / 2;
    player.add(goggleR);

    // Goggle bridge
    const bridgeGeo = new THREE.BoxBufferGeometry(0.04, 0.03, 0.04);
    const bridge = new THREE.Mesh(bridgeGeo, goggleMat);
    bridge.position.set(0, 1.9, -0.19);
    player.add(bridge);

    // Goggle lenses (dark)
    const lensGeo = new THREE.CircleBufferGeometry(0.08, 10);
    const lensMat = new THREE.MeshStandardMaterial({ color: 0x112233, roughness: 0.1, metalness: 0.5 });
    const lensL = new THREE.Mesh(lensGeo, lensMat);
    lensL.position.set(-0.08, 1.9, -0.215);
    player.add(lensL);
    const lensR = new THREE.Mesh(lensGeo, lensMat);
    lensR.position.set(0.08, 1.9, -0.215);
    player.add(lensR);

    // --- Skis (longer, more detailed) ---
    const skiGeo = new THREE.BoxBufferGeometry(0.12, 0.04, 2.2);
    const skiMat = new THREE.MeshStandardMaterial({ color: 0x2244aa, roughness: 0.25, metalness: 0.5 });
    const skiL = new THREE.Mesh(skiGeo, skiMat);
    skiL.position.set(-0.22, 0.02, -0.2);
    player.add(skiL);
    const skiR = new THREE.Mesh(skiGeo, skiMat);
    skiR.position.set(0.22, 0.02, -0.2);
    player.add(skiR);

    // Ski tip curves (small wedges at front)
    const tipGeo = new THREE.BoxBufferGeometry(0.12, 0.02, 0.15);
    const tipL = new THREE.Mesh(tipGeo, skiMat);
    tipL.position.set(-0.22, 0.06, -1.28);
    tipL.rotation.x = -0.4;
    player.add(tipL);
    const tipR = new THREE.Mesh(tipGeo, skiMat);
    tipR.position.set(0.22, 0.06, -1.28);
    tipR.rotation.x = -0.4;
    player.add(tipR);

    // Ski bindings
    const bindGeo = new THREE.BoxBufferGeometry(0.10, 0.06, 0.12);
    const bindMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5 });
    const bindL = new THREE.Mesh(bindGeo, bindMat);
    bindL.position.set(-0.22, 0.07, 0.0);
    player.add(bindL);
    const bindR = new THREE.Mesh(bindGeo, bindMat);
    bindR.position.set(0.22, 0.07, 0.0);
    player.add(bindR);

    player.position.copy(playerState.position);
    scene.add(player);
}

// ---------------------------------------------------------------------------
// 8. SNOW PARTICLE SYSTEM
// ---------------------------------------------------------------------------

function createSnowParticles() {
    const count = CONFIG.snowParticleCount;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const area = CONFIG.snowAreaSize;

    for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * area;
        positions[i * 3 + 1] = Math.random() * 40;
        positions[i * 3 + 2] = (Math.random() - 0.5) * area;
        sizes[i] = 0.08 + Math.random() * 0.18;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.18,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        sizeAttenuation: true,
    });

    snowParticles = new THREE.Points(geometry, material);
    scene.add(snowParticles);
}

function updateSnowParticles(dt) {
    if (!snowParticles) return;

    const positions = snowParticles.geometry.attributes.position.array;
    const area = CONFIG.snowAreaSize;
    const px = playerState.position.x;
    const pz = playerState.position.z;
    const time = performance.now() * 0.001;

    for (let i = 0; i < CONFIG.snowParticleCount; i++) {
        const idx = i * 3;
        // Varied fall speed per particle for depth
        const fallMult = 0.7 + (i % 7) * 0.08;
        positions[idx + 1] -= CONFIG.snowFallSpeed * fallMult * dt;

        // More complex drift — swirling motion
        const phase = i * 0.37 + time * 0.5;
        positions[idx] += Math.sin(positions[idx + 1] * 0.5 + phase) * 0.025;
        positions[idx + 2] += Math.cos(positions[idx + 1] * 0.3 + phase * 0.7) * 0.015;

        // Reset particle if below ground or too far
        if (positions[idx + 1] < -5) {
            positions[idx] = px + (Math.random() - 0.5) * area;
            positions[idx + 1] = playerState.position.y + 20 + Math.random() * 20;
            positions[idx + 2] = pz + (Math.random() - 0.5) * area;
        }
    }

    // Keep snow centered on player
    snowParticles.position.set(0, 0, 0);
    snowParticles.geometry.attributes.position.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// 9. INPUT HANDLING
// ---------------------------------------------------------------------------

function setupInput() {
    window.addEventListener('keydown', (e) => {
        switch (e.code) {
            case 'ArrowLeft': case 'KeyA': input.left = true; break;
            case 'ArrowRight': case 'KeyD': input.right = true; break;
            case 'Space': input.jump = true; e.preventDefault(); break;
        }
    });

    window.addEventListener('keyup', (e) => {
        switch (e.code) {
            case 'ArrowLeft': case 'KeyA': input.left = false; break;
            case 'ArrowRight': case 'KeyD': input.right = false; break;
            case 'Space': input.jump = false; break;
        }
    });

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

// ---------------------------------------------------------------------------
// 10. PLAYER CONTROLLER
// ---------------------------------------------------------------------------

function updatePlayer(dt) {
    const state = playerState;

    // Gradually increase speed (downhill acceleration)
    state.speed += CONFIG.acceleration * dt;
    if (state.speed > CONFIG.maxSpeed) state.speed = CONFIG.maxSpeed;

    // Steering
    let steerInput = 0;
    if (input.left) steerInput = 1;
    if (input.right) steerInput = -1;

    // Smooth steer blending
    if (steerInput !== 0) {
        state.currentSteer += (steerInput - state.currentSteer) * dt * CONFIG.steerReturnSpeed;
    } else {
        state.currentSteer *= Math.pow(0.05, dt); // Return to center
    }

    state.turnAngle += state.currentSteer * CONFIG.turnSpeed * dt;
    state.turnAngle *= CONFIG.turnDamping;

    // Compute forward direction (rotated from -Z by turn angle)
    const forwardX = Math.sin(state.turnAngle) * state.speed;
    const forwardZ = -Math.cos(state.turnAngle) * state.speed;

    state.velocity.x = forwardX;
    state.velocity.z = forwardZ;

    // Apply velocity
    state.position.x += state.velocity.x * dt;
    state.position.z += state.velocity.z * dt;

    // Jumping
    if (input.jump && state.isGrounded) {
        state.verticalVelocity = CONFIG.jumpImpulse;
        state.isGrounded = false;
    }

    // Gravity
    if (!state.isGrounded) {
        state.verticalVelocity -= CONFIG.gravity * dt;
        state.position.y += state.verticalVelocity * dt;
    }

    // Ground collision
    const terrainY = getTerrainHeight(state.position.x, state.position.z);
    if (state.position.y <= terrainY + 0.1) {
        state.position.y = terrainY + 0.1;
        state.verticalVelocity = 0;
        state.isGrounded = true;
    }

    // Tree collision detection
    checkTreeCollisions();

    // Track distance
    state.distanceTraveled = Math.abs(state.position.z);

    // Update player mesh
    player.position.copy(state.position);

    // Tilt player model in turning direction
    const targetRotY = Math.PI + state.turnAngle;
    player.rotation.y = targetRotY;
    player.rotation.z = -state.currentSteer * 0.2; // Lean
}

/**
 * Check if player collides with any nearby trees.
 * On collision, reduce speed.
 */
function checkTreeCollisions() {
    const px = playerState.position.x;
    const pz = playerState.position.z;
    const playerRadius = 0.5;

    for (const [, chunk] of chunks) {
        for (const tree of chunk.trees) {
            const dx = px - tree.userData.worldX;
            const dz = pz - tree.userData.worldZ;
            const dist = Math.sqrt(dx * dx + dz * dz);
            const minDist = playerRadius + tree.userData.radius;

            if (dist < minDist) {
                // Slow down on collision
                playerState.speed *= 0.7;
                if (playerState.speed < CONFIG.initialSpeed * 0.5) {
                    playerState.speed = CONFIG.initialSpeed * 0.5;
                }
                // Push player away from tree
                const pushX = (dx / dist) * (minDist - dist) * 0.5;
                const pushZ = (dz / dist) * (minDist - dist) * 0.5;
                playerState.position.x += pushX;
                playerState.position.z += pushZ;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 11. CAMERA CONTROLLER
// ---------------------------------------------------------------------------

function updateCamera(dt) {
    const state = playerState;
    const lerpFactor = 1 - Math.exp(-CONFIG.cameraLerpSpeed * dt);

    // Desired camera position: behind and above player
    const behindX = Math.sin(state.turnAngle) * CONFIG.cameraOffset.z;
    const behindZ = Math.cos(state.turnAngle) * CONFIG.cameraOffset.z;

    const desiredPos = new THREE.Vector3(
        state.position.x + behindX,
        state.position.y + CONFIG.cameraOffset.y,
        state.position.z + behindZ
    );

    // Smooth follow
    cameraState.currentPosition.lerp(desiredPos, lerpFactor);

    // Look at point ahead of player
    const lookAheadX = state.position.x - Math.sin(state.turnAngle) * CONFIG.cameraLookAhead;
    const lookAheadZ = state.position.z - Math.cos(state.turnAngle) * CONFIG.cameraLookAhead;
    const desiredLookAt = new THREE.Vector3(
        lookAheadX,
        state.position.y + 1.5,
        lookAheadZ
    );
    cameraState.currentLookAt.lerp(desiredLookAt, lerpFactor);

    // Camera shake at high speed
    const speedRatio = state.speed / CONFIG.maxSpeed;
    const shakeAmount = speedRatio * speedRatio * CONFIG.cameraShakeIntensity;
    cameraState.shake.set(
        (Math.random() - 0.5) * shakeAmount,
        (Math.random() - 0.5) * shakeAmount * 0.5,
        (Math.random() - 0.5) * shakeAmount * 0.3
    );

    camera.position.copy(cameraState.currentPosition).add(cameraState.shake);
    camera.lookAt(cameraState.currentLookAt);

    // Subtle camera roll during turns
    camera.rotation.z += state.currentSteer * CONFIG.cameraTiltAmount;
}

// ---------------------------------------------------------------------------
// 12. SUN SHADOW FOLLOW
// ---------------------------------------------------------------------------

function updateSunlight() {
    scene.traverse((obj) => {
        if (obj.isDirectionalLight && obj.userData.isSun) {
            obj.position.set(
                playerState.position.x + CONFIG.sunDirection.x * 80,
                playerState.position.y + CONFIG.sunDirection.y * 80,
                playerState.position.z + CONFIG.sunDirection.z * 80
            );
            obj.target.position.copy(playerState.position);
            obj.target.updateMatrixWorld();
        }
    });
}

// ---------------------------------------------------------------------------
// 13. HUD UPDATE
// ---------------------------------------------------------------------------

function updateHUD() {
    const speedKmh = Math.round(playerState.speed * 3.6);
    const distance = Math.round(playerState.distanceTraveled);

    document.getElementById('speed-display').innerHTML = `${speedKmh} <span>KM/H</span>`;
    document.getElementById('distance-display').textContent = `${distance} m`;
}

// ---------------------------------------------------------------------------
// 14. MAIN ANIMATION LOOP
// ---------------------------------------------------------------------------

function animate() {
    requestAnimationFrame(animate);

    if (!gameStarted) {
        renderer.render(scene, camera);
        return;
    }

    const dt = Math.min(clock.getDelta(), 0.05); // Cap delta to prevent physics issues

    updatePlayer(dt);
    updateChunks();
    updateCamera(dt);
    updateSunlight();
    updateSnowParticles(dt);
    updateTimeTransition(dt);
    updateHUD();

    renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// 15. INITIALIZATION
// ---------------------------------------------------------------------------

function startGame() {
    gameStarted = true;
    clock.getDelta(); // Reset delta

    document.getElementById('title-screen').classList.add('hidden');
    document.getElementById('hud').style.display = 'block';
    document.getElementById('controls-hint').style.display = 'block';
    document.getElementById('time-menu-btn').style.display = 'block';

    // Fade out controls hint after 5 seconds
    setTimeout(() => {
        const hint = document.getElementById('controls-hint');
        if (hint) hint.style.opacity = '0';
    }, 5000);
}

function init() {
    initScene();
    setupInput();
    createPlayer();
    createSnowParticles();

    // Pre-generate initial chunks
    updateChunks();

    // Initialize camera position
    cameraState.currentPosition.set(
        playerState.position.x + CONFIG.cameraOffset.x,
        playerState.position.y + CONFIG.cameraOffset.y,
        playerState.position.z + CONFIG.cameraOffset.z
    );
    camera.position.copy(cameraState.currentPosition);

    // Start button
    document.getElementById('start-btn').addEventListener('click', startGame);

    // Also allow pressing any key to start
    const startOnKey = (e) => {
        if (!gameStarted) {
            startGame();
            window.removeEventListener('keydown', startOnKey);
        }
    };
    window.addEventListener('keydown', startOnKey);

    // Time-of-day menu
    const timeMenuBtn = document.getElementById('time-menu-btn');
    const timeMenuPanel = document.getElementById('time-menu-panel');

    timeMenuBtn.addEventListener('click', () => {
        timeMenuPanel.classList.toggle('open');
    });

    document.querySelectorAll('.time-option').forEach((btn) => {
        btn.addEventListener('click', () => {
            const time = btn.dataset.time;
            if (time === currentTimePreset) return;
            document.querySelectorAll('.time-option').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            applyTimePreset(time, true);
            // Close panel after selection
            setTimeout(() => timeMenuPanel.classList.remove('open'), 300);
        });
    });

    // Close panel when clicking outside
    document.addEventListener('click', (e) => {
        if (!timeMenuPanel.contains(e.target) && e.target !== timeMenuBtn) {
            timeMenuPanel.classList.remove('open');
        }
    });

    // Start render loop
    animate();
}

// Launch when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
