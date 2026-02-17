import { useState, useEffect, useRef, useCallback } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import { getLiveAudioContext, getLiveStream } from "../../hooks/useAudio";
import { Volume2, Mic, AudioLines, Activity } from "lucide-react";

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={`w-10 h-5 rounded-full transition-colors ${enabled ? "bg-accent" : "bg-surface-700"}`}
    >
      <div className={`w-4 h-4 rounded-full bg-white transition-transform ${enabled ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );
}

const MIN_METER_DB = -60;
const MAX_METER_DB = 0;
const METER_ATTACK = 0.32;
const METER_HOLD_MS = 280;
const METER_DECAY_DB_PER_TICK = 0.12;

function clampMeterDb(value: number): number {
  return Math.max(MIN_METER_DB, Math.min(MAX_METER_DB, value));
}

function meterDbToPct(value: number): number {
  return Math.max(0, Math.min(100, ((clampMeterDb(value) - MIN_METER_DB) / (MAX_METER_DB - MIN_METER_DB)) * 100));
}

function suggestVadThresholdFromNoisePeak(noisePeakDb: number): number | null {
  if (!Number.isFinite(noisePeakDb)) return null;
  // Keep VA 3 dB below measured noise peak (more negative in dBFS)
  // so it is less strict and easier to trigger.
  const suggested = clampMeterDb(noisePeakDb - 3);
  return Math.round(suggested);
}

export function AudioSettings() {
  const {
    inputDeviceId, outputDeviceId, voiceActivation, vadThreshold,
    noiseSuppression, echoCancellation, autoGainControl, outputVolume,
    setInputDeviceId, setOutputDeviceId, setVoiceActivation, setVadThreshold,
    setNoiseSuppression, setEchoCancellation, setAutoGainControl, setOutputVolume,
  } = useSettingsStore();

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then(setDevices).catch(console.error);
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refresh);
    function refresh() {
      navigator.mediaDevices.enumerateDevices().then(setDevices).catch(console.error);
    }
  }, []);

  const inputs = devices.filter((d) => d.kind === "audioinput");
  const outputs = devices.filter((d) => d.kind === "audiooutput");

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold text-surface-200">Devices</h3>

      <div>
        <label className="flex items-center gap-1.5 text-xs text-surface-400 mb-1.5">
          <Mic className="w-3.5 h-3.5" /> Input Device
        </label>
        <select
          value={inputDeviceId}
          onChange={(e) => setInputDeviceId(e.target.value)}
          className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-100 focus:outline-none focus:border-accent"
        >
          <option value="default">System Default</option>
          {inputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${d.deviceId.slice(0, 8)}`}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="flex items-center gap-1.5 text-xs text-surface-400 mb-1.5">
          <Volume2 className="w-3.5 h-3.5" /> Output Device
        </label>
        <select
          value={outputDeviceId}
          onChange={(e) => setOutputDeviceId(e.target.value)}
          className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-100 focus:outline-none focus:border-accent"
        >
          <option value="default">System Default</option>
          {outputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>{d.label || `Speaker ${d.deviceId.slice(0, 8)}`}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs text-surface-400 mb-1.5 block">
          Output Volume: {Math.round(outputVolume * 100)}%
        </label>
        <input
          type="range"
          min="0"
          max="200"
          value={Math.round(outputVolume * 100)}
          onChange={(e) => setOutputVolume(parseInt(e.target.value) / 100)}
          className="w-full accent-accent"
        />
      </div>

      <hr className="border-surface-800" />
      <h3 className="text-sm font-semibold text-surface-200 flex items-center gap-1.5">
        <AudioLines className="w-4 h-4 text-accent" /> Voice Processing
      </h3>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-surface-300">Noise Suppression</p>
            <p className="text-[10px] text-surface-500">Reduces background noise like fans, typing, and AC</p>
          </div>
          <Toggle enabled={noiseSuppression} onChange={setNoiseSuppression} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-surface-300">Echo Cancellation</p>
            <p className="text-[10px] text-surface-500">Removes echo from speakers bleeding into your mic</p>
          </div>
          <Toggle enabled={echoCancellation} onChange={setEchoCancellation} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-surface-300">Auto Gain Control</p>
            <p className="text-[10px] text-surface-500">Automatically normalizes your microphone volume</p>
          </div>
          <Toggle enabled={autoGainControl} onChange={setAutoGainControl} />
        </div>
      </div>

      <hr className="border-surface-800" />
      <h3 className="text-sm font-semibold text-surface-200">Voice Activation</h3>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-surface-300">Enable Voice Activation</p>
          <p className="text-[10px] text-surface-500">Transmit when you speak instead of push-to-talk</p>
        </div>
        <Toggle enabled={voiceActivation} onChange={setVoiceActivation} />
      </div>

      {voiceActivation && (
        <div>
          <label className="text-xs text-surface-400 mb-1.5 block">
            VAD Threshold: {vadThreshold} dB
          </label>
          <input
            type="range"
            min="-60"
            max="-10"
            value={vadThreshold}
            onChange={(e) => setVadThreshold(parseInt(e.target.value))}
            className="w-full accent-accent"
          />
        </div>
      )}

      <hr className="border-surface-800" />
      <h3 className="text-sm font-semibold text-surface-200 flex items-center gap-1.5">
        <Activity className="w-4 h-4 text-accent" /> Mic Test
      </h3>
      <MicTest />
    </div>
  );
}

function MicTest() {
  const inputDeviceId = useSettingsStore((s) => s.inputDeviceId);
  const noiseSuppression = useSettingsStore((s) => s.noiseSuppression);
  const echoCancellation = useSettingsStore((s) => s.echoCancellation);
  const autoGainControl = useSettingsStore((s) => s.autoGainControl);
  const voiceActivation = useSettingsStore((s) => s.voiceActivation);
  const vadThreshold = useSettingsStore((s) => s.vadThreshold);
  const setVadThreshold = useSettingsStore((s) => s.setVadThreshold);
  const [testing, setTesting] = useState(false);
  const [levelDb, setLevelDb] = useState(-Infinity);
  const [peakDb, setPeakDb] = useState(-Infinity);
  const [noiseFloorDb, setNoiseFloorDb] = useState(-Infinity);
  const [noiseCeilingDb, setNoiseCeilingDb] = useState(-Infinity);
  const [suggestedThreshold, setSuggestedThreshold] = useState<number | null>(null);
  const [relayEnabled, setRelayEnabled] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  // All mutable state lives in a single ref to survive React StrictMode
  // remounts without accidentally killing the live audio pipeline
  const stateRef = useRef<{
    interval: ReturnType<typeof setInterval> | null;
    ownStream: MediaStream | null;
    ownCtx: AudioContext | null;
    activeCtx: AudioContext | null;
    source: MediaStreamAudioSourceNode | null;
    analyser: AnalyserNode | null;
    relayGain: GainNode | null;
    smoothedDb: number;
    meterHoldUntil: number;
    peakDb: number;
    noiseFloorDb: number;
    noiseCeilingDb: number;
    speakingForMeter: boolean;
    lastUiUpdate: number;
  }>({
    interval: null,
    ownStream: null,
    ownCtx: null,
    activeCtx: null,
    source: null,
    analyser: null,
    relayGain: null,
    smoothedDb: -Infinity,
    meterHoldUntil: 0,
    peakDb: -Infinity,
    noiseFloorDb: -Infinity,
    noiseCeilingDb: -Infinity,
    speakingForMeter: false,
    lastUiUpdate: 0,
  });

  const applyRelayRouting = useCallback(() => {
    const { source, activeCtx, relayGain } = stateRef.current;
    if (!source || !activeCtx) return;

    if (relayEnabled) {
      if (!relayGain) {
        const gain = activeCtx.createGain();
        gain.gain.value = 0.85;
        source.connect(gain);
        gain.connect(activeCtx.destination);
        stateRef.current.relayGain = gain;
      }
      return;
    }

    if (relayGain) {
      try {
        source.disconnect(relayGain);
      } catch {}
      try {
        relayGain.disconnect();
      } catch {}
      stateRef.current.relayGain = null;
    }
  }, [relayEnabled]);

  const startTest = useCallback(async () => {
    // Already running — don't start a second one
    if (stateRef.current.interval) return;

    setRelayEnabled(false);
    setLevelDb(-Infinity);
    setPeakDb(-Infinity);
    setNoiseFloorDb(-Infinity);
    setNoiseCeilingDb(-Infinity);
    setSuggestedThreshold(null);
    setSpeaking(false);

    try {
      // Reuse the live audio context & stream if already in a voice channel
      // to avoid a second getUserMedia which starves the mic on Windows
      let ctx = getLiveAudioContext();
      let stream = getLiveStream();

      if (!ctx || !stream) {
        // Not in a channel — create our own
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: inputDeviceId !== "default" ? { exact: inputDeviceId } : undefined,
            echoCancellation,
            noiseSuppression,
            autoGainControl,
            sampleRate: 48000,
            channelCount: 1,
          },
        });
        ctx = new AudioContext({ sampleRate: 48000 });
        if (ctx.state === "suspended") await ctx.resume();
        ctx.addEventListener("statechange", () => {
          if (ctx!.state === "suspended") ctx!.resume().catch(() => {});
        });
        stateRef.current.ownStream = stream;
        stateRef.current.ownCtx = ctx;
      }

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);

      stateRef.current.activeCtx = ctx;
      stateRef.current.source = source;
      stateRef.current.analyser = analyser;
      stateRef.current.smoothedDb = -Infinity;
      stateRef.current.meterHoldUntil = 0;
      stateRef.current.peakDb = -Infinity;
      stateRef.current.noiseFloorDb = -Infinity;
      stateRef.current.noiseCeilingDb = -Infinity;
      stateRef.current.speakingForMeter = false;

      const dataArray = new Float32Array(analyser.fftSize);

      stateRef.current.interval = setInterval(() => {
        if (ctx!.state !== "running") return;
        analyser.getFloatTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const rawDb = rms > 0 ? 20 * Math.log10(rms) : -100;
        const clampedDb = clampMeterDb(rawDb);
        const now = performance.now();

        const prevSmoothed = stateRef.current.smoothedDb;
        let meterDb = Number.isFinite(prevSmoothed) ? prevSmoothed : clampedDb;
        if (clampedDb >= meterDb) {
          meterDb = meterDb + (clampedDb - meterDb) * METER_ATTACK;
          stateRef.current.meterHoldUntil = now + METER_HOLD_MS;
        } else if (now < stateRef.current.meterHoldUntil) {
          meterDb = meterDb;
        } else {
          meterDb = Math.max(clampedDb, meterDb - METER_DECAY_DB_PER_TICK);
        }
        stateRef.current.smoothedDb = meterDb;

        const threshold = useSettingsStore.getState().vadThreshold;
        const wasSpeaking = stateRef.current.speakingForMeter;
        const speakingNow = wasSpeaking
          ? meterDb > threshold - 2
          : meterDb > threshold + 2;
        stateRef.current.speakingForMeter = speakingNow;

        const nextPeak = Number.isFinite(stateRef.current.peakDb)
          ? Math.max(stateRef.current.peakDb, meterDb)
          : meterDb;

        const prevNoise = stateRef.current.noiseFloorDb;
        let nextNoise = prevNoise;
        if (!speakingNow) {
          nextNoise = Number.isFinite(prevNoise)
            ? prevNoise + (meterDb - prevNoise) * (meterDb < prevNoise ? 0.25 : 0.02)
            : meterDb;
        } else if (Number.isFinite(prevNoise)) {
          nextNoise = Math.max(MIN_METER_DB, prevNoise - 0.01);
        }

        const prevNoiseCeiling = stateRef.current.noiseCeilingDb;
        let nextNoiseCeiling = prevNoiseCeiling;
        if (!speakingNow) {
          nextNoiseCeiling = Number.isFinite(prevNoiseCeiling)
            ? Math.max(prevNoiseCeiling, meterDb)
            : meterDb;
        }

        stateRef.current.peakDb = nextPeak;
        stateRef.current.noiseFloorDb = nextNoise;
        stateRef.current.noiseCeilingDb = nextNoiseCeiling;

        const thresholdSuggestion = suggestVadThresholdFromNoisePeak(nextNoiseCeiling);

        if (relayEnabled && stateRef.current.relayGain && stateRef.current.activeCtx) {
          const targetGain = speakingNow ? 0.85 : 0;
          stateRef.current.relayGain.gain.setTargetAtTime(
            targetGain,
            stateRef.current.activeCtx.currentTime,
            speakingNow ? 0.02 : 0.08,
          );
        }

        if (now - stateRef.current.lastUiUpdate > 50) {
          stateRef.current.lastUiUpdate = now;
          setLevelDb(meterDb);
          setPeakDb(nextPeak);
          setNoiseFloorDb(nextNoise);
          setNoiseCeilingDb(nextNoiseCeiling);
          setSuggestedThreshold(thresholdSuggestion);
          setSpeaking(speakingNow);
        }
      }, 16);

      setTesting(true);
    } catch (err) {
      console.error("[mic-test] Failed to start:", err);
    }
  }, [inputDeviceId, echoCancellation, noiseSuppression, autoGainControl, relayEnabled]);

  const stopTest = useCallback(() => {
    if (stateRef.current.interval !== null) {
      clearInterval(stateRef.current.interval);
      stateRef.current.interval = null;
    }

    if (stateRef.current.relayGain && stateRef.current.source) {
      try {
        stateRef.current.source.disconnect(stateRef.current.relayGain);
      } catch {}
      try {
        stateRef.current.relayGain.disconnect();
      } catch {}
    }
    stateRef.current.relayGain = null;

    if (stateRef.current.source) {
      try {
        stateRef.current.source.disconnect();
      } catch {}
      stateRef.current.source = null;
    }
    if (stateRef.current.analyser) {
      try {
        stateRef.current.analyser.disconnect();
      } catch {}
      stateRef.current.analyser = null;
    }
    stateRef.current.activeCtx = null;

    // Only stop resources we own (never the live channel's stream/context)
    if (stateRef.current.ownStream) {
      for (const track of stateRef.current.ownStream.getTracks()) track.stop();
      stateRef.current.ownStream = null;
    }
    if (stateRef.current.ownCtx) {
      stateRef.current.ownCtx.close().catch(() => {});
      stateRef.current.ownCtx = null;
    }
    setTesting(false);
    setLevelDb(-Infinity);
    setPeakDb(-Infinity);
    setNoiseFloorDb(-Infinity);
    setNoiseCeilingDb(-Infinity);
    setSuggestedThreshold(null);
    setRelayEnabled(false);
    setSpeaking(false);
  }, []);

  useEffect(() => {
    if (!testing) return;
    applyRelayRouting();
  }, [testing, relayEnabled, applyRelayRouting]);

  // Cleanup on unmount — safe because stateRef persists across StrictMode remounts
  useEffect(() => {
    return () => {
      // Only clean up the interval; don't touch audio resources during
      // StrictMode remounts — they'll be reused if the component remounts
      if (stateRef.current.interval !== null) {
        clearInterval(stateRef.current.interval);
      }
    };
  }, []);

  // Map dB to percentage for the bar (range: -60 to 0 dB)
  const levelPct = meterDbToPct(levelDb);
  const peakPct = meterDbToPct(peakDb);
  const thresholdPct = meterDbToPct(vadThreshold);
  const suggestedPct = suggestedThreshold !== null ? meterDbToPct(suggestedThreshold) : null;

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-surface-500">
        Test your microphone and dial in voice activation. The bar shows current loudness, remembers your peak, and suggests a VA threshold.
      </p>

      {!testing && (
        <button
          onClick={startTest}
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-accent/20 text-accent hover:bg-accent/30"
        >
          Start Mic Test
        </button>
      )}

      {testing && (
        <div className="space-y-2.5">
          {/* Level meter */}
          <div className="relative h-6 bg-surface-800 rounded-lg overflow-hidden">
            {/* Level bar */}
            <div
              className={`absolute inset-y-0 left-0 transition-all duration-75 rounded-lg ${
                speaking ? "bg-green-500/60" : "bg-surface-600/60"
              }`}
              style={{ width: `${levelPct}%` }}
            />

            {/* Peak marker */}
            {Number.isFinite(peakDb) && (
              <div
                className="absolute inset-y-0 w-0.5 bg-red-400/90"
                style={{ left: `${peakPct}%` }}
              />
            )}

            {/* VAD threshold marker */}
            {voiceActivation && Number.isFinite(vadThreshold) && (
              <div
                className="absolute inset-y-0 w-0.5 bg-yellow-400/80"
                style={{ left: `${thresholdPct}%` }}
              />
            )}

            {/* Suggested threshold marker */}
            {suggestedPct !== null && (
              <div
                className="absolute inset-y-0 w-0.5 bg-cyan-400/85"
                style={{ left: `${suggestedPct}%` }}
              />
            )}

            {/* dB readout */}
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[10px] font-mono text-surface-300 drop-shadow-sm">
                {levelDb > -100 ? `${levelDb.toFixed(1)} dB` : "—"}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-surface-400">
            <span>Current: {Number.isFinite(levelDb) ? `${levelDb.toFixed(1)} dB` : "—"}</span>
            <span>Peak: {Number.isFinite(peakDb) ? `${peakDb.toFixed(1)} dB` : "—"}</span>
            <span>Noise floor: {Number.isFinite(noiseFloorDb) ? `${noiseFloorDb.toFixed(1)} dB` : "—"}</span>
            <span>Noise peak: {Number.isFinite(noiseCeilingDb) ? `${noiseCeilingDb.toFixed(1)} dB` : "—"}</span>
            <span>
              Suggested VA: {suggestedThreshold !== null ? `${suggestedThreshold} dB` : "Speak a bit louder to calibrate"}
            </span>
          </div>

          {suggestedThreshold !== null && (
            <button
              onClick={() => setVadThreshold(suggestedThreshold)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30"
            >
              Use suggested threshold ({suggestedThreshold} dB)
            </button>
          )}

          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-surface-300">Relay mic to output</p>
              <p className="text-[10px] text-surface-500">Off by default. Enable to hear your own voice during test (headphones recommended).</p>
            </div>
            <Toggle enabled={relayEnabled} onChange={setRelayEnabled} />
          </div>

          {/* Speaking indicator */}
          {voiceActivation && (
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full transition-colors ${speaking ? "bg-green-400" : "bg-surface-600"}`} />
              <span className="text-[10px] text-surface-400">
                {speaking ? "Voice detected — would transmit" : "Below threshold — silent"}
              </span>
            </div>
          )}

          <button
            onClick={stopTest}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-red-500/20 text-red-400 hover:bg-red-500/30"
          >
            Stop Test
          </button>
        </div>
      )}
    </div>
  );
}
