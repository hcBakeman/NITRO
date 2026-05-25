export const Profiler = {
  enabled: true,
  slowFrames: [],
  frameCount: 0,
  
  // A threshold above which a frame is considered "slow" and recorded
  // 16.6ms is 60fps. If it takes > 25ms, it means FPS drops below 40.
  SLOW_FRAME_THRESHOLD: 25, 
  MAX_RECORDS: 200,

  recordFrame(totalTime, dt, speed, breakdown) {
    if (!this.enabled) return;
    this.frameCount++;

    if (totalTime >= this.SLOW_FRAME_THRESHOLD) {
      if (this.slowFrames.length < this.MAX_RECORDS) {
        this.slowFrames.push({
          frame: this.frameCount,
          totalTime: parseFloat(totalTime.toFixed(2)),
          dt: parseFloat(dt.toFixed(4)),
          speed: parseFloat(speed.toFixed(1)),
          breakdown: {
            physics: parseFloat(breakdown.physics.toFixed(2)),
            logic: parseFloat(breakdown.logic.toFixed(2)),
            render: parseFloat(breakdown.render.toFixed(2)),
            audio: parseFloat(breakdown.audio.toFixed(2)),
            other: parseFloat(breakdown.other.toFixed(2)),
          }
        });
      }
    }
  },

  downloadLog() {
    if (this.slowFrames.length === 0) {
      alert("No slow frames detected! Performance was perfect.");
      return;
    }
    const dataStr = JSON.stringify(this.slowFrames, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nitro-profile-log.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
};
