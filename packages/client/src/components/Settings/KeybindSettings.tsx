import { useState } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import { Keyboard } from "lucide-react";

function isModifierOnlyCode(code: string): boolean {
  return code === "ControlLeft" || code === "ControlRight" ||
    code === "ShiftLeft" || code === "ShiftRight" ||
    code === "AltLeft" || code === "AltRight" ||
    code === "MetaLeft" || code === "MetaRight";
}

function formatPrimaryKey(code: string): string {
  if (code.startsWith("Key") && code.length === 4) return code.slice(3).toUpperCase();
  if (code.startsWith("Digit") && code.length === 6) return code.slice(5);
  const map: Record<string, string> = {
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Escape: "Esc",
    Space: "Space",
    Enter: "Enter",
    Tab: "Tab",
    Backspace: "Backspace",
  };
  return map[code] ?? code;
}

function formatDisplayBinding(binding: string): string {
  if (!binding) return "Not set";

  if (binding.includes("+")) {
    return binding
      .split("+")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((part) => {
        const lower = part.toLowerCase();
        if (lower === "control") return "Ctrl";
        if (lower === "meta") return "Super";
        return part;
      })
      .join(" + ");
  }

  return formatPrimaryKey(binding);
}

function buildBindingFromEvent(e: KeyboardEvent): string {
  const modifiers: string[] = [];
  if (e.ctrlKey) modifiers.push("Ctrl");
  if (e.altKey) modifiers.push("Alt");
  if (e.shiftKey) modifiers.push("Shift");
  if (e.metaKey) modifiers.push("Super");

  const primary = formatPrimaryKey(e.code);
  if (modifiers.length === 0) {
    return "";
  }
  return `${modifiers.join("+")}+${primary}`;
}

export function KeybindSettings() {
  const {
    pttKey, muteKey, deafenKey,
    setPttKey, setMuteKey, setDeafenKey,
  } = useSettingsStore();

  const [recording, setRecording] = useState<"ptt" | "mute" | "deafen" | null>(null);
  const [captureError, setCaptureError] = useState("");

  const startCapture = (
    target: "ptt" | "mute" | "deafen",
    setter: (binding: string) => void,
  ) => {
    setRecording(target);
    setCaptureError("");

    const handler = (e: KeyboardEvent) => {
      if (isModifierOnlyCode(e.code)) return;
      e.preventDefault();
      e.stopPropagation();

      const binding = buildBindingFromEvent(e);
      if (!binding) {
        setCaptureError("Hotkeys require a combination (e.g. Ctrl+Q).");
        return;
      }

      setter(binding);
      setCaptureError("");
      setRecording(null);
      window.removeEventListener("keydown", handler, true);
    };

    window.addEventListener("keydown", handler, true);
  };

  const clearPtt = () => {
    setPttKey("");
    setCaptureError("");
    window.raddir?.unregisterPttKey();
  };

  const clearMute = () => {
    setMuteKey("");
    setCaptureError("");
    window.raddir?.unregisterMuteKey();
  };

  const clearDeafen = () => {
    setDeafenKey("");
    setCaptureError("");
    window.raddir?.unregisterDeafenKey();
  };

  const pttRequiresCombo = !!pttKey && !pttKey.includes("+");
  const muteRequiresCombo = !!muteKey && !muteKey.includes("+");
  const deafenRequiresCombo = !!deafenKey && !deafenKey.includes("+");

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold text-surface-200">Keybinds</h3>

      <div>
        <label className="flex items-center gap-1.5 text-xs text-surface-400 mb-1.5">
          <Keyboard className="w-3.5 h-3.5" /> Push-to-Talk Key
        </label>
        <div className="flex gap-2">
          <button
            onClick={() => startCapture("ptt", setPttKey)}
            className={`flex-1 px-3 py-2 rounded-lg text-sm text-left border transition-colors ${
              recording === "ptt"
                ? "bg-accent/20 border-accent text-accent animate-pulse"
                : "bg-surface-800 border-surface-700 text-surface-300 hover:border-surface-600"
            }`}
          >
            {recording === "ptt" ? "Press combination..." : formatDisplayBinding(pttKey)}
          </button>
          {pttKey && (
            <button
              onClick={clearPtt}
              className="px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-xs text-surface-400 hover:text-red-400 hover:border-red-400/50 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        {pttRequiresCombo && recording !== "ptt" && (
          <p className="text-[10px] text-yellow-400 mt-1">
            Existing single-key binding detected. Please set a combination keybind.
          </p>
        )}
      </div>

      <div>
        <label className="flex items-center gap-1.5 text-xs text-surface-400 mb-1.5">
          <Keyboard className="w-3.5 h-3.5" /> Toggle Mute
        </label>
        <div className="flex gap-2">
          <button
            onClick={() => startCapture("mute", setMuteKey)}
            className={`flex-1 px-3 py-2 rounded-lg text-sm text-left border transition-colors ${
              recording === "mute"
                ? "bg-accent/20 border-accent text-accent animate-pulse"
                : "bg-surface-800 border-surface-700 text-surface-300 hover:border-surface-600"
            }`}
          >
            {recording === "mute" ? "Press combination..." : formatDisplayBinding(muteKey)}
          </button>
          {muteKey && (
            <button
              onClick={clearMute}
              className="px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-xs text-surface-400 hover:text-red-400 hover:border-red-400/50 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        {muteRequiresCombo && recording !== "mute" && (
          <p className="text-[10px] text-yellow-400 mt-1">
            Existing single-key binding detected. Please set a combination keybind.
          </p>
        )}
      </div>

      <div>
        <label className="flex items-center gap-1.5 text-xs text-surface-400 mb-1.5">
          <Keyboard className="w-3.5 h-3.5" /> Toggle Deafen
        </label>
        <div className="flex gap-2">
          <button
            onClick={() => startCapture("deafen", setDeafenKey)}
            className={`flex-1 px-3 py-2 rounded-lg text-sm text-left border transition-colors ${
              recording === "deafen"
                ? "bg-accent/20 border-accent text-accent animate-pulse"
                : "bg-surface-800 border-surface-700 text-surface-300 hover:border-surface-600"
            }`}
          >
            {recording === "deafen" ? "Press combination..." : formatDisplayBinding(deafenKey)}
          </button>
          {deafenKey && (
            <button
              onClick={clearDeafen}
              className="px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-xs text-surface-400 hover:text-red-400 hover:border-red-400/50 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        {deafenRequiresCombo && recording !== "deafen" && (
          <p className="text-[10px] text-yellow-400 mt-1">
            Existing single-key binding detected. Please set a combination keybind.
          </p>
        )}
      </div>

      <p className="text-[10px] text-surface-500 mt-1">
        Hotkeys require combinations (e.g. Ctrl+Q, Ctrl+M, Ctrl+D). Background/global hotkeys are combo-only.
      </p>
      {captureError && <p className="text-[10px] text-red-400 mt-1">{captureError}</p>}
    </div>
  );
}
