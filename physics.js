import * as THREE from 'three';
import Jolt from 'jolt-physics';
import * as Network from './network.js';
import { createJoltVehicle, BASE_VEHICLE_CONFIG } from './joltVehicle.js';

export let jolt;
export let joltInterface;
export let physicsSystem;
export let bodyInterface;
export let LAYER_NON_MOVING = 0;
export let LAYER_MOVING = 1;

export const CGROUP_DEFAULT = 1;
export const CGROUP_LOCAL_CAR = 2;
export const CGROUP_REMOTE_CAR = 4;
export const CGROUP_ROCKET = 8;

export let playerVehicle = null;
export let playerChassis = null;
export let playerCarSpecs = null;

let rockets = [];
let oilSlicks = [];
let remoteVehicles = {};
let rocketBodyIdMap = new Map();
let activeMapBodies = [];

export function setMapBodies(bodies) {
  activeMapBodies = bodies || [];
}

const EXPL_RADIUS = 8; // m, rocket explosion blast radius
const EXPL_FORCE = 8000; // Peak impulse force for Jolt
const EXPL_VERT_POP = 0.15; // fraction of force applied upward
let _onVehicleImpact = null;
let _remoteBodyIdMap = new Map();
let _lastHitTimes = new Map();
let _contactListener = null;
let resetCooldown = 0;

export function setOnVehicleImpact(cb) {
  _onVehicleImpact = cb;
}

export async function initPhysics() {
  jolt = await Jolt();
  
  const settings = new jolt.JoltSettings();
  
  // Basic Layer Setup
  const objectFilter = new jolt.ObjectLayerPairFilterTable(2);
  objectFilter.EnableCollision(LAYER_NON_MOVING, LAYER_MOVING);
  objectFilter.EnableCollision(LAYER_MOVING, LAYER_MOVING);
  settings.mObjectLayerPairFilter = objectFilter;
  
  const bpInterface = new jolt.BroadPhaseLayerInterfaceTable(2, 2);
  bpInterface.MapObjectToBroadPhaseLayer(LAYER_NON_MOVING, 0);
  bpInterface.MapObjectToBroadPhaseLayer(LAYER_MOVING, 1);
  settings.mBroadPhaseLayerInterface = bpInterface;
  
  const objVsBpFilter = new jolt.ObjectVsBroadPhaseLayerFilterTable(
    settings.mBroadPhaseLayerInterface, 2,
    settings.mObjectLayerPairFilter, 2
  );
  settings.mObjectVsBroadPhaseLayerFilter = objVsBpFilter;
  
  joltInterface = new jolt.JoltInterface(settings);
  jolt.destroy(settings);
  
  physicsSystem = joltInterface.GetPhysicsSystem();
  bodyInterface = physicsSystem.GetBodyInterface();
  
  const handleContactSettings = (body1, body2, contactSettings) => {
    const userData1 = body1.GetUserData();
    const userData2 = body2.GetUserData();
    
    const isVehicle1 = (userData1 === 2);
    const isVehicle2 = (userData2 === 2);
    const isWall1 = (userData1 === 1);
    const isWall2 = (userData2 === 1);
    
    if ((isVehicle1 && isWall2) || (isVehicle2 && isWall1)) {
      contactSettings.mCombinedFriction = 0.0;
      contactSettings.mCombinedRestitution = 0.1;
    } else if (isVehicle1 && isVehicle2) {
      contactSettings.mCombinedFriction = 0.0;
      contactSettings.mCombinedRestitution = 0.1;
    } else if ((isVehicle1 && userData2 === 0) || (isVehicle2 && userData1 === 0)) {
      contactSettings.mCombinedFriction = 0.05;
      contactSettings.mCombinedRestitution = 0.0;
    }
  };

  _contactListener = new jolt.ContactListenerJS();
  _contactListener.OnContactValidate = (body1, body2, collideShapeResult) => jolt.ValidateResult_AcceptAllContactsForThisBodyPair;
  _contactListener.OnContactPersisted = (body1Ptr, body2Ptr, manifold, settings) => {
    if (!body1Ptr || !body2Ptr || !settings) return;
    try {
      const body1 = jolt.wrapPointer(body1Ptr, jolt.Body);
      const body2 = jolt.wrapPointer(body2Ptr, jolt.Body);
      const contactSettings = jolt.wrapPointer(settings, jolt.ContactSettings);
      if (body1 && body2 && contactSettings) {
        handleContactSettings(body1, body2, contactSettings);
      }
    } catch (e) {
      console.error("[PHYSICS] Error in OnContactPersisted:", e);
    }
  };
  _contactListener.OnContactRemoved = (subShapePair) => {};
  
  _contactListener.OnContactAdded = (body1Ptr, body2Ptr, manifold, settings) => {
    if (!body1Ptr || !body2Ptr || !settings) return;
    try {
      const body1 = jolt.wrapPointer(body1Ptr, jolt.Body);
      const body2 = jolt.wrapPointer(body2Ptr, jolt.Body);
      const contactSettings = jolt.wrapPointer(settings, jolt.ContactSettings);
      if (!body1 || !body2 || !contactSettings) return;

      handleContactSettings(body1, body2, contactSettings);

      const id1 = body1.GetID().GetIndexAndSequenceNumber();
      const id2 = body2.GetID().GetIndexAndSequenceNumber();

      // Rocket Collision Detection
      let rocket = null;
      let rocketHitBody = null;
      if (rocketBodyIdMap.has(id1)) {
        rocket = rocketBodyIdMap.get(id1);
        rocketHitBody = body2;
      } else if (rocketBodyIdMap.has(id2)) {
        rocket = rocketBodyIdMap.get(id2);
        rocketHitBody = body1;
      }

      if (rocket && !rocket.dead) {
        const otherId = rocketHitBody.GetID().GetIndexAndSequenceNumber();
        if (otherId !== rocket.ownerBodyId && !rocketBodyIdMap.has(otherId)) {
          rocket.dead = true;
          console.log(`[PHYSICS] Rocket hit body ID ${otherId}, detonating explosion!`);
          _explodeRocket(rocket);
          return;
        }
      }

      if (!playerVehicle || !playerVehicle.chassisBody) return;
      
      const myBodyId = playerVehicle.chassisBody.GetID().GetIndexAndSequenceNumber();
      
      let remoteId = null;
      let otherBody = null;
      if (id1 === myBodyId && _remoteBodyIdMap.has(id2)) {
        remoteId = _remoteBodyIdMap.get(id2);
        otherBody = body2;
      } else if (id2 === myBodyId && _remoteBodyIdMap.has(id1)) {
        remoteId = _remoteBodyIdMap.get(id1);
        otherBody = body1;
      }
      
      if (remoteId) {
        const now = performance.now();
        const lastHit = _lastHitTimes.get(remoteId) || 0;
        if (now - lastHit > 500) {
          _lastHitTimes.set(remoteId, now);
          
          // Calculate relative bump velocity to send to network
          const myVel = bodyInterface.GetLinearVelocity(playerVehicle.chassisBody.GetID());
          const theirVel = bodyInterface.GetLinearVelocity(otherBody.GetID());
          
          const bumpVel = {
            x: myVel.GetX() - theirVel.GetX(),
            y: Math.abs(myVel.GetY() - theirVel.GetY()) * 0.5 + 2, // Slight upward pop
            z: myVel.GetZ() - theirVel.GetZ()
          };
          
          const bumpAng = {
            x: (Math.random() - 0.5) * 4,
            y: (Math.random() - 0.5) * 4,
            z: (Math.random() - 0.5) * 4
          };
          
          if (window.Network && window.Network.sendVehicleHit) {
            window.Network.sendVehicleHit(remoteId, bumpVel, window.Network.myPeerId, bumpAng);
          }
          
          jolt.destroy(myVel);
          jolt.destroy(theirVel);
        }
      }
    } catch (e) {
      console.error("[PHYSICS] Error in OnContactAdded:", e);
    }
  };
  
  physicsSystem.SetContactListener(_contactListener);
  
  console.log('[+] Jolt Physics Client Initialized');
}

export function getWorld() {
  return physicsSystem;
}

export function clearPhysicsWorld() {
  // Clean up all active rockets
  rockets.forEach(r => {
    if (r.onCleanup) r.onCleanup(r.body.position, r);
    bodyInterface.RemoveBody(r.bodyId);
    bodyInterface.DestroyBody(r.bodyId);
  });
  rockets = [];
  rocketBodyIdMap.clear();

  // Clean up all static map bodies
  activeMapBodies.forEach(bodyId => {
    try {
      bodyInterface.RemoveBody(bodyId);
      bodyInterface.DestroyBody(bodyId);
    } catch (e) {
      console.error("[PHYSICS] Error destroying map body:", e);
    }
  });
  activeMapBodies = [];

  // Clean up local vehicle
  if (playerVehicle) {
    if (playerVehicle.stepListener) {
      try {
        physicsSystem.RemoveStepListener(playerVehicle.stepListener);
      } catch (e) {
        console.error("[PHYSICS] Error removing step listener:", e);
      }
      try {
        jolt.destroy(playerVehicle.stepListener);
      } catch (e) {
        // Ignore signature mismatch if it throws
      }
    }
    if (playerVehicle.constraint) {
      try {
        physicsSystem.RemoveConstraint(playerVehicle.constraint);
      } catch (e) {
        console.error("[PHYSICS] Error removing constraint:", e);
      }
      try {
        // Constraints are reference-counted in Jolt, so we use Release()
        playerVehicle.constraint.Release();
      } catch (e) {
        console.error("[PHYSICS] Error releasing constraint:", e);
      }
    }
    
    // JS callbacks are garbage-collected and manual destroy throws signature mismatch
    playerVehicle.callbacks = null;
    playerVehicle.controllerCallbacks = null;

    if (playerVehicle.tester) {
      try {
        // Testers are reference-counted in Jolt, so we use Release()
        playerVehicle.tester.Release();
      } catch (e) {
        console.error("[PHYSICS] Error releasing tester:", e);
      }
    }
    if (playerVehicle.chassisBody) {
      try {
        const chassisId = playerVehicle.chassisBody.GetID();
        bodyInterface.RemoveBody(chassisId);
        bodyInterface.DestroyBody(chassisId);
      } catch (e) {
        console.error("[PHYSICS] Error removing/destroying chassis body:", e);
      }
    }
    playerVehicle = null;
    playerChassis = null;
  }

  // Clean up remote vehicles
  for (const peerId of Object.keys(remoteVehicles)) {
    try {
      removeRemoteVehicle(peerId);
    } catch (e) {
      console.error("[PHYSICS] Error during remote vehicle cleanup:", e);
    }
  }
  remoteVehicles = {};
  _remoteBodyIdMap.clear();
}

export async function initMap(seed) {
  // Map static geometry is currently generated separately via Three.js / mapServer.
  // We can leave this empty or instantiate the map collision here if needed.
}

export function createLocalVehicle(x, y, z) {
  playerVehicle = createJoltVehicle(jolt, physicsSystem, bodyInterface, [x, y, z], null, LAYER_MOVING, handlingMode);
}

export function createPlayerVehicle(startPos, startQuat, carModel) {
  playerCarSpecs = carModel;
  
  const spawnYOffset = BASE_VEHICLE_CONFIG.halfVehicleHeight + BASE_VEHICLE_CONFIG.suspensionMaxLength + BASE_VEHICLE_CONFIG.wheelRadius + 0.1;
  const py = startPos.y + spawnYOffset;
  
  playerVehicle = createJoltVehicle(jolt, physicsSystem, bodyInterface, [startPos.x, py, startPos.z], [startQuat.x, startQuat.y, startQuat.z, startQuat.w], LAYER_MOVING, handlingMode, carModel);
  
  // Cannon-compatible wrapper so gameEngine.js works without modification.
  // Exposes: position, quaternion (with vmult), velocity (with set/length/copy),
  //          angularVelocity (with set), interpolatedPosition/Quaternion.
  playerChassis = {
    _closestT: undefined, // written by game.js checkpoint tracking

    get position() {
      const p = playerVehicle.chassisBody.GetPosition();
      return { x: p.GetX(), y: p.GetY(), z: p.GetZ() };
    },

    get interpolatedPosition() { return this.position; },
    get interpolatedQuaternion() { return this.quaternion; },

    get quaternion() {
      const q = playerVehicle.chassisBody.GetRotation();
      const qx = q.GetX(), qy = q.GetY(), qz = q.GetZ(), qw = q.GetW();
      return {
        x: qx, y: qy, z: qz, w: qw,
        // Rotate a CANNON.Vec3 v by this quaternion and store in target
        vmult(v, target) {
          // Standard quaternion-vector rotation: q * v * q^-1
          const ix =  qw*v.x + qy*v.z - qz*v.y;
          const iy =  qw*v.y + qz*v.x - qx*v.z;
          const iz =  qw*v.z + qx*v.y - qy*v.x;
          const iw = -qx*v.x - qy*v.y - qz*v.z;
          const rx = ix*qw + iw*(-qx) + iy*(-qz) - iz*(-qy);
          const ry = iy*qw + iw*(-qy) + iz*(-qx) - ix*(-qz);
          const rz = iz*qw + iw*(-qz) + ix*(-qy) - iy*(-qx);
          if (target) { target.x = rx; target.y = ry; target.z = rz; }
          return target || { x: rx, y: ry, z: rz };
        }
      };
    },

    get velocity() {
      const v = playerVehicle.chassisBody.GetLinearVelocity();
      const vx = v.GetX(), vy = v.GetY(), vz = v.GetZ();
      const chassis = playerVehicle;
      return {
        x: vx, y: vy, z: vz,
        length() { return Math.sqrt(vx*vx + vy*vy + vz*vz); },
        lengthSquared() { return vx*vx + vy*vy + vz*vz; },
        set(x, y, z) {
          const newV = new jolt.Vec3(x, y, z);
          bodyInterface.SetLinearVelocity(chassis.chassisBody.GetID(), newV);
          jolt.destroy(newV);
        },
        copy(src) { this.set(src.x, src.y, src.z); },
        normalize() {
          const len = this.length();
          if (len > 0) { this.x = vx/len; this.y = vy/len; this.z = vz/len; }
          return this;
        },
        dot(other) { return vx*other.x + vy*other.y + vz*other.z; }
      };
    },

    get angularVelocity() {
      const av = playerVehicle.chassisBody.GetAngularVelocity();
      const avx = av.GetX(), avy = av.GetY(), avz = av.GetZ();
      const chassis = playerVehicle;
      return {
        x: avx, y: avy, z: avz,
        set(x, y, z) {
          const newAV = new jolt.Vec3(x, y, z);
          bodyInterface.SetAngularVelocity(chassis.chassisBody.GetID(), newAV);
          jolt.destroy(newAV);
        },
        length() { return Math.sqrt(avx*avx + avy*avy + avz*avz); }
      };
    }
  };
}


export function createRemoteVehicle(peerId, mass, carModel, spawnPos, spawnQuat) {
  const halfVehicleLength = 2.0;
  const halfVehicleWidth = 0.9;
  const halfVehicleHeight = 0.2;

  const boxVec = new jolt.Vec3(halfVehicleWidth, halfVehicleHeight, halfVehicleLength);
  const boxShapeSettings = new jolt.BoxShapeSettings(boxVec);
  const shapeResult = boxShapeSettings.Create();
  const carShape = shapeResult.Get();
  
  const pos = new jolt.RVec3(spawnPos ? spawnPos.x : 0, spawnPos ? spawnPos.y : 2, spawnPos ? spawnPos.z : 0);
  const quat = new jolt.Quat(spawnQuat ? spawnQuat.x : 0, spawnQuat ? spawnQuat.y : 0, spawnQuat ? spawnQuat.z : 0, spawnQuat ? spawnQuat.w : 1);
  
  const bodyCreationSettings = new jolt.BodyCreationSettings(carShape, pos, quat, jolt.EMotionType_Kinematic, LAYER_MOVING);
  if (collisionMode === 'perfect-sensor') {
    bodyCreationSettings.mIsSensor = true;
  }
  bodyCreationSettings.mUserData = 2;
  
  const body = bodyInterface.CreateBody(bodyCreationSettings);
  bodyInterface.AddBody(body.GetID(), jolt.EActivation_DontActivate);

  const vehicleWrapper = {
    bodyId: body.GetID(),
    position: spawnPos ? { ...spawnPos } : { x: 0, y: 0, z: 0 },
    quaternion: spawnQuat ? { ...spawnQuat } : { x: 0, y: 0, z: 0, w: 1 },
    velocity: { x: 0, y: 0, z: 0 }
  };
  remoteVehicles[peerId] = vehicleWrapper;
  _remoteBodyIdMap.set(body.GetID().GetIndexAndSequenceNumber(), peerId);
  
  jolt.destroy(boxVec);
  jolt.destroy(pos);
  jolt.destroy(quat);
  jolt.destroy(bodyCreationSettings);
}

export function removeRemoteVehicle(peerId) {
  if (remoteVehicles[peerId] && remoteVehicles[peerId].bodyId) {
    _remoteBodyIdMap.delete(remoteVehicles[peerId].bodyId.GetIndexAndSequenceNumber());
    bodyInterface.RemoveBody(remoteVehicles[peerId].bodyId);
    bodyInterface.DestroyBody(remoteVehicles[peerId].bodyId);
  }
  delete remoteVehicles[peerId];
}

export function syncRemoteBody(id, targetPos, targetQuat, targetVel, dt) {
  if (remoteVehicles[id]) {
    remoteVehicles[id].position = targetPos;
    remoteVehicles[id].quaternion = targetQuat;
    remoteVehicles[id].velocity = targetVel;
    
    if (remoteVehicles[id].bodyId) {
      const pos = new jolt.RVec3(targetPos.x, targetPos.y, targetPos.z);
      const quat = new jolt.Quat(targetQuat.x, targetQuat.y, targetQuat.z, targetQuat.w);
      bodyInterface.SetPositionAndRotation(remoteVehicles[id].bodyId, pos, quat, jolt.EActivation_DontActivate);
      jolt.destroy(pos);
      jolt.destroy(quat);
    }
  }
}

export function getVehicleBody(id) {
  if (id === '__local__') return playerChassis;
  return remoteVehicles[id];
}

export function getRemoteVehicles() {
  return remoteVehicles;
}

export function setVehicleInput(input) {
  if (!playerVehicle) return;
  
  const controller = playerVehicle.controller;
  
  const linVel = bodyInterface.GetLinearVelocity(playerVehicle.chassisBody.GetID());
  const localForward = new jolt.Vec3(0, 0, 1);
  const forwardVec = playerVehicle.chassisBody.GetRotation().MulVec3(localForward);
  const speed = linVel.Dot(forwardVec);
  jolt.destroy(linVel);
  jolt.destroy(localForward);
  jolt.destroy(forwardVec);

  let forward = 0.0;
  let brake = 0.0;
  if (input.forward) {
      if (speed < -2.0) brake = 1.0;
      else forward = 1.0;
  }
  if (input.backward) {
      if (speed > 2.0) brake = 1.0;
      else forward = -1.0;
  }
  
  let right = 0.0;
  if (input.right) right = 1.0;
  if (input.left) right = -1.0;

  const isSegaRally = (handlingMode === 'segarally');
  const speedKmh = Math.abs(speed) * 3.6;

  // Speed-sensitive steering (skipped for Sega Rally — full authority at all speeds)
  if (!isSegaRally && speedKmh > 40.0) {
      const steerFactor = Math.max(0.4, 1.0 - ((speedKmh - 40.0) / 120.0) * 0.6);
      right *= steerFactor;
  }

  let handbrake = input.drift ? 1.0 : 0.0;

  // Sega Rally: brake + steer = automatic partial handbrake (Scandinavian flick)
  if (isSegaRally && brake > 0.5 && Math.abs(right) > 0.3 && speedKmh > 20.0) {
    handbrake = Math.max(handbrake, 0.6);
  }

  if (resetCooldown > 0) {
    resetCooldown -= (1/60);
    forward = 0;
    brake = 1.0;
    handbrake = 1.0;
  }

  // Smooth steering — Sega Rally uses much faster interpolation for snappy arcade response
  if (!playerVehicle._currentSteer) playerVehicle._currentSteer = 0;
  let steerSpeed;
  if (isSegaRally) {
    steerSpeed = 0.95; // Snappy, immediate — 90s arcade feel
  } else {
    steerSpeed = speedKmh > 20 ? 0.15 : 0.25;
  }
  playerVehicle._currentSteer += (right - playerVehicle._currentSteer) * steerSpeed;
  
  controller._currentHandbrake = handbrake;
  controller._currentBrake = brake; // Expose brake state for OnPreStepCallback weight transfer
  controller._currentSteer = playerVehicle._currentSteer; // Expose steer state for auto-drift callback
  controller.SetDriverInput(forward, playerVehicle._currentSteer, brake, handbrake);

  if (forward !== 0 || right !== 0 || brake !== 0 || handbrake !== 0) {
    bodyInterface.ActivateBody(playerVehicle.chassisBody.GetID());
  }
}

export function stepPhysics(fixedDt) {
  if (joltInterface) {
    joltInterface.Step(fixedDt, 1);
  }

  // Update rockets
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i];
    r.life -= fixedDt;
    if (r.life <= 0 || r.dead) {
      if (r.life <= 0 && !r.dead) {
        r.dead = true;
        _explodeRocket(r);
      }
      bodyInterface.RemoveBody(r.bodyId);
      bodyInterface.DestroyBody(r.bodyId);
      rocketBodyIdMap.delete(r.bodyId.GetIndexAndSequenceNumber());
      rockets.splice(i, 1);
    }
  }
}

export function captureVehicleState(snapshotBuffer, offset = 0) {
  if (!playerVehicle) return;
  
  const id = playerVehicle.chassisBody.GetID();
  const pos = playerVehicle.chassisBody.GetPosition();
  const quat = playerVehicle.chassisBody.GetRotation();
  const linVel = playerVehicle.chassisBody.GetLinearVelocity();
  const angVel = playerVehicle.chassisBody.GetAngularVelocity();
  
  const view = new Float32Array(snapshotBuffer, offset, 13);
  view[0] = pos.GetX(); view[1] = pos.GetY(); view[2] = pos.GetZ();
  view[3] = quat.GetX(); view[4] = quat.GetY(); view[5] = quat.GetZ(); view[6] = quat.GetW();
  view[7] = linVel.GetX(); view[8] = linVel.GetY(); view[9] = linVel.GetZ();
  view[10] = angVel.GetX(); view[11] = angVel.GetY(); view[12] = angVel.GetZ();
}

export function restoreVehicleState(snapshotBuffer, offset = 0) {
  if (!playerVehicle) return;
  
  const view = new Float32Array(snapshotBuffer, offset, 13);
  const id = playerVehicle.chassisBody.GetID();
  
  const p = new jolt.RVec3(view[0], view[1], view[2]);
  const q = new jolt.Quat(view[3], view[4], view[5], view[6]);
  bodyInterface.SetPositionAndRotation(id, p, q, jolt.EActivation_Activate);
  
  const lv = new jolt.Vec3(view[7], view[8], view[9]);
  bodyInterface.SetLinearVelocity(id, lv);
  
  const av = new jolt.Vec3(view[10], view[11], view[12]);
  bodyInterface.SetAngularVelocity(id, av);
  
  jolt.destroy(p);  jolt.destroy(q); jolt.destroy(lv); jolt.destroy(av);
}

export function getVehicleDebugData() {
  if (!playerVehicle || !playerVehicle.constraint || !playerVehicle.controller) return null;
  const engine = playerVehicle.controller.GetEngine();
  const trans = playerVehicle.controller.GetTransmission();
  
  const mass = 1400.0; // Hardcoded for now
  
  const wheels = [];
  for (let i = 0; i < 4; i++) {
    const wheelPtr = playerVehicle.constraint.GetWheel(i);
    if (!wheelPtr) continue;
    try {
      wheels.push({
        angVel: wheelPtr.GetAngularVelocity(),
        suspension: wheelPtr.GetSuspensionLength(),
        longSlip: 0,
        latSlip: 0,
        contact: wheelPtr.HasContact(),
        friction: 0,
        brakeImpulse: 0
      });
    } catch (e) {
      console.error("[PHYSICS] Error reading wheel in debug data:", e);
    }
  }

  const av = playerVehicle.chassisBody ? playerVehicle.chassisBody.GetAngularVelocity() : null;
  const avData = av ? { x: av.GetX(), y: av.GetY(), z: av.GetZ() } : { x: 0, y: 0, z: 0 };
  
  return {
    mass,
    engineRPM: engine ? engine.GetCurrentRPM() : 0,
    gear: trans ? trans.GetCurrentGear() : 0,
    steer: playerVehicle._currentSteer || 0,
    brake: playerVehicle.controller._currentHandbrake || 0,
    angularVelocity: avData,
    wheels
  };
}

let flipTimer = 0;
export function checkFlip(dt) {
  if (!playerVehicle) return { flipped: false, recovered: false };

  const upVec = playerVehicle.chassisBody.GetRotation().MulVec3(new jolt.Vec3(0, 1, 0));
  const isFlipped = upVec.GetY() < 0.2;
  jolt.destroy(upVec);
  
  if (isFlipped) {
    flipTimer += dt;
    return { flipped: true, recovered: flipTimer > 2.5 };
  } else {
    flipTimer = 0;
    return { flipped: false, recovered: false };
  }
}


export function resetVehicle(pos, quat) {
  if (!playerVehicle || !playerVehicle.chassisBody) return;
  const p = new jolt.Vec3(pos.x, pos.y, pos.z);
  const q = new jolt.Quat(quat.x, quat.y, quat.z, quat.w);
  bodyInterface.SetPositionAndRotation(playerVehicle.chassisBody.GetID(), p, q, jolt.EActivation_Activate);
  bodyInterface.SetLinearVelocity(playerVehicle.chassisBody.GetID(), new jolt.Vec3(0,0,0));
  bodyInterface.SetAngularVelocity(playerVehicle.chassisBody.GetID(), new jolt.Vec3(0,0,0));

  // Reset engine and wheels to prevent massive impulse clipping when touching the ground
  if (playerVehicle.controller) {
    const engine = playerVehicle.controller.GetEngine();
    if (engine) engine.SetCurrentRPM(engine.mMinRPM || 1000.0);
  }
  
  if (playerVehicle.constraint) {
    playerVehicle.constraint.ResetWarmStart();
    for (let i = 0; i < 4; i++) {
      const wheelPtr = playerVehicle.constraint.GetWheel(i);
      if (wheelPtr) {
        try {
          wheelPtr.SetAngularVelocity(0);
        } catch (e) {
          console.error("[PHYSICS] Error resetting wheel angular velocity:", e);
        }
      }
    }
  }

  resetCooldown = 0.2; // 200ms cooldown to ensure we land before wheels spin up

  jolt.destroy(p);
  jolt.destroy(q);
}

export function _explodeRocket(rocket) {
  const pos = rocket.body.position;
  const ownerBodyId = rocket.ownerBodyId;

  if (playerVehicle && playerVehicle.chassisBody) {
    const chassis = playerVehicle.chassisBody;
    const chassisId = chassis.GetID().GetIndexAndSequenceNumber();
    
    const cPos = chassis.GetPosition();
    const cx = cPos.GetX(), cy = cPos.GetY(), cz = cPos.GetZ();
    const dx = cx - pos.x;
    const dy = cy - pos.y;
    const dz = cz - pos.z;
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
    
    if (dist < EXPL_RADIUS && chassisId !== ownerBodyId) {
      const power = EXPL_FORCE / (dist + 1.0);
      
      let ux = dx, uy = dy, uz = dz;
      if (dist > 0.001) {
        ux /= dist; uy /= dist; uz /= dist;
      } else {
        ux = 0; uy = 1; uz = 0;
      }
      
      const ix = ux * power;
      const iy = uy * power + power * EXPL_VERT_POP;
      const iz = uz * power;
      
      const imp = new jolt.Vec3(ix, iy, iz);
      bodyInterface.AddImpulse(chassis.GetID(), imp);
      jolt.destroy(imp);
    }
  }

  if (rocket.onExplode) {
    rocket.onExplode(pos, rocket);
    rocket.onExplode = null;
  }
}

export function fireRocket(startPos, startQuat, onExplode, ownerBody) {
  if (!jolt) return null;

  let chassisPos = startPos;
  let chassisQuat = startQuat;
  let avgSusp = 0.15;

  if (ownerBody === playerChassis && playerVehicle) {
    chassisPos = playerChassis.position;
    chassisQuat = playerChassis.quaternion;
    if (playerVehicle.constraint) {
      const wheelLPtr = playerVehicle.constraint.GetWheel(0);
      const wheelRPtr = playerVehicle.constraint.GetWheel(1);
      const suspL = wheelLPtr ? wheelLPtr.GetSuspensionLength() : 0.15;
      const suspR = wheelRPtr ? wheelRPtr.GetSuspensionLength() : 0.15;
      avgSusp = (suspL + suspR) * 0.5;
    }
  } else if (ownerBody) {
    chassisPos = ownerBody.position;
    chassisQuat = ownerBody.quaternion;
  }

  const q = new jolt.Quat(chassisQuat.x, chassisQuat.y, chassisQuat.z, chassisQuat.w);
  const localLaunchPos = new jolt.Vec3(0, 0.1 - avgSusp, 3.5);
  const rotatedLocalPos = q.MulVec3(localLaunchPos);

  const launchPosX = chassisPos.x + rotatedLocalPos.GetX();
  const launchPosY = chassisPos.y + rotatedLocalPos.GetY();
  const launchPosZ = chassisPos.z + rotatedLocalPos.GetZ();

  const fwdLocal = new jolt.Vec3(0, 0, 1);
  const fwd = q.MulVec3(fwdLocal);

  jolt.destroy(localLaunchPos);
  jolt.destroy(rotatedLocalPos);
  jolt.destroy(fwdLocal);

  const shapeSettings = new jolt.SphereShapeSettings(0.25);
  const shape = shapeSettings.Create().Get();

  const rpos = new jolt.RVec3(launchPosX, launchPosY, launchPosZ);
  const bodySettings = new jolt.BodyCreationSettings(shape, rpos, q, jolt.EMotionType_Dynamic, LAYER_MOVING);
  bodySettings.mIsSensor = true;
  bodySettings.mGravityFactor = 0.0;

  const body = bodyInterface.CreateBody(bodySettings);
  const bodyId = body.GetID();

  bodyInterface.AddBody(bodyId, jolt.EActivation_Activate);

  const relativeSpeed = 41.67; // 150 km/h
  let vx = fwd.GetX() * relativeSpeed;
  let vy = fwd.GetY() * relativeSpeed;
  let vz = fwd.GetZ() * relativeSpeed;
  if (ownerBody && ownerBody.velocity) {
    vx += ownerBody.velocity.x;
    vy += ownerBody.velocity.y;
    vz += ownerBody.velocity.z;
  }

  const velVec = new jolt.Vec3(vx, vy, vz);
  bodyInterface.SetLinearVelocity(bodyId, velVec);

  jolt.destroy(shapeSettings);
  jolt.destroy(rpos);
  jolt.destroy(q);
  jolt.destroy(fwd);
  jolt.destroy(bodySettings);
  jolt.destroy(velVec);

  let ownerBodyId = null;
  if (ownerBody) {
    if (ownerBody === playerChassis && playerVehicle) {
      ownerBodyId = playerVehicle.chassisBody.GetID().GetIndexAndSequenceNumber();
    } else if (ownerBody.bodyId) {
      ownerBodyId = ownerBody.bodyId.GetIndexAndSequenceNumber();
    }
  }

  const rocket = {
    body: {
      get position() {
        const p = body.GetPosition();
        return { x: p.GetX(), y: p.GetY(), z: p.GetZ() };
      },
      get interpolatedPosition() { return this.position; },
      get velocity() {
        const v = body.GetLinearVelocity();
        const rvx = v.GetX(), rvy = v.GetY(), rvz = v.GetZ();
        return {
          x: rvx, y: rvy, z: rvz,
          length() { return Math.sqrt(rvx*rvx + rvy*rvy + rvz*rvz); }
        };
      }
    },
    bodyId: bodyId,
    ownerBodyId: ownerBodyId,
    life: 6.0,
    dead: false,
    onExplode,
    owner: ownerBody
  };

  rockets.push(rocket);
  rocketBodyIdMap.set(bodyId.GetIndexAndSequenceNumber(), rocket);

  return rocket;
}


export function raycastForward(chassis) {
  if (!playerVehicle || !playerVehicle.chassisBody) {
    return { x: 0, y: -100, z: 0 };
  }
  
  const chassisPos = playerChassis.position;
  const chassisQuat = playerChassis.quaternion;
  
  let avgSusp = 0.15;
  if (playerVehicle && playerVehicle.constraint) {
    const wheelLPtr = playerVehicle.constraint.GetWheel(0);
    const wheelRPtr = playerVehicle.constraint.GetWheel(1);
    const suspL = wheelLPtr ? wheelLPtr.GetSuspensionLength() : 0.15;
    const suspR = wheelRPtr ? wheelRPtr.GetSuspensionLength() : 0.15;
    avgSusp = (suspL + suspR) * 0.5;
  }
  
  const q = new jolt.Quat(chassisQuat.x, chassisQuat.y, chassisQuat.z, chassisQuat.w);
  const localLaunchPos = new jolt.Vec3(0, 0.1 - avgSusp, 3.5);
  const rotatedLocalPos = q.MulVec3(localLaunchPos);
  
  const originX = chassisPos.x + rotatedLocalPos.GetX();
  const originY = chassisPos.y + rotatedLocalPos.GetY();
  const originZ = chassisPos.z + rotatedLocalPos.GetZ();
  
  const fwdLocal = new jolt.Vec3(0, 0, 1);
  const fwd = q.MulVec3(fwdLocal);
  
  const rayDistance = 150.0;
  const dirX = fwd.GetX() * rayDistance;
  const dirY = fwd.GetY() * rayDistance;
  const dirZ = fwd.GetZ() * rayDistance;
  
  jolt.destroy(localLaunchPos);
  jolt.destroy(rotatedLocalPos);
  jolt.destroy(fwdLocal);
  jolt.destroy(q);
  jolt.destroy(fwd);
  
  const ray = new jolt.RRayCast();
  ray.mOrigin.Set(originX, originY, originZ);
  ray.mDirection.Set(dirX, dirY, dirZ);
  
  const raySettings = new jolt.RayCastSettings();
  
  const bpFilter = new jolt.DefaultBroadPhaseLayerFilter(joltInterface.GetObjectVsBroadPhaseLayerFilter(), LAYER_MOVING);
  const objectLayerFilter = new jolt.DefaultObjectLayerFilter(joltInterface.GetObjectLayerPairFilter(), LAYER_MOVING);
  const bodyFilter = new jolt.BodyFilter();
  const shapeFilter = new jolt.ShapeFilter();
  const collector = new jolt.CastRayClosestHitCollisionCollector();
  
  physicsSystem.GetNarrowPhaseQuery().CastRay(ray, raySettings, collector, bpFilter, objectLayerFilter, bodyFilter, shapeFilter);
  
  let hitPoint;
  if (collector.HadHit()) {
    const hit = collector.mHit;
    const pt = ray.GetPointOnRay(hit.mFraction);
    hitPoint = { x: pt.GetX(), y: pt.GetY(), z: pt.GetZ() };
    jolt.destroy(pt);
  } else {
    hitPoint = {
      x: originX + dirX,
      y: originY + dirY,
      z: originZ + dirZ
    };
  }
  
  jolt.destroy(ray);
  jolt.destroy(raySettings);
  jolt.destroy(bpFilter);
  jolt.destroy(objectLayerFilter);
  jolt.destroy(bodyFilter);
  jolt.destroy(shapeFilter);
  jolt.destroy(collector);
  
  return hitPoint;
}

export function getActiveRockets() { return rockets; }
export function getFlipProgress() { return 0; }
export function setVehicleHitbox() {}
export function setOnNetworkBumpApplied() {}
export function checkStrictCollisions() {}

export let collisionMode = 'fast';
export function setCollisionMode(mode) {}
export function setDriveMode(mode) {}
export let handlingMode = 'arcade';
export function setHandlingMode(mode) { handlingMode = (mode || 'arcade').toLowerCase(); }
export let world = {};
export let groundMat = {};
export let wallMat = {};
export function applyNetworkBump(vel, ang, id) {
  if (!playerVehicle || !playerVehicle.chassisBody) return;
  const chassisId = playerVehicle.chassisBody.GetID();
  
  // vel and ang are relative velocity. We need to convert it into an impulse.
  // We apply a massive instantaneous impulse based on vel
  const forceMultiplier = 2000.0;
  
  let ix = vel.x * forceMultiplier;
  let iy = vel.y * forceMultiplier + 1000; // Extra vertical pop
  let iz = vel.z * forceMultiplier;
  
  // Cap it
  const maxImp = 30000;
  if (ix > maxImp) ix = maxImp; if (ix < -maxImp) ix = -maxImp;
  if (iy > maxImp) iy = maxImp; if (iy < -maxImp) iy = -maxImp;
  if (iz > maxImp) iz = maxImp; if (iz < -maxImp) iz = -maxImp;
  
  const imp = new jolt.Vec3(ix, iy, iz);
  bodyInterface.AddImpulse(chassisId, imp);
  jolt.destroy(imp);
  
  // Sound
  const speed = Math.sqrt(vel.x*vel.x + vel.y*vel.y + vel.z*vel.z);
  let intensity = speed > 10 ? 'hard' : (speed > 5 ? 'medium' : 'soft');
  if (window.Audio && window.Audio.playCrash) {
    window.Audio.playCrash(intensity);
  }
}
