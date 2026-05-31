import * as Network from './network.js';
import { Profiler } from './profiler.js';


let _onHost = null;
let _onJoin = null;
let _onCarPrev = null;
let _onCarNext = null;
let _onJoinCarPrev = null;
let _onJoinCarNext = null;
let _onConnect = null;
let _onStart = null;
let _onHandlingChange = null;
let _onReturnLobby = null;
let _onDevMenuTrigger = null;
let _onDevMenuSave = null;


export function init(callbacks) {
  _onHost = callbacks.onHost;
  _onJoin = callbacks.onJoin;
  _onCarPrev = callbacks.onCarPrev;
  _onCarNext = callbacks.onCarNext;
  _onJoinCarPrev = callbacks.onJoinCarPrev;
  _onJoinCarNext = callbacks.onJoinCarNext;
  _onConnect = callbacks.onConnect;
  _onStart = callbacks.onStart;
  _onHandlingChange = callbacks.onHandlingChange;
  _onReturnLobby = callbacks.onReturnLobby || null;
  _onDevMenuTrigger = callbacks.onDevMenuTrigger || null;
  _onDevMenuSave = callbacks.onDevMenuSave || null;


  _setupEventListeners();
}

function safeAddListener(id, type, cb) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(type, cb);
}

function _setupEventListeners() {
  safeAddListener('btn-host', 'click', () => {
    if (_onHost) _onHost();
  });


  safeAddListener('btn-join', 'click', () => {
    if (_onJoin) _onJoin();
  });

  safeAddListener('btn-download-log', 'click', () => {
    Profiler.downloadLog();
  });

  safeAddListener('btn-download-log-finished', 'click', () => {
    Profiler.downloadLog();
  });

  safeAddListener('btn-download-log-hud', 'click', () => {
    Profiler.downloadLog();
  });

  safeAddListener('btn-car-prev', 'click', (e) => {
    e.target.blur();
    if (_onCarPrev) _onCarPrev();
  });

  safeAddListener('btn-car-next', 'click', (e) => {
    e.target.blur();
    if (_onCarNext) _onCarNext();
  });

  safeAddListener('btn-join-car-prev', 'click', (e) => {
    e.target.blur();
    if (_onJoinCarPrev) _onJoinCarPrev();
  });

  safeAddListener('btn-join-car-next', 'click', (e) => {
    e.target.blur();
    if (_onJoinCarNext) _onJoinCarNext();
  });

  const handleConnect = () => {
    const lobbyId = document.getElementById('join-lobby-id-display').value.trim();
    if (_onConnect) _onConnect(lobbyId);
  };
  safeAddListener('btn-connect', 'click', handleConnect);
  safeAddListener('btn-join-lobby-connect', 'click', handleConnect);

  safeAddListener('btn-start', 'click', () => {
    if (_onStart) _onStart();
  });


  safeAddListener('btn-copy-id', 'click', () => {
    const id = document.getElementById('peer-id-display').textContent;
    navigator.clipboard.writeText(id).then(() => {
      const btn = document.getElementById('btn-copy-id');
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = '📋 ID'; }, 2000);
    });
  });

  safeAddListener('btn-share-link', 'click', () => {
    const id = document.getElementById('peer-id-display').textContent;
    const url = `${window.location.origin}${window.location.pathname}?lobby=${id}`;
    navigator.clipboard.writeText(url).then(() => {
      const btn = document.getElementById('btn-share-link');
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = '🔗 LINK'; }, 2000);
    });
  });

  safeAddListener('btn-lobby-back', 'click', () => {
    location.reload();
  });
  
  safeAddListener('btn-quit', 'click', () => {
    location.reload();
  });

  safeAddListener('btn-lobby', 'click', (e) => {
    e.target.blur();
    e.target.disabled = true; // Prevent multiple clicks
    Network.returnToLobby();
  });

  // Name sync
  safeAddListener('player-name', 'input', (e) => {
    localStorage.setItem('nitro-name', e.target.value);
  });
  safeAddListener('join-lobby-name', 'input', (e) => {
    localStorage.setItem('nitro-name', e.target.value);
  });
  safeAddListener('handling-input', 'change', (e) => {
    if (_onHandlingChange) _onHandlingChange(e.target.value);
  });

  safeAddListener('btn-host-return-lobby', 'click', (e) => {
    e.target.blur();
    e.target.disabled = true;
    Network.returnToLobby(); // Use Network.returnToLobby to ensure countdown triggers
  });

  // Dev Menu trigger (10 clicks under 3s)
  let devClickCount = 0;
  let devLastClickTime = 0;
  safeAddListener('car-preview-canvas', 'click', () => {
    const now = Date.now();
    if (now - devLastClickTime > 3000) {
      devClickCount = 0;
    }
    devClickCount++;
    devLastClickTime = now;
    if (devClickCount >= 10) {
      devClickCount = 0;
      if (_onDevMenuTrigger) _onDevMenuTrigger();
    }
  });

  safeAddListener('btn-dev-close', 'click', () => {
    document.getElementById('dev-menu').classList.remove('active');
    setTimeout(() => document.getElementById('dev-menu').classList.add('hidden'), 250);
  });

  safeAddListener('btn-dev-save', 'click', () => {
    if (_onDevMenuSave) _onDevMenuSave();
    document.getElementById('dev-menu').classList.remove('active');
    setTimeout(() => document.getElementById('dev-menu').classList.add('hidden'), 250);
  });
}


let _lastHUDState = { speed: -1, lap: null, weapon: null, ammo: null };

export function updateHUD(data) {
  if (data.speed !== undefined) {
    const spd = Math.round(data.speed);
    if (spd !== _lastHUDState.speed) {
      const speedEl = document.getElementById('hud-speed');
      if (speedEl) speedEl.textContent = spd;
      _lastHUDState.speed = spd;
    }
  }
  if (data.lap !== undefined && data.lap !== _lastHUDState.lap) {
    const lapEl = document.getElementById('hud-lap');
    if (lapEl) lapEl.textContent = data.lap;
    _lastHUDState.lap = data.lap;
  }
  if (data.weapon !== undefined && data.weapon !== _lastHUDState.weapon) {
    const weaponEl = document.getElementById('hud-weapon');
    if (weaponEl) weaponEl.textContent = data.weapon;
    _lastHUDState.weapon = data.weapon;
  }
  if (data.ammo !== undefined && data.ammo !== _lastHUDState.ammo) {
    const ammoEl = document.getElementById('hud-ammo');
    if (ammoEl) ammoEl.textContent = data.ammo > 0 ? data.ammo : '';
    _lastHUDState.ammo = data.ammo;
  }
}


export function showMessage(msg, type = 'info') {
  const el1 = document.getElementById('lobby-status');
  const el2 = document.getElementById('join-lobby-status');
  const el3 = document.getElementById('menu-status');
  
  // Update all of them so whatever screen is active sees it
  [el1, el2, el3].forEach(el => {
    if (el) {
      el.textContent = msg;
      el.className = 'status-msg ' + type;
    }
  });
}

export function setLoading(active, message = 'LOADING ASSETS...') {
  const overlay = document.getElementById('loading-overlay');
  overlay.classList.toggle('hidden', !active);
  const textEl = document.getElementById('loading-text');
  if (textEl) {
    textEl.textContent = message;
  }
  
  // Clear the player list if we hide the loading screen
  if (!active) {
    const list = document.getElementById('loading-player-list');
    if (list) list.innerHTML = '';
  }
}

export function updateLoadingPlayerList(players) {
  const list = document.getElementById('loading-player-list');
  if (!list) return;
  list.innerHTML = '';
  Object.values(players).forEach(p => {
    const statusText = p.loaded ? 'READY' : 'LOADING...';
    const statusClass = p.loaded ? 'loading-status-ready' : 'loading-status-loading';
    const item = document.createElement('div');
    item.className = 'loading-player-item';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = p.name || 'Anonymous';
    const statusSpan = document.createElement('span');
    statusSpan.className = statusClass;
    statusSpan.textContent = statusText;
    item.appendChild(nameSpan);
    item.appendChild(statusSpan);
    list.appendChild(item);
  });
}

export function refreshPlayerList(players, isHost) {
  const list = document.getElementById('player-list');
  list.innerHTML = '';
  Object.values(players).forEach(p => {
    const li = document.createElement('div');
    li.className = 'player-item';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = p.name || 'Anonymous';
    li.appendChild(nameSpan);
    if (isHost && !p.isLocal) {
      const kickBtn = document.createElement('button');
      kickBtn.className = 'btn btn-small';
      kickBtn.style.marginLeft = '10px';
      kickBtn.textContent = 'KICK';
      kickBtn.onclick = () => Network.kickPlayer(p.id);
      li.appendChild(kickBtn);
    }
    list.appendChild(li);
  });

  // Toggle host-only UI state instead of hiding it
  const startBtn = document.getElementById('btn-start');
  if (startBtn) {
    if (isHost) {
      startBtn.textContent = 'START RACE';
      startBtn.disabled = false;
      startBtn.classList.remove('btn-secondary');
      startBtn.classList.add('btn-primary');
      startBtn.classList.remove('hidden'); // Ensure it's not hidden
    } else {
      startBtn.textContent = 'WAITING FOR HOST...';
      startBtn.disabled = true;
      startBtn.classList.remove('btn-primary');
      startBtn.classList.add('btn-secondary');
      startBtn.classList.remove('hidden'); // Ensure it's not hidden
    }
  }

  const hostControls = document.getElementById('host-controls');
  if (hostControls) {
    // Make sure it's always visible so guests can see the settings
    hostControls.classList.remove('hidden');
    
    // Disable or enable the inputs based on host status
    const inputs = hostControls.querySelectorAll('input, select');
    inputs.forEach(input => {
      input.disabled = !isHost;
      if (!isHost) {
        input.style.opacity = '0.7';
        input.style.cursor = 'not-allowed';
      } else {
        input.style.opacity = '1';
        input.style.cursor = 'pointer';
      }
    });
  }
}

export function updateHandlingInput(val) {
  const el = document.getElementById('handling-input');
  if (el) el.value = val;
}

/** Show/hide the in-race host return-to-lobby button */
export function showHostReturnButton(visible) {
  const btn = document.getElementById('btn-host-return-lobby');
  if (btn) btn.classList.toggle('hidden', !visible);
}

export function showReturnLobbyCountdown(onDone) {
  const overlay = document.getElementById('return-lobby-overlay');
  const countdownEl = document.getElementById('return-lobby-countdown');
  if (!overlay || !countdownEl) {
    if (onDone) onDone();
    return;
  }

  // Ensure it's forcefully shown
  overlay.classList.remove('hidden');
  overlay.style.display = 'flex';
  
  let count = 3;
  countdownEl.textContent = count;

  // Clear any existing interval just in case
  if (overlay._tick) clearInterval(overlay._tick);

  overlay._tick = setInterval(() => {
    count--;
    if (count <= 0) {
      clearInterval(overlay._tick);
      overlay._tick = null;
      overlay.classList.add('hidden');
      overlay.style.display = 'none';
      if (onDone) onDone();
    } else {
      countdownEl.textContent = count;
    }
  }, 1000);
}
