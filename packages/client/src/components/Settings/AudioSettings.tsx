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
  const [testing, setTesting] = useState(false);
  const [levelDb, setLevelDb] = useState(-Infinity);
  const [speaking, setSpeaking] = useState(false);

  // All mutable state lives in a single ref to survive React StrictMode
  // remounts without accidentally killing the live audio pipeline
  const stateRef = useRef<{
    interval: ReturnType<typeof setInterval> | null;
    ownStream: MediaStream | null;
    ownCtx: AudioContext | null;
    lastUiUpdate: number;
  }>({ interval: null, ownStream: null, ownCtx: null, lastUiUpdate: 0 });

  const startTest = useCallback(async () => {
    // Already running — don't start a second one
    if (stateRef.current.interval) return;

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

      const dataArray = new Float32Array(analyser.fftSize);

      stateRef.current.interval = setInterval(() => {
        if (ctx!.state !== "running") return;
        analyser.getFloatTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const db = rms > 0 ? 20 * Math.log10(rms) : -100;

        const now = performance.now();
        if (now - stateRef.current.lastUiUpdate > 50) {
          stateRef.current.lastUiUpdate = now;
          setLevelDb(db);
          setSpeaking(db > useSettingsStore.getState().vadThreshold);
        }
      }, 16);

      setTesting(true);
    } catch (err) {
      console.error("[mic-test] Failed to start:", err);
    }
  }, [inputDeviceId, echoCancellation, noiseSuppression, autoGainControl]);

  const stopTest = useCallback(() => {
    if (stateRef.current.interval !== null) {
      clearInterval(stateRef.current.interval);
      stateRef.current.interval = null;
    }
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
    setSpeaking(false);
  }, []);

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
  const levelPct = Math.max(0, Math.min(100, ((levelDb + 60) / 60) * 100));
  const thresholdPct = Math.max(0, Math.min(100, ((vadThreshold + 60) / 60) * 100));

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-surface-500">
        Test your microphone and dial in the voice activation threshold. The green bar shows your current mic level.
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
        <div className="space-y-2">
          {/* Level meter */}
          <div className="relative h-6 bg-surface-800 rounded-lg overflow-hidden">
            {/* Level bar */}
            <div
              className={`absolute inset-y-0 left-0 transition-all duration-75 rounded-lg ${
                speaking ? "bg-green-500/60" : "bg-surface-600/60"
              }`}
              style={{ width: `${levelPct}%` }}
            />

            {/* VAD threshold marker */}
            {voiceActivation && (
              <div
                className="absolute inset-y-0 w-0.5 bg-yellow-400/80"
                style={{ left: `${thresholdPct}%` }}
              >
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-[8px] text-yellow-400 whitespace-nowrap">
                  {vadThreshold} dB
                </div>
              </div>
            )}

            {/* dB readout */}
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[10px] font-mono text-surface-300 drop-shadow-sm">
                {levelDb > -100 ? `${levelDb.toFixed(1)} dB` : "—"}
              </span>
            </div>
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
