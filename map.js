/**
 * map.js – Procedural track generation for Nitro Seed
 * Uses Mulberry32 PRNG + CatmullRomCurve3 for a seeded, reproducible track.
 * Exports: generateMap(seed, world, materials) → { trackMesh, wallMeshes,
 *          checkpoints, weaponCrateSpawns, finishLinePt, spline, startPos }
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// ── PRNG ──────────────────────────────────────────────────────────────────
export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ── Track generation ──────────────────────────────────────────────────────
const ROAD_WIDTH    = 12;
const ROAD_HALF     = ROAD_WIDTH / 2;
const RING_RADIUS   = 130;
const OFFSET_MAX    = 45;
const NUM_POINTS    = 12;
const WALL_H        = 1.8;
const WALL_D        = 2.5;   // depth of each wall segment box
const WALL_T        = 0.5;   // wall half-thickness

export function generateMap(seed, world, groundMat, wallMat) {
  let rng = mulberry32(seed);
  let spline, length;

  // Retry until track is within target length
  for (let attempt = 0; attempt < 20; attempt++) {
    rng = mulberry32(seed + attempt);
    const pts = [];
    for (let i = 0; i < NUM_POINTS; i++) {
      const angle  = (i / NUM_POINTS) * Math.PI * 2;
      const r      = RING_RADIUS + (rng() - 0.5) * 2 * OFFSET_MAX;
      const ox     = (rng() - 0.5) * OFFSET_MAX * 0.6;
      const oz     = (rng() - 0.5) * OFFSET_MAX * 0.6;
      pts.push(new THREE.Vector3(
        Math.cos(angle) * r + ox,
        0,
        Math.sin(angle) * r + oz
      ));
    }
    spline = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
    length = spline.getLength();
    if (length >= 600 && length <= 1000) break;
  }

  const samples = Math.ceil(length / 1.5);  // ~1 sample per 1.5m

  // ── Road geometry ──────────────────────────────────────────────────────
  const roadGeo = new THREE.BufferGeometry();
  const vertices = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const pt = spline.getPointAt(t);
    const tan = spline.getTangentAt(t % 1 || 0.999).normalize();
    const right = new THREE.Vector3(-tan.z, 0, tan.x).normalize().multiplyScalar(ROAD_HALF);

    // Left vertex
    vertices.push(pt.x - right.x, 0.01, pt.z - right.z);
    // Right vertex
    vertices.push(pt.x + right.x, 0.01, pt.z + right.z);

    uvs.push(0, t * length / 10);
    uvs.push(1, t * length / 10);
  }

  for (let i = 0; i < samples; i++) {
    const v = i * 2;
    indices.push(v, v + 1, v + 2);
    indices.push(v + 1, v + 3, v + 2);
  }

  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  roadGeo.setIndex(indices);
  roadGeo.computeVertexNormals();

  const roadMat  = _buildRoadMaterial();
  const trackMesh = new THREE.Mesh(roadGeo, roadMat);
  trackMesh.receiveShadow = true;
  trackMesh.castShadow    = false;

  // ── Wall physics and visual meshes ──────────────────────────────────────
  const wallMeshes  = [];
  const wallBodies  = [];
  const wallMatVisual = _buildWallMaterial();
  
  const leftGeo = _buildContinuousWallGeo(spline, length, samples, -1);
  const leftMesh = new THREE.Mesh(leftGeo, wallMatVisual);
  leftMesh.castShadow = true; leftMesh.receiveShadow = true;
  wallMeshes.push(leftMesh);

  const rightGeo = _buildContinuousWallGeo(spline, length, samples, 1);
  const rightMesh = new THREE.Mesh(rightGeo, wallMatVisual);
  rightMesh.castShadow = true; rightMesh.receiveShadow = true;
  wallMeshes.push(rightMesh);

  const WALL_STEP_M = 2.0;
  const wallSamplesPhys = Math.ceil(length / WALL_STEP_M);

  for (let i = 0; i < wallSamplesPhys; i++) {
    const t   = i / wallSamplesPhys;
    const pt  = spline.getPointAt(t);
    const tan = spline.getTangentAt(t).normalize();
    const perp = new THREE.Vector3(-tan.z, 0, tan.x);

    [-1, 1].forEach(side => {
      const pos = pt.clone().addScaledVector(perp, side * (ROAD_HALF + WALL_T));
      const angle = Math.atan2(tan.x, tan.z);
      
      const quat = new CANNON.Quaternion();
      quat.setFromEuler(0, angle, 0);
      const wBody = new CANNON.Body({ mass: 0, material: wallMat });
      wBody.addShape(new CANNON.Box(new CANNON.Vec3(WALL_T, WALL_H / 2, (WALL_STEP_M + 0.5) / 2)));
      wBody.position.set(pos.x, WALL_H / 2, pos.z);
      wBody.quaternion.copy(quat);
      world.addBody(wBody);
      wallBodies.push(wBody);
    });
  }

  // ── Checkpoints ────────────────────────────────────────────────────────
  const checkpoints = [0.25, 0.5, 0.75, 1.0].map((t, idx) => {
    const pt  = spline.getPointAt(t % 1 || 0.999);
    const tan = spline.getTangentAt(t % 1 || 0.999);
    return { t, index: idx, position: pt.clone(), tangent: tan.clone(), passed: false };
  });

  // Finish line = t=1.0 (same as checkpoint 3)
  const finishLinePt  = spline.getPointAt(0.001);
  const finishTangent = spline.getTangentAt(0.001);

  // ── Start Grid (F1 staggered style) ──────────────────────────────────────
  const startGrid = [];
  const startGridMeshes = [];
  const dtPerMeter = 1.0 / length;

  for (let i = 0; i < 8; i++) {
    const distBack = 6 + Math.floor(i / 2) * 8; // Row distance
    let t = 1.0 - (distBack * dtPerMeter);
    if (t < 0) t += 1.0;
    
    const pt = spline.getPointAt(t);
    const tan = spline.getTangentAt(t).normalize();
    const side = (i % 2 === 0) ? -1 : 1; 
    const right = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    pt.addScaledVector(right, side * 2.5); // 2.5m offset left/right
    
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), tan);
    // Flip 180 degrees so we face the correct way on the grid
    const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    quat.multiply(flip);
    
    startGrid.push({ pos: pt, quat });

    // Visual grid spot (short line crossing the road sideways)
    const spotGeo = new THREE.BoxGeometry(3.0, 0.05, 0.3);
    const spotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const spot = new THREE.Mesh(spotGeo, spotMat);
    spot.position.copy(pt);
    spot.position.y = 0.02; // Slightly above road to prevent z-fighting
    spot.quaternion.copy(quat);
    spot.receiveShadow = true;
    startGridMeshes.push(spot);
  }

  // Add grid spots to track mesh
  startGridMeshes.forEach(mesh => trackMesh.add(mesh));

  // ── Weapon crate spawns ────────────────────────────────────────────────
  const CRATE_TYPES  = ['ROCKET', 'OIL_SLICK', 'BOOST'];
  const crateCount   = 8 + Math.floor(rng() * 5);
  const weaponCrateSpawns = [];
  const usedTs = new Set();

  for (let i = 0; i < crateCount; i++) {
    let ct;
    do { ct = 0.05 + rng() * 0.9; } while ([...usedTs].some(u => Math.abs(u - ct) < 0.06));
    usedTs.add(ct);
    const cratePos  = spline.getPointAt(ct);
    cratePos.y      = 0.5;
    const typeIdx   = Math.floor(rng() * CRATE_TYPES.length);
    weaponCrateSpawns.push({
      t: ct,
      position: cratePos.clone(),
      type: CRATE_TYPES[typeIdx],
      active: true,
      respawnTimer: 0,
    });
  }

  // ── Ground plane (visual only) ─────────────────────────────────────────
  const groundGeo  = new THREE.PlaneGeometry(2000, 2000, 4, 4);
  const groundMesh = new THREE.Mesh(groundGeo, _buildGrassMaterial());
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = -0.05;
  groundMesh.receiveShadow = true;

  // Flat Cannon ground
  const flatGround = new CANNON.Body({ mass: 0, material: groundMat });
  flatGround.addShape(new CANNON.Plane());
  flatGround.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(flatGround);

  return {
    trackMesh,
    wallMeshes,
    groundMesh,
    checkpoints,
    weaponCrateSpawns,
    finishLinePt,
    finishTangent,
    startGrid,
    spline,
    roadLength: length,
  };
}

// ── Materials ─────────────────────────────────────────────────────────────
function _buildRoadMaterial() {
  const tex = new THREE.TextureLoader().load('textures/textures/worn_mossy_plasterwall_diff_1k.jpg');
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, Math.ceil(8));
  return new THREE.MeshLambertMaterial({ map: tex, flatShading: false });
}

function _buildWallMaterial() {
  const tex = new THREE.TextureLoader().load('textures/textures/peeling_painted_wall_diff_1k.jpg');
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  return new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
}

function _buildContinuousWallGeo(spline, length, samples, side) {
  const geo = new THREE.BufferGeometry();
  const vertices = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const pt = spline.getPointAt(t);
    const tan = spline.getTangentAt(t % 1 || 0.999).normalize();
    const rightDir = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    const outDir = rightDir.clone().multiplyScalar(side);

    const center = pt.clone().addScaledVector(outDir, ROAD_HALF + WALL_T);
    const innerV = center.clone().addScaledVector(outDir, -WALL_T);
    const outerV = center.clone().addScaledVector(outDir, WALL_T);

    vertices.push(innerV.x, 0, innerV.z);
    vertices.push(innerV.x, WALL_H, innerV.z);
    vertices.push(outerV.x, WALL_H, outerV.z);
    vertices.push(outerV.x, 0, outerV.z);

    const uLen = t * length / 4; 
    uvs.push(0, uLen);
    uvs.push(WALL_H / 4, uLen);
    uvs.push((WALL_H + WALL_T*2) / 4, uLen);
    uvs.push((WALL_H*2 + WALL_T*2) / 4, uLen);
  }

  for (let i = 0; i < samples; i++) {
    const v = i * 4;
    const nv = (i + 1) * 4;

    indices.push(v, nv, v + 1);
    indices.push(v + 1, nv, nv + 1);

    indices.push(v + 1, nv + 1, v + 2);
    indices.push(v + 2, nv + 1, nv + 2);

    indices.push(v + 2, nv + 2, v + 3);
    indices.push(v + 3, nv + 2, nv + 3);
  }

  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function _buildGrassMaterial() {
  const tex = new THREE.TextureLoader().load('textures/textures/coast_sand_rocks_02_diff_1k.jpg');
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(80, 80);
  return new THREE.MeshLambertMaterial({ map: tex, color: 0x66cc66 });
}

function _buildIndexArray(vertCount) {
  const idx = [];
  for (let i = 0; i < vertCount; i++) idx.push(i);
  return idx;
}

// ── Checkpoint proximity check ─────────────────────────────────────────────
export function checkCheckpointProximity(position, checkpoints, threshold = 8) {
  for (const cp of checkpoints) {
    if (!cp.passed) {
      const dx = position.x - cp.position.x;
      const dz = position.z - cp.position.z;
      if (Math.sqrt(dx * dx + dz * dz) < threshold) {
        return cp;
      }
    }
  }
  return null;
}

// ── Weapon crate proximity check ───────────────────────────────────────────
export function checkCrateProximity(position, crates, threshold = 3) {
  for (const crate of crates) {
    if (!crate.active) continue;
    const dx = position.x - crate.position.x;
    const dz = position.z - crate.position.z;
    if (Math.sqrt(dx * dx + dz * dz) < threshold) {
      return crate;
    }
  }
  return null;
}

// ── Crate respawn update ────────────────────────────────────────────────────
export function updateCrateRespawns(crates, dt) {
  for (const crate of crates) {
    if (!crate.active) {
      crate.respawnTimer -= dt;
      if (crate.respawnTimer <= 0) {
        crate.active = true;
      }
    }
  }
}
