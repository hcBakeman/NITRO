/**
 * game.js – State machine, input, lap/checkpoint logic, troll prevention
 * States: MENU → LOBBY → RACING → FINISHED
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import * as Physics from './physics.js';
import * as Network from './network.js';
import * as Graphics from './graphics.js';
import {
  generateMap,
  checkCheckpointProximity,
  checkCrateProximity,
  updateCrateRespawns,
} from './map.js';
import { formatTime } from './utils.js';

// ── State ──────────────────────────────────────────────────────────────────
export const STATE = { MENU: 'MENU', LOBBY: 'LOBBY', RACING: 'RACING', FINISHED: 'FINISHED' };
let currentState = STATE.MENU;

export function getState() {
  return currentState;
}
export function setState(s) {
  currentState = s;
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  const hudEl = document.getElementById('hud');
  if (s === STATE.MENU) {
    document.getElementById('screen-menu').classList.add('active');
    hudEl.classList.add('hidden');
  }
  if (s === STATE.LOBBY) {
    document.getElementById('screen-lobby').classList.add('active');
    hudEl.classList.add('hidden');
  }
  if (s === STATE.RACING) {
    hudEl.classList.remove('hidden');
  }
  if (s === STATE.FINISHED) {
    document.getElementById('screen-finished').classList.add('active');
    hudEl.classList.add('hidden');
  }
}

// ── Input ──────────────────────────────────────────────────────────────────
export const input = { forward: false, backward: false, left: false, right: false, fire: false };
let fireQueued = false;

export function initInput() {
  const down = e => {
    if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') input.forward = true;
    if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') input.backward = true;
    if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') input.left = true;
    if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') input.right = true;
    if (e.key === ' ' && !input.fire) {
      input.fire = true;
      fireQueued = true;
    }
  };
  const up = e => {
    if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') input.forward = false;
    if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') input.backward = false;
    if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') input.left = false;
    if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') input.right = false;
    if (e.key === ' ') input.fire = false;
  };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
}

export function consumeFire() {
  const f = fireQueued;
  fireQueued = false;
  return f;
}

// ── Weapon ─────────────────────────────────────────────────────────────────
const AMMO = { ROCKET: 2, OIL_SLICK: 2, BOOST: 1 };
export let heldWeapon = null;
export let heldAmmo = 0;

export function pickupWeapon(type) {
  heldWeapon = type;
  heldAmmo = AMMO[type] || 1;
  _updateWeaponHUD();
}

export function consumeWeapon() {
  if (!heldWeapon || heldAmmo <= 0) return null;
  const w = heldWeapon;
  heldAmmo--;
  if (heldAmmo <= 0) heldWeapon = null;
  _updateWeaponHUD();
  return w;
}

function _updateWeaponHUD() {
  const icons = { ROCKET: '🚀', OIL_SLICK: '🛢', BOOST: '⚡' };
  document.getElementById('hud-weapon').textContent = heldWeapon
    ? `${icons[heldWeapon] || '?'} ${heldWeapon}`
    : 'NO WEAPON';
  document.getElementById('hud-ammo').textContent = heldAmmo > 0 ? `×${heldAmmo}` : '';
}

// ── Race data ──────────────────────────────────────────────────────────────
let mapData = null;
let lapCount = 3;
let myLap = 0;
let myCheckpointsThisLap = 0;
let raceStartTime = 0;
let raceFinished = false;
let trollTimer = 0;
let winnerFinishedAt = null;
const TROLL_TIMEOUT = 15;
let lastPos = null;
let stuckTimer = 0;

export let racePhase = 'INTRO'; // 'INTRO', 'COUNTDOWN', 'ACTIVE', 'FINISHED'
export let raceCountdown = 5.0; // 5s for Intro, then 4s for Lights
export let currentRaceTime = 0;
export let currentLapTime = 0;
export let bestCheckpointTimes = [];
export let bestLapTime = Infinity;

export function initRace(seed, laps, world, groundMat, wallMat) {
  lapCount = laps;
  myLap = 1;
  myCheckpointsThisLap = 0;
  raceFinished = false;
  trollTimer = 0;
  winnerFinishedAt = null;
  heldWeapon = null;
  heldAmmo = 0;
  lastPos = null;
  stuckTimer = 0;

  racePhase = 'INTRO';
  raceCountdown = 5.0;
  currentRaceTime = 0;
  currentLapTime = 0;
  bestCheckpointTimes = [];
  bestLapTime = Infinity;

  mapData = generateMap(seed, world, groundMat, wallMat);
  raceStartTime = performance.now() / 1000;

  _updateLapHUD();
  _updateWeaponHUD();
  return mapData;
}

export function getRaceMapData() {
  return mapData;
}

// ── Per-frame race update ──────────────────────────────────────────────────
export function updateRace(dt, chassis) {
  if (currentState !== STATE.RACING || !mapData || !chassis) return;

  const pos = chassis.position;

  if (racePhase === 'INTRO') {
    raceCountdown -= dt;
    if (raceCountdown <= 0) {
      racePhase = 'COUNTDOWN';
      raceCountdown = 4.0;
      _showHUDMsg('GET READY!');
    }
    return; // Lock input and logic during intro
  }

  if (racePhase === 'COUNTDOWN') {
    if (currentRaceTime === 0 && (input.forward || input.backward)) {
      currentRaceTime = 5.0; // Jump start penalty
      _showSplitMsg('JUMP START! +5s PENALTY', 'positive');
    }

    raceCountdown -= dt;
    if (raceCountdown <= 0) {
      racePhase = 'ACTIVE';
      currentLapTime = currentRaceTime;
    }
  } else {
    currentRaceTime += dt;
    currentLapTime += dt;
  }

  // ── Checkpoint detection ──
  const hitCp = checkCheckpointProximity(pos, mapData.checkpoints);
  if (hitCp) {
    const expected = myCheckpointsThisLap;
    if (hitCp.index === expected % mapData.checkpoints.length) {
      hitCp.passed = true;
      myCheckpointsThisLap++;
      Graphics.flashCheckpoint(hitCp.index);

      const cpIndex = hitCp.index;
      if (bestCheckpointTimes[cpIndex]) {
        const split = currentLapTime - bestCheckpointTimes[cpIndex];
        const sign = split > 0 ? '+' : '';
        _showSplitMsg(`${sign}${split.toFixed(2)}s`, split > 0 ? 'positive' : 'negative');
        if (currentLapTime < bestCheckpointTimes[cpIndex]) {
          bestCheckpointTimes[cpIndex] = currentLapTime;
        }
      } else {
        bestCheckpointTimes[cpIndex] = currentLapTime;
      }

      _showHUDMsg(`CHECKPOINT ${hitCp.index + 1}!`);

      // Finish line = checkpoint index 3 (t=1.0) + all others passed
      if (hitCp.index === 3 && myCheckpointsThisLap >= 4) {
        _completeLap();
      }
    }
  }

  // ── Wrong Way Detection (throttled) ──
  if (chassis && mapData.spline && chassis.velocity.lengthSquared() > 10) {
    if (!chassis._lastWwCheck || performance.now() - chassis._lastWwCheck > 500) {
      chassis._lastWwCheck = performance.now();
      
      let closestT = chassis._closestT;
      let minDistSq = Infinity;

      // 1. Find Closest Point on Spline
      if (closestT === undefined) {
        // First time or after reset: Global search
        const GLOBAL_STEPS = 50;
        for (let i = 0; i <= GLOBAL_STEPS; i++) {
          const t = i / GLOBAL_STEPS;
          const pt = mapData.spline.getPointAt(t);
          const dSq = pt.distanceToSquared(pos);
          if (dSq < minDistSq) {
            minDistSq = dSq;
            closestT = t;
          }
        }
      } else {
        // Incremental search around previous t (handling wrap-around)
        const STEPS = 14;
        const range = 0.12;
        for (let i = 0; i <= STEPS; i++) {
          let t = (closestT - range + (i / STEPS) * 2 * range + 1) % 1;
          const pt = mapData.spline.getPointAt(t);
          const dSq = pt.distanceToSquared(pos);
          if (dSq < minDistSq) {
            minDistSq = dSq;
            closestT = t;
          }
        }
        
        // If the closest point found is way too far, do a recovery global search
        if (minDistSq > 100 * 100) {
           const GLOBAL_STEPS = 30;
           for (let i = 0; i <= GLOBAL_STEPS; i++) {
             const t = i / GLOBAL_STEPS;
             const pt = mapData.spline.getPointAt(t);
             const dSq = pt.distanceToSquared(pos);
             if (dSq < minDistSq) {
               minDistSq = dSq;
               closestT = t;
             }
           }
        }
      }
      chassis._closestT = closestT;

      // 2. Heading Check
      // Use 2D projection (XZ) to ignore vehicle pitch/roll influence
      const tan = mapData.spline.getTangentAt(closestT).normalize();
      const fwd = new CANNON.Vec3(0, 0, 1);
      chassis.quaternion.vmult(fwd, fwd);
      
      const tan2D = new THREE.Vector2(tan.x, tan.z).normalize();
      const fwd2D = new THREE.Vector2(fwd.x, fwd.z).normalize();
      const dot = tan2D.dot(fwd2D);
      
      const msgEl = document.getElementById('wrong-way-msg');
      // Threshold: -0.3 is very generous (>107 deg). 
      // Also ensure player is actually near the road (within 35m) to avoid confusion during air-time or out-of-bounds.
      if (dot < -0.3 && minDistSq < 35 * 35) {
        msgEl?.classList.remove('hidden');
      } else {
        msgEl?.classList.add('hidden');
      }
    }
  } else {
    document.getElementById('wrong-way-msg')?.classList.add('hidden');
  }

  // ── Troll / Stuck Detection ──
  const hitCrate = checkCrateProximity(pos, mapData.weaponCrateSpawns);
  if (hitCrate && !heldWeapon) {
    const idx = mapData.weaponCrateSpawns.indexOf(hitCrate);
    hitCrate.active = false;
    hitCrate.respawnTimer = 20;
    hitCrate._dirty = true; // Signal mesh update needed
    pickupWeapon(hitCrate.type);
    Network.sendCratePickup(idx, hitCrate.type);
    _showHUDMsg(`PICKED UP ${hitCrate.type.replace('_', ' ')}!`);
  }

  // ── Crate respawn ──
  updateCrateRespawns(mapData.weaponCrateSpawns, dt);
  // Only update mesh when state changed (dirty flag), not every frame
  mapData.weaponCrateSpawns.forEach((c, i) => {
    if (c._dirty) {
      Graphics.updateCrateMesh(i, c.active);
      c._dirty = false;
    }
  });

  // ── Troll prevention ──
  if (winnerFinishedAt !== null && !raceFinished) {
    if (lastPos) {
      const dx = pos.x - lastPos.x,
        dz = pos.z - lastPos.z;
      const moved = Math.sqrt(dx * dx + dz * dz);
      if (moved < 0.5) {
        stuckTimer += dt;
        if (
          stuckTimer >= TROLL_TIMEOUT &&
          myCheckpointsThisLap < mapData.checkpoints.length * lapCount
        ) {
          _disqualify();
        }
      } else {
        stuckTimer = 0;
      }
    }
    lastPos = { x: pos.x, y: pos.y, z: pos.z };
  }

  // ── Speed HUD ──
  const speed = chassis.velocity.length() * 3.6; // m/s → km/h
  document.getElementById('hud-speed').textContent = Math.round(speed);

  // ── Flip HUD ──
  const flip = Physics.getFlipProgress();
  const recEl = document.getElementById('hud-recovery');
  if (flip.timer > 0.2) {
    recEl.classList.remove('hidden');
  } else {
    recEl.classList.add('hidden');
  }
}

// ── Notify external winner ─────────────────────────────────────────────────
export function notifyWinnerFinished() {
  if (winnerFinishedAt === null) winnerFinishedAt = performance.now() / 1000;
}

// ── Lap logic ─────────────────────────────────────────────────────────────
function _completeLap() {
  if (currentLapTime > 0 && currentLapTime < bestLapTime) bestLapTime = currentLapTime;

  // Reset checkpoints for next lap
  mapData.checkpoints.forEach(cp => (cp.passed = false));
  myCheckpointsThisLap = 0;
  currentLapTime = 0; // Reset lap time

  if (myLap >= lapCount) {
    _finishRace();
  } else {
    myLap++;
    _updateLapHUD();
    _showHUDMsg(`LAP ${myLap}!`);
    Network.sendLapComplete(myLap);
  }
}

function _finishRace() {
  if (currentLapTime > 0 && currentLapTime < bestLapTime) bestLapTime = currentLapTime;
  raceFinished = true;
  racePhase = 'FINISHED';
  const elapsed = currentRaceTime;
  Network.sendFinished(elapsed, bestLapTime);
  notifyWinnerFinished();
  Graphics.spawnFinishBurst(Physics.playerChassis?.position || { x: 0, y: 1, z: 0 });
  _showHUDMsg('FINISH!');
  setTimeout(() => _showResults(), 3000);
}

function _disqualify() {
  raceFinished = true;
  _showHUDMsg('DISQUALIFIED!');
  setTimeout(() => _showResults(), 2000);
}

function _showResults() {
  const pl = Network.players;
  const sorted = Object.entries(pl)
    .filter(([, p]) => p.finished || p.disqualified)
    .sort((a, b) => {
      if (a[1].disqualified) return 1;
      if (b[1].disqualified) return -1;
      return (a[1].finishTime || 999) - (b[1].finishTime || 999);
    });

  const list = document.getElementById('results-list');
  list.innerHTML = '';
  sorted.forEach(([id, p], i) => {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'player-color-dot';
    dot.style.background =
      '#' + (Graphics.PLAYER_COLORS[p.colorIndex % 6] || 0xffffff).toString(16).padStart(6, '0');
    li.appendChild(dot);

    const totalTimeStr = p.finishTime ? formatTime(p.finishTime) : 'N/A';
    const bestLapStr = p.bestLap && p.bestLap < Infinity ? formatTime(p.bestLap) : 'N/A';

    li.appendChild(
      document.createTextNode(
        `${i + 1}. ${p.name || id.slice(0, 6)} - Time: ${totalTimeStr} | Best Lap: ${bestLapStr}${p.disqualified ? ' (DSQ)' : ''}`
      )
    );
    list.appendChild(li);
  });

  if (Network.getIsHost()) {
    document.getElementById('btn-lobby').classList.remove('hidden');
  } else {
    document.getElementById('btn-lobby').classList.add('hidden');
  }

  setState(STATE.FINISHED);
}

// ── HUD helpers ────────────────────────────────────────────────────────────
function _updateLapHUD() {
  document.getElementById('hud-lap').textContent = `LAP ${myLap}/${lapCount}`;
}

let _flashTimeout = null;
function _showHUDMsg(msg) {
  const el = document.getElementById('hud-msg');
  el.textContent = msg;
  el.classList.remove('hidden');
  if (_flashTimeout) clearTimeout(_flashTimeout);
  _flashTimeout = setTimeout(() => el.classList.add('hidden'), 2200);
}

let _splitTimeout = null;
function _showSplitMsg(msg, className) {
  const el = document.getElementById('split-time-msg');
  el.textContent = msg;
  el.className = `hud-flash ${className}`;
  if (_splitTimeout) clearTimeout(_splitTimeout);
  _splitTimeout = setTimeout(() => el.classList.add('hidden'), 2000);
}
