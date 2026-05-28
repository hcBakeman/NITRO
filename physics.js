import * as THREE from 'three';
import Jolt from 'jolt-physics';
import * as Network from './network.js';
import { createJoltVehicle } from './joltVehicle.js';

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
  
  console.log('[+] Jolt Physics Client Initialized');
}

export function getWorld() {
  return physicsSystem;
}

export function clearPhysicsWorld() {
  // Can't easily clear in Jolt without destroying all bodies.
  // Instead, the engine usually handles map replacement cleanly.
}

export function createLocalVehicle(x, y, z) {
  playerVehicle = createJoltVehicle(jolt, physicsSystem, bodyInterface, [x, y, z], null, LAYER_MOVING);
}

export function createPlayerVehicle(startPos, startQuat, carModel) {
  playerCarSpecs = carModel;
  
  playerVehicle = createJoltVehicle(jolt, physicsSystem, bodyInterface, [startPos.x, startPos.y, startPos.z], [startQuat.x, startQuat.y, startQuat.z, startQuat.w], LAYER_MOVING);
  
  // Expose Cannon-like wrapper so GameEngine can read .velocity and .position
  playerChassis = {
    get position() {
      const p = playerVehicle.chassisBody.GetPosition();
      return { x: p.GetX(), y: p.GetY(), z: p.GetZ() };
    },
    get quaternion() {
      const q = playerVehicle.chassisBody.GetRotation();
      return { x: q.GetX(), y: q.GetY(), z: q.GetZ(), w: q.GetW() };
    },
    get velocity() {
      const v = playerVehicle.chassisBody.GetLinearVelocity();
      const length = () => Math.sqrt(v.GetX()**2 + v.GetY()**2 + v.GetZ()**2);
      return { x: v.GetX(), y: v.GetY(), z: v.GetZ(), length };
    }
  };
}

export function createRemoteVehicle(peerId, mass, carModel, spawnPos, spawnQuat) {
  // Remote vehicles are completely kinematic on the client in Jolt
  // Actually, we don't even need a Jolt body! The network perfectly syncs visuals.
  // We just return a dummy.
  const dummy = {
    position: spawnPos ? { ...spawnPos } : { x: 0, y: 0, z: 0 },
    quaternion: spawnQuat ? { ...spawnQuat } : { x: 0, y: 0, z: 0, w: 1 },
    velocity: { x: 0, y: 0, z: 0 }
  };
  remoteVehicles[peerId] = dummy;
}

export function removeRemoteVehicle(peerId) {
  delete remoteVehicles[peerId];
}

export function syncRemoteBody(id, targetPos, targetQuat, targetVel, dt) {
  if (remoteVehicles[id]) {
    remoteVehicles[id].position = targetPos;
    remoteVehicles[id].quaternion = targetQuat;
    remoteVehicles[id].velocity = targetVel;
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
  
  let forward = 0.0;
  if (input.forward) forward = 1.0;
  if (input.backward) forward = -1.0;
  
  let right = 0.0;
  if (input.right) right = 1.0;
  if (input.left) right = -1.0;
  
  let handbrake = input.drift ? 1.0 : 0.0;
  
  controller.SetDriverInput(forward, right, 0.0, handbrake);
}

export function stepPhysics(dt) {
  if (joltInterface) {
    // Step the simulation using the helper class
    joltInterface.Step(dt, 1);
  }
}

export function checkFlip(dt) {
  return false;
}

export function applyBoost() {
  if (!playerVehicle) return;
  const fwd = playerVehicle.chassisBody.GetRotation().RotateVector3(new jolt.Vec3(0, 0, 1));
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
export function setHandlingMode(mode) {}
export let world = {};
export let groundMat = {};
export let wallMat = {};
export function applyNetworkBump(vel, ang, id) {}
