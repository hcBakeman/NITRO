/**
 * main.js – Entry point and game loop for Nitro Seed
 * Glues: Physics, Map, Graphics, Network, Game
 */
import * as THREE    from 'three';
import * as CANNON   from 'cannon-es';
import * as Physics  from './physics.js';
import * as Graphics from './graphics.js';
import * as Network  from './network.js';
import * as Game     from './game.js';
import * as Audio    from './audio.js';

// ── Bootstrap ──────────────────────────────────────────────────────────────
const canvas = document.getElementById('game-canvas');
const myName = () => document.getElementById('player-name').value.trim() || 'DRIVER';

// Restore name from localStorage
const savedName = localStorage.getItem('nitro-name');
if (savedName) document.getElementById('player-name').value = savedName;
document.getElementById('player-name').addEventListener('input', e => {
  localStorage.setItem('nitro-name', e.target.value);
});

// Init systems
Physics.initPhysics();
Graphics.initGraphics(canvas);
Game.initInput();
Game.setState(Game.STATE.MENU);

// Reusable camera target
const _camTarget = new THREE.Vector3();
let _crosshairTimer = 0;

// ── Car Selection ──────────────────────────────────────────────────────────
const AVAILABLE_CARS = ['dacia_duster_low_poly', 'police_car', 'retro_anime_suzuki_alto', 'volkswagen_golf_gti_1976', 'volvo_240'];
let currentCarIndex = 0; // Default to first car

Graphics.initCarPreview(document.getElementById('car-preview-canvas'));

function updateCarPreview() {
  const carName = AVAILABLE_CARS[currentCarIndex];
  const displayName = carName.replace(/_/g, ' ').toUpperCase();
  document.getElementById('car-name-display').textContent = displayName;
  Graphics.setPreviewCar(carName);
  
  if (Game.getState() === Game.STATE.LOBBY && Network.getMyPeerId()) {
    Network.sendCarUpdate(carName);
  }
}

document.getElementById('btn-car-prev').addEventListener('click', (e) => {
  e.target.blur();
  currentCarIndex = (currentCarIndex - 1 + AVAILABLE_CARS.length) % AVAILABLE_CARS.length;
  updateCarPreview();
});

document.getElementById('btn-car-next').addEventListener('click', (e) => {
  e.target.blur();
  currentCarIndex = (currentCarIndex + 1) % AVAILABLE_CARS.length;
  updateCarPreview();
});

updateCarPreview();

// ── Network setup ──────────────────────────────────────────────────────────
async function setupNetwork() {
  const statusEl = document.getElementById('menu-status');
  statusEl.textContent = 'CONNECTING TO NETWORK...';
  statusEl.className   = 'status-msg';
  try {
    const myId = await Network.initNetwork({
      onPlayerJoin:  _onPlayerJoin,
      onPlayerLeave: _onPlayerLeave,
      onGameInit:    _onGameInit,
      onStateUpdate: _onStateUpdate,
      onCratePickup: _onCratePickup,
      onRocketFire:  _onRemoteRocketFire,
      onOilDrop:     _onRemoteOilDrop,
      onReturnLobby: _onReturnLobby,
      onCarUpdate:   _onCarUpdate,
    });
    document.getElementById('peer-id-display').textContent = myId;
    statusEl.textContent = 'CONNECTED ✓';
    statusEl.className   = 'status-msg ok';
    return myId;
  } catch (e) {
    statusEl.textContent = 'NETWORK ERROR: ' + e.message;
    statusEl.className   = 'status-msg error';
    throw e;
  }
}

// ── Menu UI ────────────────────────────────────────────────────────────────
document.getElementById('btn-host').addEventListener('click', async () => {
  try {
    if (!Network.getMyPeerId()) await setupNetwork();
    Network.hostGame(myName(), 0, AVAILABLE_CARS[currentCarIndex]);
    _enterLobby(true);
  } catch (_) {}
});

document.getElementById('btn-join').addEventListener('click', () => {
  document.getElementById('join-panel').classList.toggle('hidden');
});

document.getElementById('btn-connect').addEventListener('click', async () => {
  const hostId   = document.getElementById('join-peer-id').value.trim();
  if (!hostId) return;
  const statusEl = document.getElementById('menu-status');
  statusEl.textContent = 'CONNECTING...';
  statusEl.className   = 'status-msg';
  try {
    if (!Network.getMyPeerId()) await setupNetwork();
    await Network.joinGame(hostId, myName(), AVAILABLE_CARS[currentCarIndex]);
    _enterLobby(false);
    statusEl.textContent = '';
  } catch (e) {
    statusEl.textContent = 'FAILED: ' + e.message;
    statusEl.className   = 'status-msg error';
  }
});

// ── Lobby UI ───────────────────────────────────────────────────────────────
function _enterLobby(asHost) {
  Game.setState(Game.STATE.LOBBY);
  document.getElementById('lobby-status').textContent = asHost
    ? 'Share your Peer ID – waiting for players...'
    : 'Waiting for host to start the race...';
  if (asHost) {
    document.getElementById('host-controls').classList.remove('hidden');
    document.getElementById('btn-start').classList.remove('hidden');
  } else {
    document.getElementById('host-controls').classList.add('hidden');
    document.getElementById('btn-start').classList.add('hidden');
  }
  _refreshPlayerList();
}

function _refreshPlayerList() {
  const list   = document.getElementById('player-list');
  list.innerHTML = '';
  const isHost = Network.getIsHost();

  Object.entries(Network.players).forEach(([id, p]) => {
    const li    = document.createElement('li');
    const dot   = document.createElement('span');
    dot.className   = 'player-color-dot';
    dot.style.background = '#' + (Graphics.PLAYER_COLORS[p.colorIndex % 6] >>> 0).toString(16).padStart(6, '0');

    const nameSpan = document.createElement('span');
    nameSpan.style.flex  = '1';
    nameSpan.textContent = (p.name || id.slice(0, 8)) + ` [${p.carModel || 'SUV'}]` + (p.isLocal ? ' (YOU)' : '');

    li.appendChild(dot);
    li.appendChild(nameSpan);

    if (isHost && !p.isLocal) {
      const kickBtn       = document.createElement('button');
      kickBtn.className   = 'btn-kick';
      kickBtn.textContent = 'KICK';
      kickBtn.addEventListener('click', () => Network.kickPlayer(id));
      li.appendChild(kickBtn);
    }
    list.appendChild(li);
  });
}

document.getElementById('btn-copy-id').addEventListener('click', () => {
  const id = document.getElementById('peer-id-display').textContent;
  navigator.clipboard.writeText(id).then(() => {
    const btn = document.getElementById('btn-copy-id');
    const orig = btn.textContent;
    btn.textContent = '✓ COPIED';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });
});

document.getElementById('btn-start').addEventListener('click', (e) => {
  e.target.blur();
  const seed      = parseInt(document.getElementById('seed-input').value) || 42069;
  const lapCount  = Math.max(1, Math.min(10, parseInt(document.getElementById('lap-input').value) || 3));
  const driveMode = document.getElementById('drive-input').value;
  Network.startRace(seed, lapCount, driveMode);
  _startRace(seed, lapCount, driveMode);
});

document.getElementById('btn-return-lobby').addEventListener('click', (e) => {
  e.target.blur();
  if (Network.getIsHost()) {
    Network.returnToLobby();
  }
  _onReturnLobby();
});

document.getElementById('btn-lobby').addEventListener('click', (e) => {
  e.target.blur();
  Network.returnToLobby();
});

// ── Network callbacks ──────────────────────────────────────────────────────
function _onPlayerJoin(id, player) {
  if (Game.getState() === Game.STATE.RACING) {
    Graphics.loadVehicle(id, player.colorIndex, player.carModel);
    Physics.createRemoteVehicle(id);
  }
  _refreshPlayerList();
  document.getElementById('lobby-status').textContent = `${player.name || id.slice(0,6)} joined!`;
}

function _onCarUpdate(id, carModel) {
  _refreshPlayerList();
}

function _onPlayerLeave(id) {
  Graphics.removeVehicleMesh(id);
  Physics.removeRemoteVehicle(id);
  _refreshPlayerList();
}

function _onGameInit(seed, lapCount, driveMode) {
  _startRace(seed, lapCount, driveMode);
}

function _onReturnLobby() {
  Game.setState(Game.STATE.LOBBY);
  Graphics.clearRaceScene();
  Physics.clearPhysicsWorld();
  document.getElementById('btn-return-lobby').classList.add('hidden');
  _enterLobby(Network.getIsHost());
}

function _onStateUpdate(id, pos, quat) {
  if (Game.getState() !== Game.STATE.RACING) return;
  Graphics.updateVehicleMesh(id, pos, quat);
}

function _onCratePickup(id, crateIdx) {
  const mapData = Game.getRaceMapData();
  if (!mapData) return;
  const crate = mapData.weaponCrateSpawns[crateIdx];
  if (crate) {
    crate.active       = false;
    crate.respawnTimer = 20;
    Graphics.updateCrateMesh(crateIdx, false);
    Audio.playCollect();
  }
}

const activeRocketVisuals = new Map();

function _spawnAndFireRocket(id, pos, quat) {
  if (!pos || !quat) return;
  const mesh = Graphics.createRocketMesh();
  const startPos = new CANNON.Vec3(pos.x, pos.y, pos.z);
  const startQuat = new CANNON.Quaternion(quat.x, quat.y, quat.z, quat.w);

  const ownerBody = Physics.getVehicleBody(id);
  Audio.playRocketLaunch();
  const rocket = Physics.fireRocket(startPos, startQuat, (impactPos, r) => {
    Graphics.spawnExplosion(impactPos);
    Audio.playExplosion();
    const m = activeRocketVisuals.get(r);
    if (m) {
      Graphics.removeMesh(m);
      activeRocketVisuals.delete(r);
    }
  }, ownerBody);
  if (rocket) {
    rocket.onCleanup = (impactPos, r) => {
      const m = activeRocketVisuals.get(r);
      if (m) {
        Graphics.removeMesh(m);
        activeRocketVisuals.delete(r);
      }
    };
    activeRocketVisuals.set(rocket, mesh);
  }
}

function _onRemoteRocketFire(id, pos, quat) {
  _spawnAndFireRocket(id, pos, quat);
}

function _spawnAndDropOil(id, pos, quat) {
  if (!pos || !quat) return;
  const startPos = new CANNON.Vec3(pos.x, pos.y, pos.z);
  const startQuat = new CANNON.Quaternion(quat.x, quat.y, quat.z, quat.w);

  const slick = Physics.deployOilSlick(startPos, startQuat);
  const mesh = Graphics.createOilSlickMesh(slick.body.position);

  slick.onCleanup = () => {
    Graphics.removeMesh(mesh);
  };
}

function _onRemoteOilDrop(id, pos, quat) {
  _spawnAndDropOil(id, pos, quat);
}

// ── Start race ─────────────────────────────────────────────────────────────
async function _startRace(seed, lapCount, driveMode) {
  Game.setState(Game.STATE.RACING);

  const world = Physics.getWorld();
  const gMat  = Physics.groundMat;
  const wMat  = Physics.wallMat;

  Physics.setDriveMode(driveMode || '4WD'); // Apply drive mode setting

  // Generate map (same seed → identical on all clients)
  const mapData = Game.initRace(seed, lapCount, world, gMat, wMat);
  Graphics.addMapToScene(mapData);
  Physics.createRamps(mapData.rampSpawns);

  if (Network.getIsHost()) {
    document.getElementById('btn-return-lobby').classList.remove('hidden');
  } else {
    document.getElementById('btn-return-lobby').classList.add('hidden');
  }

  // Local vehicle
  const myId       = Network.getMyPeerId();
  const myColorIdx = Network.players[myId]?.colorIndex || 0;
  const myCarModel = Network.players[myId]?.carModel || AVAILABLE_CARS[0];
  
  // Find my index in players list to assign grid spot
  const playerIds = Object.keys(Network.players).sort();
  const myIdx = playerIds.indexOf(myId) >= 0 ? playerIds.indexOf(myId) : 0;
  
  const gridSpot = mapData.startGrid[myIdx % mapData.startGrid.length];
  Physics.createPlayerVehicle(gridSpot.pos, gridSpot.quat);
  await Graphics.loadVehicle('__local__', myColorIdx, myCarModel);

  // Remote vehicles
  for (const [id, p] of Object.entries(Network.players)) {
    if (id === myId) continue;
    const pIdx = playerIds.indexOf(id);
    const rSpot = mapData.startGrid[pIdx % mapData.startGrid.length];
    await Graphics.loadVehicle(id, p.colorIndex, p.carModel);
    const rb = Physics.createRemoteVehicle(id);
    rb.position.set(rSpot.pos.x, rSpot.pos.y + 1.8, rSpot.pos.z);
    rb.quaternion.copy(rSpot.quat);
  }

  // Test Driver NPC
  const testId = '__test_driver__';
  const testPos = mapData.spline.getPointAt(0.05);
  const testBody = Physics.createRemoteVehicle(testId, 500); // 500kg mass to make it hittable
  testBody.position.set(testPos.x, testPos.y + 1, testPos.z);
  const testTan = mapData.spline.getTangentAt(0.05).normalize();
  testBody.quaternion.setFromEuler(0, Math.atan2(testTan.x, testTan.z), 0);
  await Graphics.loadVehicle(testId, 5, 'police_car'); // Police NPC

  // Snap camera to the starting aerial view so the first frame is clean
  const myChassis = Physics.playerChassis;
  if (myChassis) {
    _camTarget.set(myChassis.position.x, myChassis.position.y + 0.5, myChassis.position.z);
    Graphics.snapCamera(_camTarget, myChassis.quaternion);
  }
}

// ── Game loop ──────────────────────────────────────────────────────────────
let lastTime = performance.now();
let lastRacePhase = null;

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

function gameLoop(now) {
  requestAnimationFrame(gameLoop);

  const dt = Math.min((now - lastTime) / 1000, 0.1); // cap at 100ms
  lastTime = now;

  // Always render even in menu/lobby
  if (Game.getState() !== Game.STATE.RACING) {
    Graphics.renderScene(dt);
    return;
  }

  const chassis = Physics.playerChassis;

  // Update test driver mesh
  const testBody = Physics.getVehicleBody('__test_driver__');
  if (testBody) {
    Graphics.updateVehicleMesh('__test_driver__', testBody.position, testBody.quaternion);
  }

  // 1. Race UI (Countdown & Time) & Input
  const lightsEl = document.getElementById('start-lights');
  const timeEl = document.getElementById('hud-time');
  
  if (Game.racePhase === 'INTRO') {
    lightsEl.classList.add('hidden');
    timeEl.textContent = "WARMING UP...";
    Audio.updateEngine(0, false);
    Physics.setVehicleInput({ forward: false, backward: false, left: false, right: false, fire: false });
  } else if (Game.racePhase === 'COUNTDOWN') {
    lightsEl.classList.remove('hidden');
    const c = Game.raceCountdown;
    document.getElementById('light-1').classList.toggle('on', c <= 4.0);
    document.getElementById('light-2').classList.toggle('on', c <= 3.0);
    document.getElementById('light-3').classList.toggle('on', c <= 2.0);
    document.getElementById('light-4').classList.toggle('on', c <= 1.0);
    
    // Ensure they are yellow
    for (let i = 1; i <= 4; i++) {
      const el = document.getElementById(`light-${i}`);
      el.classList.remove('light-green');
      el.classList.add('light-yellow');
    }
    
    timeEl.textContent = "00:00.000";
    
    // Allow input so the user can potentially jump-start
    Physics.setVehicleInput(Game.input);
    Audio.updateEngine(chassis ? chassis.velocity.length() : 0, Game.input.forward);
  } else {
    // Transition to ACTIVE just happened
    if (Game.racePhase === 'ACTIVE' && lastRacePhase === 'COUNTDOWN') {
      Audio.playBeep();
    }
    
    if (Game.racePhase === 'ACTIVE') {
      if (Game.currentRaceTime < 1.0 || (Game.currentRaceTime >= 5.0 && Game.currentRaceTime < 6.0)) { 
        // 5.0 is the jump start penalty time base. We show the green lights for 1 second after 'GO'.
        for (let i = 1; i <= 4; i++) {
          const el = document.getElementById(`light-${i}`);
          el.classList.remove('light-yellow');
          el.classList.add('light-green', 'on');
        }
      } else {
        lightsEl.classList.add('hidden');
      }
      timeEl.textContent = formatTime(Game.currentRaceTime);
      Physics.setVehicleInput(Game.input);
      Audio.updateEngine(chassis ? chassis.velocity.length() : 0, Game.input.forward);
    } else {
      // FINISHED
      lightsEl.classList.add('hidden');
      timeEl.textContent = formatTime(Game.currentRaceTime);
      Physics.setVehicleInput({ forward: false, backward: false, left: false, right: false, fire: false });
      Audio.updateEngine(chassis ? chassis.velocity.length() : 0, false);
    }
  }
  
  lastRacePhase = Game.racePhase;

  // 2. Physics step (fixed 1/60 internal, dt for accumulation)
  Physics.stepPhysics(dt);

  // 3. Flip recovery
  Physics.checkFlip(dt);

  // 4. Weapon fire
  const speed = chassis ? chassis.velocity.length() : 0;
  // Drift smoke only when sliding sideways
  if (chassis && speed > 20) {
    const fwd = new CANNON.Vec3(0, 0, 1);
    chassis.quaternion.vmult(fwd, fwd);
    const vel = chassis.velocity.clone();
    vel.y = 0; // Ignore vertical speed
    if (vel.length() > 5) {
      vel.normalize();
      const slipDot = fwd.dot(vel);
      const isTurning = Game.input.left || Game.input.right;
      // Relaxed threshold: dot < 0.98 means > 11 degrees slip
      if (slipDot < 0.98 || (isTurning && speed > 28)) {
        Audio.setScreech(true);
        const q = chassis.quaternion, p = chassis.position;
        const rl = new CANNON.Vec3(-0.7, -0.4, -1.4), rr = new CANNON.Vec3(0.7, -0.4, -1.4);
        q.vmult(rl, rl); q.vmult(rr, rr);
        Graphics.spawnTireSmoke(p.vadd(rl));
        Graphics.spawnTireSmoke(p.vadd(rr));
      } else {
        Audio.setScreech(false);
      }
    } else {
      Audio.setScreech(false);
    }
  } else {
    Audio.setScreech(false);
  }

  if (Game.consumeFire() && Game.heldWeapon) {
    const weapon = Game.consumeWeapon();
    if (weapon === 'ROCKET') {
      if (chassis) {
        const pos = chassis.position;
        const quat = chassis.quaternion;
        Network.sendRocketFire(pos, quat);
        _spawnAndFireRocket('__local__', pos, quat);
      }
    } else if (weapon === 'OIL_SLICK') {
      if (chassis) {
        const pos = chassis.position;
        const quat = chassis.quaternion;
        Network.sendOilDrop(pos, quat);
        _spawnAndDropOil('__local__', pos, quat);
      }
    } else if (weapon === 'BOOST') {
      Physics.applyBoost();
    }
  }

  // 5. Sync local chassis → local mesh
  if (chassis) {
    const pos = chassis.interpolatedPosition || chassis.position;
    const quat = chassis.interpolatedQuaternion || chassis.quaternion;
    Graphics.updateVehicleMesh('__local__', pos, quat);
  }

  // 6. Remote player LERP + mesh sync
  Network.lerpRemotePlayers(dt);
  for (const [id, p] of Object.entries(Network.players)) {
    if (p.isLocal) continue;
    Graphics.updateVehicleMesh(id, p.position, p.quaternion);
  }

  // 7. Send local network state
  Network.sendLocalState(chassis, Game.input, dt);

  // 8. Game logic (checkpoints, crates, troll check, HUD)
  Game.updateRace(dt, chassis);

  // 9. Camera spring arm
  if (chassis) {
    const pos  = chassis.interpolatedPosition || chassis.position;
    const quat = chassis.interpolatedQuaternion || chassis.quaternion;
    _camTarget.set(pos.x, pos.y + 0.5, pos.z);
    
    if (Game.racePhase === 'INTRO') {
      const progress = 1.0 - (Game.raceCountdown / 5.0); // 5s intro
      Graphics.updateIntroCamera(_camTarget, progress);
    } else {
      Graphics.updateCamera(_camTarget, quat, dt);
    }
  }

  // 10. Minimap
  if (chassis) {
    const mapData = Game.getRaceMapData();
    if (mapData) {
      Graphics.updateMinimap(chassis.position, mapData.weaponCrateSpawns, Network.players);
    }
  }

  // 11. Sync rocket visual meshes
  for (const [rocket, mesh] of activeRocketVisuals.entries()) {
    const pos = rocket.body.interpolatedPosition || rocket.body.position;
    const vel = rocket.body.velocity;
    Graphics.updateRocketMesh(mesh, pos, vel, dt);
  }

  // 12. Render
  Graphics.renderScene(dt);

  // 13. Update Crosshair (throttled to 10Hz to reduce physics raycast overhead)
  const crosshairEl = document.getElementById('crosshair');
  if (Game.heldWeapon === 'ROCKET' && chassis && crosshairEl) {
    _crosshairTimer = (_crosshairTimer || 0) + dt;
    if (_crosshairTimer > 0.1) {
      _crosshairTimer = 0;
      const hitPoint = Physics.raycastForward(chassis);
      const screenPos = Graphics.getScreenPosition(hitPoint);
      if (screenPos && screenPos.z < 1.0) {
        crosshairEl.classList.remove('hidden');
        crosshairEl.style.left = `${screenPos.x}px`;
        crosshairEl.style.top = `${screenPos.y}px`;
      } else {
        crosshairEl.classList.add('hidden');
      }
    }
  } else if (crosshairEl) {
    crosshairEl.classList.add('hidden');
  }
}

requestAnimationFrame(gameLoop);
