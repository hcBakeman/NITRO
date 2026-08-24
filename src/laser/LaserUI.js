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
          <span class="laser-dot"></span> VOLUMETRIC LASER STUDIO
          <button id="btn-copy-url-hdr" class="btn-copy-url-hdr" title="Copy Full 100% Exact Preset URL to Clipboard">📋 COPY URL</button>
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
        <div class="ui-bar ui-bar-4">
          <button id="btn-randomize" class="btn-primary" title="Generate New Preset (Space)">🎲 RANDOMIZE</button>
          <button id="btn-chaos" class="btn-secondary" title="Auto-Morph Random Presets">⚡ Auto-Chaos</button>
          <button id="btn-loop-custom" class="btn-playlist" title="Auto-Morph My Saved Presets (Hotkey: L)">🔁 Loop My Presets [L]</button>
          <button id="btn-copy-url" class="btn-copy-url" title="Copy Direct OBS / Preset URL to Clipboard">📋 Copy URL</button>
        </div>

        <!-- Shareable Preset URL Bar -->
        <div class="ui-url-share-box">
          <span class="url-share-label">🔗 Share / OBS URL:</span>
          <input type="text" id="input-share-url" readonly class="ui-input-share-url" title="Click to copy full preset URL">
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
          <button id="btn-toggle-saved-list" class="btn-toggle-sub" title="Click to expand/collapse saved preset cards list">📁 View / Edit Saved Preset Cards (<span id="saved-count-badge">0</span>) <span id="saved-list-arrow">▼</span></button>

          <!-- List of Custom Presets (Collapsed by default to keep UI clean) -->
          <div id="custom-presets-list" class="custom-presets-container collapsed">
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
            <input type="range" id="ctrl-beamCount" min="4" max="128" step="4" value="64">
          </div>
          <div class="ui-row">
            <label>Thickness (<span id="val-thickness">0.12</span>)</label>
            <input type="range" id="ctrl-thickness" min="0.04" max="0.30" step="0.01" value="0.12">
          </div>
          <div class="ui-row">
            <label>Pattern Radius (<span id="val-radius">6</span>)</label>
            <input type="range" id="ctrl-radius" min="2" max="15" step="0.5" value="6">
          </div>
          <div class="ui-row">
            <label>Overall Pattern Size (<span id="val-patternSize">1.0</span>x)</label>
            <input type="range" id="ctrl-patternSize" min="0.2" max="3.0" step="0.1" value="1.0">
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
        </div>

        <div class="ui-section">
          <div class="section-title">⚡ Motion, Sweep & Strobe</div>
          <div class="ui-row">
            <label>3D Rotation Speed (<span id="val-rotSpeedY">0.3</span>)</label>
            <input type="range" id="ctrl-rotSpeedY" min="-3.0" max="3.0" step="0.1" value="0.3">
          </div>
          <div class="ui-row">
            <label>Sweep Pan Speed (<span id="val-sweepSpeed">0.5</span>)</label>
            <input type="range" id="ctrl-sweepSpeed" min="0" max="3.0" step="0.1" value="0.5">
          </div>
          <div class="ui-row">
            <label>Wobble Wave (<span id="val-wobbleAmp">0.3</span>)</label>
            <input type="range" id="ctrl-wobbleAmp" min="0" max="1.5" step="0.05" value="0.3">
          </div>
          <div class="ui-row">
            <label>Spiral Twist (<span id="val-spiral">0.0</span>)</label>
            <input type="range" id="ctrl-spiral" min="0" max="3.0" step="0.1" value="0">
          </div>
          <div class="ui-row">
            <label>Strobe Flash Rate (<span id="val-strobeSpeed">0.0</span> Hz)</label>
            <input type="range" id="ctrl-strobeSpeed" min="0" max="20.0" step="0.5" value="0">
          </div>
          <div class="ui-row">
            <label>Strobe Duty Width (<span id="val-strobeDuty">0.5</span>)</label>
            <input type="range" id="ctrl-strobeDuty" min="0.05" max="0.95" step="0.05" value="0.5">
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
          <div class="section-title">💡 Moving Head Stage Lights</div>
          <div class="ui-row-check">
            <label><input type="checkbox" id="chk-stagelights" checked> 💡 Moving Head Spotlights ON / OFF</label>
          </div>
          <div class="ui-row">
            <label>Spotlight Glow Brightness (<span id="val-spotOpacity">0.15</span>)</label>
            <input type="range" id="ctrl-spotOpacity" min="0.0" max="0.6" step="0.02" value="0.15">
          </div>
          <div class="ui-row">
            <label>Moving Head Sweep Speed (<span id="val-spotSpeed">1.0</span>)</label>
            <input type="range" id="ctrl-spotSpeed" min="0.0" max="3.0" step="0.1" value="1.0">
          </div>
        </div>

        <div class="ui-section">
          <div class="section-title">🖥️ Stage Background & OBS Settings</div>
          <div class="ui-row-check">
            <label><input type="checkbox" id="chk-blackmode"> 🖤 Pure Black Void Background [Hotkey: B]</label>
          </div>
          <div class="ui-row-check">
            <label><input type="checkbox" id="chk-transparent"> 🏁 Transparent Overlay Mode (OBS)</label>
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

  getShareableURL() {
    try {
      const url = new URL(window.location.href);
      const p = this.laserBeams.params;

      const currentPreset = this.randomizer.getCurrentPreset();
      if (currentPreset && (currentPreset.key || currentPreset.id)) {
        url.searchParams.set('preset', currentPreset.key || currentPreset.id);
      }

      // Explicit human-readable parameters
      url.searchParams.set('bt', p.beamType);
      url.searchParams.set('bc', p.beamCount);
      url.searchParams.set('th', p.thickness.toFixed(3));
      url.searchParams.set('rad', p.radius.toFixed(2));
      url.searchParams.set('ps', (p.patternSize || 1.0).toFixed(2));
      url.searchParams.set('c1', p.color1.replace('#', ''));
      url.searchParams.set('c2', p.color2.replace('#', ''));
      url.searchParams.set('int', p.intensity.toFixed(2));
      url.searchParams.set('bm', (this.laserEngine.bloomPass ? this.laserEngine.bloomPass.strength : 0.85).toFixed(2));
      url.searchParams.set('ry', (p.rotSpeedY || 0).toFixed(2));
      url.searchParams.set('sw', (p.sweepSpeed || 0).toFixed(2));
      url.searchParams.set('wa', (p.wobbleAmp || 0).toFixed(2));
      url.searchParams.set('sp', (p.spiral || 0).toFixed(2));
      url.searchParams.set('ss', (p.strobeSpeed || 0).toFixed(2));
      url.searchParams.set('sd', (p.strobeDuty || 0.5).toFixed(2));
      url.searchParams.set('spots', this.stageLights.enabled ? '1' : '0');

      const state = {
        bt: p.beamType,
        bc: p.beamCount,
        bl: p.beamLength || 25,
        th: Number(p.thickness.toFixed(3)),
        rad: Number(p.radius.toFixed(2)),
        ps: Number((p.patternSize || 1.0).toFixed(2)),
        fa: p.freqA || 3,
        fb: p.freqB || 4,
        fc: p.freqC || 5,
        po: p.phaseOffset !== undefined ? Number(p.phaseOffset.toFixed(2)) : 1.57,
        rx: Number((p.rotSpeedX || 0).toFixed(2)),
        ry: Number((p.rotSpeedY || 0).toFixed(2)),
        rz: Number((p.rotSpeedZ || 0).toFixed(2)),
        sw: Number((p.sweepSpeed || 0).toFixed(2)),
        sa: Number((p.sweepAngle || 0.8).toFixed(2)),
        wf: Number((p.wobbleFreq || 0).toFixed(2)),
        wa: Number((p.wobbleAmp || 0).toFixed(2)),
        sp: Number((p.spiral || 0).toFixed(2)),
        c1: p.color1.replace('#', ''),
        c2: p.color2.replace('#', ''),
        cb: Number((p.colorBlend || 0.8).toFixed(2)),
        rs: Number((p.rainbowSpeed || 0).toFixed(2)),
        int: Number(p.intensity.toFixed(2)),
        ss: Number((p.strobeSpeed || 0).toFixed(2)),
        sd: Number((p.strobeDuty || 0.5).toFixed(2)),
        pc: p.pureColor > 0.5 ? 1 : 0,
        bm: Number((this.laserEngine.bloomPass ? this.laserEngine.bloomPass.strength : 0.85).toFixed(2)),
        fd: Number((this.atmosphere ? this.atmosphere.fogParticles?.material?.opacity * 2.5 : 0.5).toFixed(2)),
        spots: this.stageLights.enabled ? 1 : 0,
        so: Number((this.stageLights.params.opacity || 0.15).toFixed(2)),
        spSpeed: Number((this.stageLights.params.speed || 1.0).toFixed(2))
      };

      const base64Str = btoa(JSON.stringify(state));
      url.searchParams.set('cfg', base64Str);

      const isBlack = document.getElementById('chk-blackmode')?.checked;
      const isTrans = document.getElementById('chk-transparent')?.checked;

      if (isBlack) url.searchParams.set('mode', 'black');
      else url.searchParams.delete('mode');

      if (isTrans) url.searchParams.set('bg', 'transparent');
      else url.searchParams.delete('bg');

      // OBS Overlay mode: automatically hide menu UI on scene load
      url.searchParams.set('ui', '0');

      return url.toString();
    } catch (e) {
      return window.location.href;
    }
  }

  updateShareableURLInput() {
    const shareInput = document.getElementById('input-share-url');
    if (shareInput) {
      shareInput.value = this.getShareableURL();
    }
  }

  copyURLToClipboard() {
    const urlStr = this.getShareableURL();
    navigator.clipboard.writeText(urlStr).then(() => {
      this.showToast('✅ Preset URL Copied to Clipboard!');
    }).catch(() => {
      const input = document.getElementById('input-share-url');
      if (input) {
        input.select();
        document.execCommand('copy');
        this.showToast('✅ Preset URL Copied to Clipboard!');
      }
    });
  }

  showToast(message) {
    let toast = document.getElementById('ui-toast-msg');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'ui-toast-msg';
      toast.className = 'ui-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2500);
  }

  updatePresetBadge() {
    const current = this.randomizer.getCurrentPreset();
    const badge = document.getElementById('preset-id-badge');
    const counter = document.getElementById('preset-counter-badge');
    const selectElem = document.getElementById('select-preset');

    if (current && badge && counter) {
      const presetName = current.name || `Preset #${current.id}`;
      badge.textContent = presetName;
      const total = this.randomizer.history.length;
      const idx = this.randomizer.historyIndex + 1;
      counter.textContent = `(${idx} of ${total})`;

      if (selectElem) {
        let randOpt = selectElem.querySelector('option[value="current_random"]');
        if (!randOpt) {
          randOpt = document.createElement('option');
          randOpt.value = 'current_random';
          selectElem.insertBefore(randOpt, selectElem.firstChild);
        }
        randOpt.textContent = `🎲 ${presetName}`;
        selectElem.value = current.key || 'current_random';
      }
    }
    this.updateShareableURLInput();
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

    // Copy URL button listeners (Header and Bar)
    const copyUrlBtn = document.getElementById('btn-copy-url');
    const copyUrlHdrBtn = document.getElementById('btn-copy-url-hdr');
    const shareInput = document.getElementById('input-share-url');

    if (copyUrlBtn) copyUrlBtn.addEventListener('click', () => this.copyURLToClipboard());
    if (copyUrlHdrBtn) copyUrlHdrBtn.addEventListener('click', () => this.copyURLToClipboard());
    if (shareInput) shareInput.addEventListener('click', () => this.copyURLToClipboard());

    // Moving Head Spotlight Controls
    const spotOpacityElem = document.getElementById('ctrl-spotOpacity');
    const spotOpacityVal = document.getElementById('val-spotOpacity');
    if (spotOpacityElem) {
      spotOpacityElem.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.stageLights.setOpacity(val);
        if (spotOpacityVal) spotOpacityVal.textContent = val.toFixed(2);
      });
    }

    const spotSpeedElem = document.getElementById('ctrl-spotSpeed');
    const spotSpeedVal = document.getElementById('val-spotSpeed');
    if (spotSpeedElem) {
      spotSpeedElem.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.stageLights.setSpeed(val);
        if (spotSpeedVal) spotSpeedVal.textContent = val.toFixed(1);
      });
    }

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
      this.laserBeams.params.beamType = e.target.value;
      if (this.laserBeams.isMorphing) {
        this.laserBeams.morphTargetParams.beamType = e.target.value;
        this.laserBeams.morphStartParams.beamType = e.target.value;
      }
      this.laserBeams.rebuildBeams();
      this.updateShareableURLInput();
    });

    // Sliders
    const sliders = [
      { id: 'beamCount', param: 'beamCount', isInt: true, rebuild: true },
      { id: 'thickness', param: 'thickness', isInt: false, rebuild: true },
      { id: 'radius', param: 'radius', isInt: false, rebuild: true },
      { id: 'patternSize', param: 'patternSize', isInt: false, rebuild: false },
      { id: 'rainbowSpeed', param: 'rainbowSpeed', isInt: false, rebuild: false },
      { id: 'intensity', param: 'intensity', isInt: false, rebuild: false },
      { id: 'rotSpeedY', param: 'rotSpeedY', isInt: false, rebuild: false },
      { id: 'sweepSpeed', param: 'sweepSpeed', isInt: false, rebuild: false },
      { id: 'wobbleAmp', param: 'wobbleAmp', isInt: false, rebuild: false },
      { id: 'spiral', param: 'spiral', isInt: false, rebuild: false },
      { id: 'strobeSpeed', param: 'strobeSpeed', isInt: false, rebuild: false },
      { id: 'strobeDuty', param: 'strobeDuty', isInt: false, rebuild: false }
    ];

    // Bloom Strength Slider listener
    const bloomElem = document.getElementById('ctrl-bloom');
    const bloomVal = document.getElementById('val-bloom');
    if (bloomElem) {
      bloomElem.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.laserEngine.setBloomParameters(val, 0.3, 0.2);
        if (bloomVal) bloomVal.textContent = val.toFixed(2);
        this.updateShareableURLInput();
      });
    }

    sliders.forEach(item => {
      const elem = document.getElementById(`ctrl-${item.id}`);
      const valElem = document.getElementById(`val-${item.id}`);
      elem.addEventListener('input', (e) => {
        const val = item.isInt ? parseInt(e.target.value) : parseFloat(e.target.value);
        this.laserBeams.params[item.param] = val;
        if (this.laserBeams.isMorphing) {
          this.laserBeams.morphTargetParams[item.param] = val;
          this.laserBeams.morphStartParams[item.param] = val;
        }
        if (valElem) valElem.textContent = val.toString();
        this.laserBeams.updateUniforms();
        if (item.rebuild) this.laserBeams.rebuildBeams();
        this.updateShareableURLInput();
      });
    });

    // Colors
    document.getElementById('ctrl-color1').addEventListener('input', (e) => {
      this.laserBeams.params.color1 = e.target.value;
      if (this.laserBeams.isMorphing) {
        this.laserBeams.morphTargetParams.color1 = e.target.value;
        this.laserBeams.morphStartParams.color1 = e.target.value;
        this.laserBeams.morphTargetC1.set(e.target.value);
        this.laserBeams.morphStartC1.set(e.target.value);
      }
      this.laserBeams.updateUniforms();
      this.updateShareableURLInput();
    });
    document.getElementById('ctrl-color2').addEventListener('input', (e) => {
      this.laserBeams.params.color2 = e.target.value;
      if (this.laserBeams.isMorphing) {
        this.laserBeams.morphTargetParams.color2 = e.target.value;
        this.laserBeams.morphStartParams.color2 = e.target.value;
        this.laserBeams.morphTargetC2.set(e.target.value);
        this.laserBeams.morphStartC2.set(e.target.value);
      }
      this.laserBeams.updateUniforms();
      this.updateShareableURLInput();
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

    // Prevent wheel scrolling from being intercepted by canvas or OrbitControls
    this.container.addEventListener('wheel', (e) => {
      e.stopPropagation();
    }, { passive: true });

    // Collapsible Saved Presets Cards Toggle
    const toggleSavedBtn = document.getElementById('btn-toggle-saved-list');
    const savedListElem = document.getElementById('custom-presets-list');
    const savedArrowElem = document.getElementById('saved-list-arrow');
    if (toggleSavedBtn && savedListElem) {
      toggleSavedBtn.addEventListener('click', () => {
        const isCollapsed = savedListElem.classList.toggle('collapsed');
        if (savedArrowElem) savedArrowElem.textContent = isCollapsed ? '▼' : '▲';
      });
    }

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
      this.updateShareableURLInput();
    });

    document.getElementById('chk-transparent').addEventListener('change', (e) => {
      if (e.target.checked) {
        document.getElementById('chk-blackmode').checked = false;
      }
      this.laserEngine.setTransparent(e.target.checked);
      this.updateShareableURLInput();
    });

    document.getElementById('chk-stagelights').addEventListener('change', (e) => {
      this.stageLights.setUserDisabled(!e.target.checked);
      this.updateShareableURLInput();
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
    const countBadge = document.getElementById('saved-count-badge');

    const customPresets = this.presetManager.getCustomPresets();
    if (countBadge) countBadge.textContent = customPresets.length.toString();

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

    document.getElementById('ctrl-rotSpeedY').value = p.rotSpeedY !== undefined ? p.rotSpeedY : 0.3;
    document.getElementById('val-rotSpeedY').textContent = (p.rotSpeedY !== undefined ? p.rotSpeedY : 0.3).toFixed(1);

    document.getElementById('ctrl-sweepSpeed').value = p.sweepSpeed || 0;
    document.getElementById('val-sweepSpeed').textContent = (p.sweepSpeed || 0).toFixed(1);

    document.getElementById('ctrl-wobbleAmp').value = p.wobbleAmp || 0;
    document.getElementById('val-wobbleAmp').textContent = (p.wobbleAmp || 0).toFixed(2);

    document.getElementById('ctrl-spiral').value = p.spiral || 0;
    document.getElementById('val-spiral').textContent = (p.spiral || 0).toFixed(1);

    document.getElementById('ctrl-strobeSpeed').value = p.strobeSpeed || 0;
    document.getElementById('val-strobeSpeed').textContent = (p.strobeSpeed || 0).toFixed(1);

    const dutyElem = document.getElementById('ctrl-strobeDuty');
    const dutyVal = document.getElementById('val-strobeDuty');
    if (dutyElem) {
      const duty = p.strobeDuty !== undefined ? p.strobeDuty : 0.5;
      dutyElem.value = duty;
      if (dutyVal) dutyVal.textContent = duty.toFixed(2);
    }

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
