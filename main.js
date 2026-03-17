// ============================================================
// Slowski — Infinite Downhill Skiing Simulation
// Built with Three.js + Simplex Noise
// ============================================================

// ------------------------------------------------------------
// Simplex Noise Implementation (self-contained)
// ------------------------------------------------------------
const SimplexNoise = (function () {
    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;
    const F3 = 1 / 3;
    const G3 = 1 / 6;

    const grad3 = [
        [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
        [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
        [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]
    ];

    function SimplexNoise(seed) {
        this.perm = new Uint8Array(512);
        this.permMod12 = new Uint8Array(512);
        const p = new Uint8Array(256);

        // Seed-based permutation
        let s = seed || Math.random() * 65536;
        for (let i = 0; i < 256; i++) p[i] = i;
        for (let i = 255; i > 0; i--) {
            s = (s * 16807 + 0) % 2147483647;
            const j = s % (i + 1);
            const tmp = p[i];
            p[i] = p[j];
            p[j] = tmp;
        }
        for (let i = 0; i < 512; i++) {
            this.perm[i] = p[i & 255];
            this.permMod12[i] = this.perm[i] % 12;
        }
    }

    function dot2(g, x, y) { return g[0] * x + g[1] * y; }
    function dot3(g, x, y, z) { return g[0] * x + g[1] * y + g[2] * z; }

    SimplexNoise.prototype.noise2D = function (xin, yin) {
        let n0, n1, n2;
        const s = (xin + yin) * F2;
        const i = Math.floor(xin + s);
        const j = Math.floor(yin + s);
        const t = (i + j) * G2;
        const x0 = xin - (i - t);
        const y0 = yin - (j - t);
        let i1, j1;
        if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
        const x1 = x0 - i1 + G2;
        const y1 = y0 - j1 + G2;
        const x2 = x0 - 1.0 + 2.0 * G2;
        const y2 = y0 - 1.0 + 2.0 * G2;
        const ii = i & 255;
        const jj = j & 255;
        const gi0 = this.permMod12[ii + this.perm[jj]];
        const gi1 = this.permMod12[ii + i1 + this.perm[jj + j1]];
        const gi2 = this.permMod12[ii + 1 + this.perm[jj + 1]];
        let t0 = 0.5 - x0 * x0 - y0 * y0;
        if (t0 < 0) n0 = 0.0;
        else { t0 *= t0; n0 = t0 * t0 * dot2(grad3[gi0], x0, y0); }
        let t1 = 0.5 - x1 * x1 - y1 * y1;
        if (t1 < 0) n1 = 0.0;
        else { t1 *= t1; n1 = t1 * t1 * dot2(grad3[gi1], x1, y1); }
        let t2 = 0.5 - x2 * x2 - y2 * y2;
        if (t2 < 0) n2 = 0.0;
        else { t2 *= t2; n2 = t2 * t2 * dot2(grad3[gi2], x2, y2); }
        return 70.0 * (n0 + n1 + n2);
    };

    SimplexNoise.prototype.noise3D = function (xin, yin, zin) {
        let n0, n1, n2, n3;
        const s = (xin + yin + zin) * F3;
        const i = Math.floor(xin + s);
        const j = Math.floor(yin + s);
        const k = Math.floor(zin + s);
        const t = (i + j + k) * G3;
        const x0 = xin - (i - t);
        const y0 = yin - (j - t);
        const z0 = zin - (k - t);
        let i1, j1, k1, i2, j2, k2;
        if (x0 >= y0) {
            if (y0 >= z0) { i1=1; j1=0; k1=0; i2=1; j2=1; k2=0; }
            else if (x0 >= z0) { i1=1; j1=0; k1=0; i2=1; j2=0; k2=1; }
            else { i1=0; j1=0; k1=1; i2=1; j2=0; k2=1; }
        } else {
            if (y0 < z0) { i1=0; j1=0; k1=1; i2=0; j2=1; k2=1; }
            else if (x0 < z0) { i1=0; j1=1; k1=0; i2=0; j2=1; k2=1; }
            else { i1=0; j1=1; k1=0; i2=1; j2=1; k2=0; }
        }
        const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
        const x2 = x0 - i2 + 2*G3, y2 = y0 - j2 + 2*G3, z2 = z0 - k2 + 2*G3;
        const x3 = x0 - 1 + 3*G3, y3 = y0 - 1 + 3*G3, z3 = z0 - 1 + 3*G3;
        const ii = i & 255, jj = j & 255, kk = k & 255;
        const gi0 = this.permMod12[ii + this.perm[jj + this.perm[kk]]];
        const gi1 = this.permMod12[ii + i1 + this.perm[jj + j1 + this.perm[kk + k1]]];
        const gi2 = this.permMod12[ii + i2 + this.perm[jj + j2 + this.perm[kk + k2]]];
        const gi3 = this.permMod12[ii + 1 + this.perm[jj + 1 + this.perm[kk + 1]]];
        let t0 = 0.6 - x0*x0 - y0*y0 - z0*z0;
        if (t0 < 0) n0 = 0; else { t0 *= t0; n0 = t0*t0 * dot3(grad3[gi0], x0, y0, z0); }
        let t1 = 0.6 - x1*x1 - y1*y1 - z1*z1;
        if (t1 < 0) n1 = 0; else { t1 *= t1; n1 = t1*t1 * dot3(grad3[gi1], x1, y1, z1); }
        let t2 = 0.6 - x2*x2 - y2*y2 - z2*z2;
        if (t2 < 0) n2 = 0; else { t2 *= t2; n2 = t2*t2 * dot3(grad3[gi2], x2, y2, z2); }
        let t3 = 0.6 - x3*x3 - y3*y3 - z3*z3;
        if (t3 < 0) n3 = 0; else { t3 *= t3; n3 = t3*t3 * dot3(grad3[gi3], x3, y3, z3); }
        return 32 * (n0 + n1 + n2 + n3);
    };

    return SimplexNoise;
})();

// ------------------------------------------------------------
// Constants & Configuration
// ------------------------------------------------------------
const CONFIG = {
    // Terrain
    chunkSize: 60,
    chunkSegments: 60,
    chunksAhead: 4,
    chunksBehind: 2,
    terrainSlope: 0.18,
    noiseScale1: 0.008,
    noiseAmplitude1: 12,
    noiseScale2: 0.025,
    noiseAmplitude2: 4,
    noiseScale3: 0.06,
    noiseAmplitude3: 1.5,

    // Player
    baseSpeed: 18,
    maxSpeed: 55,
    acceleration: 3.5,
    turnSpeed: 2.2,
    turnDamping: 0.92,
    gravity: 30,
    jumpImpulse: 12,
    playerRadius: 0.5,

    // Trees
    treeDensity: 0.012,
    treeMinDistance: 3.0,
    treeTrunkRadius: 0.2,
    treeTrunkHeight: 1.8,
    treeConeRadius: 1.6,
    treeConeHeight: 4.5,

    // Camera
    cameraDistance: 12,
    cameraHeight: 5.5,
    cameraLerpPosition: 0.04,
    cameraLerpLookAt: 0.08,
    cameraShakeIntensity: 0.15,

    // Snow particles
    snowCount: 1500,
    snowArea: 80,
    snowSpeed: 4,

    // Fog
    fogNear: 30,
    fogFar: 200,
    fogColor: 0xd6e8f5,
    skyTopColor: 0x6fa8dc,
    skyBottomColor: 0xe8f0f8,
};

// ------------------------------------------------------------
// Global State
// ------------------------------------------------------------
let scene, camera, renderer;
let clock;
let noise;
let player;
let chunks = new Map();
let trees = new Map();
let snowParticles;
let keys = {};
let gameStarted = false;
let distanceTraveled = 0;

// Reusable vectors to avoid allocations
const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();

// ------------------------------------------------------------
// Scene Setup
// ------------------------------------------------------------
function initScene() {
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(CONFIG.fogColor, CONFIG.fogNear, CONFIG.fogFar);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    document.body.appendChild(renderer.domElement);

    // Camera
    camera = new THREE.PerspectiveCamera(
        65,
        window.innerWidth / window.innerHeight,
        0.5,
        CONFIG.fogFar + 50
    );

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x8eafc4, 0.6);
    scene.add(ambientLight);

    const hemisphereLight = new THREE.HemisphereLight(0x87ceeb, 0xc8d8e8, 0.4);
    scene.add(hemisphereLight);

    const sunLight = new THREE.DirectionalLight(0xfff5e6, 1.0);
    sunLight.position.set(50, 80, 30);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 200;
    sunLight.shadow.camera.left = -60;
    sunLight.shadow.camera.right = 60;
    sunLight.shadow.camera.top = 60;
    sunLight.shadow.camera.bottom = -60;
    sunLight.shadow.bias = -0.001;
    scene.add(sunLight);
    scene.add(sunLight.target);

    // Sky background
    createSky();

    // Clock & noise
    clock = new THREE.Clock();
    noise = new SimplexNoise(42);
}

// Create a gradient sky using a large sphere
function createSky() {
    const skyGeo = new THREE.SphereGeometry(CONFIG.fogFar + 40, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
        uniforms: {
            topColor: { value: new THREE.Color(CONFIG.skyTopColor) },
            bottomColor: { value: new THREE.Color(CONFIG.skyBottomColor) },
            offset: { value: 20 },
            exponent: { value: 0.4 }
        },
        vertexShader: `
            varying vec3 vWorldPosition;
            void main() {
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPos.xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 topColor;
            uniform vec3 bottomColor;
            uniform float offset;
            uniform float exponent;
            varying vec3 vWorldPosition;
            void main() {
                float h = normalize(vWorldPosition + offset).y;
                gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
            }
        `,
        side: THREE.BackSide,
        depthWrite: false
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    scene.add(sky);
}

// ------------------------------------------------------------
// Terrain Height Function
// ------------------------------------------------------------
function getTerrainHeight(x, z) {
    // Base downhill slope
    let height = -z * CONFIG.terrainSlope;

    // Multi-octave noise for natural terrain
    height += noise.noise2D(x * CONFIG.noiseScale1, z * CONFIG.noiseScale1) * CONFIG.noiseAmplitude1;
    height += noise.noise2D(x * CONFIG.noiseScale2, z * CONFIG.noiseScale2) * CONFIG.noiseAmplitude2;
    height += noise.noise2D(x * CONFIG.noiseScale3, z * CONFIG.noiseScale3) * CONFIG.noiseAmplitude3;

    // Gentle valley shape — lower in center, higher at edges
    const valleyWidth = 25;
    const valleyFactor = Math.pow(x / valleyWidth, 2) * 2.0;
    height += valleyFactor;

    return height;
}

// Get terrain normal at a point (for slope-based coloring and physics)
function getTerrainNormal(x, z) {
    const eps = 0.5;
    const hL = getTerrainHeight(x - eps, z);
    const hR = getTerrainHeight(x + eps, z);
    const hD = getTerrainHeight(x, z - eps);
    const hU = getTerrainHeight(x, z + eps);
    _v3a.set(2 * eps, hR - hL, 0);
    _v3b.set(0, hU - hD, 2 * eps);
    _v3a.cross(_v3b).normalize();
    return _v3a;
}

// ------------------------------------------------------------
// Chunk Management
// ------------------------------------------------------------

// Snow material with subtle vertex coloring
const snowMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.02,
    flatShading: false,
});

function createChunk(chunkX, chunkZ) {
    const key = `${chunkX},${chunkZ}`;
    if (chunks.has(key)) return;

    const size = CONFIG.chunkSize;
    const segs = CONFIG.chunkSegments;
    const geometry = new THREE.BufferGeometry();

    const vertices = [];
    const colors = [];
    const indices = [];
    const normals = [];

    const worldOffsetX = chunkX * size;
    const worldOffsetZ = chunkZ * size;

    // Generate vertex positions and colors
    for (let iz = 0; iz <= segs; iz++) {
        for (let ix = 0; ix <= segs; ix++) {
            const localX = (ix / segs) * size;
            const localZ = (iz / segs) * size;
            const worldX = worldOffsetX + localX;
            const worldZ = worldOffsetZ + localZ;

            const height = getTerrainHeight(worldX, worldZ);
            vertices.push(worldX, height, worldZ);

            // Snow color with subtle variation
            const colorNoise = noise.noise2D(worldX * 0.05, worldZ * 0.05) * 0.04;
            const slopeNormal = getTerrainNormal(worldX, worldZ);
            const steepness = 1.0 - slopeNormal.y;

            // Whiter on flat areas, slightly blue-gray on steep areas
            const baseR = 0.92 + colorNoise;
            const baseG = 0.94 + colorNoise;
            const baseB = 0.98 + colorNoise;
            const steepMix = Math.min(steepness * 3.0, 1.0);
            const r = THREE.MathUtils.lerp(baseR, 0.78, steepMix);
            const g = THREE.MathUtils.lerp(baseG, 0.82, steepMix);
            const b = THREE.MathUtils.lerp(baseB, 0.88, steepMix);
            colors.push(r, g, b);
        }
    }

    // Generate indices
    for (let iz = 0; iz < segs; iz++) {
        for (let ix = 0; ix < segs; ix++) {
            const a = iz * (segs + 1) + ix;
            const b = a + 1;
            const c = a + (segs + 1);
            const d = c + 1;
            indices.push(a, c, b);
            indices.push(b, c, d);
        }
    }

    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, snowMaterial);
    mesh.receiveShadow = true;
    scene.add(mesh);
    chunks.set(key, mesh);

    // Generate trees for this chunk
    generateTrees(chunkX, chunkZ);
}

function removeChunk(key) {
    const mesh = chunks.get(key);
    if (mesh) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        chunks.delete(key);
    }

    // Remove associated trees
    const treeMeshes = trees.get(key);
    if (treeMeshes) {
        treeMeshes.forEach(tree => {
            scene.remove(tree);
            tree.traverse(child => {
                if (child.geometry) child.geometry.dispose();
            });
        });
        trees.delete(key);
    }
}

function updateChunks(playerZ) {
    const chunkSize = CONFIG.chunkSize;
    const playerChunkZ = Math.floor(playerZ / chunkSize);
    const playerChunkX = Math.floor((player.mesh.position.x) / chunkSize);

    // Determine which chunks should exist
    const neededChunks = new Set();
    for (let dz = -CONFIG.chunksBehind; dz <= CONFIG.chunksAhead; dz++) {
        // Generate 3 chunks wide to give room to steer
        for (let dx = -1; dx <= 1; dx++) {
            const cx = playerChunkX + dx;
            const cz = playerChunkZ + dz;
            neededChunks.add(`${cx},${cz}`);
        }
    }

    // Create new chunks
    neededChunks.forEach(key => {
        if (!chunks.has(key)) {
            const [cx, cz] = key.split(',').map(Number);
            createChunk(cx, cz);
        }
    });

    // Remove old chunks
    chunks.forEach((mesh, key) => {
        if (!neededChunks.has(key)) {
            removeChunk(key);
        }
    });
}

// ------------------------------------------------------------
// Tree Generation
// ------------------------------------------------------------

// Shared geometries and materials for trees (instancing-like reuse)
const trunkGeometry = new THREE.CylinderGeometry(
    CONFIG.treeTrunkRadius * 0.6,
    CONFIG.treeTrunkRadius,
    CONFIG.treeTrunkHeight,
    6
);
const coneGeometry1 = new THREE.ConeGeometry(CONFIG.treeConeRadius, CONFIG.treeConeHeight, 7);
const coneGeometry2 = new THREE.ConeGeometry(CONFIG.treeConeRadius * 0.75, CONFIG.treeConeHeight * 0.8, 7);
const coneGeometry3 = new THREE.ConeGeometry(CONFIG.treeConeRadius * 0.5, CONFIG.treeConeHeight * 0.6, 7);

const trunkMaterial = new THREE.MeshStandardMaterial({
    color: 0x5c3a1e,
    roughness: 0.9,
    metalness: 0.0
});

const foliageMaterial = new THREE.MeshStandardMaterial({
    color: 0x2d5a27,
    roughness: 0.8,
    metalness: 0.0
});

const foliageMaterialSnowy = new THREE.MeshStandardMaterial({
    color: 0x3d7a37,
    roughness: 0.7,
    metalness: 0.0
});

// Seeded random for deterministic tree placement
function seededRandom(seed) {
    let s = seed;
    return function () {
        s = (s * 16807 + 0) % 2147483647;
        return (s - 1) / 2147483646;
    };
}

function generateTrees(chunkX, chunkZ) {
    const key = `${chunkX},${chunkZ}`;
    if (trees.has(key)) return;

    const treeMeshes = [];
    const size = CONFIG.chunkSize;
    const worldOffsetX = chunkX * size;
    const worldOffsetZ = chunkZ * size;

    // Use chunk coordinates as seed for deterministic placement
    const rng = seededRandom(chunkX * 73856093 + chunkZ * 19349663 + 12345);
    const numTrees = Math.floor(size * size * CONFIG.treeDensity);

    for (let i = 0; i < numTrees; i++) {
        const localX = rng() * size;
        const localZ = rng() * size;
        const worldX = worldOffsetX + localX;
        const worldZ = worldOffsetZ + localZ;

        // Avoid center path (give player a clear starting lane)
        if (Math.abs(worldX) < CONFIG.treeMinDistance + 2) continue;

        // Slightly fewer trees near center for playability
        const centerDist = Math.abs(worldX);
        if (centerDist < 8 && rng() > 0.4) continue;

        const height = getTerrainHeight(worldX, worldZ);
        const scale = 0.7 + rng() * 0.6;

        // Create tree group
        const treeGroup = new THREE.Group();

        // Trunk
        const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
        trunk.position.y = CONFIG.treeTrunkHeight * 0.5 * scale;
        trunk.scale.set(scale, scale, scale);
        trunk.castShadow = true;
        treeGroup.add(trunk);

        // Foliage layers — stacked cones
        const mat = rng() > 0.5 ? foliageMaterial : foliageMaterialSnowy;
        const baseY = CONFIG.treeTrunkHeight * scale;

        const cone1 = new THREE.Mesh(coneGeometry1, mat);
        cone1.position.y = baseY + CONFIG.treeConeHeight * 0.35 * scale;
        cone1.scale.set(scale, scale, scale);
        cone1.castShadow = true;
        treeGroup.add(cone1);

        const cone2 = new THREE.Mesh(coneGeometry2, mat);
        cone2.position.y = baseY + CONFIG.treeConeHeight * 0.85 * scale;
        cone2.scale.set(scale, scale, scale);
        cone2.castShadow = true;
        treeGroup.add(cone2);

        const cone3 = new THREE.Mesh(coneGeometry3, mat);
        cone3.position.y = baseY + CONFIG.treeConeHeight * 1.25 * scale;
        cone3.scale.set(scale, scale, scale);
        cone3.castShadow = true;
        treeGroup.add(cone3);

        treeGroup.position.set(worldX, height, worldZ);

        // Slight random rotation for variety
        treeGroup.rotation.y = rng() * Math.PI * 2;

        scene.add(treeGroup);
        treeMeshes.push(treeGroup);

        // Store tree position for collision detection
        treeGroup.userData.worldX = worldX;
        treeGroup.userData.worldZ = worldZ;
        treeGroup.userData.radius = CONFIG.treeConeRadius * scale * 0.5;
    }

    trees.set(key, treeMeshes);
}

// ------------------------------------------------------------
// Player (Skier)
// ------------------------------------------------------------
function createPlayer() {
    const group = new THREE.Group();

    // Body (capsule-like shape)
    const bodyGeo = new THREE.CapsuleGeometry(0.25, 0.7, 4, 8);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xcc2233, roughness: 0.6 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.8;
    body.castShadow = true;
    group.add(body);

    // Head
    const headGeo = new THREE.SphereGeometry(0.18, 8, 8);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xf5d0a9, roughness: 0.7 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.5;
    head.castShadow = true;
    group.add(head);

    // Skis (two thin boxes)
    const skiGeo = new THREE.BoxGeometry(0.12, 0.04, 1.6);
    const skiMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.4, metalness: 0.3 });
    const leftSki = new THREE.Mesh(skiGeo, skiMat);
    leftSki.position.set(-0.18, 0.02, 0);
    group.add(leftSki);
    const rightSki = new THREE.Mesh(skiGeo, skiMat);
    rightSki.position.set(0.18, 0.02, 0);
    group.add(rightSki);

    scene.add(group);

    player = {
        mesh: group,
        body: body,
        velocity: new THREE.Vector3(0, 0, -CONFIG.baseSpeed),
        speed: CONFIG.baseSpeed,
        turnAngle: 0,
        turnVelocity: 0,
        verticalVelocity: 0,
        isGrounded: true,
        isJumping: false,
    };

    // Initial position
    player.mesh.position.set(0, getTerrainHeight(0, 0) + 0.5, 0);
}

function updatePlayer(dt) {
    if (!player) return;

    // Steering input
    let turnInput = 0;
    if (keys['ArrowLeft'] || keys['KeyA']) turnInput = 1;
    if (keys['ArrowRight'] || keys['KeyD']) turnInput = -1;

    // Smooth turn velocity
    player.turnVelocity += turnInput * CONFIG.turnSpeed * dt;
    player.turnVelocity *= CONFIG.turnDamping;
    player.turnAngle += player.turnVelocity * dt;

    // Clamp turn angle to prevent wild spinning
    player.turnAngle = THREE.MathUtils.clamp(player.turnAngle, -Math.PI * 0.35, Math.PI * 0.35);

    // Gradual return to center when not turning
    if (turnInput === 0) {
        player.turnAngle *= 0.97;
    }

    // Speed management — gradually increase, terrain slope affects speed
    const terrainNormal = getTerrainNormal(player.mesh.position.x, player.mesh.position.z);
    const slopeFactor = 1.0 + (1.0 - terrainNormal.y) * 2.0;
    const targetSpeed = Math.min(CONFIG.baseSpeed * slopeFactor + distanceTraveled * 0.002, CONFIG.maxSpeed);
    player.speed = THREE.MathUtils.lerp(player.speed, targetSpeed, dt * 0.5);

    // Forward direction based on turn angle
    const forwardX = Math.sin(player.turnAngle);
    const forwardZ = -Math.cos(player.turnAngle);

    // Set horizontal velocity
    player.velocity.x = forwardX * player.speed;
    player.velocity.z = forwardZ * player.speed;

    // Jump
    if ((keys['Space'] || keys['ArrowUp']) && player.isGrounded && !player.isJumping) {
        player.verticalVelocity = CONFIG.jumpImpulse;
        player.isGrounded = false;
        player.isJumping = true;
    }

    // Gravity
    if (!player.isGrounded) {
        player.verticalVelocity -= CONFIG.gravity * dt;
    }

    // Update position
    player.mesh.position.x += player.velocity.x * dt;
    player.mesh.position.z += player.velocity.z * dt;
    player.mesh.position.y += player.verticalVelocity * dt;

    // Ground collision
    const groundHeight = getTerrainHeight(player.mesh.position.x, player.mesh.position.z);
    const playerGroundY = groundHeight + 0.1;

    if (player.mesh.position.y <= playerGroundY) {
        player.mesh.position.y = playerGroundY;
        player.verticalVelocity = 0;
        player.isGrounded = true;
        player.isJumping = false;
    }

    // Player mesh rotation — lean into turns
    player.mesh.rotation.y = player.turnAngle;
    const leanAngle = -player.turnVelocity * 0.3;
    player.body.rotation.z = THREE.MathUtils.lerp(player.body.rotation.z, leanAngle, dt * 5);

    // Align player to terrain slope (subtle)
    const slopeX = getTerrainHeight(player.mesh.position.x + 0.5, player.mesh.position.z) -
                    getTerrainHeight(player.mesh.position.x - 0.5, player.mesh.position.z);
    const slopeZ = getTerrainHeight(player.mesh.position.x, player.mesh.position.z + 0.5) -
                    getTerrainHeight(player.mesh.position.x, player.mesh.position.z - 0.5);
    player.mesh.rotation.x = THREE.MathUtils.lerp(player.mesh.rotation.x, -slopeZ * 0.3, dt * 3);

    // Tree collision detection
    checkTreeCollisions();

    // Distance tracking
    distanceTraveled = Math.abs(player.mesh.position.z);
}

function checkTreeCollisions() {
    const px = player.mesh.position.x;
    const pz = player.mesh.position.z;
    const playerRadius = CONFIG.playerRadius;

    trees.forEach((treeMeshes) => {
        treeMeshes.forEach(tree => {
            const tx = tree.userData.worldX;
            const tz = tree.userData.worldZ;
            const tr = tree.userData.radius;

            const dx = px - tx;
            const dz = pz - tz;
            const dist = Math.sqrt(dx * dx + dz * dz);
            const minDist = playerRadius + tr;

            if (dist < minDist) {
                // Slow down on collision
                player.speed *= 0.7;

                // Push player away from tree
                const pushX = dx / dist;
                const pushZ = dz / dist;
                player.mesh.position.x += pushX * (minDist - dist) * 1.2;
                player.mesh.position.z += pushZ * (minDist - dist) * 1.2;

                // Reduce turn velocity on impact
                player.turnVelocity *= 0.5;
            }
        });
    });
}

// ------------------------------------------------------------
// Camera Controller
// ------------------------------------------------------------
const cameraState = {
    currentPosition: new THREE.Vector3(),
    currentLookAt: new THREE.Vector3(),
    shakeOffset: new THREE.Vector3(),
    initialized: false,
};

function updateCamera(dt) {
    if (!player) return;

    const pos = player.mesh.position;

    // Desired camera position — behind and above player
    const behindX = Math.sin(player.turnAngle) * CONFIG.cameraDistance;
    const behindZ = Math.cos(player.turnAngle) * CONFIG.cameraDistance;

    const desiredPosition = _v3a.set(
        pos.x - behindX * 0.3,
        pos.y + CONFIG.cameraHeight,
        pos.z + behindZ
    );

    // Desired look-at — slightly ahead of player
    const lookAheadZ = -8;
    const desiredLookAt = _v3b.set(
        pos.x + Math.sin(player.turnAngle) * 3,
        pos.y + 1,
        pos.z + lookAheadZ
    );

    if (!cameraState.initialized) {
        cameraState.currentPosition.copy(desiredPosition);
        cameraState.currentLookAt.copy(desiredLookAt);
        cameraState.initialized = true;
    }

    // Smooth follow with lerp
    cameraState.currentPosition.lerp(desiredPosition, CONFIG.cameraLerpPosition);
    cameraState.currentLookAt.lerp(desiredLookAt, CONFIG.cameraLerpLookAt);

    // Camera shake at high speed
    const speedRatio = player.speed / CONFIG.maxSpeed;
    if (speedRatio > 0.5) {
        const shakeAmount = (speedRatio - 0.5) * 2 * CONFIG.cameraShakeIntensity;
        cameraState.shakeOffset.set(
            (Math.random() - 0.5) * shakeAmount,
            (Math.random() - 0.5) * shakeAmount * 0.5,
            (Math.random() - 0.5) * shakeAmount * 0.3
        );
    } else {
        cameraState.shakeOffset.set(0, 0, 0);
    }

    camera.position.copy(cameraState.currentPosition).add(cameraState.shakeOffset);
    camera.lookAt(cameraState.currentLookAt);

    // Update sun shadow camera to follow player
    const sunLight = scene.children.find(c => c.isDirectionalLight);
    if (sunLight) {
        sunLight.position.set(pos.x + 50, pos.y + 80, pos.z + 30);
        sunLight.target.position.set(pos.x, pos.y, pos.z);
    }
}

// ------------------------------------------------------------
// Snow Particle System
// ------------------------------------------------------------
function createSnowParticles() {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(CONFIG.snowCount * 3);
    const velocities = new Float32Array(CONFIG.snowCount * 3);

    for (let i = 0; i < CONFIG.snowCount; i++) {
        const i3 = i * 3;
        positions[i3] = (Math.random() - 0.5) * CONFIG.snowArea;
        positions[i3 + 1] = Math.random() * 30;
        positions[i3 + 2] = (Math.random() - 0.5) * CONFIG.snowArea;

        velocities[i3] = (Math.random() - 0.5) * 0.5;
        velocities[i3 + 1] = -(Math.random() * CONFIG.snowSpeed + 1);
        velocities[i3 + 2] = (Math.random() - 0.5) * 0.5;
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.userData = { velocities: velocities };

    const material = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.15,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    snowParticles = new THREE.Points(geometry, material);
    scene.add(snowParticles);
}

function updateSnowParticles(dt) {
    if (!snowParticles || !player) return;

    const positions = snowParticles.geometry.attributes.position.array;
    const velocities = snowParticles.geometry.userData.velocities;
    const px = player.mesh.position.x;
    const py = player.mesh.position.y;
    const pz = player.mesh.position.z;
    const halfArea = CONFIG.snowArea * 0.5;

    for (let i = 0; i < CONFIG.snowCount; i++) {
        const i3 = i * 3;

        positions[i3] += velocities[i3] * dt;
        positions[i3 + 1] += velocities[i3 + 1] * dt;
        positions[i3 + 2] += velocities[i3 + 2] * dt;

        // Respawn particles that fall below ground or go too far
        if (positions[i3 + 1] < py - 5 ||
            Math.abs(positions[i3] - px) > halfArea ||
            Math.abs(positions[i3 + 2] - pz) > halfArea) {

            positions[i3] = px + (Math.random() - 0.5) * CONFIG.snowArea;
            positions[i3 + 1] = py + 10 + Math.random() * 20;
            positions[i3 + 2] = pz + (Math.random() - 0.5) * CONFIG.snowArea;
        }
    }

    snowParticles.geometry.attributes.position.needsUpdate = true;
}

// ------------------------------------------------------------
// HUD Update
// ------------------------------------------------------------
const speedDisplay = document.getElementById('speed-display');
const distanceDisplay = document.getElementById('distance-display');
const controlsHint = document.getElementById('controls-hint');

function updateHUD() {
    if (!player) return;

    // Speed in "km/h" (game units scaled)
    const displaySpeed = Math.round(player.speed * 3.2);
    speedDisplay.innerHTML = `${displaySpeed}<span>km/h</span>`;

    // Distance in meters
    const displayDistance = Math.round(distanceTraveled);
    distanceDisplay.textContent = `${displayDistance} m`;

    // Fade out controls hint after a while
    if (distanceTraveled > 100) {
        controlsHint.style.opacity = '0';
    }
}

// ------------------------------------------------------------
// Input Handling
// ------------------------------------------------------------
function initInput() {
    window.addEventListener('keydown', (e) => {
        keys[e.code] = true;
        if (!gameStarted) startGame();
    });

    window.addEventListener('keyup', (e) => {
        keys[e.code] = false;
    });

    // Touch controls for mobile
    let touchStartX = 0;
    window.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        if (!gameStarted) startGame();
    });

    window.addEventListener('touchmove', (e) => {
        const touchX = e.touches[0].clientX;
        const diff = touchX - touchStartX;
        const threshold = 30;
        keys['KeyA'] = diff < -threshold;
        keys['KeyD'] = diff > threshold;
    });

    window.addEventListener('touchend', () => {
        keys['KeyA'] = false;
        keys['KeyD'] = false;
    });

    // Resize handler
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

// ------------------------------------------------------------
// Game Start
// ------------------------------------------------------------
function startGame() {
    if (gameStarted) return;
    gameStarted = true;

    const loading = document.getElementById('loading');
    loading.classList.add('hidden');
    setTimeout(() => { loading.style.display = 'none'; }, 1000);
}

// ------------------------------------------------------------
// Animation Loop
// ------------------------------------------------------------
function animate() {
    requestAnimationFrame(animate);

    const dt = Math.min(clock.getDelta(), 0.05); // Cap delta to prevent huge jumps

    if (gameStarted) {
        updatePlayer(dt);
        updateChunks(player.mesh.position.z);
        updateCamera(dt);
        updateSnowParticles(dt);
        updateHUD();
    }

    renderer.render(scene, camera);
}

// ------------------------------------------------------------
// Initialization
// ------------------------------------------------------------
function init() {
    initScene();
    createPlayer();
    createSnowParticles();
    initInput();

    // Generate initial chunks around player
    updateChunks(0);

    // Position camera initially
    camera.position.set(0, getTerrainHeight(0, 0) + CONFIG.cameraHeight, CONFIG.cameraDistance);
    camera.lookAt(0, getTerrainHeight(0, 0), 0);

    // Hide loading after terrain is ready
    setTimeout(() => {
        const loading = document.getElementById('loading');
        if (loading) {
            loading.querySelector('p').textContent = 'Press any key to start';
        }
    }, 500);

    // Start animation loop
    animate();
}

// Boot up
init();
