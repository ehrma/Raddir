let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

function playTone(frequency: number, duration: number, volume = 0.15, type: OscillatorType = "sine"): void {
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, ctx.currentTime);
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration);
}

export function playJoinSound(): void {
  playTone(880, 0.12, 0.1);
  setTimeout(() => playTone(1100, 0.12, 0.1), 80);
}

export function playLeaveSound(): void {
  playTone(660, 0.12, 0.1);
  setTimeout(() => playTone(440, 0.15, 0.08), 80);
}

export function playMuteSound(): void {
  playTone(300, 0.08, 0.06);
}

export function playUnmuteSound(): void {
  playTone(500, 0.08, 0.06);
}
