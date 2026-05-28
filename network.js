/**
 * network.js – Socket.IO authoritative client sync for Nitro Seed
 * Connects to Node.js backend. The server is the ultimate source of truth.
 */
import { io } from 'socket.io-client';

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

const PLAYER_COLOR_COUNT = 6;
// You can switch this to localhost for local dev if needed
const SERVER_URL = 'https://nitro-server-05t0.onrender.com';

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
    players[p.id] = { ...p, _lerp: { pos: null, quat: null } };
    _onPlayerJoin(p.id, players[p.id]);
  });

  socket.on('PLAYER_LEFT', (data) => {
    delete players[data.id];
    _onPlayerLeave(data.id);
  });

  // The server sends STATE_UPDATE containing exact physics coordinates 60 times a second
  socket.on('STATE_UPDATE', (stateUpdate) => {
    for (const id in stateUpdate) {
      if (players[id]) {
        // If it's remote, we lerp to it. If it's local, we reconcile (client-side prediction)
        players[id]._lerp = { pos: stateUpdate[id].p, quat: stateUpdate[id].q };
        players[id].velocity = stateUpdate[id].v;
        if (id !== _myPeerId) {
          _onStateUpdate(id, stateUpdate[id].p, stateUpdate[id].q);
        }
      }
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
  socket.on('RETURN_LOBBY', () => _onReturnLobby());

  // Game Events
  socket.on('CRATE_PICKUP', (data) => _onCratePickup(data.id, data.crateIdx, data.weaponType));
  socket.on('ROCKET_FIRE', (data) => _onRocketFire(data.id, data.pos, data.quat));
  socket.on('OIL_DROP', (data) => _onOilDrop(data.id, data.pos, data.quat));
  socket.on('VEHICLE_HIT', (data) => _onVehicleHit(_myPeerId, data.bumpVel, data.attackerId, data.bumpAngVel));
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
  const alpha = 1 - Math.exp(-12 * dt); // exponential smoothing
  for (const id in players) {
    const p = players[id];
    if (p.isLocal || !p._lerp?.pos) continue;
    p.position.x = _lerp(p.position.x, p._lerp.pos.x, alpha);
    p.position.y = _lerp(p.position.y, p._lerp.pos.y, alpha);
    p.position.z = _lerp(p.position.z, p._lerp.pos.z, alpha);
    if (p._lerp.quat) {
      p.quaternion.x = _lerp(p.quaternion.x, p._lerp.quat.x, alpha);
      p.quaternion.y = _lerp(p.quaternion.y, p._lerp.quat.y, alpha);
      p.quaternion.z = _lerp(p.quaternion.z, p._lerp.quat.z, alpha);
      p.quaternion.w = _lerp(p.quaternion.w, p._lerp.quat.w, alpha);
    }
  }
}

// ── Actions ────────────────────────────────────────────────────────────────
let _sendTimer = 0;
export function sendLocalState(chassis, inputState, dt) {
  _sendTimer += dt;
  if (_sendTimer < 1 / 60) return; // Send inputs at 60Hz to server
  _sendTimer = 0;

  // We only send INPUTS to the server. The server dictates position.
  if (socket) {
    socket.emit('INPUT', inputState);
  }
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
