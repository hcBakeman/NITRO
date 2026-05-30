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
let _onVehicleImpact = null;
let _remoteBodyIdMap = new Map();
let _lastHitTimes = new Map();
let _contactListener = null;

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
  
  _contactListener = new jolt.ContactListenerJS();
  _contactListener.OnContactValidate = (body1, body2, collideShapeResult) => jolt.ValidateResult_AcceptAllContactsForThisBodyPair;
  _contactListener.OnContactPersisted = (body1, body2, manifold, settings) => {};
  _contactListener.OnContactRemoved = (subShapePair) => {};
  
  _contactListener.OnContactAdded = (body1Ptr, body2Ptr, manifold, settings) => {
    if (!playerVehicle || !playerVehicle.chassisBody) return;
    
    const body1 = jolt.wrapPointer(body1Ptr, jolt.Body);
    const body2 = jolt.wrapPointer(body2Ptr, jolt.Body);
    
    const id1 = body1.GetID().GetIndexAndSequenceNumber();
    const id2 = body2.GetID().GetIndexAndSequenceNumber();
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
  };
  
  physicsSystem.SetContactListener(_contactListener);
  
  console.log('[+] Jolt Physics Client Initialized');
}

export function getWorld() {
  return physicsSystem;
}

export function clearPhysicsWorld() {
  // Can't easily clear in Jolt without destroying all bodies.
  // Instead, the engine usually handles map replacement cleanly.
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
  
  let handbrake = input.drift ? 1.0 : 0.0;
  
  controller._currentHandbrake = handbrake;
  controller.SetDriverInput(forward, right, brake, handbrake);

  // If the player is providing input, make sure the physics body wakes up from sleep
  if (forward !== 0.0 || right !== 0.0 || handbrake !== 0.0) {
    bodyInterface.ActivateBody(playerVehicle.chassisBody.GetID());
  }
}

export function stepPhysics(fixedDt) {
  if (joltInterface) {
    joltInterface.Step(fixedDt, 1);
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
  if (!playerVehicle) return null;
  const engine = playerVehicle.controller.GetEngine();
  const trans = playerVehicle.controller.GetTransmission();
  
  const mass = 1400.0; // Hardcoded for now
  
  const wheels = [];
  for (let i = 0; i < 4; i++) {
    const w = jolt.castObject(playerVehicle.constraint.GetWheel(i), jolt.WheelWV);
    wheels.push({
      angVel: w.GetAngularVelocity(),
      suspension: w.GetSuspensionLength(),
      longSlip: w.get_mLongitudinalSlip ? w.get_mLongitudinalSlip() : 0,
      latSlip: w.get_mLateralSlip ? w.get_mLateralSlip() : 0,
      contact: w.HasContact(),
      friction: w.get_mCombinedLongitudinalFriction ? w.get_mCombinedLongitudinalFriction() : 0,
      brakeImpulse: w.get_mBrakeImpulse ? w.get_mBrakeImpulse() : 0
    });
  }

  return {
    mass,
    engineRPM: engine.GetCurrentRPM(),
    gear: trans.GetCurrentGear(),
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

export function applyBoost() {
  if (!playerVehicle) return;
  const fwd = playerVehicle.chassisBody.GetRotation().MulVec3(new jolt.Vec3(0, 0, 1));
  const boostVel = new jolt.Vec3(fwd.GetX() * 50, fwd.GetY() * 50, fwd.GetZ() * 50);
  bodyInterface.AddLinearVelocity(playerVehicle.chassisBody.GetID(), boostVel);
  jolt.destroy(fwd);
  jolt.destroy(boostVel);
}

export function resetVehicle(pos, quat) {
  if (!playerVehicle) return;
  const p = new jolt.Vec3(pos.x, pos.y, pos.z);
  const q = new jolt.Quat(quat.x, quat.y, quat.z, quat.w);
  bodyInterface.SetPositionAndRotation(playerVehicle.chassisBody.GetID(), p, q, jolt.EActivation_Activate);
  bodyInterface.SetLinearVelocity(playerVehicle.chassisBody.GetID(), new jolt.Vec3(0,0,0));
  bodyInterface.SetAngularVelocity(playerVehicle.chassisBody.GetID(), new jolt.Vec3(0,0,0));
  jolt.destroy(p);
  jolt.destroy(q);
}

export function fireRocket(startPos, startQuat, onExplode, ownerBody) {
  // Not implemented fully in Jolt test wrapper yet
  return null; 
}

export function deployOilSlick(position, quaternion) {
  // Not implemented fully in Jolt test wrapper yet
  return null;
}

export function raycastForward(chassis) {
  // Return dummy out of bounds to avoid breaking crosshair
  return { x: 0, y: -100, z: 0 };
}

export function getActiveRockets() { return rockets; }
export function getActiveOilSlicks() { return oilSlicks; }
export function getFlipProgress() { return 0; }
export function setVehicleHitbox() {}
export function setOnNetworkBumpApplied() {}
export function checkStrictCollisions() {}

export let collisionMode = 'fast';
export function setCollisionMode(mode) {}
export function setDriveMode(mode) {}
export let handlingMode = 'arcade';
export function setHandlingMode(mode) { handlingMode = mode; }
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
