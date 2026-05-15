import * as Game from './game.js';

import * as Network from './network.js';
import * as Graphics from './graphics.js';
import * as Physics from './physics.js';
import * as Audio from './audio.js';
import * as UI from './ui.js';


let _lastTime = performance.now();
const activeRocketVisuals = new Map();

export function init() {
  Physics.setOnVehicleImpact((victimId, impulse, point, attackerId) => {
    if (Game.getState() !== Game.STATE.RACING || Game.racePhase !== 'RACING') return;

    // Assume fast collision mode for simplicity in this refactor, 
    // or we can pass it from main.js if needed.
    Network.sendVehicleHit(victimId, impulse, point, attackerId);
  });
}

export function startLoop() {
  _lastTime = performance.now();
  requestAnimationFrame(_tick);
}

function _tick(now) {
  requestAnimationFrame(_tick);
  const dt = Math.min((now - _lastTime) / 1000, 0.1);
  _lastTime = now;

  const state = Game.getState();
  if (state === Game.STATE.MENU || state === Game.STATE.JOIN_LOBBY) {
    // Menu rendering (if needed)
  } else if (state === Game.STATE.LOBBY) {
    Graphics.renderScene(dt);
  } else if (state === Game.STATE.RACING) {
    _updateRacing(dt);
  }
}

function _updateRacing(dt) {
  const localInput = Game.updateInput();
  const raceState = Game.updateRace(dt, localInput);
  
  // Sync local player to network
  if (raceState.localPlayer) {
    const lp = raceState.localPlayer;
    Network.sendState(lp.position, lp.quaternion, lp.velocity, localInput);
  }

  // Update remote players
  Object.entries(Network.players).forEach(([id, p]) => {
    if (p.isLocal) return;
    Graphics.updateVehicleMesh(id, p.position, p.quaternion);
  });

  // Sync HUD
  const lp = raceState.localPlayer;
  if (lp) {
    UI.updateHUD({
      speed: lp.velocity.length() * 3.6,
      lap: `${Game.getCurrentLap()}/${Game.getLapCount()}`,
      weapon: Game.getHeldWeapon(),
      ammo: Game.getHeldAmmo()
    });
  }


  // Sync rocket visual meshes

  for (const [rocket, mesh] of activeRocketVisuals.entries()) {
    const pos = rocket.body.interpolatedPosition || rocket.body.position;
    const vel = rocket.body.velocity;
    Graphics.updateRocketMesh(mesh, pos, vel, dt);
  }

  Graphics.renderScene(dt);
}

export function fireRocket(id, pos, quat) {
  const mesh = Graphics.createRocketMesh();
  const owner = id === '__local__' ? Physics.playerChassis?.body : undefined;

  const onExplode = (impactPos, r) => {
    const m = activeRocketVisuals.get(r);
    if (m) {
      Graphics.spawnExplosion(impactPos);
      Graphics.releaseRocketMesh(m);
      activeRocketVisuals.delete(r);
    }
  };

  const rocket = Physics.fireRocket(pos, quat, onExplode, owner);
  
  if (rocket) {
    Audio.playRocketLaunch();
    activeRocketVisuals.set(rocket, mesh);
  }
}


export function spawnRemoteRocket(pos, quat) {
  fireRocket('__remote__', pos, quat);
}
