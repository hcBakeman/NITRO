import * as THREE from 'three';
import { Assets } from './assets.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD_HALF } from './map.js';

export const PLAYER_COLORS = [0xff2222, 0x22aaff, 0x22ff44, 0xffee22, 0xff8800, 0xcc22ff];

// ── Module state ──────────────────────────────────────────────────────────
let renderer, scene, camera;
let cameraYaw = 0;
let cameraZoom = 35;
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x0077ff); // Fallback sky blue

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x1a9bff, 250, 800);

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
}

export function updateMinimap(players, localPlayer) {
  if (!minimapCtx || !minimapSpline) return;

  const ctx = minimapCtx;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Draw track
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  minimapPoints.forEach((p, i) => {
    const x = ((p.x - minimapBounds.minX) / (minimapBounds.maxX - minimapBounds.minX)) * w;
    const z = ((p.z - minimapBounds.minZ) / (minimapBounds.maxZ - minimapBounds.minZ)) * h;
    if (i === 0) ctx.moveTo(x, z);
    else ctx.lineTo(x, z);
  });
  ctx.stroke();

  // Draw players
  Object.entries(players).forEach(([id, p]) => {
    const isLocal = p.isLocal;
    const x = ((p.position.x - minimapBounds.minX) / (minimapBounds.maxX - minimapBounds.minX)) * w;
    const z = ((p.position.z - minimapBounds.minZ) / (minimapBounds.maxZ - minimapBounds.minZ)) * h;

    ctx.fillStyle = isLocal ? '#ffff00' : PLAYER_COLORS[p.colorIndex % PLAYER_COLORS.length];
    ctx.beginPath();
    ctx.arc(x, z, isLocal ? 4 : 3, 0, Math.PI * 2);
    ctx.fill();
  });
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

  const dims = { width: size.x * scale, length: size.z * scale };
  const wrapper = new THREE.Group();
  wrapper.add(object);
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

    group.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
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
  grp.add(container);

  const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.9, 3.6), mat);
  body.position.y = 0;
  body.castShadow = true;
  container.add(body);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.65, 1.8),
    new THREE.MeshLambertMaterial({ color: 0x222222, flatShading: true })
  );
  cabin.position.set(0, 0.7, -0.2);
  container.add(cabin);

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
    w.castShadow = true;
    container.add(w);
  });
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

export function updateRocketMesh(mesh, pos, vel, dt) {
  mesh.position.set(pos.x, pos.y, pos.z);
  if (vel.length() > 0.1) {
    const target = new THREE.Vector3(pos.x + vel.x, pos.y + vel.y, pos.z + vel.z);
    mesh.lookAt(target);
  }

  mesh.userData.smokeTimer = (mesh.userData.smokeTimer || 0) + dt;
  if (mesh.userData.smokeTimer > 0.05) {
    mesh.userData.smokeTimer = 0;
    _spawnSmoke(pos);
  }
}

const _smokeGeo = new THREE.SphereGeometry(0.2, 4, 4);
const _smokeMat = new THREE.MeshBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.6 });
const smokePool = new Pool(() => new THREE.Mesh(_smokeGeo, _smokeMat));

function _spawnSmoke(pos) {
  const mesh = smokePool.get();
  mesh.position.set(pos.x, pos.y, pos.z);
  mesh.userData.baseScale = 0.75 + Math.random() * 0.5;
  mesh.scale.setScalar(mesh.userData.baseScale);
  scene.add(mesh);
  explosionParticles.push({ mesh, type: 'smoke', life: 0.6, maxLife: 0.6 });
}

const _tireSmokeGeo = new THREE.SphereGeometry(0.15, 4, 4);
const _tireSmokeMat = new THREE.MeshBasicMaterial({
  color: 0xdddddd,
  transparent: true,
  opacity: 0.4,
});
const tireSmokePool = new Pool(() => new THREE.Mesh(_tireSmokeGeo, _tireSmokeMat.clone()));

export function spawnTireSmoke(pos) {
  const mesh = tireSmokePool.get();
  mesh.position.copy(pos);
  mesh.scale.setScalar(0.8 + Math.random() * 0.4);
  scene.add(mesh);
  explosionParticles.push({ mesh, type: 'tireSmoke', life: 0.4, maxLife: 0.4 });
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

export function spawnExplosion(position) {
  const mesh = explosionPool.get();
  mesh.position.set(position.x, position.y, position.z);
  scene.add(mesh);
  explosionParticles.push({ mesh, type: 'explosion', life: 1.0, maxLife: 1.0, vels: [] });
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

export function updateCamera(targetPos, carQuat, dt) {
  const alphaTarget = 1 - Math.exp(-8 * dt);
  cameraTarget.lerp(targetPos, alphaTarget);

  const hFactor = 0.35 + (cameraZoom / 60) * 0.5;
  _tmpCamOffset.set(0, cameraZoom * hFactor, -cameraZoom * 0.6);
  _tmpCamOffset.applyQuaternion(carQuat);

  _tmpCamIdeal.copy(cameraTarget).add(_tmpCamOffset);
  camera.position.lerp(_tmpCamIdeal, 1 - Math.exp(-10 * dt));
  camera.lookAt(_tmpCamIdeal.copy(cameraTarget).add(_tmpCamUp));

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

  for (let i = explosionParticles.length - 1; i >= 0; i--) {
    const ep = explosionParticles[i];
    ep.life -= dt;
    if (ep.life <= 0) {
      scene.remove(ep.mesh);
      if (ep.type === 'smoke') smokePool.release(ep.mesh);
      if (ep.type === 'tireSmoke') tireSmokePool.release(ep.mesh);
      if (ep.type === 'explosion') explosionPool.release(ep.mesh);
      explosionParticles.splice(i, 1);
      continue;
    }
    const ratio = ep.life / ep.maxLife;
    const baseScale = ep.mesh.userData.baseScale || 1.0;
    ep.mesh.scale.setScalar(baseScale * ratio);
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

  // Initialize at the start of the INTRO sequence (progress 0)
  const offset = new THREE.Vector3(80, 100, 0); // radius 80, height 100
  camera.position.copy(targetPos).add(offset);
  camera.lookAt(cameraTarget);
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


