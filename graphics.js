import * as THREE from 'three';
import { Assets } from './assets.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD_HALF } from './map.js';

export const PLAYER_COLORS = [0xff2222, 0x22aaff, 0x22ff44, 0xffee22, 0xff8800, 0xcc22ff];

// ── Module state ──────────────────────────────────────────────────────────
let renderer, scene, camera;
let cameraYaw = 0;
let cameraZoom = 35;

export function scrollCamera(delta) {
  cameraZoom += delta * 0.05;
  if (cameraZoom < 5.0) {
    cameraZoom = 0; // snap to in-car
  } else if (cameraZoom > 100) {
    cameraZoom = 100;
  }
}
let cameraTarget = new THREE.Vector3();
const _tmpCamOffset = new THREE.Vector3();
const _tmpCamIdeal = new THREE.Vector3();
const _tmpCamUp = new THREE.Vector3(0, 1, 0);

const vehicleMeshes = {}; // peerId → { group, wheels[] }
const crateMeshes = {}; // crateIndex → mesh
let checkpointMeshes = [];
let finishLineMesh = null;
let finishBannerTime = 0;
const explosionParticles = [];
const rocketLightPool = [];
const ROCKET_LIGHT_COUNT = 8;
let cameraShake = 0;

let minimapCtx = null;
let minimapSpline = null;
let minimapBounds = null;
let minimapPoints = null;
let minimapOffscreenCanvas = null;
let raceGroup = new THREE.Group();

// ── Object Pooling ──────────────────────────────────────────────────────────
class Pool {
  constructor(createFn) {
    this.createFn = createFn;
    this.pool = [];
  }
  get() {
    if (this.pool.length > 0) {
      const obj = this.pool.pop();
      obj.visible = true;
      return obj;
    }
    return this.createFn();
  }
  release(obj) {
    obj.visible = false;
    this.pool.push(obj);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────
export function initGraphics(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false }); // pixelated look
  const isMobile = Math.min(window.innerWidth, window.innerHeight) < 800;
  renderer.setPixelRatio(isMobile ? 1.0 : Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  
  // Disable shadows entirely on mobile for massive GPU fillrate boost
  renderer.shadowMap.enabled = !isMobile;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x0077ff); // Fallback sky blue

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x1a9bff, 250, 800);

  smokeInstanced = new THREE.InstancedMesh(_smokeGeo, _smokeMat, MAX_PARTICLES);
  smokeInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  smokeInstanced.count = 0;
  scene.add(smokeInstanced);

  // Pre-instantiate rocket lights for pooling
  for (let i = 0; i < ROCKET_LIGHT_COUNT; i++) {
    const light = new THREE.PointLight(0xff6600, 0, 20);
    scene.add(light);
    rocketLightPool.push(light);
  }

  // Lights
  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(100, 200, 50);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 1024;
  sun.shadow.mapSize.height = 1024;
  sun.shadow.camera.left = -300;
  sun.shadow.camera.right = 300;
  sun.shadow.camera.top = 300;
  sun.shadow.camera.bottom = -300;
  sun.shadow.camera.far = 500;
  scene.add(sun);

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 2000);
  camera.position.set(0, 30, -50);

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });
}

// ── Minimap ────────────────────────────────────────────────────────────────
export function initMinimap(canvas, spline, mapBounds) {
  minimapCtx = canvas.getContext('2d');
  minimapSpline = spline;
  minimapBounds = mapBounds;
  minimapPoints = spline.getPoints(100);

  // Pre-draw the track to an offscreen canvas
  minimapOffscreenCanvas = document.createElement('canvas');
  minimapOffscreenCanvas.width = canvas.width;
  minimapOffscreenCanvas.height = canvas.height;
  const offCtx = minimapOffscreenCanvas.getContext('2d');
  
  offCtx.strokeStyle = 'rgba(255,255,255,0.3)';
  offCtx.lineWidth = 4;
  offCtx.beginPath();
  minimapPoints.forEach((p, i) => {
    const x = ((p.x - minimapBounds.minX) / (minimapBounds.maxX - minimapBounds.minX)) * canvas.width;
    const z = ((p.z - minimapBounds.minZ) / (minimapBounds.maxZ - minimapBounds.minZ)) * canvas.height;
    if (i === 0) offCtx.moveTo(x, z);
    else offCtx.lineTo(x, z);
  });
  offCtx.stroke();
}

export function updateMinimap(players, localPlayer) {
  if (!minimapCtx || !minimapSpline) return;

  const ctx = minimapCtx;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Draw track from offscreen canvas
  if (minimapOffscreenCanvas) {
    ctx.drawImage(minimapOffscreenCanvas, 0, 0);
  }

  // Draw players
  for (const id in players) {
    const p = players[id];
    const isLocal = p.isLocal;
    const x = ((p.position.x - minimapBounds.minX) / (minimapBounds.maxX - minimapBounds.minX)) * w;
    const z = ((p.position.z - minimapBounds.minZ) / (minimapBounds.maxZ - minimapBounds.minZ)) * h;

    ctx.fillStyle = isLocal ? '#ffff00' : PLAYER_COLORS[p.colorIndex % PLAYER_COLORS.length];
    ctx.beginPath();
    ctx.arc(x, z, isLocal ? 4 : 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Environment ────────────────────────────────────────────────────────────
export function buildRaceMap(mapData, sceneRef = scene) {
  // Clear old
  sceneRef.remove(raceGroup);
  raceGroup = new THREE.Group();
  sceneRef.add(raceGroup);

  // Road, walls, ground — generateMap returns actual Mesh objects
  if (mapData.trackMesh) {
    mapData.trackMesh.receiveShadow = true;
    raceGroup.add(mapData.trackMesh);
  }
  if (mapData.wallMeshes) {
    mapData.wallMeshes.forEach(m => raceGroup.add(m));
  }
  if (mapData.groundMesh) {
    raceGroup.add(mapData.groundMesh);
  }

  // Helper for 90's style rally arches
  const pillarGeo = new THREE.CylinderGeometry(0.25, 0.25, 14, 8); // Thinner poles
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0xcc2222, metalness: 0.3, roughness: 0.8 });
  
  // Wavy banner geometry
  const cpBannerGeo = new THREE.PlaneGeometry(ROAD_HALF * 2 + 4, 3, 20, 1);
  const pos = cpBannerGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setZ(i, Math.sin(x * 1.5) * 0.4);
  }
  cpBannerGeo.computeVertexNormals();

  const cpBannerMat = new THREE.MeshStandardMaterial({ color: 0xffcc00, side: THREE.DoubleSide });

  let checkeredTex = null;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillRect(64, 64, 64, 64);
    checkeredTex = new THREE.CanvasTexture(canvas);
    checkeredTex.wrapS = THREE.RepeatWrapping;
    checkeredTex.wrapT = THREE.RepeatWrapping;
    checkeredTex.repeat.set(6, 1);
    checkeredTex.magFilter = THREE.NearestFilter;
  }
  const finishBannerMat = new THREE.MeshStandardMaterial({ map: checkeredTex, color: 0xffffff, side: THREE.DoubleSide });

  function createArch(position, tangent, bannerMat) {
    const group = new THREE.Group();
    // Pillars
    const leftPillar = new THREE.Mesh(pillarGeo, pillarMat);
    leftPillar.position.set(-ROAD_HALF - 1.5, 7, 0);
    leftPillar.castShadow = true;
    const rightPillar = new THREE.Mesh(pillarGeo, pillarMat);
    rightPillar.position.set(ROAD_HALF + 1.5, 7, 0);
    rightPillar.castShadow = true;
    // Banner
    const banner = new THREE.Mesh(cpBannerGeo, bannerMat.clone());
    banner.position.set(0, 12.5, 0);
    banner.castShadow = true;
    
    group.add(leftPillar);
    group.add(rightPillar);
    group.add(banner);
    group.userData.bannerMesh = banner;
    
    group.position.copy(position);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
    return group;
  }

  // Checkpoints (Archways)
  checkpointMeshes = [];
  mapData.checkpoints.forEach((cp, index) => {
    // Skip rendering the last checkpoint arch to prevent overlap with the finish line arch
    if (index === mapData.checkpoints.length - 1) {
      const emptyGroup = new THREE.Group();
      raceGroup.add(emptyGroup);
      checkpointMeshes.push(emptyGroup);
    } else {
      const arch = createArch(cp.position, cp.tangent, cpBannerMat);
      raceGroup.add(arch);
      checkpointMeshes.push(arch);
    }
  });

  // Finish Line Arch
  if (mapData.finishLinePt && mapData.finishTangent) {
    finishLineMesh = createArch(mapData.finishLinePt, mapData.finishTangent, finishBannerMat);
    // Slightly adjust finish line forward so it's placed exactly on the start/finish mark
    finishLineMesh.position.add(mapData.finishTangent.clone().multiplyScalar(2));
    raceGroup.add(finishLineMesh);
  }

  // Weapon crate meshes
  if (mapData.weaponCrateSpawns) {
    mapData.weaponCrateSpawns.forEach((crate, i) => {
      createCrateMesh(i, crate.type, crate.position);
    });
  }

  // Minimap
  const minimapCanvas = document.getElementById('minimap-canvas');
  if (minimapCanvas && mapData.spline) {
    const pts = mapData.spline.getPoints(200);
    const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    pts.forEach(p => {
      bounds.minX = Math.min(bounds.minX, p.x);
      bounds.maxX = Math.max(bounds.maxX, p.x);
      bounds.minZ = Math.min(bounds.minZ, p.z);
      bounds.maxZ = Math.max(bounds.maxZ, p.z);
    });
    // Add padding
    const pad = 20;
    bounds.minX -= pad; bounds.maxX += pad;
    bounds.minZ -= pad; bounds.maxZ += pad;
    initMinimap(minimapCanvas, mapData.spline, bounds);
  }

  // Pre-compile shaders to prevent stuttering when particle effects appear
  if (smokeInstanced) smokeInstanced.count = 1;
  renderer.compile(scene, camera);
  if (smokeInstanced) smokeInstanced.count = 0;
}

export function updateCheckpoints(passedCount) {
  checkpointMeshes.forEach((mesh, i) => {
    mesh.visible = i >= passedCount && i < passedCount + 3;
  });
}

export function createCrateMesh(index, type, position) {
  const geo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
  const colors = { ROCKET: 0xff2222, OIL_SLICK: 0x222222, BOOST: 0x22ff44 };
  const mat = new THREE.MeshStandardMaterial({ color: colors[type] || 0x888888, flatShading: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(position);
  mesh.castShadow = true;
  scene.add(mesh);
  crateMeshes[index] = mesh;
  return mesh;
}

export function updateCrates(respawnData) {
  Object.entries(crateMeshes).forEach(([idx, mesh]) => {
    mesh.visible = !respawnData[idx];
  });
}

export function flashVehicle(peerId) {
  const mesh = vehicleMeshes[peerId];
  if (!mesh) return;
  mesh.group.traverse(child => {
    if (child.material) {
      const orig = child.material.emissiveIntensity || 0;
      child.material.emissiveIntensity = 2.0;
      setTimeout(() => {
        child.material.emissiveIntensity = orig;
      }, 400);
    }
  });
}

// ── Vehicle Meshes ─────────────────────────────────────────────────────────
const loadedModelsCache = {};

export class CarPreview {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, canvas.width / canvas.height, 0.1, 100);
    this.camera.position.set(3.5, 2.5, -4);
    this.camera.lookAt(0, 0.5, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(5, 10, 5);
    this.scene.add(dirLight);

    this.carGroup = new THREE.Group();
    this.scene.add(this.carGroup);

    this.animate = this.animate.bind(this);
    this.animationId = null;
    this.isRunning = false;
  }
  
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.animate();
  }
  
  stop() {
    this.isRunning = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  animate() {
    if (!this.isRunning) return;
    this.animationId = requestAnimationFrame(this.animate);
    this.carGroup.rotation.y += 0.015;
    this.renderer.render(this.scene, this.camera);
  }

  async setCar(modelName) {
    while (this.carGroup.children.length > 0) {
      this.carGroup.remove(this.carGroup.children[0]);
    }
    const { mesh } = await loadCarModelGltf(modelName);
    if (mesh) {
      const wrapper = new THREE.Group();
      wrapper.add(mesh);
      wrapper.position.y += 0.45;
      this.carGroup.add(wrapper);
    }
  }

  destroy() {
    cancelAnimationFrame(this.animationId);
    this.renderer.dispose();
  }
}

export function createCarPreview(canvas) {
  return new CarPreview(canvas);
}

async function loadCarModelGltf(modelName) {
  if (loadedModelsCache[modelName]) {
    const cached = loadedModelsCache[modelName];
    return { mesh: cached.mesh.clone(), dims: cached.dims };
  }

  const gltf = await Assets.loadModel(`objects/${modelName}.glb`);
  const innerMesh = gltf.scene;

  if (modelName === 'dacia_duster_low_poly') {
    innerMesh.rotation.y = -Math.PI / 2;
  } else {
    innerMesh.rotation.y = 0;
  }

  const object = new THREE.Group();
  object.add(innerMesh);
  object.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const scale = 3.6 / size.z;
  object.scale.set(scale, scale, scale);

  const center = box.getCenter(new THREE.Vector3());
  const bottomY = box.min.y;
  object.position.set(-center.x * scale, -bottomY * scale - 0.42, -center.z * scale);
  object.updateMatrixWorld(true);

  // Merge into a single mesh for massive draw call reduction
  const geometriesByMaterial = new Map();
  object.traverse(child => {
    if (child.isMesh && child.geometry) {
      const geo = child.geometry.clone();
      geo.applyMatrix4(child.matrixWorld);

      // Strip unused attributes to prevent mergeGeometries from failing
      const validAttributes = ['position', 'normal', 'uv'];
      for (const key in geo.attributes) {
        if (!validAttributes.includes(key)) {
          geo.deleteAttribute(key);
        }
      }
      
      // Ensure missing essential attributes are populated
      if (!geo.attributes.normal) geo.computeVertexNormals();
      if (!geo.attributes.uv) {
        geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      }

      // Remove existing groups to avoid mergeGeometries confusion
      geo.groups = [];
      
      const mat = child.material;
      if (mat) {
        if (Array.isArray(mat)) {
          mat.forEach(m => m.side = THREE.DoubleSide);
        } else {
          mat.side = THREE.DoubleSide;
        }
      }
      if (!geometriesByMaterial.has(mat)) {
        geometriesByMaterial.set(mat, []);
      }
      geometriesByMaterial.get(mat).push(geo);
    }
  });

  const finalGeometries = [];
  const materials = [];
  
  let mergeFailed = false;
  for (const [mat, geoms] of geometriesByMaterial.entries()) {
    // Merge all geometries that share this material into a single geometry!
    // useGroups = false because they all share the same material
    const mergedForMat = mergeGeometries(geoms, false);
    if (mergedForMat) {
      finalGeometries.push(mergedForMat);
      materials.push(mat);
    } else {
      mergeFailed = true;
      break;
    }
  }

  const wrapper = new THREE.Group();
  if (!mergeFailed && finalGeometries.length > 0) {
    // Merge the material-specific geometries into one final geometry!
    // useGroups = true so each material gets its own group!
    const mergedGeo = mergeGeometries(finalGeometries, true);
    if (mergedGeo) {
      const mergedMesh = new THREE.Mesh(mergedGeo, materials);
      mergedMesh.castShadow = true;
      mergedMesh.receiveShadow = true;
      wrapper.add(mergedMesh);
    } else {
      object.traverse(child => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      wrapper.add(object);
    }
  } else {
    object.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    wrapper.add(object);
  }

  const dims = { width: size.x * scale, length: size.z * scale };
  loadedModelsCache[modelName] = { mesh: wrapper, dims };
  return { mesh: wrapper.clone(), dims };
}

export async function loadVehicle(peerId, colorIndex, modelName) {
  if (vehicleMeshes[peerId]) {
    scene.remove(vehicleMeshes[peerId].group);
  }
  let group;

  try {
    const { mesh, dims } = await loadCarModelGltf(modelName);
    group = mesh;

    import('./physics.js').then(Physics => {
      Physics.setVehicleHitbox(peerId, dims.width, 0.9, dims.length);
    });
    // Merged geometry already casts/receives shadows
  } catch (e) {
    console.error('Failed to load vehicle', modelName, e);
    const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];
    group = _buildFallbackCar(color);
  }

  scene.add(group);
  vehicleMeshes[peerId] = { group, wheels: [] };
  return group;
}

function _buildFallbackCar(color) {
  const grp = new THREE.Group();
  const container = new THREE.Group();

  const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.9, 3.6), mat);
  body.position.y = 0;
  container.add(body);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.65, 1.8),
    new THREE.MeshLambertMaterial({ color: 0x222222, flatShading: true })
  );
  cabin.position.set(0, 0.7, -0.2);
  container.add(cabin);
  
  container.updateMatrixWorld(true);
  const geometriesByMaterial = new Map();

  container.traverse(child => {
    if (child.isMesh && child.geometry) {
      const geo = child.geometry.clone();
      geo.applyMatrix4(child.matrixWorld);
      
      const mat = child.material;
      if (!geometriesByMaterial.has(mat)) geometriesByMaterial.set(mat, []);
      geometriesByMaterial.get(mat).push(geo);
    }
  });

  const wGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.4, 8);
  wGeo.rotateZ(Math.PI / 2);
  const wMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
  [
    [-1.1, -1.5],
    [1.1, -1.5],
    [-1.1, 1.5],
    [1.1, 1.5],
  ].forEach(([x, z]) => {
    const w = new THREE.Mesh(wGeo, wMat);
    w.position.set(x, 0.38, z);
    w.updateMatrixWorld(true);
    const geo = w.geometry.clone();
    geo.applyMatrix4(w.matrixWorld);
    
    if (!geometriesByMaterial.has(wMat)) geometriesByMaterial.set(wMat, []);
    geometriesByMaterial.get(wMat).push(geo);
  });

  const finalGeometries = [];
  const materials = [];
  
  let mergeFailed = false;
  for (const [mat, geoms] of geometriesByMaterial.entries()) {
    const mergedForMat = mergeGeometries(geoms, false);
    if (mergedForMat) {
      finalGeometries.push(mergedForMat);
      materials.push(mat);
    } else {
      mergeFailed = true;
      break;
    }
  }

  if (!mergeFailed && finalGeometries.length > 0) {
    const mergedGeo = mergeGeometries(finalGeometries, true);
    if (mergedGeo) {
      const mergedMesh = new THREE.Mesh(mergedGeo, materials);
      mergedMesh.castShadow = true;
      mergedMesh.receiveShadow = true;
      grp.add(mergedMesh);
    } else {
      container.traverse(child => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      grp.add(container);
    }
  } else {
    container.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    grp.add(container);
  }

  return grp;
}

export function updateVehicleMesh(peerId, position, quaternion) {
  const entry = vehicleMeshes[peerId];
  if (!entry) return;
  const { group } = entry;
  group.position.set(position.x, position.y, position.z);
  group.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
}

export function removeVehicleMesh(peerId) {
  if (vehicleMeshes[peerId]) {
    scene.remove(vehicleMeshes[peerId].group);
    delete vehicleMeshes[peerId];
  }
}

// ── Rocket Projectile ───────────────────────────────────────────────────────
const rocketBodyGeo = new THREE.CylinderGeometry(0.25, 0.25, 1.2, 8);
rocketBodyGeo.rotateX(Math.PI / 2);
const rocketBodyMat = new THREE.MeshStandardMaterial({
  color: 0xff0000,
  emissive: 0xff0000,
  emissiveIntensity: 1.5,
  flatShading: true,
});

const rocketNoseGeo = new THREE.ConeGeometry(0.25, 0.5, 8);
rocketNoseGeo.rotateX(Math.PI / 2);
rocketNoseGeo.translate(0, 0, -0.85);
const rocketNoseMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xffffff,
  emissiveIntensity: 1.5,
  flatShading: true,
});

const rocketFinGeo = new THREE.BoxGeometry(0.06, 0.4, 0.4);
const rocketFinMat = new THREE.MeshStandardMaterial({ color: 0x222222, flatShading: true });

function _createRawRocketMesh() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(rocketBodyGeo, rocketBodyMat);
  body.castShadow = true;
  group.add(body);
  const nose = new THREE.Mesh(rocketNoseGeo, rocketNoseMat);
  nose.castShadow = true;
  group.add(nose);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(rocketFinGeo, rocketFinMat);
    const angle = (i * Math.PI) / 2;
    fin.position.set(Math.cos(angle) * 0.25, Math.sin(angle) * 0.25, 0.4);
    fin.rotation.z = angle;
    group.add(fin);
  }
  return group;
}

const rocketPool = new Pool(_createRawRocketMesh);

export function createRocketMesh() {
  const mesh = rocketPool.get();
  if (rocketLightPool.length > 0) {
    const light = rocketLightPool.pop();
    light.intensity = 80;
    light.position.set(0, 0, 0.8);
    mesh.add(light);
    mesh.userData.poolLight = light;
  }
  scene.add(mesh);
  return mesh;
}

const _tmpRocketTarget = new THREE.Vector3();

export function updateRocketMesh(mesh, pos, vel, dt) {
  mesh.position.set(pos.x, pos.y, pos.z);
  if (vel.length() > 0.1) {
    _tmpRocketTarget.set(pos.x + vel.x, pos.y + vel.y, pos.z + vel.z);
    mesh.lookAt(_tmpRocketTarget);
  }

  mesh.userData.smokeTimer = (mesh.userData.smokeTimer || 0) + dt;
  if (mesh.userData.smokeTimer > 0.05) {
    mesh.userData.smokeTimer = 0;
    _spawnSmoke(pos);
  }
}

const MAX_PARTICLES = 300;
const _dummy = new THREE.Object3D();

const _smokeGeo = new THREE.SphereGeometry(0.2, 4, 4);
const _smokeMat = new THREE.MeshBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.6 });
let smokeInstanced;

function _getFreeParticle() {
  let ep = explosionParticles.find(p => p.life <= 0);
  if (!ep) {
    ep = { pos: new THREE.Vector3() };
    explosionParticles.push(ep);
  }
  return ep;
}

function _spawnSmoke(pos) {
  const ep = _getFreeParticle();
  ep.type = 'smoke';
  ep.life = 0.6;
  ep.maxLife = 0.6;
  ep.pos.copy(pos);
  ep.scale = 0.75 + Math.random() * 0.5;
  ep.mesh = null;
}

export function removeMesh(mesh) {
  if (mesh && mesh.parent) {
    if (mesh.userData.poolLight) {
      const light = mesh.userData.poolLight;
      light.intensity = 0;
      scene.add(light);
      rocketLightPool.push(light);
      mesh.userData.poolLight = null;
    }
    mesh.parent.remove(mesh);
    if (mesh.userData.poolLight !== undefined) {
      rocketPool.release(mesh);
    }
  }
}

// ── Explosion effect ────────────────────────────────────────────────────────
const explosionMat = new THREE.MeshBasicMaterial({
  color: 0xff6600,
  transparent: true,
  depthTest: false,
});
let explosionTemplateGeo = null;

(function buildExplosionGeo() {
  const count = 20;
  const geoArr = [];
  for (let i = 0; i < count; i++) {
    const g = new THREE.SphereGeometry(Math.random() * 0.8 + 0.2, 4, 4);
    g.translate(
      (Math.random() - 0.5) * 1.5,
      (Math.random() - 0.5) * 1.5,
      (Math.random() - 0.5) * 1.5
    );
    geoArr.push(g);
  }
  explosionTemplateGeo = mergeGeometries(geoArr);
})();

const explosionPool = new Pool(() => new THREE.Mesh(explosionTemplateGeo, explosionMat));

export function spawnExplosion(pos) {
  const mesh = explosionPool.get();
  mesh.position.copy(pos);
  mesh.scale.setScalar(0.1);
  scene.add(mesh);
  
  const ep = _getFreeParticle();
  ep.type = 'explosion';
  ep.life = 0.8;
  ep.maxLife = 0.8;
  ep.pos.copy(pos);
  ep.mesh = mesh;
}

export function createOilSlickMesh(position, quaternion) {
  const geo = new THREE.CircleGeometry(3.0, 32);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.9 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(position.x, position.y, position.z);
  if (quaternion) {
    mesh.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  }
  scene.add(mesh);
  return mesh;
}

export function setCameraShake(amount) {
  cameraShake = Math.max(cameraShake, amount);
}

const _tmpFwd = new THREE.Vector3();

export function updateCamera(targetPos, carQuat, dt) {
  cameraTarget.copy(targetPos);

  // Extract pure forward vector on the XZ plane
  _tmpFwd.set(0, 0, 1).applyQuaternion(carQuat);
  _tmpFwd.y = 0; // Flatten to prevent camera from pitching up/down
  if (_tmpFwd.lengthSq() > 0.0001) {
    _tmpFwd.normalize();
  } else {
    _tmpFwd.set(0, 0, 1); // Fallback
  }

  if (cameraZoom === 0) {
    // In-car view
    _tmpCamIdeal.copy(cameraTarget);
    // Approximate driver position (left side, eye level lowered, middle of cabin moved further back)
    const driverOffset = new THREE.Vector3(0.28, 0.20, -0.57);
    driverOffset.applyQuaternion(carQuat);
    _tmpCamIdeal.add(driverOffset);
    
    camera.position.copy(_tmpCamIdeal);
    
    // Look ahead
    const lookOffset = new THREE.Vector3(0, 0.8, 10);
    lookOffset.applyQuaternion(carQuat);
    camera.lookAt(cameraTarget.x + lookOffset.x, cameraTarget.y + lookOffset.y, cameraTarget.z + lookOffset.z);
  } else {
    const hFactor = 0.15 + (cameraZoom / 60) * 0.62;
    const heightOffset = cameraZoom * hFactor;
    const backOffset = cameraZoom * 0.6;

    // Position camera behind and above
    _tmpCamIdeal.copy(cameraTarget);
    _tmpCamIdeal.addScaledVector(_tmpFwd, -backOffset);
    _tmpCamIdeal.y += heightOffset;

    camera.position.copy(_tmpCamIdeal);
    
    // Look at the car (slightly above it, tilted more upwards when zoomed closer)
    const lookAtY = cameraTarget.y + 1.0 + (1.0 - (cameraZoom / 100)) * 1.0;
    camera.lookAt(cameraTarget.x, lookAtY, cameraTarget.z);
  }

  if (cameraShake > 0.01) {
    camera.position.x += (Math.random() - 0.5) * cameraShake;
    camera.position.y += (Math.random() - 0.5) * cameraShake;
    camera.position.z += (Math.random() - 0.5) * cameraShake;
    cameraShake *= 1 - Math.exp(-10 * dt);
  }
}

export function renderScene(dt) {
  finishBannerTime += dt;

  Object.values(crateMeshes).forEach(mesh => {
    if (mesh.visible) {
      mesh.rotation.y += dt * 1.5;
      mesh.position.y = (mesh.userData.baseY = mesh.userData.baseY || mesh.position.y) +
        Math.sin(finishBannerTime * 2 + mesh.position.x) * 0.12;
    }
  });

  let smokeIdx = 0;

  for (let i = 0; i < explosionParticles.length; i++) {
    const ep = explosionParticles[i];
    if (ep.life <= 0) continue;

    ep.life -= dt;
    if (ep.life <= 0) {
      if (ep.type === 'explosion' && ep.mesh) {
        scene.remove(ep.mesh);
        explosionPool.release(ep.mesh);
        ep.mesh = null;
      }
      continue;
    }
    
    const t = 1.0 - ep.life / ep.maxLife;
    if (ep.type === 'explosion' && ep.mesh) {
      const scale = 0.1 + t * 2.0;
      ep.mesh.scale.setScalar(scale);
      ep.mesh.position.y += dt * 0.5;
    } else if (ep.type === 'smoke') {
      if (smokeIdx < MAX_PARTICLES && smokeInstanced) {
        _dummy.position.copy(ep.pos);
        _dummy.position.y += dt * 1.5;
        ep.pos.copy(_dummy.position);
        const scale = ep.scale * (1.0 + t * 1.5);
        _dummy.scale.setScalar(scale);
        _dummy.updateMatrix();
        smokeInstanced.setMatrixAt(smokeIdx++, _dummy.matrix);
      }
    }
  }

  if (smokeInstanced) {
    smokeInstanced.count = smokeIdx;
    smokeInstanced.instanceMatrix.needsUpdate = true;
  }

  renderer.render(scene, camera);
}

export function getCamera() {
  return camera;
}

export function updateIntroCamera(targetPos, progress) {
  // Sync internal target so the transition to driving cam is smooth
  cameraTarget.copy(targetPos);

  // Aerial view: starts high and orbits slowly towards the car
  const angle = progress * Math.PI * 0.25; // 45 degree slow orbit
  const radius = 80 - progress * 40; // Zoom in from 80 to 40
  const height = 100 - progress * 80; // Drop from 100 to 20

  const offset = new THREE.Vector3(Math.cos(angle) * radius, height, Math.sin(angle) * radius);

  camera.position.copy(targetPos).add(offset);
  camera.lookAt(cameraTarget);
}

/**
 * Instantly snaps camera to a position (useful for race start)
 */
export function snapCamera(targetPos, carQuat) {
  cameraTarget.copy(targetPos);
  
  _tmpFwd.set(0, 0, 1).applyQuaternion(carQuat);
  _tmpFwd.y = 0;
  if (_tmpFwd.lengthSq() > 0.0001) {
    _tmpFwd.normalize();
  } else {
    _tmpFwd.set(0, 0, 1);
  }

  if (cameraZoom === 0) {
    // In-car view snap
    const driverOffset = new THREE.Vector3(0.28, 0.20, -0.57);
    driverOffset.applyQuaternion(carQuat);
    camera.position.copy(targetPos).add(driverOffset);
    
    const lookOffset = new THREE.Vector3(0, 0.8, 10);
    lookOffset.applyQuaternion(carQuat);
    camera.lookAt(targetPos.x + lookOffset.x, targetPos.y + lookOffset.y, targetPos.z + lookOffset.z);
  } else {
    const hFactor = 0.15 + (cameraZoom / 60) * 0.62;
    const heightOffset = cameraZoom * hFactor;
    const backOffset = cameraZoom * 0.6;

    camera.position.copy(targetPos);
    camera.position.addScaledVector(_tmpFwd, -backOffset);
    camera.position.y += heightOffset;
    
    const lookAtY = cameraTarget.y + 1.0 + (1.0 - (cameraZoom / 100)) * 1.0;
    camera.lookAt(cameraTarget.x, lookAtY, cameraTarget.z);
  }
}

export function getScreenPosition(pos3d) {
  if (!camera) return null;
  const v = new THREE.Vector3(pos3d.x, pos3d.y, pos3d.z);
  v.project(camera);
  return {
    x: (v.x * 0.5 + 0.5) * window.innerWidth,
    y: (-(v.y * 0.5) + 0.5) * window.innerHeight,
    z: v.z,
  };
}

export function flashCheckpoint(index) {
  const group = checkpointMeshes[index];
  if (!group || !group.userData.bannerMesh) return;
  const banner = group.userData.bannerMesh;
  const origColor = banner.material.color.getHex();
  banner.material.color.setHex(0xffffff); // Flash bright white
  setTimeout(() => {
    banner.material.color.setHex(origColor);
  }, 400);
}

export function updateCrateMesh(index, active) {
  const mesh = crateMeshes[index];
  if (mesh) {
    mesh.visible = active;
  }
}

export function spawnFinishBurst(position) {
  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      const offset = new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        1.0 + Math.random() * 4,
        (Math.random() - 0.5) * 6
      );
      const pos = new THREE.Vector3(position.x, position.y, position.z).add(offset);
      spawnExplosion(pos);
    }, i * 200);
  }
}

export function clearRaceScene() {
  if (raceGroup) {
    scene.remove(raceGroup);
    raceGroup = new THREE.Group();
  }
  Object.values(vehicleMeshes).forEach(entry => scene.remove(entry.group));
  for (const id in vehicleMeshes) delete vehicleMeshes[id];
  Object.values(crateMeshes).forEach(mesh => scene.remove(mesh));
  for (const key in crateMeshes) delete crateMeshes[key];
  checkpointMeshes = [];
  finishLineMesh = null;
  if (minimapCtx) {
    minimapCtx.clearRect(0, 0, minimapCtx.canvas.width, minimapCtx.canvas.height);
  }
}


