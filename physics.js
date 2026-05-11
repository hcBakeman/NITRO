/**
 * physics.js – Cannon-es physics engine for Nitro Seed
 * Handles: world, vehicle, weapons (rocket/oil/boost), flip recovery, wall bodies
 */
import * as CANNON from 'cannon-es';

// ── World ─────────────────────────────────────────────────────────────────
let world;
export let groundMat, vehicleMat, wallMat;

export function initPhysics() {
  world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = false;

  groundMat = new CANNON.Material('ground');
  vehicleMat = new CANNON.Material('vehicle');
  wallMat = new CANNON.Material('wall');

  world.addContactMaterial(new CANNON.ContactMaterial(groundMat, vehicleMat, {
    friction: 0.4, restitution: 0.0
  }));
  world.addContactMaterial(new CANNON.ContactMaterial(wallMat, vehicleMat, {
    friction: 0.15, restitution: 0.35
  }));
  world.addContactMaterial(new CANNON.ContactMaterial(groundMat, groundMat, {
    friction: 0.3, restitution: 0.0
  }));

  // Physical Safety Floor (Grass Level)
  const floorBody = new CANNON.Body({ mass: 0, material: groundMat });
  floorBody.addShape(new CANNON.Plane());
  floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  floorBody.position.y = -15.0; // 15m below spline center
  world.addBody(floorBody);

  return world;
}

export function getWorld() { return world; }

// ── Vehicle Constants ─────────────────────────────────────────────────────
const MAX_ENGINE = 5000;
const MAX_BRAKE = 120;
const MAX_STEER = 0.5;
const MAX_SPEED = 33.33; // m/s ≈ 120 km/h

// ── Player Vehicle ────────────────────────────────────────────────────────
export let playerVehicle = null;
export let playerChassis = null;
export let driveMode = '4WD'; // 'FWD', 'RWD', '4WD'

export function setDriveMode(mode) { driveMode = mode; }

let flipTimer = 0;
const FLIP_THRESH = 0.25;
const FLIP_RECOVERY = 2.0;

const allVehicleBodies = [];
const remoteVehicles = {};

function _addVanShapes(body) {
  // Tightened hitbox: 1.64m wide, 0.9m tall, 3.5m long
  const chassisShape = new CANNON.Box(new CANNON.Vec3(0.82, 0.45, 1.75));
  body.addShape(chassisShape, new CANNON.Vec3(0, 0, 0));
  
  // Cabin is narrower to allow for more lean in corners
  const cabinShape = new CANNON.Box(new CANNON.Vec3(0.65, 0.35, 0.85));
  body.addShape(cabinShape, new CANNON.Vec3(0, 0.8, 0));
}

export function createPlayerVehicle(startPos, startQuat) {
  playerChassis = new CANNON.Body({ mass: 1000, material: vehicleMat }); // Mass at 1000kg[cite: 1]
  playerChassis.isOiled = false;
  _addVanShapes(playerChassis);

  playerChassis.position.set(startPos.x, startPos.y + 1.65, startPos.z);
  if (startQuat) {
    playerChassis.quaternion.copy(startQuat);
  }
  playerChassis.linearDamping = 0.08;
  playerChassis.angularDamping = 0.15;

  playerVehicle = new CANNON.RaycastVehicle({
    chassisBody: playerChassis,
    indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2,
  });

  const wheelOpts = {
    radius: 0.38,
    directionLocal: new CANNON.Vec3(0, -1, 0),
    axleLocal: new CANNON.Vec3(-1, 0, 0),
    suspensionStiffness: 40,
    suspensionRestLength: 0.15,
    frictionSlip: 1.8,
    dampingRelaxation: 2.3,
    dampingCompression: 4.4,
    maxSuspensionForce: 100000,
    rollInfluence: 0.01,
    maxSuspensionTravel: 0.3,
    customSlidingRotationalSpeed: -30,
    useCustomSlidingRotationalSpeed: true,
  };

  // Wheels: [Front Left, Front Right, Rear Left, Rear Right]
  // Forward is now +Z. Steering wheels at 1.4, Rear wheels at -1.4
  [[ -0.9, -0.05, 1.4 ], [ 0.9, -0.05, 1.4 ], [ -0.9, -0.05, -1.4 ], [ 0.9, -0.05, -1.4 ]].forEach(([x, y, z]) => {
    playerVehicle.addWheel({ ...wheelOpts, chassisConnectionPointLocal: new CANNON.Vec3(x, y, z) });
  });

  playerVehicle.addToWorld(world);
  playerChassis._vehicleRef = playerVehicle;
  allVehicleBodies.push(playerChassis);
  return { vehicle: playerVehicle, chassis: playerChassis };
}

export function createRemoteVehicle(peerId, mass = 0) {
  const body = new CANNON.Body({
    mass: mass || 1,
    material: vehicleMat,
    type: mass > 0 ? CANNON.Body.DYNAMIC : CANNON.Body.KINEMATIC
  });
  body.isOiled = false;
  _addVanShapes(body);
  world.addBody(body);
  remoteVehicles[peerId] = body;
  allVehicleBodies.push(body);
  return body;
}

export function removeRemoteVehicle(peerId) {
  if (remoteVehicles[peerId]) {
    world.removeBody(remoteVehicles[peerId]);
    const idx = allVehicleBodies.indexOf(remoteVehicles[peerId]);
    if (idx > -1) allVehicleBodies.splice(idx, 1);
    delete remoteVehicles[peerId];
  }
}

export function getVehicleBody(id) {
  if (id === '__local__') return playerChassis;
  return remoteVehicles[id];
}

/**
 * Adjusts a vehicle's physics hitbox to match its 3D model dimensions
 */
export function setVehicleHitbox(id, width, height, length) {
  const body = getVehicleBody(id);
  if (!body) return;
  
  // Remove all existing shapes
  const shapes = [...body.shapes];
  shapes.forEach(s => body.removeShape(s));
  
  // Add new chassis shape (slightly inset width for better "rubbing" physics)
  const chassisShape = new CANNON.Box(new CANNON.Vec3(width * 0.46, 0.45, length * 0.48));
  body.addShape(chassisShape, new CANNON.Vec3(0, 0, 0));
  
  // Add new cabin shape
  const cabinShape = new CANNON.Box(new CANNON.Vec3(width * 0.35, 0.35, length * 0.25));
  body.addShape(cabinShape, new CANNON.Vec3(0, 0.8, 0));
}

// ── Vehicle Input ─────────────────────────────────────────────────────────
export function setVehicleInput(input) {
  if (!playerVehicle || !playerChassis) return;

  const speed = playerChassis.velocity.length();
  const kmh = speed * 3.6;

  // Get movement vectors for slip calculation
  const rightVec = new CANNON.Vec3(1, 0, 0);
  playerChassis.quaternion.vmult(rightVec, rightVec);
  const lateralVel = playerChassis.velocity.dot(rightVec);
  const isTurning = input.left || input.right;
  const isSliding = speed > 20 && (Math.abs(lateralVel) > speed * 0.2 || (isTurning && speed > 28));

  let gear = 1, gearLimit = 30;
  if (kmh > 90) { gear = 4; gearLimit = 250; }
  else if (kmh > 60) { gear = 3; gearLimit = 90; }
  else if (kmh > 30) { gear = 2; gearLimit = 60; }

  const speedRatio = Math.min(speed / MAX_SPEED, 1.0);
  const fScale = 1.0 - (speedRatio * speedRatio) * 0.5; // Steeper drop-off near top speed
  const steerAmt = MAX_STEER * Math.max(0.3, 1.0 - speedRatio * 0.45);

  let engineForce = 0, brakeForce = 0;

  if (input.forward) {
    engineForce = -MAX_ENGINE * fScale; // Flipped per user request

    // Only cut engine if NOT sliding. This allows recovery power[cite: 1]
    if (kmh >= gearLimit && !isSliding) {
      engineForce *= Math.max(0, 1 - (kmh - gearLimit) / 5);
    } else {
      const torqueMult = [1.2, 1.0, 0.9, 0.8][gear - 1];
      engineForce *= torqueMult;
    }
  } else if (input.backward) {
    const fwd = new CANNON.Vec3(0, 0, 1);
    playerChassis.quaternion.vmult(fwd, fwd);
    if (playerChassis.velocity.dot(fwd) > 0.5) {
      brakeForce = Math.min(MAX_BRAKE * (speed * speed) / 50, MAX_BRAKE);
    } else {
      engineForce = MAX_ENGINE * 0.5;
    }
  } else {
    brakeForce = 8;
  }

  // Flip steering sign because we are driving towards -Z
  // Left (A) = -X, which is Left when facing -Z
  const steer = input.left ? steerAmt : input.right ? -steerAmt : 0;

  // ── Drift & Steering Recovery Logic ──
  if (!playerChassis.isOiled) {
    const baseFric = 4.5; // Even more base grip

    // Front wheels always have base grip (unless counter-steering)
    const steeringDir = input.left ? 1 : (input.right ? -1 : 0);
    const slidingDir = lateralVel > 0 ? 1 : -1;
    const isCounterSteering = steeringDir !== 0 && steeringDir === slidingDir;

    if (isSliding) {
      // Only reduce friction slightly when sliding
      const driftFactor = Math.max(0, (speed - 20) / 40);
      const targetRearFric = baseFric - (driftFactor * 0.4) - (isTurning ? 0.3 : 0);
      playerVehicle.wheelInfos[2].frictionSlip = Math.max(3.5, targetRearFric);
      playerVehicle.wheelInfos[3].frictionSlip = Math.max(3.5, targetRearFric);
    } else {
      // Full grip when driving straight or slow
      playerVehicle.wheelInfos[2].frictionSlip = baseFric;
      playerVehicle.wheelInfos[3].frictionSlip = baseFric;
    }

    // Front wheels get EXTRA grip if counter-steering
    const frontFric = isCounterSteering ? 5.5 : baseFric;
    playerVehicle.wheelInfos[0].frictionSlip = frontFric;
    playerVehicle.wheelInfos[1].frictionSlip = frontFric;
  }

  const currentRoll = 0.01 + speedRatio * 0.04; 
  playerVehicle.wheelInfos.forEach(w => w.rollInfluence = currentRoll);

  playerVehicle.setSteeringValue(steer, 0);
  playerVehicle.setSteeringValue(steer, 1);

  // Drive Mode Power Split
  if (driveMode === 'RWD') {
    // REAR DRIVE (RWD): 100% Rear, 0% Front
    playerVehicle.applyEngineForce(engineForce, 2);
    playerVehicle.applyEngineForce(engineForce, 3);
    playerVehicle.applyEngineForce(0, 0);
    playerVehicle.applyEngineForce(0, 1);
  } else if (driveMode === 'FWD') {
    // FRONT DRIVE (FWD): 0% Rear, 100% Front
    playerVehicle.applyEngineForce(0, 2);
    playerVehicle.applyEngineForce(0, 3);
    playerVehicle.applyEngineForce(engineForce, 0);
    playerVehicle.applyEngineForce(engineForce, 1);
  } else {
    // 4WD (All-Wheel Drive): 100% Rear, 60% Front "Pull" for recovery[cite: 1]
    playerVehicle.applyEngineForce(engineForce, 2);
    playerVehicle.applyEngineForce(engineForce, 3);
    playerVehicle.applyEngineForce(engineForce * 0.6, 0);
    playerVehicle.applyEngineForce(engineForce * 0.6, 1);
  }

  // 70/30 Brake Bias: More front brake prevents the "handbrake" spin effect
  playerVehicle.setBrake(brakeForce, 0);
  playerVehicle.setBrake(brakeForce, 1);
  playerVehicle.setBrake(brakeForce * 0.3, 2);
  playerVehicle.setBrake(brakeForce * 0.3, 3);
}

// ── Flip Recovery ─────────────────────────────────────────────────────────
export function checkFlip(dt) {
  if (!playerChassis) return { flipping: false, recovered: false };
  const carUp = new CANNON.Vec3(0, 1, 0);
  playerChassis.quaternion.vmult(carUp, carUp);
  const uprightness = carUp.dot(new CANNON.Vec3(0, 1, 0));

  if (uprightness < FLIP_THRESH) {
    flipTimer += dt;
    if (flipTimer >= FLIP_RECOVERY) {
      _autoRight();
      flipTimer = 0;
      return { flipping: false, recovered: true };
    }
    return { flipping: true, recovered: false, progress: flipTimer / FLIP_RECOVERY };
  }
  flipTimer = 0;
  return { flipping: false, recovered: false };
}

function _autoRight() {
  const q = playerChassis.quaternion;
  const yaw = Math.atan2(2 * (q.w * q.y - q.z * q.x), 1 - 2 * (q.y * q.y + q.x * q.x));
  playerChassis.angularVelocity.set(0, 0, 0);
  playerChassis.quaternion.setFromEuler(0, yaw, 0);
  playerChassis.position.y += 1.2;
}

// ── Boost ─────────────────────────────────────────────────────────────────
export function applyBoost() {
  if (!playerChassis) return;
  const fwd = new CANNON.Vec3(0, 0, 1);
  playerChassis.quaternion.vmult(fwd, fwd);
  playerChassis.applyImpulse(fwd.scale(3500), new CANNON.Vec3(0, 0, 0));
}

// ── Rockets ───────────────────────────────────────────────────────────────
const activeRockets = [];

export function fireRocket(startPos, startQuat, onExplode, ownerBody) {
  const fwd = new CANNON.Vec3(0, 0, 1);
  startQuat.vmult(fwd, fwd);
  const pos = startPos.clone();
  // Spawn further ahead to prevent rocket appearing beside the car
  pos.x += fwd.x * 3.5; pos.y = 0.75; pos.z += fwd.z * 3.5;

  const body = new CANNON.Body({ mass: 0.5, linearDamping: 0.05, collisionResponse: false });
  body.isRocket = true;
  body.preStep = () => { body.force.y -= body.mass * world.gravity.y; };
  body.addShape(new CANNON.Sphere(0.25));
  body.position.copy(pos);

  const relativeVel = fwd.scale(41.67);
  if (ownerBody) {
    body.velocity.set(ownerBody.velocity.x + relativeVel.x, ownerBody.velocity.y + relativeVel.y, ownerBody.velocity.z + relativeVel.z);
  } else {
    body.velocity.copy(relativeVel);
  }

  world.addBody(body);
  const rocket = { body, life: 6.0, dead: false, onCleanup: null, owner: ownerBody };
  body.addEventListener('collide', (e) => {
    if (rocket.dead || e.body.isRocket || (ownerBody && e.body === ownerBody)) return;
    rocket.dead = true;
    _explodeRocket(body.position.clone(), onExplode, rocket);
  });
  activeRockets.push(rocket);
  return rocket;
}

function _explodeRocket(pos, onExplode, rocket) {
  const RADIUS = 8, FORCE = 550;
  const ownerBody = rocket?.owner;
  allVehicleBodies.forEach(body => {
    if (ownerBody && body === ownerBody) return;
    const diff = body.position.vsub(pos);
    const dist = diff.length();
    if (dist < RADIUS) {
      const power = FORCE / (dist + 1.0);
      const impulse = diff.scale(power);
      impulse.y += power * 0.15; // Vertical pop[cite: 1]

      const offset = diff.unit().scale(-0.5);
      offset.y += 0.8;
      body.applyImpulse(impulse, body.position.vadd(offset)); // Apply offset for roll/pitch[cite: 1]
    }
  });
  if (onExplode) onExplode(pos, rocket);
}

// ── Oil Slick ─────────────────────────────────────────────────────────────
const activeOilSlicks = [];

export function deployOilSlick(position, quaternion) {
  const body = new CANNON.Body({ mass: 0, collisionResponse: false });
  // Round oil slick (Cylinder)
  body.addShape(new CANNON.Cylinder(2.5, 2.5, 0.1, 16));
  const fwd = new CANNON.Vec3(0, 0, 1);
  if (quaternion) { quaternion.vmult(fwd, fwd); body.quaternion.copy(quaternion); }
  body.position.set(position.x - fwd.x * 3.0, position.y - 0.1, position.z - fwd.z * 3.0);
  world.addBody(body);

  const slick = { body, life: 10.0, hits: new Set() };
  body.addEventListener('collide', (e) => {
    const hit = e.body;
    if (!hit._vehicleRef || slick.hits.has(hit)) return;
    slick.hits.add(hit);
    const v = hit._vehicleRef;
    hit.isOiled = true;
    v.wheelInfos.forEach(w => w.frictionSlip = 0.1);
    setTimeout(() => {
      hit.isOiled = false;
      v.wheelInfos.forEach(w => w.frictionSlip = 1.8);
      slick.hits.delete(hit);
    }, 2000);
  });
  activeOilSlicks.push(slick);
  return slick;
}

export function raycastForward(body) {
  if (!body) return null;
  const fwd = new CANNON.Vec3(0, 0, 1);
  body.quaternion.vmult(fwd, fwd);
  const from = new CANNON.Vec3(body.position.x + fwd.x * 2.0, body.position.y + 0.75, body.position.z + fwd.z * 2.0);
  const to = new CANNON.Vec3(from.x + fwd.x * 100, from.y + fwd.y * 100, from.z + fwd.z * 100);
  const result = new CANNON.RaycastResult();
  world.raycastClosest(from, to, {}, result);
  return result.hasHit ? result.hitPointWorld : to;
}

// ── Physics Step ──────────────────────────────────────────────────────────
export function stepPhysics(dt) {
  world.step(1 / 60, dt, 3);
  for (let i = activeRockets.length - 1; i >= 0; i--) {
    const r = activeRockets[i];
    r.life -= dt;
    if (r.life <= 0 || r.dead) {
      world.removeBody(r.body);
      activeRockets.splice(i, 1);
    }
  }
  for (let i = activeOilSlicks.length - 1; i >= 0; i--) {
    activeOilSlicks[i].life -= dt;
    if (activeOilSlicks[i].life <= 0) {
      world.removeBody(activeOilSlicks[i].body);
      activeOilSlicks.splice(i, 1);
    }
  }
}

export function clearPhysicsWorld() {
  while (world.bodies.length > 0) world.removeBody(world.bodies[0]);
  activeRockets.length = 0;
  activeOilSlicks.length = 0;
  allVehicleBodies.length = 0;
  playerVehicle = null;
  playerChassis = null;
}

export function getActiveRockets() { return activeRockets; }
export function getActiveOilSlicks() { return activeOilSlicks; }
export function getFlipProgress() { return { timer: flipTimer, max: FLIP_RECOVERY }; }
export function resetVehicle(pos, quat) {
  if (!playerChassis) return;
  // Use THREE.Vector3/Quaternion values
  playerChassis.position.set(pos.x, pos.y, pos.z);
  playerChassis.quaternion.set(quat.x, quat.y, quat.z, quat.w);
  playerChassis.velocity.set(0, 0, 0);
  playerChassis.angularVelocity.set(0, 0, 0);
}
