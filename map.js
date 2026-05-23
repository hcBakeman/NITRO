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
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Track generation ──────────────────────────────────────────────────────
const NUM_POINTS = 18;
const RING_RADIUS = 150;
const OFFSET_MAX = 35;
export const ROAD_HALF = 6;
const WALL_H = 2.5;
const WALL_T = 0.5; // wall half-thickness

function _addChunkedPhysics(world, geo, material, maxFacesPerChunk = 60) {
  const posAttr = geo.attributes.position;
  const indices = geo.index.array;
  
  for (let i = 0; i < indices.length; i += maxFacesPerChunk * 3) {
    const chunkVerts = [];
    const chunkIndices = [];
    const vertMap = new Map();
    
    const end = Math.min(i + maxFacesPerChunk * 3, indices.length);
    for (let j = i; j < end; j++) {
      const globalIdx = indices[j];
      if (!vertMap.has(globalIdx)) {
        vertMap.set(globalIdx, chunkVerts.length / 3);
        chunkVerts.push(posAttr.getX(globalIdx), posAttr.getY(globalIdx), posAttr.getZ(globalIdx));
      }
      chunkIndices.push(vertMap.get(globalIdx));
    }
    
    // Make the wall double-sided for physics to prevent high-speed tunneling
    const numIndices = chunkIndices.length;
    for (let j = 0; j < numIndices; j += 3) {
      chunkIndices.push(chunkIndices[j], chunkIndices[j + 2], chunkIndices[j + 1]);
    }
    
    const chunkShape = new CANNON.Trimesh(chunkVerts, chunkIndices);
    const chunkBody = new CANNON.Body({ mass: 0, material });
    chunkBody.addShape(chunkShape);
    world.addBody(chunkBody);
  }
}

export function generateMap(seed, world, groundMat, wallMat) {
  const isTest = Number(seed) === 0;
  let rng = mulberry32(seed);
  let spline, length;

  // Retry until track is within target length
  for (let attempt = 0; attempt < 20; attempt++) {
    rng = mulberry32(seed + attempt);
    const pts = [];
    for (let i = 0; i < NUM_POINTS; i++) {
      const angle = (i / NUM_POINTS) * Math.PI * 2;
      const r = RING_RADIUS + (isTest ? 0 : (rng() - 0.5) * 2 * OFFSET_MAX);
      const ox = isTest ? 0 : (rng() - 0.5) * OFFSET_MAX * 0.6;
      const oz = isTest ? 0 : (rng() - 0.5) * OFFSET_MAX * 0.6;

      // Procedural height: Flat track to prevent geometry collision overlap bugs
      const t = i / NUM_POINTS;
      let y = 0;

      if (isTest) {
        y = 0; // Totally flat ground for testing modular ramps
      } else {
        // Flat track for all seeds to fix hitboxes
        y = 0;
      }

      pts.push(new THREE.Vector3(Math.cos(angle) * r + ox, y, Math.sin(angle) * r + oz));
    }
    spline = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    length = spline.getLength();
    if (length >= 600 && length <= 1000) break;
  }

  const samples = Math.ceil(length / 2.0); // Higher resolution for smoother physics
  const jumpZones = [];

  // ── Road geometry (3-point cross section for stability) ──────────────
  const roadGeo = new THREE.BufferGeometry();
  const vertices = [];
  const uvs = [];
  const visualIndices = [];
  const physIndices = [];

  // Compute stable Frenet frames for smooth, twist-free banking
  const frames = spline.computeFrenetFrames(samples, true);

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const pt = spline.getPointAt(t);
    // Use the precomputed binormal (wrapping around for the last vertex)
    const right = frames.binormals[i % samples].clone().normalize().multiplyScalar(ROAD_HALF);

    // Three vertices per segment: Left, Center, Right
    vertices.push(pt.x - right.x, pt.y, pt.z - right.z); // Left
    vertices.push(pt.x, pt.y, pt.z); // Center
    vertices.push(pt.x + right.x, pt.y, pt.z + right.z); // Right

    const uvY = (t * length) / 10;
    uvs.push(0, uvY, 0.5, uvY, 1, uvY);
  }

  for (let i = 0; i < samples; i++) {
    const v = i * 3;
    const nvVisual = (i + 1) * 3;
    const nvPhys = ((i + 1) % samples) * 3; // Weld the seam for physics

    // Visual Indices (Uses duplicate end-vertices for correct UVs)
    visualIndices.push(v, v + 1, nvVisual);
    visualIndices.push(v + 1, nvVisual + 1, nvVisual);
    visualIndices.push(v + 1, v + 2, nvVisual + 1);
    visualIndices.push(v + 2, nvVisual + 2, nvVisual + 1);

    // Physics Indices (Double-sided to guarantee RaycastVehicle collision from above and below)
    // Front faces
    physIndices.push(v, v + 1, nvPhys);
    physIndices.push(v + 1, nvPhys + 1, nvPhys);
    physIndices.push(v + 1, v + 2, nvPhys + 1);
    physIndices.push(v + 2, nvPhys + 2, nvPhys + 1);

    // Back faces
    physIndices.push(v, nvPhys, v + 1);
    physIndices.push(v + 1, nvPhys, nvPhys + 1);
    physIndices.push(v + 1, nvPhys + 1, v + 2);
    physIndices.push(v + 2, nvPhys + 1, nvPhys + 2);
  }

  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  roadGeo.setIndex(visualIndices);
  roadGeo.computeVertexNormals();

  const roadMat = isTest
    ? new THREE.MeshLambertMaterial({ color: 0x2244ff })
    : _buildRoadMaterial();
  const trackMesh = new THREE.Mesh(roadGeo, roadMat);
  trackMesh.receiveShadow = true;

  // --- Physics Trimesh Chunking ---
  // A single 1000m Trimesh has no internal BVH in Cannon.js, causing ~1 million 
  // ray-triangle tests per second. We chunk it into 40m sections so the broadphase
  // completely culls the track sections not directly under the car.
  const CHUNK_SIZE = 20; // 20 segments * 2m = 40m chunks
  for (let chunkStart = 0; chunkStart < samples; chunkStart += CHUNK_SIZE) {
    const chunkVerts = [];
    const chunkIndices = [];
    const vertMap = new Map(); // global_index -> local_index

    const getLocalIdx = (globalVertexIdx) => {
      if (!vertMap.has(globalVertexIdx)) {
        vertMap.set(globalVertexIdx, chunkVerts.length / 3);
        chunkVerts.push(
          vertices[globalVertexIdx * 3],
          vertices[globalVertexIdx * 3 + 1],
          vertices[globalVertexIdx * 3 + 2]
        );
      }
      return vertMap.get(globalVertexIdx);
    };

    const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, samples);
    for (let i = chunkStart; i < chunkEnd; i++) {
      const v = i * 3;
      const nvPhys = ((i + 1) % samples) * 3;

      // Front faces
      chunkIndices.push(getLocalIdx(v), getLocalIdx(v + 1), getLocalIdx(nvPhys));
      chunkIndices.push(getLocalIdx(v + 1), getLocalIdx(nvPhys + 1), getLocalIdx(nvPhys));
      chunkIndices.push(getLocalIdx(v + 1), getLocalIdx(v + 2), getLocalIdx(nvPhys + 1));
      chunkIndices.push(getLocalIdx(v + 2), getLocalIdx(nvPhys + 2), getLocalIdx(nvPhys + 1));

      // Back faces
      chunkIndices.push(getLocalIdx(v), getLocalIdx(nvPhys), getLocalIdx(v + 1));
      chunkIndices.push(getLocalIdx(v + 1), getLocalIdx(nvPhys), getLocalIdx(nvPhys + 1));
      chunkIndices.push(getLocalIdx(v + 1), getLocalIdx(nvPhys + 1), getLocalIdx(v + 2));
      chunkIndices.push(getLocalIdx(v + 2), getLocalIdx(nvPhys + 1), getLocalIdx(nvPhys + 2));
    }

    const chunkShape = new CANNON.Trimesh(chunkVerts, chunkIndices);
    const chunkBody = new CANNON.Body({ mass: 0, material: groundMat });
    chunkBody.addShape(chunkShape);
    world.addBody(chunkBody);
  }

  // ── Wall physics and visual meshes ──────────────────────────────────────
  const wallMeshes = [];
  const wallMatVisual = _buildWallMaterial();

  // Left wall
  const leftGeo = _buildContinuousWallGeo(spline, length, samples, -1, jumpZones, frames);
  const leftMesh = new THREE.Mesh(leftGeo, wallMatVisual);
  leftMesh.castShadow = false;
  leftMesh.receiveShadow = false;
  wallMeshes.push(leftMesh);

  // Right wall
  const rightGeo = _buildContinuousWallGeo(spline, length, samples, 1, jumpZones, frames);
  const rightMesh = new THREE.Mesh(rightGeo, wallMatVisual);
  rightMesh.castShadow = false;
  rightMesh.receiveShadow = false;
  wallMeshes.push(rightMesh);

  // Wall Physics (Chunked Trimeshes instead of thousands of Boxes)
  _addChunkedPhysics(world, leftGeo, wallMat);
  _addChunkedPhysics(world, rightGeo, wallMat);

  // ── Modular Ramps (Seed 0000 only) ───────────────────────────────────────
  if (isTest) {
    const rampStyles = [
      { t: 0.15, type: 'WEDGE', size: [11, 2, 10] }, // Long & Smooth
      { t: 0.35, type: 'KICKER', size: [11, 4, 6] }, // Short & Steep
      { t: 0.55, type: 'ROLLER', size: [11, 2.5, 8] }, // Rounded
      { t: 0.75, type: 'KICKER', size: [11, 6, 8] }, // The Big One
    ];

    rampStyles.forEach(style => {
      const pt = spline.getPointAt(style.t);
      const tan = spline.getTangentAt(style.t).normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan);

      const pos = pt.clone();
      // Offset forward so base starts at t
      pos.add(tan.clone().multiplyScalar(style.size[2] / 2));
      pos.y += style.size[1] / 3; // Move up slightly

      let mesh;
      if (style.type === 'WEDGE' || style.type === 'KICKER') {
        // Create a Tapered Box (Triangular Prism)
        const geo = new THREE.BoxGeometry(...style.size);
        const posAttr = geo.attributes.position;
        // Taper the front-facing vertices (local Z > 0) to the bottom
        for (let i = 0; i < posAttr.count; i++) {
          if (posAttr.getZ(i) < 0) {
            posAttr.setY(i, -style.size[1] / 2);
          }
        }
        geo.computeVertexNormals();
        mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xffcc00 }));
        mesh.position.copy(pos);
        mesh.quaternion.copy(quat);
      } else {
        // Roller (Rounded pipe)
        mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(style.size[1], style.size[1], style.size[0], 32),
          new THREE.MeshLambertMaterial({ color: 0xffaa00 })
        );
        mesh.position.copy(pos);
        mesh.quaternion.copy(quat);
        mesh.rotateZ(Math.PI / 2);
        // Sink it so only the top curve is visible
        mesh.position.y -= style.size[1] * 0.8;
      }

      trackMesh.add(mesh);

      // Physics: Use Trimesh for the tapered wedge to ensure perfect collision
      let shape;
      if (style.type === 'ROLLER') {
        shape = new CANNON.Cylinder(style.size[1], style.size[1], style.size[0], 20);
      } else {
        shape = new CANNON.Trimesh(
          mesh.geometry.attributes.position.array,
          mesh.geometry.index.array
        );
      }

      const body = new CANNON.Body({ mass: 0, material: wallMat });
      body.addShape(shape);
      body.position.set(mesh.position.x, mesh.position.y, mesh.position.z);
      body.quaternion.set(
        mesh.quaternion.x,
        mesh.quaternion.y,
        mesh.quaternion.z,
        mesh.quaternion.w
      );
      world.addBody(body);
    });
  }

  // ── Checkpoints & Finish ────────────────────────────────────────────────
  const checkpoints = [0.25, 0.5, 0.75, 1.0].map((t, idx) => {
    const pt = spline.getPointAt(t % 1 || 0.999);
    const tan = spline.getTangentAt(t % 1 || 0.999);
    return { t, index: idx, position: pt.clone(), tangent: tan.clone(), passed: false };
  });

  const finishLinePt = spline.getPointAt(0.001);
  const finishTangent = spline.getTangentAt(0.001);

  // ── Start Grid (staggered 2-wide, numbered 1-8) ────────────────────────
  const startGrid = [];
  const startGridMeshes = [];
  const dtPerMeter = 1.0 / length;
  const GRID_LATERAL = 2; // meters from center (was 3, reduced to prevent wall clipping on curves)

  for (let i = 0; i < 8; i++) {
    // Staggered pairs: row 0 at 6m back, then 6m increments per row
    const distBack = 6 + Math.floor(i / 2) * 6;
    let t = 1.0 - distBack * dtPerMeter;
    if (t < 0) t += 1.0;

    const pt = spline.getPointAt(t % 1);
    const tan = spline.getTangentAt(t % 1).normalize();
    const side = i % 2 === 0 ? -1 : 1;
    const right = new THREE.Vector3(-tan.z, 0, tan.x).normalize();

    // Start position is exact track surface
    const spawnPos = pt.clone().addScaledVector(right, side * GRID_LATERAL);

    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan);
    startGrid.push({ pos: spawnPos, quat: quat.clone() });

    // ── Numbered grid marker ──
    // Create a canvas texture with the grid number
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#222222';
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 40px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), 64, 32);
    // Border
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, 124, 60);

    const tex = new THREE.CanvasTexture(canvas);
    const spotMat = new THREE.MeshBasicMaterial({ map: tex });
    const spot = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.2), spotMat);
    spot.position.copy(spawnPos);
    spot.position.y = spawnPos.y + 0.06;
    spot.quaternion.copy(quat);
    // Rotate flat on the ground (plane faces up)
    spot.rotateX(-Math.PI / 2);
    spot.receiveShadow = true;
    startGridMeshes.push(spot);
  }
  startGridMeshes.forEach(m => trackMesh.add(m));

  // ── Weapon crate spawns ────────────────────────────────────────────────
  const CRATE_TYPES = ['ROCKET', 'OIL_SLICK', 'BOOST'];
  const crateCount = 8 + Math.floor(rng() * 5);
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
      _dirty: false,
    });
  });

  for (let i = 0; i < crateCount; i++) {
    let ct;
    do {
      ct = 0.05 + rng() * 0.9;
    } while ([...usedTs].some(u => Math.abs(u - ct) < 0.06));
    usedTs.add(ct);
    const cratePos = spline.getPointAt(ct);
    cratePos.y += 0.8; // Floating above hills
    const typeIdx = Math.floor(rng() * CRATE_TYPES.length);
    weaponCrateSpawns.push({
      t: ct,
      position: cratePos.clone(),
      type: CRATE_TYPES[typeIdx],
      active: true,
      respawnTimer: 0,
      _dirty: false,
    });
  }

  // ── Ground plane (visual only) ─────────────────────────────────────────
  const groundGeo = new THREE.PlaneGeometry(2000, 2000, 4, 4);
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
  const tex = new THREE.TextureLoader().load('textures/textures/muddy_tracks_diff_1k.jpg');
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1); // uvY already handles track length scaling
  return new THREE.MeshLambertMaterial({ map: tex, flatShading: false, side: THREE.DoubleSide });
}

function _buildWallMaterial() {
  const tex = new THREE.TextureLoader().load('textures/textures/peeling_painted_wall_diff_1k.jpg');
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  return new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
}

function _buildContinuousWallGeo(spline, length, samples, side, jumpZones, frames) {
  const geo = new THREE.BufferGeometry();
  const vertices = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const pt = spline.getPointAt(t);
    // Use the frenet binormal just like the road
    const rightDir = frames.binormals[i % samples].clone().normalize();
    const outDir = rightDir.clone().multiplyScalar(side);

    const center = pt.clone().addScaledVector(outDir, ROAD_HALF + WALL_T);
    const innerV = center.clone().addScaledVector(outDir, -WALL_T);
    const outerV = center.clone().addScaledVector(outDir, WALL_T);

    // Wall follows the hilly pt.y
    vertices.push(innerV.x, pt.y, innerV.z);
    vertices.push(innerV.x, pt.y + WALL_H, innerV.z);
    vertices.push(outerV.x, pt.y + WALL_H, outerV.z);
    vertices.push(outerV.x, pt.y, outerV.z);

    const uLen = (t * length) / 4;
    uvs.push(0, uLen);
    uvs.push(WALL_H / 4, uLen);
    uvs.push((WALL_H + WALL_T * 2) / 4, uLen);
    uvs.push((WALL_H * 2 + WALL_T * 2) / 4, uLen);
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
  return new THREE.MeshBasicMaterial({ map: tex, color: 0x66cc66 });
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
        crate._dirty = true; // Signal mesh should be shown again
      }
    }
  }
}
