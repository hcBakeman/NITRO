import { FACTORY_PRESETS } from './PresetManager.js';

export class LaserUI {
  constructor(laserBeams, stageLights, atmosphere, laserEngine, randomizer, presetManager, audioAnalyzer) {
    this.laserBeams = laserBeams;
    this.stageLights = stageLights;
    this.atmosphere = atmosphere;
    this.laserEngine = laserEngine;
    this.randomizer = randomizer;
    this.presetManager = presetManager;
    this.audioAnalyzer = audioAnalyzer;

    this.visible = true;
    this.initUI();
    this.setupHotkeys();
    this.updatePresetBadge();
  }

  initUI() {
    this.container = document.createElement('div');
    this.container.id = 'laser-ui-container';
    this.container.className = 'laser-ui-glass';

    this.container.innerHTML = `
      <div class="ui-header">
        <div class="ui-title">
          <span class="laser-dot"></span> VOLUMETRIC LASER STUDIO <span class="obs-badge">OBS READY</span>
        </div>
        <div class="ui-actions">
          <button id="btn-toggle-ui" title="Hide UI (Hotkey: H)">👁️ Hide [H]</button>
        </div>
      </div>

      <div class="ui-body">
        <!-- Preset Counter & Next/Prev Controls -->
        <div class="preset-nav-card">
          <div class="preset-badge-info">
            <span id="preset-id-badge">Preset #1,234,567</span>
            <span id="preset-counter-badge" class="sub-badge">(1 in history)</span>
          </div>
          <div class="preset-nav-buttons">
            <button id="btn-prev-preset" class="btn-nav" title="Previous Preset (Hotkey: P or Left Arrow)">◀ PREV [P]</button>
            <button id="btn-next-preset" class="btn-nav btn-accent" title="Next Random Preset (Hotkey: N, Space, or Right Arrow)">NEXT PRESET ▶ [N]</button>
          </div>
        </div>

        <!-- Quick Action Bar -->
        <div class="ui-bar ui-bar-3">
          <button id="btn-randomize" class="btn-primary" title="Generate New Preset (Space)">🎲 RANDOMIZE</button>
          <button id="btn-chaos" class="btn-secondary" title="Auto-Morph Random Presets">⚡ Auto-Chaos</button>
          <button id="btn-loop-custom" class="btn-playlist" title="Auto-Morph My Saved Presets (Hotkey: L)">🔁 Loop My Presets [L]</button>
        </div>

        <!-- Factory & Custom Presets Dropdown -->
        <div class="ui-group">
          <label>Load Preset (Factory & Custom)</label>
          <select id="select-preset">
            <optgroup label="Factory Presets (1-8)">
              ${Object.keys(FACTORY_PRESETS).map(key => `<option value="${key}">${FACTORY_PRESETS[key].name}</option>`).join('')}
            </optgroup>
            <optgroup label="My Saved Custom Presets" id="optgroup-custom-presets">
            </optgroup>
          </select>
        </div>

        <!-- Custom Preset Creator & Hotkey Manager -->
        <div class="ui-section">
          <div class="section-title">💾 Save Custom Preset & Hotkey</div>
          <div class="ui-row">
            <input type="text" id="input-preset-name" placeholder="Preset Name (e.g. My Rave #1)" class="ui-input-text">
            <input type="text" id="input-preset-hotkey" placeholder="Key (e.g. 1, q, f)" maxlength="5" class="ui-input-key" title="Custom Hotkey">
          </div>
          <button id="btn-save-custom-preset" class="btn-save">+ Save Current Effect & Bind Hotkey</button>

          <!-- List of Custom Presets -->
          <div id="custom-presets-list" class="custom-presets-container">
            <!-- Dynamically populated -->
          </div>
        </div>

        <!-- Tabs / Sections -->
        <div class="ui-section">
          <div class="section-title">📐 Geometry & Laser Pattern</div>
          <div class="ui-row">
            <label>Pattern Type</label>
            <select id="ctrl-beamType">
              <option value="lissajous">Lissajous Curves</option>
              <option value="spirograph">Spirograph / Rose</option>
              <option value="tunnel">Cyber Laser Tunnel</option>
              <option value="fan">Laser Fan Array</option>
              <option value="cone">Cone Scanner</option>
              <option value="grid">Grid Matrix</option>
              <option value="starburst">Starburst Radial</option>
              <option value="wave">Wave Ray Array</option>
            </select>
          </div>
          <div class="ui-row">
            <label>Beam Count (<span id="val-beamCount">64</span>)</label>
            <input type="range" id="ctrl-beamCount" min="8" max="120" step="2" value="64">
          </div>
          <div class="ui-row">
            <label>Thickness (<span id="val-thickness">0.12</span>)</label>
            <input type="range" id="ctrl-thickness" min="0.04" max="0.30" step="0.01" value="0.12">
          </div>
          <div class="ui-row">
            <label>Pattern Radius (<span id="val-radius">6</span>)</label>
            <input type="range" id="ctrl-radius" min="2" max="15" step="0.5" value="6">
          </div>
        </div>

        <div class="ui-section">
          <div class="section-title">🎨 Color & Rainbow Diode</div>
          <div class="ui-row">
            <label>Primary Laser</label>
            <input type="color" id="ctrl-color1" value="#00ffcc">
          </div>
          <div class="ui-row">
            <label>Secondary Laser</label>
            <input type="color" id="ctrl-color2" value="#ff007f">
          </div>
          <div class="ui-row">
            <label>Rainbow Cycle (<span id="val-rainbowSpeed">0.0</span>)</label>
            <input type="range" id="ctrl-rainbowSpeed" min="0" max="3" step="0.1" value="0">
          </div>
          <div class="ui-row">
            <label>Intensity Brightness (<span id="val-intensity">1.2</span>)</label>
            <input type="range" id="ctrl-intensity" min="0.2" max="2.5" step="0.05" value="1.2">
          </div>
          <div class="ui-row">
            <label>Bloom Glow Strength (<span id="val-bloom">0.85</span>)</label>
            <input type="range" id="ctrl-bloom" min="0.0" max="2.5" step="0.05" value="0.85">
          </div>
          <div class="ui-row-check">
            <label><input type="checkbox" id="chk-purecolor" checked> 🌈 Pure Saturated Colors (No White Bleach)</label>
          </div>
        </div>

        <div class="ui-section">
          <div class="section-title">⚡ Motion, Sweep & Strobe</div>
          <div class="ui-row">
            <label>3D Rotation Speed (<span id="val-rotSpeedY">0.3</span>)</label>
            <input type="range" id="ctrl-rotSpeedY" min="-1.5" max="1.5" step="0.05" value="0.3">
          </div>
          <div class="ui-row">
            <label>Sweep Pan Speed (<span id="val-sweepSpeed">0.5</span>)</label>
            <input type="range" id="ctrl-sweepSpeed" min="0" max="2.0" step="0.05" value="0.5">
          </div>
          <div class="ui-row">
            <label>Wobble Wave (<span id="val-wobbleAmp">0.3</span>)</label>
            <input type="range" id="ctrl-wobbleAmp" min="0" max="1.0" step="0.05" value="0.3">
          </div>
          <div class="ui-row">
            <label>Spiral Twist (<span id="val-spiral">0.0</span>)</label>
            <input type="range" id="ctrl-spiral" min="0" max="2.0" step="0.1" value="0">
          </div>
          <div class="ui-row">
            <label>Strobe Flash Rate (<span id="val-strobeSpeed">0.0</span>)</label>
            <input type="range" id="ctrl-strobeSpeed" min="0" max="10.0" step="0.2" value="0">
          </div>
          <div class="ui-row-check">
            <label><input type="checkbox" id="chk-morph" checked> 🌀 Smooth Preset Morphing [Hotkey: M]</label>
          </div>
          <div class="ui-row">
            <label>Morph Duration (<span id="val-morphDuration">1.5</span>s)</label>
            <input type="range" id="ctrl-morphDuration" min="0.3" max="4.0" step="0.1" value="1.5">
          </div>
        </div>

        <div class="ui-section">
          <div class="section-title">📺 Stage Background & OBS Settings</div>
          <div class="ui-row-check">
            <label><input type="checkbox" id="chk-blackmode" checked> ⬛ Pure Black Void Background [Hotkey: B]</label>
          </div>
          <div class="ui-row-check">
            <label><input type="checkbox" id="chk-transparent"> 🏁 Transparent Overlay Mode (OBS)</label>
          </div>
          <div class="ui-row-check">
            <label><input type="checkbox" id="chk-stagelights" checked> 💡 Moving Head Spotlights</label>
          </div>
          <div class="ui-row-check">
            <label><input type="checkbox" id="chk-audio"> 🎤 Web Audio Mic Beat Sync</label>
          </div>
        </div>

        <div class="ui-footer">
          <div class="ui-hint">
            <strong>Hotkeys:</strong> <code>N</code> or <code>▶</code> Next | <code>P</code> or <code>◀</code> Prev | <code>Space</code> Random | <code>H</code> Hide Menu
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.container);
    this.bindEvents();
  }

  updatePresetBadge() {
    const current = this.randomizer.getCurrentPreset();
    const badge = document.getElementById('preset-id-badge');
    const counter = document.getElementById('preset-counter-badge');

    if (current && badge && counter) {
      badge.textContent = current.name || `Preset #${current.id}`;
      const total = this.randomizer.history.length;
      const idx = this.randomizer.historyIndex + 1;
      counter.textContent = `(${idx} of ${total})`;
    }
  }

  bindEvents() {
    const p = this.laserBeams.params;

    // NEXT Preset Button
    document.getElementById('btn-next-preset').addEventListener('click', () => {
      this.randomizer.nextPreset();
      this.syncControlsFromParams();
      this.updatePresetBadge();
    });

    // PREV Preset Button
    document.getElementById('btn-prev-preset').addEventListener('click', () => {
      this.randomizer.previousPreset();
      this.syncControlsFromParams();
      this.updatePresetBadge();
    });

    // Super Randomize
    document.getElementById('btn-randomize').addEventListener('click', () => {
      this.randomizer.generateNextPreset();
      this.syncControlsFromParams();
      this.updatePresetBadge();
    });

    // Auto Chaos & Auto-Morph Custom Playlist buttons
    const chaosBtn = document.getElementById('btn-chaos');
    const loopCustomBtn = document.getElementById('btn-loop-custom');

    this.updateAutomationButtonsUI = () => {
      if (chaosBtn) chaosBtn.classList.toggle('active', this.randomizer.autoChaosActive);
      if (loopCustomBtn) loopCustomBtn.classList.toggle('active', this.randomizer.autoMorphCustomActive);
    };

    chaosBtn.addEventListener('click', () => {
      const active = !this.randomizer.autoChaosActive;
      this.randomizer.setAutoChaos(active, 8);
      this.updateAutomationButtonsUI();
    });

    loopCustomBtn.addEventListener('click', () => {
      const active = !this.randomizer.autoMorphCustomActive;
      const customPresets = this.presetManager.getCustomPresets();

      if (active && customPresets.length === 0) {
        alert('Please save at least 1 custom preset first to start looping your saved playlist!');
        return;
      }

      this.randomizer.setAutoMorphCustom(active, 6, this.presetManager);
      this.updateAutomationButtonsUI();
    });

    // Preset selector
    document.getElementById('select-preset').addEventListener('change', (e) => {
      this.presetManager.loadPreset(e.target.value);
      this.syncControlsFromParams();
    });

    document.getElementById('ctrl-beamType').addEventListener('change', (e) => {
      p.beamType = e.target.value;
      if (this.laserBeams.isMorphing) {
        this.laserBeams.morphTargetParams.beamType = e.target.value;
        this.laserBeams.morphStartParams.beamType = e.target.value;
      }
      this.laserBeams.rebuildBeams();
    });

    // Sliders
    const sliders = [
      { id: 'beamCount', param: 'beamCount', isInt: true, rebuild: true },
      { id: 'thickness', param: 'thickness', isInt: false, rebuild: true },
      { id: 'radius', param: 'radius', isInt: false, rebuild: true },
      { id: 'rainbowSpeed', param: 'rainbowSpeed', isInt: false, rebuild: false },
      { id: 'intensity', param: 'intensity', isInt: false, rebuild: false },
      { id: 'rotSpeedY', param: 'rotSpeedY', isInt: false, rebuild: false },
      { id: 'sweepSpeed', param: 'sweepSpeed', isInt: false, rebuild: false },
      { id: 'wobbleAmp', param: 'wobbleAmp', isInt: false, rebuild: false },
      { id: 'spiral', param: 'spiral', isInt: false, rebuild: false },
      { id: 'strobeSpeed', param: 'strobeSpeed', isInt: false, rebuild: false }
    ];

    // Bloom Strength Slider listener
    const bloomElem = document.getElementById('ctrl-bloom');
    const bloomVal = document.getElementById('val-bloom');
    if (bloomElem) {
      bloomElem.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.laserEngine.setBloomParameters(val, 0.3, 0.2);
        if (bloomVal) bloomVal.textContent = val.toFixed(2);
      });
    }

    sliders.forEach(item => {
      const elem = document.getElementById(`ctrl-${item.id}`);
      const valElem = document.getElementById(`val-${item.id}`);
      elem.addEventListener('input', (e) => {
        const val = item.isInt ? parseInt(e.target.value) : parseFloat(e.target.value);
        p[item.param] = val;
        if (this.laserBeams.isMorphing) {
          this.laserBeams.morphTargetParams[item.param] = val;
          this.laserBeams.morphStartParams[item.param] = val;
        }
        if (valElem) valElem.textContent = val.toString();
        this.laserBeams.updateUniforms();
        if (item.rebuild) this.laserBeams.rebuildBeams();
      });
    });

    // Colors
    document.getElementById('ctrl-color1').addEventListener('input', (e) => {
      p.color1 = e.target.value;
      if (this.laserBeams.isMorphing) {
        this.laserBeams.morphTargetParams.color1 = e.target.value;
        this.laserBeams.morphStartParams.color1 = e.target.value;
        this.laserBeams.morphTargetC1.set(e.target.value);
        this.laserBeams.morphStartC1.set(e.target.value);
      }
      this.laserBeams.updateUniforms();
    });
    document.getElementById('ctrl-color2').addEventListener('input', (e) => {
      p.color2 = e.target.value;
      if (this.laserBeams.isMorphing) {
        this.laserBeams.morphTargetParams.color2 = e.target.value;
        this.laserBeams.morphStartParams.color2 = e.target.value;
        this.laserBeams.morphTargetC2.set(e.target.value);
        this.laserBeams.morphStartC2.set(e.target.value);
      }
      this.laserBeams.updateUniforms();
    });

    // Morphing Controls
    this.laserBeams.morphEnabled = true;
    this.laserBeams.morphDuration = 1.5;

    document.getElementById('chk-morph').addEventListener('change', (e) => {
      this.laserBeams.morphEnabled = e.target.checked;
    });

    document.getElementById('ctrl-morphDuration').addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.laserBeams.morphDuration = val;
      document.getElementById('val-morphDuration').textContent = val.toFixed(1);
    });

    // Checkboxes
    document.getElementById('chk-purecolor').addEventListener('change', (e) => {
      const val = e.target.checked ? 1.0 : 0.0;
      p.pureColor = val;
      if (this.laserBeams.isMorphing) {
        this.laserBeams.morphTargetParams.pureColor = val;
        this.laserBeams.morphStartParams.pureColor = val;
      }
      this.laserBeams.updateUniforms();
    });

    document.getElementById('chk-blackmode').addEventListener('change', (e) => {
      if (e.target.checked) {
        document.getElementById('chk-transparent').checked = false;
        this.laserEngine.setTransparent(false);
        this.laserEngine.scene.background = new THREE.Color(0x000000);
        this.laserEngine.gridHelper.visible = false;
      } else {
        this.laserEngine.scene.background = new THREE.Color(0x020208);
        this.laserEngine.gridHelper.visible = true;
      }
    });

    document.getElementById('chk-transparent').addEventListener('change', (e) => {
      if (e.target.checked) {
        document.getElementById('chk-blackmode').checked = false;
      }
      this.laserEngine.setTransparent(e.target.checked);
    });

    document.getElementById('chk-stagelights').addEventListener('change', (e) => {
      this.stageLights.setVisible(e.target.checked);
    });

    document.getElementById('chk-audio').addEventListener('change', async (e) => {
      if (e.target.checked) {
        await this.audioAnalyzer.startMic();
      } else {
        this.audioAnalyzer.stopMic();
      }
    });

    // Save Custom Preset Button
    document.getElementById('btn-save-custom-preset').addEventListener('click', () => {
      const nameInput = document.getElementById('input-preset-name');
      const hotkeyInput = document.getElementById('input-preset-hotkey');

      const name = nameInput.value.trim();
      const hotkey = hotkeyInput.value.trim();

      const newPreset = this.presetManager.saveCustomPreset(name, hotkey);
      nameInput.value = '';
      hotkeyInput.value = '';

      this.updateCustomPresetsUI();
    });

    // Initial render of custom presets list
    this.updateCustomPresetsUI();

    // Hide UI button
    document.getElementById('btn-toggle-ui').addEventListener('click', () => {
      this.toggleUI();
    });
  }

  updateCustomPresetsUI() {
    const listContainer = document.getElementById('custom-presets-list');
    const optGroup = document.getElementById('optgroup-custom-presets');

    const customPresets = this.presetManager.getCustomPresets();

    // Update Dropdown optgroup
    if (optGroup) {
      optGroup.innerHTML = customPresets.map(p => 
        `<option value="${p.id}">⭐ ${p.name} ${p.hotkey ? `[Key: ${p.hotkey.toUpperCase()}]` : ''}</option>`
      ).join('');
    }

    // Update Custom Presets List Cards
    if (listContainer) {
      if (customPresets.length === 0) {
        listContainer.innerHTML = `
          <div class="empty-preset-msg">No custom presets saved yet. Adjust effects & save one above!</div>
        `;
        return;
      }

      listContainer.innerHTML = customPresets.map((p, idx) => `
        <div class="custom-preset-card" data-id="${p.id}">
          <div class="card-row-top">
            <input type="text" class="card-input-name" data-id="${p.id}" value="${p.name}" placeholder="Preset Name">
            <div class="hotkey-bind-box">
              <span class="hotkey-label">Key:</span>
              <input type="text" class="card-input-key" data-id="${p.id}" value="${p.hotkey ? p.hotkey.toUpperCase() : ''}" placeholder="Key" maxlength="5">
            </div>
          </div>
          <div class="card-row-actions">
            <button class="btn-card-action btn-load" data-id="${p.id}" title="Load onto Stage">▶ Load</button>
            <button class="btn-card-action btn-overwrite" data-id="${p.id}" title="Overwrite with Current Stage Effect">🔄 Save Current</button>
            <button class="btn-card-action btn-move" data-id="${p.id}" data-dir="-1" ${idx === 0 ? 'disabled' : ''} title="Move Up">⬆</button>
            <button class="btn-card-action btn-move" data-id="${p.id}" data-dir="1" ${idx === customPresets.length - 1 ? 'disabled' : ''} title="Move Down">⬇</button>
            <button class="btn-card-action btn-delete" data-id="${p.id}" title="Delete Preset">🗑 Remove</button>
          </div>
        </div>
      `).join('');

      // Add item event listeners
      listContainer.querySelectorAll('.btn-load').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const id = e.target.getAttribute('data-id');
          this.presetManager.loadCustomPreset(id);
          this.syncControlsFromParams();
        });
      });

      listContainer.querySelectorAll('.btn-overwrite').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const id = e.target.getAttribute('data-id');
          this.presetManager.updatePresetDetails(id, null, undefined, true);
          this.updateCustomPresetsUI();
        });
      });

      listContainer.querySelectorAll('.card-input-name').forEach(input => {
        input.addEventListener('change', (e) => {
          const id = e.target.getAttribute('data-id');
          this.presetManager.updatePresetDetails(id, e.target.value, undefined, false);
          this.updateCustomPresetsUI();
        });
      });

      listContainer.querySelectorAll('.card-input-key').forEach(input => {
        input.addEventListener('change', (e) => {
          const id = e.target.getAttribute('data-id');
          this.presetManager.updatePresetDetails(id, null, e.target.value, false);
          this.updateCustomPresetsUI();
        });
      });

      listContainer.querySelectorAll('.btn-move').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const id = e.target.getAttribute('data-id');
          const dir = parseInt(e.target.getAttribute('data-dir'));
          this.presetManager.movePreset(id, dir);
          this.updateCustomPresetsUI();
        });
      });

      listContainer.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const id = e.target.getAttribute('data-id');
          this.presetManager.deleteCustomPreset(id);
          this.updateCustomPresetsUI();
        });
      });
    }
  }

  syncControlsFromParams() {
    const p = this.laserBeams.isMorphing ? this.laserBeams.morphTargetParams : this.laserBeams.params;

    document.getElementById('ctrl-beamType').value = p.beamType;
    document.getElementById('ctrl-beamCount').value = p.beamCount;
    document.getElementById('val-beamCount').textContent = p.beamCount;

    document.getElementById('ctrl-thickness').value = p.thickness;
    document.getElementById('val-thickness').textContent = p.thickness.toFixed(2);

    document.getElementById('ctrl-radius').value = p.radius;
    document.getElementById('val-radius').textContent = p.radius;

    document.getElementById('ctrl-color1').value = p.color1;
    document.getElementById('ctrl-color2').value = p.color2;

    document.getElementById('ctrl-rainbowSpeed').value = p.rainbowSpeed;
    document.getElementById('val-rainbowSpeed').textContent = p.rainbowSpeed.toFixed(1);

    document.getElementById('ctrl-intensity').value = p.intensity;
    document.getElementById('val-intensity').textContent = p.intensity.toFixed(2);

    const bloomElem = document.getElementById('ctrl-bloom');
    const bloomVal = document.getElementById('val-bloom');
    if (bloomElem && this.laserEngine.bloomPass) {
      bloomElem.value = this.laserEngine.bloomPass.strength;
      if (bloomVal) bloomVal.textContent = this.laserEngine.bloomPass.strength.toFixed(2);
    }

    document.getElementById('ctrl-strobeSpeed').value = p.strobeSpeed || 0;
    document.getElementById('val-strobeSpeed').textContent = (p.strobeSpeed || 0).toFixed(1);

    document.getElementById('chk-purecolor').checked = p.pureColor > 0.5;

    this.updatePresetBadge();
  }

  toggleUI() {
    this.visible = !this.visible;
    this.container.style.display = this.visible ? 'block' : 'none';
  }

  setUIVisible(visible) {
    this.visible = visible;
    this.container.style.display = visible ? 'block' : 'none';
  }

  setupHotkeys() {
    window.addEventListener('keydown', (e) => {
      // Avoid hotkeys when typing in text inputs or dropdowns
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      const pressedKey = e.key.toLowerCase();

      // First check if matching any Custom Saved Preset Hotkey!
      const customMatch = this.presetManager.findByHotkey(pressedKey);
      if (customMatch) {
        e.preventDefault();
        this.presetManager.loadCustomPreset(customMatch.id);
        this.syncControlsFromParams();
        return;
      }

      // Default system hotkeys
      if (e.key === 'h' || e.key === 'H') {
        this.toggleUI();
      } else if (e.key === 'l' || e.key === 'L') {
        const loopBtn = document.getElementById('btn-loop-custom');
        if (loopBtn) loopBtn.click();
      } else if (e.key === 'm' || e.key === 'M') {
        const chkMorph = document.getElementById('chk-morph');
        chkMorph.checked = !chkMorph.checked;
        chkMorph.dispatchEvent(new Event('change'));
      } else if (e.key === 'b' || e.key === 'B') {
        const chkBlack = document.getElementById('chk-blackmode');
        chkBlack.checked = !chkBlack.checked;
        chkBlack.dispatchEvent(new Event('change'));
      } else if (e.key === 'n' || e.key === 'N' || e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        this.randomizer.nextPreset();
        this.syncControlsFromParams();
      } else if (e.key === 'p' || e.key === 'P' || e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        this.randomizer.previousPreset();
        this.syncControlsFromParams();
      } else if (e.key === ' ') {
        e.preventDefault();
        this.randomizer.generateNextPreset();
        this.syncControlsFromParams();
      } else if (e.key === 't' || e.key === 'T') {
        const chk = document.getElementById('chk-transparent');
        chk.checked = !chk.checked;
        this.laserEngine.setTransparent(chk.checked);
      } else if (e.key >= '1' && e.key <= '8') {
        const keys = Object.keys(FACTORY_PRESETS);
        const index = parseInt(e.key) - 1;
        if (keys[index]) {
          document.getElementById('select-preset').value = keys[index];
          this.presetManager.loadPreset(keys[index]);
          this.syncControlsFromParams();
        }
      }
    });
  }
}
