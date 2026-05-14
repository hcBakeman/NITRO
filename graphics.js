/**
 * graphics.js – Three.js scene, 90's aesthetic rendering for Nitro Seed
 * Handles: scene, lights, camera (spring-arm), vehicle meshes, checkpoints,
 *          finish line, weapon crate visuals, minimap, explosions, polyhaven textures
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD_HALF } from './map.js';
export const PLAYER_COLORS = [0xff2222, 0x22aaff, 0x22ff44, 0xffee22, 0xff8800, 0xcc22ff];

// ── Module state ──────────────────────────────────────────────────────────
let renderer, scene, camera;
let cameraYaw = 0;
let cameraZoom = 35;
let cameraTarget = new THREE.Vector3();

const vehicleMeshes = {}; // peerId → { group, wheels[] }
const crateMeshes = {}; // crateIndex → mesh
let checkpointMeshes = [];
let finishLineMesh = null;
let finishBannerTime = 0;
const explosionParticles = [];
const rocketLightPool = [];
const ROCKET_LIGHT_COUNT = 8;
let cameraShake = 0;

let minimapCtx,
  minimapSpline,
  minimapCratePositions = [],
  minimapPlayerPos = new THREE.Vector2();
let raceGroup = new THREE.Group();

let previewRenderer, previewScene, previewCamera;
let previewCarGroup = new THREE.Group();
let previewAnimationId;

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

  // 90's Sky Gradient Sphere
  const skyGeo = new THREE.SphereGeometry(900, 32, 15);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(0x0077ff) },
      bottomColor: { value: new THREE.Color(0x88ccff) },
      offset: { value: 0 },
      exponent: { value: 0.6 },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
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
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // Stars
  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  for (let i = 0; i < 2000; i++) {
    const p = new THREE.Vector3().setFromSphericalCoords(
      850,
      Math.random() * Math.PI,
      Math.random() * Math.PI * 2
    );
    starPos.push(p.x, p.y, p.z);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false });
  scene.add(new THREE.Points(starGeo, starMat));

  // Lights
  const ambient = new THREE.AmbientLight(0xfff4e0, 0.45);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfffbe8, 1.2);
  sun.position.set(80, 120, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 600;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -250;
  sun.shadow.camera.right = sun.shadow.camera.top = 250;
  scene.add(sun);

  // Camera
  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 1000);
  camera.position.set(0, 35, -22);

  // Input for camera control
  window.addEventListener('wheel', e => {
    cameraZoom = Math.max(12, Math.min(60, cameraZoom + e.deltaY * 0.05));
  });
  window.addEventListener('keydown', e => {
    if (e.key === 'q' || e.key === 'Q') cameraYaw -= 0.08;
    if (e.key === 'e' || e.key === 'E') cameraYaw += 0.08;
  });

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  return { renderer, scene, camera };
}

// ── Add map objects to scene ───────────────────────────────────────────────
export function addMapToScene(mapData) {
  scene.add(raceGroup);
  raceGroup.add(mapData.trackMesh);
  raceGroup.add(mapData.groundMesh);
  mapData.wallMeshes.forEach(m => raceGroup.add(m));

  minimapSpline = mapData.spline;

  _buildCheckpointArches(mapData.checkpoints, mapData.spline);
  _buildFinishLine(mapData.finishLinePt, mapData.finishTangent);
  _buildWeaponCrateMeshes(mapData.weaponCrateSpawns);

  // Minimap
  const mc = document.getElementById('minimap-canvas');
  minimapCtx = mc.getContext('2d');
  minimapCratePositions = mapData.weaponCrateSpawns.map(c => c.position.clone());
}

export function clearRaceScene() {
  if (raceGroup) {
    scene.remove(raceGroup);
    raceGroup = new THREE.Group();
  }
  Object.values(vehicleMeshes).forEach(entry => scene.remove(entry.group));
  for (const id in vehicleMeshes) delete vehicleMeshes[id];
  checkpointMeshes = [];
  finishLineMesh = null;
  if (minimapCtx) minimapCtx.clearRect(0, 0, 160, 160);
}

// ── Checkpoint Arches ─────────────────────────────────────────────────────
function _buildCheckpointArches(checkpoints, spline) {
  checkpointMeshes = [];
  checkpoints.forEach((cp, idx) => {
    const grp = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({
      color: 0xff6600,
      emissive: 0xff2200,
      emissiveIntensity: 0.4,
      flatShading: true,
    });
    const matW = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      emissive: 0xaaaaaa,
      emissiveIntensity: 0.2,
      flatShading: true,
    });

    // Two posts + crossbar (scaled to road width + 0.75m buffer)
    const archHalfWidth = ROAD_HALF + 0.75;
    const postGeo = new THREE.BoxGeometry(0.5, 5, 0.5);
    const barGeo = new THREE.BoxGeometry(archHalfWidth * 2, 0.5, 0.5);

    const postL = new THREE.Mesh(postGeo, idx % 2 === 0 ? mat : matW);
    postL.position.set(-archHalfWidth, 2.5, 0);
    const postR = new THREE.Mesh(postGeo, idx % 2 === 0 ? matW : mat);
    postR.position.set(archHalfWidth, 2.5, 0);
    const bar = new THREE.Mesh(barGeo, mat);
    bar.position.set(0, 5, 0);

    grp.add(postL, postR, bar);

    // Floating label sprite
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 256;
    labelCanvas.height = 64;
    const lc = labelCanvas.getContext('2d');
    lc.fillStyle = idx === 3 ? '#ffee22' : '#ffffff';
    lc.font = 'bold 28px monospace';
    lc.textAlign = 'center';
    lc.fillText(idx === 3 ? 'START' : `CHECKPOINT ${idx + 1}`, 128, 44);
    const labelTex = new THREE.CanvasTexture(labelCanvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex, depthTest: false }));
    sprite.position.set(0, 8, 0);
    sprite.scale.set(archHalfWidth * 2, 3, 1);
    grp.add(sprite);

    // Position arch along spline
    grp.position.copy(cp.position);
    const angle = Math.atan2(cp.tangent.x, cp.tangent.z);
    grp.rotation.y = angle;
    grp.castShadow = true;
    raceGroup.add(grp);
    checkpointMeshes.push(grp);
  });
}

// ── Finish Line ────────────────────────────────────────────────────────────
function _buildFinishLine(pos, tan) {
  const grp = new THREE.Group();

  // Checker banner canvas
  const bc = document.createElement('canvas');
  bc.width = 512;
  bc.height = 128;
  const bctx = bc.getContext('2d');
  const cols = 16,
    rows = 4;
  const cw = bc.width / cols,
    ch = bc.height / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      bctx.fillStyle = (r + c) % 2 === 0 ? '#000000' : '#ffffff';
      bctx.fillRect(c * cw, r * ch, cw, ch);
    }
  }
  const bannerTex = new THREE.CanvasTexture(bc);
  bannerTex.magFilter = THREE.NearestFilter;

  // Animated banner (sine wave via vertex shader)
  const finishHalfWidth = ROAD_HALF + 1.0;
  const bannerGeo = new THREE.PlaneGeometry(finishHalfWidth * 2, 2.5, 32, 1);
  const bannerMat = new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide });
  const banner = new THREE.Mesh(bannerGeo, bannerMat);
  banner.position.set(0, 9, 0);
  grp.add(banner);
  finishLineMesh = banner; // animated in render loop

  // Poles
  const poleGeo = new THREE.CylinderGeometry(0.18, 0.18, 10, 8);
  const poleMat = _stripesMat(0xff0000, 0xffffff, 8);
  [-finishHalfWidth, finishHalfWidth].forEach(x => {
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(x, 5, 0); // Spaced along X axis (across track)
    pole.castShadow = true;
    grp.add(pole);
  });

  // Ground checker stripe
  const gc = document.createElement('canvas');
  gc.width = 128;
  gc.height = 512;
  const gctx = gc.getContext('2d');
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 2; c++) {
      gctx.fillStyle = (r + c) % 2 === 0 ? '#000000' : '#ffffff';
      gctx.fillRect(c * 64, r * 64, 64, 64);
    }
  }
  const gTex = new THREE.CanvasTexture(gc);
  gTex.magFilter = THREE.NearestFilter;
  const groundStripe = new THREE.Mesh(
    new THREE.PlaneGeometry(finishHalfWidth * 2, 3),
    new THREE.MeshLambertMaterial({ map: gTex })
  );
  groundStripe.rotation.x = -Math.PI / 2;
  groundStripe.position.set(0, 0.02, 0);
  grp.add(groundStripe);

  grp.position.copy(pos);
  grp.rotation.y = Math.atan2(tan.x, tan.z);
  raceGroup.add(grp);
}

// ── Weapon Crate Meshes ────────────────────────────────────────────────────
const CRATE_COLORS = { ROCKET: 0xff2222, OIL_SLICK: 0x222222, BOOST: 0x22ff44 };

function _buildWeaponCrateMeshes(crates) {
  const crateGeo = new THREE.BoxGeometry(1, 1, 1);
  crates.forEach((crate, idx) => {
    const mat = new THREE.MeshLambertMaterial({
      color: CRATE_COLORS[crate.type] || 0xffffff,
      emissive: CRATE_COLORS[crate.type] || 0xffffff,
      emissiveIntensity: 0.3,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(crateGeo, mat);
    mesh.position.copy(crate.position);
    mesh.castShadow = true;
    raceGroup.add(mesh);
    crateMeshes[idx] = mesh;
  });
}

export function updateCrateMesh(idx, active) {
  if (crateMeshes[idx]) crateMeshes[idx].visible = active;
}

// ── Checkpoint flash ───────────────────────────────────────────────────────
export function flashCheckpoint(cpIndex) {
  const mesh = checkpointMeshes[cpIndex];
  if (!mesh) return;
  mesh.children.forEach(child => {
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
const gltfLoader = new GLTFLoader();
const loadedModelsCache = {};

export function initCarPreview(canvas) {
  previewRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

  previewScene = new THREE.Scene();

  const ambient = new THREE.AmbientLight(0xffffff, 0.7);
  previewScene.add(ambient);
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(5, 10, 5);
  previewScene.add(dirLight);

  previewCamera = new THREE.PerspectiveCamera(45, canvas.width / canvas.height, 0.1, 100);
  previewCamera.position.set(3.5, 2.5, -4);
  previewCamera.lookAt(0, 0.5, 0);

  previewScene.add(previewCarGroup);

  const animate = () => {
    previewAnimationId = requestAnimationFrame(animate);
    previewCarGroup.rotation.y += 0.015;
    previewRenderer.render(previewScene, previewCamera);
  };
  animate();
}

export async function setPreviewCar(modelName) {
  while (previewCarGroup.children.length > 0) {
    previewCarGroup.remove(previewCarGroup.children[0]);
  }
  try {
    const { mesh, dims } = await loadCarModelGltf(modelName);
    if (mesh) {
      const previewWrapper = new THREE.Group();
      previewWrapper.add(mesh);
      previewWrapper.position.y += 0.45;
      previewCarGroup.add(previewWrapper);
    }
  } catch (e) {
    console.error('Preview load failed', e);
  }
}

function loadCarModelGltf(modelName) {
  if (loadedModelsCache[modelName]) {
    const cached = loadedModelsCache[modelName];
    return Promise.resolve({ mesh: cached.mesh.clone(), dims: cached.dims });
  }

  return new Promise((resolve, reject) => {
    gltfLoader.load(
      `objects/${modelName}.glb`,
      gltf => {
        const innerMesh = gltf.scene;

        // Fix models exported with incorrect forward axes
        if (modelName === 'dacia_duster_low_poly') {
          innerMesh.rotation.y = -Math.PI / 2; // Flip back 180
        } else {
          // Flip back 180
          innerMesh.rotation.y = 0;
        }

        const object = new THREE.Group();
        object.add(innerMesh);
        object.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const scale = 3.6 / size.z; // Scale so length is ~3.6m
        object.scale.set(scale, scale, scale);

        const center = box.getCenter(new THREE.Vector3());
        const bottomY = box.min.y;
        object.position.set(-center.x * scale, -bottomY * scale - 0.42, -center.z * scale);

        const dims = { width: size.x * scale, length: size.z * scale };
        const wrapper = new THREE.Group();
        wrapper.add(object);
        loadedModelsCache[modelName] = { mesh: wrapper, dims };
        resolve({ mesh: wrapper.clone(), dims });
      },
      undefined,
      reject
    );
  });
}

export async function loadVehicle(peerId, colorIndex, modelName) {
  let group;
  try {
    const { mesh, dims } = await loadCarModelGltf(modelName);
    group = mesh;

    // Apply visual dimensions to the physics body for a perfect hitbox
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
  // Chassis centered at Y=0 (matches new physics)
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.9, 3.6), mat);
  body.position.y = 0;
  body.castShadow = true;
  container.add(body);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.65, 1.8),
    new THREE.MeshLambertMaterial({ color: 0xaaddff, flatShading: true })
  );
  // Cabin on top, centered in Z
  cabin.position.set(0, 0.775, 0); // (0.45 + 0.325 = 0.775)
  container.add(cabin);

  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111, flatShading: true });
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10);
  // Wheels at bottom (-0.45 relative to center)
  [
    [-0.9, -0.45, 1.4],
    [0.9, -0.45, 1.4],
    [-0.9, -0.45, -1.4],
    [0.9, -0.45, -1.4],
  ].forEach(([x, y, z]) => {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.38, z);
    w.castShadow = true;
    container.add(w);
  });

  // Headlights
  const hMat = new THREE.MeshBasicMaterial({ color: 0xffffcc });
  [-0.55, 0.55].forEach(x => {
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 6), hMat);
    h.position.set(x, 0.55, 1.85);
    container.add(h);
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

export function createRocketMesh() {
  const group = new THREE.Group();

  const body = new THREE.Mesh(rocketBodyGeo, rocketBodyMat);
  group.add(body);

  const nose = new THREE.Mesh(rocketNoseGeo, rocketNoseMat);
  group.add(nose);

  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(rocketFinGeo, rocketFinMat);
    const angle = (i * Math.PI) / 2;
    fin.position.set(Math.cos(angle) * 0.25, Math.sin(angle) * 0.25, 0.4);
    fin.rotation.z = angle;
    group.add(fin);
  }

  // Get a light from the pool instead of creating a new one
  if (rocketLightPool.length > 0) {
    const light = rocketLightPool.pop();
    light.intensity = 80;
    light.position.set(0, 0, 0.8);
    group.add(light);
    group.userData.poolLight = light;
  }

  scene.add(group);
  return group;
}

export function updateRocketMesh(mesh, pos, vel, dt) {
  mesh.position.set(pos.x, pos.y, pos.z);
  if (vel.length() > 0.1) {
    const target = new THREE.Vector3(pos.x + vel.x, pos.y + vel.y, pos.z + vel.z);
    mesh.lookAt(target);
  }

  // Throttled smoke spawning
  mesh.userData.smokeTimer = (mesh.userData.smokeTimer || 0) + dt;
  if (mesh.userData.smokeTimer > 0.05) {
    mesh.userData.smokeTimer = 0;
    _spawnSmoke(pos);
  }
}

// ── Shared particle geometries (avoids per-frame GC pressure) ────────────
const _smokeGeo = new THREE.SphereGeometry(0.2, 4, 4);
const _smokeMat = new THREE.MeshBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.6 });
const _tireSmokeGeo = new THREE.SphereGeometry(0.15, 4, 4);
const _tireSmokeMat = new THREE.MeshBasicMaterial({
  color: 0xdddddd,
  transparent: true,
  opacity: 0.4,
});

function _spawnSmoke(pos) {
  const mesh = new THREE.Mesh(_smokeGeo, _smokeMat); // Shared material, no .clone()
  mesh.position.set(pos.x, pos.y, pos.z);
  mesh.userData.baseScale = 0.75 + Math.random() * 0.5;
  mesh.scale.setScalar(mesh.userData.baseScale);
  scene.add(mesh);
  explosionParticles.push({ mesh, life: 0.6, maxLife: 0.6 });
}

export function spawnTireSmoke(pos) {
  const mesh = new THREE.Mesh(_tireSmokeGeo, _tireSmokeMat.clone());
  mesh.position.copy(pos);
  mesh.scale.setScalar(0.8 + Math.random() * 0.4);
  scene.add(mesh);
  explosionParticles.push({ mesh, life: 0.4, maxLife: 0.4 });
}

export function removeMesh(mesh) {
  if (mesh && mesh.parent) {
    // Return light to pool if it has one
    if (mesh.userData.poolLight) {
      const light = mesh.userData.poolLight;
      light.intensity = 0;
      scene.add(light); // Re-attach to scene root
      rocketLightPool.push(light);
      mesh.userData.poolLight = null;
    }
    mesh.parent.remove(mesh);
  }
}

// ── Explosion effect ────────────────────────────────────────────────────────
const explosionMat = new THREE.MeshBasicMaterial({
  color: 0xff6600,
  transparent: true,
  depthTest: false,
});
let explosionTemplateGeo = null;

// Pre-generate the merged explosion geometry once when module loads
(function buildExplosionGeo() {
  const count = 20;
  const geoArr = [];
  const sharedGeo = new THREE.SphereGeometry(0.35, 4, 4);
  for (let i = 0; i < count; i++) {
    const g = sharedGeo.clone();
    g.translate(
      (Math.random() - 0.5) * 1.5,
      (Math.random() - 0.5) * 1.5,
      (Math.random() - 0.5) * 1.5
    );
    geoArr.push(g);
  }
  explosionTemplateGeo = mergeGeometries(geoArr);
})();

export function spawnExplosion(position) {
  const mesh = new THREE.Mesh(explosionTemplateGeo, explosionMat);
  mesh.position.set(position.x, position.y, position.z);
  scene.add(mesh);
  explosionParticles.push({ mesh, life: 1.0, maxLife: 1.0, vels: [] });
}

// ── Oil Slick ───────────────────────────────────────────────────────────────
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

// ── Camera (Spring Arm) ────────────────────────────────────────────────────
export function setCameraShake(amount) {
  cameraShake = Math.max(cameraShake, amount);
}

export function updateCamera(targetPos, carQuat, dt) {
  const alphaTarget = 1 - Math.exp(-8 * dt);
  cameraTarget.lerp(targetPos, alphaTarget);

  // Dynamically lower the camera height at low zoom levels to see more horizon
  const hFactor = 0.35 + (cameraZoom / 60) * 0.5; // 0.85 at max zoom, ~0.45 at min zoom
  // Zoom offset (Behind the car at -Z)
  const offset = new THREE.Vector3(0, cameraZoom * hFactor, -cameraZoom * 0.6);
  offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraYaw);

  if (carQuat) {
    // Cannon quaternion to Three quaternion
    const q = new THREE.Quaternion(carQuat.x, carQuat.y, carQuat.z, carQuat.w);
    offset.applyQuaternion(q);
  }

  const tgt = cameraTarget.clone().add(offset);
  const alphaPos = 1 - Math.exp(-5 * dt);
  camera.position.lerp(tgt, alphaPos);

  if (cameraShake > 0.01) {
    camera.position.x += (Math.random() - 0.5) * cameraShake;
    camera.position.y += (Math.random() - 0.5) * cameraShake;
    camera.position.z += (Math.random() - 0.5) * cameraShake;
    cameraShake *= Math.exp(-4 * dt);
  } else {
    cameraShake = 0;
  }

  camera.lookAt(cameraTarget);
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

// ── Minimap ────────────────────────────────────────────────────────────────
export function updateMinimap(playerPos, crates, allPlayers) {
  if (!minimapCtx || !minimapSpline) return;
  const ctx = minimapCtx,
    W = 160,
    H = 160;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, W, H);

  // Spline
  const pts = minimapSpline.getPoints(120);
  const xs = pts.map(p => p.x),
    zs = pts.map(p => p.z);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs);
  const minZ = Math.min(...zs),
    maxZ = Math.max(...zs);
  const toMX = x => ((x - minX) / (maxX - minX)) * (W - 16) + 8;
  const toMZ = z => ((z - minZ) / (maxZ - minZ)) * (H - 16) + 8;

  ctx.strokeStyle = '#555';
  ctx.lineWidth = 4;
  ctx.beginPath();
  pts.forEach((p, i) =>
    i === 0 ? ctx.moveTo(toMX(p.x), toMZ(p.z)) : ctx.lineTo(toMX(p.x), toMZ(p.z))
  );
  ctx.closePath();
  ctx.stroke();

  // Crates
  crates.forEach(c => {
    if (!c.active) return;
    ctx.fillStyle = c.type === 'ROCKET' ? '#ff4444' : c.type === 'BOOST' ? '#44ff44' : '#888888';
    ctx.fillRect(toMX(c.position.x) - 3, toMZ(c.position.z) - 3, 6, 6);
  });

  // Other players
  Object.entries(allPlayers).forEach(([id, p]) => {
    if (!p.position) return;
    ctx.fillStyle =
      '#' + PLAYER_COLORS[p.colorIndex % PLAYER_COLORS.length].toString(16).padStart(6, '0');
    ctx.beginPath();
    ctx.arc(toMX(p.position.x), toMZ(p.position.z), 4, 0, Math.PI * 2);
    ctx.fill();
  });

  // Player dot
  ctx.fillStyle = '#ffff00';
  ctx.beginPath();
  ctx.arc(toMX(playerPos.x), toMZ(playerPos.z), 5, 0, Math.PI * 2);
  ctx.fill();
}

// ── Finish burst ────────────────────────────────────────────────────────────
export function spawnFinishBurst(position) {
  for (let i = 0; i < 3; i++) {
    setTimeout(
      () =>
        spawnExplosion({
          x: position.x + (Math.random() - 0.5) * 6,
          y: position.y + 1,
          z: position.z + (Math.random() - 0.5) * 6,
        }),
      i * 250
    );
  }
}

// ── Main render ────────────────────────────────────────────────────────────
export function renderScene(dt) {
  // Animate finish line banner (sine wave)
  finishBannerTime += dt;
  if (finishLineMesh) {
    const pos = finishLineMesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setZ(i, Math.sin(finishBannerTime * 3 + x * 0.5) * 0.25);
    }
    pos.needsUpdate = true;
  }

  // Animate crate rotation
  Object.values(crateMeshes).forEach(mesh => {
    if (mesh.visible) {
      mesh.rotation.y += dt * 1.5;
      mesh.position.y = mesh.userData.baseY || mesh.position.y;
      mesh.position.y =
        (mesh.userData.baseY = mesh.userData.baseY || mesh.position.y) +
        Math.sin(finishBannerTime * 2 + mesh.position.x) * 0.12;
    }
  });

  // Update explosions
  for (let i = explosionParticles.length - 1; i >= 0; i--) {
    const ep = explosionParticles[i];
    ep.life -= dt;
    if (ep.life <= 0) {
      scene.remove(ep.mesh);
      explosionParticles.splice(i, 1);
      continue;
    }
    const ratio = ep.life / ep.maxLife;
    const baseScale = ep.mesh.userData.baseScale || 1.0;

    // For smoke/particles, we shrink them to zero.
    // For large explosions, we might expand then shrink, but let's keep it simple for now.
    ep.mesh.scale.setScalar(baseScale * ratio);
  }

  renderer.render(scene, camera);
}

export function getCamera() {
  return camera;
}
export function getScene() {
  return scene;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function _stripesMat(colA, colB, count) {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const h = canvas.height / count;
  for (let i = 0; i < count; i++) {
    ctx.fillStyle =
      i % 2 === 0
        ? '#' + colA.toString(16).padStart(6, '0')
        : '#' + colB.toString(16).padStart(6, '0');
    ctx.fillRect(0, i * h, 32, h);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return new THREE.MeshLambertMaterial({ map: tex, flatShading: true });
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
