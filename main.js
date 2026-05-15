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

  // Grid assignments
  const grid = Object.keys(Network.players).map((id, index) => ({ id, gridIndex: index }));
  
  Network.startRace(seed, laps, driveMode, grid, collisionMode);
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
    onGameInit: (data) => _onGameInit(data),
    onStateUpdate: (data) => _onStateUpdate(data),
    onCratePickup: (id, type) => _onCratePickup(id, type),
    onRocketFire: (id, pos, quat) => GameEngine.spawnRemoteRocket(pos, quat),
    onReturnLobby: () => Game.setState(Game.STATE.LOBBY),
    onCarUpdate: (id, model) => { if (Game.getState() === Game.STATE.RACING) Graphics.loadVehicle(id, Network.players[id].colorIndex, model); UI.refreshPlayerList(Network.players, Network.getIsHost()); },
    onKicked: () => location.reload(),
    onVehicleHit: (vId, impulse, pt, aId) => _onVehicleHit(vId, impulse, pt, aId),
  }).then(id => {
    document.getElementById('peer-id-display').textContent = id;
    document.getElementById(statusElId).textContent = 'CONNECTED ✓';
    document.getElementById(statusElId).className = 'status-msg ok';
    return id;
  });
}


// ── Game Logic Bridges (Keep temporarily until GameEngine is fully independent) ──
function _onGameInit(data) {
  Game.startRace(data.seed);
  const myId = Network.getMyPeerId();
  Object.entries(Network.players).forEach(([id, p]) => {
    if (id === myId) {
      Physics.createPlayerVehicle(0, p.carModel);
    } else {
      Graphics.loadVehicle(id, p.colorIndex, p.carModel);
      Physics.createRemoteVehicle(id, 0, p.carModel);
    }
  });
  Game.setState(Game.STATE.RACING);
}

function _onStateUpdate(data) {
  Network.receiveState(data);
}

function _onCratePickup(id, type) {
  if (id === Network.getMyPeerId()) {
    Game.addAmmo(type);
    Audio.playCollect();
  }
}

function _onVehicleHit(victimId, impulse, point, attackerId) {
  if (victimId === Network.getMyPeerId()) {
    Physics.applyExplosionImpulse(impulse, point);
    Audio.playCollision();
  }
}
