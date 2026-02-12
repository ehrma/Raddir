export class VoiceActivityDetector {
  private analyser: AnalyserNode;
  private dataArray: Float32Array;
  private threshold: number;
  private speaking = false;
  private silenceFrames = 0;
  private speechFrames = 0;
  // ~1.5 seconds of silence before cutting off (at ~60 ticks/s)
  private readonly silenceDelay = 90;
  // Require 2 consecutive speech frames to trigger (prevents transient clicks)
  private readonly speechOnset = 2;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private onSpeakingChange?: (speaking: boolean) => void;

  constructor(audioContext: AudioContext, source: MediaStreamAudioSourceNode, threshold = -50) {
    this.threshold = threshold;
    this.analyser = audioContext.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.5;
    this.dataArray = new Float32Array(this.analyser.fftSize);
    source.connect(this.analyser);
  }

  start(callback: (speaking: boolean) => void): void {
    this.onSpeakingChange = callback;
    // Use setInterval instead of requestAnimationFrame so VAD keeps
    // running when the Electron window is unfocused or minimized
    this.intervalId = setInterval(this.tick, 16); // ~60 Hz
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.speaking) {
      this.speaking = false;
      this.onSpeakingChange?.(false);
    }
  }

  setThreshold(threshold: number): void {
    this.threshold = threshold;
    // Reset counters so a threshold change during speech doesn't
    // cause a false silence detection from stale frame counts
    this.silenceFrames = 0;
    this.speechFrames = 0;
  }

  private tick = (): void => {
    this.analyser.getFloatTimeDomainData(this.dataArray as any);

    let sum = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      sum += this.dataArray[i]! * this.dataArray[i]!;
    }
    const rms = Math.sqrt(sum / this.dataArray.length);
    const db = 20 * Math.log10(Math.max(rms, 1e-10));

    if (db > this.threshold) {
      this.silenceFrames = 0;
      this.speechFrames++;
      if (!this.speaking && this.speechFrames >= this.speechOnset) {
        this.speaking = true;
        this.onSpeakingChange?.(true);
      }
    } else {
      this.speechFrames = 0;
      this.silenceFrames++;
      if (this.speaking && this.silenceFrames > this.silenceDelay) {
        this.speaking = false;
        this.onSpeakingChange?.(false);
      }
    }
  };
}
