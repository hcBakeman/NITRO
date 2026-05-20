import * as THREE from 'three';
import * as Physics from './physics.js';
import * as Graphics from './graphics.js';
import * as Network from './network.js';
import * as Game from './game.js';
import * as Audio from './audio.js';
import * as UI from './ui.js';
import * as GameEngine from './gameEngine.js';

// ── Configuration ──────────────────────────────────────────────────────────
const AVAILABLE_CARS = [
  'dacia_duster_low_poly',
  'police_car',
  'retro_anime_suzuki_alto',
  'volkswagen_golf_gti_1976',
  'volvo_240',
];

let currentCarIndex = 0;
let joinCarIndex = 0;
let lobbyPreview, joinPreview;

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
    onJoinCarPrev: () => { joinCarIndex = (joinCarIndex - 1 + AVAILABLE_CARS.length) % AVAILABLE_CARS.length; updateJoinPreview(); },
    onJoinCarNext: () => { joinCarIndex = (joinCarIndex + 1) % AVAILABLE_CARS.length; updateJoinPreview(); },
    onConnect: handleConnect,
    onStart: handleStart,
  });


  // Car Previews
  lobbyPreview = Graphics.createCarPreview(document.getElementById('car-preview-canvas'));
  joinPreview = Graphics.createCarPreview(document.getElementById('join-car-preview-canvas'));
  
  updatePreviews();
  updateJoinPreview();

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

  GameEngine.startLoop();
});

// ── Handlers ───────────────────────────────────────────────────────────────
async function handleHost() {
  try {
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
  Game.setState(Game.STATE.JOIN_LOBBY);
}

async function handleConnect(lobbyId) {
  if (!lobbyId) return UI.showMessage('PLEASE ENTER LOBBY NAME', 'error');
  try {
    await setupNetwork();
    await Network.connectToHost(lobbyId, getName(), 0, AVAILABLE_CARS[joinCarIndex]);
    UI.refreshPlayerList(Network.players, Network.getIsHost());
    Game.setState(Game.STATE.LOBBY);

  } catch (e) {
    UI.showMessage(e.message, 'error');
  }
}

function handleStart() {
  const seed = parseInt(document.getElementById('seed-input').value) || Math.floor(Math.random() * 999999);
  const laps = parseInt(document.getElementById('lap-input').value) || 3;
  const driveMode = document.getElementById('drive-input').value;
  const collisionMode = document.getElementById('collision-input').value;
  const handlingMode = document.getElementById('handling-input').value;

  // Grid assignments
  const grid = Object.keys(Network.players).map((id, index) => ({ id, gridIndex: index }));
  
  Network.startRace(seed, laps, driveMode, handlingMode, grid, collisionMode);
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


async function updateJoinPreview() {
  const car = AVAILABLE_CARS[joinCarIndex];
  document.getElementById('join-car-name-display').textContent = car.replace(/_/g, ' ').toUpperCase();
  UI.setLoading(true);
  if (joinPreview) await joinPreview.setCar(car);
  UI.setLoading(false);
}


// ── Network Setup ──────────────────────────────────────────────────────────
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
      Game.setState(Game.STATE.LOBBY);
      Graphics.clearRaceScene();
      Physics.clearPhysicsWorld();
      Audio.stopAll();
      UI.refreshPlayerList(Network.players, Network.getIsHost());
    },
    onCarUpdate: (id, model) => { if (Game.getState() === Game.STATE.RACING) Graphics.loadVehicle(id, Network.players[id].colorIndex, model); UI.refreshPlayerList(Network.players, Network.getIsHost()); },
    onKicked: () => location.reload(),
    onVehicleHit: (vId, impulse, pt, aId) => _onVehicleHit(vId, impulse, pt, aId),
    onPlayerLoaded: (players) => UI.updateLoadingPlayerList(players),
    onStartCountdown: () => {
      UI.setLoading(false);
      Game.startIntro();
    }
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

  Physics.setDriveMode(mode);
  Physics.setHandlingMode(handlingMode);

  const mapData = Game.initRace(seed, laps, Physics.world, Physics.groundMat, Physics.wallMat);
  Graphics.buildRaceMap(mapData);

  const myId = Network.getMyPeerId();
  const gridAssignments = {};
  grid.forEach(item => {
    gridAssignments[item.id] = item.gridIndex;
  });

  // Local vehicle
  const myColorIdx = Network.players[myId]?.colorIndex || 0;
  const myCarModel = Network.players[myId]?.carModel || AVAILABLE_CARS[0];
  const myIdx = gridAssignments[myId] !== undefined ? gridAssignments[myId] : 0;
  const gridSpot = mapData.startGrid[myIdx % mapData.startGrid.length];
  Physics.createPlayerVehicle(gridSpot.pos, gridSpot.quat, myCarModel);
  await Graphics.loadVehicle('__local__', myColorIdx, myCarModel);

  // Remote vehicles
  for (const [id, p] of Object.entries(Network.players)) {
    if (id === myId) continue;
    const pIdx = gridAssignments[id] !== undefined ? gridAssignments[id] : 0;
    const rSpot = mapData.startGrid[pIdx % mapData.startGrid.length];
    await Graphics.loadVehicle(id, p.colorIndex, p.carModel);
    const rb = Physics.createRemoteVehicle(id, 1, p.carModel);
    rb.position.set(rSpot.pos.x, rSpot.pos.y + 1.8, rSpot.pos.z);
    rb.quaternion.copy(rSpot.quat);
  }

  // NPC Test Driver
  const testId = '__test_driver__';
  const testPos = mapData.spline.getPointAt(0.05);
  const testBody = Physics.createRemoteVehicle(testId, 1, 'police_car');
  testBody.position.set(testPos.x, testPos.y + 1, testPos.z);
  const testTan = mapData.spline.getTangentAt(0.05).normalize();
  testBody.quaternion.setFromEuler(0, Math.atan2(testTan.x, testTan.z), 0);
  await Graphics.loadVehicle(testId, 5, 'police_car');

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

function _onVehicleHit(victimId, impulse, point, attackerId) {
  if (victimId === Network.getMyPeerId()) {
    Physics.applyImpactImpulse(impulse, point);
    Audio.playCollision();
  }
}
