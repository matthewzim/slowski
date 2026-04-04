/**
 * Snow Material System
 * Creates a groomed snow (corduroy) material with slope-aligned patterns
 * and subtle lighting variation.
 */

import * as THREE from 'three';

/**
 * Create the snow shader material with corduroy grooming pattern.
 */
export function createSnowMaterial() {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSunDirection: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      uSunColor: { value: new THREE.Color(1.0, 0.95, 0.9) },
      uAmbientColor: { value: new THREE.Color(0.55, 0.65, 0.85) },
      uSnowColor: { value: new THREE.Color(0.95, 0.97, 1.0) },
      uShadowColor: { value: new THREE.Color(0.65, 0.72, 0.88) },
      uFogColor: { value: new THREE.Color(0.82, 0.87, 0.95) },
      uFogNear: { value: 400.0 },
      uFogFar: { value: 1800.0 },
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      varying vec2 vUv;
      varying float vElevation;

      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        vUv = uv;
        vElevation = worldPos.y;

        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uSunDirection;
      uniform vec3 uSunColor;
      uniform vec3 uAmbientColor;
      uniform vec3 uSnowColor;
      uniform vec3 uShadowColor;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      uniform float uTime;

      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      varying vec2 vUv;
      varying float vElevation;

      // Hash for noise
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);

        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));

        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      void main() {
        vec3 normal = normalize(vWorldNormal);

        // -- Corduroy grooming pattern --
        // Align grooves with the slope direction (cross-slope)
        vec3 slopeDir = normalize(vec3(normal.x, 0.0, normal.z));
        vec3 crossSlope = normalize(cross(normal, slopeDir));

        // Project world position onto cross-slope direction for groove pattern
        float grooveCoord = dot(vWorldPosition, crossSlope);
        float groove = sin(grooveCoord * 8.0) * 0.5 + 0.5; // 0-1 wave
        groove = pow(groove, 0.6); // Sharpen the grooves

        // Subtle normal perturbation from grooves
        vec3 perturbedNormal = normalize(normal + crossSlope * cos(grooveCoord * 8.0) * 0.04);

        // -- Lighting --
        float NdotL = max(dot(perturbedNormal, uSunDirection), 0.0);

        // Soft wrap lighting for snow
        float wrapLight = NdotL * 0.7 + 0.3;

        // Specular (sun sparkle on snow)
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        vec3 halfDir = normalize(uSunDirection + viewDir);
        float spec = pow(max(dot(perturbedNormal, halfDir), 0.0), 80.0);
        float sparkle = noise(vWorldPosition.xz * 2.0) * spec * 0.5;

        // -- Color --
        // Base snow color with groove variation
        vec3 baseColor = mix(uSnowColor, uShadowColor, (1.0 - groove) * 0.15);

        // Add subtle warmth at higher elevation (sun exposure)
        float elevFactor = clamp((vElevation - 200.0) / 1500.0, 0.0, 1.0);
        baseColor = mix(baseColor, baseColor * vec3(1.02, 1.0, 0.98), elevFactor * 0.3);

        // Slope steepness affects color (steeper = more shadow)
        float steepness = 1.0 - normal.y;
        baseColor = mix(baseColor, uShadowColor, steepness * 0.3);

        // Fine-grain snow texture noise
        float fineNoise = noise(vWorldPosition.xz * 0.5) * 0.04;
        baseColor += fineNoise;

        // Combine lighting
        vec3 color = baseColor * (uAmbientColor * 0.5 + uSunColor * wrapLight * 0.7);
        color += sparkle * uSunColor;

        // -- Fog --
        float dist = length(cameraPosition - vWorldPosition);
        float fogFactor = clamp((dist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
        fogFactor = fogFactor * fogFactor;
        color = mix(color, uFogColor, fogFactor);

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });

  return material;
}

/**
 * Create falling snow particle system.
 */
export function createSnowParticles(scene) {
  const count = 3000;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);

  const spread = 200;

  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * spread;
    positions[i * 3 + 1] = Math.random() * 80;
    positions[i * 3 + 2] = (Math.random() - 0.5) * spread;

    velocities[i * 3] = (Math.random() - 0.5) * 0.5;
    velocities[i * 3 + 1] = -1.0 - Math.random() * 1.5;
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.5,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });

  const particles = new THREE.Points(geometry, material);
  particles.userData.velocities = velocities;
  particles.userData.spread = spread;

  return particles;
}

/**
 * Update snow particles (call each frame).
 */
export function updateSnowParticles(particles, playerPosition, deltaTime) {
  const positions = particles.geometry.attributes.position.array;
  const velocities = particles.userData.velocities;
  const spread = particles.userData.spread;
  const count = positions.length / 3;

  for (let i = 0; i < count; i++) {
    positions[i * 3] += velocities[i * 3] * deltaTime;
    positions[i * 3 + 1] += velocities[i * 3 + 1] * deltaTime;
    positions[i * 3 + 2] += velocities[i * 3 + 2] * deltaTime;

    // Reset particle if below ground or too far
    if (positions[i * 3 + 1] < -5) {
      positions[i * 3] = playerPosition.x + (Math.random() - 0.5) * spread;
      positions[i * 3 + 1] = playerPosition.y + 30 + Math.random() * 50;
      positions[i * 3 + 2] = playerPosition.z + (Math.random() - 0.5) * spread;
    }
  }

  // Center particles around player
  particles.position.set(0, 0, 0);
  particles.geometry.attributes.position.needsUpdate = true;
}

/**
 * Create spray particles for skiing.
 */
export function createSprayParticles() {
  const count = 200;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    positions[i * 3] = 0;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = 0;
    sizes[i] = 0;
    alphas[i] = 0;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.0,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const particles = new THREE.Points(geometry, material);
  particles.userData.lifetimes = new Float32Array(count);
  particles.userData.velocities = new Float32Array(count * 3);
  particles.userData.nextParticle = 0;

  return particles;
}

/**
 * Update spray particles based on player speed and position.
 */
export function updateSprayParticles(spray, playerPosition, playerHeading, speed, deltaTime) {
  const positions = spray.geometry.attributes.position.array;
  const lifetimes = spray.userData.lifetimes;
  const velocities = spray.userData.velocities;
  const count = positions.length / 3;

  // Emit new particles when moving fast
  if (speed > 3) {
    const emitRate = Math.min(speed * 2, 30);
    const emitCount = Math.floor(emitRate * deltaTime + Math.random());

    for (let e = 0; e < emitCount; e++) {
      const idx = spray.userData.nextParticle;
      spray.userData.nextParticle = (idx + 1) % count;

      // Emit behind player
      const behind = -1;
      const spread = 1.0;
      positions[idx * 3] = playerPosition.x + (Math.random() - 0.5) * spread - Math.sin(playerHeading) * behind;
      positions[idx * 3 + 1] = playerPosition.y + 0.3;
      positions[idx * 3 + 2] = playerPosition.z + (Math.random() - 0.5) * spread - Math.cos(playerHeading) * behind;

      velocities[idx * 3] = (Math.random() - 0.5) * 3 - Math.sin(playerHeading) * speed * 0.2;
      velocities[idx * 3 + 1] = 1 + Math.random() * 2;
      velocities[idx * 3 + 2] = (Math.random() - 0.5) * 3 - Math.cos(playerHeading) * speed * 0.2;

      lifetimes[idx] = 0.5 + Math.random() * 0.5;
    }
  }

  // Update existing particles
  for (let i = 0; i < count; i++) {
    if (lifetimes[i] > 0) {
      lifetimes[i] -= deltaTime;

      positions[i * 3] += velocities[i * 3] * deltaTime;
      positions[i * 3 + 1] += velocities[i * 3 + 1] * deltaTime;
      positions[i * 3 + 2] += velocities[i * 3 + 2] * deltaTime;

      // Gravity on spray
      velocities[i * 3 + 1] -= 5 * deltaTime;
    } else {
      // Hide dead particles
      positions[i * 3 + 1] = -1000;
    }
  }

  spray.geometry.attributes.position.needsUpdate = true;
}
