export class AudioAnalyzer {
  constructor() {
    this.audioCtx = null;
    this.analyser = null;
    this.dataArray = null;
    this.isListening = false;
    this.volume = 0;
    this.bass = 0;
  }

  async startMic() {
    this.shouldListen = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (!this.shouldListen) {
        stream.getTracks().forEach(track => track.stop());
        return false;
      }
      this.stream = stream;
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = this.audioCtx.createMediaStreamSource(this.stream);
      
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      this.dataArray = new Uint8Array(bufferLength);
      this.isListening = true;
      return true;
    } catch (err) {
      console.warn('Audio mic capture unavailable or denied:', err);
      this.isListening = false;
      this.shouldListen = false;
      return false;
    }
  }

  stopMic() {
    this.shouldListen = false;
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    this.isListening = false;
  }

  update() {
    if (!this.isListening || !this.analyser) {
      this.volume = 0;
      this.bass = 0;
      return;
    }

    this.analyser.getByteFrequencyData(this.dataArray);
    
    // Calculate average volume across frequencies
    let sum = 0;
    let bassSum = 0;
    const bassBins = Math.floor(this.dataArray.length * 0.2);

    for (let i = 0; i < this.dataArray.length; i++) {
      sum += this.dataArray[i];
      if (i < bassBins) {
        bassSum += this.dataArray[i];
      }
    }

    this.volume = sum / (this.dataArray.length * 255);
    this.bass = bassSum / (bassBins * 255);
  }
}
