/**
 * physics.js – Cannon-es physics engine for Nitro Seed
 * Handles: world, vehicle, weapons (rocket/oil/boost), flip recovery, wall bodies
 */
import * as CANNON from 'cannon-es';
import * as Network from './network.js';

// ── World ─────────────────────────────────────────────────────────────────
export let world;
export let groundMat, vehicleMat, wallMat;

export const CGROUP_DEFAULT = 1;
export const CGROUP_LOCAL_CAR = 2;
export const CGROUP_REMOTE_CAR = 4;
export const CGROUP_ROCKET = 8;

let _onVehicleImpact = null;
export function setOnVehicleImpact(cb) {
  _onVehicleImpact = cb;
}

export function initPhysics() {
  world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = false;

  groundMat = new CANNON.Material('ground');
  vehicleMat = new CANNON.Material('vehicle');
  wallMat = new CANNON.Material('wall');

  world.addContactMaterial(
    new CANNON.ContactMaterial(groundMat, vehicleMat, {
      friction: 0.05, // Lowered friction so remote cars slide when hit
      restitution: 0.0,
    })
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(wallMat, vehicleMat, {
      friction: 0.0,
      restitution: 0.1,
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
      friction: 0.0, // NO friction between cars so they don't grab and flip sideways!
      restitution: 0.1, 
      contactEquationStiffness: 1e5, // Soft constraint! Prevents explosive bouncing when network lag causes overlapping!
      contactEquationRelaxation: 4,
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
export let driveMode = '4WD'; // '4WD', 'RWD', 'FWD'
export let handlingMode = 'Arcade'; // 'Arcade', 'Rally'
export let collisionMode = 'fast';

export function setDriveMode(mode) {
  driveMode = mode;
}

export function setHandlingMode(mode) {
  handlingMode = mode;
}

export function setCollisionMode(mode) {
  collisionMode = mode;
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

const _tmpDriftForce1 = new CANNON.Vec3();
const _tmpDriftForce2 = new CANNON.Vec3();

function _addVanShapes(body) {
  // Use 3 overlapping spheres to create a perfectly smooth "Capsule" chassis.
  const r = 0.82; // Half the car's width (1.64m / 2)
  const zOffset = 1.75 - r; // Push to the front and back
  
  const sphereShape = new CANNON.Sphere(r);
  const sy = 0.5; // increased ground clearance (was 0.2) to prevent bottoming out!

  body.addShape(sphereShape, new CANNON.Vec3(0, sy, zOffset));
  body.addShape(sphereShape, new CANNON.Vec3(0, sy, 0));
  body.addShape(sphereShape, new CANNON.Vec3(0, sy, -zOffset));

  // Cabin is narrower to allow for more lean in corners
  const cabinShape = new CANNON.Box(new CANNON.Vec3(0.65, 0.35, 0.85));
  body.addShape(cabinShape, new CANNON.Vec3(0, 0.8 + sy, 0));
  
  body.updateMassProperties();
}

export function createPlayerVehicle(startPos, startQuat, carModel) {
  playerCarSpecs = VEHICLE_CLASSES[carModel] || VEHICLE_CLASSES['dacia_duster_low_poly'];
  playerChassis = new CANNON.Body({ mass: playerCarSpecs.mass, material: vehicleMat });
  playerChassis.isOiled = false;
  _addVanShapes(playerChassis);

  // Chassis shape offset is 0.4. Suspension adds ~0.5. Wheels are 0.38 radius.
  // Set chassis so wheels are exactly touching the ground.
  playerChassis.position.set(startPos.x, startPos.y + 0.95, startPos.z);
  if (startQuat) {
    playerChassis.quaternion.copy(startQuat);
  }
  playerChassis.linearDamping = 0.08;
  playerChassis.angularDamping = 0.15;
  playerChassis.collisionFilterGroup = CGROUP_LOCAL_CAR;
  playerChassis.collisionFilterMask = CGROUP_DEFAULT | CGROUP_LOCAL_CAR | CGROUP_REMOTE_CAR | CGROUP_ROCKET;

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

  // Settle the suspension instantly before the first render so the car doesn't visibly drop
  for (let i = 0; i < 60; i++) {
    world.step(1 / 60);
  }
  
  // Reset velocities just in case the settle caused a bounce
  playerChassis.velocity.set(0, 0, 0);
  playerChassis.angularVelocity.set(0, 0, 0);

  const _tmpPushDir = new CANNON.Vec3();
  
  playerChassis.addEventListener('collide', e => {
    const other = e.body;
    if (other.peerId && other.peerId !== '__local__') {
      const contact = e.contact;
      
      const now = performance.now();
      if (now - (other._lastHitTime || 0) < 300) return; // 300ms cooldown to prevent multi-hit drain
      
      const impactVel = Math.min(contact.getImpactVelocityAlongNormal(), 30);
      
      if (impactVel > 1.0) {
        if (now - (other._lastHitTime || 0) > 300) {
          // Mark BOTH cars as recently hit
          other._lastHitTime = now;
          playerChassis._lastHitTime = now;
          
          // 1. Calculate the horizontal direction of the impact
          _tmpPushDir.set(other.position.x - playerChassis.position.x, 0, other.position.z - playerChassis.position.z);
          _tmpPushDir.normalize();
          
          // 2. Calculate the velocity bump to send to the victim
          let bumpSpeed = 1.0 + (impactVel * 0.15); 
          bumpSpeed = Math.min(bumpSpeed, 5.0);
          
          let bumpVel = {x: _tmpPushDir.x * bumpSpeed, y: 0, z: _tmpPushDir.z * bumpSpeed};
          let bumpAngVel = null;

          // === PHYSICS-BASED IMPULSE (used by smooth, predict, dynamic, authoritative) ===
          if (collisionMode === 'smooth' || collisionMode === 'predict' || collisionMode === 'dynamic' || collisionMode === 'authoritative') {
            const contact = e.contact;
            const impulseMag = Math.min(impactVel * playerChassis.mass * 0.8, 45000);
            const victimMass = other.mass || 1000;
            const dvMag = impulseMag / victimMass;
            
            // Physical Linear Velocity Delta
            bumpVel = {
              x: contact.ni.x * dvMag,
              y: Math.min(contact.ni.y * dvMag + (dvMag * 0.1), 5),
              z: contact.ni.z * dvMag
            };
            
            // Physical Angular Velocity Delta (Torque = r x F)
            const rj = contact.rj;
            const tx = rj.y * contact.ni.z - rj.z * contact.ni.y;
            const ty = rj.z * contact.ni.x - rj.x * contact.ni.z;
            const tz = rj.x * contact.ni.y - rj.y * contact.ni.x;
            
            const spinFactor = impulseMag / (victimMass * 2.0);
            bumpAngVel = {
              x: tx * spinFactor,
              y: ty * spinFactor,
              z: tz * spinFactor
            };

            if (window.logCollisionEvent) {
              window.logCollisionEvent('LOCAL_COLLIDE', { 
                attackerId: '__local__', 
                victimId: other.peerId, 
                bumpVel, 
                bumpAngVel,
                impactVel,
                mode: collisionMode
              });
            }
          }

          // === MODE-SPECIFIC LOCAL DUMMY BEHAVIOR ===
          if (collisionMode === 'smooth' || collisionMode === 'dynamic') {
            // SMOOTH & DYNAMIC: Switch remote body to DYNAMIC, apply impulse, let CANNON simulate
            const victimMass = other.mass || 1000;
            if (other.type !== CANNON.Body.DYNAMIC) {
              other.type = CANNON.Body.DYNAMIC;
              other.mass = victimMass;
              other.updateMassProperties();
            }
            // DYNAMIC mode: use low damping so physics actually works
            if (collisionMode === 'dynamic') {
              other.linearDamping = 0.05;
              other.angularDamping = 0.1;
            }
            // Apply forces INSTANTLY to local dummy
            other.velocity.x += bumpVel.x;
            other.velocity.y += bumpVel.y;
            other.velocity.z += bumpVel.z;
            if (bumpAngVel) {
              other.angularVelocity.x += bumpAngVel.x;
              other.angularVelocity.y += bumpAngVel.y;
              other.angularVelocity.z += bumpAngVel.z;
            }
          } else if (collisionMode === 'predict') {
            // PREDICT: Ping-based prediction + blend. No DYNAMIC switch.
            const ping = Network.getPingTo(other.peerId) || 50;
            const predictDur = Math.max(ping, 50); // min 50ms to prevent glitches
            
            // Calculate where it will be at the end of the ping window
            const predictionTimeSec = predictDur / 1000;
            other._predictedEndPos = new CANNON.Vec3(
              other.position.x + bumpVel.x * predictionTimeSec,
              other.position.y + Math.max(0, bumpVel.y * predictionTimeSec * 0.3),
              other.position.z + bumpVel.z * predictionTimeSec
            );
            other._predictStartPos = new CANNON.Vec3().copy(other.position);
            other._predictStartTime = now;
            other._predictDuration = predictDur; // Phase 1: Blind prediction
            other._predictBlendDuration = 200; // Phase 2: Smooth blend back to network
            
            // During phase 1, we still calculate live _predictedPos frame by frame
            other._predictBumpVel = bumpVel;
          } else if (collisionMode === 'authoritative') {
            // AUTHORITATIVE: No CANNON physics on the dummy at all.
            // Set a visual bump animation offset that decays over time.
            other._visualBumpVel = { x: bumpVel.x * 0.3, y: 0, z: bumpVel.z * 0.3 };
            other._visualBumpStartTime = now;
            other._visualBumpDuration = 400; // ms
          } else {
            // FAST mode: activate anti-spin assist
            playerChassis._hitDampTime = now;
          }
          
          // Broadcast this velocity/angular bump to the victim so their game applies it
          if (_onVehicleImpact) {
            _onVehicleImpact(other.peerId, bumpVel, null, bumpAngVel);
          }
        }
      }
    }
  });

  allVehicleBodies.push(playerChassis);
  return { vehicle: playerVehicle, chassis: playerChassis };
}

export function createRemoteVehicle(peerId, mass = 0, carModel, spawnPos = null, spawnQuat = null) {
  // Use real CANNON physics! DYNAMIC bodies, accurate mass.
  const spec = VEHICLE_CLASSES[carModel] || VEHICLE_CLASSES['dacia_duster_low_poly'];
  const realMass = spec.mass;

  // High damping for real network players because we manually lerp them.
  // Dummy cars should use normal physics damping so they slide naturally.
  const isDummy = peerId.startsWith('__dummy_');
  const body = new CANNON.Body({
    mass: realMass, 
    material: vehicleMat,
    type: CANNON.Body.DYNAMIC,
    linearDamping: isDummy ? 0.05 : 0.9,
    angularDamping: isDummy ? 0.05 : 0.9
  });
  // Enable native collisions so they physically push each other apart!
  body.collisionResponse = true; 
  body.collisionFilterGroup = CGROUP_REMOTE_CAR;
  // Let them hit EVERYTHING: ground, walls, local cars, rockets
  body.collisionFilterMask = CGROUP_DEFAULT | CGROUP_LOCAL_CAR | CGROUP_ROCKET | CGROUP_REMOTE_CAR;
  body.peerId = peerId;
  body.carModel = carModel;
  body.isOiled = false;
  _addVanShapes(body);

  // Set spawn position BEFORE adding to world to avoid origin collisions
  if (spawnPos) {
    body.position.set(spawnPos.x, spawnPos.y, spawnPos.z);
  }
  if (spawnQuat) {
    body.quaternion.set(spawnQuat.x, spawnQuat.y, spawnQuat.z, spawnQuat.w);
  }

  const tp = spawnPos || { x: 0, y: 0, z: 0 };
  const tq = spawnQuat || { x: 0, y: 0, z: 0, w: 1 };
  
  body.targetPos = new CANNON.Vec3(tp.x, tp.y, tp.z);
  body.targetQuat = new CANNON.Quaternion(tq.x, tq.y, tq.z, tq.w);
  body.targetVel = new CANNON.Vec3(0, 0, 0);

  world.addBody(body);
  body.peerId = peerId;
  remoteVehicles[peerId] = body;
  allVehicleBodies.push(body);
  return body;
}

export function syncRemoteBody(id, targetPos, targetQuat, targetVel, dt) {
  const body = remoteVehicles[id];
  if (!body) return;

  const now = performance.now();



  // === AUTHORITATIVE MODE: Always follow network state, no suspension ===
  if (collisionMode === 'authoritative') {
    body.targetPos.set(targetPos.x, targetPos.y, targetPos.z);
    body.targetQuat.set(targetQuat.x, targetQuat.y, targetQuat.z, targetQuat.w);
    if (targetVel) {
      body.targetVel.set(targetVel.x, targetVel.y, targetVel.z);
    } else {
      body.targetVel.set(0, 0, 0);
    }
    return;
  }

  // === SMOOTH & DYNAMIC & FAST & STRICT: Use suspension mechanism ===
  const suspensionTime = collisionMode === 'dynamic' ? 1000 : (collisionMode === 'smooth' ? 800 : 400);
  
  if (collisionMode !== 'predict' && now - (body._lastHitTime || 0) < suspensionTime) {
    if (collisionMode === 'dynamic') {
      // DYNAMIC: Let CANNON simulate freely. Write physics state back to network state.
      // Also handle soft-landing: blend lerp alpha gradually in the last 300ms
      const elapsed = now - (body._lastHitTime || 0);
      const blendStart = suspensionTime - 300;
      
      if (elapsed > blendStart) {
        // SOFT LANDING: gradually blend back toward network target
        const blendT = (elapsed - blendStart) / 300; // 0 → 1
        const blendAlpha = blendT * 0.15; // max alpha = 0.15 during blend
        body.position.lerp(new CANNON.Vec3(targetPos.x, targetPos.y, targetPos.z), blendAlpha, body.position);
        // Gradually restore high damping
        body.linearDamping = 0.05 + blendT * 0.85;
        body.angularDamping = 0.1 + blendT * 0.8;
      }
      
      // Write physics state UP to network state to prevent snap-back
      targetPos.x = body.position.x;
      targetPos.y = body.position.y;
      targetPos.z = body.position.z;
      targetQuat.x = body.quaternion.x;
      targetQuat.y = body.quaternion.y;
      targetQuat.z = body.quaternion.z;
      targetQuat.w = body.quaternion.w;
      body.targetPos.copy(body.position);
      body.targetQuat.copy(body.quaternion);
      if (targetVel) body.targetVel.copy(body.velocity);
      return;
    }
    
    // SMOOTH / FAST / STRICT: original suspension behavior (write-back)
    targetPos.x = body.position.x;
    targetPos.y = body.position.y;
    targetPos.z = body.position.z;
    targetQuat.x = body.quaternion.x;
    targetQuat.y = body.quaternion.y;
    targetQuat.z = body.quaternion.z;
    targetQuat.w = body.quaternion.w;
    body.targetPos.copy(body.position);
    body.targetQuat.copy(body.quaternion);
    if (targetVel) body.targetVel.copy(body.velocity);
    return;
  }

  // Suspension is over, or it's not suspended. Make sure it's KINEMATIC so it acts like a ghost again!
  if (body.type !== CANNON.Body.KINEMATIC) {
    body.type = CANNON.Body.KINEMATIC;
    body.mass = 0;
    body.updateMassProperties();
    // Restore high damping after dynamic mode
    body.linearDamping = 0.9;
    body.angularDamping = 0.9;
  }

  // Normal behavior: Store the targets so the update loop can lerp the body smoothly
  body.targetPos.set(targetPos.x, targetPos.y, targetPos.z);
  body.targetQuat.set(targetQuat.x, targetQuat.y, targetQuat.z, targetQuat.w);
  if (targetVel) {
    body.targetVel.set(targetVel.x, targetVel.y, targetVel.z);
  } else {
    body.targetVel.set(0, 0, 0);
  }
}

export function applyCounterBump(attackerId, bumpVel, bumpAngVel = null) {
  const dummy = remoteVehicles[attackerId];
  if (!dummy) return;

  const now = performance.now();
  if (now - (dummy._lastHitTime || 0) < 400) return;
  
  if (window.logCollisionEvent) {
    window.logCollisionEvent('APPLY_COUNTER_BUMP', { attackerId, bumpVel, bumpAngVel });
  }

  // Suspend network lerp so CANNON can physically simulate the recoil
  dummy._lastHitTime = performance.now();
  
  // === MODE-SPECIFIC LOCAL DUMMY BEHAVIOR ===
  if (collisionMode === 'smooth' || collisionMode === 'dynamic') {
    // SMOOTH & DYNAMIC: Switch remote body to DYNAMIC, apply impulse, let CANNON simulate
    if (dummy.type !== CANNON.Body.DYNAMIC) {
      dummy.type = CANNON.Body.DYNAMIC;
      dummy.mass = 1000;
      dummy.updateMassProperties();
    }
    // DYNAMIC mode: use low damping so physics actually works
    if (collisionMode === 'dynamic') {
      dummy.linearDamping = 0.05;
      dummy.angularDamping = 0.1;
    }
    // Apply equal and opposite reaction to the dummy car
    dummy.velocity.x -= bumpVel.x;
    dummy.velocity.y -= (bumpVel.y || 0);
    dummy.velocity.z -= bumpVel.z;
    if (bumpAngVel) {
      dummy.angularVelocity.x -= bumpAngVel.x;
      dummy.angularVelocity.y -= bumpAngVel.y;
      dummy.angularVelocity.z -= bumpAngVel.z;
    }
  } else if (collisionMode === 'predict') {
    // PREDICT: Ping-based prediction + blend. No DYNAMIC switch.
    const ping = Network.getPingTo(attackerId) || 50;
    const predictDur = Math.max(ping, 50); // min 50ms
    
    const predictionTimeSec = predictDur / 1000;
    dummy._predictedEndPos = new CANNON.Vec3(
      dummy.position.x - bumpVel.x * predictionTimeSec,
      dummy.position.y - Math.max(0, bumpVel.y * predictionTimeSec * 0.3),
      dummy.position.z - bumpVel.z * predictionTimeSec
    );
    dummy._predictStartPos = new CANNON.Vec3().copy(dummy.position);
    dummy._predictStartTime = now;
    dummy._predictDuration = predictDur;
    dummy._predictBlendDuration = 200;
    dummy._predictBumpVel = { x: -bumpVel.x, y: -bumpVel.y, z: -bumpVel.z };
  } else if (collisionMode === 'authoritative') {
    // AUTHORITATIVE: No CANNON physics on the dummy at all.
    // Set a visual bump animation offset that decays over time.
    dummy._visualBumpVel = { x: -bumpVel.x * 0.3, y: 0, z: -bumpVel.z * 0.3 };
    dummy._visualBumpStartTime = now;
    dummy._visualBumpDuration = 400; // ms
  }
}

const pendingBumps = [];
let _onNetworkBumpApplied = null;
export function setOnNetworkBumpApplied(cb) {
  _onNetworkBumpApplied = cb;
}

export function applyNetworkBump(bumpVel, bumpAngVel = null, attackerId = null) {
  if (!playerChassis) return;
  pendingBumps.push({ bumpVel, bumpAngVel, attackerId, time: performance.now() });
}

export function _doApplyNetworkBump(bumpVel, bumpAngVel, attackerId) {
  if (!playerChassis) return;
  
  const now = performance.now();
  // Prevent double bouncing if we already collided locally within the last 500ms
  if (now - (playerChassis._lastHitTime || 0) < 500) return;
  if (now - (playerChassis._lastNetBumpTime || 0) < 400) return;
  playerChassis._lastNetBumpTime = now;
  
  if (window.logCollisionEvent) {
    window.logCollisionEvent('APPLY_NETWORK_BUMP', { bumpVel, bumpAngVel, mode: collisionMode });
  }

  // Apply the velocity bump directly
  playerChassis.velocity.x += bumpVel.x;
  playerChassis.velocity.y += (bumpVel.y || 0);
  playerChassis.velocity.z += bumpVel.z;
  
  // Apply angular velocity bump if provided
  if (bumpAngVel) {
    playerChassis.angularVelocity.x += bumpAngVel.x;
    playerChassis.angularVelocity.y += bumpAngVel.y;
    playerChassis.angularVelocity.z += bumpAngVel.z;
  }
  
  // Lock out our own local collide event for 500ms so we don't bounce twice
  playerChassis._lastHitTime = performance.now();
  
  // Only apply heavy anti-spin assist in fast/strict modes
  if (collisionMode === 'fast' || collisionMode === 'strict') {
    playerChassis._hitDampTime = performance.now();
    playerChassis.angularVelocity.y *= 0.1;
  }

  // Universal: Apply counter bump to attacker's dummy car
  if (attackerId) {
    applyCounterBump(attackerId, bumpVel, bumpAngVel);
  }

  if (_onNetworkBumpApplied) _onNetworkBumpApplied();
}

export function processNetworkBumps() {
  while (pendingBumps.length > 0) {
    const bump = pendingBumps.shift();
    _doApplyNetworkBump(bump.bumpVel, bump.bumpAngVel, bump.attackerId);
  }
}

export function updateRemoteVehicles() {
  const now = performance.now();
  // Lerp remote vehicles smoothly
  for (const id in remoteVehicles) {
    const rBody = remoteVehicles[id];
    
    if (rBody.targetPos) {
      // Free-physics NPC car: Don't lerp it to any target position, let CANNON.js simulate it fully locally!
      if (id === '__test_driver__' || id.startsWith('__dummy_')) {
        continue;
      }

      // === PREDICT MODE: Interpolate locally every frame ===
      if (collisionMode === 'predict' && rBody._predictStartPos) {
        const elapsed = now - rBody._predictStartTime;
        
        if (elapsed < rBody._predictDuration) {
          // Phase 1: Blind prediction (using Ping duration)
          const elapsedSec = elapsed / 1000;
          const px = rBody._predictStartPos.x + rBody._predictBumpVel.x * elapsedSec;
          const py = rBody._predictStartPos.y + rBody._predictBumpVel.y * elapsedSec;
          const pz = rBody._predictStartPos.z + rBody._predictBumpVel.z * elapsedSec;
          rBody.position.set(px, py, pz);
          rBody.quaternion.slerp(rBody.targetQuat, 0.3, rBody.quaternion);
          continue;
        } 
        else if (elapsed < rBody._predictDuration + rBody._predictBlendDuration) {
          // Phase 2: Smooth blend back to network reality
          const blendElapsed = elapsed - rBody._predictDuration;
          const t = blendElapsed / rBody._predictBlendDuration;
          const alpha = 1 - Math.pow(1 - t, 2); // Ease-out
          
          const px = rBody._predictedEndPos.x + (rBody.targetPos.x - rBody._predictedEndPos.x) * alpha;
          const py = rBody._predictedEndPos.y + (rBody.targetPos.y - rBody._predictedEndPos.y) * alpha;
          const pz = rBody._predictedEndPos.z + (rBody.targetPos.z - rBody._predictedEndPos.z) * alpha;
          
          rBody.position.set(px, py, pz);
          rBody.quaternion.slerp(rBody.targetQuat, 0.3, rBody.quaternion);
          continue;
        }
        else {
          // Phase 3: Prediction finished
          rBody._predictStartPos = null;
          rBody._predictedEndPos = null;
          rBody._predictBumpVel = null;
        }
      }

      // === AUTHORITATIVE MODE: Visual offset animation ===
      if (collisionMode === 'authoritative' && rBody._visualBumpVel) {
        const elapsed = now - rBody._visualBumpStartTime;
        if (elapsed < rBody._visualBumpDuration) {
          // Move the target position offset slightly
          const t = elapsed / rBody._visualBumpDuration;
          const decay = 1 - t; // Linear decay
          
          rBody.position.x += rBody._visualBumpVel.x * decay;
          rBody.position.z += rBody._visualBumpVel.z * decay;
        } else {
          rBody._visualBumpVel = null;
        }
      }

      // If this car was recently involved in a local collision, suspend network interpolation.
      const suspensionTime = collisionMode === 'dynamic' ? 1000 : (collisionMode === 'smooth' ? 800 : 400);
      if (collisionMode !== 'predict' && collisionMode !== 'authoritative' && (now - (rBody._lastHitTime || 0) < suspensionTime)) {
        continue; // Let CANNON's engine simulate it naturally without forcing its position!
      }
      
      // Lerp position (0.2 is a good smoothing factor for 60fps)
      rBody.position.lerp(rBody.targetPos, 0.2, rBody.position);
      rBody.quaternion.slerp(rBody.targetQuat, 0.3, rBody.quaternion);
      
      // Sync velocity so CANNON.js solver calculates realistic collision forces
      if (rBody.targetVel) {
        rBody.velocity.copy(rBody.targetVel);
        rBody.angularVelocity.set(0, 0, 0);
      }
    }
  }
}

const _lastStrictHitMap = new Map();

export function checkStrictCollisions() {
  // Only used by Host in STRICT mode to detect hits between any two vehicles
  const now = performance.now();
  for (const contact of world.contacts) {
    const bi = contact.bi;
    const bj = contact.bj;
    if (bi.peerId && bj.peerId) {
      // Prevent multiple contacts in the same frame AND multiple frames per collision from compounding
      const pairId = bi.peerId < bj.peerId ? `${bi.peerId}_${bj.peerId}` : `${bj.peerId}_${bi.peerId}`;
      const lastHit = _lastStrictHitMap.get(pairId) || 0;
      if (now - lastHit < 500) continue;

      const impactVel = Math.min(contact.getImpactVelocityAlongNormal(), 30);
      if (impactVel > 3) {
        _lastStrictHitMap.set(pairId, now);
        
        let impulseMag = impactVel * bi.mass * 0.8;
        impulseMag = Math.min(impulseMag, 45000);

        // Broadcast the hit to the victim (bj) from attacker (bi)
        const victimMass = bj.mass || 1000;
        const dvMagJ = impulseMag / victimMass;
        const point = { x: bj.position.x + contact.rj.x, y: bj.position.y + contact.rj.y, z: bj.position.z + contact.rj.z };
        const bumpVelJ = { 
          x: contact.ni.x * dvMagJ, 
          y: Math.min(contact.ni.y * dvMagJ + (dvMagJ * 0.1), 5), // Small upward hop 
          z: contact.ni.z * dvMagJ 
        };
        if (_onVehicleImpact) _onVehicleImpact(bj.peerId, bumpVelJ, point, bi.peerId);
        
        // Also broadcast the counter-hit to the attacker (bi) from victim (bj)
        const attackerMass = bi.mass || 1000;
        const dvMagI = impulseMag / attackerMass;
        const pointI = { x: bi.position.x + contact.ri.x, y: bi.position.y + contact.ri.y, z: bi.position.z + contact.ri.z };
        const bumpVelI = { 
          x: -contact.ni.x * dvMagI, 
          y: Math.min(-contact.ni.y * dvMagI + (dvMagI * 0.1), 5), 
          z: -contact.ni.z * dvMagI 
        };
        if (_onVehicleImpact) _onVehicleImpact(bi.peerId, bumpVelI, pointI, bj.peerId);
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

export function getRemoteVehicles() {
  return remoteVehicles;
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

  // Core hitbox for wall collisions and body hits (same for local and remote)
  const chassisShape = new CANNON.Box(new CANNON.Vec3(width * 0.49, 0.25, length * 0.49));
  body.addShape(chassisShape, new CANNON.Vec3(0, 0.0, 0));

  const cabinShape = new CANNON.Box(new CANNON.Vec3(width * 0.35, 0.35, length * 0.25));
  body.addShape(cabinShape, new CANNON.Vec3(0, 0.6, 0));

  // Remote cars don't have a RaycastVehicle to hold them up.
  // Using 4 Spheres causes them to fall through large Trimesh triangles (like on TESTER).
  // Instead, we use a single Box that extends down to the wheel depth!
  if (id !== '__local__') {
    const spec = VEHICLE_CLASSES[body.carModel] || VEHICLE_CLASSES['dacia_duster_low_poly'];
    const wheelRadius = spec.wheelRadius || 0.38;
    const wheelY = -(spec.suspensionRestLength || 0.4); 
    const lowestPoint = wheelY - wheelRadius;
    
    // Create a box that covers the lower half (from y=0 down to lowestPoint)
    const lowerHalfBox = new CANNON.Box(new CANNON.Vec3(width * 0.48, Math.abs(lowestPoint) / 2, length * 0.48));
    body.addShape(lowerHalfBox, new CANNON.Vec3(0, lowestPoint / 2, 0));
  }
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
  let currentFrontFric = playerCarSpecs.frontFric;
  let currentRearFric = playerCarSpecs.rearFric;

  if (handlingMode === 'Rally') {
    // Dirt base multiplier (slightly looser than tarmac)
    currentFrontFric *= 0.85;
    currentRearFric *= 0.8;

    // Weight transfer approximation & Power Sliding
    let weightTransferRear = 1.0;
    let weightTransferFront = 1.0;
    if (input.backward) {
      weightTransferRear = 0.55; 
      weightTransferFront = 1.2; 
    } else if (input.forward) {
      weightTransferRear = 1.1; 
      weightTransferFront = 0.95; 

      if (isTurning && speedRatio > 0.15) {
         weightTransferRear *= 0.75; // Softer power oversteer
      }
    }

    // Always apply weight transfer
    currentFrontFric *= weightTransferFront;
    currentRearFric *= weightTransferRear;

    const isTractionBroken = Math.abs(lateralVel) > 4.0;

    if (isTractionBroken) {
      // Keep friction high enough so the car doesn't spin like a top!
      currentFrontFric *= 0.6;
      currentRearFric *= 0.55;
      
      const counterSteering = (lateralVel < -2 && input.right) || (lateralVel > 2 && input.left);
      if (counterSteering) {
        currentFrontFric *= 1.8; 
        currentRearFric *= 1.8;
        
        // Active Anti-Spin Assist: physically stop the rotation if counter-steering!
        playerChassis.angularVelocity.y *= 0.92;
        
        if (input.forward) {
          currentFrontFric *= 1.2;
          currentRearFric *= 1.2;
        }
      }
    } else {
      if (isTurning && speedRatio > 0.3) {
        // Less dramatic centrifugal traction loss
        currentRearFric *= (1.0 - speedRatio * 0.4); 
        currentFrontFric *= (1.0 - speedRatio * 0.2); 
      }
    }
  }

  if (!playerChassis.isOiled) {
    playerVehicle.wheelInfos[0].frictionSlip = currentFrontFric;
    playerVehicle.wheelInfos[1].frictionSlip = currentFrontFric;
    playerVehicle.wheelInfos[2].frictionSlip = currentRearFric;
    playerVehicle.wheelInfos[3].frictionSlip = currentRearFric;
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
  const rocket = { body, life: 6.0, dead: false, onExplode, owner: ownerBody };

  body.addEventListener('collide', e => {
    if (rocket.dead || e.body.isRocket || (ownerBody && e.body === ownerBody)) return;
    rocket.dead = true;
    _explodeRocket(body.position.clone(), rocket.onExplode, rocket);
    // Remove callback so stepPhysics doesn't call it again
    rocket.onExplode = null;
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
  updateRemoteVehicles();
  
  // --- Process delayed hit queue ---
  const now = performance.now();
  for (let i = pendingBumps.length - 1; i >= 0; i--) {
    const bump = pendingBumps[i];
    let shouldApply = false;
    
    // Timeout of 200ms to guarantee it gets applied even if visual misses
    if (now - bump.time > 200) {
      shouldApply = true;
    } else if (bump.attackerId && remoteVehicles[bump.attackerId] && playerChassis) {
      const attackerBody = remoteVehicles[bump.attackerId];
      const dx = attackerBody.position.x - playerChassis.position.x;
      const dz = attackerBody.position.z - playerChassis.position.z;
      const dist = Math.sqrt(dx*dx + dz*dz);
      // Wait until the ghost is visually touching (approx 4.5 units)
      if (dist < 4.5) {
        shouldApply = true;
      }
    } else {
      shouldApply = true;
    }
    
    if (shouldApply) {
      _doApplyNetworkBump(bump.bumpVel, bump.bumpAngVel, bump.attackerId);
      pendingBumps.splice(i, 1);
    }
  }
  // ---------------------------------
  
  if (playerChassis) {
    // Anti-Spin Assist: If we recently crashed, heavily dampen rotation so tire friction doesn't whip us into a violent spin
    const now = performance.now();
    if (now - (playerChassis._hitDampTime || 0) < 600) {
      playerChassis.angularDamping = 0.9; // Extremely heavy, feels solid and prevents spinouts
    } else {
      playerChassis.angularDamping = 0.1; // Normal arcade damping
    }
  }

  // Mobile optimization: Limit maxSubSteps to 3 (instead of 10) to prevent the CPU 
  // from death-spiraling if the frame rate drops.
  world.step(1 / 60, dt, 3);
  for (let i = activeRockets.length - 1; i >= 0; i--) {
    const r = activeRockets[i];
    r.life -= dt;
    if (r.life <= 0 || r.dead) {
      if (r.onExplode) r.onExplode(r.body.position, r); 
      world.removeBody(r.body);
      activeRockets.splice(i, 1);
    }


  }
  for (let i = activeOilSlicks.length - 1; i >= 0; i--) {
    activeOilSlicks[i].life -= dt;
    if (activeOilSlicks[i].life <= 0) {
      if (activeOilSlicks[i].onCleanup) activeOilSlicks[i].onCleanup();
      world.removeBody(activeOilSlicks[i].body);
      activeOilSlicks.splice(i, 1);
    }
  }
}

export function clearPhysicsWorld() {
  const bodiesToRemove = world.bodies.filter(b => !b.isFloorBody);
  bodiesToRemove.forEach(b => world.removeBody(b));
  
  // Clean up visual meshes
  activeRockets.forEach(r => { if (r.onCleanup) r.onCleanup(r.body.position, r); });
  activeOilSlicks.forEach(s => { if (s.onCleanup) s.onCleanup(); });

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
  playerChassis._distToSplineSq = 0; // Prevent infinite respawn loop
}
