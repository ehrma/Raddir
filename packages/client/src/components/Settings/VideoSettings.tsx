import { useSettingsStore } from "../../stores/settingsStore";
import { Camera, Monitor } from "lucide-react";

const RESOLUTION_OPTIONS = [
  { value: "480p" as const, label: "480p (854×480)" },
  { value: "720p" as const, label: "720p (1280×720)" },
  { value: "1080p" as const, label: "1080p (1920×1080)" },
];

const FPS_OPTIONS = [5, 10, 15, 24, 30, 60];

const BITRATE_PRESETS = [
  { value: 500, label: "500 kbps (Low)" },
  { value: 1000, label: "1000 kbps" },
  { value: 1500, label: "1500 kbps (Default)" },
  { value: 2500, label: "2500 kbps" },
  { value: 4000, label: "4000 kbps" },
  { value: 6000, label: "6000 kbps (High)" },
];

const SCREEN_BITRATE_PRESETS = [
  { value: 1000, label: "1000 kbps (Low)" },
  { value: 2500, label: "2500 kbps (Default)" },
  { value: 4000, label: "4000 kbps" },
  { value: 6000, label: "6000 kbps" },
  { value: 8000, label: "8000 kbps (High)" },
];

export function VideoSettings() {
  const {
    webcamResolution, webcamFps, webcamBitrate,
    screenShareBitrate, screenShareFps,
    setWebcamResolution, setWebcamFps, setWebcamBitrate,
    setScreenShareBitrate, setScreenShareFps,
  } = useSettingsStore();

  return (
    <div className="space-y-6">
      {/* Webcam section */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-surface-200 flex items-center gap-1.5">
          <Camera className="w-3.5 h-3.5" /> Webcam
        </h3>

        <div>
          <label className="text-xs text-surface-400 mb-1.5 block">Resolution</label>
          <select
            value={webcamResolution}
            onChange={(e) => setWebcamResolution(e.target.value as "480p" | "720p" | "1080p")}
            className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-100 focus:outline-none focus:border-accent"
          >
            {RESOLUTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-surface-400 mb-1.5 block">
            Frame Rate — {webcamFps} fps
          </label>
          <input
            type="range"
            min={5}
            max={60}
            step={1}
            value={webcamFps}
            onChange={(e) => setWebcamFps(Number(e.target.value))}
            className="w-full accent-accent"
          />
          <div className="flex justify-between text-[10px] text-surface-500 mt-0.5">
            {FPS_OPTIONS.map((f) => <span key={f}>{f}</span>)}
          </div>
        </div>

        <div>
          <label className="text-xs text-surface-400 mb-1.5 block">
            Bitrate — {webcamBitrate} kbps
          </label>
          <select
            value={webcamBitrate}
            onChange={(e) => setWebcamBitrate(Number(e.target.value))}
            className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-100 focus:outline-none focus:border-accent"
          >
            {BITRATE_PRESETS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <p className="text-[10px] text-surface-500 mt-1">
            Higher bitrate = better quality, more bandwidth usage
          </p>
        </div>
      </div>

      <div className="border-t border-surface-800" />

      {/* Screen share section */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-surface-200 flex items-center gap-1.5">
          <Monitor className="w-3.5 h-3.5" /> Screen Share
        </h3>

        <div>
          <label className="text-xs text-surface-400 mb-1.5 block">
            Frame Rate — {screenShareFps} fps
          </label>
          <input
            type="range"
            min={1}
            max={60}
            step={1}
            value={screenShareFps}
            onChange={(e) => setScreenShareFps(Number(e.target.value))}
            className="w-full accent-accent"
          />
          <div className="flex justify-between text-[10px] text-surface-500 mt-0.5">
            <span>1</span><span>15</span><span>30</span><span>60</span>
          </div>
          <p className="text-[10px] text-surface-500 mt-1">
            Lower fps saves bandwidth for static content (documents, code)
          </p>
        </div>

        <div>
          <label className="text-xs text-surface-400 mb-1.5 block">
            Bitrate — {screenShareBitrate} kbps
          </label>
          <select
            value={screenShareBitrate}
            onChange={(e) => setScreenShareBitrate(Number(e.target.value))}
            className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-100 focus:outline-none focus:border-accent"
          >
            {SCREEN_BITRATE_PRESETS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <p className="text-[10px] text-surface-500 mt-1">
            Screen share uses native resolution. Higher bitrate preserves text clarity.
          </p>
        </div>
      </div>

      <div className="border-t border-surface-800" />

      <p className="text-[10px] text-surface-500">
        Changes apply to the next video/screen share session. Active streams are not affected.
      </p>
    </div>
  );
}
