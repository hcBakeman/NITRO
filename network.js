/**
 * network.js – Socket.IO authoritative client sync for Nitro Seed
 * Connects to Node.js backend. The server is the ultimate source of truth.
 */
import { io } from 'socket.io-client';
import { pushSnapshot, getInterpolatedState, removeBuffer, clearAll } from './networkInterpolation.js';

// ── State ──────────────────────────────────────────────────────────────────
let socket = null;
export let isHost = false; // Kept for UI logic, but the Server is the true Host
export const players = {}; // id → { name, colorIndex, position, quaternion, velocity, inputState }

let _onPlayerJoin = () => {};
let _onPlayerLeave = () => {};
let _onGameInit = () => {};
let _onStateUpdate = () => {};
let _onCratePickup = () => {};
let _onRocketFire = () => {};
let _onOilDrop = () => {};
let _onReturnLobby = () => {};
let _onCarUpdate = () => {};
let _onKicked = () => { location.reload(); };
let _onVehicleHit = () => {};
let _onPlayerLoaded = () => {};
let _onStartCountdown = () => {};
let _onLobbyCountdown = (done) => done();
let _myPeerId = null;

const EVENT_QUEUE = [];
let _localTick = 0;
let _tickAccumulator = 0;
const CLIENT_TICK_RATE = 20;
const TICK_DURATION = 1 / CLIENT_TICK_RATE;

function _syncTick(serverTick) {
  if (_localTick === 0) {
    _localTick = serverTick;
    return;
  }
  const drift = serverTick - _localTick;
  if (Math.abs(drift) > 10) {
    _localTick = serverTick;
  } else if (drift > 0) {
    _localTick += Math.ceil(drift * 0.1);
  }
}

function _executeEvent(event) {
  switch (event.type) {
    case 'ROCKET_FIRE':
      _onRocketFire(event.data.sourceId, event.data.pos, event.data.quat);
      break;
    case 'OIL_DROP':
      _onOilDrop(event.data.sourceId, event.data.pos, event.data.quat);
      break;
    case 'CRATE_PICKUP':
      _onCratePickup(event.data.sourceId, event.data.crateIdx, event.data.weaponType);
      break;
    case 'VEHICLE_HIT':
      _onVehicleHit(_myPeerId, event.data.bumpVel, event.data.attackerId, event.data.bumpAngVel);
      break;
  }
}

const PLAYER_COLOR_COUNT = 6;
// You can switch this to localhost for local dev if needed
const SERVER_URL = 'https://nitro-server-05t0.onrender.com';

const _idHashMap = new Map();
function _registerIdHash(fullId) {
  let h = 0;
  for (let i = 0; i < fullId.length; i++) {
    h = ((h << 5) - h + fullId.charCodeAt(i)) | 0;
  }
  _idHashMap.set(h & 0xFFFF, fullId);
}

// ── Init ──────────────────────────────────────────────────────────────────
export function initNetwork(callbacks = {}, customId = undefined) {
  _onPlayerJoin = callbacks.onPlayerJoin || _onPlayerJoin;
  _onPlayerLeave = callbacks.onPlayerLeave || _onPlayerLeave;
  _onGameInit = callbacks.onGameInit || _onGameInit;
  _onStateUpdate = callbacks.onStateUpdate || _onStateUpdate;
  _onCratePickup = callbacks.onCratePickup || _onCratePickup;
  _onRocketFire = callbacks.onRocketFire || _onRocketFire;
  _onOilDrop = callbacks.onOilDrop || _onOilDrop;
  _onReturnLobby = callbacks.onReturnLobby || _onReturnLobby;
  _onCarUpdate = callbacks.onCarUpdate || _onCarUpdate;
  _onKicked = callbacks.onKicked || _onKicked;
  _onVehicleHit = callbacks.onVehicleHit || _onVehicleHit;
  _onPlayerLoaded = callbacks.onPlayerLoaded || _onPlayerLoaded;
  _onStartCountdown = callbacks.onStartCountdown || _onStartCountdown;
  _onLobbyCountdown = callbacks.onLobbyCountdown || _onLobbyCountdown;

  if (socket && socket.connected) {
    return Promise.resolve(socket.id);
  }

  return new Promise((resolve, reject) => {
    socket = io(SERVER_URL);

    socket.on('connect', () => {
      _myPeerId = socket.id;
      _setupSocketHandlers();
      resolve(socket.id);
    });

    socket.on('connect_error', (err) => {
      reject(new Error('Failed to connect to backend server: ' + err.message));
    });
  });
}

export function getMyPeerId() { return _myPeerId; }
export function getIsHost() { return isHost; }

// Dummy RTT for now
export const rttValues = {};
export function getPingTo(peerId) { return 50; }

// ── Host / Join ────────────────────────────────────────────────────────────
// In the new architecture, there is no technical host, but we assign the first person to click "Host Game" as the Lobby Leader
export function hostGame(playerName, colorIndex, carModel = 'dacia_duster_low_poly') {
  isHost = true;
  _joinLobby(playerName, carModel);
}

export function connectToHost(hostPeerId, playerName, carModel = 'dacia_duster_low_poly') {
  isHost = false;
  return new Promise((resolve) => {
    _joinLobby(playerName, carModel);
    // Wait for the WELCOME packet to get our color index
    socket.once('WELCOME', (data) => {
      resolve(Object.keys(data.existingPlayers).length % PLAYER_COLOR_COUNT);
    });
  });
}

function _joinLobby(name, carModel) {
  socket.emit('JOIN', { name, carModel });
}

function _setupSocketHandlers() {
  socket.on('WELCOME', (data) => {
    // Populate existing players
    Object.entries(data.existingPlayers).forEach(([id, p]) => {
      _registerIdHash(id);
      if (id !== _myPeerId) {
        players[id] = { ...p, _lerp: { pos: null, quat: null } };
      } else {
        players[id] = { ...p, isLocal: true };
      }
    });
    if (data.lobbySettings && typeof window._updateGuestLobbySettings === 'function') {
      window._updateGuestLobbySettings(data.lobbySettings);
    }
  });

  socket.on('PLAYER_JOINED', (p) => {
    _registerIdHash(p.id);
    players[p.id] = { ...p, _lerp: { pos: null, quat: null } };
    _onPlayerJoin(p.id, players[p.id]);
  });

  socket.on('PLAYER_LEFT', (data) => {
    delete players[data.id];
    removeBuffer(data.id);
    _onPlayerLeave(data.id);
  });

  socket.on('STATE_BIN', (buf) => {
    const arrayBuffer = buf.buffer ? buf.buffer : new Uint8Array(buf).buffer;
    const view = new DataView(arrayBuffer, buf.byteOffset, buf.byteLength);
    const count = view.getUint8(0);
    const serverTick = view.getUint16(1, true);
    _syncTick(serverTick);

    let offset = 3;
    for (let i = 0; i < count; i++) {
      const idHash = view.getUint16(offset, true); offset += 2;
      const px = view.getFloat32(offset, true); offset += 4;
      const py = view.getFloat32(offset, true); offset += 4;
      const pz = view.getFloat32(offset, true); offset += 4;
      const qx = view.getFloat32(offset, true); offset += 4;
      const qy = view.getFloat32(offset, true); offset += 4;
      const qz = view.getFloat32(offset, true); offset += 4;
      const vx = view.getFloat32(offset, true); offset += 4;
      const vy = view.getFloat32(offset, true); offset += 4;
      const vz = view.getFloat32(offset, true); offset += 4;

      const qwSq = 1.0 - qx * qx - qy * qy - qz * qz;
      const qw = qwSq > 0 ? Math.sqrt(qwSq) : 0;

      const id = _idHashMap.get(idHash);
      if (!id || !players[id] || id === _myPeerId) continue;

      pushSnapshot(id, serverTick, px, py, pz, qx, qy, qz, qw, vx, vy, vz);
    }
  });

  socket.on('PLAYER_CAR_UPDATED', (data) => {
    if (players[data.id]) players[data.id].carModel = data.carModel;
    _onCarUpdate(data.id, data.carModel);
  });

  socket.on('GAME_INIT', (data) => {
    Object.values(players).forEach(p => p.loaded = false);
    _onGameInit(data.seed, data.lapCount, data.driveMode, data.handlingMode, data.gridAssignments, data.collisionMode);
  });

  socket.on('PLAYER_LOADED', (data) => {
    if (players[data.id]) players[data.id].loaded = true;
    _onPlayerLoaded(players);
  });

  socket.on('START_COUNTDOWN', () => _onStartCountdown());
  socket.on('LOBBY_COUNTDOWN', () => _onLobbyCountdown(() => {}));
  socket.on('RETURN_LOBBY', () => {
    clearAll();
    _onReturnLobby();
  });

  // Game Events are now scheduled
  socket.on('EVENT_SCHEDULED', (event) => {
    if (event.executeTick <= _localTick) {
      _executeEvent(event);
      return;
    }
    EVENT_QUEUE.push(event);
  });
  
  socket.on('PLAYER_LAP', (data) => { if (players[data.id]) players[data.id].lap = data.lap; });
  socket.on('PLAYER_FINISHED', (data) => {
    if (players[data.id]) {
      players[data.id].finished = true;
      players[data.id].finishTime = data.time;
      players[data.id].bestLap = data.bestLap;
    }
  });
  socket.on('LOBBY_SETTINGS', (data) => {
    if (data.settings && typeof window._updateGuestLobbySettings === 'function') {
      window._updateGuestLobbySettings(data.settings);
    }
  });
  socket.on('KICKED', () => _onKicked());
}

// ── Interpolation ───────────────────────────────────────────────────────────
export function lerpRemotePlayers(dt) {
  _tickAccumulator += dt;
  while (_tickAccumulator >= TICK_DURATION) {
    _tickAccumulator -= TICK_DURATION;
    _localTick++;

    let i = EVENT_QUEUE.length;
    while (i--) {
      const evt = EVENT_QUEUE[i];
      if (evt.executeTick <= _localTick) {
        _executeEvent(EVENT_QUEUE.splice(i, 1)[0]);
      }
    }
  }

  for (const id in players) {
    const p = players[id];
    if (p.isLocal) continue;

    const interp = getInterpolatedState(id);
    if (!interp) continue;

    p.position.x = interp.pos.x;
    p.position.y = interp.pos.y;
    p.position.z = interp.pos.z;
    if (p.quaternion) {
      p.quaternion.x = interp.quat.x;
      p.quaternion.y = interp.quat.y;
      p.quaternion.z = interp.quat.z;
      p.quaternion.w = interp.quat.w;
    }
    p.velocity = interp.vel;
  }
}

// ── Actions ────────────────────────────────────────────────────────────────
let _sendTimer = 0;
let _lastInputByte = -1;
let _inputSeq = 0;

export function sendLocalState(chassis, inputState, dt) {
  _sendTimer += dt;
  if (_sendTimer < 1 / 60) return;
  _sendTimer = 0;

  if (!socket) return;

  let byte = 0;
  if (inputState.forward)  byte |= 1;
  if (inputState.backward) byte |= 2;
  if (inputState.left)     byte |= 4;
  if (inputState.right)    byte |= 8;
  if (inputState.fire)     byte |= 16;
  if (inputState.reset)    byte |= 32;

  if (byte === _lastInputByte) return;
  _lastInputByte = byte;

  const buf = new ArrayBuffer(3);
  const view = new DataView(buf);
  view.setUint16(0, (_inputSeq++) & 0xFFFF, true);
  view.setUint8(2, byte);

  socket.emit('INPUT_BIN', buf);
}

export function startRace(seed, lapCount, driveMode, handlingMode, gridAssignments, collisionMode) {
  socket.emit('START_RACE', { seed, lapCount, driveMode, handlingMode, gridAssignments, collisionMode });
}

export function broadcastLobbySettings(settings) {
  if (isHost) socket.emit('LOBBY_SETTINGS', { settings });
}

export function sendLoaded() {
  socket.emit('LOADED');
}

export function sendVehicleHit(targetId, bumpVel, attackerId, bumpAngVel = null) {
  socket.emit('VEHICLE_HIT', { targetId, bumpVel, bumpAngVel });
}

export function kickPlayer(peerId) {
  if (isHost) socket.emit('KICK_PLAYER', { targetId: peerId });
}

export function sendCratePickup(crateIdx, weaponType) {
  socket.emit('CRATE_PICKUP', { crateIdx, weaponType });
}

export function sendRocketFire(pos, quat) {
  socket.emit('ROCKET_FIRE', { pos, quat });
}

export function sendOilDrop(pos, quat) {
  socket.emit('OIL_DROP', { pos, quat });
}

export function sendLapComplete(lap) {
  socket.emit('LAP_COMPLETE', { lap });
}

export function sendFinished(time, bestLap) {
  socket.emit('FINISHED', { time, bestLap });
}

export function returnToLobby() {
  if (isHost) socket.emit('RETURN_LOBBY');
}

export function sendCarUpdate(carModel) {
  if (players[_myPeerId]) players[_myPeerId].carModel = carModel;
  socket.emit('UPDATE_CAR', { carModel });
}

function _lerp(a, b, t) {
  return a + (b - a) * t;
}
