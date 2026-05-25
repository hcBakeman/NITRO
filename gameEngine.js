import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import * as Game from './game.js';
import * as Network from './network.js';
import * as Graphics from './graphics.js';
import * as Physics from './physics.js';
import * as Audio from './audio.js';
import * as UI from './ui.js';
import { Profiler } from './profiler.js';
import { formatTime } from './utils.js';

let _lastTime = performance.now();
const activeRocketVisuals = new Map();

let _lastRacePhase = null;
let _crosshairTimer = 0;
let _collisionMode = 'fast';
let _smokeTimer = 0;

let domLightsEl, domTimeEl, domLight1, domLight2, domLight3, domLight4, domFpsCounter, domCrosshair;
let _framesThisSecond = 0;
let _lastFpsTime = 0;
let _lastTimeStr = null;
let _minimapTimer = 0;

function _setTimeText(str) {
  if (str !== _lastTimeStr) {
    if (domTimeEl) domTimeEl.textContent = str;
    _lastTimeStr = str;
  }
}

const _tmpFwd = new CANNON.Vec3(0, 0, 1);
const _tmpRl = new CANNON.Vec3(-0.7, -0.4, -1.4);
const _tmpRr = new CANNON.Vec3(0.7, -0.4, -1.4);
const _tmpVel = new CANNON.Vec3();
const _tmpCamTarget = new THREE.Vector3();

export function init() {
  domLightsEl = document.getElementById('start-lights');
  domTimeEl = document.getElementById('hud-time');
  domLight1 = document.getElementById('light-1');
  domLight2 = document.getElementById('light-2');
  domLight3 = document.getElementById('light-3');
  domLight4 = document.getElementById('light-4');
  domFpsCounter = document.getElementById('fps-counter');
  domCrosshair = document.getElementById('crosshair');

  Physics.setOnVehicleImpact((victimId, bumpVel, attackerId) => {
    if (Game.getState() !== Game.STATE.RACING || Game.racePhase !== 'ACTIVE') return;
    Network.sendVehicleHit(victimId, bumpVel, attackerId);
  });
}

export function setCollisionMode(mode) {
  _collisionMode = mode || 'fast';
}

export function startLoop() {
  _lastTime = performance.now();
  requestAnimationFrame(_tick);
}

function _tick(now) {
  requestAnimationFrame(_tick);
  const totalT0 = performance.now();
  const dt = Math.min((now - _lastTime) / 1000, 0.1);
  _lastTime = now;

  _framesThisSecond++;
  if (now - _lastFpsTime >= 500) {
    if (domFpsCounter) domFpsCounter.textContent = Math.round((_framesThisSecond * 1000) / (now - _lastFpsTime)) + ' FPS';
    _framesThisSecond = 0;
    _lastFpsTime = now;
  }

  const breakdown = { physics: 0, logic: 0, render: 0, audio: 0, other: 0 };
  let t1, t2, t3, t4;

  const state = Game.getState();
  if (state === Game.STATE.RACING) {
    t1 = performance.now();
    _updateRacing(dt);
    t2 = performance.now();
    // Since physics is inside _updateRacing, we can't easily split it without passing timestamps, 
    // but we can assume most of logic time IS physics time. Let's call it all physics/logic.
    breakdown.physics = t2 - t1; 
  }

  t3 = performance.now();
  Graphics.renderScene(dt);
  t4 = performance.now();
  breakdown.render = t4 - t3;
  
  const totalT1 = performance.now();
  const totalTime = totalT1 - totalT0;
  breakdown.other = totalTime - breakdown.physics - breakdown.render;

  let speed = 0;
  if (Physics.playerChassis) {
    speed = Physics.playerChassis.velocity.length() * 3.6;
  }

  Profiler.recordFrame(totalTime, dt, speed, breakdown);
}

function _updateRacing(dt) {
  const chassis = Physics.playerChassis;

  // 1. Update test driver mesh
  const testBody = Physics.getVehicleBody('__test_driver__');
  if (testBody) {
    Graphics.updateVehicleMesh('__test_driver__', testBody.position, testBody.quaternion);
  }

  // 2. Race UI (Countdown & Time) & Input & Engine Sound
  if (Game.racePhase === 'WAITING_FOR_PLAYERS' || Game.racePhase === 'INTRO') {
    if (domLightsEl) domLightsEl.classList.add('hidden');
    _setTimeText(Game.racePhase === 'WAITING_FOR_PLAYERS' ? 'WAITING FOR PLAYERS...' : 'WARMING UP...');
    Audio.updateEngine(0, false);
    Physics.setVehicleInput({
      forward: false,
      backward: false,
      left: false,
      right: false,
      fire: false,
    });
    // Stop the vehicle from moving physically before the intro starts
    if (chassis) {
      chassis.velocity.set(0,0,0);
      chassis.angularVelocity.set(0,0,0);
    }
  } else if (Game.racePhase === 'COUNTDOWN') {
    if (domLightsEl) domLightsEl.classList.remove('hidden');
    const c = Game.raceCountdown;
    
    if (domLight1) domLight1.classList.toggle('on', c <= 4.0);
    if (domLight2) domLight2.classList.toggle('on', c <= 3.0);
    if (domLight3) domLight3.classList.toggle('on', c <= 2.0);
    if (domLight4) domLight4.classList.toggle('on', c <= 1.0);

    // Ensure they are yellow
    const lights = [domLight1, domLight2, domLight3, domLight4];
    for (let i = 0; i < 4; i++) {
      const el = lights[i];
      if (el) {
        el.classList.remove('light-green');
        el.classList.add('light-yellow');
      }
    }

    _setTimeText('00:00.000');

    // Allow input so the user can potentially jump-start
    Physics.setVehicleInput(Game.input);
    Audio.updateEngine(chassis ? chassis.velocity.length() : 0, Game.input.forward);
  } else {
    // Transition to ACTIVE just happened
    if (Game.racePhase === 'ACTIVE' && _lastRacePhase === 'COUNTDOWN') {
      Audio.playBeep();
    }

    if (Game.racePhase === 'ACTIVE') {
      if (
        Game.currentRaceTime < 1.0 ||
        (Game.currentRaceTime >= 5.0 && Game.currentRaceTime < 6.0)
      ) {
        // 5.0 is the jump start penalty time base. We show the green lights for 1 second after 'GO'.
        const lights = [domLight1, domLight2, domLight3, domLight4];
        for (let i = 0; i < 4; i++) {
          const el = lights[i];
          if (el) {
            el.classList.remove('light-yellow');
            el.classList.add('light-green', 'on');
          }
        }
      } else {
        if (domLightsEl) domLightsEl.classList.add('hidden');
      }
      _setTimeText(formatTime(Game.currentRaceTime));
      Physics.setVehicleInput(Game.input);
      Audio.updateEngine(chassis ? chassis.velocity.length() : 0, Game.input.forward);
    } else {
      // FINISHED
      if (domLightsEl) domLightsEl.classList.add('hidden');
      _setTimeText(formatTime(Game.currentRaceTime));
      Physics.setVehicleInput({
        forward: false,
        backward: false,
        left: false,
        right: false,
        fire: false,
      });
      Audio.updateEngine(chassis ? chassis.velocity.length() : 0, false);
    }
  }

  _lastRacePhase = Game.racePhase;

  // 3. Physics step
  Physics.stepPhysics(dt);

  // 4. Host-authoritative collisions in STRICT mode
  if (Network.getIsHost() && _collisionMode === 'strict') {
    Physics.checkStrictCollisions();
  }

  // 5. Flip recovery
  const flip = Physics.checkFlip(dt);
  if (flip.recovered) {
    _resetToLastCheckpoint();
  }

  // 6. Out of bounds reset
  let isOutOfBounds = false;
  if (chassis) {
    if (chassis.position.y < -5) {
      isOutOfBounds = true;
    } else if (chassis._distToSplineSq > 45 * 45) { // ~3 track widths away
      // Make sure they aren't mid-air flying over a track piece by checking if their velocity is low
      // OR if they are comically far away
      if (chassis.velocity.length() < 2.0 || chassis._distToSplineSq > 100 * 100) {
        isOutOfBounds = true;
      }
    }
  }

  if (isOutOfBounds) {
    _resetToLastCheckpoint();
  }

  // 7. Weapon fire & audio
  const speed = chassis ? chassis.velocity.length() : 0;
  // Drift smoke only when sliding sideways
  if (chassis && speed > 20) {
    _tmpFwd.set(0, 0, 1);
    chassis.quaternion.vmult(_tmpFwd, _tmpFwd);
    _tmpVel.copy(chassis.velocity);
    _tmpVel.y = 0; // Ignore vertical speed
    if (_tmpVel.length() > 5) {
      _tmpVel.normalize();
      const slipDot = _tmpFwd.dot(_tmpVel);
      const isTurning = Game.input.left || Game.input.right;
      // Relaxed threshold: dot < 0.98 means > 11 degrees slip
      if (slipDot < 0.98 || (isTurning && speed > 28)) {
        Audio.setScreech(true);
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
        fireRocket('__local__', pos, quat);
      }
    } else if (weapon === 'OIL_SLICK') {
      if (chassis) {
        const pos = chassis.position;
        const quat = chassis.quaternion;
        Network.sendOilDrop(pos, quat);
        deployOilSlick('__local__', pos, quat);
      }
    } else if (weapon === 'BOOST') {
      Physics.applyBoost();
    }
  }

  // 8. Sync local chassis → local mesh
  if (chassis) {
    const pos = chassis.interpolatedPosition || chassis.position;
    const quat = chassis.interpolatedQuaternion || chassis.quaternion;
    Graphics.updateVehicleMesh('__local__', pos, quat);
  }

  // 9. Remote player LERP + mesh sync
  Network.lerpRemotePlayers(dt);
  for (const id in Network.players) {
    const p = Network.players[id];
    if (p.isLocal) continue;
    
    // Sync the dynamic physics body to the network position
    Physics.syncRemoteBody(id, p.position, p.quaternion, p.velocity, dt);
    
    // Read the visual mesh position from the actual physics body so local collisions look correct
    const rb = Physics.getVehicleBody(id);
    if (rb) {
      Graphics.updateVehicleMesh(id, rb.position, rb.quaternion);
    } else {
      Graphics.updateVehicleMesh(id, p.position, p.quaternion);
    }
  }

  // 10. Send local network state
  Network.sendLocalState(chassis, Game.input, dt);

  // 11. Game logic (checkpoints, crates, troll check, HUD)
  Game.updateRace(dt, chassis);

  // 12. Sync HUD
  if (chassis) {
    UI.updateHUD({
      speed: speed * 3.6,
      lap: `${Game.getCurrentLap()}/${Game.getLapCount()}`,
      weapon: Game.getHeldWeapon(),
      ammo: Game.getHeldAmmo()
    });
  }

  // 13. Camera spring arm
  if (chassis) {
    const pos = chassis.interpolatedPosition || chassis.position;
    const quat = chassis.interpolatedQuaternion || chassis.quaternion;
    _tmpCamTarget.set(pos.x, pos.y + 0.5, pos.z);

    if (Game.racePhase === 'INTRO') {
      const progress = 1.0 - Game.raceCountdown / 5.0; // 5s intro
      Graphics.updateIntroCamera(_tmpCamTarget, progress);
    } else {
      Graphics.updateCamera(_tmpCamTarget, quat, dt);
    }
  }

  // 14. Minimap
  if (chassis) {
    const mapData = Game.getRaceMapData();
    if (mapData) {
      _minimapTimer += dt;
      if (_minimapTimer > 0.066) { // Throttled to ~15 FPS
        Graphics.updateMinimap(Network.players, chassis);
        _minimapTimer = 0;
      }
    }
  }

  // 15. Sync rocket visual meshes
  for (const [rocket, mesh] of activeRocketVisuals.entries()) {
    const pos = rocket.body.interpolatedPosition || rocket.body.position;
    const vel = rocket.body.velocity;
    Graphics.updateRocketMesh(mesh, pos, vel, dt);
  }

  // 16. Render handled in _tick

  // 17. Update Crosshair (throttled to 10Hz to reduce physics raycast overhead)
  if (Game.heldWeapon === 'ROCKET' && chassis && domCrosshair) {
    _crosshairTimer += dt;
    if (_crosshairTimer > 0.1) {
      _crosshairTimer = 0;
      const hitPoint = Physics.raycastForward(chassis);
      const screenPos = Graphics.getScreenPosition(hitPoint);
      if (screenPos && screenPos.z < 1.0) {
        domCrosshair.classList.remove('hidden');
        domCrosshair.style.left = `${screenPos.x}px`;
        domCrosshair.style.top = `${screenPos.y}px`;
      } else {
        domCrosshair.classList.add('hidden');
      }
    }
  } else if (domCrosshair) {
    domCrosshair.classList.add('hidden');
  }
}

function _resetToLastCheckpoint() {
  const mapData = Game.getRaceMapData();
  if (!mapData) return;
  const chassis = Physics.playerChassis;

  let target;

  // Use current track progress for a more localized respawn
  if (chassis && chassis._closestT !== undefined) {
    const spline = mapData.spline;
    const length = spline.getLength();
    // Respawn ~15m behind current point
    const offsetT = 15.0 / length;
    let t = chassis._closestT - offsetT;
    if (mapData.isTest) {
      t = Math.max(0, t);
    } else {
      t = (t + 1.0) % 1.0;
    }

    const pt = spline.getPointAt(t);
    const tan = spline.getTangentAt(t).normalize();
    target = {
      pos: pt,
      quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan),
    };
  } else {
    // Fallback to last passed checkpoint
    const passed = mapData.checkpoints.filter(cp => cp.passed).sort((a, b) => b.index - a.index);
    if (passed.length > 0) {
      const cp = passed[0];
      target = {
        pos: cp.position,
        quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), cp.tangent),
      };
    } else {
      // Default to start grid
      const myId = Network.getMyPeerId();
      const playerIds = Object.keys(Network.players).sort();
      const myIdx = Math.max(0, playerIds.indexOf(myId));
      target = mapData.startGrid[myIdx % mapData.startGrid.length] || mapData.startGrid[0];
    }
  }

  const respawnPos = target.pos.clone();
  respawnPos.y += 2.0; // Drop from air
  Physics.resetVehicle(respawnPos, target.quat);
}

export function fireRocket(id, pos, quat) {
  if (!pos || !quat) return;
  const mesh = Graphics.createRocketMesh();
  const startPos = new CANNON.Vec3(pos.x, pos.y, pos.z);
  const startQuat = new CANNON.Quaternion(quat.x, quat.y, quat.z, quat.w);

  const owner = Physics.getVehicleBody(id);

  const onExplode = (impactPos, r) => {
    Graphics.spawnExplosion(impactPos);
    Audio.playExplosion();
    const m = activeRocketVisuals.get(r);
    if (m) {
      Graphics.removeMesh(m);
      activeRocketVisuals.delete(r);
    }
  };

  const rocket = Physics.fireRocket(startPos, startQuat, onExplode, owner);
  
  if (rocket) {
    Audio.playRocketLaunch();
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

export function spawnRemoteRocket(pos, quat) {
  fireRocket('__remote__', pos, quat);
}

export function deployOilSlick(id, pos, quat) {
  if (!pos || !quat) return;
  const startPos = new CANNON.Vec3(pos.x, pos.y, pos.z);
  const startQuat = new CANNON.Quaternion(quat.x, quat.y, quat.z, quat.w);

  const slick = Physics.deployOilSlick(startPos, startQuat);
  const mesh = Graphics.createOilSlickMesh(slick.body.position);

  slick.onCleanup = () => {
    Graphics.removeMesh(mesh);
  };
}

export function spawnRemoteOil(pos, quat) {
  deployOilSlick('__remote__', pos, quat);
}
