import * as THREE from 'three';

export class Atmosphere {
  constructor(scene) {
    this.scene = scene;
    this.fogParticles = null;
    this.particleCount = 500;
    this.enabled = true;

    this.initFog();
  }

  createSoftParticleTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.2, 'rgba(200, 240, 255, 0.8)');
    grad.addColorStop(0.5, 'rgba(100, 180, 255, 0.25)');
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  initFog() {
    this.particleCount = 1200;
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(this.particleCount * 3);

    for (let i = 0; i < this.particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 50;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 25 + 2;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 50;
    }

    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Particle Haze Material with soft circular texture map
    this.particleTexture = this.createSoftParticleTexture();
    const mat = new THREE.PointsMaterial({
      color: 0x99ddff,
      size: 0.35,
      map: this.particleTexture,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.fogParticles = new THREE.Points(geom, mat);
    this.scene.add(this.fogParticles);
  }

  dispose() {
    if (this.particleTexture) {
      this.particleTexture.dispose();
      this.particleTexture = null;
    }
    if (this.fogParticles) {
      if (this.fogParticles.geometry) this.fogParticles.geometry.dispose();
      if (this.fogParticles.material) this.fogParticles.material.dispose();
      this.scene.remove(this.fogParticles);
      this.fogParticles = null;
    }
  }

  setDensity(density) {
    if (this.fogParticles) {
      this.fogParticles.material.opacity = density * 0.4;
      this.fogParticles.visible = density > 0.01;
    }
  }

  update(delta, elapsedSeconds) {
    if (!this.fogParticles || !this.enabled) return;

    const positions = this.fogParticles.geometry.attributes.position.array;
    for (let i = 0; i < this.particleCount; i++) {
      // Slow turbulent drift
      positions[i * 3 + 1] += Math.sin(elapsedSeconds + i) * 0.01;
      positions[i * 3] += Math.cos(elapsedSeconds * 0.5 + i) * 0.008;

      // Wrap around bounds
      if (positions[i * 3 + 1] > 15) positions[i * 3 + 1] = -5;
      if (positions[i * 3 + 1] < -5) positions[i * 3 + 1] = 15;
    }

    this.fogParticles.geometry.attributes.position.needsUpdate = true;
    this.fogParticles.rotation.y = elapsedSeconds * 0.02;
  }
}
