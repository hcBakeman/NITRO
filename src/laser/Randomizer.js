import * as THREE from 'three';

const PALETTES = [
  { name: 'Neon Green Diode', c1: '#00ff44', c2: '#00cc88' },
  { name: 'Sapphire & Cyan', c1: '#0088ff', c2: '#00f7ff' },
  { name: 'Crimson Inferno', c1: '#ff0033', c2: '#ff6600' },
  { name: 'Cyber Violet & Pink', c1: '#cc00ff', c2: '#ff00aa' },
  { name: 'Acid Gold & Emerald', c1: '#ffcc00', c2: '#00ff66' },
  { name: 'Electric Cyan & Magenta', c1: '#00ffff', c2: '#ff00ff' },
  { name: 'Ultraviolet Rave', c1: '#9900ff', c2: '#00ffff' },
  { name: 'Laser Diode Triad', c1: '#00ff00', c2: '#ff0000' }
];

const BEAM_TYPES = ['lissajous', 'spirograph', 'tunnel', 'fan', 'cone', 'grid', 'starburst', 'wave'];

export class Randomizer {
  constructor(laserBeams, stageLights, atmosphere, laserEngine) {
    this.laserBeams = laserBeams;
    this.stageLights = stageLights;
    this.atmosphere = atmosphere;
    this.laserEngine = laserEngine;

    this.autoChaosActive = false;
    this.autoChaosInterval = 8.0; // Seconds between random shifts
    this.timer = 0;

    // Infinite Preset Queue & History System
    this.history = [];
    this.historyIndex = -1;

    // Generate initial seed preset
    this.generateNextPreset();
  }

  // Generate a procedural preset object
  createProceduralPreset() {
    const isRainbow = Math.random() < 0.25;
    const isStrobe = Math.random() < 0.35;
    const palette = PALETTES[Math.floor(Math.random() * PALETTES.length)];

    const id = Math.floor(Math.random() * 9000000) + 1000000; // 7-digit Preset ID

    return {
      id: id,
      name: `Preset #${id}`,
      beamType: BEAM_TYPES[Math.floor(Math.random() * BEAM_TYPES.length)],
      beamCount: Math.floor(THREE.MathUtils.randFloat(16, 120)),
      beamLength: THREE.MathUtils.randFloat(15, 35),
      thickness: THREE.MathUtils.randFloat(0.08, 0.22),
      radius: THREE.MathUtils.randFloat(3, 10),

      freqA: Math.floor(THREE.MathUtils.randFloat(1, 9)),
      freqB: Math.floor(THREE.MathUtils.randFloat(1, 9)),
      freqC: Math.floor(THREE.MathUtils.randFloat(1, 9)),
      phaseOffset: THREE.MathUtils.randFloat(0, Math.PI * 2),

      rotSpeedX: THREE.MathUtils.randFloat(-0.8, 0.8),
      rotSpeedY: THREE.MathUtils.randFloat(-0.8, 0.8),
      rotSpeedZ: THREE.MathUtils.randFloat(-0.5, 0.5),
      sweepSpeed: THREE.MathUtils.randFloat(0.0, 1.2),
      sweepAngle: THREE.MathUtils.randFloat(0.2, 1.2),
      wobbleFreq: THREE.MathUtils.randFloat(2.0, 15.0),
      wobbleAmp: Math.random() > 0.4 ? THREE.MathUtils.randFloat(0.1, 0.8) : 0.0,
      spiral: Math.random() > 0.6 ? THREE.MathUtils.randFloat(0.2, 1.5) : 0.0,

      color1: palette.c1,
      color2: palette.c2,
      colorBlend: THREE.MathUtils.randFloat(0.2, 1.0),
      rainbowSpeed: isRainbow ? THREE.MathUtils.randFloat(0.5, 2.5) : 0.0,
      intensity: THREE.MathUtils.randFloat(0.9, 1.5),

      strobeSpeed: isStrobe ? THREE.MathUtils.randFloat(1.0, 8.0) : 0.0,
      strobeDuty: THREE.MathUtils.randFloat(0.2, 0.7),

      patternSize: THREE.MathUtils.randFloat(0.6, 1.8),
      bloomStrength: THREE.MathUtils.randFloat(0.4, 1.3)
    };
  }

  applyPreset(preset) {
    const targetBloom = preset.bloomStrength !== undefined ? preset.bloomStrength : (preset.bloom !== undefined ? preset.bloom : 0.85);
    if (this.laserEngine && this.laserEngine.bloomPass) {
      this.laserEngine.setBloomParameters(targetBloom, 0.3, 0.2);
    }

    if (preset.patternSize !== undefined) {
      this.laserBeams.params.patternSize = preset.patternSize;
    }

    if (this.laserBeams.morphEnabled) {
      this.laserBeams.startMorph(preset, this.laserBeams.morphDuration || 1.5);
    } else {
      Object.assign(this.laserBeams.params, preset);
      this.laserBeams.updateUniforms();
      this.laserBeams.rebuildBeams();
    }
  }

  generateNextPreset() {
    const preset = this.createProceduralPreset();
    // Truncate history if we navigated backwards before generating new
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }
    this.history.push(preset);
    this.historyIndex = this.history.length - 1;
    this.applyPreset(preset);
    return preset;
  }

  nextPreset() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      const preset = this.history[this.historyIndex];
      this.applyPreset(preset);
      return preset;
    } else {
      return this.generateNextPreset();
    }
  }

  previousPreset() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      const preset = this.history[this.historyIndex];
      this.applyPreset(preset);
      return preset;
    }
    return this.getCurrentPreset();
  }

  getCurrentPreset() {
    return this.history[this.historyIndex] || null;
  }

  randomizeAll() {
    return this.generateNextPreset();
  }

  setAutoChaos(enabled, intervalSeconds = 8) {
    this.autoChaosActive = enabled;
    this.autoChaosInterval = intervalSeconds;
    this.timer = 0;
    if (enabled) {
      this.autoMorphCustomActive = false;
    }
  }

  setAutoMorphCustom(enabled, intervalSeconds = 6, presetManager = null) {
    this.autoMorphCustomActive = enabled;
    this.autoMorphCustomInterval = intervalSeconds;
    if (presetManager) this.presetManagerRef = presetManager;
    this.customTimer = 0;
    this.customIndex = 0;
    if (enabled) {
      this.autoChaosActive = false;
    }
  }

  update(delta) {
    if (this.autoChaosActive) {
      this.timer += delta;
      if (this.timer >= this.autoChaosInterval) {
        this.timer = 0;
        this.generateNextPreset();
      }
    } else if (this.autoMorphCustomActive && this.presetManagerRef) {
      this.customTimer += delta;
      if (this.customTimer >= this.autoMorphCustomInterval) {
        this.customTimer = 0;
        const customList = this.presetManagerRef.getCustomPresets();
        if (customList.length > 0) {
          this.customIndex = (this.customIndex + 1) % customList.length;
          const target = customList[this.customIndex];
          this.presetManagerRef.loadCustomPreset(target.id);
        }
      }
    }
  }
}
