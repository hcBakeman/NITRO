import * as Network from './network.js';


let _onHost = null;
let _onJoin = null;
let _onCarPrev = null;
let _onCarNext = null;
let _onJoinCarPrev = null;
let _onJoinCarNext = null;
let _onConnect = null;

export function init(callbacks) {
  _onHost = callbacks.onHost;
  _onJoin = callbacks.onJoin;
  _onCarPrev = callbacks.onCarPrev;
  _onCarNext = callbacks.onCarNext;
  _onJoinCarPrev = callbacks.onJoinCarPrev;
  _onJoinCarNext = callbacks.onJoinCarNext;
  _onConnect = callbacks.onConnect;

  _setupEventListeners();
}

function _setupEventListeners() {
  document.getElementById('btn-host').addEventListener('click', () => {
    const customId = document.getElementById('lobby-id-input').value.trim() || undefined;
    _onHost(customId);
  });

  document.getElementById('btn-join').addEventListener('click', () => {
    _onJoin();
  });

  document.getElementById('btn-car-prev').addEventListener('click', (e) => {
    e.target.blur();
    _onCarPrev();
  });

  document.getElementById('btn-car-next').addEventListener('click', (e) => {
    e.target.blur();
    _onCarNext();
  });

  document.getElementById('btn-join-car-prev').addEventListener('click', (e) => {
    e.target.blur();
    _onJoinCarPrev();
  });

  document.getElementById('btn-join-car-next').addEventListener('click', (e) => {
    e.target.blur();
    _onJoinCarNext();
  });

  document.getElementById('btn-connect').addEventListener('click', () => {
    const lobbyId = document.getElementById('join-lobby-id-display').value.trim();
    _onConnect(lobbyId);
  });

  document.getElementById('btn-start').addEventListener('click', () => {
    Network.startGame();
  });

  document.getElementById('btn-copy-id').addEventListener('click', () => {
    const id = document.getElementById('peer-id-display').textContent;
    navigator.clipboard.writeText(id).then(() => {
      const btn = document.getElementById('btn-copy-id');
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = '📋 ID'; }, 2000);
    });
  });

  document.getElementById('btn-share-link').addEventListener('click', () => {
    const id = document.getElementById('peer-id-display').textContent;
    const url = `${window.location.origin}${window.location.pathname}?lobby=${id}`;
    navigator.clipboard.writeText(url).then(() => {
      const btn = document.getElementById('btn-share-link');
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = '🔗 LINK'; }, 2000);
    });
  });

  document.getElementById('btn-lobby-back').addEventListener('click', () => {
    location.reload();
  });
  
  document.getElementById('btn-quit').addEventListener('click', () => {
    location.reload();
  });

  document.getElementById('btn-lobby').addEventListener('click', (e) => {
    e.target.blur();
    Network.returnToLobby();
  });

  // Name sync
  document.getElementById('player-name').addEventListener('input', (e) => {
    localStorage.setItem('nitro-name', e.target.value);
  });
  document.getElementById('join-lobby-name').addEventListener('input', (e) => {
    localStorage.setItem('nitro-name', e.target.value);
  });
}

export function updateHUD(data) {
  if (data.speed !== undefined) {
    document.getElementById('hud-speed').textContent = Math.round(data.speed);
  }
  if (data.lap !== undefined) {
    document.getElementById('hud-lap').textContent = data.lap;
  }
  if (data.weapon !== undefined) {
    document.getElementById('hud-weapon').textContent = data.weapon;
    document.getElementById('hud-ammo').textContent = data.ammo > 0 ? data.ammo : '';
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
}
