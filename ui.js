import * as Network from './network.js';


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
    if (_onReturnLobby) _onReturnLobby();
  });
}


export function updateHUD(data) {
  const speedEl = document.getElementById('hud-speed');
  if (speedEl && data.speed !== undefined) {
    speedEl.textContent = Math.round(data.speed);
  }
  const lapEl = document.getElementById('hud-lap');
  if (lapEl && data.lap !== undefined) {
    lapEl.textContent = data.lap;
  }
  const weaponEl = document.getElementById('hud-weapon');
  if (weaponEl && data.weapon !== undefined) {
    weaponEl.textContent = data.weapon;
  }
  const ammoEl = document.getElementById('hud-ammo');
  if (ammoEl && data.ammo !== undefined) {
    ammoEl.textContent = data.ammo > 0 ? data.ammo : '';
  }
}


export function showMessage(msg, type = 'info') {
  const el = document.getElementById('lobby-status');
  if (el) {
    el.textContent = msg;
    el.className = 'status-msg ' + type;
  }
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
    item.innerHTML = `<span>${p.name || 'Anonymous'}</span><span class="${statusClass}">${statusText}</span>`;
    list.appendChild(item);
  });
}

export function refreshPlayerList(players, isHost) {
  const list = document.getElementById('player-list');
  list.innerHTML = '';
  Object.values(players).forEach(p => {
    const li = document.createElement('div');
    li.className = 'player-item';
    li.innerHTML = `<span>${p.name || 'Anonymous'}</span>`;
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

  // Toggle host-only UI
  const startBtn = document.getElementById('btn-start');
  if (startBtn) startBtn.classList.toggle('hidden', !isHost);
  const hostControls = document.getElementById('host-controls');
  if (hostControls) hostControls.classList.toggle('hidden', !isHost);
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

/** Show a 3-2-1 countdown overlay then call `onDone`. */
export function showReturnLobbyCountdown(onDone) {
  const overlay = document.getElementById('return-lobby-overlay');
  const countdownEl = document.getElementById('return-lobby-countdown');
  if (!overlay || !countdownEl) { onDone(); return; }

  // Use style.display directly — .hidden has display:none !important which overrides flex
  overlay.style.display = 'flex';
  let count = 3;
  countdownEl.textContent = count;

  const tick = setInterval(() => {
    count--;
    if (count <= 0) {
      clearInterval(tick);
      overlay.style.display = 'none';
      onDone();
    } else {
      countdownEl.textContent = count;
    }
  }, 1000);
}
