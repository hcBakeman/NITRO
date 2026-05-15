import * as Network from './network.js';


let _onHost = null;
let _onJoin = null;
let _onCarPrev = null;
let _onCarNext = null;
let _onJoinCarPrev = null;
let _onJoinCarNext = null;
let _onConnect = null;
let _onStart = null;


export function init(callbacks) {
  _onHost = callbacks.onHost;
  _onJoin = callbacks.onJoin;
  _onCarPrev = callbacks.onCarPrev;
  _onCarNext = callbacks.onCarNext;
  _onJoinCarPrev = callbacks.onJoinCarPrev;
  _onJoinCarNext = callbacks.onJoinCarNext;
  _onConnect = callbacks.onConnect;
  _onStart = callbacks.onStart;


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

export function setLoading(active) {
  document.getElementById('loading-overlay').classList.toggle('hidden', !active);
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

