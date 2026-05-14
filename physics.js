/**
 * physics.js – Cannon-es physics engine for Nitro Seed
 * Handles: world, vehicle, weapons (rocket/oil/boost), flip recovery, wall bodies
 */
import * as CANNON from 'cannon-es';

// ── World ─────────────────────────────────────────────────────────────────
let world;
export let groundMat, vehicleMat, wallMat;
export let onVehicleImpact = null; // callback(victimId, impulse, worldPoint)

export function initPhysics() {
  world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = false;

  groundMat = new CANNON.Material('ground');
  vehicleMat = new CANNON.Material('vehicle');
  wallMat = new CANNON.Material('wall');

  world.addContactMaterial(
    new CANNON.ContactMaterial(groundMat, vehicleMat, {
      friction: 0.4,
      restitution: 0.0,
    })
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(wallMat, vehicleMat, {
      friction: 0.15,
      restitution: 0.35,
    })
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(groundMat, groundMat, {
      friction: 0.3,
      restitution: 0.0,
    })
  );

  world.addContactMaterial(
    new CANNON.ContactMaterial(vehicleMat, vehicleMat, {
      friction: 0.1,
      restitution: 0.3,
    })
  );

  // Physical Safety Floor (Ground Level)
  const floorBody = new CANNON.Body({ mass: 0, material: groundMat });
  floorBody.isFloorBody = true;
  floorBody.addShape(new CANNON.Plane());
  floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  floorBody.position.y = 0.0; // Solid ground at y=0
  world.addBody(floorBody);

  return world;
}

export function getWorld() {
  return world;
}

// ── Vehicle Tuning ────────────────────────────────────────────────────────
export const VEHICLE_CLASSES = {
  'dacia_duster_low_poly': {
    mass: 1400,
    engineForce: 4500,
    maxSpeed: 30, // m/s (108 km/h)
    frontFric: 5.5,
    rearFric: 4.5,
    suspensionStiffness: 25,
    suspensionRestLength: 0.4,
    rollInfluence: 0.1,
  },
  'police_car': {
    mass: 1800,
    engineForce: 6000,
    maxSpeed: 38, // 136 km/h
    frontFric: 6.0,
    rearFric: 5.0,
    suspensionStiffness: 35,
    suspensionRestLength: 0.3,
    rollInfluence: 0.05,
  },
  'retro_anime_suzuki_alto': {
    mass: 700,
    engineForce: 3500,
    maxSpeed: 32, // 115 km/h
    frontFric: 4.0,
    rearFric: 3.0,
    suspensionStiffness: 20,
    suspensionRestLength: 0.25,
    rollInfluence: 0.15,
  },
  'volkswagen_golf_gti_1976': {
    mass: 900,
    engineForce: 4500,
    maxSpeed: 35, // 126 km/h
    frontFric: 5.0,
    rearFric: 4.5,
    suspensionStiffness: 30,
    suspensionRestLength: 0.2,
    rollInfluence: 0.08,
  },
  'volvo_240': {
    mass: 1300,
    engineForce: 4800,
    maxSpeed: 34, // 122 km/h
    frontFric: 5.0,
    rearFric: 4.0,
    suspensionStiffness: 28,
    suspensionRestLength: 0.3,
    rollInfluence: 0.12,
  }
};

const MAX_BRAKE = 120; // N, peak brake force
const MAX_STEER = 0.5; // rad, max steering angle
const COUNTER_FRIC = 5.5; // frictionSlip bonus when counter-steering
const BOOST_IMPULSE = 3500; // N·s, boost weapon impulse
const EXPL_RADIUS = 8; // m, rocket explosion blast radius
const EXPL_FORCE = 550; // N, rocket explosion peak force
const EXPL_VERT_POP = 0.15; // fraction of force applied upward
const OIL_DURATION = 2000; // ms, oil slick effect duration
const OIL_FRICTION = 0.1; // frictionSlip while oiled

// ── Player Vehicle ────────────────────────────────────────────────────────
export let playerVehicle = null;
export let playerChassis = null;
export let playerCarSpecs = null;
export let driveMode = '4WD'; // 'FWD', 'RWD', '4WD'

export function setDriveMode(mode) {
  driveMode = mode;
}

let flipTimer = 0;
const FLIP_THRESH = 0.25;
const FLIP_RECOVERY = 2.0;

const allVehicleBodies = [];
const remoteVehicles = {};

// ── Pre-allocated temp vectors (avoid per-frame GC pressure) ──────────────
const _tmpRight = new CANNON.Vec3();
const _tmpFwd = new CANNON.Vec3();
const _tmpUp = new CANNON.Vec3();
const _tmpWorldUp = new CANNON.Vec3(0, 1, 0);

function _addVanShapes(body) {
  // Tightened hitbox: 1.64m wide, 0.9m tall, 3.5m long
  const chassisShape = new CANNON.Box(new CANNON.Vec3(0.82, 0.45, 1.75));
  body.addShape(chassisShape, new CANNON.Vec3(0, 0, 0));

  // Cabin is narrower to allow for more lean in corners
  const cabinShape = new CANNON.Box(new CANNON.Vec3(0.65, 0.35, 0.85));
  body.addShape(cabinShape, new CANNON.Vec3(0, 0.8, 0));
}

export function createPlayerVehicle(startPos, startQuat, carModel) {
  playerCarSpecs = VEHICLE_CLASSES[carModel] || VEHICLE_CLASSES['dacia_duster_low_poly'];
  playerChassis = new CANNON.Body({ mass: playerCarSpecs.mass, material: vehicleMat });
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
    indexRightAxis: 0,
    indexUpAxis: 1,
    indexForwardAxis: 2,
  });

  const wheelOpts = {
    radius: 0.38,
    directionLocal: new CANNON.Vec3(0, -1, 0),
    axleLocal: new CANNON.Vec3(-1, 0, 0),
    suspensionStiffness: playerCarSpecs.suspensionStiffness,
    suspensionRestLength: playerCarSpecs.suspensionRestLength,
    frictionSlip: 1.8,
    dampingRelaxation: 2.0,
    dampingCompression: 4.5,
    maxSuspensionForce: 100000,
    rollInfluence: 0.01,
    maxSuspensionTravel: 0.6,
    customSlidingRotationalSpeed: -30,
    useCustomSlidingRotationalSpeed: true,
  };

  // Wheels: [Front Left, Front Right, Rear Left, Rear Right]
  // Forward is now +Z. Steering wheels at 1.4, Rear wheels at -1.4
  [
    [-0.9, -0.05, 1.4],
    [0.9, -0.05, 1.4],
    [-0.9, -0.05, -1.4],
    [0.9, -0.05, -1.4],
  ].forEach(([x, y, z]) => {
    playerVehicle.addWheel({ ...wheelOpts, chassisConnectionPointLocal: new CANNON.Vec3(x, y, z) });
  });

  playerVehicle.addToWorld(world);
  playerChassis._vehicleRef = playerVehicle;
  playerChassis.peerId = '__local__';

  playerChassis.addEventListener('collide', e => {
    const other = e.body;
    if (other.peerId && other.peerId !== '__local__') {
      const contact = e.contact;
      const impactVel = contact.getImpactVelocityAlongNormal();
      
      // DEBUG: console.log(`Collision with ${other.peerId}, impactVel: ${impactVel.toFixed(2)}`);

      if (impactVel > 1.5) {
        const impulseMag = impactVel * playerChassis.mass * 1.2; // Increased from 0.4 for punchier hits
        const point = { x: contact.bj.position.x + contact.rj.x, y: contact.bj.position.y + contact.rj.y, z: contact.bj.position.z + contact.rj.z };
        // Add a slight upward pop (0.1) to make the car tumble more realistically
        const impulse = { 
          x: contact.ni.x * impulseMag, 
          y: contact.ni.y * impulseMag + (impulseMag * 0.1), 
          z: contact.ni.z * impulseMag 
        };
        if (onVehicleImpact) onVehicleImpact(other.peerId, impulse, point);
      }
    }
  });

  allVehicleBodies.push(playerChassis);
  return { vehicle: playerVehicle, chassis: playerChassis };
}

export function createRemoteVehicle(peerId, mass = 0, carModel) {
  const specs = VEHICLE_CLASSES[carModel] || VEHICLE_CLASSES['dacia_duster_low_poly'];
  const body = new CANNON.Body({
    mass: mass > 0 ? specs.mass : 1,
    material: vehicleMat,
    type: mass > 0 ? CANNON.Body.DYNAMIC : CANNON.Body.KINEMATIC,
  });
  body.isOiled = false;

  if (mass > 0) {
    // Disable native gravity ONLY for networked players to avoid vertical sagging against the network spring.
    // NPC/Test vehicles should keep gravity for realistic physics.
    if (peerId !== '__test_driver__') {
      body.preStep = () => {
        body.force.y -= body.mass * world.gravity.y;
      };
    }
    body.linearDamping = 0.4;
    body.angularDamping = 0.6;
  }

  _addVanShapes(body);
  world.addBody(body);
  body.peerId = peerId;
  remoteVehicles[peerId] = body;
  allVehicleBodies.push(body);
  return body;
}

export function syncRemoteBody(id, targetPos, targetQuat, targetVel, dt) {
  const body = remoteVehicles[id];
  if (!body || body.type === CANNON.Body.KINEMATIC) return;

  // 1. Position Spring-Damper (PD Controller)
  const posError = new CANNON.Vec3(
    targetPos.x - body.position.x,
    targetPos.y - body.position.y,
    targetPos.z - body.position.z
  );
  
  // Spring stiffness & damping
  // Increased stiffness to prevent cars from "ghosting" into each other during collisions
  const kP = body.mass * 600; 
  const kD = body.mass * 30;

  const springForce = new CANNON.Vec3();
  posError.scale(kP, springForce);
  
  // Damping relative to target velocity to reduce "dragging" feel
  const currentVel = body.velocity;
  const velError = new CANNON.Vec3(
    (targetVel ? targetVel.x : 0) - currentVel.x,
    (targetVel ? targetVel.y : 0) - currentVel.y,
    (targetVel ? targetVel.z : 0) - currentVel.z
  );
  
  const dampingForce = new CANNON.Vec3();
  velError.scale(kD, dampingForce);
  
  const totalForce = new CANNON.Vec3();
  // F = kP * posError + kD * velError
  springForce.vadd(dampingForce, totalForce);
  
  body.applyForce(totalForce, new CANNON.Vec3(0, 0, 0));

  // 2. Rotation Sync (Slerp)
  const tQuat = new CANNON.Quaternion(targetQuat.x, targetQuat.y, targetQuat.z, targetQuat.w);
  body.quaternion.slerp(tQuat, 0.3, body.quaternion);
  
  // Damp angular velocity to prevent wild spinning after physical impacts
  body.angularVelocity.scale(0.8, body.angularVelocity);
}

export function applyImpactImpulse(impulse, point) {
  if (!playerChassis) return;
  const i = new CANNON.Vec3(impulse.x, impulse.y, impulse.z);
  const p = new CANNON.Vec3(point.x, point.y, point.z);
  playerChassis.applyImpulse(i, p);
}

export function checkStrictCollisions() {
  // Only used by Host in STRICT mode to detect hits between any two vehicles
  for (const contact of world.contacts) {
    const bi = contact.bi;
    const bj = contact.bj;
    if (bi.peerId && bj.peerId) {
      const impactVel = contact.getImpactVelocityAlongNormal();
      if (impactVel > 4) {
        const impulseMag = impactVel * bi.mass * 1.2; // Increased from 0.4
        const point = { x: bj.position.x + contact.rj.x, y: bj.position.y + contact.rj.y, z: bj.position.z + contact.rj.z };
        const impulse = { 
          x: contact.ni.x * impulseMag, 
          y: contact.ni.y * impulseMag + (impulseMag * 0.1), 
          z: contact.ni.z * impulseMag 
        };
        if (onVehicleImpact) onVehicleImpact(bj.peerId, impulse, point);
      }
    }
  }
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

  // Add new chassis shape (tightened for better visual-physical alignment)
  const chassisShape = new CANNON.Box(new CANNON.Vec3(width * 0.49, 0.45, length * 0.49));
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

  // Get movement vectors for slip calculation (reuse pre-allocated temp vec)
  _tmpRight.set(1, 0, 0);
  playerChassis.quaternion.vmult(_tmpRight, _tmpRight);
  const lateralVel = playerChassis.velocity.dot(_tmpRight);
  const isTurning = input.left || input.right;
  const isSliding = speed > 20 && (Math.abs(lateralVel) > speed * 0.2 || (isTurning && speed > 28));

  let gear = 1,
    gearLimit = 30;
  if (kmh > 90) {
    gear = 4;
    gearLimit = 250;
  } else if (kmh > 60) {
    gear = 3;
    gearLimit = 90;
  } else if (kmh > 30) {
    gear = 2;
    gearLimit = 60;
  }

  const speedRatio = Math.min(speed / playerCarSpecs.maxSpeed, 1.0);
  const fScale = 1.0 - speedRatio * speedRatio * 0.5; // Steeper drop-off near top speed
  const steerAmt = MAX_STEER * Math.max(0.3, 1.0 - speedRatio * 0.45);

  let engineForce = 0,
    brakeForce = 0;

  if (input.forward) {
    engineForce = -playerCarSpecs.engineForce * fScale; // Flipped: forward is -Z

    // Only cut engine if NOT sliding. This allows recovery power
    if (kmh >= gearLimit && !isSliding) {
      engineForce *= Math.max(0, 1 - (kmh - gearLimit) / 5);
    } else {
      const torqueMult = [1.2, 1.0, 0.9, 0.8][gear - 1];
      engineForce *= torqueMult;
    }
  } else if (input.backward) {
    _tmpFwd.set(0, 0, 1);
    playerChassis.quaternion.vmult(_tmpFwd, _tmpFwd);
    if (playerChassis.velocity.dot(_tmpFwd) > 0.5) {
      brakeForce = Math.min((MAX_BRAKE * (speed * speed)) / 50, MAX_BRAKE);
    } else {
      engineForce = playerCarSpecs.engineForce * 0.5;
    }
  } else {
    brakeForce = 8;
  }

  // Flip steering sign because we are driving towards -Z
  // Left (A) = -X, which is Left when facing -Z
  const steer = input.left ? steerAmt : input.right ? -steerAmt : 0;

  // ── Drift & Steering Recovery Logic ──
  const BASE_FRONT_FRIC = playerCarSpecs.frontFric;
  const BASE_REAR_FRIC = playerCarSpecs.rearFric;

  if (!playerChassis.isOiled) {
    playerVehicle.wheelInfos[0].frictionSlip = BASE_FRONT_FRIC;
    playerVehicle.wheelInfos[1].frictionSlip = BASE_FRONT_FRIC;
    playerVehicle.wheelInfos[2].frictionSlip = BASE_REAR_FRIC;
    playerVehicle.wheelInfos[3].frictionSlip = BASE_REAR_FRIC;
  }

  const currentRoll = playerCarSpecs.rollInfluence + speedRatio * 0.05;
  playerVehicle.wheelInfos.forEach(w => (w.rollInfluence = currentRoll));

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
    // Rally AWD Bias: 100% Rear, 40% Front to kick the tail out
    playerVehicle.applyEngineForce(engineForce, 2);
    playerVehicle.applyEngineForce(engineForce, 3);
    playerVehicle.applyEngineForce(engineForce * 0.4, 0);
    playerVehicle.applyEngineForce(engineForce * 0.4, 1);
  }

  // 50/50 Brake Bias: Even distribution prevents front wheels from locking and pitching the car over
  playerVehicle.setBrake(brakeForce * 0.6, 0);
  playerVehicle.setBrake(brakeForce * 0.6, 1);
  playerVehicle.setBrake(brakeForce * 0.6, 2);
  playerVehicle.setBrake(brakeForce * 0.6, 3);
}

// ── Flip Recovery ─────────────────────────────────────────────────────────
export function checkFlip(dt) {
  if (!playerChassis) return { flipping: false, recovered: false };
  _tmpUp.set(0, 1, 0);
  playerChassis.quaternion.vmult(_tmpUp, _tmpUp);
  const uprightness = _tmpUp.dot(_tmpWorldUp);

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
  _tmpFwd.set(0, 0, 1);
  playerChassis.quaternion.vmult(_tmpFwd, _tmpFwd);
  playerChassis.applyImpulse(_tmpFwd.scale(BOOST_IMPULSE), new CANNON.Vec3(0, 0, 0));
}

// ── Rockets ───────────────────────────────────────────────────────────────
const activeRockets = [];

export function fireRocket(startPos, startQuat, onExplode, ownerBody) {
  const fwd = new CANNON.Vec3(0, 0, 1);
  startQuat.vmult(fwd, fwd);
  const pos = startPos.clone();
  // Spawn further ahead to prevent rocket appearing beside the car
  pos.x += fwd.x * 3.5;
  pos.y = 0.75;
  pos.z += fwd.z * 3.5;

  const body = new CANNON.Body({ mass: 0.5, linearDamping: 0.05, collisionResponse: false });
  body.isRocket = true;
  body.preStep = () => {
    body.force.y -= body.mass * world.gravity.y;
  };
  body.addShape(new CANNON.Sphere(0.25));
  body.position.copy(pos);

  const relativeVel = fwd.scale(41.67);
  if (ownerBody) {
    body.velocity.set(
      ownerBody.velocity.x + relativeVel.x,
      ownerBody.velocity.y + relativeVel.y,
      ownerBody.velocity.z + relativeVel.z
    );
  } else {
    body.velocity.copy(relativeVel);
  }

  world.addBody(body);
  const rocket = { body, life: 6.0, dead: false, onCleanup: null, owner: ownerBody };
  body.addEventListener('collide', e => {
    if (rocket.dead || e.body.isRocket || (ownerBody && e.body === ownerBody)) return;
    rocket.dead = true;
    _explodeRocket(body.position.clone(), onExplode, rocket);
  });
  activeRockets.push(rocket);
  return rocket;
}

function _explodeRocket(pos, onExplode, rocket) {
  const ownerBody = rocket?.owner;
  allVehicleBodies.forEach(body => {
    if (ownerBody && body === ownerBody) return;
    const diff = body.position.vsub(pos);
    const dist = diff.length();
    if (dist < EXPL_RADIUS) {
      const power = EXPL_FORCE / (dist + 1.0);
      const impulse = diff.scale(power);
      impulse.y += power * EXPL_VERT_POP; // Vertical pop

      const offset = diff.unit().scale(-0.5);
      offset.y += 0.8;
      body.applyImpulse(impulse, body.position.vadd(offset)); // Offset for roll/pitch
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
  if (quaternion) {
    quaternion.vmult(fwd, fwd);
    body.quaternion.copy(quaternion);
  }
  body.position.set(position.x - fwd.x * 3.0, position.y - 0.1, position.z - fwd.z * 3.0);
  world.addBody(body);

  const slick = { body, life: 10.0, hits: new Set() };
  body.addEventListener('collide', e => {
    const hit = e.body;
    if (!hit._vehicleRef || slick.hits.has(hit)) return;
    slick.hits.add(hit);
    const v = hit._vehicleRef;
    hit.isOiled = true;
    v.wheelInfos.forEach(w => (w.frictionSlip = OIL_FRICTION));
    setTimeout(() => {
      hit.isOiled = false;
      v.wheelInfos.forEach(w => (w.frictionSlip = playerCarSpecs ? playerCarSpecs.frontFric : 5.0));
      slick.hits.delete(hit);
    }, OIL_DURATION);
  });
  activeOilSlicks.push(slick);
  return slick;
}

export function raycastForward(body) {
  if (!body) return null;
  const fwd = new CANNON.Vec3(0, 0, 1);
  body.quaternion.vmult(fwd, fwd);
  const from = new CANNON.Vec3(
    body.position.x + fwd.x * 2.0,
    body.position.y + 0.75,
    body.position.z + fwd.z * 2.0
  );
  const to = new CANNON.Vec3(from.x + fwd.x * 100, from.y + fwd.y * 100, from.z + fwd.z * 100);
  const result = new CANNON.RaycastResult();
  world.raycastClosest(from, to, {}, result);
  return result.hasHit ? result.hitPointWorld : to;
}

// ── Physics Step ──────────────────────────────────────────────────────────
export function stepPhysics(dt) {
  world.step(1 / 60, dt, 10);
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
  const bodiesToRemove = world.bodies.filter(b => !b.isFloorBody);
  bodiesToRemove.forEach(b => world.removeBody(b));
  activeRockets.length = 0;
  activeOilSlicks.length = 0;
  allVehicleBodies.length = 0;
  playerVehicle = null;
  playerChassis = null;
  flipTimer = 0; // Prevent phantom flip-recovery HUD on next race
  driveMode = '4WD'; // Reset to default drive mode
}

export function getActiveRockets() {
  return activeRockets;
}
export function getActiveOilSlicks() {
  return activeOilSlicks;
}
export function getFlipProgress() {
  return { timer: flipTimer, max: FLIP_RECOVERY };
}
export function resetVehicle(pos, quat) {
  if (!playerChassis) return;
  // Use THREE.Vector3/Quaternion values
  playerChassis.position.set(pos.x, pos.y, pos.z);
  playerChassis.quaternion.set(quat.x, quat.y, quat.z, quat.w);
  playerChassis.velocity.set(0, 0, 0);
  playerChassis.angularVelocity.set(0, 0, 0);
  playerChassis._closestT = undefined; // Reset wrong-way detection cache
}
