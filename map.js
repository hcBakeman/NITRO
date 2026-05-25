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
const WALL_T = 0.2; // wall half-thickness

function _buildWallBoxes(spline, samples, side, world, material, jumpZones, frames, isClosed) {
  // A single Cannon.js world shouldn't have 2000 static bodies if we can avoid it.
  // We chunk the wall boxes into groups of 20 (just like the Trimesh) to dramatically
  // reduce the number of bodies in the SAPBroadphase, significantly speeding up physics!
  const CHUNK_SIZE = 20;

  for (let chunkStart = 0; chunkStart < samples; chunkStart += CHUNK_SIZE) {
    const chunkBody = new CANNON.Body({ mass: 0, material });
    chunkBody.collisionFilterGroup = 1;
    chunkBody.collisionFilterMask = -1;
    
    // We keep the chunk body at the origin and offset the shapes using their global coordinates
    chunkBody.position.set(0, 0, 0);
    chunkBody.quaternion.set(0, 0, 0, 1);

    let hasShapes = false;
    const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, samples);

    for (let i = chunkStart; i < chunkEnd; i++) {
      const t1 = i / samples;
      const t2 = (i + 1) / samples;
      
      const isInGap = jumpZones && jumpZones.some(z => t1 >= z.startT && t1 <= z.endT);
      if (isInGap) continue;

      const pt1 = spline.getPointAt(t1);
      const pt2 = spline.getPointAt(t2);
      
      const rightDir1 = frames.binormals[isClosed && i === samples ? 0 : i].clone().normalize();
      const outDir1 = rightDir1.clone().multiplyScalar(side);
      const center1 = pt1.clone().addScaledVector(outDir1, ROAD_HALF + WALL_T);
      
      const rightDir2 = frames.binormals[isClosed && (i + 1) === samples ? 0 : Math.min(i + 1, samples)].clone().normalize();
      const outDir2 = rightDir2.clone().multiplyScalar(side);
      const center2 = pt2.clone().addScaledVector(outDir2, ROAD_HALF + WALL_T);
      
      const OVERLAP_OFFSET = 0.05;
      const OVERLAP_EXTEND = 0.2;
      
      center1.addScaledVector(outDir1, OVERLAP_OFFSET);
      center2.addScaledVector(outDir2, -OVERLAP_OFFSET);
      
      const dist = center1.distanceTo(center2);
      
      const boxShape = new CANNON.Box(new CANNON.Vec3(WALL_T, WALL_H / 2, (dist + OVERLAP_EXTEND) / 2));
      
      const midPoint = new THREE.Vector3().addVectors(center1, center2).multiplyScalar(0.5);
      const offset = new CANNON.Vec3(midPoint.x, midPoint.y + WALL_H / 2, midPoint.z);
      
      const forward = new THREE.Vector3().subVectors(center2, center1).normalize();
      const up = new THREE.Vector3().crossVectors(rightDir1, forward).normalize();
      if (up.y < 0) up.negate();
      
      const m = new THREE.Matrix4();
      const right = new THREE.Vector3().crossVectors(up, forward).normalize();
      m.makeBasis(right, up, forward);
      
      const quat = new THREE.Quaternion().setFromRotationMatrix(m);
      const orientation = new CANNON.Quaternion(quat.x, quat.y, quat.z, quat.w);
      
      chunkBody.addShape(boxShape, offset, orientation);
      hasShapes = true;
    }

    if (hasShapes) {
      world.addBody(chunkBody);
    }
  }
}

export function generateMap(seed, world, groundMat, wallMat) {
  const isTest = Number(seed) === 0;
  let rng = mulberry32(seed);
  let spline, length;

  const ROAD_HALF = isTest ? 30 : 6;

  // Retry until track is within target length
  for (let attempt = 0; attempt < 20; attempt++) {
    rng = mulberry32(seed + attempt);
    const pts = [];
    for (let i = 0; i < NUM_POINTS; i++) {
      if (isTest) {
        pts.push(new THREE.Vector3(0, 0, -i * 150)); // straight line, -150m spacing so it matches car's -Z forward
      } else {
        const angle = (i / NUM_POINTS) * Math.PI * 2;
        const r = RING_RADIUS + (rng() - 0.5) * 2 * OFFSET_MAX;
        const ox = (rng() - 0.5) * OFFSET_MAX * 0.6;
        const oz = (rng() - 0.5) * OFFSET_MAX * 0.6;
        pts.push(new THREE.Vector3(Math.cos(angle) * r + ox, 0, Math.sin(angle) * r + oz));
      }
    }
    spline = new THREE.CatmullRomCurve3(pts, isTest ? false : true, 'centripetal');
    length = spline.getLength();
    if (isTest || (length >= 600 && length <= 1000)) break;
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
  const isClosed = isTest ? false : true;
  const frames = spline.computeFrenetFrames(samples, isClosed);

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const pt = spline.getPointAt(t);
    // Use the precomputed binormal (wrapping around for the last vertex if closed)
    const binormalIdx = (isClosed && i === samples) ? 0 : i;
    const right = frames.binormals[binormalIdx].clone().normalize().multiplyScalar(ROAD_HALF);

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
    const nvPhys = isClosed ? ((i + 1) % samples) * 3 : (i + 1) * 3; // Weld the seam for physics only if closed

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
    ? (() => {
        const tex = new THREE.TextureLoader().load('textures/textures/asphalt_02_diff_1k.jpg');
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(1, 1);
        return new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
      })()
    : _buildRoadMaterial();
  const trackMesh = new THREE.Mesh(roadGeo, roadMat);
  trackMesh.matrixAutoUpdate = false;
  trackMesh.updateMatrix();
  trackMesh.receiveShadow = true;

  // --- Physics Trimesh Chunking ---
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
      const nvPhys = isClosed ? ((i + 1) % samples) * 3 : (i + 1) * 3;

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
    chunkBody.collisionFilterGroup = 1; // Default
    chunkBody.collisionFilterMask = -1; // Collide with EVERYTHING (chassis, wheels, rockets)
    chunkBody.addShape(chunkShape);
    world.addBody(chunkBody);
  }

  // ── Wall physics and visual meshes ──────────────────────────────────────
  const wallMeshes = [];
  const wallMatVisual = _buildWallMaterial();

  // Left wall
  const leftGeo = _buildContinuousWallGeo(spline, length, samples, -1, jumpZones, frames, isClosed);
  const leftMesh = new THREE.Mesh(leftGeo, wallMatVisual);
  leftMesh.matrixAutoUpdate = false;
  leftMesh.updateMatrix();
  leftMesh.castShadow = false;
  leftMesh.receiveShadow = false;
  wallMeshes.push(leftMesh);

  // Right wall
  const rightGeo = _buildContinuousWallGeo(spline, length, samples, 1, jumpZones, frames, isClosed);
  const rightMesh = new THREE.Mesh(rightGeo, wallMatVisual);
  rightMesh.matrixAutoUpdate = false;
  rightMesh.updateMatrix();
  rightMesh.castShadow = false;
  rightMesh.receiveShadow = false;
  wallMeshes.push(rightMesh);

  // Wall Physics (Overlapping fish-scale boxes to prevent snagging and tunneling)
  _buildWallBoxes(spline, samples, -1, world, wallMat, jumpZones, frames, isClosed);
  _buildWallBoxes(spline, samples, 1, world, wallMat, jumpZones, frames, isClosed);

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
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();

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
    let t;
    if (isClosed) {
      t = 1.0 - distBack * dtPerMeter;
      if (t < 0) t += 1.0;
    } else {
      // Start 10% into the track (e.g. 270m) so there is road behind us
      t = 0.1 - distBack * dtPerMeter;
    }

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
    spot.rotateX(-Math.PI / 2);
    spot.rotateZ(Math.PI); // Spin 180 so it's readable from behind
    spot.receiveShadow = true;
    spot.matrixAutoUpdate = false;
    spot.updateMatrix();
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
  groundMesh.matrixAutoUpdate = false;
  groundMesh.updateMatrix();

  return {
    isTest,
    trackMesh,
    wallMeshes,
    groundMesh,
    checkpoints,
    weaponCrateSpawns,
    finishLinePt,
    finishTangent,
    startGrid,
    startGridMeshes,
    frames,
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

function _buildContinuousWallGeo(spline, length, samples, side, jumpZones, frames, isClosed) {
  const geo = new THREE.BufferGeometry();
  const vertices = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const pt = spline.getPointAt(t);
    // Use the frenet binormal just like the road
    const binormalIdx = (isClosed && i === samples) ? 0 : i;
    const rightDir = frames.binormals[binormalIdx].clone().normalize();
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
