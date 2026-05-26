import * as THREE from 'three';
import * as Physics from './physics.js';
import * as Graphics from './graphics.js';
import * as Network from './network.js';
import * as Game from './game.js';
import * as Audio from './audio.js';
import * as UI from './ui.js';
import * as GameEngine from './gameEngine.js';
import { initMobileControls } from './mobile.js';

initMobileControls();

// ── Configuration ──────────────────────────────────────────────────────────
const AVAILABLE_CARS = [
  'dacia_duster_low_poly',
  'police_car',
  'retro_anime_suzuki_alto',
  'volkswagen_golf_gti_1976',
  'volvo_240',
];

let currentCarIndex = 3;
let lobbyPreview = null;

// ── Bootstrap ──────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  const canvas = document.getElementById('game-canvas');
  
  // Init Core Systems
  Physics.initPhysics();
  Graphics.initGraphics(canvas);
  Game.initInput();
  GameEngine.init();
  
  // Init UI
  UI.init({
    onHost: handleHost,
    onJoin: handleJoin,
    onCarPrev: () => { currentCarIndex = (currentCarIndex - 1 + AVAILABLE_CARS.length) % AVAILABLE_CARS.length; updatePreviews(); },
    onCarNext: () => { currentCarIndex = (currentCarIndex + 1) % AVAILABLE_CARS.length; updatePreviews(); },
    onConnect: handleConnect,
    onStart: handleStart,
    onReturnLobby: handleReturnToLobby,
  });


  // Car Previews
  lobbyPreview = Graphics.createCarPreview(document.getElementById('car-preview-canvas'));

  Game.setOnStateChange((state) => {
    if (state === Game.STATE.RACING || state === Game.STATE.FINISHED) {
      if (lobbyPreview) lobbyPreview.stop();
    } else {
      if (lobbyPreview) lobbyPreview.start();
    }
  });
  
  updatePreviews();

  // Restore Name
  const savedName = localStorage.getItem('nitro-name');
  if (savedName) {
    document.getElementById('player-name').value = savedName;
    document.getElementById('join-lobby-name').value = savedName;
  }

  // Auto-join from URL
  const urlParams = new URLSearchParams(window.location.search);
  const joinId = urlParams.get('lobby');
  if (joinId) {
    document.getElementById('join-lobby-id-display').value = joinId;
    Game.setState(Game.STATE.JOIN_LOBBY);
  } else {
    Game.setState(Game.STATE.MENU);
  }

  // Lobby Setting Listeners
  const broadcastSettings = () => {
    Network.broadcastLobbySettings({
      seed: document.getElementById('seed-input').value,
      laps: document.getElementById('lap-input').value,
      driveMode: document.getElementById('drive-input').value,
      handlingMode: document.getElementById('handling-input').value,
      collisionMode: document.getElementById('collision-input').value
    });
  };
  
  ['seed-input', 'lap-input', 'drive-input', 'handling-input', 'collision-input'].forEach(id => {
    document.getElementById(id).addEventListener('change', broadcastSettings);
  });
  
  window._updateGuestLobbySettings = (settings) => {
    if (settings.seed) document.getElementById('seed-input').value = settings.seed;
    if (settings.laps) document.getElementById('lap-input').value = settings.laps;
    if (settings.driveMode) document.getElementById('drive-input').value = settings.driveMode;
    if (settings.handlingMode) document.getElementById('handling-input').value = settings.handlingMode;
    if (settings.collisionMode) document.getElementById('collision-input').value = settings.collisionMode;
  };

  GameEngine.startLoop();
});

// ── Handlers ───────────────────────────────────────────────────────────────
async function handleHost() {
  try {
    Audio.init(); // Wake up AudioContext on click
    await setupNetwork();
    Network.hostGame(getName(), 0, AVAILABLE_CARS[currentCarIndex]);
    UI.refreshPlayerList(Network.players, Network.getIsHost());
    document.getElementById('screen-menu').classList.remove('active');
    document.getElementById('screen-lobby').classList.add('active');
  } catch (e) {
    UI.showMessage(e.message, 'error');
  }
}

function handleJoin() {
  Audio.init(); // Wake up AudioContext on click
  Game.setState(Game.STATE.JOIN_LOBBY);
}

async function handleConnect(lobbyId) {
  if (!lobbyId) return UI.showMessage('PLEASE ENTER LOBBY NAME', 'error');
  try {
    Audio.init(); // Wake up AudioContext on click
    await setupNetwork();
    document.getElementById('peer-id-display').textContent = lobbyId;
    await Network.connectToHost(lobbyId, getName(), AVAILABLE_CARS[currentCarIndex]);
    UI.refreshPlayerList(Network.players, Network.getIsHost());
    Game.setState(Game.STATE.LOBBY);
  } catch (e) {
    UI.showMessage(e.message, 'error');
  }
}

function handleStart() {
  Audio.init(); // Wake up AudioContext on click
  const isTester = getName() === 'TESTER';
  const seed = isTester ? 0 : (parseInt(document.getElementById('seed-input').value) || Math.floor(Math.random() * 999999));
  const laps = parseInt(document.getElementById('lap-input').value) || 3;
  const driveMode = document.getElementById('drive-input').value;
  const collisionMode = document.getElementById('collision-input').value;
  const handlingMode = document.getElementById('handling-input').value;

  // Randomize grid – shuffle player IDs so spawn order is random
  const playerIds = Object.keys(Network.players);
  for (let i = playerIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [playerIds[i], playerIds[j]] = [playerIds[j], playerIds[i]];
  }
  // Build grid as a plain map: { peerId: gridIndex }
  const grid = {};
  playerIds.forEach((id, index) => { grid[id] = index; });
  console.log('[START] Grid assignments:', JSON.stringify(grid));

  Network.startRace(seed, laps, driveMode, handlingMode, grid, collisionMode);
}

function handleReturnToLobby() {
  // Network.returnToLobby broadcasts LOBBY_COUNTDOWN to all, then onLobbyCountdown fires
  // showing the 3-2-1 overlay on every player before RETURN_LOBBY is sent
  Network.returnToLobby();
}


function getName() {
  const id = Game.getState() === Game.STATE.JOIN_LOBBY ? 'join-lobby-name' : 'player-name';
  return document.getElementById(id).value.trim() || 'DRIVER';
}

async function updatePreviews() {
  const car = AVAILABLE_CARS[currentCarIndex];
  document.getElementById('car-name-display').textContent = car.replace(/_/g, ' ').toUpperCase();
  UI.setLoading(true);
  if (lobbyPreview) await lobbyPreview.setCar(car);
  UI.setLoading(false);
  if (Network.getMyPeerId()) Network.sendCarUpdate(car);
}





// ── Network Setup ──────────────────────────────────────────────────────────
window.CollisionLogs = [];
window.logCollisionEvent = function(type, data) {
  const cm = Physics.collisionMode;
  if (cm !== 'smooth' && cm !== 'predict' && cm !== 'dynamic' && cm !== 'authoritative') return;
  // Keep last 10000 events to prevent memory leak (about 55 seconds at 180fps if we log every frame)
  if (window.CollisionLogs.length > 10000) window.CollisionLogs.shift();
  
  window.CollisionLogs.push({
    time: performance.now().toFixed(1),
    type,
    ...data
  });
};

document.getElementById('download-log-btn').addEventListener('click', () => {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(window.CollisionLogs, null, 2));
  const downloadAnchorNode = document.createElement('a');
  downloadAnchorNode.setAttribute("href", dataStr);
  downloadAnchorNode.setAttribute("download", "collision_log_" + Network.getMyPeerId() + ".json");
  document.body.appendChild(downloadAnchorNode); // required for firefox
  downloadAnchorNode.click();
  downloadAnchorNode.remove();
});

async function setupNetwork() {
  const statusElId = Game.getState() === Game.STATE.JOIN_LOBBY ? 'join-lobby-status' : 'menu-status';
  document.getElementById(statusElId).textContent = 'CONNECTING...';

  return Network.initNetwork({
    onPlayerJoin: () => UI.refreshPlayerList(Network.players, Network.getIsHost()),
    onPlayerLeave: (id) => { Graphics.removeVehicleMesh(id); Physics.removeRemoteVehicle(id); UI.refreshPlayerList(Network.players, Network.getIsHost()); },
    onGameInit: (seed, laps, mode, handling, grid, coll) => _onGameInit(seed, laps, mode, handling, grid, coll),

    onStateUpdate: () => {},
    onCratePickup: (id, crateIdx, type) => _onCratePickup(id, crateIdx, type),
    onRocketFire: (id, pos, quat) => GameEngine.spawnRemoteRocket(pos, quat),
    onOilDrop: (id, pos, quat) => GameEngine.spawnRemoteOil(pos, quat),
    onReturnLobby: () => {
      UI.showHostReturnButton(false);
      Game.setState(Game.STATE.LOBBY);
      Graphics.clearRaceScene();
      Physics.clearPhysicsWorld();
      Audio.stopAll();
      UI.refreshPlayerList(Network.players, Network.getIsHost());
    },
    onCarUpdate: (id, model) => { if (Game.getState() === Game.STATE.RACING) Graphics.loadVehicle(id, Network.players[id].colorIndex, model); UI.refreshPlayerList(Network.players, Network.getIsHost()); },
    onKicked: () => location.reload(),
    onVehicleHit: (vId, bumpVel, aId, bumpAngVel) => _onVehicleHit(vId, bumpVel, aId, bumpAngVel),
    onPlayerLoaded: (players) => UI.updateLoadingPlayerList(players),
    onStartCountdown: () => {
      UI.setLoading(false);
      Game.startIntro();
      // Show the host lobby button during race
      if (Network.getIsHost()) UI.showHostReturnButton(true);
    },
    onLobbyCountdown: (done) => {
      // Show 3-2-1 overlay on ALL players (host and clients)
      UI.showReturnLobbyCountdown(done);
    },
  }).then(id => {
    document.getElementById('peer-id-display').textContent = id;
    document.getElementById(statusElId).textContent = 'CONNECTED ✓';
    document.getElementById(statusElId).className = 'status-msg ok';
    return id;
  });
}


// ── Game Logic Bridges ──
async function _onGameInit(seed, laps, mode, handlingMode, grid, coll) {
  Game.setState(Game.STATE.RACING);
  UI.setLoading(true);

  GameEngine.setCollisionMode(coll);
  Physics.setCollisionMode(coll);
  Physics.setDriveMode(mode);
  Physics.setHandlingMode(handlingMode);

  const mapData = Game.initRace(seed, laps, Physics.world, Physics.groundMat, Physics.wallMat);
  Graphics.buildRaceMap(mapData);

  const myId = Network.getMyPeerId();

  // Grid is now a plain map: { peerId: gridIndex }
  // (previously was an array of {id, gridIndex} which could fail serialization)
  const gridAssignments = grid; // already a map
  console.log('[GAME_INIT] My ID:', myId);
  console.log('[GAME_INIT] Grid assignments received:', JSON.stringify(gridAssignments));

  // Local vehicle
  const myColorIdx = Network.players[myId]?.colorIndex || 0;
  const myCarModel = Network.players[myId]?.carModel || AVAILABLE_CARS[0];
  const myIdx = gridAssignments[myId] !== undefined ? gridAssignments[myId] : 0;
  console.log('[GAME_INIT] My grid index:', myIdx, '(out of', mapData.startGrid.length, 'slots)');
  const gridSpot = mapData.startGrid[myIdx % mapData.startGrid.length];
  console.log('[GAME_INIT] My spawn pos:', JSON.stringify(gridSpot.pos));
  Physics.createPlayerVehicle(gridSpot.pos, gridSpot.quat, myCarModel);
  await Graphics.loadVehicle('__local__', myColorIdx, myCarModel);

  // Remote vehicles — pass spawn pos/quat directly so physics body never exists at origin
  for (const [id, p] of Object.entries(Network.players)) {
    if (id === myId) continue;
    const pIdx = gridAssignments[id] !== undefined ? gridAssignments[id] : 0;
    console.log('[GAME_INIT] Remote', id, 'grid index:', pIdx);
    const rSpot = mapData.startGrid[pIdx % mapData.startGrid.length];
    // Set remote chassis so it perfectly aligns with ground, matching the settled local physics height
    const settledHeightOffset = Physics.playerChassis.position.y - gridSpot.pos.y;
    const rSpawnPos = { x: rSpot.pos.x, y: rSpot.pos.y + settledHeightOffset, z: rSpot.pos.z };
    const rSpawnQuat = { x: rSpot.quat.x, y: rSpot.quat.y, z: rSpot.quat.z, w: rSpot.quat.w };
    Physics.createRemoteVehicle(id, 1, p.carModel, rSpawnPos, rSpawnQuat);
    await Graphics.loadVehicle(id, p.colorIndex, p.carModel);
  }

  // ── NPC Dummy Cars for Testing ──────────────────────────────────────────
  if (Number(seed) === 0) {
    for (let i = 0; i < AVAILABLE_CARS.length; i++) {
      const carName = AVAILABLE_CARS[i];
      const testId = `__dummy_${carName}__`;
      const t = 0.15 + (i * 0.02);
      if (t >= 1.0) break;
      const testPos = mapData.spline.getPointAt(t);
      const testTan = mapData.spline.getTangentAt(t).normalize();
      const testQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(testTan.x, testTan.z));
      
      Physics.createRemoteVehicle(testId, 1000, carName,
        { x: testPos.x, y: testPos.y + 1, z: testPos.z },
        { x: testQuat.x, y: testQuat.y, z: testQuat.z, w: testQuat.w }
      );
      await Graphics.loadVehicle(testId, i % 6, carName);
    }
  }

  // Snap camera
  const myChassis = Physics.playerChassis;
  if (myChassis) {
    const _camTarget = new THREE.Vector3(myChassis.position.x, myChassis.position.y + 0.5, myChassis.position.z);
    Graphics.snapCamera(_camTarget, myChassis.quaternion);
  }

  UI.setLoading(true, 'WAITING FOR PLAYERS...');
  UI.updateLoadingPlayerList(Network.players);
  Network.sendLoaded();
}

function _onCratePickup(id, crateIdx, type) {
  const mapData = Game.getRaceMapData();
  if (!mapData) return;
  if (typeof crateIdx !== 'number' || crateIdx < 0 || crateIdx >= mapData.weaponCrateSpawns.length)
    return;
  const crate = mapData.weaponCrateSpawns[crateIdx];
  if (crate) {
    crate.active = false;
    crate.respawnTimer = 20;
    crate._dirty = true;
  }
  Audio.playCollect();
}

function _onVehicleHit(victimId, bumpVel, attackerId, bumpAngVel = null) {
  if (victimId === Network.getMyPeerId()) {
    if (window.logCollisionEvent) {
      window.logCollisionEvent('RECEIVE_BUMP', { victimId, attackerId, bumpVel, bumpAngVel });
    }
    Physics.applyNetworkBump(bumpVel, bumpAngVel);
    Audio.playCollision();
    
    // Apply equal opposite recoil to attacker's dummy car for physics modes
    const cm = Physics.collisionMode;
    if ((cm === 'smooth' || cm === 'predict' || cm === 'dynamic' || cm === 'authoritative') && attackerId) {
      Physics.applyCounterBump(attackerId, bumpVel, bumpAngVel);
    }
  }
}
