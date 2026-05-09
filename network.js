/**
 * network.js – PeerJS host/client multiplayer sync for Nitro Seed
 * Host: source of truth, broadcasts seed + settings, manages players
 * Client: interpolates remote positions with exponential LERP
 */
import Peer from 'peerjs';

// ── State ──────────────────────────────────────────────────────────────────
let peer       = null;
let isHost     = false;
let hostConn   = null;          // client→host connection
const peers    = {};            // host: peerId → DataConnection
export const players = {};      // peerId → { name, colorIndex, position, quaternion, velocity, inputState, conn }

let _onPlayerJoin    = null;
let _onPlayerLeave   = null;
let _onGameInit      = null;
let _onStateUpdate   = null;
let _onCratePickup   = null;
let _onRocketFire    = null;
let _onOilDrop       = null;
let _onReturnLobby   = null;
let _onCarUpdate     = null;
let _myPeerId        = null;

// ── Ammo mapping ──────────────────────────────────────────────────────────
const WEAPON_AMMO = { ROCKET: 2, OIL_SLICK: 2, BOOST: 1 };

// ── Init ──────────────────────────────────────────────────────────────────
export function initNetwork(callbacks = {}) {
  _onPlayerJoin   = callbacks.onPlayerJoin   || (() => {});
  _onPlayerLeave  = callbacks.onPlayerLeave  || (() => {});
  _onGameInit     = callbacks.onGameInit     || (() => {});
  _onStateUpdate  = callbacks.onStateUpdate  || (() => {});
  _onCratePickup  = callbacks.onCratePickup  || (() => {});
  _onRocketFire   = callbacks.onRocketFire   || (() => {});
  _onOilDrop      = callbacks.onOilDrop      || (() => {});
  _onReturnLobby  = callbacks.onReturnLobby  || (() => {});
  _onCarUpdate    = callbacks.onCarUpdate    || (() => {});

  return new Promise((resolve, reject) => {
    peer = new Peer(undefined, {
      host:   '0.peerjs.com',
      port:   443,
      secure: true,
      debug:  0,
    });

    peer.on('open', id => {
      _myPeerId = id;
      resolve(id);
    });
    peer.on('error', err => {
      console.error('[Network]', err);
      reject(err);
    });
  });
}

export function getMyPeerId() { return _myPeerId; }
export function getIsHost()   { return isHost; }

// ── Host ───────────────────────────────────────────────────────────────────
export function hostGame(playerName, colorIndex, carModel = 'SUV') {
  isHost = true;
  players[_myPeerId] = {
    name: playerName, colorIndex, carModel, isLocal: true,
    position: { x: 0, y: 0, z: 0 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
    velocity:   { x: 0, y: 0, z: 0 },
    lap: 0, checkpointsReached: 0, finished: false, disqualified: false,
  };

  peer.on('connection', conn => {
    conn.on('open', () => {
      const pid = conn.peer;
      peers[pid] = conn;
      // Send current lobby state
      conn.send({ type: 'WELCOME', yourId: pid, existingPlayers: _sanitizePlayers() });
      _setupHostConnHandlers(conn);
    });
  });
}

function _setupHostConnHandlers(conn) {
  const pid = conn.peer;

  conn.on('data', data => {
    switch (data.type) {
      case 'JOIN':
        players[pid] = {
          name: data.name,
          colorIndex: Object.keys(players).length % 6,
          carModel: data.carModel || 'SUV',
          position: { x: 0, y: 0, z: 0 },
          quaternion: { x: 0, y: 0, z: 0, w: 1 },
          velocity:   { x: 0, y: 0, z: 0 },
          lap: 0, checkpointsReached: 0, finished: false, disqualified: false,
          conn,
        };
        _broadcastExcept(pid, { type: 'PLAYER_JOINED', id: pid, name: data.name, colorIndex: players[pid].colorIndex, carModel: players[pid].carModel });
        conn.send({ type: 'JOIN_OK', colorIndex: players[pid].colorIndex });
        _onPlayerJoin(pid, players[pid]);
        break;

      case 'UPDATE_CAR':
        if (players[pid]) {
          players[pid].carModel = data.carModel;
        }
        _broadcastExcept(pid, { type: 'PLAYER_CAR_UPDATED', id: pid, carModel: data.carModel });
        _onCarUpdate(pid, data.carModel);
        break;

      case 'STATE':
        if (players[pid]) {
          players[pid]._lerp      = { pos: data.pos, quat: data.quat };
          players[pid].velocity   = data.vel;
          players[pid].inputState = data.input;
        }
        // Relay to all other peers
        _broadcastExcept(pid, { type: 'PEER_STATE', id: pid, pos: data.pos, quat: data.quat, vel: data.vel });
        break;

      case 'CRATE_PICKUP':
        _broadcastExcept(pid, { type: 'CRATE_PICKUP', id: pid, crateIdx: data.crateIdx, weaponType: data.weaponType });
        _onCratePickup(pid, data.crateIdx, data.weaponType);
        break;

      case 'ROCKET_FIRE':
        _broadcastExcept(pid, { type: 'ROCKET_FIRE', id: pid, pos: data.pos, quat: data.quat });
        _onRocketFire(pid, data.pos, data.quat);
        break;

      case 'OIL_DROP':
        _broadcastExcept(pid, { type: 'OIL_DROP', id: pid, pos: data.pos, quat: data.quat });
        _onOilDrop(pid, data.pos, data.quat);
        break;

      case 'LAP_COMPLETE':
        if (players[pid]) players[pid].lap = data.lap;
        _broadcastToAll({ type: 'PLAYER_LAP', id: pid, lap: data.lap });
        break;

      case 'FINISHED':
        if (players[pid]) {
          players[pid].finished = true;
          players[pid].finishTime = data.time;
          players[pid].bestLap = data.bestLap;
        }
        _broadcastToAll({ type: 'PLAYER_FINISHED', id: pid, time: data.time, bestLap: data.bestLap });
        break;

      case 'RETURN_LOBBY':
        if (isHost) {
          _broadcastToAll({ type: 'RETURN_LOBBY' });
          _onReturnLobby();
        }
        break;
    }
  });

  conn.on('close', () => {
    delete peers[pid];
    delete players[pid];
    _broadcastToAll({ type: 'PLAYER_LEFT', id: pid });
    _onPlayerLeave(pid);
  });
}

export function startRace(seed, lapCount, driveMode) {
  _broadcastToAll({ type: 'GAME_INIT', seed, lapCount, driveMode });
}

export function kickPlayer(peerId) {
  if (!isHost || !peers[peerId]) return;
  peers[peerId].send({ type: 'KICKED' });
  setTimeout(() => { peers[peerId]?.close(); }, 200);
  delete peers[peerId];
  delete players[peerId];
  _broadcastToAll({ type: 'PLAYER_LEFT', id: peerId });
  _onPlayerLeave(peerId);
}

// ── Client ─────────────────────────────────────────────────────────────────
export function joinGame(hostPeerId, playerName, carModel = 'SUV') {
  isHost  = false;
  hostConn = peer.connect(hostPeerId, { reliable: false });

  return new Promise((resolve, reject) => {
    hostConn.on('open', () => {
      hostConn.send({ type: 'JOIN', name: playerName, carModel });
    });

    hostConn.on('data', data => {
      switch (data.type) {
        case 'WELCOME':
          // Populate existing players
          Object.entries(data.existingPlayers).forEach(([id, p]) => {
            if (id !== _myPeerId) {
              players[id] = {
                ...p,
                position: { x: 0, y: 0, z: 0 },
                quaternion: { x: 0, y: 0, z: 0, w: 1 },
                velocity: { x: 0, y: 0, z: 0 },
                _lerp: { pos: null, quat: null }
              };
            }
          });
          break;

        case 'JOIN_OK':
          players[_myPeerId] = {
            name: playerName, colorIndex: data.colorIndex, carModel, isLocal: true,
            position: { x: 0, y: 0, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
            velocity: { x: 0, y: 0, z: 0 },
            lap: 0, checkpointsReached: 0, finished: false, disqualified: false,
          };
          resolve(data.colorIndex);
          break;

        case 'GAME_INIT':
          _onGameInit(data.seed, data.lapCount, data.driveMode);
          break;

        case 'PLAYER_JOINED':
          players[data.id] = {
            name: data.name, colorIndex: data.colorIndex, carModel: data.carModel || 'SUV',
            position: { x: 0, y: 0, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
            velocity: { x: 0, y: 0, z: 0 },
            _lerp: { pos: null, quat: null },
          };
          _onPlayerJoin(data.id, players[data.id]);
          break;

        case 'PLAYER_CAR_UPDATED':
          if (players[data.id]) {
            players[data.id].carModel = data.carModel;
          }
          _onCarUpdate(data.id, data.carModel);
          break;

        case 'PLAYER_LEFT':
          delete players[data.id];
          _onPlayerLeave(data.id);
          break;

        case 'PEER_STATE':
          if (players[data.id]) {
            players[data.id]._lerp = { pos: data.pos, quat: data.quat };
            players[data.id].velocity = data.vel;
          }
          _onStateUpdate(data.id, data.pos, data.quat);
          break;

        case 'CRATE_PICKUP':
          _onCratePickup(data.id, data.crateIdx, data.weaponType);
          break;

        case 'ROCKET_FIRE':
          _onRocketFire(data.id, data.pos, data.quat);
          break;

        case 'OIL_DROP':
          _onOilDrop(data.id, data.pos, data.quat);
          break;

        case 'PLAYER_LAP':
          if (players[data.id]) players[data.id].lap = data.lap;
          break;

        case 'PLAYER_FINISHED':
          if (players[data.id]) {
            players[data.id].finished = true;
            players[data.id].finishTime = data.time;
            players[data.id].bestLap = data.bestLap;
          }
          break;

        case 'RETURN_LOBBY':
          _onReturnLobby();
          break;

        case 'KICKED':
          alert('You were kicked by the host.');
          hostConn.close();
          location.reload();
          break;
      }
    });

    hostConn.on('close', () => {
      reject(new Error('Connection closed'));
    });
    hostConn.on('error', reject);
  });
}

// ── Interpolation (client-side LERP for remote players) ─────────────────────
export function lerpRemotePlayers(dt) {
  const alpha = 1 - Math.exp(-12 * dt); // exponential smoothing
  Object.entries(players).forEach(([id, p]) => {
    if (p.isLocal || !p._lerp?.pos) return;
    // Position
    p.position.x = _lerp(p.position.x, p._lerp.pos.x, alpha);
    p.position.y = _lerp(p.position.y, p._lerp.pos.y, alpha);
    p.position.z = _lerp(p.position.z, p._lerp.pos.z, alpha);
    // Quaternion slerp
    if (p._lerp.quat) {
      p.quaternion.x = _lerp(p.quaternion.x, p._lerp.quat.x, alpha);
      p.quaternion.y = _lerp(p.quaternion.y, p._lerp.quat.y, alpha);
      p.quaternion.z = _lerp(p.quaternion.z, p._lerp.quat.z, alpha);
      p.quaternion.w = _lerp(p.quaternion.w, p._lerp.quat.w, alpha);
    }
  });
}

// ── Send local state ────────────────────────────────────────────────────────
let _sendTimer = 0;
export function sendLocalState(chassis, inputState, dt) {
  _sendTimer += dt;
  if (_sendTimer < 1 / 20) return; // 20Hz send rate
  _sendTimer = 0;

  if (!chassis) return;
  const p = chassis.position, q = chassis.quaternion, v = chassis.velocity;
  const packet = {
    type:  'STATE',
    pos:   { x: p.x, y: p.y, z: p.z },
    quat:  { x: q.x, y: q.y, z: q.z, w: q.w },
    vel:   { x: v.x, y: v.y, z: v.z },
    input: inputState,
  };

  if (isHost) {
    if (players[_myPeerId]) {
      players[_myPeerId].position   = packet.pos;
      players[_myPeerId].quaternion = packet.quat;
    }
    _broadcastToAll({ ...packet, type: 'PEER_STATE', id: _myPeerId });
  } else {
    hostConn?.send(packet);
  }
}

export function sendCratePickup(crateIdx, weaponType) {
  const msg = { type: 'CRATE_PICKUP', crateIdx, weaponType };
  isHost ? _onCratePickup(_myPeerId, crateIdx, weaponType) : hostConn?.send(msg);
}

export function sendRocketFire(pos, quat) {
  const msg = { type: 'ROCKET_FIRE', pos, quat };
  if (isHost) {
    _broadcastToAll({ ...msg, id: _myPeerId });
  } else {
    hostConn?.send(msg);
  }
}

export function sendOilDrop(pos, quat) {
  const msg = { type: 'OIL_DROP', pos, quat };
  if (isHost) {
    _broadcastToAll({ ...msg, id: _myPeerId });
  } else {
    hostConn?.send(msg);
  }
}

export function sendLapComplete(lap) {
  const msg = { type: 'LAP_COMPLETE', lap };
  isHost ? (players[_myPeerId].lap = lap) : hostConn?.send(msg);
}

export function sendFinished(time, bestLap) {
  const msg = { type: 'FINISHED', time, bestLap };
  if (isHost) {
    players[_myPeerId].finished = true;
    players[_myPeerId].finishTime = time;
    players[_myPeerId].bestLap = bestLap;
  } else {
    hostConn?.send(msg);
  }
}

export function returnToLobby() {
  if (isHost) {
    _broadcastToAll({ type: 'RETURN_LOBBY' });
    _onReturnLobby();
  } else {
    hostConn?.send({ type: 'RETURN_LOBBY' });
  }
}

export function sendCarUpdate(carModel) {
  if (players[_myPeerId]) {
    players[_myPeerId].carModel = carModel;
  }
  if (isHost) {
    _broadcastToAll({ type: 'PLAYER_CAR_UPDATED', id: _myPeerId, carModel });
  } else {
    hostConn?.send({ type: 'UPDATE_CAR', carModel });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function _broadcastToAll(msg) {
  Object.values(peers).forEach(conn => conn.send(msg));
}
function _broadcastExcept(excludeId, msg) {
  Object.entries(peers).forEach(([id, conn]) => { if (id !== excludeId) conn.send(msg); });
}
function _sanitizePlayers() {
  const out = {};
  Object.entries(players).forEach(([id, p]) => {
    out[id] = { name: p.name, colorIndex: p.colorIndex, carModel: p.carModel };
  });
  return out;
}
function _lerp(a, b, t) { return a + (b - a) * t; }
