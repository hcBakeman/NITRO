import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export class LaserEngine {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    
    // Performance & state settings
    this.targetFps = 60;
    this.fps = 60;
    this.frameCount = 0;
    this.lastTime = performance.now();
    this.isTransparent = false;

    // 1. Scene Setup
    this.scene = new THREE.Scene();
    
    // 2. Camera Setup
    this.camera = new THREE.PerspectiveCamera(60, this.width / this.height, 0.1, 1000);
    this.camera.position.set(0, 4, 18);
    this.camera.lookAt(0, 2, 0);

    // 3. WebGL Renderer with High-DPI & Anti-Aliasing
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(this.width, this.height);
    // Ramp up pixel ratio to native hardware DPR (up to 3x Retina/4K sharp resolution)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // 4. Post-processing Composer (Volumetric Laser Bloom with Multi-Sample Anti-Aliasing)
    const renderTarget = new THREE.WebGLRenderTarget(
      this.width * this.renderer.getPixelRatio(),
      this.height * this.renderer.getPixelRatio(),
      {
        samples: 8, // 8x Multisample anti-aliasing for smooth subpixel laser edges
        type: THREE.HalfFloatType
      }
    );
    this.composer = new EffectComposer(this.renderer, renderTarget);
    
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    // Balanced Bloom Pass for rich saturated laser colors
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this.width * this.renderer.getPixelRatio(), this.height * this.renderer.getPixelRatio()),
      0.85, // Strength (soft, rich glow instead of blinding white blowout)
      0.3,  // Radius
      0.2   // Threshold
    );
    this.composer.addPass(this.bloomPass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    // Lighting
    this.ambientLight = new THREE.AmbientLight(0x111122, 0.5);
    this.scene.add(this.ambientLight);

    // Listeners
    this._resizeHandler = () => this.onResize();
    window.addEventListener('resize', this._resizeHandler);
  }

  setTransparent(transparent) {
    this.isTransparent = transparent;
    if (transparent) {
      this.renderer.setClearColor(0x000000, 0);
      this.scene.background = null;
    } else {
      this.renderer.setClearColor(0x020208, 1);
      this.scene.background = new THREE.Color(0x020208);
    }
  }

  setBloomParameters(strength, radius, threshold) {
    this.bloomPass.strength = strength;
    this.bloomPass.radius = radius;
    this.bloomPass.threshold = threshold;
  }

  onResize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();

    const dpr = Math.min(window.devicePixelRatio, 3);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.width, this.height);
    this.composer.setSize(this.width, this.height);
    this.bloomPass.setSize(this.width * dpr, this.height * dpr);
  }

  render(updateCallback) {
    const loop = (currentTime) => {
      requestAnimationFrame(loop);

      const delta = (currentTime - this.lastTime) / 1000;
      this.lastTime = currentTime;

      // Calculate FPS
      this.frameCount++;
      if (this.frameCount % 30 === 0) {
        this.fps = Math.round(1 / Math.max(delta, 0.001));
      }

      // Update callbacks
      if (updateCallback) {
        updateCallback(delta, currentTime * 0.001);
      }

      // Render frame via composer
      this.composer.render();
    };

    requestAnimationFrame(loop);
  }

  dispose() {
    window.removeEventListener('resize', this._resizeHandler);
    
    if (this.gridHelper) {
      this.gridHelper.geometry.dispose();
      this.gridHelper.material.dispose();
    }
    
    this.composer.passes.forEach(pass => {
      if (pass.dispose) pass.dispose();
    });
    
    this.renderPass = null;
    this.bloomPass = null;
    this.outputPass = null;
    
    if (this.composer.renderTarget1) this.composer.renderTarget1.dispose();
    if (this.composer.renderTarget2) this.composer.renderTarget2.dispose();
    
    this.renderer.dispose();
  }
}
