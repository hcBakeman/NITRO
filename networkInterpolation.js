import * as THREE from 'three';

// ── Configuration ──────────────────────────────────────────────────────
const SNAPSHOT_BUFFER_SIZE = 20;    // Keep last 20 snapshots per player (~1s at 20Hz)
const INTERPOLATION_DELAY = 100;    // ms — render this far in the past
const EXTRAPOLATION_LIMIT = 200;    // ms — max time to extrapolate before freezing

// ── Per-Player Snapshot Buffer ─────────────────────────────────────────
class SnapshotBuffer {
  constructor() {
    this.snapshots = new Array(SNAPSHOT_BUFFER_SIZE);
    this.writeIdx = 0;
    this.count = 0;
  }

  /**
   * Push a new snapshot into the ring buffer.
   */
  push(serverTick, px, py, pz, qx, qy, qz, qw, vx, vy, vz) {
    // Reject if we already have a newer or equal tick
    if (this.count > 0) {
      const lastIdx = (this.writeIdx - 1 + SNAPSHOT_BUFFER_SIZE) % SNAPSHOT_BUFFER_SIZE;
      if (this.snapshots[lastIdx] && this.snapshots[lastIdx].tick >= serverTick) {
        return; // Drop out-of-order packet
      }
    }

    this.snapshots[this.writeIdx] = {
      tick: serverTick,
      time: performance.now(), // local arrival time
      px, py, pz,
      qx, qy, qz, qw,
      vx, vy, vz,
    };
    this.writeIdx = (this.writeIdx + 1) % SNAPSHOT_BUFFER_SIZE;
    if (this.count < SNAPSHOT_BUFFER_SIZE) this.count++;
  }

  /**
   * Get all snapshots sorted by tick (ascending).
   */
  getSorted() {
    const result = [];
    for (let i = 0; i < this.count; i++) {
      const idx = (this.writeIdx - this.count + i + SNAPSHOT_BUFFER_SIZE) % SNAPSHOT_BUFFER_SIZE;
      result.push(this.snapshots[idx]);
    }
    return result;
  }

  /**
   * Find the two snapshots that bracket the given render time.
   * @param {number} renderTime - The target time: performance.now() - INTERPOLATION_DELAY
   * @returns {{ from: Object, to: Object, t: number } | null}
   */
  findBracket(renderTime) {
    const sorted = this.getSorted();
    if (sorted.length < 2) return null;

    // Find two snapshots where from.time <= renderTime <= to.time
    for (let i = 0; i < sorted.length - 1; i++) {
      const from = sorted[i];
      const to = sorted[i + 1];
      if (from.time <= renderTime && renderTime <= to.time) {
        const range = to.time - from.time;
        const t = range > 0 ? (renderTime - from.time) / range : 0;
        return { from, to, t: Math.max(0, Math.min(1, t)) };
      }
    }

    // If renderTime is past the latest snapshot → extrapolate from last two
    const latest = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2];
    const timeSinceLast = renderTime - latest.time;

    if (timeSinceLast > 0 && timeSinceLast < EXTRAPOLATION_LIMIT) {
      const range = latest.time - prev.time;
      const t = range > 0 ? 1.0 + (timeSinceLast / range) : 1.0;
      return { from: prev, to: latest, t: Math.min(t, 2.0) }; // Cap extrapolation at 2x
    }

    // Too old or too far ahead — return latest snapshot as-is
    return { from: latest, to: latest, t: 0 };
  }
}

// ── Interpolation Manager ──────────────────────────────────────────────
const _buffers = new Map(); // playerId → SnapshotBuffer

// Reusable THREE.js objects for slerp
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qResult = new THREE.Quaternion();

/**
 * Push a received snapshot into the buffer for a player.
 */
export function pushSnapshot(playerId, serverTick, px, py, pz, qx, qy, qz, qw, vx, vy, vz) {
  if (!_buffers.has(playerId)) {
    _buffers.set(playerId, new SnapshotBuffer());
  }
  _buffers.get(playerId).push(serverTick, px, py, pz, qx, qy, qz, qw, vx, vy, vz);
}

/**
 * Get interpolated state for a player at the current render time.
 * @param {string} playerId
 * @returns {{ pos: {x,y,z}, quat: {x,y,z,w}, vel: {x,y,z} } | null}
 */
export function getInterpolatedState(playerId) {
  const buffer = _buffers.get(playerId);
  if (!buffer) return null;

  const renderTime = performance.now() - INTERPOLATION_DELAY;
  const bracket = buffer.findBracket(renderTime);
  if (!bracket) return null;

  const { from, to, t } = bracket;

  // Linearly interpolate position
  const pos = {
    x: from.px + (to.px - from.px) * t,
    y: from.py + (to.py - from.py) * t,
    z: from.pz + (to.pz - from.pz) * t,
  };

  // Spherical interpolation for quaternion
  _qa.set(from.qx, from.qy, from.qz, from.qw);
  _qb.set(to.qx, to.qy, to.qz, to.qw);
  _qResult.copy(_qa).slerp(_qb, Math.max(0, Math.min(1, t)));
  const quat = { x: _qResult.x, y: _qResult.y, z: _qResult.z, w: _qResult.w };

  // Interpolate velocity (for physics sync)
  const vel = {
    x: from.vx + (to.vx - from.vx) * t,
    y: from.vy + (to.vy - from.vy) * t,
    z: from.vz + (to.vz - from.vz) * t,
  };

  return { pos, quat, vel };
}

/**
 * Remove a player's buffer (on disconnect).
 */
export function removeBuffer(playerId) {
  _buffers.delete(playerId);
}

/**
 * Clear all buffers (on return to lobby).
 */
export function clearAll() {
  _buffers.clear();
}
