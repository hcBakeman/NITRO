import * as THREE from 'three';

export class StageLights {
  constructor(scene) {
    this.scene = scene;
    this.lightGroup = new THREE.Group();
    this.scene.add(this.lightGroup);

    this.enabled = true;
    this.spotlights = [];
    this.spotCount = 6;

    this.params = {
      speed: 1.0,
      color1: 0x00ffff,
      color2: 0xff00aa,
      intensity: 3.5,
      angle: 0.4
    };

    this.initLights();
  }

  dispose() {
    for (const item of this.spotlights) {
      if (item.cone) {
        if (item.cone.geometry) item.cone.geometry.dispose();
        if (item.cone.material) item.cone.material.dispose();
      }
      if (item.target) this.scene.remove(item.target);
      if (item.spot && item.spot.dispose) item.spot.dispose();
    }
    this.spotlights = [];
    while (this.lightGroup.children.length > 0) {
      this.lightGroup.remove(this.lightGroup.children[0]);
    }
    this.scene.remove(this.lightGroup);
  }

  initLights() {
    // Clear old lights
    for (const item of this.spotlights) {
      if (item.cone) {
        if (item.cone.geometry) item.cone.geometry.dispose();
        if (item.cone.material) item.cone.material.dispose();
      }
      if (item.target) {
        this.scene.remove(item.target);
      }
      if (item.spot) {
        if (item.spot.dispose) item.spot.dispose();
      }
    }
    while (this.lightGroup.children.length > 0) {
      this.lightGroup.remove(this.lightGroup.children[0]);
    }
    this.spotlights = [];

    const colors = [0x00ffff, 0xff00ff, 0xffff00, 0x00ffaa, 0xff0055, 0x7700ff];

    for (let i = 0; i < this.spotCount; i++) {
      const color = colors[i % colors.length];
      
      // Spotlight
      const spot = new THREE.SpotLight(color, this.params.intensity);
      spot.angle = this.params.angle;
      spot.penumbra = 0.8;
      spot.decay = 1.5;
      spot.distance = 40;

      // Position moving heads along rear stage truss
      const posX = (i - (this.spotCount - 1) / 2) * 5;
      spot.position.set(posX, 8, -6);

      // Target
      const target = new THREE.Object3D();
      target.position.set(posX, -4, 5);
      this.scene.add(target);
      spot.target = target;

      // Volumetric Beam Mesh Cone
      const coneGeom = new THREE.ConeGeometry(3, 16, 16, 1, true);
      coneGeom.translate(0, -8, 0); // Origin at top tip

      const coneMat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      });

      const coneMesh = new THREE.Mesh(coneGeom, coneMat);
      spot.add(coneMesh);

      this.lightGroup.add(spot);

      this.spotlights.push({
        spot: spot,
        target: target,
        cone: coneMesh,
        baseX: posX,
        phase: i * (Math.PI / 3)
      });
    }
  }

  setVisible(visible) {
    this.enabled = visible;
    this.lightGroup.visible = visible;
  }

  update(delta, elapsedSeconds) {
    if (!this.enabled) return;

    for (let i = 0; i < this.spotlights.length; i++) {
      const item = this.spotlights[i];
      const speed = this.params.speed;
      const t = elapsedSeconds * speed + item.phase;

      // Sweep target in dynamic figure-8 pattern across stage
      item.target.position.x = item.baseX + Math.sin(t * 1.5) * 6;
      item.target.position.z = Math.cos(t * 2.0) * 8;
      item.target.position.y = -3 + Math.sin(t * 3.0) * 2;

      // Orient volumetric cone mesh towards target
      item.cone.lookAt(item.target.position);
      item.cone.rotateX(Math.PI / 2);
    }
  }
}
