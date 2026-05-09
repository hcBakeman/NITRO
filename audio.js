/**
 * audio.js – Procedural sound effects using ZzFX
 * ZzFX (c) KilledByAPixel (MIT)
 */

const zzfxV = 0.3;

// ZzFX micro core - fixed and optimized for Nitro Seed
function _getZzFXBuffer(p=1,k=.05,b=220,e=0,r=0,t=.1,q=0,D=1,u=0,y=0,v=0,z=0,l=0,A=0,m=0,B=0,C=0,n=1,h=0,F=0) {
  let M=Math,R=44100,d=2*M.PI,j=z*500*d/R/R,A2=A*d/R,n2=n*d/R,i=b*d*(1+k*M.random()-k/2)/R,c=0,g=0,w=0,f=1,a=0,L=0,S=0,Z=-1;
  let V=R*(e+r+t+q+D)|0,x=e*R|0,G=r*R|0,H=t*R|0,I=q*R|0,J=D*R|0,K=b*v,k2=b*u,b2=b*y;
  const samples = new Float32Array(V);
  for(let p2=0; p2<V; ++p2) {
    if(++a > V) break;
    if(++L > S) {
      L=0; S=100*M.random()|0;
      if (Z<0) { Z=1; i=b*d/R; j=z*500*d/R/R; A2=A*d/R; }
    }
    if(Z>0) {
      i+=j+=A2;
      if(k2&&++c>k2) { c=0; i+=n2; }
      if(b2&&++g>b2) { g=0; i+=(y*d/R); }
      if(K&&++w>K) { w=0; i+=(v*d/R); }
    }
    f=p2<x?p2/x:p2<x+G?1-((p2-x)/G)*(1-k):p2<x+G+H?k:p2<V-J?(V-p2-J)/I*k:0;
    f=f<0?0:f;
    samples[p2]=f*zzfxV*p*M.sin(i-S*M.sin(p2*n2));
  }
  const buffer = audioCtx.createBuffer(1, V, R);
  buffer.getChannelData(0).set(samples);
  return buffer;
}

const SOUNDS = {
  EXPLOSION:  [3.0, 0, 20, 0.1, 0.2, 1.5, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.3, 0.5, 0.2, 0], 
  ROCKET_LAUNCH: [2.5, 0, 50, 0.01, 0.05, 0.5, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.2, 1, 0.1, 0],
  SCREECH:    [1.0, 0, 450, .02, .12, .3, 3, 1.8, 15, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.05, 0],
  COLLECT:    [1.0, 0, 800, .01, .05, .1, 0, 1, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0.8, 0.05, 0],
  BOOST:      [1.5, 0, 200, .1, .1, .5, 2, .5, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0.8, 0.1, 0],
  POP:        [0.8, 0, 150, .01, .01, .08, 4, 2, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.05, 0],
  GEAR:       [2, 0, 80, .01, .02, .1, 4, 3.5, -15, 0, 0, 0, 0, 0, 0, 0, 0, 0.8, 0.02, 0],
  BEEP:       [1, 0, 800, .01, .05, .2, 1, .5, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0.8, 0.05, 0]
};

let audioCtx = null;
let engineOsc = null;
let engineGain = null;
let engineFilter = null;
const bufferCache = {};

export function init() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  
  // Pre-cache
  for (const key in SOUNDS) {
    bufferCache[key] = _getZzFXBuffer(...SOUNDS[key]);
  }

  // Engine
  engineOsc = audioCtx.createOscillator();
  engineOsc.type = 'sawtooth';
  engineFilter = audioCtx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineGain = audioCtx.createGain();
  engineGain.gain.value = 0;
  engineOsc.connect(engineFilter);
  engineFilter.connect(engineGain);
  engineGain.connect(audioCtx.destination);
  engineOsc.start();
}

function playBuffer(key) {
  init();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  if (!bufferCache[key]) return;
  const source = audioCtx.createBufferSource();
  source.buffer = bufferCache[key];
  source.connect(audioCtx.destination);
  source.start();
}

export function playExplosion() { playBuffer('EXPLOSION'); }
export function playRocketLaunch() { playBuffer('ROCKET_LAUNCH'); }
export function playCollect() { playBuffer('COLLECT'); }
export function playBoost() { playBuffer('BOOST'); }
export function playPop() { playBuffer('POP'); }
export function playGear() { playBuffer('GEAR'); }
export function playBeep() { playBuffer('BEEP'); }

export function setScreech(active) {
  // Screech is dynamic, but we'll stick to basic for now
}

let lastAccel = false;
let lastGearIdx = 0;
export function updateEngine(speed, isAccelerating) {
  init();
  if (audioCtx.state === 'suspended') audioCtx.resume();

  const kmh = speed * 3.6;
  
  // Gear-based RPM simulation
  let gearIdx = 1;
  let gearStart = 0;
  let gearEnd = 20;

  if (kmh > 70) {
    gearIdx = 4;
    gearStart = 70;
    gearEnd = 160;
  } else if (kmh > 40) {
    gearIdx = 3;
    gearStart = 40;
    gearEnd = 70;
  } else if (kmh > 20) {
    gearIdx = 2;
    gearStart = 20;
    gearEnd = 40;
  }

  // Calculate RPM progress within the current gear
  let rpmProgress = (kmh - gearStart) / (gearEnd - gearStart);
  rpmProgress = Math.max(0, Math.min(1.2, rpmProgress)); // Allow slight over-rev

  // Frequency range: 40Hz (idle/low) to 140Hz (high in gear)
  // Lowered for a deeper, more powerful engine sound
  const baseFreq = 40 + (gearIdx * 8); 
  const freq = baseFreq + (rpmProgress * 100);
  engineOsc.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.1);

  // Dynamic filter: open up the roar at high speeds, but cap it for comfort
  const filterFreq = 400 + (speed * 30);
  engineFilter.frequency.setTargetAtTime(Math.min(2500, filterFreq), audioCtx.currentTime, 0.2);

  // Gain (Idle vs Accel) - Further reduced for player comfort
  const targetGain = isAccelerating ? 0.042 : 0.008; 
  engineGain.gain.setTargetAtTime(targetGain, audioCtx.currentTime, 0.2);

  if (gearIdx > lastGearIdx && gearIdx <= 4) playGear();
  lastGearIdx = gearIdx;
  lastAccel = isAccelerating;
}
