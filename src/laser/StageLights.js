import * as THREE from 'three';

// Custom GLSL Shader for silky smooth volumetric stage spotlights with Gaussian radial edge fade
const StageSpotlightShader = {
  vertexShader: `
    attribute float aSegment; // 0.0 at top emitter, 1.0 at floor tip

    varying float vSegment;
    varying vec3 vWorldPosition;
    varying vec3 vNormal;

    void main() {
      vSegment = aSegment;
      vNormal = normalMatrix * normal;
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPosition.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `,
  fragmentShader: `
    uniform vec3 uColor;
    uniform float uOpacity;

    varying float vSegment;
    varying vec3 vWorldPosition;
    varying vec3 vNormal;

    void main() {
      vec3 viewDir = normalize(cameraPosition - vWorldPosition);
      float fresnel = abs(dot(viewDir, normalize(vNormal)));
      
      // Soft radial edge falloff (Gaussian smooth curve, eliminates hard flat polygon facets)
      float edgeFade = pow(fresnel, 2.0);

      // Fade along length (brightest at top lens fixture, soft fade towards bottom)
      float lengthFade = (1.0 - vSegment * 0.4) * smoothstep(0.0, 0.08, vSegment);

      float finalAlpha = edgeFade * lengthFade * uOpacity;
      vec3 finalRGB = uColor * (1.2 + fresnel * 0.8);

      gl_FragColor = vec4(finalRGB, clamp(finalAlpha, 0.0, 1.0));
    }
  `
};

export class StageLights {
  constructor(scene) {
    this.scene = scene;
    this.lightGroup = new THREE.Group();
    this.scene.add(this.lightGroup);

    this.enabled = false;
    this.userDisabled = true;
    this.spotlights = [];
    this.spotCount = 6;

    this.params = {
      speed: 1.0,
      opacity: 0.15,
      angle: 0.35,
      intensity: 2.5
    };

    this.initLights();
    this.lightGroup.visible = false;
  }

  dispose() {
    for (const item of this.spotlights) {
      if (item.coneGeom) item.coneGeom.dispose();
      if (item.shaderMat) item.shaderMat.dispose();
      if (item.lensGeom) item.lensGeom.dispose();
      if (item.lensMat) item.lensMat.dispose();
      if (item.target) this.scene.remove(item.target);
    }
    this.spotlights = [];
    while (this.lightGroup.children.length > 0) {
      this.lightGroup.remove(this.lightGroup.children[0]);
    }
    this.scene.remove(this.lightGroup);
  }

  initLights() {
    this.dispose();
    this.scene.add(this.lightGroup);

    const colors = [
      new THREE.Color(0x00ffff),
      new THREE.Color(0xff00cc),
      new THREE.Color(0xffff00),
      new THREE.Color(0x00ff88),
      new THREE.Color(0xff0055),
      new THREE.Color(0x9900ff)
    ];

    for (let i = 0; i < this.spotCount; i++) {
      const color = colors[i % colors.length];
      const posX = (i - (this.spotCount - 1) / 2) * 5.5;

      // Fixture Group
      const fixtureGroup = new THREE.Group();
      fixtureGroup.position.set(posX, 8.5, -6);

      // Target Object on stage floor
      const target = new THREE.Object3D();
      target.position.set(posX, -4, 5);
      this.scene.add(target);

      // High-Poly Volumetric Beam Cylinder/Cone (64 radial segments, 64 height segments)
      const beamLength = 22;
      const topRadius = 0.15;
      const bottomRadius = Math.tan(this.params.angle) * beamLength;
      
      const coneGeom = new THREE.CylinderGeometry(topRadius, bottomRadius, beamLength, 64, 64, true);
      coneGeom.translate(0, -beamLength / 2, 0); // Emitter origin at top

      // Attribute for length fade (0 at top, 1 at bottom)
      const posAttr = coneGeom.attributes.position;
      const segmentArray = new Float32Array(posAttr.count);
      for (let j = 0; j < posAttr.count; j++) {
        segmentArray[j] = Math.abs(posAttr.getY(j)) / beamLength;
      }
      coneGeom.setAttribute('aSegment', new THREE.BufferAttribute(segmentArray, 1));

      // Custom Volumetric Shader Material
      const shaderMat = new THREE.ShaderMaterial({
        vertexShader: StageSpotlightShader.vertexShader,
        fragmentShader: StageSpotlightShader.fragmentShader,
        uniforms: {
          uColor: { value: color.clone() },
          uOpacity: { value: this.params.opacity }
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      });

      const coneMesh = new THREE.Mesh(coneGeom, shaderMat);
      fixtureGroup.add(coneMesh);

      // Emitter Glowing Lens Orb at fixture head
      const lensGeom = new THREE.SphereGeometry(0.35, 32, 32);
      const lensMat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending
      });
      const lensMesh = new THREE.Mesh(lensGeom, lensMat);
      fixtureGroup.add(lensMesh);

      this.lightGroup.add(fixtureGroup);

      this.spotlights.push({
        group: fixtureGroup,
        target: target,
        coneMesh: coneMesh,
        coneGeom: coneGeom,
        shaderMat: shaderMat,
        lensGeom: lensGeom,
        lensMat: lensMat,
        baseX: posX,
        phase: i * (Math.PI / 3)
      });
    }
  }

  setVisible(visible) {
    if (this.userDisabled) {
      this.enabled = false;
      this.lightGroup.visible = false;
      return;
    }
    this.enabled = visible;
    this.lightGroup.visible = visible;
  }

  setUserDisabled(disabled) {
    this.userDisabled = disabled;
    if (disabled) {
      this.enabled = false;
      this.lightGroup.visible = false;
    } else {
      this.enabled = true;
      this.lightGroup.visible = true;
    }
  }

  setOpacity(opacity) {
    this.params.opacity = opacity;
    for (const item of this.spotlights) {
      if (item.shaderMat) item.shaderMat.uniforms.uOpacity.value = opacity;
    }
  }

  setSpeed(speed) {
    this.params.speed = speed;
  }

  update(delta, elapsedSeconds) {
    if (!this.enabled || !this.lightGroup.visible) return;

    for (let i = 0; i < this.spotlights.length; i++) {
      const item = this.spotlights[i];
      const speed = this.params.speed;
      const t = elapsedSeconds * speed + item.phase;

      // Sweep target in dynamic figure-8 pattern across stage
      item.target.position.x = item.baseX + Math.sin(t * 1.5) * 6.5;
      item.target.position.z = Math.cos(t * 2.0) * 8.0;
      item.target.position.y = -3 + Math.sin(t * 3.0) * 2.0;

      // Smooth orient moving head fixture towards target
      item.group.lookAt(item.target.position);
      item.group.rotateX(Math.PI / 2);
    }
  }
}
