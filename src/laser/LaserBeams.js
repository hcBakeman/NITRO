import * as THREE from 'three';

// Custom GLSL Shader for glowing volumetric laser beams with bright white core & color falloff
const LaserShader = {
  vertexShader: `
    uniform float uTime;
    uniform float uWobbleFreq;
    uniform float uWobbleAmp;
    uniform float uSpiral;
    uniform float uAudioLevel;

    attribute float aSegment; // 0.0 at start of beam, 1.0 at tip
    attribute vec3 aOffset;   // Per-beam offset vector

    varying float vSegment;
    varying vec3 vWorldPosition;
    varying vec3 vNormal;

    void main() {
      vSegment = aSegment;
      vNormal = normalMatrix * normal;

      vec3 pos = position;

      // Apply spiral twist along beam length
      if (uSpiral > 0.001) {
        float angle = aSegment * uSpiral * 6.28318;
        float cosA = cos(angle);
        float sinA = sin(angle);
        float nx = pos.x * cosA - pos.y * sinA;
        float ny = pos.x * sinA + pos.y * cosA;
        pos.x = nx;
        pos.y = ny;
      }

      // Wobble wave along length
      if (uWobbleAmp > 0.001) {
        float wave = sin(uTime * uWobbleFreq + aSegment * 10.0 + aOffset.x) * uWobbleAmp;
        pos.x += wave * (1.0 + uAudioLevel * 0.5);
      }

      vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
      vWorldPosition = worldPosition.xyz;

      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `,
  fragmentShader: `
    uniform vec3 uColor1;
    uniform vec3 uColor2;
    uniform float uColorBlend;
    uniform float uTime;
    uniform float uStrobeSpeed;
    uniform float uStrobeDuty;
    uniform float uIntensity;
    uniform float uAudioLevel;
    uniform float uRainbowSpeed;
    uniform float uPureColor; // 1.0 = Pure saturated color (no white washout), 0.0 = white diode core

    varying float vSegment;
    varying vec3 vWorldPosition;
    varying vec3 vNormal;

    // HSL to RGB helper for rainbow mode
    vec3 hsl2rgb(vec3 c) {
      vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
      return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
    }

    void main() {
      // Fresnel core glow calculation (bright center line, soft edges)
      vec3 viewDir = normalize(cameraPosition - vWorldPosition);
      float fresnel = abs(dot(viewDir, normalize(vNormal)));
      float coreGlow = pow(fresnel, 2.2); // Core brightness intensity

      // Rhythmic 0% to 100% sharp square-wave strobing effect
      float strobe = 1.0;
      if (uStrobeSpeed > 0.01) {
        float pulse = fract(uTime * uStrobeSpeed);
        strobe = step(1.0 - clamp(uStrobeDuty, 0.05, 0.95), pulse);
      }

      // Color calculation
      vec3 finalColor = mix(uColor1, uColor2, vSegment * uColorBlend);
      
      // Rainbow cycling mode
      if (uRainbowSpeed > 0.01) {
        float hue = fract(uTime * uRainbowSpeed * 0.2 + vSegment * 0.5);
        finalColor = hsl2rgb(vec3(hue, 1.0, 0.5));
      }

      // Laser Core Color: Pure Vibrant Saturated Color vs Soft Diode Core
      vec3 whiteCoreColor = mix(finalColor * 1.3, vec3(1.15, 1.15, 1.15), coreGlow * 0.65);
      vec3 vibrantColor = finalColor * (1.0 + coreGlow * 0.8);
      
      vec3 laserCoreColor = mix(whiteCoreColor, vibrantColor, clamp(uPureColor, 0.0, 1.0));

      // Audio reactivity & Instant high-impact strobe blackout
      float effectiveIntensity = uIntensity * (1.0 + uAudioLevel * 0.6) * strobe;

      // Gradient fade along length
      float opacity = (0.3 + 0.7 * (1.0 - vSegment * 0.25)) * clamp(effectiveIntensity, 0.0, 2.0);
      float edgeAlpha = (1.0 - fresnel * 0.35);
      
      gl_FragColor = vec4(laserCoreColor * effectiveIntensity, clamp(opacity * edgeAlpha, 0.0, 1.0));
    }
  `
};

export class LaserBeams {
  constructor(scene) {
    this.scene = scene;
    this.beamGroup = new THREE.Group();
    this.scene.add(this.beamGroup);

    // Configuration parameters
    this.params = {
      beamType: 'lissajous', // 'lissajous', 'spirograph', 'tunnel', 'fan', 'cone', 'grid', 'starburst', 'wave'
      beamCount: 64,
      beamLength: 25,
      thickness: 0.12,
      radius: 6,
      
      // Shape parameters
      freqA: 3,
      freqB: 4,
      freqC: 5,
      phaseOffset: 1.57,
      
      // Motion & Transforms
      rotSpeedX: 0.2,
      rotSpeedY: 0.3,
      rotSpeedZ: 0.1,
      sweepSpeed: 0.5,
      sweepAngle: 0.8,
      wobbleFreq: 8.0,
      wobbleAmp: 0.3,
      spiral: 0.0,

      // Color & Lighting
      color1: '#00ffcc', // Primary laser color (hex)
      color2: '#ff007f', // Secondary laser color (hex)
      colorBlend: 0.8,
      rainbowSpeed: 0.0,
      intensity: 2.2,

      // Strobing & Audio & Pure Color
      strobeSpeed: 0.0,
      strobeDuty: 0.5,
      audioLevel: 0.0,
      pureColor: 1.0 // 1.0 = Pure saturated colors, 0.0 = White core diode
    };

    // Smooth Morphing Engine State
    this.morphEnabled = false;
    this.morphDuration = 1.5;
    this.isMorphing = false;

    // Shared Shader Material
    this.shaderMaterial = new THREE.ShaderMaterial({
      vertexShader: LaserShader.vertexShader,
      fragmentShader: LaserShader.fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uColor1: { value: new THREE.Color(this.params.color1) },
        uColor2: { value: new THREE.Color(this.params.color2) },
        uColorBlend: { value: this.params.colorBlend },
        uRainbowSpeed: { value: this.params.rainbowSpeed },
        uWobbleFreq: { value: this.params.wobbleFreq },
        uWobbleAmp: { value: this.params.wobbleAmp },
        uSpiral: { value: this.params.spiral },
        uStrobeSpeed: { value: this.params.strobeSpeed },
        uStrobeDuty: { value: this.params.strobeDuty },
        uIntensity: { value: this.params.intensity },
        uPureColor: { value: this.params.pureColor },
        uAudioLevel: { value: 0.0 }
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    this.rebuildBeams();
  }

  dispose() {
    this.clearBeams();
    if (this.shaderMaterial) {
      this.shaderMaterial.dispose();
    }
    this.scene.remove(this.beamGroup);
  }

  clearBeams() {
    while (this.beamGroup.children.length > 0) {
      const child = this.beamGroup.children[0];
      if (child.geometry) child.geometry.dispose();
      this.beamGroup.remove(child);
    }
  }

  updateUniforms() {
    this.shaderMaterial.uniforms.uColor1.value.set(this.params.color1);
    this.shaderMaterial.uniforms.uColor2.value.set(this.params.color2);
    this.shaderMaterial.uniforms.uColorBlend.value = this.params.colorBlend;
    this.shaderMaterial.uniforms.uRainbowSpeed.value = this.params.rainbowSpeed;
    this.shaderMaterial.uniforms.uWobbleFreq.value = this.params.wobbleFreq;
    this.shaderMaterial.uniforms.uWobbleAmp.value = this.params.wobbleAmp;
    this.shaderMaterial.uniforms.uSpiral.value = this.params.spiral;
    this.shaderMaterial.uniforms.uStrobeSpeed.value = this.params.strobeSpeed;
    this.shaderMaterial.uniforms.uStrobeDuty.value = this.params.strobeDuty;
    this.shaderMaterial.uniforms.uIntensity.value = this.params.intensity;
    this.shaderMaterial.uniforms.uPureColor.value = this.params.pureColor;
  }

  rebuildBeams() {
    // Clear old beam meshes
    this.clearBeams();

    const count = Math.max(4, Math.floor(this.params.beamCount));
    const length = this.params.beamLength;
    const thickness = this.params.thickness;
    const radius = this.params.radius;

    // Create high-resolution laser cylinders (32 radial segments, 64 height segments)
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const geom = new THREE.CylinderGeometry(thickness * 0.3, thickness, length, 32, 64, true);
      geom.translate(0, length / 2, 0); // Emitter origin at bottom

      // Add aSegment attribute along length (0 at emitter, 1 at tip)
      const posAttr = geom.attributes.position;
      const segmentArray = new Float32Array(posAttr.count);
      const offsetArray = new Float32Array(posAttr.count * 3);

      for (let j = 0; j < posAttr.count; j++) {
        segmentArray[j] = (posAttr.getY(j)) / length;
        offsetArray[j * 3] = i * 0.1;
        offsetArray[j * 3 + 1] = i * 0.2;
        offsetArray[j * 3 + 2] = i * 0.3;
      }
      geom.setAttribute('aSegment', new THREE.BufferAttribute(segmentArray, 1));
      geom.setAttribute('aOffset', new THREE.BufferAttribute(offsetArray, 3));

      const mesh = new THREE.Mesh(geom, this.shaderMaterial);
      this.positionLaserBeam(mesh, i, count, radius, t);
      this.beamGroup.add(mesh);
    }
  }

  positionLaserBeam(mesh, index, total, radius, t) {
    const type = this.params.beamType;
    const angle = t * Math.PI * 2;

    switch (type) {
      case 'lissajous': {
        const a = this.params.freqA;
        const b = this.params.freqB;
        const c = this.params.freqC;
        const delta = this.params.phaseOffset;

        const x = radius * Math.sin(a * angle + delta);
        const y = radius * 0.6 * Math.sin(b * angle);
        const z = radius * Math.cos(c * angle);

        mesh.position.set(x, y, z);
        mesh.lookAt(x * 2, y * 2 + 5, z * 2 + 10);
        break;
      }

      case 'spirograph': {
        const R = radius;
        const r = radius * 0.4;
        const p = radius * 0.6;
        const k = (R - r) / r;

        const x = (R - r) * Math.cos(angle) + p * Math.cos(k * angle);
        const y = (R - r) * Math.sin(angle) - p * Math.sin(k * angle);
        const z = Math.sin(angle * 3) * 2;

        mesh.position.set(x, y, z);
        mesh.rotation.x = Math.PI / 2 + (index * 0.05);
        mesh.rotation.z = angle;
        break;
      }

      case 'tunnel': {
        const ring = Math.floor(index / (total / 4));
        const ringRadius = radius * (0.3 + ring * 0.25);
        const ringAngle = (index % (total / 4)) / (total / 4) * Math.PI * 2;

        const x = Math.cos(ringAngle) * ringRadius;
        const y = Math.sin(ringAngle) * ringRadius;
        const z = -ring * 4;

        mesh.position.set(x, y, z);
        mesh.rotation.x = Math.PI / 2;
        mesh.rotation.z = ringAngle;
        break;
      }

      case 'fan': {
        const spread = (index - total / 2) / (total / 2);
        const x = spread * radius * 1.5;
        const y = -2;
        const z = 0;

        mesh.position.set(x, y, z);
        mesh.rotation.z = -spread * (this.params.sweepAngle || 0.8);
        mesh.rotation.x = 0.2;
        break;
      }

      case 'cone': {
        const x = Math.cos(angle) * radius * 0.2;
        const y = Math.sin(angle) * radius * 0.2;
        const z = 0;

        mesh.position.set(x, y, z);
        mesh.rotation.x = 0.4;
        mesh.rotation.y = angle;
        mesh.rotation.z = Math.PI / 4;
        break;
      }

      case 'grid': {
        const cols = Math.ceil(Math.sqrt(total));
        const row = Math.floor(index / cols);
        const col = index % cols;

        const x = (col - cols / 2) * (radius / cols * 2);
        const y = (row - cols / 2) * (radius / cols * 2);
        const z = 0;

        mesh.position.set(x, y, z);
        mesh.rotation.x = 0.3;
        break;
      }

      case 'starburst': {
        const phi = Math.acos(-1 + (2 * index) / total);
        const theta = Math.sqrt(total * Math.PI) * phi;

        const x = radius * 0.1 * Math.cos(theta) * Math.sin(phi);
        const y = radius * 0.1 * Math.sin(theta) * Math.sin(phi);
        const z = radius * 0.1 * Math.cos(phi);

        mesh.position.set(x, y, z);
        mesh.lookAt(x * 100, y * 100, z * 100);
        mesh.rotateX(Math.PI / 2);
        break;
      }

      case 'wave':
      default: {
        const spread = (index - total / 2) / (total / 2);
        const x = spread * radius * 2;
        const y = Math.sin(spread * Math.PI * 2) * 2;
        const z = Math.cos(spread * Math.PI * 2) * 2;

        mesh.position.set(x, y, z);
        mesh.rotation.x = 0.5;
        mesh.rotation.z = spread * 0.5;
        break;
      }
    }
  }

  setAudioLevel(level) {
    this.params.audioLevel = level;
    this.shaderMaterial.uniforms.uAudioLevel.value = level;
  }

  startMorph(targetParams, duration = 1.5) {
    if (!this.morphEnabled) {
      Object.assign(this.params, targetParams);
      this.updateUniforms();
      this.rebuildBeams();
      return;
    }

    this.isMorphing = true;
    this.morphProgress = 0.0;
    this.morphDuration = Math.max(0.2, duration);

    this.morphStartParams = { ...this.params };
    this.morphTargetParams = { ...this.params, ...targetParams };

    this.morphStartC1 = new THREE.Color(this.params.color1);
    this.morphStartC2 = new THREE.Color(this.params.color2);

    this.morphTargetC1 = new THREE.Color(this.morphTargetParams.color1);
    this.morphTargetC2 = new THREE.Color(this.morphTargetParams.color2);

    // Save current 3D positions and rotations for all beam meshes
    const children = this.beamGroup.children;
    this.morphStartTransforms = children.map(mesh => ({
      pos: mesh.position.clone(),
      rot: new THREE.Euler().copy(mesh.rotation)
    }));

    // Temporary param clone to compute target 3D positions without mutating this.params reference
    const tempParams = { ...this.params, ...targetParams };

    const count = children.length;
    this.morphTargetTransforms = [];
    const dummy = new THREE.Object3D();

    // Preserve active params while computing dummy target positions
    const activeBeamType = this.params.beamType;
    this.params.beamType = tempParams.beamType;

    for (let i = 0; i < count; i++) {
      const tRatio = i / count;
      dummy.position.set(0, 0, 0);
      dummy.rotation.set(0, 0, 0);
      this.positionLaserBeam(dummy, i, count, tempParams.radius || 6, tRatio);
      this.morphTargetTransforms.push({
        pos: dummy.position.clone(),
        rot: new THREE.Euler().copy(dummy.rotation)
      });
    }

    this.params.beamType = activeBeamType;
  }

  update(delta, elapsedSeconds) {
    this.shaderMaterial.uniforms.uTime.value = elapsedSeconds;

    // Handle Smooth Morphing Interpolation
    if (this.isMorphing) {
      this.morphProgress += delta / this.morphDuration;
      const rawT = Math.min(1.0, this.morphProgress);
      // Smooth easeInOutQuad curve
      const t = rawT < 0.5 ? 2 * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 2) / 2;

      const start = this.morphStartParams;
      const target = this.morphTargetParams;
      const p = this.params;

      // Lerp 3D mesh positions & rotations smoothly
      const children = this.beamGroup.children;
      for (let i = 0; i < children.length; i++) {
        const mesh = children[i];
        const sT = this.morphStartTransforms[i];
        const tT = this.morphTargetTransforms[i];

        if (sT && tT) {
          mesh.position.lerpVectors(sT.pos, tT.pos, t);
          mesh.rotation.x = THREE.MathUtils.lerp(sT.rot.x, tT.rot.x, t);
          mesh.rotation.y = THREE.MathUtils.lerp(sT.rot.y, tT.rot.y, t);
          mesh.rotation.z = THREE.MathUtils.lerp(sT.rot.z, tT.rot.z, t);
        }
      }

      // Lerp float params
      p.thickness = THREE.MathUtils.lerp(start.thickness, target.thickness, t);
      p.radius = THREE.MathUtils.lerp(start.radius, target.radius, t);
      p.rotSpeedX = THREE.MathUtils.lerp(start.rotSpeedX, target.rotSpeedX, t);
      p.rotSpeedY = THREE.MathUtils.lerp(start.rotSpeedY, target.rotSpeedY, t);
      p.rotSpeedZ = THREE.MathUtils.lerp(start.rotSpeedZ, target.rotSpeedZ, t);
      p.sweepSpeed = THREE.MathUtils.lerp(start.sweepSpeed || 0, target.sweepSpeed || 0, t);
      p.sweepAngle = THREE.MathUtils.lerp(start.sweepAngle || 0.8, target.sweepAngle || 0.8, t);
      p.wobbleFreq = THREE.MathUtils.lerp(start.wobbleFreq || 0, target.wobbleFreq || 0, t);
      p.wobbleAmp = THREE.MathUtils.lerp(start.wobbleAmp || 0, target.wobbleAmp || 0, t);
      p.spiral = THREE.MathUtils.lerp(start.spiral || 0, target.spiral || 0, t);
      p.intensity = THREE.MathUtils.lerp(start.intensity, target.intensity, t);
      p.strobeSpeed = THREE.MathUtils.lerp(start.strobeSpeed || 0, target.strobeSpeed || 0, t);
      p.strobeDuty = THREE.MathUtils.lerp(start.strobeDuty || 0.5, target.strobeDuty || 0.5, t);
      p.rainbowSpeed = THREE.MathUtils.lerp(start.rainbowSpeed || 0, target.rainbowSpeed || 0, t);
      p.pureColor = THREE.MathUtils.lerp(start.pureColor !== undefined ? start.pureColor : 1.0, target.pureColor !== undefined ? target.pureColor : 1.0, t);
      p.patternSize = THREE.MathUtils.lerp(start.patternSize || 1.0, target.patternSize || 1.0, t);

      // Lerp colors
      const curC1 = new THREE.Color().copy(this.morphStartC1).lerp(this.morphTargetC1, t);
      const curC2 = new THREE.Color().copy(this.morphStartC2).lerp(this.morphTargetC2, t);

      p.color1 = '#' + curC1.getHexString();
      p.color2 = '#' + curC2.getHexString();

      this.updateUniforms();

      if (rawT >= 1.0) {
        this.isMorphing = false;
        Object.assign(this.params, target);
        this.rebuildBeams();
      }
    } else {
      this.updateUniforms();
    }

    // Apply dynamic 3D scale/size multiplier
    const rawSz = this.params.patternSize;
    const sz = (typeof rawSz === 'number' && !isNaN(rawSz) && isFinite(rawSz) && rawSz > 0) ? Math.max(0.1, Math.min(5.0, rawSz)) : 1.0;
    this.beamGroup.scale.set(sz, sz, sz);

    // Apply dynamic 3D rotation of laser rig
    this.beamGroup.rotation.x += (this.params.rotSpeedX || 0) * delta * 2.0;
    this.beamGroup.rotation.y += (this.params.rotSpeedY || 0) * delta * 2.0;
    this.beamGroup.rotation.z += (this.params.rotSpeedZ || 0) * delta * 2.0;

    // Apply high-speed stage scanner sweep pan motion
    if (Math.abs(this.params.sweepSpeed || 0) > 0.01) {
      const sweepSpeed = this.params.sweepSpeed || 0.5;
      const sweepAngle = this.params.sweepAngle || 0.8;
      const sweepWave = Math.sin(elapsedSeconds * sweepSpeed * 2.5) * sweepAngle;
      
      this.beamGroup.rotation.z += sweepWave * 0.02;
      this.beamGroup.position.x = Math.sin(elapsedSeconds * sweepSpeed * 1.5) * 4.0;
    } else {
      this.beamGroup.position.x *= 0.95; // Smooth return to center when sweep is disabled
    }
  }
}
