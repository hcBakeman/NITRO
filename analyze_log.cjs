const fs = require('fs');

const data = JSON.parse(fs.readFileSync('./state_hash_log.json', 'utf8'));

// Convert quaternion to Euler angles to get Roll
function getRoll(q) {
  // Roll (x-axis rotation)
  const sinr_cosp = 2 * (q.w * q.z + q.x * q.y); // Note: Jolt/Three.js mapping might differ, but let's approximate
  const cosr_cosp = 1 - 2 * (q.z * q.z + q.x * q.x);
  return Math.atan2(sinr_cosp, cosr_cosp);
}

// Find moments of high bouncing (suspension changes wildly) or high tilt
let lastSus = [0,0,0,0];
let events = [];

data.forEach((frame, i) => {
  if (!frame.debugData || !frame.debugData.wheels) return;
  
  const w = frame.debugData.wheels;
  const sus = w.map(wh => wh.suspension);
  
  let bounceDelta = 0;
  for (let j=0; j<4; j++) {
    bounceDelta += Math.abs(sus[j] - lastSus[j]);
  }
  
  // Calculate roll from 'quat'
  // Let's just look at the up vector (Y axis rotated by quat)
  // v = q * (0,1,0) * q^-1
  const qx = frame.quat.x, qy = frame.quat.y, qz = frame.quat.z, qw = frame.quat.w;
  const upY = qw*qw - qx*qx + qy*qy - qz*qz; // Y component of up vector
  const tilt = Math.acos(upY) * (180/Math.PI);
  
  if (bounceDelta > 0.5 || tilt > 30) {
     events.push({
       tick: frame.tick,
       speed: frame.speed,
       tilt,
       bounceDelta,
       input: frame.input,
       steer: frame.debugData.steer,
       wheels: w
     });
  }
  
  lastSus = sus;
});

console.log(`Found ${events.length} interesting frames out of ${data.length}`);

// Print the first few clustered events
let lastTick = -999;
let count = 0;
for (const e of events) {
  if (e.tick - lastTick > 60) {
    console.log('--- NEW EVENT ---');
    console.log(`Tick: ${e.tick}, Speed: ${e.speed.toFixed(1)} km/h, Tilt: ${e.tilt.toFixed(1)} deg, Bounce: ${e.bounceDelta.toFixed(3)}`);
    console.log(`Input: ${JSON.stringify(e.input)}, Steer: ${e.steer.toFixed(2)}`);
    console.log('Wheels Suspension:', e.wheels.map(w => w.suspension.toFixed(3)));
    console.log('Wheels Contact:', e.wheels.map(w => w.contact));
    count++;
    if (count > 5) break;
  }
  lastTick = e.tick;
}
