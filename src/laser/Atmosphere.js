import * as THREE from 'three';

export class Atmosphere {
  constructor(scene) {
    this.scene = scene;
    this.fogParticles = null;
    this.particleCount = 500;
    this.enabled = true;

    this.initFog();
  }

  initFog() {
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(this.particleCount * 3);
    const sizes = new Float32Array(this.particleCount);
    const opacities = new Float32Array(this.particleCount);

    for (let i = 0; i < this.particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 40;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 20 + 2;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 40;

      sizes[i] = Math.random() * 2.5 + 0.5;
      opacities[i] = Math.random() * 0.4 + 0.1;
    }

    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    // Particle Haze Material
    const mat = new THREE.PointsMaterial({
      color: 0x88ccff,
      size: 1.2,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.fogParticles = new THREE.Points(geom, mat);
    this.scene.add(this.fogParticles);
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
