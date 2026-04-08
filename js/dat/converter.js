/**
 * Converter: parsed model/texture data → Three.js objects.
 */
import * as THREE from 'three';

/**
 * Convert parsed models and textures to a Three.js Group.
 * @param {import('./mdl0.js').ParsedModel[]} models
 * @param {import('./tex0.js').ParsedTexture[]} textures
 * @param {THREE.Material} [fallbackMaterial] - used if no textures
 * @returns {THREE.Group}
 */
export function convertToThreeJS(models, textures, fallbackMaterial) {
  const group = new THREE.Group();

  // Build texture map by name
  const textureMap = new Map();
  for (const tex of textures) {
    const threeTex = createDataTexture(tex);
    textureMap.set(tex.name, threeTex);
    // Also register without extension
    const baseName = tex.name.replace(/\.\w+$/, '');
    textureMap.set(baseName, threeTex);
  }

  for (const model of models) {
    if (!model || model.vertices.length === 0) continue;

    const geometry = new THREE.BufferGeometry();

    // Position attribute
    geometry.setAttribute('position', new THREE.BufferAttribute(model.vertices, 3));

    // Normal attribute
    if (model.normals.length === model.vertices.length) {
      geometry.setAttribute('normal', new THREE.BufferAttribute(model.normals, 3));
    } else {
      geometry.computeVertexNormals();
    }

    // UV attribute
    if (model.uvs.length > 0) {
      geometry.setAttribute('uv', new THREE.BufferAttribute(model.uvs, 2));
    }

    // Index buffer
    if (model.indices.length > 0) {
      geometry.setIndex(new THREE.BufferAttribute(model.indices, 1));
    }

    // Material
    let material;

    // Try to find a matching texture
    const texRef = model.textureRefs && model.textureRefs.length > 0 ? model.textureRefs[0] : null;
    const matchedTex = texRef ? (textureMap.get(texRef) || textureMap.get(texRef.replace(/\.\w+$/, ''))) : null;

    if (matchedTex) {
      material = new THREE.MeshStandardMaterial({
        map: matchedTex,
        side: THREE.DoubleSide,
        roughness: 0.8,
        metalness: 0.0,
      });
    } else if (textures.length > 0) {
      // Use first available texture as fallback
      const firstTex = textureMap.values().next().value;
      material = new THREE.MeshStandardMaterial({
        map: firstTex,
        side: THREE.DoubleSide,
        roughness: 0.8,
        metalness: 0.0,
      });
    } else if (fallbackMaterial) {
      material = fallbackMaterial;
    } else {
      material = new THREE.MeshStandardMaterial({
        color: 0xcccccc,
        side: THREE.DoubleSide,
        roughness: 0.8,
        metalness: 0.0,
      });
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = model.name || 'mesh';

    group.add(mesh);
  }

  return group;
}

/**
 * Create a Three.js DataTexture from parsed texture data.
 */
function createDataTexture(parsedTex) {
  const { width, height, pixels } = parsedTex;
  const texture = new THREE.DataTexture(
    pixels,
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  );
  texture.needsUpdate = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.name = parsedTex.name;
  return texture;
}

/**
 * Scale and position a terrain group to fit world dimensions.
 * @param {THREE.Group} group
 * @param {Object} config - { worldWidth, worldDepth, minElevation, maxElevation }
 * @returns {THREE.Group} the same group, mutated
 */
export function scaleToWorld(group, config) {
  // Compute bounding box
  const box = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);

  if (size.x === 0 || size.z === 0) {
    console.warn('Terrain group has zero extent in X or Z');
    return group;
  }

  // Scale to fit world dimensions
  const scaleX = config.worldWidth / size.x;
  const scaleZ = config.worldDepth / size.z;
  const scaleXZ = Math.min(scaleX, scaleZ); // uniform XZ scale

  const elevRange = config.maxElevation - config.minElevation;
  const scaleY = elevRange / (size.y || 1);

  group.scale.set(scaleXZ, scaleY, scaleXZ);

  // Re-center
  group.updateMatrixWorld(true);
  const newBox = new THREE.Box3().setFromObject(group);
  const newCenter = new THREE.Vector3();
  newBox.getCenter(newCenter);

  group.position.x -= newCenter.x;
  group.position.z -= newCenter.z;
  group.position.y -= newBox.min.y; // base at y=0

  group.updateMatrixWorld(true);
  return group;
}
