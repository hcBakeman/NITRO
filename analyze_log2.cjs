const fs = require('fs');

const data = JSON.parse(fs.readFileSync('./state_hash_log.json', 'utf8'));

function getRoll(q) {
  const sinr_cosp = 2 * (q.w * q.z + q.x * q.y);
  const cosr_cosp = 1 - 2 * (q.z * q.z + q.x * q.x);
  return Math.atan2(sinr_cosp, cosr_cosp);
}

// Focus on tick 1141 - 1160 to see the bouncing
const startIdx = data.findIndex(f => f.tick >= 1141);
if (startIdx >= 0) {
  for (let i = startIdx; i < startIdx + 30; i++) {
    const f = data[i];
    if(!f) break;
    const q = f.quat;
    const upY = q.w*q.w - q.x*q.x + q.y*q.y - q.z*q.z;
    const tilt = Math.acos(upY) * (180/Math.PI);
    const sus = f.debugData.wheels.map(w => w.suspension.toFixed(3));
    const con = f.debugData.wheels.map(w => w.contact);
    console.log(`[Tick ${f.tick}] Tilt: ${tilt.toFixed(1)}deg, Sus: ${sus.join(',')}, Contact: ${con.map(c=>c?1:0).join('')}, Steer: ${f.debugData.steer.toFixed(2)}`);
  }
}
