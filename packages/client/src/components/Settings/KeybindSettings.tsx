import { useState } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import { Keyboard } from "lucide-react";

export function KeybindSettings() {
  const { pttKey, setPttKey } = useSettingsStore();
  const [recording, setRecording] = useState(false);

  const handleRecord = () => {
    setRecording(true);

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setPttKey(e.code);
      setRecording(false);
      window.removeEventListener("keydown", handler, true);
    };

    window.addEventListener("keydown", handler, true);
  };

  const handleClear = () => {
    setPttKey("");
    window.raddir?.unregisterPttKey();
  };

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold text-surface-200">Keybinds</h3>

      <div>
        <label className="flex items-center gap-1.5 text-xs text-surface-400 mb-1.5">
          <Keyboard className="w-3.5 h-3.5" /> Push-to-Talk Key
        </label>
        <div className="flex gap-2">
          <button
            onClick={handleRecord}
            className={`flex-1 px-3 py-2 rounded-lg text-sm text-left border transition-colors ${
              recording
                ? "bg-accent/20 border-accent text-accent animate-pulse"
                : "bg-surface-800 border-surface-700 text-surface-300 hover:border-surface-600"
            }`}
          >
            {recording ? "Press a key..." : pttKey || "Not set"}
          </button>
          {pttKey && (
            <button
              onClick={handleClear}
              className="px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-xs text-surface-400 hover:text-red-400 hover:border-red-400/50 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        <p className="text-[10px] text-surface-500 mt-1">
          Works globally when the app is in the background (Electron only)
        </p>
      </div>
    </div>
  );
}
