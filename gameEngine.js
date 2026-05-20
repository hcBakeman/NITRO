import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import * as Game from './game.js';
import * as Network from './network.js';
import * as Graphics from './graphics.js';
import * as Physics from './physics.js';
import * as Audio from './audio.js';
import * as UI from './ui.js';
import { formatTime } from './utils.js';

let _lastTime = performance.now();
const activeRocketVisuals = new Map();

let _lastRacePhase = null;
let _crosshairTimer = 0;
let _collisionMode = 'fast';

export function init() {
  Physics.setOnVehicleImpact((victimId, impulse, point, attackerId) => {
    if (Game.getState() !== Game.STATE.RACING || Game.racePhase !== 'ACTIVE') return;
    Network.sendVehicleHit(victimId, impulse, point, attackerId);
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
  const dt = Math.min((now - _lastTime) / 1000, 0.1);
  _lastTime = now;

  const state = Game.getState();
  if (state !== Game.STATE.RACING) {
    Graphics.renderScene(dt);
  } else {
    _updateRacing(dt);
  }
}

function _updateRacing(dt) {
  const chassis = Physics.playerChassis;

  // 1. Update test driver mesh
  const testBody = Physics.getVehicleBody('__test_driver__');
  if (testBody) {
    Graphics.updateVehicleMesh('__test_driver__', testBody.position, testBody.quaternion);
  }

  // 2. Race UI (Countdown & Time) & Input & Engine Sound
  const lightsEl = document.getElementById('start-lights');
  const timeEl = document.getElementById('hud-time');

  if (Game.racePhase === 'INTRO') {
    if (lightsEl) lightsEl.classList.add('hidden');
    if (timeEl) timeEl.textContent = 'WARMING UP...';
    Audio.updateEngine(0, false);
    Physics.setVehicleInput({
      forward: false,
      backward: false,
      left: false,
      right: false,
      fire: false,
    });
  } else if (Game.racePhase === 'COUNTDOWN') {
    if (lightsEl) lightsEl.classList.remove('hidden');
    const c = Game.raceCountdown;
    
    const l1 = document.getElementById('light-1');
    const l2 = document.getElementById('light-2');
    const l3 = document.getElementById('light-3');
    const l4 = document.getElementById('light-4');
    
    if (l1) l1.classList.toggle('on', c <= 4.0);
    if (l2) l2.classList.toggle('on', c <= 3.0);
    if (l3) l3.classList.toggle('on', c <= 2.0);
    if (l4) l4.classList.toggle('on', c <= 1.0);

    // Ensure they are yellow
    for (let i = 1; i <= 4; i++) {
      const el = document.getElementById(`light-${i}`);
      if (el) {
        el.classList.remove('light-green');
        el.classList.add('light-yellow');
      }
    }

    if (timeEl) timeEl.textContent = '00:00.000';

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
        for (let i = 1; i <= 4; i++) {
          const el = document.getElementById(`light-${i}`);
          if (el) {
            el.classList.remove('light-yellow');
            el.classList.add('light-green', 'on');
          }
        }
      } else {
        if (lightsEl) lightsEl.classList.add('hidden');
      }
      if (timeEl) timeEl.textContent = formatTime(Game.currentRaceTime);
      Physics.setVehicleInput(Game.input);
      Audio.updateEngine(chassis ? chassis.velocity.length() : 0, Game.input.forward);
    } else {
      // FINISHED
      if (lightsEl) lightsEl.classList.add('hidden');
      if (timeEl) timeEl.textContent = formatTime(Game.currentRaceTime);
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
  if (chassis && chassis.position.y < -5) {
    _resetToLastCheckpoint();
  }

  // 7. Weapon fire & audio
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
        const q = chassis.quaternion,
          p = chassis.position;
        const rl = new CANNON.Vec3(-0.7, -0.4, -1.4),
          rr = new CANNON.Vec3(0.7, -0.4, -1.4);
        q.vmult(rl, rl);
        q.vmult(rr, rr);
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
  for (const [id, p] of Object.entries(Network.players)) {
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
    const _camTarget = new THREE.Vector3(pos.x, pos.y + 0.5, pos.z);

    if (Game.racePhase === 'INTRO') {
      const progress = 1.0 - Game.raceCountdown / 5.0; // 5s intro
      Graphics.updateIntroCamera(_camTarget, progress);
    } else {
      Graphics.updateCamera(_camTarget, quat, dt);
    }
  }

  // 14. Minimap
  if (chassis) {
    const mapData = Game.getRaceMapData();
    if (mapData) {
      Graphics.updateMinimap(Network.players, chassis);
    }
  }

  // 15. Sync rocket visual meshes
  for (const [rocket, mesh] of activeRocketVisuals.entries()) {
    const pos = rocket.body.interpolatedPosition || rocket.body.position;
    const vel = rocket.body.velocity;
    Graphics.updateRocketMesh(mesh, pos, vel, dt);
  }

  // 16. Render
  Graphics.renderScene(dt);

  // 17. Update Crosshair (throttled to 10Hz to reduce physics raycast overhead)
  const crosshairEl = document.getElementById('crosshair');
  if (Game.heldWeapon === 'ROCKET' && chassis && crosshairEl) {
    _crosshairTimer += dt;
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
    let t = (chassis._closestT - offsetT + 1.0) % 1.0;

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
