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
      
      // Procedural height: Make it a gentle roller coaster generally,
      // but add sharp kicks at the jump zones.
      const t = i / NUM_POINTS;
      let y = Math.max(0, Math.sin(angle * 2) * 5); 
      
      // If we are just before a jump gap (at t ~0.15 or ~0.60), kick up!
      if ((t > 0.10 && t < 0.15) || (t > 0.55 && t < 0.60)) {
        y += 10; // The Kicker
      }
      
      pts.push(new THREE.Vector3(Math.cos(angle) * r + ox, y, Math.sin(angle) * r + oz));
    }
    spline = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
    length = spline.getLength();
    if (length >= 600 && length <= 1000) break;
  }

  const samples = Math.ceil(length / 1.5); 
  const jumpZones = [
    { startT: 0.15, endT: 0.17 }, 
    { startT: 0.60, endT: 0.62 }
  ];

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

    vertices.push(pt.x - right.x, pt.y, pt.z - right.z); // Left
    vertices.push(pt.x + right.x, pt.y, pt.z + right.z); // Right

    uvs.push(0, t * length / 10);
    uvs.push(1, t * length / 10);
  }

  for (let i = 0; i < samples; i++) {
    const t = i / samples;
    const isInGap = jumpZones.some(z => t >= z.startT && t <= z.endT);
    if (!isInGap) {
      const v = i * 2;
      indices.push(v, v + 1, v + 2);
      indices.push(v + 1, v + 3, v + 2);
    }
  }

  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  roadGeo.setIndex(indices);
  roadGeo.computeVertexNormals();

  const roadMat = _buildRoadMaterial();
  const trackMesh = new THREE.Mesh(roadGeo, roadMat);
  trackMesh.receiveShadow = true;

  // --- Physics Trimesh ---
  const roadShape = new CANNON.Trimesh(roadGeo.attributes.position.array, roadGeo.index.array);
  const roadBody = new CANNON.Body({ mass: 0, material: groundMat });
  roadBody.addShape(roadShape);
  world.addBody(roadBody);

  // ── Wall physics and visual meshes ──────────────────────────────────────
  const wallMeshes  = [];
  const wallMatVisual = _buildWallMaterial();
  
  // Left wall
  const leftGeo = _buildContinuousWallGeo(spline, length, samples, -1, jumpZones);
  const leftMesh = new THREE.Mesh(leftGeo, wallMatVisual);
  leftMesh.castShadow = true; leftMesh.receiveShadow = true;
  wallMeshes.push(leftMesh);

  // Right wall
  const rightGeo = _buildContinuousWallGeo(spline, length, samples, 1, jumpZones);
  const rightMesh = new THREE.Mesh(rightGeo, wallMatVisual);
  rightMesh.castShadow = true; rightMesh.receiveShadow = true;
  wallMeshes.push(rightMesh);

  // Wall Physics (Static Boxes, skipping gaps)
  const WALL_STEP_M = 2.0;
  const wallSamplesPhys = Math.ceil(length / WALL_STEP_M);
  for (let i = 0; i < wallSamplesPhys; i++) {
    const t = i / wallSamplesPhys;
    const isInGap = jumpZones.some(z => t >= z.startT && t <= z.endT);
    if (isInGap) continue;

    const pt  = spline.getPointAt(t);
    const tan = spline.getTangentAt(t).normalize();
    const perp = new THREE.Vector3(-tan.z, 0, tan.x);
    [-1, 1].forEach(side => {
      const pos = pt.clone().addScaledVector(perp, side * (ROAD_HALF + WALL_T));
      const angle = Math.atan2(tan.x, tan.z);
      const wBody = new CANNON.Body({ mass: 0, material: wallMat });
      wBody.addShape(new CANNON.Box(new CANNON.Vec3(WALL_T, WALL_H / 2, (WALL_STEP_M + 0.5) / 2)));
      wBody.position.set(pos.x, pt.y + WALL_H / 2, pos.z);
      wBody.quaternion.setFromEuler(0, angle, 0);
      world.addBody(wBody);
    });
  }

  // ── Jump Pillars ────────────────────────────────────────────────────────
  const pillarGeo = new THREE.BoxGeometry(13, 30, 0.5); // Narrower
  const pillarMat = new THREE.MeshLambertMaterial({ color: 0x333333, flatShading: true });
  jumpZones.forEach(zone => {
    [zone.startT, zone.endT].forEach(t => {
      const pt = spline.getPointAt(t);
      const tan = spline.getTangentAt(t);
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(pt.x, pt.y - 14.8, pt.z);
      pillar.rotation.y = Math.atan2(tan.x, tan.z);
      pillar.receiveShadow = true;
      wallMeshes.push(pillar);
    });
  });

  // ── Checkpoints & Finish ────────────────────────────────────────────────
  const checkpoints = [0.25, 0.5, 0.75, 1.0].map((t, idx) => {
    const pt  = spline.getPointAt(t % 1 || 0.999);
    const tan = spline.getTangentAt(t % 1 || 0.999);
    return { t, index: idx, position: pt.clone(), tangent: tan.clone(), passed: false };
  });

  const finishLinePt  = spline.getPointAt(0.001);
  const finishTangent = spline.getTangentAt(0.001);

  // ── Start Grid ──────────────────────────────────────────────────────────
  const startGrid = [];
  const startGridMeshes = [];
  const dtPerMeter = 1.0 / length;

  for (let i = 0; i < 8; i++) {
    // F1 staggered grid: 6m back for row 1, then 8m increments
    const distBack = 6 + Math.floor(i / 2) * 8; 
    let t = 1.0 - (distBack * dtPerMeter);
    if (t < 0) t += 1.0;
    
    const pt = spline.getPointAt(t % 1);
    const tan = spline.getTangentAt(t % 1).normalize();
    const side = (i % 2 === 0) ? -1 : 1; 
    const right = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    
    // Position car 3m to the side, and 1.5m ABOVE the road to ensure it drops onto the mesh
    const spawnPos = pt.clone().addScaledVector(right, side * 3);
    spawnPos.y += 1.5; 
    
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan);
    startGrid.push({ pos: spawnPos, quat: quat.clone() });

    // Visual grid spot
    const spot = new THREE.Mesh(new THREE.BoxGeometry(3, 0.1, 0.5), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    spot.position.copy(spawnPos); 
    spot.position.y = pt.y + 0.05;
    spot.quaternion.copy(quat);
    spot.receiveShadow = true;
    startGridMeshes.push(spot);
  }
  startGridMeshes.forEach(m => trackMesh.add(m));

  // ── Weapon crate spawns ────────────────────────────────────────────────
  const CRATE_TYPES  = ['ROCKET', 'OIL_SLICK', 'BOOST'];
  const crateCount   = 8 + Math.floor(rng() * 5);
  const weaponCrateSpawns = [];
  const usedTs = new Set();

  // ── Mandatory Jump Boosts ──────────────────────────────────────────────
  // Place 1 boost pad right before each jump so players can always make it.
  jumpZones.forEach(zone => {
    const boostT = zone.startT - 0.02;
    const boostPos = spline.getPointAt(boostT);
    boostPos.y += 0.5;
    weaponCrateSpawns.push({
      t: boostT,
      position: boostPos.clone(),
      type: 'BOOST',
      active: true,
      respawnTimer: 0,
    });
  });

  for (let i = 0; i < crateCount; i++) {
    let ct;
    do { ct = 0.05 + rng() * 0.9; } while ([...usedTs].some(u => Math.abs(u - ct) < 0.06));
    usedTs.add(ct);
    const cratePos  = spline.getPointAt(ct);
    cratePos.y      += 0.8; // Floating above hills
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
  groundMesh.position.y = -1.0; // Lowered further to avoid clipping with low road parts
  groundMesh.receiveShadow = true;

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

function _buildContinuousWallGeo(spline, length, samples, side, jumpZones) {
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

    // Wall follows the hilly pt.y
    vertices.push(innerV.x, pt.y, innerV.z);
    vertices.push(innerV.x, pt.y + WALL_H, innerV.z);
    vertices.push(outerV.x, pt.y + WALL_H, outerV.z);
    vertices.push(outerV.x, pt.y, outerV.z);

    const uLen = t * length / 4; 
    uvs.push(0, uLen);
    uvs.push(WALL_H / 4, uLen);
    uvs.push((WALL_H + WALL_T*2) / 4, uLen);
    uvs.push((WALL_H*2 + WALL_T*2) / 4, uLen);
  }

  for (let i = 0; i < samples; i++) {
    const t = i / samples;
    const isInGap = jumpZones && jumpZones.some(z => t >= z.startT && t <= z.endT);
    if (isInGap) continue;

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
